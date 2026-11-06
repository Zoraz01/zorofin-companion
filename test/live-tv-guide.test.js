'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLiveTvGuide, settingsFrom } = require('../src/modules/liveTvGuide');
const { decode, rewriteProgrammes } = require('../src/modules/liveTvGuide/xmltv');
const { createRegistry } = require('../src/modules');
const { createServer } = require('../src/server');

const TOKEN = 'a'.repeat(40);
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="c1"><display-name>Sports 1</display-name></channel>
  <programme channel="c1" start="20261029180000 +0000" stop="20261029200000 +0000">
    <title lang="en">NBA Basketball</title>
    <desc lang="en">The Bulls host the Lakers in Chicago.</desc>
  </programme>
  <programme channel="c1" start="20261029200000 +0000" stop="20261029203000 +0000">
    <title lang="en">Seinfeld &amp; Friends</title>
  </programme>
  <programme channel="c1" start="20261029203000 +0000" stop="20261029210000 +0000">
    <title lang="en">Seinfeld &amp; Friends</title>
  </programme>
  <programme channel="c1" start="20261029210000 +0000" stop="20261029220000 +0000">
    <title>Local News at 10</title>
    <icon src="http://existing.example/news.png" />
  </programme>
  <programme channel="c1" start="20261029220000 +0000" stop="20261029230000 +0000">
    <title>FIFA World Cup: Mexico vs South Africa</title>
  </programme>
