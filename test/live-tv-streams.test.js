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

// ---- line pool (several one-stream logins behind one address) -------------

const http = require('http');
const os = require('os');
const fsMod = require('fs');
const pathMod = require('path');
const { parseLines, createLinePool, poolToken } = require('../src/modules/liveTvStreams/pool');

function listen(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    const close = server.close.bind(server);
    server.close = () => { close(); server.closeAllConnections(); };
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// A fake Xtream server: each login allows one open stream, like a one-connection IPTV plan.
async function fakeProvider() {
  const open = new Map();
  const seen = [];
  const server = await listen((req, res) => {
    const parts = req.url.split('/').filter(Boolean);
    if (parts[0] === 'redirect') {
      res.writeHead(302, { Location: `/${parts.slice(1).join('/')}` });
      return res.end();
    }
    const [user, , stream] = parts;
    seen.push({ user, stream });
    if (user === 'broken') { res.writeHead(403); return res.end(); }
    if ((open.get(user) || 0) >= 1) { res.writeHead(403); return res.end('max connections'); }
    open.set(user, (open.get(user) || 0) + 1);
    res.on('close', () => open.set(user, open.get(user) - 1));
    res.writeHead(200, { 'Content-Type': 'video/mp2t' });
    res.write(Buffer.from(`ts:${user}:${stream}`));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, open, seen };
}

// Opens a pooled stream and resolves with the status and first bytes.
function watch(port, streamId, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/v1/public/liveTvStreams/${token}/line/${streamId}`, res => {
      res.once('data', chunk => resolve({ status: res.statusCode, text: chunk.toString(), close: () => req.destroy() }));
      res.on('end', () => resolve({ status: res.statusCode, text: '', close: () => {} }));
    });
    req.on('error', reject);
  });
}

async function poolHarness(lines, extra = {}) {
  const dataDir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'zf-pool-'));
  const module = createLiveTvStreams({ ...CONFIG, dataDir }, {
    settings: { limit: 1, staleMs: 90000, xtream: null, useProviderLimit: true, namesForAdmins: true, lines, poolToken: '', ...extra },
    requestJson: async () => ({ status: 200, body: [] }), now: () => NOW,
  });
  const token = fsMod.readFileSync(pathMod.join(dataDir, 'liveTvStreams', 'pool-token'), 'utf8').trim();
  const server = await listen(async (req, res) => {
    const segments = req.url.split('/').filter(Boolean).slice(3);
    const reply = await module.handlePublic({ segments });
    if (reply.stream) return reply.stream(res);
    res.writeHead(reply.status); res.end(JSON.stringify(reply.body));
  });
  return { module, token, server, port: server.address().port, dataDir };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 50));

test('parses M3U links and plain Xtream addresses without echoing passwords', () => {
  const lines = parseLines('http://a.test:80/get.php?username=u1&amp;password=p1&amp;type=m3u_plus  http://b.test/live/u2/p2');
  assert.deepEqual(lines, [
    { base: 'http://a.test', username: 'u1', password: 'p1' },
    { base: 'http://b.test', username: 'u2', password: 'p2' },
  ]);
  assert.deepEqual(parseLines(''), []);
  assert.throws(() => parseLines('http://a.test/get.php?username=secretuser'), error => !/secretuser/.test(error.message));
  assert.throws(() => parseLines('ftp://a.test/u/p'), /login 1/);
});

test('settings read the logins and reject a bad token', () => {
  const env = { ZOROFIN_STREAMS_LINES: 'http://a.test/u1/p1 http://a.test/u2/p2' };
  assert.equal(settingsFrom(env, CONFIG).lines.length, 2);
  assert.throws(() => settingsFrom({ ...env, ZOROFIN_STREAMS_POOL_TOKEN: 'short' }, CONFIG), /POOL_TOKEN/);
  assert.throws(() => settingsFrom({ ZOROFIN_STREAMS_LINES: 'nonsense' }, CONFIG), /ZOROFIN_STREAMS_LINES/);
});

test('each new channel takes a free login, and a third waits', async () => {
  const provider = await fakeProvider();
  const { module, token, server, port } = await poolHarness(parseLines(`${provider.base}/u1/p1 ${provider.base}/u2/p2`));
  try {
    const espn = await watch(port, '101', token);
    assert.equal(espn.status, 200);
    assert.equal(espn.text, 'ts:u1:101');
    const fox = await watch(port, '202.ts', token);
    assert.equal(fox.status, 200);
    assert.equal(fox.text, 'ts:u2:202.ts');
    const third = await watch(port, '303', token);
    assert.equal(third.status, 503);
    assert.match(third.text, /all_lines_busy/);

    // Closing ESPN frees login 1 for the next channel.
    espn.close();
    await settle();
    const next = await watch(port, '303', token);
    assert.equal(next.text, 'ts:u1:303');

    const admin = await module.handle({ method: 'GET', segments: ['status'], query: new URLSearchParams(), viewer: { id: ME, admin: true } });
    assert.equal(admin.body.limit, 2);
    assert.equal(admin.body.limitSource, 'lines');
    assert.equal(admin.body.lines.inUse, 2);
    // Jellyfin reports no viewers here (two tabs of one browser share one
    // session), yet both lines are open: the count must still say full.
    assert.equal(admin.body.inUse, 2);
    assert.equal(admin.body.state, 'full');
    assert.equal(admin.body.message, '2 of 2 Live TV streams in use: 2 more channels.');
    assert.doesNotMatch(JSON.stringify(admin.body), /p1|p2/);
    fox.close(); next.close();
  } finally {
    server.close(); provider.server.close();
  }
});

test('a login the provider refuses falls over to the next, and redirects are followed', async () => {
  const provider = await fakeProvider();
  const logs = [];
  const lines = [{ base: provider.base, username: 'broken', password: 'x' }, { base: `${provider.base}/redirect`, username: 'u2', password: 'p2' }];
  const pool = createLinePool({ lines, log: line => logs.push(line) });
  const server = await listen((req, res) => pool.relay('7', '', res));
  try {
    const reply = await new Promise(resolve => http.get(`http://127.0.0.1:${server.address().port}/`, res => {
      res.once('data', chunk => { resolve({ status: res.statusCode, text: chunk.toString() }); res.destroy(); });
    }));
    assert.equal(reply.status, 200);
    assert.equal(reply.text, 'ts:u2:7');
    assert.equal(logs.length, 1);
    assert.doesNotMatch(logs[0], /broken|\/x\//);
    await settle();
    assert.equal(pool.busy(), 0);
  } finally {
    server.close(); provider.server.close();
  }
});

