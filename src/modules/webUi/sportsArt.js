'use strict';

// Sports artwork for the Home sports row: today's and the next two days'
// fixtures for the leagues the apps know, with an event photo or the two team
// crests for each. Writes the same events.json catalogue the reference server serves,
// so the web look's sports row works the same here. Ported from
// tools/live_tv_artwork.py.
//
// It runs on the operator's own server and only when they turn it on. Fixtures
// and crests come from ESPN's public scoreboard; event photos from TheSportsDB
// (its free public key unless the operator gives their own). Zorofin ships no
// team or broadcaster art. When it is off or a download fails, the row uses the
// guide's own image or its built-in sport illustrations.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJsonFile, writePrivateJson } = require('../../lib/io');
const { inspectImage } = require('./images');

const LEAGUES = {
  'football/nfl': { sport: 'football', tsdb: '4391' },
  'basketball/nba': { sport: 'basketball', tsdb: '4387' },
  'soccer/eng.1': { sport: 'soccer', tsdb: '4328' },
  'soccer/eng.2': { sport: 'soccer', tsdb: '4329' },
  'soccer/uefa.champions': { sport: 'soccer', tsdb: '4480' },
  // Crests only until the photo provider's league id is verified.
  'soccer/eng.w.1': { sport: 'soccer', tsdb: null },
  'soccer/ita.1': { sport: 'soccer', tsdb: null },
  'soccer/fra.1': { sport: 'soccer', tsdb: null },
  'soccer/uefa.europa': { sport: 'soccer', tsdb: null },
  'soccer/uefa.europa.conf': { sport: 'soccer', tsdb: null },
  'baseball/mlb': { sport: 'baseball', tsdb: null },
  'hockey/nhl': { sport: 'hockey', tsdb: null },
};
const LEAGUE_ORDER = Object.keys(LEAGUES);
// Explicit, league-scoped name differences between the two providers. Never fuzzy.
const ALIASES = {
  'soccer/eng.1': { 'afc bournemouth': 'bournemouth', 'brighton and hove albion': 'brighton', 'brighton hove albion': 'brighton' },
  'soccer/eng.w.1': { tottenham: 'tottenham hotspur' },
  'basketball/nba': { 'la clippers': 'los angeles clippers' },
  'soccer/uefa.champions': { internazionale: 'inter milan', inter: 'inter milan', 'slavia praha': 'slavia prague', 'sporting lisbon': 'sporting cp' },
  'soccer/uefa.europa': { 'union saint gilloise': 'union st gilloise', 'hapoel beer sheva': 'hapoel be er', 'sparta praha': 'sparta prague', celje: 'nk celje' },
  'soccer/uefa.europa.conf': {
    craiova: 'csu craiova', 'crvena zvezda': 'red star belgrade', 'agf aarhus': 'agf', 'inter escaldes': 'inter d escaldes',
    'fk borac': 'borac banja luka', copenhagen: 'f c kobenhavn', brann: 'sk brann', 'l red imps': 'lincoln red imps',
    'k sint truidense': 'sint truidense', 'fc iberia tbilisi': 'iberia 1999',
  },
};
const GENERIC = new Set(['united', 'city', 'north', 'south', 'east', 'west', 'miami', 'new york', 'los angeles']);
const API_HOSTS = new Set(['site.api.espn.com', 'www.thesportsdb.com']);
const IMAGE_HOSTS = new Set(['a.espncdn.com', 'r2.thesportsdb.com', 'www.thesportsdb.com']);
const PUBLIC_FILE = /^(?:events\.json|sports-[a-f0-9]{24}-[a-f0-9]{8}\.(?:png|jpg))$/;
const MAX_JSON_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 5_000_000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const FREE_SPORTSDB_KEY = '123'; // TheSportsDB's published free key.

function normalized(value) {
  return String(value || '').toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ł/g, 'l')
    .normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function canonical(value, league) {
  const name = normalized(value);
  const aliases = ALIASES[league] || {};
  return Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : name;
}

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function hash(text, length) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, length);
}

function allowed(url, hosts) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && hosts.has(parsed.hostname) && !parsed.username && !parsed.password && (parsed.port === '' || parsed.port === '443');
  } catch (_) {
    return false;
  }
}

class FetchError extends Error {}

function teamRecord(team, league) {
  const name = String(team.displayName || '');
  const aliases = new Set([name, team.shortDisplayName, team.name].filter(Boolean).map(normalized)
    .filter(alias => alias.length >= 4 && !GENERIC.has(alias)));
  aliases.add(normalized(name));
  for (const [alias, target] of Object.entries(ALIASES[league] || {})) {
    if (canonical(name, league) === target) { aliases.add(alias); aliases.add(target); }
  }
  return { id: String(team.id || ''), name, aliases: [...aliases].sort(), logo_url: String(team.logo || '') };
}

