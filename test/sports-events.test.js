'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSportsEvents, settingsFrom } = require('../src/modules/sportsEvents');
const { timeFromName, teamMatches } = require('../src/modules/sportsEvents/matching');
const { parseScoreboard } = require('../src/modules/sportsEvents/fixtures');
const { PACKS } = require('../src/modules/sportsEvents/packs');
const { SECTIONS } = require('../src/settings/schemas');

const NOW = Date.UTC(2026, 10, 7, 0, 10); // Fri Nov 6 2026, 7:10 PM Eastern
const TOKEN = 'c'.repeat(40);
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const team = (id, displayName, short, abbreviation, location, color) => ({ id, displayName, shortDisplayName: short, name: short, abbreviation, location, color });

function event(id, start, home, away, state, extra = {}) {
  return {
    id, date: iso(start),
    status: { type: { state, name: extra.status || (state === 'in' ? 'STATUS_IN_PROGRESS' : state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED'), completed: state === 'post', shortDetail: extra.detail || '' } },
    competitions: [{
      competitors: [{ homeAway: 'home', score: '54', team: home }, { homeAway: 'away', score: '50', team: away }],
      broadcasts: (extra.broadcasts || []).map(name => ({ market: 'national', names: [name] })),
      venue: { fullName: extra.venue || '' },
    }],
  };
}

const CELTICS = team('2', 'Boston Celtics', 'Celtics', 'BOS', 'Boston', '007a33');
const LAKERS = team('13', 'Los Angeles Lakers', 'Lakers', 'LAL', 'Los Angeles', '552583');
const KNICKS = team('18', 'New York Knicks', 'Knicks', 'NY', 'New York', '1d428a');
const CLIPPERS = team('12', 'LA Clippers', 'Clippers', 'LAC', 'LA', 'c8102e');
const SCOREBOARDS = {
  'basketball/nba|20261106': { events: [
    event('401', Date.UTC(2026, 10, 7, 0, 30), CELTICS, LAKERS, 'pre', { broadcasts: ['ESPN'], venue: 'TD Garden', detail: '7:30 PM ET' }),
    event('402', Date.UTC(2026, 10, 7, 0, 0), KNICKS, CLIPPERS, 'in', { detail: '1st 4:12' }),
    event('403', Date.UTC(2026, 10, 7, 1, 0), team('5', 'Chicago Bulls', 'Bulls', 'CHI', 'Chicago'), team('6', 'Miami Heat', 'Heat', 'MIA', 'Miami'), 'pre', { status: 'STATUS_POSTPONED' }),
  ] },
  'basketball/nba|20261107': { events: [] },
  'football/nfl|20261106': { events: [] },
  'football/nfl|20261107': { events: [event('501', Date.UTC(2026, 10, 7, 18, 0), team('14', 'Los Angeles Rams', 'Rams', 'LAR', 'Los Angeles'), team('2', 'Buffalo Bills', 'Bills', 'BUF', 'Buffalo'), 'pre')] },
  'soccer/eng.1|20261106': { events: [event('601', Date.UTC(2026, 10, 6, 20, 0), team('359', 'Arsenal', 'Arsenal', 'ARS', 'Arsenal'), team('363', 'Chelsea', 'Chelsea', 'CHE', 'Chelsea'), 'post')] },
  'soccer/eng.1|20261107': { events: [] },
};

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="nba4" group-title="US| NBA PACKAGE",Lakers vs Celtics @ Nov 6 7:30 PM :NBA 04
http://s/4
#EXTINF:-1 tvg-id="nba5" group-title="US| NBA PACKAGE",LA Clippers vs New York Knicks @ Nov 6 7:00 PM :NBA 05
http://s/5
#EXTINF:-1 tvg-id="nba6" group-title="US| NBA PACKAGE",NBA 06: No game
http://s/6
#EXTINF:-1 tvg-id="ESPN.us" group-title="US| SPORTS",US| ESPN HD
http://s/espn
#EXTINF:-1 tvg-id="CNN.us" group-title="US| NEWS",US| CNN
http://s/cnn
`;
const stampOf = ms => iso(ms).replace(/[-:TZ]/g, '').slice(0, 14) + ' +0000';
const GUIDE = `<?xml version="1.0"?><tv>
<channel id="ESPN.us"><display-name>ESPN</display-name></channel>
<channel id="CNN.us"><display-name>CNN</display-name></channel>
<channel id="nba4"><display-name>NBA 04</display-name></channel>
<programme channel="ESPN.us" start="${stampOf(NOW - 3600000)}" stop="${stampOf(NOW + 3600000)}"><title>SportsCenter</title></programme>
<programme channel="ESPN.us" start="${stampOf(NOW + 8 * 3600000)}" stop="${stampOf(NOW + 9 * 3600000)}"><title>Late Show</title></programme>
<programme channel="CNN.us" start="${stampOf(NOW - 3600000)}" stop="${stampOf(NOW + 3600000)}"><title>Newsroom</title></programme>
<programme channel="nba4" start="${stampOf(NOW - 3600000)}" stop="${stampOf(NOW + 3600000)}"><title>NBA 04 placeholder</title></programme>
</tv>`;

async function* chunked(text, size = 9) { for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size); }

function harness(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-sports-'));
  const clock = { now: NOW };
  const state = { down: false, requests: [] };
  const fetchJson = async url => {
    state.requests.push(url);
    if (state.down) throw new Error('HTTP 503');
    const parsed = new URL(url);
    const key = `${parsed.pathname.replace('/apis/site/v2/sports/', '').replace('/scoreboard', '')}|${parsed.searchParams.get('dates')}`;
    if (!SCOREBOARDS[key]) throw new Error(`unexpected ${key}`);
    return SCOREBOARDS[key];
  };
  const openText = async url => {
    if (url === 'http://source.test/channels.m3u') return chunked(PLAYLIST);
    if (url === 'http://source.test/guide.xml') return chunked(GUIDE);
    throw new Error(`unexpected ${url}`);
  };
  const env = {
    ZOROFIN_SPORTS_LEAGUES: 'nba,nfl,epl',
    ZOROFIN_SPORTS_CHANNELS_URL: 'http://source.test/channels.m3u',
    ZOROFIN_SPORTS_GUIDE_URL: 'http://source.test/guide.xml',
    ZOROFIN_SPORTS_EVENT_GROUPS: 'US| NBA PACKAGE',
    ZOROFIN_SPORTS_NETWORKS: 'ESPN=US| ESPN HD',
    ZOROFIN_SPORTS_FAVORITES: 'Celtics',
    ZOROFIN_SPORTS_TOKEN: TOKEN,
    ...overrides,
  };
  const module = createSportsEvents({ dataDir }, { env, now: () => clock.now, fetchJson, openText, sleep: async () => {} });
  return { module, clock, state };
}

const text = reply => reply.raw.toString('utf8');
const viewer = { admin: false };

test('channel names give a kickoff time in the provider time zone', () => {
  assert.equal(timeFromName('Lakers vs Celtics @ Nov 6 7:30 PM :NBA 04', NOW, 'America/New_York'), Date.UTC(2026, 10, 7, 0, 30));
  assert.equal(timeFromName('Final @ Jul 4 1:00 pm', Date.UTC(2026, 6, 1), 'America/New_York'), Date.UTC(2026, 6, 4, 17, 0));
  assert.equal(timeFromName('No time here', NOW, 'America/New_York'), null);
  const [game] = parseScoreboard(SCOREBOARDS['basketball/nba|20261106'], 'nba');
  assert.equal(teamMatches('Lakers', game.away, {}), true);
  assert.equal(teamMatches('LA Lakers', game.away, {}), true);
  assert.equal(teamMatches('Los Angeles', game.away, {}), false);
  assert.equal(teamMatches('Man Utd', { name: 'Manchester United', short: 'Man United', nickname: 'Manchester United', abbreviation: 'MUN' }, PACKS.epl.aliases), true);
});

test('event channels get their game, idle slots are hidden, networks get listings', async () => {
  const { module } = harness();
  await module.refresh();
  assert.equal(module.status.lastError, null);
  assert.deepEqual(module.status.channels, { listed: 4, eventSlots: 3, matched: 3 });

  const playlist = text(await module.handlePublic({ segments: [TOKEN, 'channels.m3u'] }));
  assert.match(playlist, /tvg-id="nba4"[^\n]*,NBA — Lakers at Celtics\n/);
  assert.match(playlist, /tvg-id="nba5"[^\n]*,NBA — Clippers at Knicks\n/);
  assert.doesNotMatch(playlist, /NBA 06/);
  assert.match(playlist, /US\| CNN/);

  const guide = text(await module.handlePublic({ segments: [TOKEN, 'guide.xml'] }));
  assert.match(guide, /<programme channel="nba5"[^>]*><title lang="en">Live: NBA Basketball — LA Clippers at New York Knicks<\/title>.*<live \/><\/programme>/);
  assert.match(guide, /<programme channel="nba4" start="20261107000000 \+0000"[^>]*><title lang="en">NBA Basketball — Los Angeles Lakers at Boston Celtics<\/title><desc lang="en">Los Angeles Lakers at Boston Celtics · TD Garden<\/desc>/);
  assert.match(guide, /<programme channel="ESPN\.us"[^>]*><title lang="en">NBA Basketball — Los Angeles Lakers at Boston Celtics/);
  assert.doesNotMatch(guide, /SportsCenter|NBA 04 placeholder/);
  assert.match(guide, /Late Show/);
  assert.match(guide, /Newsroom/);
  // XMLTV order: every channel before the first programme.
  assert.ok(guide.lastIndexOf('<channel ') < guide.indexOf('<programme '));
  assert.equal((await module.handlePublic({ segments: ['x'.repeat(40), 'guide.xml'] })).status, 404);
});

test('Live now lists games like the apps: live first, spoiler-free, favorites marked', async () => {
  const { module, clock } = harness({ ZOROFIN_SPORTS_CHANNELS_URL: '', ZOROFIN_SPORTS_GUIDE_URL: '', ZOROFIN_SPORTS_TOKEN: '' });
  await module.refresh();
  const { body } = await module.handle({ method: 'GET', segments: ['live'], query: new URLSearchParams(), viewer });
  assert.equal(body.spoilerFree, true);
  assert.deepEqual(body.games.map(game => game.title), ['LA Clippers at New York Knicks', 'Los Angeles Lakers at Boston Celtics', 'Arsenal vs Chelsea']);
  const [live, next, ended] = body.games;
  assert.equal(live.live, true);
  assert.equal(live.sport, 'basketball');
  assert.equal(live.score, undefined);
  assert.equal(live.detail, '');
  assert.equal(next.home.favorite, true);
  assert.equal(next.home.color, '#007a33');
  assert.deepEqual(next.broadcasts, ['ESPN']);
  assert.equal(ended.ended, true);

  const today = await module.handle({ method: 'GET', segments: ['live'], query: new URLSearchParams('window=today'), viewer });
  assert.ok(today.body.games.some(game => game.title === 'Buffalo Bills at Los Angeles Rams'));
  assert.ok(!today.body.games.some(game => /Bulls/.test(game.title))); // postponed

  clock.now += 20 * 60000; // past the postgame buffer
  await module.refresh();
  const later = await module.handle({ method: 'GET', segments: ['live'], query: new URLSearchParams(), viewer });
  assert.ok(!later.body.games.some(game => game.title === 'Arsenal vs Chelsea'));
  assert.equal((await module.handle({ method: 'GET', segments: ['status'], viewer })).status, 403);
});

test('a schedule outage keeps the last good fixtures', async () => {
  const { module, state } = harness({ ZOROFIN_SPORTS_CHANNELS_URL: '', ZOROFIN_SPORTS_GUIDE_URL: '', ZOROFIN_SPORTS_TOKEN: '', ZOROFIN_SPORTS_SHOW_SCORES: '1' });
  await module.refresh();
  state.down = true;
  await module.refresh();
  assert.equal(module.status.leagues.nba.ok, false);
  assert.equal(module.status.lastError, null);
  const { body } = await module.handle({ method: 'GET', segments: ['live'], query: new URLSearchParams(), viewer });
  assert.equal(body.games[0].title, 'LA Clippers at New York Knicks');
  assert.deepEqual(body.games[0].score, { home: '54', away: '50' });
  const preview = await module.handle({ method: 'GET', segments: ['preview'], viewer: { admin: true } });
  assert.equal(preview.body.leagues[0].games.find(game => game.id === 'nba:401').guideTitle, 'NBA Basketball — Los Angeles Lakers at Boston Celtics');
});

test('with no schedule at all, channels and guide still pass through', async () => {
  const { module, state } = harness();
  state.down = true;
  await module.refresh();
  assert.match(module.status.lastError || '', /no league schedule/);
  const playlist = text(await module.handlePublic({ segments: [TOKEN, 'channels.m3u'] }));
  assert.match(playlist, /US\| CNN/);
  assert.match(playlist, /US\| ESPN HD/);
  const guide = text(await module.handlePublic({ segments: [TOKEN, 'guide.xml'] }));
  assert.match(guide, /Newsroom/);
  assert.match(guide, /SportsCenter/);
});

test('settings explain what is wrong, and every setting has a Dashboard field', () => {
  assert.throws(() => settingsFrom({ ZOROFIN_SPORTS_LEAGUES: 'nba,curling' }), /unknown leagues: curling/);
  assert.throws(() => settingsFrom({ ZOROFIN_SPORTS_GUIDE_URL: 'http://g/x.xml' }), /needs ZOROFIN_SPORTS_CHANNELS_URL/);
  assert.throws(() => settingsFrom({ ZOROFIN_SPORTS_CHANNELS_URL: 'http://g/x.m3u' }), /ZOROFIN_SPORTS_TOKEN/);
  assert.throws(() => settingsFrom({ ZOROFIN_SPORTS_NETWORKS: 'ESPN' }), /Name=Other name/);
  assert.throws(() => settingsFrom({ ZOROFIN_SPORTS_TIMEZONE: 'Mars/Base' }), /time zone/);
  assert.deepEqual(settingsFrom({}).leagues, ['nba', 'nfl', 'cfb', 'mlb', 'nhl', 'epl', 'ucl', 'mls']);
  const source = fs.readFileSync(path.join(__dirname, '../src/modules/sportsEvents/index.js'), 'utf8');
  const used = new Set(source.match(/ZOROFIN_SPORTS_[A-Z_]+/g));
  const fields = new Set(SECTIONS.sportsEvents.options.map(option => option.env));
  for (const name of used) assert.ok(fields.has(name), `${name} has no Dashboard field`);
});
