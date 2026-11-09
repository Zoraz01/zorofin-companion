'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createLiveTvSource, settingsFrom } = require('../src/modules/liveTvSource');
const { dateTokens, eventActive, matchupFromName } = require('../src/modules/liveTvSource/events');
const { collectGuide, nameKey, scanXmltv, xmltvTime } = require('../src/modules/liveTvSource/guide');
const { lines, openText } = require('../src/lib/http-stream');
const { SECTIONS } = require('../src/settings/schemas');

const NOW = Date.UTC(2026, 10, 6, 18, 0, 0); // Nov 6 2026, 18:00 UTC
const TOKEN = 'b'.repeat(40);
const T = offsetHours => {
  const d = new Date(NOW + offsetHours * 3600000);
  const p = v => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}0000 +0000`;
};

async function* chunked(text, size = 7) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

test('event slots are on only with a current date or a live marker', () => {
  const tokens = dateTokens(NOW);
  assert.equal(eventActive('PPV 03: Bills vs Rams (Nov 6 8:15 PM ET)', tokens), true);
  assert.equal(eventActive('PPV 04: UFC 330 06/11', tokens), true);
  assert.equal(eventActive('PPV 05: Boxing Nov 20', tokens), false);
  assert.equal(eventActive('PPV 06 | LIVE: Main card', tokens), true);
  assert.equal(eventActive('PPV 07: NO EVENT STREAMING NOW', tokens), false);
  assert.equal(eventActive('End | Bills vs Rams Nov 6', tokens), false);
  assert.equal(eventActive('##### PPV #####', tokens), false);
  // "6/11" must not match inside "16/11".
  assert.equal(eventActive('PPV 08: Cup final 16/11', tokens), false);
});

test('matchups come out of event channel names', () => {
  assert.deepEqual(matchupFromName('NFL 03: Buffalo Bills vs Los Angeles Rams @ 8:15 PM ET'), ['Buffalo Bills', 'Los Angeles Rams']);
  assert.deepEqual(matchupFromName('(FLSP 001) Rugby: England v. France | 15:00'), ['England', 'France']);
  assert.equal(matchupFromName('PPV 07: NO EVENT STREAMING NOW'), null);
  assert.equal(matchupFromName('ESPN HD'), null);
});

test('XMLTV is read across chunk boundaries and matched by id or name', async () => {
  assert.equal(xmltvTime('20261106180000 +0000'), NOW);
  assert.equal(xmltvTime('20261106130000 -0500'), NOW);
  assert.equal(nameKey('US| ESPN HD'), nameKey('ESPN'));
  const xml = `<?xml version="1.0"?><tv>
