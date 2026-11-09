'use strict';

// liveTvGuide: serves the operator's XMLTV guide back to Jellyfin with sports
// matchups in titles and artwork for programmes that have none. Works with any
// XMLTV source (Threadfin, xTeVe, a tuner's guide, a listings service).
// Outside art sources are off unless the operator enables them; Zorofin ships
// no keys. Fails open: if enrichment breaks, Jellyfin gets the last good guide.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { httpUrl } = require('../../config');
const { readJsonFile, readSecret, writePrivateJson } = require('../../lib/io');
const { HAS_MATCHUP, extractTeams, isSport, normalizeTeam } = require('./sports');
const { fetchBuffer, mirrorImage, sportsDbCard, tvmazePoster } = require('./sources');
const { bestLogo, cleanChannelName, logoFiles, overrideFor, parseOverrides, rawUrl } = require('./logos');
const { rewriteChannels, rewriteProgrammes } = require('./xmltv');

const STARTUP_RETRY_MS = 60 * 1000;
const ID = 'liveTvGuide';
const VERSION = 1;
const MAX_GUIDE_BYTES = 64 * 1024 * 1024;
const ART_FILE = /^[0-9a-f]{32}\.(jpg|png|webp)$/;
const ART_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const SHOW_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MATCHUP_MISS_TTL_MS = 30 * 60 * 1000;
const LOGO_TREE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCES = {
  shows: { newPerRun: 60, spacingMs: 600, missTtlMs: SHOW_MISS_TTL_MS },       // TVmaze
  matchups: { newPerRun: 6, spacingMs: 2500, missTtlMs: MATCHUP_MISS_TTL_MS }, // TheSportsDB free tier: 30 a minute
  logos: { newPerRun: 200, spacingMs: 100, missTtlMs: SHOW_MISS_TTL_MS },      // tv-logos on GitHub
};

function settingsFrom(env) {
  const errors = [];
  const sourceUrl = httpUrl(env.ZOROFIN_GUIDE_SOURCE_URL);
  const token = readSecret(env, 'ZOROFIN_GUIDE_TOKEN');
  const publicUrl = httpUrl(env.ZOROFIN_GUIDE_PUBLIC_URL);
  const tvmaze = env.ZOROFIN_GUIDE_TVMAZE === '1';
  const sportsDbKey = readSecret(env, 'ZOROFIN_GUIDE_SPORTSDB_KEY');
  const minutes = Number(env.ZOROFIN_GUIDE_REFRESH_MINUTES || 30);
  const channelLogos = env.ZOROFIN_GUIDE_CHANNEL_LOGOS === '1';
  const logoCountries = String(env.ZOROFIN_GUIDE_LOGO_COUNTRIES || 'united-states').split(',').map(item => item.trim()).filter(Boolean);
  const overrides = parseOverrides(String(env.ZOROFIN_GUIDE_LOGO_OVERRIDES || '').split(',').map(item => item.trim()).filter(Boolean));

  if (!sourceUrl) errors.push('ZOROFIN_GUIDE_SOURCE_URL must be the http(s) address of your XMLTV guide');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) errors.push('ZOROFIN_GUIDE_TOKEN must be 32-128 letters, digits, - or _ (try openssl rand -hex 24)');
  if (logoCountries.some(country => !/^[a-z-]{2,40}$/.test(country))) errors.push('ZOROFIN_GUIDE_LOGO_COUNTRIES must be tv-logos country folder names, e.g. united-states,united-kingdom');
  if ((tvmaze || sportsDbKey || channelLogos) && !publicUrl) errors.push('ZOROFIN_GUIDE_PUBLIC_URL (how Jellyfin reaches the companion) is needed for artwork');
  if (overrides.errors.length) errors.push(`ZOROFIN_GUIDE_LOGO_OVERRIDES entries must look like "Channel name=logo-file-us.png", "Channel name=https://…" or "Channel name=none": ${overrides.errors.slice(0, 3).join(', ')}`);
  if (publicUrl === null) errors.push('ZOROFIN_GUIDE_PUBLIC_URL must be a plain http(s) URL');
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) errors.push('ZOROFIN_GUIDE_REFRESH_MINUTES must be 5 to 1440');
  if (sportsDbKey && !/^[A-Za-z0-9]{1,64}$/.test(sportsDbKey)) errors.push('ZOROFIN_GUIDE_SPORTSDB_KEY looks malformed');
  if (errors.length) throw new Error(errors.join('; '));
  return {
    sourceUrl,
    token,
    publicUrl: publicUrl || '',
    tvmaze,
    sportsDbKey,
    matchupTitles: env.ZOROFIN_GUIDE_MATCHUP_TITLES !== '0',
    channelLogos,
    logoCountries,
    logoOverrides: overrides.rules,
    refreshMs: minutes * 60 * 1000,
  };
}