</tv>
`;

function harness({ settings = {}, guide = GUIDE } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-guide-'));
  const calls = [];
  const state = { guide, guideStatus: 200 };
  const fetcher = async url => {
    calls.push(url);
    if (url === 'http://guide.test/xmltv.xml') return { status: state.guideStatus, type: 'application/xml', body: Buffer.from(state.guide) };
    if (url.startsWith('https://api.tvmaze.com/')) {
      return { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify({ name: 'Seinfeld & Friends', image: { medium: 'https://img.example/show.png' } })) };
    }
    if (url.startsWith('https://www.thesportsdb.com/')) {
      return { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify({ event: [{ strHomeTeam: 'Chicago Bulls', strAwayTeam: 'Los Angeles Lakers', strThumb: 'https://img.example/match.png' }] })) };
    }
    if (url.startsWith('https://api.github.com/repos/tv-logo/')) {
      return { status: 200, type: 'application/json', body: Buffer.from(JSON.stringify({ tree: [
        { path: 'countries/united-states/espn-us.png' }, { path: 'countries/united-states/sports-1-us.png' },
        { path: 'countries/united-kingdom/sports-1-uk.png' }, { path: 'README.md' },
      ] })) };
    }
    if (url.startsWith('https://raw.githubusercontent.com/tv-logo/')) return { status: 200, type: 'image/png', body: PNG };
    if (url.startsWith('https://img.example/')) return { status: 200, type: 'image/png', body: PNG };
    throw new Error(`unexpected ${url}`);
  };
  const module = createLiveTvGuide({ dataDir }, {
    settings: {
      sourceUrl: 'http://guide.test/xmltv.xml', token: TOKEN, publicUrl: 'http://companion:9310/',
      tvmaze: true, sportsDbKey: 'operatorkey', matchupTitles: true, channelLogos: false, logoCountries: ['united-states'], refreshMs: 1800000, ...settings,
    },
    fetcher,
    sleep: async () => {},
  });
  return { module, calls, state, dataDir };
}

async function guideText(module) {
  const reply = await module.handlePublic({ segments: [TOKEN, 'guide.xml'] });
  assert.equal(reply.status, 200);
  return reply.raw.toString('utf8');
}

test('adds matchups to sports titles and art to programmes without any', async () => {
  const h = harness();
  await h.module.refresh();
  const xml = await guideText(h.module);
  assert.match(xml, /<title lang="en">NBA Basketball — Bulls vs Lakers<\/title>/);
  assert.match(xml, /<title>FIFA World Cup: Mexico vs South Africa<\/title>/, 'existing matchup left alone');
  assert.match(xml, /<icon src="http:\/\/existing.example\/news.png" \/>/);
  const icons = [...xml.matchAll(/<icon src="(http:\/\/companion:9310\/v1\/public\/liveTvGuide\/[^"]+)"/g)].map(match => match[1]);
  assert.equal(icons.length, 3, 'game card plus a poster on each Seinfeld airing');
  assert.equal(h.calls.filter(url => url.startsWith('https://api.tvmaze.com/')).length, 1, 'one lookup per show');
  assert.equal(h.module.status.lastError, null);

  const file = icons[0].split('/').pop();
  const art = await h.module.handlePublic({ segments: [TOKEN, 'art', file] });
  assert.equal(art.contentType, 'image/png');
  assert.deepEqual(art.raw, PNG);
});

test('adds logos to channels without one, from the chosen countries only', async () => {
  const h = harness({ settings: { channelLogos: true } });
  await h.module.refresh();
  const xml = await guideText(h.module);
  assert.match(xml, /<channel id="c1"><display-name>Sports 1<\/display-name>\s*<icon src="http:\/\/companion:9310\/v1\/public\/liveTvGuide\/[^"]+" \/>/);
  assert.ok(h.calls.some(url => url.endsWith('/countries/united-states/sports-1-us.png')));
  assert.equal(h.calls.some(url => url.includes('united-kingdom')), false);
  assert.equal(h.module.status.logos, 1);
  const before = h.calls.length;
  await h.module.refresh();
  assert.equal(h.calls.filter((url, index) => index >= before && url.includes('github')).length, 0, 'tree and logo cached');
});

test('uses cached lookups on the next refresh', async () => {
  const h = harness();
  await h.module.refresh();
  const before = h.calls.length;
  await h.module.refresh();
  assert.equal(h.calls.length - before, 1, 'only the guide itself is fetched again');
});

test('outside sources stay off unless the operator enables them', async () => {
  const h = harness({ settings: { tvmaze: false, sportsDbKey: '' } });
  await h.module.refresh();
  assert.deepEqual(h.calls, ['http://guide.test/xmltv.xml']);
  assert.doesNotMatch(await guideText(h.module), /v1\/public/);
});

test('keeps serving the last good guide when the source breaks', async () => {
  const h = harness();
  assert.equal((await h.module.handlePublic({ segments: [TOKEN, 'guide.xml'] })).status, 503);
  await h.module.refresh();
  h.state.guideStatus = 500;
  await h.module.refresh();
  assert.match(h.module.status.lastError, /HTTP 500/);
  assert.match(await guideText(h.module), /Bulls vs Lakers/);
  h.state.guideStatus = 200;
  h.state.guide = '<html>login</html>';
  await h.module.refresh();
  assert.match(h.module.status.lastError, /not XMLTV/);
});

test('public routes need the token and only serve known files', async () => {
  const h = harness();
  await h.module.refresh();
  assert.equal((await h.module.handlePublic({ segments: ['b'.repeat(40), 'guide.xml'] })).status, 404);
  assert.equal((await h.module.handlePublic({ segments: [TOKEN, 'art', '../cache.json'] })).status, 404);
  assert.equal((await h.module.handlePublic({ segments: [TOKEN, 'cache.json'] })).status, 404);
});

test('admin routes report status and trigger a refresh', async () => {
  const h = harness();
  assert.equal((await h.module.handle({ method: 'GET', segments: ['status'], viewer: { id: 'x', admin: false } })).status, 403);
  assert.equal((await h.module.handle({ method: 'POST', segments: ['refresh'], viewer: { id: 'x', admin: true } })).status, 202);
  const status = await h.module.handle({ method: 'GET', segments: ['status'], viewer: { id: 'x', admin: true } });
  assert.deepEqual(status.body.sources, { tvmaze: true, sportsDb: true, channelLogos: false });
});

test('the guide is reachable over HTTP through the public route', async () => {
  const h = harness();
  await h.module.refresh();
  const registry = createRegistry(['liveTvGuide'], {}, {}, { liveTvGuide: () => h.module });
  const server = createServer({ config: { bridgeSecret: 'x'.repeat(32) }, registry });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/v1/public/liveTvGuide`;
    const response = await fetch(`${base}/${TOKEN}/guide.xml`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/xml/);
    assert.match(await response.text(), /Bulls vs Lakers/);
    assert.equal((await fetch(`${base}/wrong/guide.xml`)).status, 404);
    assert.equal((await fetch(`${base}/${TOKEN}/guide.xml`, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('settings need a guide URL and token, and a public URL for art', () => {
  assert.throws(() => settingsFrom({}), /ZOROFIN_GUIDE_SOURCE_URL/);
  assert.throws(() => settingsFrom({ ZOROFIN_GUIDE_SOURCE_URL: 'http://g/x.xml', ZOROFIN_GUIDE_TOKEN: 'short' }), /TOKEN/);
  assert.throws(() => settingsFrom({ ZOROFIN_GUIDE_SOURCE_URL: 'http://g/x.xml', ZOROFIN_GUIDE_TOKEN: TOKEN, ZOROFIN_GUIDE_TVMAZE: '1' }), /PUBLIC_URL/);
  assert.throws(() => settingsFrom({ ZOROFIN_GUIDE_SOURCE_URL: 'http://g/x.xml', ZOROFIN_GUIDE_TOKEN: TOKEN, ZOROFIN_GUIDE_CHANNEL_LOGOS: '1', ZOROFIN_GUIDE_PUBLIC_URL: 'http://c', ZOROFIN_GUIDE_LOGO_COUNTRIES: '../etc' }), /COUNTRIES/);
  const settings = settingsFrom({ ZOROFIN_GUIDE_SOURCE_URL: 'http://g/x.xml', ZOROFIN_GUIDE_TOKEN: TOKEN });
  assert.equal(settings.tvmaze, false);
  assert.equal(settings.sportsDbKey, '');
  assert.equal(settings.refreshMs, 30 * 60 * 1000);
});

test('xmltv rewriting decodes entities and leaves unknown blocks alone', async () => {
  assert.equal(decode('A &amp; B &#233; &#x41;'), 'A & B é A');
  const xml = '<tv><programme channel="c" start="1"><desc>no title</desc></programme></tv>';
  assert.equal(await rewriteProgrammes(xml, async () => ({ title: 'x', icon: 'y' })), xml);
});