<channel id="ESPN.us"><display-name>ESPN</display-name></channel>
<channel id="other.fox"><display-name>FOX Sports 1</display-name></channel>
<channel id="ignored"><display-name>Shopping</display-name></channel>
<programme start="${T(-1)}" stop="${T(1)}" channel="ESPN.us"><title>SportsCenter</title></programme>
<programme start="${T(0)}" stop="${T(2)}" channel="other.fox"><title>MLB Tonight</title></programme>
<programme start="${T(0)}" stop="${T(2)}" channel="ignored"><title>Deals</title></programme>
<programme start="${T(-30)}" stop="${T(-29)}" channel="ESPN.us"><title>Old</title></programme>
</tv>`;
  const blocks = [];
  await scanXmltv(chunked(xml, 5), kind => blocks.push(kind));
  assert.deepEqual(blocks, ['channel', 'channel', 'channel', 'programme', 'programme', 'programme', 'programme']);
  const result = await collectGuide(chunked(xml, 11), { ids: new Set(['ESPN.us', 'xt.9']), names: new Map([['fox sports 1', 'xt.9']]) }, NOW);
  assert.equal(result.programmes, 2);
  assert.match(result.channels['ESPN.us'][0].block, /SportsCenter/);
  assert.match(result.channels['xt.9'][0].block, /channel="xt\.9"/);
});

test('settings explain what is missing', () => {
  assert.throws(() => settingsFrom({}), /XTREAM_URL[\s\S]*USERNAME[\s\S]*TOKEN/);
  assert.throws(() => settingsFrom({ ZOROFIN_LIVE_SOURCE_TYPE: 'm3u', ZOROFIN_LIVE_SOURCE_M3U_URL: 'ftp://x', ZOROFIN_LIVE_SOURCE_TOKEN: TOKEN }), /M3U_URL/);
  assert.throws(() => settingsFrom({ ZOROFIN_LIVE_SOURCE_TYPE: 'm3u', ZOROFIN_LIVE_SOURCE_M3U_URL: 'http://x/p.m3u', ZOROFIN_LIVE_SOURCE_TOKEN: TOKEN, ZOROFIN_LIVE_SOURCE_EVENT_RULE: 'pattern', ZOROFIN_LIVE_SOURCE_EVENT_PATTERN: '(' }), /EVENT_PATTERN/);
  const ok = settingsFrom({ ZOROFIN_LIVE_SOURCE_XTREAM_URL: 'http://p.test:8080', ZOROFIN_LIVE_SOURCE_XTREAM_USERNAME: 'u', ZOROFIN_LIVE_SOURCE_XTREAM_PASSWORD: 'p', ZOROFIN_LIVE_SOURCE_TOKEN: TOKEN, ZOROFIN_LIVE_SOURCE_GROUPS: 'US|, UK| SPORTS' });
  assert.deepEqual(ok.groups, ['US|', 'UK| SPORTS']);
  // Every env variable the module reads has a Dashboard field.
  const keys = SECTIONS.liveTvSource.options.map(option => option.env);
  for (const name of ['ZOROFIN_LIVE_SOURCE_TYPE', 'ZOROFIN_LIVE_SOURCE_GROUPS', 'ZOROFIN_LIVE_SOURCE_BACKUP_GUIDES', 'ZOROFIN_LIVE_SOURCE_TOKEN']) assert.ok(keys.includes(name), name);
});

function xtreamHarness(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-source-'));
  const state = { providerGuide: 'ok', backup: 'ok', shortCalls: 0 };
  const streams = [
    { stream_id: 1, name: 'US| ESPN HD', category_id: '10', epg_channel_id: 'ESPN.us', stream_icon: 'http://logo/espn.png' },
    { stream_id: 2, name: 'US| FOX SPORTS 1', category_id: '10', epg_channel_id: '' },
    { stream_id: 3, name: 'US| LOCAL 5', category_id: '10', epg_channel_id: 'LOCAL5.us' },
    { stream_id: 4, name: 'PPV 01: Buffalo Bills vs Los Angeles Rams Nov 6', category_id: '20' },
    { stream_id: 5, name: 'PPV 02: NO EVENT STREAMING NOW', category_id: '20' },
    { stream_id: 6, name: 'FR| TF1', category_id: '30', epg_channel_id: 'TF1.fr' },
    { stream_id: 7, name: '##### US #####', category_id: '10' },
  ];
  const providerXml = `<tv><channel id="ESPN.us"><display-name>ESPN</display-name></channel>
<programme start="${T(-1)}" stop="${T(1)}" channel="ESPN.us"><title>SportsCenter</title></programme></tv>`;
  const backupXml = `<tv><channel id="FS1.us"><display-name>FOX Sports 1</display-name></channel>