function parseScoreboard(data, league) {
  const fixtures = [];
  for (const event of (data && Array.isArray(data.events) ? data.events : [])) {
    try {
      const sides = {};
      for (const competitor of event.competitions[0].competitors) sides[competitor.homeAway] = competitor.team;
      const home = teamRecord(sides.home, league);
      const away = teamRecord(sides.away, league);
      const start = Date.parse(event.date);
      if (!Number.isFinite(start) || !home.id || !away.id || home.id === away.id || !home.name || !away.name) continue;
      fixtures.push({ key: `${league}:${event.id}`, id: String(event.id), league, sport: LEAGUES[league].sport, start: iso(start), home, away });
    } catch (_) { /* skip a malformed fixture */ }
  }
  return fixtures;
}

function fixtureIdentity(fixture) {
  const parts = [fixture.league, fixture.start];
  for (const side of ['home', 'away']) parts.push(fixture[side].id, normalized(fixture[side].name));
  return hash(JSON.stringify(parts), 64);
}

function verifiedEvent(fixture, event) {
  const { league } = fixture;
  if (String(event.idLeague || '') !== LEAGUES[league].tsdb) return false;
  const want = new Set(['home', 'away'].map(side => canonical(fixture[side].name, league)));
  const got = new Set([canonical(event.strHomeTeam, league), canonical(event.strAwayTeam, league)]);
  if (want.size !== 2 || got.size !== 2 || [...want].some(name => !got.has(name))) return false;
  return event.dateEvent === fixture.start.slice(0, 10);
}

