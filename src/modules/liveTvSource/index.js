'use strict';

// liveTvSource: turns an IPTV source the operator is entitled to use (an
// Xtream login or an M3U address) into a small, current M3U and XMLTV guide
// for Jellyfin (or Threadfin). It keeps only the groups the operator picks,
// shows event slots only when something is on, and merges guides in priority
// order so a backup guide fills whatever the first one leaves empty. The last
// good guide from each source is kept, so a provider outage never empties
// the guide. Ships no provider presets.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { httpUrl } = require('../../config');
const { readJsonFile, readSecret, requestJson, writeLinesAtomic, writePrivateJson } = require('../../lib/io');
const { lines, openText } = require('../../lib/http-stream');
const { dateTokens, eventActive, matchupFromName } = require('./events');
const { collectGuide, guideLines, hasCurrent, matchupProgramme, nameKey } = require('./guide');
const { readPlaylist, renderPlaylist } = require('./m3u');
const { guideUrl, liveCatalog, shortGuide } = require('./xtream');

const ID = 'liveTvSource';
const VERSION = 1;
const SHORT_GUIDE_PER_RUN = 150;
const SHORT_GUIDE_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_PATTERN = 200;
const RETRY_MS = 5 * 60 * 1000;

// Providers separate groups with rows like "##### SPORTS #####" or
// "US| ===== NEWS =====". They play nothing, so they are left out.
function isDivider(name) {
  const text = String(name || '').replace(/^[A-Za-z]{2,4}\s*[|:]\s*/, '').trim();
  return /^[#=*~_-]{3,}/.test(text) || /^#/.test(String(name || '').trim());
}

function list(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function settingsFrom(env) {
  const errors = [];
  const type = env.ZOROFIN_LIVE_SOURCE_TYPE || 'xtream';
  const token = readSecret(env, 'ZOROFIN_LIVE_SOURCE_TOKEN');
  const minutes = Number(env.ZOROFIN_LIVE_SOURCE_REFRESH_MINUTES || 60);
  const guideHours = Number(env.ZOROFIN_LIVE_SOURCE_GUIDE_HOURS || 6);
  const maxChannels = Number(env.ZOROFIN_LIVE_SOURCE_MAX_CHANNELS || 3000);
  const eventRule = env.ZOROFIN_LIVE_SOURCE_EVENT_RULE || 'today';
  const format = env.ZOROFIN_LIVE_SOURCE_STREAM_FORMAT || 'ts';
  const settings = {
    type,
    token,
    groups: list(env.ZOROFIN_LIVE_SOURCE_GROUPS),
    eventGroups: list(env.ZOROFIN_LIVE_SOURCE_EVENT_GROUPS),
    eventRule,
    eventPattern: null,
    maxChannels,
    providerGuide: env.ZOROFIN_LIVE_SOURCE_PROVIDER_GUIDE !== '0',
    backupGuides: [],
    shortGuide: env.ZOROFIN_LIVE_SOURCE_SHORT_GUIDE === '1',
    matchups: env.ZOROFIN_LIVE_SOURCE_MATCHUPS !== '0',
    format,
    lineAddress: '',
    refreshMs: minutes * 60 * 1000,
    guideMs: guideHours * 60 * 60 * 1000,
  };

  if (type === 'xtream') {
    const base = httpUrl(env.ZOROFIN_LIVE_SOURCE_XTREAM_URL);
    const username = String(env.ZOROFIN_LIVE_SOURCE_XTREAM_USERNAME || '').trim();
    const password = readSecret(env, 'ZOROFIN_LIVE_SOURCE_XTREAM_PASSWORD');
    if (!base) errors.push('ZOROFIN_LIVE_SOURCE_XTREAM_URL must be the http(s) address of your provider (the part before /player_api.php)');
    if (!username || !password) errors.push('ZOROFIN_LIVE_SOURCE_XTREAM_USERNAME and ZOROFIN_LIVE_SOURCE_XTREAM_PASSWORD are needed for an Xtream login');
    settings.xtream = { base: base || '', username, password };
  } else if (type === 'm3u') {
    const raw = readSecret(env, 'ZOROFIN_LIVE_SOURCE_M3U_URL');
    let ok = false;
    try { ok = ['http:', 'https:'].includes(new URL(raw).protocol); } catch (_) { ok = false; }
    if (!ok) errors.push('ZOROFIN_LIVE_SOURCE_M3U_URL must be the http(s) address of your playlist');
    settings.m3uUrl = raw;
  } else {
    errors.push('ZOROFIN_LIVE_SOURCE_TYPE must be xtream or m3u');
  }

  for (const url of list(env.ZOROFIN_LIVE_SOURCE_BACKUP_GUIDES)) {
    let ok = false;
    try { ok = ['http:', 'https:'].includes(new URL(url).protocol); } catch (_) { ok = false; }
    if (ok) settings.backupGuides.push(url);
    else errors.push('ZOROFIN_LIVE_SOURCE_BACKUP_GUIDES must be http(s) XMLTV addresses, separated by commas');
  }
  if (!['today', 'pattern', 'all'].includes(eventRule)) errors.push('ZOROFIN_LIVE_SOURCE_EVENT_RULE must be today, pattern or all');
  if (eventRule === 'pattern') {
    const pattern = String(env.ZOROFIN_LIVE_SOURCE_EVENT_PATTERN || '');
    try {
      if (!pattern || pattern.length > MAX_PATTERN) throw new Error('length');
      settings.eventPattern = new RegExp(pattern, 'i');
    } catch (_) {
      errors.push(`ZOROFIN_LIVE_SOURCE_EVENT_PATTERN must be a regular expression of 1-${MAX_PATTERN} characters`);
    }
  }
  const lineAddress = readSecret(env, 'ZOROFIN_LIVE_SOURCE_LINE_ADDRESS').replace(/\/+$/, '');
  if (lineAddress) {
    let ok = false;
    try { ok = ['http:', 'https:'].includes(new URL(lineAddress).protocol); } catch (_) { ok = false; }
    if (ok) settings.lineAddress = lineAddress;
    else errors.push('ZOROFIN_LIVE_SOURCE_LINE_ADDRESS must be the http(s) line address from Live TV streams');
  }
  if (!['ts', 'm3u8', 'short'].includes(format)) errors.push('ZOROFIN_LIVE_SOURCE_STREAM_FORMAT must be ts, m3u8 or short');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) errors.push('ZOROFIN_LIVE_SOURCE_TOKEN must be 32-128 letters, digits, - or _ (try openssl rand -hex 24)');
  if (!Number.isFinite(minutes) || minutes < 15 || minutes > 1440) errors.push('ZOROFIN_LIVE_SOURCE_REFRESH_MINUTES must be 15 to 1440');
  if (!Number.isFinite(guideHours) || guideHours < 1 || guideHours > 48) errors.push('ZOROFIN_LIVE_SOURCE_GUIDE_HOURS must be 1 to 48');
  if (!Number.isInteger(maxChannels) || maxChannels < 10 || maxChannels > 20000) errors.push('ZOROFIN_LIVE_SOURCE_MAX_CHANNELS must be a whole number from 10 to 20000');
  if (errors.length) throw new Error(errors.join('; '));
  return settings;
}

function sameToken(supplied, expected) {
  const left = Buffer.from(String(supplied || ''));
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function inGroups(group, wanted) {
  const value = String(group || '').toLowerCase();
  return wanted.some(item => value.startsWith(item.toLowerCase()));
}

// Host only: guide addresses often carry a login.
function sourceLabel(url, index) {
  try { return `Backup guide ${index} (${new URL(url).hostname})`; }
  catch (_) { return `Backup guide ${index}`; }
}

function createLiveTvSource(config, deps = {}) {
  const settings = deps.settings || settingsFrom(deps.env || process.env);
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const open = deps.openText || openText;
  const fetchJson = deps.fetchJson || (async url => {
    const reply = await (deps.requestJson || requestJson)(url, { timeout: 60000, maxResponseBytes: 128 * 1024 * 1024 });
    if (reply.status !== 200) throw new Error(`the provider answered ${reply.status}`);
    return reply.body;
  });
  const dir = path.join(config.dataDir, ID);
  const playlistFile = path.join(dir, 'channels.m3u');
  const guideFile = path.join(dir, 'guide.xml');
  const shortFile = path.join(dir, 'short-guide.json');
  const status = {
    lastRefreshAt: null, lastSuccessAt: null, lastError: null,
    channels: 0, eventChannels: { shown: 0, total: 0 }, catalog: 0,
    filled: { guide: 0, shortGuide: 0, matchups: 0, empty: 0 },
    guides: [],
  };
  let groups = [];
  let preview = { channels: [], events: [] };
  let running = null;
  let timer = null;
  let retry = null;

  function guideSources() {
    const sources = [];
    if (settings.type === 'xtream' && settings.providerGuide) sources.push({ label: 'Provider guide', url: guideUrl(settings.xtream) });
    settings.backupGuides.forEach((url, index) => sources.push({ label: sourceLabel(url, index + 1), url }));
    return sources.map(source => ({ ...source, file: path.join(dir, 'guides', `${crypto.createHash('sha256').update(source.url).digest('hex').slice(0, 24)}.json`) }));
  }

  async function catalog() {
    const counts = new Map();
    const wanted = entry => {
      counts.set(entry.group, (counts.get(entry.group) || 0) + 1);
      if (!entry.name || isDivider(entry.name) || !entry.url) return false;
      return !settings.groups.length || inGroups(entry.group, settings.groups) || inGroups(entry.group, settings.eventGroups);
    };
    let entries;
    let seen;
    if (settings.type === 'xtream') {
      const all = await liveCatalog(fetchJson, settings.xtream, settings.format);
      entries = all.filter(wanted);
      seen = all.length;
    } else {
      const result = await readPlaylist(lines(await open(settings.m3uUrl, { timeout: 120000 })), wanted);
      entries = result.kept;
      seen = result.seen;
    }
    groups = [...counts.entries()].map(([name, channels]) => ({
      name, channels,
      kept: !settings.groups.length || inGroups(name, settings.groups),
      event: inGroups(name, settings.eventGroups),
    })).sort((a, b) => b.channels - a.channels || a.name.localeCompare(b.name)).slice(0, 2000);
    return { entries, seen };
  }

  function choose(entries) {
    const tokens = dateTokens(now());
    const channels = [];
    let events = 0;
    let shownEvents = 0;
    for (const entry of entries) {
      const event = inGroups(entry.group, settings.eventGroups);
      if (event) {
        events += 1;
        const on = settings.eventRule === 'all' ? true
          : settings.eventRule === 'pattern' ? settings.eventPattern.test(entry.name)
            : eventActive(entry.name, tokens);
        if (!on) continue;
        shownEvents += 1;
      }
      const guideId = entry.id
        || (entry.streamId ? `xt.${entry.streamId}` : `zf.${crypto.createHash('sha1').update(entry.name).digest('hex').slice(0, 12)}`);
      // Shared logins: Xtream channels play through the Live TV streams line
      // pool, which picks whichever login is free.
      const url = settings.lineAddress && entry.streamId ? `${settings.lineAddress}/${entry.streamId}` : entry.url;
      channels.push({ ...entry, url, guideId, event });
      if (channels.length >= settings.maxChannels) break;
    }
    return { channels, events, shownEvents };
  }

  async function readGuide(source, ids, names) {
    const cached = readJsonFile(source.file, null);
    const result = { label: source.label, ok: true, at: cached && cached.at ? new Date(cached.at).toISOString() : null, programmes: 0, lastError: null };
    if (cached && cached.channels && now() - cached.at < settings.guideMs) {
      result.programmes = cached.programmes || 0;
      return { result, channels: cached.channels };
    }
    try {
      const fresh = await collectGuide(await open(source.url, { timeout: 300000 }), { ids, names }, now());
      if (!fresh.programmes && cached && cached.programmes) throw new Error('the guide had no listings for these channels');
      writePrivateJson(source.file, { at: now(), programmes: fresh.programmes, channels: fresh.channels }, { compact: true });
      Object.assign(result, { at: new Date(now()).toISOString(), programmes: fresh.programmes });
      return { result, channels: fresh.channels };
    } catch (error) {
      const message = String(error.message || error).replace(/password=[^&\s]*/gi, 'password=…').slice(0, 200);
      Object.assign(result, { ok: false, lastError: message, programmes: cached ? cached.programmes || 0 : 0 });
      log(`${source.label} failed (${message}); ${cached ? 'using its last good copy' : 'no earlier copy to use'}`);
      return { result, channels: (cached && cached.channels) || {} };
    }
  }

  async function build() {
    const { entries, seen } = await catalog();
    const { channels, events, shownEvents } = choose(entries);
    if (!channels.length) throw new Error(seen ? 'no channels matched the groups you picked' : 'the source returned no channels');

    const ids = new Set(channels.map(channel => channel.guideId));
    const names = new Map();
    for (const channel of channels) {
      const key = nameKey(channel.name);
      if (key && !names.has(key)) names.set(key, channel.guideId);
    }
    const sources = guideSources();
    const guides = [];
    for (const source of sources) guides.push(await readGuide(source, ids, names));

    const byId = new Map();
    for (const channel of channels) if (!byId.has(channel.guideId)) byId.set(channel.guideId, channel);
    const programmes = {};
    const filled = { guide: 0, shortGuide: 0, matchups: 0, empty: 0 };
    const missing = [];
    for (const id of ids) {
      const hit = guides.find(guide => hasCurrent(guide.channels[id], now()));
      if (hit) { programmes[id] = hit.channels[id]; filled.guide += 1; } else missing.push(id);
    }

    if (missing.length && settings.shortGuide && settings.type === 'xtream') {
      const cache = readJsonFile(shortFile, {});
      let asked = 0;
      for (const id of [...missing]) {
        const channel = byId.get(id);
        if (!channel || !channel.streamId || channel.event) continue;
        let entry = cache[channel.streamId];
        if (!entry || now() - entry.at > SHORT_GUIDE_TTL_MS) {
          if (asked >= SHORT_GUIDE_PER_RUN) continue;
          asked += 1;
          try { entry = { at: now(), programmes: await shortGuide(fetchJson, settings.xtream, channel.streamId, id) }; }
          catch (_) { entry = { at: now(), programmes: [] }; }
          cache[channel.streamId] = entry;
        }
        if (hasCurrent(entry.programmes, now())) {
          programmes[id] = entry.programmes;
          filled.shortGuide += 1;
          missing.splice(missing.indexOf(id), 1);
        }
      }
      for (const [key, entry] of Object.entries(cache)) if (now() - entry.at > SHORT_GUIDE_TTL_MS * 4) delete cache[key];
      writePrivateJson(shortFile, cache);
    }

    if (settings.matchups) {
      for (const id of [...missing]) {
        const channel = byId.get(id);
        const matchup = channel && channel.event && matchupFromName(channel.name);
        if (!matchup) continue;
        programmes[id] = [matchupProgramme(id, matchup, channel.name, now())];
        filled.matchups += 1;
        missing.splice(missing.indexOf(id), 1);
      }
    }
    filled.empty = missing.length;

    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const temporary = `${playlistFile}.tmp`;
    fs.writeFileSync(temporary, renderPlaylist(channels), { mode: 0o600 });
    fs.renameSync(temporary, playlistFile);
    writeLinesAtomic(guideFile, guideLines(channels, programmes));
    preview = {
      channels: channels.filter(channel => !channel.event).slice(0, 30).map(channel => ({ name: channel.name, group: channel.group })),
      events: channels.filter(channel => channel.event).slice(0, 50).map(channel => ({ name: channel.name, group: channel.group, matchup: matchupFromName(channel.name) })),
    };
    return {
      channels: channels.length, catalog: seen,
      eventChannels: { shown: shownEvents, total: events },
      filled, guides: guides.map(guide => guide.result),
    };
  }

  function refresh() {
    if (running) return running;
    running = (async () => {
      status.lastRefreshAt = new Date(now()).toISOString();
      try {
        Object.assign(status, await build(), { lastSuccessAt: status.lastRefreshAt, lastError: null });
        log(`live TV source refreshed: ${status.channels} channels (${status.eventChannels.shown} of ${status.eventChannels.total} event slots on), guide for ${status.filled.guide + status.filled.shortGuide + status.filled.matchups}`);
      } catch (error) {
        status.lastError = String(error.message || error).replace(/password=[^&\s]*/gi, 'password=…').slice(0, 240);
        log(`live TV source refresh failed, serving the last good copy: ${status.lastError}`);
        // Nothing served yet: try again soon rather than waiting a full interval.
        if (!status.lastSuccessAt && timer && !retry) {
          retry = setTimeout(() => { retry = null; refresh(); }, RETRY_MS);
          retry.unref();
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function serveFile(file, contentType) {
    if (!fs.existsSync(file)) return { status: 503, body: { error: 'not_ready' } };
    return { status: 200, file, contentType };
  }

  return {
    id: ID,
    capabilities: () => ({ [ID]: { version: VERSION, enabled: true } }),

    // Jellyfin or Threadfin reads these, authorized by the token in the address.
    async handlePublic({ segments }) {
      const [token, file, ...rest] = segments;
      if (rest.length || !sameToken(token, settings.token)) return { status: 404, body: { error: 'Not found' } };
      if (file === 'channels.m3u') return serveFile(playlistFile, 'audio/x-mpegurl; charset=utf-8');
      if (file === 'guide.xml') return serveFile(guideFile, 'application/xml; charset=utf-8');
      return { status: 404, body: { error: 'Not found' } };
    },

    async handle({ method, segments, viewer }) {
      if (!viewer.admin) return { status: 403, body: { error: 'admin_only' } };
      const route = `${method} ${segments.join('/')}`;
      if (route === 'GET status') return { status: 200, body: { ...status, refreshing: Boolean(running), type: settings.type, eventRule: settings.eventRule } };
      if (route === 'GET groups') return { status: 200, body: { groups } };
      if (route === 'GET preview') return { status: 200, body: preview };
      if (route === 'POST refresh') {
        refresh();
        return { status: 202, body: { refreshing: true } };
      }
      return { status: 404, body: { error: 'Not found' } };
    },

    start() {
      refresh();
      timer = setInterval(refresh, settings.refreshMs);
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);
      if (retry) clearTimeout(retry);
      timer = null;
      retry = null;
    },

    refresh,
    status,
  };
}

module.exports = { ID, createLiveTvSource, isDivider, settingsFrom };
