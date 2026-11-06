'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { inspectImage } = require('../src/modules/webUi/images');
const { createSportsArt, parseScoreboard } = require('../src/modules/webUi/sportsArt');
const { createWebUi } = require('../src/modules/webUi');

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, data, Buffer.alloc(4)]); // CRC isn't checked here
}

function png(width, height, extra = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra,
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(height * (width * 4 + 1)))), chunk('IEND', Buffer.alloc(0))]);
}

function jpeg(width, height) {
  const segment = (marker, body) => { const head = Buffer.from([0xff, marker, 0, 0]); head.writeUInt16BE(body.length + 2, 2); return Buffer.concat([head, body]); };
  const sof = Buffer.from([8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xe1, Buffer.from('Exif\0\0GPS secret here', 'latin1')), segment(0xfe, Buffer.from('comment', 'latin1')),
    segment(0xc0, sof), segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])), Buffer.from([0x12, 0x34, 0xff, 0xd9])]);
}

test('images: reads sizes, drops metadata, refuses anything else', () => {
  const withText = png(64, 64, [chunk('tEXt', Buffer.from('Author\0someone'))]);
  const p = inspectImage(withText);
  assert.equal(p.type, 'png');
  assert.equal(p.width, 64);
  assert.equal(p.body.includes(Buffer.from('someone')), false);
  const j = inspectImage(jpeg(1280, 720));
  assert.deepEqual([j.type, j.width, j.height], ['jpg', 1280, 720]);
  assert.equal(j.body.includes(Buffer.from('GPS secret')), false);
  assert.equal(j.body.includes(Buffer.from('comment')), false);
  assert.equal(j.body.includes(Buffer.from('JFIF')), true);
  assert.equal(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(inspectImage(png(64, 64).subarray(0, 40)), null);
  assert.equal(inspectImage(png(6000, 6000).subarray(0, 33)), null);
});

const KICKOFF = Date.parse('2026-11-04T20:00:00Z');
function scoreboard() {
  return {
    events: [{
      id: '401', date: '2026-11-04T20:00Z',
      competitions: [{ competitors: [
        { homeAway: 'home', team: { id: '1', displayName: 'Arsenal', shortDisplayName: 'Arsenal', name: 'Arsenal', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png' } },
        { homeAway: 'away', team: { id: '2', displayName: 'Chelsea', shortDisplayName: 'Chelsea', name: 'Chelsea', logo: 'https://a.espncdn.com/i/teamlogos/soccer/500/363.png' } },
      ] }],
    }, { id: 'bad', date: 'not a date', competitions: [] }],
  };
}

function fakeFetcher({ photo = true, logoBytes } = {}) {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    const json = value => ({ status: 200, type: 'application/json', body: Buffer.from(JSON.stringify(value)) });
    if (url.startsWith('https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261104')) return json(scoreboard());
    if (url.startsWith('https://site.api.espn.com/')) return json({ events: [] });
    if (url.startsWith('https://www.thesportsdb.com/api/v1/json/123/searchevents.php')) {
      return json({ event: photo ? [
        { idLeague: '4328', strHomeTeam: 'Arsenal', strAwayTeam: 'Tottenham', dateEvent: '2026-11-04', strThumb: 'https://r2.thesportsdb.com/wrong.jpg' },
        { idLeague: '4328', strHomeTeam: 'Arsenal', strAwayTeam: 'Chelsea', dateEvent: '2026-11-04', strThumb: 'https://r2.thesportsdb.com/images/media/event/thumb/ars-che.jpg' },
      ] : null });
    }
    if (url === 'https://r2.thesportsdb.com/images/media/event/thumb/ars-che.jpg') return { status: 200, type: 'image/jpeg', body: jpeg(1280, 720) };
    if (url.startsWith('https://a.espncdn.com/')) return { status: 200, type: 'image/png', body: logoBytes || png(500, 500) };
    return { status: 404, type: 'text/plain', body: Buffer.alloc(0) };
  };
  return { fetcher, calls };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-sports-'));
}

test('scoreboard parsing keeps only complete fixtures', () => {
  const fixtures = parseScoreboard(scoreboard(), 'soccer/eng.1');
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0].start, '2026-11-04T20:00:00Z');
  assert.deepEqual(fixtures[0].home.aliases, ['arsenal']);
});

