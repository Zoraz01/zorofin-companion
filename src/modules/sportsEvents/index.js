'use strict';

// sportsEvents: real fixtures for the leagues the operator turns on (league
// packs), matched to their event channels and, optionally, to the network
// channels that carry them. It writes guide listings the Zorofin apps and the
// web Home row already understand ("Live: NBA Basketball — Lakers at
// Celtics", flagged live), hides event slots with nothing on, and gives the
// apps a ready-made "Live now" list. Fixtures come from the league source, not
// the IPTV guide, so titles stay right when a provider's guide is down.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJsonFile, readSecret, requestJson, writePrivateJson } = require('../../lib/io');
const { lines, openText } = require('../../lib/http-stream');
const { decode, encode } = require('../liveTvGuide/xmltv');
const { readPlaylist, renderPlaylist } = require('../liveTvSource/m3u');
const { scanXmltv, stamp, xmltvTime } = require('../liveTvSource/guide');
const { CANCELLED, parseScoreboard, visible } = require('./fixtures');
const { createNetworkFinder } = require('./networks');
const { matchChannel, normalized, teamMatches } = require('./matching');
const { DEFAULT_LEAGUES, PACKS } = require('./packs');

const STARTUP_RETRY_MS = 60 * 1000;
const ID = 'sportsEvents';
const VERSION = 1;
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const SCHEDULE_KEEP_MS = 36 * HOUR;
const SPORT_TITLES = { football: 'Football', basketball: 'Basketball', soccer: 'Soccer', baseball: 'Baseball', hockey: 'Hockey' };

function list(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function pairs(value, name, errors) {
  const out = {};
  for (const item of list(value)) {
    const at = item.indexOf('=');
    if (at <= 0 || at === item.length - 1) { errors.push(`${name} entries look like "Name=Other name"`); continue; }
    out[normalized(item.slice(0, at))] = item.slice(at + 1).trim();
  }
  return out;
}

function settingsFrom(env) {
  const errors = [];
  const number = (key, fallback, min, max) => {
    const value = Number(env[key] === undefined || env[key] === '' ? fallback : env[key]);
    if (!Number.isFinite(value) || value < min || value > max) errors.push(`${key} must be ${min} to ${max}`);
    return value;
  };
  const leagues = list(env.ZOROFIN_SPORTS_LEAGUES || DEFAULT_LEAGUES.join(',')).map(item => item.toLowerCase());
  const unknown = leagues.filter(id => !Object.prototype.hasOwnProperty.call(PACKS, id));
  if (unknown.length) errors.push(`ZOROFIN_SPORTS_LEAGUES has unknown leagues: ${unknown.join(', ')} (known: ${Object.keys(PACKS).join(', ')})`);
  if (!leagues.length) errors.push('ZOROFIN_SPORTS_LEAGUES needs at least one league');
  const channelsUrl = readSecret(env, 'ZOROFIN_SPORTS_CHANNELS_URL');
  const guideUrl = readSecret(env, 'ZOROFIN_SPORTS_GUIDE_URL');
  for (const [key, value] of [['ZOROFIN_SPORTS_CHANNELS_URL', channelsUrl], ['ZOROFIN_SPORTS_GUIDE_URL', guideUrl]]) {
    if (!value) continue;
    let ok = false;
    try { ok = ['http:', 'https:'].includes(new URL(value).protocol); } catch (_) { ok = false; }
    if (!ok) errors.push(`${key} must be an http(s) address`);
  }
  if (guideUrl && !channelsUrl) errors.push('ZOROFIN_SPORTS_GUIDE_URL needs ZOROFIN_SPORTS_CHANNELS_URL too');
  const token = readSecret(env, 'ZOROFIN_SPORTS_TOKEN');
  if (channelsUrl && !/^[A-Za-z0-9_-]{32,128}$/.test(token)) errors.push('ZOROFIN_SPORTS_TOKEN must be 32-128 letters, digits, - or _ (try openssl rand -hex 24)');
  const timeZone = env.ZOROFIN_SPORTS_TIMEZONE || 'America/New_York';
  try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch (_) { errors.push('ZOROFIN_SPORTS_TIMEZONE must be a time zone such as America/New_York'); }
  const titleStyle = env.ZOROFIN_SPORTS_TITLE_STYLE || 'auto';
  if (!['auto', 'at', 'vs'].includes(titleStyle)) errors.push('ZOROFIN_SPORTS_TITLE_STYLE must be auto, at or vs');
  const order = env.ZOROFIN_SPORTS_ORDER || 'league';
  if (!['league', 'start', 'favorites'].includes(order)) errors.push('ZOROFIN_SPORTS_ORDER must be league, start or favorites');
  const settings = {
    leagues: leagues.filter(id => !unknown.includes(id)),
    channelsUrl, guideUrl, token, timeZone, titleStyle, order,
    eventGroups: list(env.ZOROFIN_SPORTS_EVENT_GROUPS),
    networks: pairs(env.ZOROFIN_SPORTS_NETWORKS, 'ZOROFIN_SPORTS_NETWORKS', errors),
    autoNetworks: env.ZOROFIN_SPORTS_AUTO_NETWORKS !== '0',
    aliases: Object.fromEntries(Object.entries(pairs(env.ZOROFIN_SPORTS_ALIASES, 'ZOROFIN_SPORTS_ALIASES', errors)).map(([key, value]) => [key, value])),
    favorites: list(env.ZOROFIN_SPORTS_FAVORITES),
    hideIdle: env.ZOROFIN_SPORTS_HIDE_IDLE !== '0',
    rename: env.ZOROFIN_SPORTS_RENAME !== '0',
    showScores: env.ZOROFIN_SPORTS_SHOW_SCORES === '1',
    pregameMs: number('ZOROFIN_SPORTS_PREGAME_MINUTES', 30, 0, 180) * MINUTE,
    postgameMs: number('ZOROFIN_SPORTS_POSTGAME_MINUTES', 15, 0, 180) * MINUTE,
    maxGames: number('ZOROFIN_SPORTS_MAX_GAMES', 20, 1, 100),
    refreshMs: number('ZOROFIN_SPORTS_REFRESH_MINUTES', 10, 5, 120) * MINUTE,
  };
  if (errors.length) throw new Error(errors.join('; '));
  return settings;
}

function guideIdOf(entry) {
  return entry.id || `zs.${crypto.createHash('sha1').update(entry.name).digest('hex').slice(0, 12)}`;
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

// The scoreboard's own dates are the US Eastern calendar day.
function easternDays(now) {
  const format = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)).replace(/-/g, '');
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(now)));
  const days = [format(now), format(now + 24 * HOUR)];
  if (hour < 5) days.unshift(format(now - 24 * HOUR)); // late games still running after midnight
  return days;
}

