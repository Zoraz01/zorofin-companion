'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveTvStreams, parseProvider, settingsFrom } = require('../src/modules/liveTvStreams');

const ME = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const ESPN = '1'.repeat(32);
const FOX = '2'.repeat(32);
const NOW = Date.parse('2026-11-04T20:00:00Z');
const CONFIG = { jellyfinUrl: 'http://jellyfin.test/', jellyfinApiKey: 'k' };

function session(userId, channelId, name, extra = {}) {
  return {
    UserId: userId, UserName: userId === ME ? 'Viewer' : 'Guest', DeviceId: `${userId}-tv`, DeviceName: 'Living room',
    LastPlaybackCheckIn: new Date(NOW - 10000).toISOString(),
    NowPlayingItem: { Id: channelId, Type: 'TvChannel', Name: name, ChannelNumber: name === 'ESPN' ? '206' : '5' },
    PlayState: { IsPaused: false },
    ...extra,
  };
}

function harness({ sessions = [], settings = {}, provider = null, liveTv = true } = {}) {
  const calls = [];
  const requestJson = async url => {
    const target = new URL(String(url));
    calls.push(target.pathname);
    if (target.pathname === '/Sessions') return { status: 200, body: sessions };
    if (target.pathname === '/LiveTv/Programs') return { status: 200, body: { Items: [{ ChannelId: ESPN, Name: 'Monday Night Football', EndDate: '2026-11-04T23:00:00Z' }] } };
    if (target.pathname.startsWith('/Users/')) return { status: 200, body: { Policy: { EnableLiveTvAccess: liveTv } } };
    if (target.pathname === '/player_api.php') return provider ? { status: 200, body: provider } : { status: 500, body: null };
    throw new Error(`unexpected ${target}`);
  };
  const module = createLiveTvStreams(CONFIG, {
    settings: { limit: 1, staleMs: 90000, xtream: null, useProviderLimit: true, namesForAdmins: true, ...settings },
    requestJson, now: () => NOW,
  });
  const status = (viewer, params = {}) => module.handle({ method: 'GET', segments: ['status'], query: new URLSearchParams(params), viewer });
  return { module, status, calls };
}

test('reports which channel is using the only stream, without other viewers names', async () => {
  const { status } = harness({ sessions: [session(OTHER, ESPN, 'ESPN'), session(ME, ESPN, 'ESPN', { DeviceId: 'phone' })] });
  const reply = await status({ id: ME, admin: false });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.state, 'full');
  assert.equal(reply.body.inUse, 1);
  assert.equal(reply.body.free, 0);
  assert.equal(reply.body.message, '1 of 1 Live TV stream in use: ESPN.');
  const [stream] = reply.body.streams;
  assert.equal(stream.channelNumber, '206');
  assert.equal(stream.viewers, 2);
  assert.equal(stream.yours, true);
  assert.equal(stream.programme.title, 'Monday Night Football');
  assert.equal(stream.watching, undefined);
  assert.equal(reply.body.provider, undefined);
  assert.doesNotMatch(JSON.stringify(reply.body), /Guest|Living room/);
});

test('administrators see who is watching unless names are turned off', async () => {
  const sessions = [session(OTHER, ESPN, 'ESPN')];
  const shown = await harness({ sessions }).status({ id: ME, admin: true });
  assert.deepEqual(shown.body.streams[0].watching, [{ name: 'Guest', device: 'Living room', paused: false }]);
  const hidden = await harness({ sessions, settings: { namesForAdmins: false } }).status({ id: ME, admin: true });
  assert.equal(hidden.body.streams[0].watching, undefined);
});

test('a channel request can join, use a free stream, switch its own stream, or wait', async () => {
  const sessions = [session(OTHER, ESPN, 'ESPN')];
  const join = await harness({ sessions }).status({ id: ME, admin: false }, { channelId: ESPN });
  assert.deepEqual([join.body.request.canStart, join.body.request.reason], [true, 'join']);
  const full = await harness({ sessions }).status({ id: ME, admin: false }, { channelId: FOX });
  assert.deepEqual([full.body.request.canStart, full.body.request.reason], [false, 'full']);
  const two = await harness({ sessions, settings: { limit: 2 } }).status({ id: ME, admin: false }, { channelId: FOX });
  assert.deepEqual([two.body.request.canStart, two.body.request.reason, two.body.free], [true, 'free', 1]);
  const mine = await harness({ sessions: [session(ME, ESPN, 'ESPN')] }).status({ id: ME, admin: false }, { channelId: FOX, deviceId: `${ME}-tv` });
  assert.deepEqual([mine.body.request.canStart, mine.body.request.reason], [true, 'switch']);
});