test('writes the catalogue with a verified game photo', async () => {
  const dir = tempDir();
  const { fetcher, calls } = fakeFetcher();
  const art = createSportsArt({ dir, fetcher, now: () => KICKOFF - 3600000, sleep: async () => {} });
  const metrics = await art.refresh();
  assert.equal(metrics.fixtures, 1);
  assert.deepEqual(metrics.coverage, { event_image: 1 });
  const catalogue = JSON.parse(fs.readFileSync(art.file('events.json')));
  assert.equal(catalogue.version, 2);
  const [event] = catalogue.events;
  assert.equal(event.kind, 'event_image');
  assert.match(event.image, /^\/live-tv-logos\/art\/sports-[a-f0-9]{24}-[a-f0-9]{8}\.jpg$/);
  assert.equal(event.home.name, 'Arsenal');
  assert.equal('logo_url' in event.home, false, 'source addresses stay private');
  const image = art.file(event.image.split('/').pop());
  assert.ok(image);
  assert.equal(fs.readFileSync(image).includes(Buffer.from('GPS secret')), false);
  // Every request went to the allowed hosts only.
  assert.ok(calls.every(url => /^https:\/\/(site\.api\.espn\.com|www\.thesportsdb\.com|r2\.thesportsdb\.com|a\.espncdn\.com)\//.test(url)));
  // A second run within ten minutes does nothing.
  assert.deepEqual(await art.refresh(), { result: 'recent_run' });
  assert.equal(art.file('state.json'), null);
  assert.equal(art.file('../state.json'), null);
});

test('falls back to the two team crests when there is no photo', async () => {
  const dir = tempDir();
  const art = createSportsArt({ dir, fetcher: fakeFetcher({ photo: false }).fetcher, now: () => KICKOFF, sleep: async () => {} });
  await art.refresh();
  const [event] = JSON.parse(fs.readFileSync(art.file('events.json'))).events;
  assert.equal(event.kind, 'team_logos');
  assert.equal(event.logos.length, 2);
  assert.ok(event.logos.every(served => art.file(served.split('/').pop())));
});

test('a bad crest leaves the sport illustration, and the size limit stops downloads', async () => {
  const bad = createSportsArt({ dir: tempDir(), fetcher: fakeFetcher({ photo: false, logoBytes: Buffer.from('<svg/>') }).fetcher, now: () => KICKOFF, sleep: async () => {} });
  await bad.refresh();
  assert.equal(JSON.parse(fs.readFileSync(bad.file('events.json'))).events[0].kind, 'sport_graphic');

  const full = tempDir();
  fs.mkdirSync(path.join(full, 'art'), { recursive: true });
  fs.writeFileSync(path.join(full, 'art', 'sports-000000000000000000000000-00000000.png'), Buffer.alloc(2048));
  const capped = createSportsArt({ dir: full, fetcher: fakeFetcher({ photo: false }).fetcher, now: () => KICKOFF, sleep: async () => {}, maxBytes: 1024 });
  const metrics = await capped.refresh();
  assert.deepEqual(metrics.coverage, { sport_graphic: 1 });
  // The unused file is removed to get back under the limit.
  assert.equal(fs.existsSync(path.join(full, 'art', 'sports-000000000000000000000000-00000000.png')), false);
});

test('network failures keep the last catalogue', async () => {
  const dir = tempDir();
  let now = KICKOFF;
  const good = fakeFetcher();
  let broken = false;
  const art = createSportsArt({ dir, fetcher: (url, options) => (broken ? Promise.reject(new Error('offline')) : good.fetcher(url, options)), now: () => now, sleep: async () => {} });
  await art.refresh();
  broken = true;
  now += 20 * 60 * 1000;
  await art.refresh();
  assert.equal(JSON.parse(fs.readFileSync(art.file('events.json'))).events[0].kind, 'event_image');
});

test('web look serves the artwork only when it is turned on', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, '10-theme-base.css'), 'body{}');
  fs.writeFileSync(path.join(dir, '52-livetv-events.js'), 'void 0');
  const off = createWebUi({ dataDir: dir }, { settings: { dir, features: { theme: true, livetv: true } } });
  assert.equal((await off.handlePublic({ segments: ['live-tv-logos', 'art', 'events.json'] })).status, 404);
  assert.equal(JSON.parse((await off.handlePublic({ segments: ['manifest.json'] })).raw).classes.includes('zorofin-sports-art'), false);

  const art = createSportsArt({ dir: path.join(dir, 'data'), fetcher: fakeFetcher().fetcher, now: () => KICKOFF, sleep: async () => {} });
  await art.refresh();
  const on = createWebUi({ dataDir: dir }, { settings: { dir, features: { theme: true, livetv: true }, sportsArt: { enabled: true } }, sportsArt: art });
  assert.equal(JSON.parse((await on.handlePublic({ segments: ['manifest.json'] })).raw).classes.includes('zorofin-sports-art'), true);
  const catalogue = await on.handlePublic({ segments: ['live-tv-logos', 'art', 'events.json'] });
  assert.equal(catalogue.status, 200);
  assert.equal(catalogue.cacheControl, 'public, max-age=60');
  const name = JSON.parse(catalogue.raw).events[0].image.split('/').pop();
  const image = await on.handlePublic({ segments: ['live-tv-logos', 'art', name] });
  assert.equal(image.contentType, 'image/jpeg');
  assert.match(image.cacheControl, /immutable/);
  assert.equal((await on.handlePublic({ segments: ['live-tv-logos', 'art', 'state.json'] })).status, 404);
  assert.equal((await on.handle({ method: 'GET', segments: ['sportsArt'], viewer: { admin: false } })).status, 403);
  const status = await on.handle({ method: 'GET', segments: ['sportsArt'], viewer: { admin: true } });
  assert.equal(status.body.events, 1);

  // Needs the Live TV pages.
  const noLive = createWebUi({ dataDir: dir }, { settings: { dir, features: { theme: true, livetv: false }, sportsArt: { enabled: true } }, sportsArt: art });
  assert.equal((await noLive.handlePublic({ segments: ['live-tv-logos', 'art', 'events.json'] })).status, 404);
});