test('the line address needs the token and is off with fewer than two logins', async () => {
  const { module, token, server } = await poolHarness(parseLines('http://a.test/u1/p1 http://a.test/u2/p2'));
  server.close();
  assert.equal((await module.handlePublic({ segments: ['x'.repeat(48), 'line', '1'] })).status, 404);
  assert.equal((await module.handlePublic({ segments: [token, 'line', '../etc'] })).status, 404);
  assert.equal(typeof (await module.handlePublic({ segments: [token, 'line', '1'] })).stream, 'function');

  const single = createLiveTvStreams(CONFIG, { settings: { limit: 1, staleMs: 90000, xtream: null, useProviderLimit: true, namesForAdmins: true, lines: parseLines('http://a.test/u1/p1') } });
  assert.equal((await single.handlePublic({ segments: [token, 'line', '1'] })).status, 404);
});

test('the pool token is kept across restarts', () => {
  const dir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'zf-token-'));
  const first = poolToken('', dir);
  assert.match(first, /^[a-f0-9]{48}$/);
  assert.equal(poolToken('', dir), first);
  assert.equal(poolToken('given'.repeat(8), dir), 'given'.repeat(8));
  assert.equal(fsMod.statSync(pathMod.join(dir, 'pool-token')).mode & 0o777, 0o600);
});