test('silent players and non-live playback do not count', async () => {
  const stale = session(OTHER, ESPN, 'ESPN', { LastPlaybackCheckIn: new Date(NOW - 5 * 60000).toISOString() });
  const movie = { ...session(OTHER, FOX, 'Movie'), NowPlayingItem: { Id: FOX, Type: 'Movie', Name: 'Movie' } };
  const reply = await harness({ sessions: [stale, movie] }).status({ id: ME, admin: false });
  assert.equal(reply.body.state, 'available');
  assert.equal(reply.body.inUse, 0);
  assert.equal(reply.body.message, '0 of 1 Live TV stream in use.');
});

test('the provider limit and connections outside Jellyfin are used when Xtream details are set', async () => {
  const { status } = harness({
    sessions: [session(OTHER, ESPN, 'ESPN')],
    settings: { limit: 3, xtream: { url: 'http://provider.test/', username: 'u', password: 'secret-pass' } },
    provider: { user_info: { max_connections: '2', active_cons: '2', status: 'Active', exp_date: String((NOW + 7 * 86400000) / 1000) } },
  });
  const reply = await status({ id: ME, admin: true });
  assert.equal(reply.body.limit, 2);
  assert.equal(reply.body.limitSource, 'provider');
  assert.equal(reply.body.otherUse, 1);
  assert.equal(reply.body.state, 'full');
  assert.equal(reply.body.message, '2 of 2 Live TV streams in use: ESPN, another app.');
  assert.ok(reply.body.warnings.some(w => /fewer than the 3/.test(w)));
  assert.ok(reply.body.warnings.some(w => /ends in 7 days/.test(w)));
  assert.doesNotMatch(JSON.stringify(reply.body), /secret-pass/);
});

test('a failed provider check falls back to the setting', async () => {
  const { status } = harness({ settings: { limit: 2, xtream: { url: 'http://provider.test/', username: 'u', password: 'p' } } });
  const reply = await status({ id: ME, admin: true });
  assert.equal(reply.body.limit, 2);
  assert.equal(reply.body.limitSource, 'setting');
  assert.match(reply.body.provider.error, /HTTP 500/);
});

test('viewers without Live TV access are refused, and Jellyfin outages report unknown', async () => {
  assert.equal((await harness({ liveTv: false }).status({ id: OTHER, admin: false })).status, 403);
  const broken = createLiveTvStreams(CONFIG, {
    settings: { limit: 1, staleMs: 90000, xtream: null, useProviderLimit: true, namesForAdmins: true },
    requestJson: async () => ({ status: 502, body: null }), now: () => NOW,
  });
  const reply = await broken.handle({ method: 'GET', segments: ['status'], query: new URLSearchParams(), viewer: { id: ME, admin: true } });
  assert.equal(reply.status, 503);
  assert.equal(reply.body.state, 'unknown');
});

test('settings validate the limit and keep Xtream details together', () => {
  assert.equal(settingsFrom({}, CONFIG).limit, 1);
  assert.equal(settingsFrom({ ZOROFIN_STREAMS_LIMIT: '4' }, CONFIG).limit, 4);
  assert.throws(() => settingsFrom({ ZOROFIN_STREAMS_LIMIT: '0' }, CONFIG), /1 to 50/);
  assert.throws(() => settingsFrom({ ZOROFIN_STREAMS_XTREAM_URL: 'http://p.test' }, CONFIG), /go together/);
  assert.throws(() => settingsFrom({}, {}), /ZOROFIN_JELLYFIN_URL/);
  assert.equal(parseProvider({ user_info: { max_connections: '3', active_cons: '0' } }).maxConnections, 3);
  assert.equal(parseProvider({ nope: true }), null);
});