<channel id="ESPN.us"><display-name>ESPN</display-name></channel>
<programme start="${T(-1)}" stop="${T(4)}" channel="FS1.us"><title>Speak</title></programme>
<programme start="${T(-1)}" stop="${T(4)}" channel="ESPN.us"><title>Backup ESPN</title></programme></tv>`;
  const fetchJson = async url => {
    const action = new URL(url).searchParams.get('action');
    if (action === 'get_live_categories') return [{ category_id: '10', category_name: 'US| ENTERTAINMENT' }, { category_id: '20', category_name: 'US| PPV EVENTS' }, { category_id: '30', category_name: 'FR| GENERAL' }];
    if (action === 'get_live_streams') return streams;
    if (action === 'get_short_epg') {
      state.shortCalls += 1;
      return { epg_listings: [{ title: Buffer.from('Local News').toString('base64'), description: '', start_timestamp: String((NOW - 3600000) / 1000), stop_timestamp: String((NOW + 3600000) / 1000) }] };
    }
    throw new Error(`unexpected ${url}`);
  };
  const openTextFake = async url => {
    if (url.includes('xmltv.php')) {
      if (state.providerGuide !== 'ok') throw new Error('HTTP 404');
      return chunked(providerXml, 13);
    }
    if (url === 'https://backup.test/guide.xml.gz') {
      if (state.backup !== 'ok') throw new Error('HTTP 500');
      return chunked(backupXml, 17);
    }
    throw new Error(`unexpected ${url}`);
  };
  const env = {
    ZOROFIN_LIVE_SOURCE_XTREAM_URL: 'http://provider.test:8080',
    ZOROFIN_LIVE_SOURCE_XTREAM_USERNAME: 'user',
    ZOROFIN_LIVE_SOURCE_XTREAM_PASSWORD: 'secret-pass',
    ZOROFIN_LIVE_SOURCE_TOKEN: TOKEN,
    ZOROFIN_LIVE_SOURCE_GROUPS: 'us| entertainment',
    ZOROFIN_LIVE_SOURCE_EVENT_GROUPS: 'US| PPV',
    ZOROFIN_LIVE_SOURCE_BACKUP_GUIDES: 'https://backup.test/guide.xml.gz',
    ZOROFIN_LIVE_SOURCE_SHORT_GUIDE: '1',
    ...overrides,
  };
  const clock = { now: NOW };
  const module = createLiveTvSource({ dataDir }, { env, now: () => clock.now, fetchJson, openText: openTextFake });
  return { module, state, dataDir, clock };
}

const admin = { admin: true };
const text = reply => reply.raw.toString('utf8');

test('builds a slim playlist and a merged guide from an Xtream login', async () => {
  const { module, state } = xtreamHarness();
  await module.refresh();
  assert.equal(module.status.lastError, null);
  assert.equal(module.status.channels, 4); // ESPN, FS1, LOCAL 5, the Bills-Rams slot
  assert.deepEqual(module.status.eventChannels, { shown: 1, total: 2 });
  assert.deepEqual(module.status.filled, { guide: 2, shortGuide: 1, matchups: 1, empty: 0 });
  assert.equal(state.shortCalls, 1);

  const playlist = text(await module.handlePublic({ segments: [TOKEN, 'channels.m3u'] }));
  assert.match(playlist, /^#EXTM3U\n/);
  assert.match(playlist, /tvg-id="ESPN\.us"[^\n]*,US\| ESPN HD\nhttp:\/\/provider\.test:8080\/live\/user\/secret-pass\/1\.ts/);
  assert.doesNotMatch(playlist, /TF1|NO EVENT|#####/);

  const guide = text(await module.handlePublic({ segments: [TOKEN, 'guide.xml'] }));
  assert.match(guide, /SportsCenter/); // the provider guide wins for ESPN
  assert.doesNotMatch(guide, /Backup ESPN/);
  assert.match(guide, /channel="xt\.2"[^>]*>.*Speak/); // FS1 has no guide id: matched by name from the backup
  assert.match(guide, /Local News/); // the per-channel guide filled LOCAL 5
  assert.match(guide, /<title lang="en">Buffalo Bills vs Los Angeles Rams<\/title>/);

  assert.equal((await module.handlePublic({ segments: ['c'.repeat(40), 'guide.xml'] })).status, 404);
  const groups = (await module.handle({ method: 'GET', segments: ['groups'], viewer: admin })).body.groups;
  assert.deepEqual(groups.find(group => group.name === 'US| PPV EVENTS'), { name: 'US| PPV EVENTS', channels: 2, kept: false, event: true });
  assert.equal((await module.handle({ method: 'GET', segments: ['status'], viewer: { admin: false } })).status, 403);
  const preview = (await module.handle({ method: 'GET', segments: ['preview'], viewer: admin })).body;
  assert.deepEqual(preview.events[0].matchup, ['Buffalo Bills', 'Los Angeles Rams']);
});

test('a guide outage keeps the last good listings, and the backup fills the rest', async () => {
  const { module, state, clock } = xtreamHarness({ ZOROFIN_LIVE_SOURCE_GUIDE_HOURS: '1', ZOROFIN_LIVE_SOURCE_SHORT_GUIDE: '0' });
  await module.refresh();
  clock.now += 2 * 3600000; // both guides are due again
  state.providerGuide = 'down';
  await module.refresh();
  assert.equal(module.status.lastError, null);
  const provider = module.status.guides.find(guide => guide.label === 'Provider guide');
  assert.equal(provider.ok, false);
  assert.doesNotMatch(provider.lastError, /secret-pass/);
  // The cached SportsCenter listing has ended by now, so the backup fills ESPN.
  const guide = text(await module.handlePublic({ segments: [TOKEN, 'guide.xml'] }));
  assert.match(guide, /Backup ESPN/);

  // With every source down and no channels, the last good files stay.
  state.backup = 'down';
  const before = text(await module.handlePublic({ segments: [TOKEN, 'channels.m3u'] }));
  await module.refresh();
  assert.equal(text(await module.handlePublic({ segments: [TOKEN, 'channels.m3u'] })), before);
});

test('reads a gzipped M3U and guide over HTTP, following a redirect', async () => {
  const playlist = '#EXTM3U\n#EXTINF:-1 tvg-id="ESPN.us" group-title="US| SPORTS",ESPN\nhttp://s.test/1\n#EXTINF:-1 group-title="UK| NEWS",BBC\nhttp://s.test/2\n';
  const guide = `<tv><programme start="${T(-1)}" stop="${T(1)}" channel="ESPN.us"><title>Live Game</title></programme></tv>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/old.m3u') { res.writeHead(302, { Location: '/list.m3u' }); return res.end(); }
    if (req.url === '/list.m3u') { res.writeHead(200); return res.end(zlib.gzipSync(playlist)); }
    if (req.url === '/guide.xml') { res.writeHead(200); return res.end(guide); }
    res.writeHead(404); return res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const got = [];
    for await (const line of lines(await openText(`${base}/old.m3u`))) got.push(line);
    assert.equal(got[2], 'http://s.test/1');
    await assert.rejects(openText(`${base}/missing`), /HTTP 404/);

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-source-'));
    const module = createLiveTvSource({ dataDir }, { now: () => NOW, env: {
      ZOROFIN_LIVE_SOURCE_TYPE: 'm3u', ZOROFIN_LIVE_SOURCE_M3U_URL: `${base}/old.m3u`, ZOROFIN_LIVE_SOURCE_TOKEN: TOKEN,
      ZOROFIN_LIVE_SOURCE_GROUPS: 'US|', ZOROFIN_LIVE_SOURCE_BACKUP_GUIDES: `${base}/guide.xml`,
    } });
    await module.refresh();
    assert.equal(module.status.lastError, null);
    assert.equal(module.status.channels, 1);
    assert.match(text(await module.handlePublic({ segments: [TOKEN, 'guide.xml'] })), /Live Game/);
  } finally {
    server.close();
  }
});

test('group divider rows are left out, with or without a country prefix', () => {
  const { isDivider } = require('../src/modules/liveTvSource');
  for (const name of ['##### SPORTS #####', 'US| ##### SPORTS #####', 'UK: ===== NEWS =====', '#EXTINF junk', 'CA| ***** KIDS *****']) {
    assert.equal(isDivider(name), true, name);
  }
  for (const name of ['US| ESPN HD', 'NBA 01: Lakers vs Celtics', 'US| #1 Hits', 'C-SPAN']) {
    assert.equal(isDivider(name), false, name);
  }
});