function createSportsEvents(config, deps = {}) {
  const settings = deps.settings || settingsFrom(deps.env || process.env);
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const open = deps.openText || openText;
  const fetchJson = deps.fetchJson || (async url => {
    const reply = await (deps.requestJson || requestJson)(url, { timeout: 15000, maxResponseBytes: 8 * 1024 * 1024 });
    if (reply.status !== 200 || !reply.body || typeof reply.body !== 'object') throw new Error(`HTTP ${reply.status}`);
    return reply.body;
  });
  const dir = path.join(config.dataDir, ID);
  const stateFile = path.join(dir, 'state.json');
  const playlistFile = path.join(dir, 'channels.m3u');
  const guideFile = path.join(dir, 'guide.xml');
  const packs = Object.fromEntries(settings.leagues.map(id => [id, PACKS[id]]));
  const status = { lastRefreshAt: null, lastSuccessAt: null, lastError: null, leagues: {}, games: 0, live: 0, channels: null };
  let games = [];
  let matches = new Map(); // game id -> [{ name, guideId }]
  let unmatched = [];
  let running = null;
  let timer = null;
  let retry = null; // soon after a failed start, while nothing has been served yet

  function styleFor(game) {
    return settings.titleStyle === 'auto' ? PACKS[game.pack].style : settings.titleStyle;
  }
  function matchup(game, short = false) {
    const home = short ? game.home.short : game.home.name;
    const away = short ? game.away.short : game.away.name;
    return styleFor(game) === 'at' ? `${away} at ${home}` : `${home} vs ${away}`;
  }
  function favorite(team) {
    return settings.favorites.some(name => teamMatches(name, team, { ...(PACKS[team.pack] || {}).aliases, ...settings.aliases }));
  }

  async function loadFixtures(state) {
    const schedules = state.schedules || (state.schedules = {});
    const days = easternDays(now());
    const found = [];
    let first = true;
    for (const id of settings.leagues) {
      const pack = PACKS[id];
      const leagueStatus = { ok: true, games: 0, lastError: null };
      for (const day of days) {
        const key = `${id}|${day}`;
        if (!first) await sleep(250);
        first = false;
        try {
          const url = `https://site.api.espn.com/apis/site/v2/sports/${pack.path}/scoreboard?dates=${day}${pack.query ? `&${pack.query}` : ''}`;
          schedules[key] = { at: now(), games: parseScoreboard(await fetchJson(url), id) };
        } catch (error) {
          leagueStatus.ok = false;
          leagueStatus.lastError = String(error.message || error).slice(0, 160);
        }
        if (schedules[key]) found.push(...schedules[key].games);
      }
      leagueStatus.games = found.filter(game => game.pack === id).length;
      status.leagues[id] = leagueStatus;
    }
    for (const [key, value] of Object.entries(schedules)) if (now() - value.at > SCHEDULE_KEEP_MS) delete schedules[key];
    const unique = new Map(found.map(game => [game.id, game]));
    return [...unique.values()];
  }

  function window(game, ended) {
    const pack = PACKS[game.pack];
    const live = game.state === 'in';
    const start = live && game.start <= now() ? game.start : game.start - settings.pregameMs;
    let stop = Math.max(game.start + pack.minutes * MINUTE, live ? now() + 30 * MINUTE : 0);
    if (ended !== undefined) stop = ended + settings.postgameMs;
    return { start, stop: Math.max(stop, start + 30 * MINUTE) };
  }

  function programme(guideId, game, ended) {
    const pack = PACKS[game.pack];
    const live = game.state === 'in';
    const { start, stop } = window(game, ended);
    const teams = matchup(game);
    const title = `${live ? 'Live: ' : ''}${pack.title} — ${teams}`;
    const desc = [teams, game.round, game.venue].filter(Boolean).join(' · ');
    const categories = ['Sports', SPORT_TITLES[pack.sport], pack.label].filter(Boolean);
    return {
      start, stop,
      block: `<programme channel="${encode(guideId)}" start="${stamp(start)}" stop="${stamp(stop)}"><title lang="en">${encode(title)}</title><desc lang="en">${encode(desc)}</desc>${categories.map(c => `<category lang="en">${encode(c)}</category>`).join('')}${live ? '<live />' : ''}</programme>`,
    };
  }

  async function buildChannels(state, current) {
    const { kept } = await readPlaylist(lines(await open(settings.channelsUrl, { timeout: 120000 })), entry => Boolean(entry.url && entry.name));
    if (!kept.length) throw new Error('the channel list is empty');
    const ended = state.ended || {};
    const shown = current.filter(game => visible(game, now(), { ...settings, endedAt: ended[game.id] }));
    const nextMatches = new Map();
    const programmes = new Map(); // guideId -> [entries]
    const managed = new Set();
    const slots = new Map(); // network channel guideId -> windows
    const output = [];
    const idle = [];
    let events = 0;
    for (const entry of kept) {
      const guideId = guideIdOf(entry);
      const candidate = settings.eventGroups.length ? inGroups(entry.group, settings.eventGroups) : false;
      const game = matchChannel(entry, current, packs, { now: now(), timeZone: settings.timeZone, extraAliases: settings.aliases });
      const isEvent = candidate || Boolean(game);
      if (!isEvent) { output.push({ ...entry, guideId }); continue; }
      events += 1;
      managed.add(guideId);
      if (game && shown.includes(game)) {
        (nextMatches.get(game.id) || nextMatches.set(game.id, []).get(game.id)).push({ name: entry.name, guideId });
        programmes.set(guideId, [programme(guideId, game, ended[game.id])]);
        output.push({ ...entry, guideId, name: settings.rename ? `${PACKS[game.pack].label} — ${matchup(game, true)}` : entry.name });
      } else {
        if (!game) idle.push(entry.name);
        if (!settings.hideIdle) output.push({ ...entry, guideId });
      }
    }

    // Network channels: only the broadcasters the operator mapped, and never
    // two games in one slot.
    const byName = new Map(kept.map(entry => [normalized(entry.name), entry]));
    // Channels not already used as event slots can carry network games.
    const findNetwork = settings.autoNetworks ? createNetworkFinder(kept.filter(entry => !managed.has(guideIdOf(entry)))) : () => null;
    for (const game of current) {
      if (game.completed || CANCELLED.test(game.status)) continue;
      for (const broadcaster of game.broadcasts) {
        const target = settings.networks[normalized(broadcaster)];
        const entry = target ? byName.get(normalized(target)) : findNetwork(broadcaster);
        if (!entry) continue;
        const guideId = guideIdOf(entry);
        const slot = programme(guideId, game, ended[game.id]);
        const taken = slots.get(guideId) || [];
        const clash = taken.find(other => other.start < slot.stop && slot.start < other.stop);
        if (clash) { clash.clash = true; continue; }
          taken.push({ ...slot, game, entry });
        slots.set(guideId, taken);
      }
    }
    for (const [guideId, taken] of slots) {
      const good = taken.filter(slot => !slot.clash);
      if (!good.length || managed.has(guideId)) continue;
      programmes.set(guideId, good);
      for (const slot of good) {
        if (shown.includes(slot.game)) (nextMatches.get(slot.game.id) || nextMatches.set(slot.game.id, []).get(slot.game.id)).push({ name: slot.entry.name, guideId, network: true });
      }
    }

    // The guide: the operator's guide with our listings in place of theirs
    // on the channels we manage (event slots) or fill (network game windows).
    const channelLines = [];
    const programmeLines = [];
    const written = new Set();
    if (settings.guideUrl) {
      await scanXmltv(await open(settings.guideUrl, { timeout: 300000 }), (kind, block) => {
        const openTag = /^<[a-z]+\b[^>]*>/.exec(block)[0];
        if (kind === 'channel') {
          const id = decode((/\bid="([^"]*)"/.exec(openTag) || [])[1] || '');
          if (written.has(id)) return;
          written.add(id);
          channelLines.push(`  ${block}`);
          return;
        }
        const channel = decode((/\bchannel="([^"]*)"/.exec(openTag) || [])[1] || '');
        if (managed.has(channel)) return;
        const ours = programmes.get(channel);
        if (ours) {
          const start = xmltvTime((/\bstart="([^"]*)"/.exec(openTag) || [])[1]);
          const stop = xmltvTime((/\bstop="([^"]*)"/.exec(openTag) || [])[1]);
          if (ours.some(slot => slot.start < stop && start < slot.stop)) return;
        }
        programmeLines.push(`  ${block}`);
      });
    }
    // Channels come first in XMLTV; add ours that the guide didn't have.
    for (const channel of output) {
      if (!programmes.has(channel.guideId) || written.has(channel.guideId)) continue;
      written.add(channel.guideId);
      channelLines.push(`  <channel id="${encode(channel.guideId)}"><display-name>${encode(channel.name)}</display-name></channel>`);
    }
    const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="Zorofin companion sports">', ...channelLines, ...programmeLines];
    for (const [, entries] of programmes) for (const entry of entries) out.push(`  ${entry.block}`);
    out.push('</tv>');

    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const [file, text] of [[playlistFile, renderPlaylist(output)], [guideFile, `${out.join('\n')}\n`]]) {
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, text, { mode: 0o600 });
      fs.renameSync(temporary, file);
    }
    matches = nextMatches;
    unmatched = idle.slice(0, 50);
    return { listed: output.length, eventSlots: events, matched: [...nextMatches.values()].reduce((sum, items) => sum + items.length, 0) };
  }

  async function build() {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const state = readJsonFile(stateFile, null) || {};
    const current = await loadFixtures(state);
    // No schedule at all (the schedule service is down or blocked): still pass the
    // channel list and guide through unchanged, so Jellyfin never loses its channels.
    const noSchedule = !current.length && Object.values(status.leagues).every(league => !league.ok);
    if (noSchedule) log('sports: no league schedule could be read; passing channels through unchanged');
    const ended = state.ended || (state.ended = {});
    for (const game of current) if ((game.completed || game.state === 'post') && ended[game.id] === undefined) ended[game.id] = now();
    for (const id of Object.keys(ended)) if (!current.some(game => game.id === id)) delete ended[id];
    games = current;
    const result = { games: current.length, live: current.filter(game => game.state === 'in').length };
    if (settings.channelsUrl) {
      try { result.channels = await buildChannels(state, current); }
      catch (error) {
        result.channels = { error: String(error.message || error).slice(0, 200) };
        log(`sports: channel update failed, serving the last good copy: ${result.channels.error}`);
      }
    }
    writePrivateJson(stateFile, state);
    if (noSchedule) throw new Error('no league schedule could be read');
    return result;
  }

  function refresh() {
    if (running) return running;
    running = (async () => {
      status.lastRefreshAt = new Date(now()).toISOString();
      try {
        Object.assign(status, await build(), { lastSuccessAt: status.lastRefreshAt, lastError: null });
      } catch (error) {
        status.lastError = String(error.message || error).slice(0, 240);
        log(`sports refresh failed: ${status.lastError}`);
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

  function gameView(game, ended) {
    const pack = PACKS[game.pack];
    const side = team => ({
      name: team.name, short: team.short, abbreviation: team.abbreviation, color: team.color,
      favorite: favorite({ ...team, pack: game.pack }),
    });
    return {
      id: game.id,
      league: game.pack,
      leagueName: pack.label,
      competition: pack.title,
      sport: pack.sport,
      title: matchup(game),
      start: new Date(game.start).toISOString(),
      state: game.state,
      live: game.state === 'in',
      detail: settings.showScores || game.state !== 'in' ? game.detail : '',
      round: game.round,
      ...(settings.showScores && game.state !== 'pre' ? { score: game.score } : {}),
      home: side(game.home),
      away: side(game.away),
      broadcasts: game.broadcasts,
      channels: matches.get(game.id) || [],
      ended: ended !== undefined,
    };
  }

  function liveNow(all) {
    const state = readJsonFile(stateFile, {}) || {};
    const ended = state.ended || {};
    const rank = id => settings.leagues.indexOf(id);
    const pool = all
      ? games.filter(game => game.start - now() < 24 * HOUR && !CANCELLED.test(game.status) && !(game.completed && now() - (ended[game.id] ?? now()) > settings.postgameMs))
      : games.filter(game => visible(game, now(), { ...settings, endedAt: ended[game.id] }));
    const views = pool.map(game => gameView(game, ended[game.id]));
    views.sort((a, b) => {
      const favA = a.home.favorite || a.away.favorite;
      const favB = b.home.favorite || b.away.favorite;
      if (settings.order === 'favorites' && favA !== favB) return favA ? -1 : 1;
      if (a.live !== b.live) return a.live ? -1 : 1;
      if (settings.order !== 'start' && rank(a.league) !== rank(b.league)) return rank(a.league) - rank(b.league);
      if (favA !== favB) return favA ? -1 : 1;
      return Date.parse(a.start) - Date.parse(b.start);
    });
    return views.slice(0, settings.maxGames);
  }

  function serveFile(file, contentType) {
    if (!fs.existsSync(file)) return { status: 503, body: { error: 'not_ready' } };
    return { status: 200, file, contentType };
  }

  return {
    id: ID,
    capabilities: () => ({ [ID]: { version: VERSION, enabled: true } }),

    async handlePublic({ segments }) {
      const [token, file, ...rest] = segments;
      if (!settings.channelsUrl || rest.length || !sameToken(token, settings.token)) return { status: 404, body: { error: 'Not found' } };
      if (file === 'channels.m3u') return serveFile(playlistFile, 'audio/x-mpegurl; charset=utf-8');
      if (file === 'guide.xml') return serveFile(guideFile, 'application/xml; charset=utf-8');
      return { status: 404, body: { error: 'Not found' } };
    },

    async handle({ method, segments, query, viewer }) {
      const route = `${method} ${segments.join('/')}`;
      // Any signed-in viewer: the games on now (or today, with ?window=today).
      if (route === 'GET live') {
        // leagues: ESPN paths of the leagues this server follows, so a client can
        // tell a game left out by the settings from one this feed can't know.
        const leagues = settings.leagues.map(id => PACKS[id] && PACKS[id].path).filter(Boolean);
        return { status: 200, body: { games: liveNow(query && query.get('window') === 'today'), updatedAt: status.lastSuccessAt, spoilerFree: !settings.showScores, leagues, maxGames: settings.maxGames, order: settings.order } };
      }
      if (!viewer.admin) return { status: 403, body: { error: 'admin_only' } };
      if (route === 'GET status') return { status: 200, body: { ...status, refreshing: Boolean(running), leaguesOn: settings.leagues } };
      if (route === 'GET preview') {
        const state = readJsonFile(stateFile, {}) || {};
        const today = games.filter(game => Math.abs(game.start - now()) < 18 * HOUR).sort((a, b) => a.start - b.start);
        return {
          status: 200,
          body: {
            leagues: settings.leagues.map(id => ({
              id, name: PACKS[id].label, ...status.leagues[id],
              games: today.filter(game => game.pack === id).map(game => ({
                ...gameView(game, (state.ended || {})[game.id]),
                guideTitle: `${PACKS[id].title} — ${matchup(game)}`,
              })),
            })),
            unmatchedEventChannels: unmatched,
          },
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

module.exports = { ID, createSportsEvents, settingsFrom };