function sameToken(supplied, expected) {
  const left = Buffer.from(String(supplied || ''));
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createLiveTvGuide(config, deps = {}) {
  const settings = deps.settings || settingsFrom(deps.env || process.env);
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const fetcher = deps.fetcher || fetchBuffer;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const dir = path.join(config.dataDir, ID);
  const guideFile = path.join(dir, 'guide.xml');
  const artDir = path.join(dir, 'art');
  const cacheFile = path.join(dir, 'cache.json');
  const status = { lastRefreshAt: null, lastSuccessAt: null, lastError: null, programmes: 0, titled: 0, iconed: 0, logos: 0 };
  let running = null;
  let timer = null;
  let retry = null; // soon after a failed start, while nothing has been served yet

  function artUrl(file) {
    return `${settings.publicUrl}v1/public/${ID}/${settings.token}/art/${file}`;
  }

  // Looks up and mirrors art once per key, respecting each source's limits.
  async function lookup(cache, run, source, key, find) {
    const section = cache[source] || (cache[source] = {});
    const entry = section[key];
    const limits = SOURCES[source];
    if (entry && entry.file && fs.existsSync(path.join(artDir, entry.file))) return entry.file;
    if (entry && !entry.file && now() - entry.at < limits.missTtlMs) return null;
    if ((run[source] || 0) >= limits.newPerRun) return null;
    run[source] = (run[source] || 0) + 1;
    if (run[source] > 1) await sleep(limits.spacingMs);
    const found = await find();
    if (found.transient) return null;
    const file = found.url ? await mirrorImage(fetcher, artDir, found.url) : null;
    section[key] = { file, at: now() };
    return file;
  }

  async function build() {
    const source = await fetcher(settings.sourceUrl, { maxBytes: MAX_GUIDE_BYTES, timeout: 60000 });
    const xml = source.status === 200 ? source.body.toString('utf8') : '';
    if (!/<tv[\s>]/.test(xml)) throw new Error(`guide source returned ${source.status === 200 ? 'something that is not XMLTV' : `HTTP ${source.status}`}`);

    const cache = readJsonFile(cacheFile, null);
    const lookups = cache && cache.version === 1 ? cache : { version: 1, shows: {}, matchups: {} };
    const run = {};
    const counts = { programmes: 0, titled: 0, iconed: 0, logos: 0 };
    let withLogos = xml;
    if (settings.channelLogos) {
      const rules = settings.logoOverrides || [];
      const named = rules.filter(rule => rule.logo.endsWith('.png') && !rule.logo.startsWith('https:')).map(rule => rule.logo);
      const tree = lookups.logoTree;
      const treeKey = named.slice().sort().join(',');
      if (!tree || now() - tree.at > LOGO_TREE_TTL_MS || (tree.extra || '') !== treeKey) {
        const files = await logoFiles(fetcher, settings.logoCountries, named);
        if (files) lookups.logoTree = { at: now(), files, extra: treeKey };
      }
      const files = (lookups.logoTree && lookups.logoTree.files) || [];
      withLogos = await rewriteChannels(xml, async channel => {
        const rule = overrideFor(channel.name, rules);
        if (rule && rule.logo === 'none') return null;
        // An operator's rule replaces the guide's own logo; a guess only fills a gap.
        if (!rule && channel.hasIcon) return null;
        const key = rule ? `rule:${rule.logo}` : cleanChannelName(channel.name).toLowerCase();
        const file = await lookup(lookups, run, 'logos', key, async () => {
          if (rule && rule.logo.startsWith('https:')) return { url: rule.logo };
          const match = rule ? files.find(item => item.endsWith('/' + rule.logo)) : bestLogo(channel.name, files);
          return match ? { url: rawUrl(match) } : { miss: true };
        });
        if (!file) return null;
        counts.logos += 1;
        return { icon: artUrl(file), replace: Boolean(rule) };
      });
    }
    const enriched = await rewriteProgrammes(withLogos, async programme => {
      counts.programmes += 1;
      const text = `${programme.subTitle} ${programme.desc}`;
      const sport = isSport(programme.title, text);
      const teams = sport ? extractTeams(programme.title, programme.desc) : null;
      const shown = teams && teams.map(normalizeTeam);
      const change = {};
      if (shown && settings.matchupTitles && !HAS_MATCHUP.test(programme.title)) {
        change.title = `${programme.title} — ${shown[0]} vs ${shown[1]}`;
        counts.titled += 1;
      }
      if (!programme.icon) {
        let file = null;
        if (shown && settings.sportsDbKey) {
          file = await lookup(lookups, run, 'matchups', shown.map(name => name.toLowerCase()).sort().join('|'),
            () => sportsDbCard(fetcher, settings.sportsDbKey, shown));
        }
        if (!file && !sport && settings.tvmaze) {
          file = await lookup(lookups, run, 'shows', programme.title.toLowerCase(), () => tvmazePoster(fetcher, programme.title));
        }
        if (file) {
          change.icon = artUrl(file);
          counts.iconed += 1;
        }
      }
      return change;
    });

    fs.mkdirSync(dir, { recursive: true });
    const temporary = `${guideFile}.tmp`;
    fs.writeFileSync(temporary, enriched);
    fs.renameSync(temporary, guideFile);
    writePrivateJson(cacheFile, lookups);
    return counts;
  }

  function refresh() {
    if (running) return running;
    running = (async () => {
      status.lastRefreshAt = new Date(now()).toISOString();
      try {
        Object.assign(status, await build(), { lastSuccessAt: status.lastRefreshAt, lastError: null });
        log(`guide refreshed: ${status.programmes} programmes, ${status.titled} matchups, ${status.iconed} with art, ${status.logos} channel logos`);
      } catch (error) {
        status.lastError = String(error.message).slice(0, 240);
        log(`guide refresh failed, serving the last good guide: ${status.lastError}`);
        // Its source (another module, Threadfin) may still be starting: try
        // again in a minute rather than waiting a whole refresh interval.
        if (timer && !retry && !fs.existsSync(guideFile)) {
          retry = setTimeout(() => { retry = null; refresh(); }, STARTUP_RETRY_MS);
          retry.unref();
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    id: ID,
    capabilities: () => ({ [ID]: { version: VERSION, enabled: true } }),

    // Jellyfin itself reads these, so they are authorized by the guide token in the URL.
    async handlePublic({ segments }) {
      const [token, ...rest] = segments;
      if (!sameToken(token, settings.token)) return { status: 404, body: { error: 'Not found' } };
      if (rest.length === 1 && rest[0] === 'guide.xml') {
        if (!fs.existsSync(guideFile)) return { status: 503, body: { error: 'guide_not_ready' } };
        return { status: 200, file: guideFile, contentType: 'application/xml; charset=utf-8' };
      }
      if (rest.length === 2 && rest[0] === 'art' && ART_FILE.test(rest[1])) {
        const file = path.join(artDir, rest[1]);
        if (!fs.existsSync(file)) return { status: 404, body: { error: 'Not found' } };
        return { status: 200, raw: fs.readFileSync(file), contentType: ART_TYPES[rest[1].split('.')[1]], cacheControl: 'public, max-age=604800' };
      }
      return { status: 404, body: { error: 'Not found' } };
    },

    async handle({ method, segments, viewer }) {
      if (!viewer.admin) return { status: 403, body: { error: 'admin_only' } };
      const route = `${method} ${segments.join('/')}`;
      if (route === 'GET status') {
        return {
          status: 200,
          body: { ...status, refreshing: Boolean(running), sources: { tvmaze: settings.tvmaze, sportsDb: Boolean(settings.sportsDbKey), channelLogos: settings.channelLogos } },
        };
      }
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

module.exports = { ID, createLiveTvGuide, settingsFrom };