function day(ms, offset) {
  const date = new Date(ms + offset * DAY);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function createSportsArt({ dir, fetcher, now = Date.now, sleep, log = () => {}, sportsDbKey = '', maxBytes = 200 * 1024 * 1024 }) {
  const artDir = path.join(dir, 'art');
  const stateFile = path.join(dir, 'state.json');
  const wait = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const key = /^[A-Za-z0-9]{1,64}$/.test(sportsDbKey || '') ? sportsDbKey : FREE_SPORTSDB_KEY;
  const status = { lastRunAt: null, lastError: null, events: 0, coverage: {}, files: 0, bytes: 0, running: false };
  let running = null;

  // One request at a time, spaced per provider, inside an overall time budget.
  function client(seconds = 150) {
    const deadline = now() + seconds * 1000;
    const last = {};
    const calls = {};
    async function get(url, hosts, limit) {
      if (!allowed(url, hosts)) throw new FetchError('unsafe_url');
      const bucket = new URL(url).hostname.includes('thesportsdb.com') ? 'tsdb' : 'espn';
      const delay = Math.max(0, (bucket === 'tsdb' ? 2500 : 600) - (now() - (last[bucket] || 0)));
      if (now() + delay + 8000 > deadline) throw new FetchError('time_budget');
      if (delay && last[bucket]) await wait(delay);
      last[bucket] = now();
      calls[bucket] = (calls[bucket] || 0) + 1;
      let response;
      try { response = await fetcher(url, { maxBytes: limit, timeout: 8000, headers: { Accept: '*/*' } }); }
      catch (error) { throw new FetchError(/too large/.test(error.message) ? 'oversize' : 'network_error'); }
      if (response.status === 429) throw new FetchError('rate_limited');
      if (response.status !== 200) throw new FetchError(`http_${response.status}`);
      return response.body;
    }
    return {
      calls,
      async json(url) {
        const body = await get(url, API_HOSTS, MAX_JSON_BYTES);
        try {
          const value = JSON.parse(body.toString('utf8'));
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          return value;
        } catch (_) { throw new FetchError('invalid_json'); }
      },
      image: url => get(url, IMAGE_HOSTS, MAX_IMAGE_BYTES),
    };
  }

  function servedPath(name) { return `/live-tv-logos/art/${name}`; }
  function fileOf(served) {
    const name = typeof served === 'string' ? served.split('/').pop() : '';
    if (!PUBLIC_FILE.test(name) || name === 'events.json' || served !== servedPath(name)) return null;
    try {
      const file = path.join(artDir, name);
      const st = fs.lstatSync(file);
      return st.isFile() && st.size > 0 ? file : null;
    } catch (_) { return null; }
  }

  async function prepareSchedules(state, http, at, budget = 16) {
    const schedules = state.schedules || (state.schedules = {});
    const wanted = [];
    for (const offset of [-1, 0, 1, 2]) for (const league of LEAGUE_ORDER) wanted.push([league, day(at, offset)]);
    // Least recently attempted first, so an empty or failing day can't starve the rest.
    const due = [...wanted].sort((a, b) => ((schedules[a.join('|')] || {}).attempted || 0) - ((schedules[b.join('|')] || {}).attempted || 0));
    for (const [league, date] of due) {
      const id = `${league}|${date}`;
      const record = schedules[id] || {};
      if ((record.next_attempt || 0) > at || budget <= 0) continue;
      budget -= 1;
      record.attempted = at;
      try {
        const data = await http.json(`https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard?dates=${date}`);
        record.fixtures = parseScoreboard(data, league);
        record.fetched = at;
        record.result = 'ok';
        record.next_attempt = at + (record.fixtures.length ? 6 * HOUR : HOUR);
      } catch (error) {
        if (!(error instanceof FetchError)) throw error;
        record.result = error.message;
        record.next_attempt = at + 15 * 60 * 1000;
      }
      schedules[id] = record;
    }
    const keep = new Set(wanted.map(pair => pair.join('|')));
    for (const id of Object.keys(schedules)) if (!keep.has(id)) delete schedules[id];
    const fixtures = new Map();
    for (const record of Object.values(schedules)) {
      if (at - (record.fetched || 0) > DAY) continue; // a stale day can bridge a short outage, not a long one
      for (const fixture of record.fixtures || []) {
        const start = Date.parse(fixture.start);
        if (start >= at - 6 * HOUR && start <= at + 48 * HOUR) fixtures.set(fixture.key, fixture);
      }
    }
    return [...fixtures.values()];
  }

  async function mirror(url, http, assets, at, budget, { logo }) {
    if (!url) throw new FetchError('missing_image_url');
    if (!allowed(url, IMAGE_HOSTS)) throw new FetchError('unsafe_image_url');
    const digest = hash(url, 24);
    const previous = assets[digest] || {};
    if (previous.path && at - (previous.fetched || 0) < 30 * DAY && fileOf(previous.path)) return previous;
    if ((previous.next_attempt || 0) > at) throw new FetchError('image_backoff');
    if (budget.images <= 0) throw new FetchError('image_budget');
    if (budget.bytes <= 0) throw new FetchError('disk_cap');
    budget.images -= 1;
    try {
      const image = inspectImage(await http.image(url));
      if (!image) throw new FetchError('invalid_image');
      if (image.width < 32 || image.height < 32) throw new FetchError('tiny_image');
      if (logo ? image.width > 2048 || image.height > 2048 : image.width > 1920 || image.height > 1080) throw new FetchError('oversize_image');
      const name = `sports-${digest}-${hash(image.body, 8)}.${image.type}`;
      fs.mkdirSync(artDir, { recursive: true });
      const temporary = path.join(artDir, `.${name}.${process.pid}.tmp`);
      fs.writeFileSync(temporary, image.body, { mode: 0o644 });
      fs.renameSync(temporary, path.join(artDir, name));
      budget.bytes -= image.body.length;
      const record = { path: servedPath(name), source: url, fetched: at, width: image.width, height: image.height, bytes: image.body.length };
      assets[digest] = record;
      return record;
    } catch (error) {
      if (!(error instanceof FetchError)) throw error;
      assets[digest] = { next_attempt: at + HOUR, result: error.message };
      throw error;
    }
  }

  async function lookup(fixture, http) {
    const { league } = fixture;
    if (!LEAGUES[league].tsdb) return { reason: 'crests_only' };
    const home = canonical(fixture.home.name, league);
    const away = canonical(fixture.away.name, league);
    let mismatch = false;
    for (const [a, b] of [[home, away], [away, home]]) {
      const query = new URLSearchParams({ e: `${a} vs ${b}`, d: fixture.start.slice(0, 10) });
      const data = await http.json(`https://www.thesportsdb.com/api/v1/json/${key}/searchevents.php?${query}`);
      for (const event of Array.isArray(data.event) ? data.event : []) {
        if (!event || typeof event !== 'object') continue;
        if (!verifiedEvent(fixture, event)) { mismatch = true; continue; }
        // Only the dated event thumbnail: no posters, banners or undated cards.
        if (event.strThumb) return { event, reason: 'event_image' };
      }
    }
    return { reason: mismatch ? 'identity_mismatch' : 'no_event_image' };
  }

  async function fillArtwork(fixtures, state, http, at, budget, lookupBudget = 6) {
    const entries = state.entries || (state.entries = {});
    const assets = state.assets || (state.assets = {});
    const start = fixture => Date.parse(fixture.start);
    // Never-tried events first, then games starting soon, then league order.
    const queue = [...fixtures].sort((a, b) =>
      ((entries[a.key] || {}).attempted || 0) - ((entries[b.key] || {}).attempted || 0)
      || (Math.abs(start(a) - at) <= 4 * HOUR ? 0 : 1) - (Math.abs(start(b) - at) <= 4 * HOUR ? 0 : 1)
      || Math.abs(start(a) - at) - Math.abs(start(b) - at)
      || LEAGUE_ORDER.indexOf(a.league) - LEAGUE_ORDER.indexOf(b.league));
    for (const fixture of queue) {
      let entry = entries[fixture.key] || (entries[fixture.key] = {});
      const identity = fixtureIdentity(fixture);
      if (entry.identity !== identity) {
        // Ids can be reused when the kickoff or teams change.
        entry = entries[fixture.key] = { identity, fixture_start: fixture.start };
      }
      if (entry.image && !fileOf(entry.image)) { delete entry.image; entry.next_attempt = 0; }
      if (entry.image && entry.fixture_start === fixture.start) continue;
      if ((entry.next_attempt || 0) > at || lookupBudget <= 0) continue;
      lookupBudget -= 1;
      entry.attempted = at;
      entry.fixture_start = fixture.start;
      try {
        const found = await lookup(fixture, http);
        if (found.event) {
          const info = await mirror(found.event.strThumb, http, assets, at, budget, { logo: false });
          if (info.width < 320 || info.width / info.height < 1.2 || info.width / info.height > 2.4) throw new FetchError('wrong_aspect_ratio');
          Object.assign(entry, { image: info.path, result: 'event_image', event_date: found.event.dateEvent, failures: 0 });
          continue;
        }
        entry.result = found.reason;
      } catch (error) {
        if (!(error instanceof FetchError)) throw error;
        entry.result = error.message;
      }
      entry.failures = (entry.failures || 0) + 1;
      entry.next_attempt = at + Math.min(DAY, HOUR * 2 ** Math.min(entry.failures - 1, 5));
    }
    // Crests get their own fair pass, so a missing crest can't hold up event photos.
    const crests = [...fixtures].sort((a, b) =>
      ((entries[a.key] || {}).logo_attempted || 0) - ((entries[b.key] || {}).logo_attempted || 0)
      || Math.abs(start(a) - at) - Math.abs(start(b) - at));
    for (const fixture of crests) {
      const entry = entries[fixture.key] || (entries[fixture.key] = { identity: fixtureIdentity(fixture), fixture_start: fixture.start });
      if (entry.image || (Array.isArray(entry.logos) && entry.logos.length === 2 && entry.logos.every(fileOf))) continue;
      if (budget.images <= 0) break;
      entry.logo_attempted = at;
      try {
        const logos = [];
        for (const side of ['away', 'home']) logos.push((await mirror(fixture[side].logo_url, http, assets, at, budget, { logo: true })).path);
        entry.logos = logos;
        entry.logo_result = 'team_logos';
      } catch (error) {
        if (!(error instanceof FetchError)) throw error;
        entry.logo_result = error.message;
      }
    }
  }

  function buildCatalogue(fixtures, state, at) {
    const events = [];
    const coverage = {};
    for (const fixture of [...fixtures].sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key))) {
      let entry = (state.entries || {})[fixture.key] || {};
      if (entry.identity !== fixtureIdentity(fixture)) entry = {};
      const image = entry.fixture_start === fixture.start && fileOf(entry.image) ? entry.image : '';
      const logos = Array.isArray(entry.logos) && entry.logos.length === 2 && entry.logos.every(fileOf) ? entry.logos : [];
      const kind = image ? 'event_image' : logos.length ? 'team_logos' : 'sport_graphic';
      coverage[kind] = (coverage[kind] || 0) + 1;
      const side = team => ({ id: team.id, name: team.name, aliases: team.aliases });
      events.push({ id: fixture.id, league: fixture.league, sport: fixture.sport, start: fixture.start, away: side(fixture.away), home: side(fixture.home), kind, image, logos });
    }
    return { catalogue: { version: 2, generatedAt: iso(at), events }, coverage };
  }

  // Removes downloads nothing points at once they are two days old, then the
  // oldest unused ones while the folder is over its size limit.
  function prune(catalogue, at) {
    const used = new Set(['events.json']);
    for (const event of catalogue.events) for (const served of [event.image, ...event.logos]) if (served) used.add(served.split('/').pop());
    let files = [];
    try { files = fs.readdirSync(artDir).map(name => ({ name, st: fs.lstatSync(path.join(artDir, name)) })).filter(file => file.st.isFile()); }
    catch (_) { return { files: 0, bytes: 0 }; }
    const remove = file => { try { fs.unlinkSync(path.join(artDir, file.name)); } catch (_) { /* already gone */ } };
    files = files.filter(file => {
      const stray = !PUBLIC_FILE.test(file.name) && at - file.st.mtimeMs > HOUR; // abandoned temp files
      const old = PUBLIC_FILE.test(file.name) && !used.has(file.name) && at - file.st.mtimeMs > 2 * DAY;
      if (stray || old) { remove(file); return false; }
      return true;
    });
    let bytes = files.reduce((sum, file) => sum + file.st.size, 0);
    for (const file of files.filter(item => !used.has(item.name)).sort((a, b) => a.st.mtimeMs - b.st.mtimeMs)) {
      if (bytes <= maxBytes) break;
      remove(file);
      bytes -= file.st.size;
      files = files.filter(item => item !== file);
    }
    return { files: files.length, bytes };
  }

  function folderBytes() {
    try {
      return fs.readdirSync(artDir).reduce((sum, name) => {
        const st = fs.lstatSync(path.join(artDir, name));
        return st.isFile() ? sum + st.size : sum;
      }, 0);
    } catch (_) { return 0; }
  }

  function writeCatalogue(catalogue) {
    fs.mkdirSync(artDir, { recursive: true });
    const file = path.join(artDir, 'events.json');
    const body = `${JSON.stringify(catalogue)}\n`;
    const temporary = path.join(artDir, `.events.json.${process.pid}.tmp`);
    fs.writeFileSync(temporary, body, { mode: 0o644 });
    fs.renameSync(temporary, file);
  }

  async function run({ force = false, fixtures: given } = {}) {
    const at = now();
    const state = readJsonFile(stateFile, null) || {};
    if (!force && !given && at - (state.last_run || 0) < MIN_INTERVAL_MS && fs.existsSync(path.join(artDir, 'events.json'))) return { result: 'recent_run' };
    const http = client();
    const fixtures = given || await prepareSchedules(state, http, at);
    const budget = { images: 32, bytes: Math.max(0, maxBytes - folderBytes()) };
    await fillArtwork(fixtures, state, http, at, budget);
    const { catalogue, coverage } = buildCatalogue(fixtures, state, at);
    const keys = new Set(fixtures.map(fixture => fixture.key));
    for (const id of Object.keys(state.entries || {})) if (!keys.has(id)) delete state.entries[id];
    for (const [digest, asset] of Object.entries(state.assets || {})) {
      if (asset.path ? !fileOf(asset.path) : at - (asset.next_attempt || 0) > DAY) delete state.assets[digest];
    }
    state.last_run = at;
    writeCatalogue(catalogue);
    const disk = prune(catalogue, at);
    state.metrics = { at: iso(at), fixtures: fixtures.length, coverage, requests: http.calls, ...disk };
    writePrivateJson(stateFile, state);
    return state.metrics;
  }

  function refresh(options) {
    if (running) return running;
    status.running = true;
    running = (async () => {
      try {
        const metrics = await run(options);
        if (metrics.result !== 'recent_run') {
          Object.assign(status, { lastRunAt: metrics.at, lastError: null, events: metrics.fixtures, coverage: metrics.coverage, files: metrics.files, bytes: metrics.bytes });
          log(`sports artwork: ${metrics.fixtures} games, ${metrics.coverage.event_image || 0} photos, ${metrics.coverage.team_logos || 0} crest pairs`);
        }
        return metrics;
      } catch (error) {
        status.lastError = String(error.message).slice(0, 240);
        log(`sports artwork refresh failed, keeping the last catalogue: ${status.lastError}`);
        return { result: 'failed' };
      } finally {
        running = null;
        status.running = false;
      }
    })();
    return running;
  }

  // The file for a public name, or null.
  function file(name) {
    if (!PUBLIC_FILE.test(name)) return null;
    if (name === 'events.json') {
      const target = path.join(artDir, name);
      return fs.existsSync(target) ? target : null;
    }
    return fileOf(servedPath(name));
  }

  // Picks up the last run's numbers after a restart.
  const saved = readJsonFile(stateFile, null);
  if (saved && saved.metrics) Object.assign(status, { lastRunAt: saved.metrics.at, events: saved.metrics.fixtures, coverage: saved.metrics.coverage || {}, files: saved.metrics.files || 0, bytes: saved.metrics.bytes || 0 });

  return { refresh, file, status };
}

module.exports = { LEAGUES, PUBLIC_FILE, createSportsArt, normalized, parseScoreboard, verifiedEvent };
