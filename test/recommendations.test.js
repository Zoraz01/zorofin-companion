'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecommendations, buildSignals, franchise, parseAiPicks, rank, recordGroupSwipe, settingsFrom } = require('../src/modules/recommendations');

const VIEWER = '4f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f';
const TODAY = '2026-10-29';

function movie(id, overrides = {}) {
  return {
    id, mediaType: 'movie', title: `Movie ${id}`, posterPath: `/p${id}.jpg`, overview: 'A film.',
    releaseDate: '2020-01-01', voteCount: 500, voteAverage: 7, genreIds: [18], ...overrides,
  };
}

function watched(id, extra = {}) {
  return { Id: `j${id}`, ProviderIds: { Tmdb: String(id) }, UserData: { Played: true, PlayCount: 1, ...extra } };
}

function show(id, overrides = {}) {
  return {
    id, mediaType: 'tv', name: `Show ${id}`, posterPath: `/s${id}.jpg`, overview: 'A show.',
    firstAirDate: '2019-01-01', voteCount: 300, voteAverage: 7.5, genreIds: [80], ...overrides,
  };
}

function harness({ played = [watched(1), watched(2), watched(3)], favorites = [], seerrUsers = [{ id: 7, jellyfinUserId: VIEWER }], requests = [], catalog = {},
  episodes = [], series = [], recommendations = null, discover = null, library = [], people = [], genreRows = [], search = null } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-recs-'));
  const calls = [], jellyfinWrites = [];
  const requestJson = async (url, options = {}) => {
    const target = new URL(String(url));
    calls.push(target.pathname + target.search);
    if (target.host === 'jellyfin.test') {
      if (options.method && options.method !== 'GET') jellyfinWrites.push(target.pathname);
      const detail = /^\/Users\/([^/]+)\/Items\/([a-f0-9]{32})$/.exec(target.pathname);
      if (detail) return { status: detail[1] === VIEWER && catalog[detail[2]] ? 200 : 404, body: catalog[detail[2]] || null };
      const q = target.searchParams;
      if (q.get('PersonIds')) return { status: 200, body: { Items: people } };
      if (q.get('Genres')) return { status: 200, body: { Items: genreRows } };
      if (q.get('Limit') === '20000') return { status: 200, body: { Items: library } };
      if (q.get('Ids')) { const wanted = new Set(q.get('Ids').split(',')); return { status: 200, body: { Items: series.filter(item => wanted.has(item.Id)) } }; }
      if (q.get('IncludeItemTypes') === 'Episode') return { status: 200, body: { Items: episodes } };
      return { status: 200, body: { Items: q.get('Filters') === 'IsPlayed' ? played : favorites } };
    }
    if (target.pathname === '/api/v1/user') return { status: 200, body: { results: seerrUsers } };
    if (target.pathname === '/api/v1/request') return { status: 200, body: { results: requests } };
    if (target.pathname === '/api/v1/search') {
      return { status: 200, body: { results: search ? search(new URLSearchParams(target.search).get('query')) : [] } };
    }
    if (target.pathname === '/api/v1/discover/movies') {
      const genre = Number(target.searchParams.get('genre'));
      return { status: 200, body: { results: discover ? discover(genre) : Array.from({ length: 15 }, (_, index) => movie(7000 + index, { genreIds: String(genre).split(',').map(Number) })) } };
    }
    const match = /^\/api\/v1\/(movie|tv)\/(\d+)\/(recommendations|similar)$/.exec(target.pathname);
    if (match) {
      const [, type, seedText, kind] = match;
      const seed = Number(seedText);
      if (recommendations) return { status: 200, body: { results: recommendations(type, seed, kind) } };
      if (type === 'tv') return { status: 200, body: { results: Array.from({ length: 12 }, (_, index) => show(seed * 100 + index)) } };
      // Each seed recommends 100+seed..., all overlap on 500 so it ranks first.
      const results = [movie(500), ...Array.from({ length: 12 }, (_, index) => movie(seed * 100 + index))];
      results.push(movie(900, { mediaInfo: { status: 5 } }), movie(901, { adult: true }), movie(902, { releaseDate: '2099-01-01' }), movie(1));
      return { status: 200, body: { results } };
    }
    throw new Error(`unexpected ${target}`);
  };
  const module = createRecommendations(
    { dataDir, jellyfinUrl: 'http://jellyfin.test/', jellyfinApiKey: 'k' },
    { settings: { seerrUrl: 'http://seerr.test/', seerrApiKey: 's' }, requestJson, now: () => Date.parse(`${TODAY}T12:00:00Z`), log: process.env.RECS_LOG ? console.log : () => {} },
  );
  const call = (method, route, body, query = '') => module.handle({ method, segments: route.split('/'), body, query: new URLSearchParams(query), viewer: { id: VIEWER, admin: false } });
  return { module, calls, call, requestJson, dataDir, jellyfinWrites };
}

test('first request starts preparing, then serves a ranked requestable feed', async () => {
  const h = harness();
  assert.deepEqual((await h.call('GET', 'feed')).body, { state: 'preparing', items: [] });
  await h.module.refresh(VIEWER);
  const feed = (await h.call('GET', 'feed')).body;
  assert.equal(feed.state, 'ready');
  assert.equal(feed.items.length, 20);
  assert.equal(feed.items[0].tmdbId, 500, 'recommended by every seed');
  const ids = feed.items.map(item => item.tmdbId);
  for (const blocked of [1, 900, 901, 902]) assert.equal(ids.includes(blocked), false, `excludes ${blocked}`);
  assert.equal(feed.items[0].posterUrl, 'https://image.tmdb.org/t/p/w342/p500.jpg');
});

test('needs three completed movies', async () => {
  const h = harness({ played: [watched(1), watched(2), { ...watched(3), UserData: { Played: false, PlayedPercentage: 40 } }] });
  await h.module.refresh(VIEWER);
  assert.deepEqual((await h.call('GET', 'feed')).body, { state: 'not_enough_history', items: [] });
});

test('feedback hides titles and is limited to titles in the feed', async () => {
  const h = harness();
  await h.module.refresh(VIEWER);
  const after = await h.call('POST', 'feedback', { tmdbId: 500, action: 'not_interested' });
  assert.equal(after.body.items.some(item => item.tmdbId === 500), false);
  assert.equal((await h.call('POST', 'feedback', { tmdbId: 123456, action: 'seen' })).status, 404);
  assert.equal((await h.call('POST', 'feedback', { tmdbId: 101, action: 'delete_everything' })).status, 400);
});

test('requested titles and automated requests are handled like the original', async () => {
  const h = harness({ requests: [
    { id: 1, type: 'movie', isAutoRequest: false, media: { tmdbId: 500 } },
    { id: 2, type: 'movie', isAutoRequest: true, media: { tmdbId: 4 } },
  ] });
  await h.module.refresh(VIEWER);
  const ids = (await h.call('GET', 'feed')).body.items.map(item => item.tmdbId);
  assert.equal(ids.includes(500), false, 'already requested');
  assert.ok(h.calls.some(call => call.startsWith('/api/v1/movie/500/')), 'manual request is a taste seed');
  assert.equal(h.calls.some(call => call.startsWith('/api/v1/movie/4/')), false, 'automated request is not');
});

test('unchanged taste reuses the feed without asking Seerr for candidates', async () => {
  const h = harness();
  await h.module.refresh(VIEWER);
  const before = h.calls.filter(call => call.includes('/movie/')).length;
  await h.module.refresh(VIEWER);
  assert.equal(h.calls.filter(call => call.includes('/movie/')).length, before);
});

test('more-like-this and recent watches outweigh an old favorite', () => {
  const now = Date.parse(`${TODAY}T12:00:00Z`);
  const old = { ...watched(2), UserData: { Played: true, LastPlayedDate: '2023-01-01T00:00:00Z' } };
  const recent = { ...watched(1), UserData: { Played: true, LastPlayedDate: '2026-10-28T00:00:00Z' } };
  const signals = buildSignals({ movies: [recent], favorites: [old], feedback: [{ tmdbId: 3, action: 'more_like_this', at: now }] }, now);
  assert.deepEqual(signals.map(signal => signal.tmdbId), [3, 1, 2]);
  assert.deepEqual(rank([{ item: movie(5, { voteCount: 10 }), seed: { key: 'movie:1', weight: 1 } }], { today: TODAY }), []);
});

test('ranking prefers agreement, the viewer\'s era and genres, and caps one seed and one franchise', () => {
  const a = { key: 'movie:1', weight: 5 }, b = { key: 'movie:2', weight: 5 };
  const profile = { genres: new Map([['crime', 0.8], ['drama', 0.2]]), era: 2010 };
  const fromA = Array.from({ length: 8 }, (_, index) => movie(100 + index, { genreIds: [80] }));
  const candidates = [
    ...fromA.map((item, index) => ({ item, seed: a, rank: index + 1 })),
    { item: movie(300, { genreIds: [80], releaseDate: '1944-01-01' }), seed: b, rank: 0 },
    { item: movie(301, { genreIds: [80], releaseDate: '2012-01-01' }), seed: b, rank: 1 },
    { item: movie(302, { genreIds: [16, 10751] }), seed: b, rank: 2 },
    { item: movie(303, { genreIds: [80] }), seed: a, rank: 0 }, { item: movie(303, { genreIds: [80] }), seed: b, rank: 3 },
    ...['Saga', 'Saga 2', 'Saga 3'].map((title, index) => ({ item: movie(400 + index, { title, genreIds: [80] }), seed: b, rank: 4 + index })),
    { item: movie(410, { title: 'The Saga Trilogy: 1901-1980', genreIds: [80] }), seed: b, rank: 0 },
  ];
  const ranked = rank(candidates, { today: TODAY, profile, maxWeight: 5 });
  const ids = ranked.map(item => item.tmdbId);
  assert.equal(ids[0], 303, 'two seeds agree');
  assert.ok(ids.indexOf(301) < ids.indexOf(300), 'a 1944 film ranks below a 2012 one with the same support');
  assert.ok(ids.indexOf(301) < ids.indexOf(302), 'genre fit counts');
  assert.equal(ids.includes(410), false, 'recut compilations are dropped');
  const capped = ranked.findIndex((item, index) => index > 0 && item.score > ranked[index - 1].score);
  const firstPass = capped < 0 ? ranked : ranked.slice(0, capped);
  assert.equal(firstPass.filter(item => item.lead === 'movie:1').length, 4, 'one seed leads at most four picks before the overflow');
  assert.ok(ranked.length > firstPass.length, 'capped picks are kept as spares after the first pass');
  assert.equal(firstPass.filter(item => /^Saga/.test(item.title)).length, 2, 'one franchise at most twice before the overflow');
  assert.equal(franchise('Saga 3'), franchise('The Saga: Part II'));
  assert.notEqual(franchise('1917'), franchise('300'));
});

test('TMDB "similar" is used only when a seed has almost no recommendations', async () => {
  const h = harness({ recommendations: (type, seed, kind) => (kind === 'similar' || seed !== 1
    ? Array.from({ length: 12 }, (_, index) => movie(seed * 100 + index + (kind === 'similar' ? 50 : 0)))
    : [movie(150)]) });
  await h.module.refresh(VIEWER);
  assert.ok(h.calls.includes('/api/v1/movie/1/similar?page=1'));
  assert.equal(h.calls.some(call => call.startsWith('/api/v1/movie/2/similar')), false);
});

test('show watchers qualify, get movies by default and shows only when the app asks', async () => {
  const showItem = (n, tmdb) => ({ Id: n.repeat(32), Type: 'Series', Name: `Watched show ${n}`, ProviderIds: { Tmdb: String(tmdb) }, Genres: ['Crime', 'Drama'], ProductionYear: 2018 });
  const series = [showItem('a', 11), showItem('b', 12), showItem('c', 13)];
  const episodes = series.flatMap(item => Array.from({ length: 4 }, () => ({ SeriesId: item.Id, UserData: { Played: true, LastPlayedDate: '2026-10-20T00:00:00Z' } })));
  const h = harness({ played: [], episodes, series });
  await h.module.refresh(VIEWER);
  const movies = (await h.call('GET', 'feed')).body;
  assert.equal(movies.state, 'ready');
  assert.ok(movies.items.length >= 10);
  assert.ok(movies.items.every(item => item.mediaType === 'movie'), 'older apps never see a show id');
  assert.ok(h.calls.some(call => call.startsWith('/api/v1/discover/movies')), 'movies come from the viewer\'s top genres');
  const both = (await h.call('GET', 'feed', null, 'types=movie,tv')).body.items;
  assert.ok(both.some(item => item.mediaType === 'tv') && both.some(item => item.mediaType === 'movie'));
  assert.equal(both.some(item => item.mediaType === 'tv' && [11, 12, 13].includes(item.tmdbId)), false, 'watched shows are not suggested');
  const tvPick = both.find(item => item.mediaType === 'tv');
  assert.match(tvPick.reason, /^Because you watched Watched show/);
  const after = await h.call('POST', 'feedback', { tmdbId: tvPick.tmdbId, mediaType: 'tv', action: 'not_interested' }, 'types=movie,tv');
  assert.equal(after.body.items.some(item => item.mediaType === 'tv' && item.tmdbId === tvPick.tmdbId), false);
});

test('settings need Seerr and Jellyfin', () => {
  assert.throws(() => settingsFrom({}, {}), /ZOROFIN_SEERR_URL/);
  assert.deepEqual(settingsFrom({ ZOROFIN_SEERR_URL: 'http://seerr:5055', ZOROFIN_SEERR_API_KEY: 'k' }, { jellyfinUrl: 'http://j/', jellyfinApiKey: 'k' }),
    { seerrUrl: 'http://seerr:5055/', seerrApiKey: 'k', ai: null });
});

test('AI ranking is opt-in and needs the operator\'s key', () => {
  const base = { ZOROFIN_SEERR_URL: 'http://seerr:5055', ZOROFIN_SEERR_API_KEY: 'k' };
  const jf = { jellyfinUrl: 'http://j/', jellyfinApiKey: 'k' };
  assert.equal(settingsFrom({ ...base, ZOROFIN_RECOMMENDATIONS_AI: 'off' }, jf).ai, null);
  assert.throws(() => settingsFrom({ ...base, ZOROFIN_RECOMMENDATIONS_AI: 'anthropic' }, jf), /ZOROFIN_RECOMMENDATIONS_AI_KEY/);
  assert.throws(() => settingsFrom({ ...base, ZOROFIN_RECOMMENDATIONS_AI: 'other' }, jf), /anthropic, openai or off/);
  const ai = settingsFrom({ ...base, ZOROFIN_RECOMMENDATIONS_AI: 'anthropic', ZOROFIN_RECOMMENDATIONS_AI_KEY: 'sk' }, jf).ai;
  assert.equal(ai.url, 'https://api.anthropic.com/v1/messages');
  const local = settingsFrom({ ...base, ZOROFIN_RECOMMENDATIONS_AI: 'openai', ZOROFIN_RECOMMENDATIONS_AI_URL: 'http://ollama:11434/v1/chat/completions', ZOROFIN_RECOMMENDATIONS_AI_MODEL: 'llama3' }, jf).ai;
  assert.deepEqual([local.url, local.model, local.apiKey], ['http://ollama:11434/v1/chat/completions', 'llama3', ''], 'a local server may need no key');
});

test('parseAiPicks keeps titles and years, never ids', () => {
  const text = 'Sure: {"movies":[{"title":"Zodiac","year":2007,"reason":"Like Se7en"},{"title":""},{"title":"Heat","year":"x"}],"shows":[{"title":"Mindhunter","year":2017}]}';
  assert.deepEqual(parseAiPicks(text), [
    { mediaType: 'movie', title: 'Zodiac', year: 2007, reason: 'Like Se7en' },
    { mediaType: 'movie', title: 'Heat', year: null, reason: '' },
    { mediaType: 'tv', title: 'Mindhunter', year: 2017, reason: '' },
  ]);
  assert.deepEqual(parseAiPicks('not json'), []);
});

// AI suggests titles by name; each is looked up in Seerr search before it is shown.
const SEARCH = {
  'Real Pick': [movie(8001, { title: 'Real Pick', releaseDate: '2015-05-01', voteCount: 80 })],
  'Wrong Year': [movie(8002, { title: 'Wrong Year', releaseDate: '1990-01-01' })],
  'On Server': [movie(8003, { title: 'On Server', releaseDate: '2012-01-01' })],
  'Watched': [movie(2, { title: 'Watched', releaseDate: '2020-01-01' })],
  'A Show': [show(8100, { name: 'A Show', firstAirDate: '2014-01-01' })],
};
const AI_REPLY = { movies: [{ title: 'Real Pick', year: 2015, reason: 'Fits Movie 1' }, { title: 'Invented Film', year: 2001 },
  { title: 'Wrong Year', year: 2015 }, { title: 'On Server', year: 2012 }, { title: 'Watched', year: 2020 }], shows: [{ title: 'A Show', year: 2014, reason: 'Fits' }] };

function aiHarness(provider, reply, options = {}) {
  const sent = [];
  const base = harness({ search: query => SEARCH[query] || [], library: [
    { Id: 'e'.repeat(32), Type: 'Movie', Name: 'On Server', ProductionYear: 2012, ProviderIds: { Tmdb: '8003' }, UserData: { Played: false } },
  ] });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-recs-ai-'));
  const requestJson = async (url, opts = {}) => {
    const target = new URL(String(url));
    if (target.host === 'ai.test') { sent.push({ url: target.href, options: opts }); return reply(opts.body); }
    return base.requestJson(url, opts);
  };
  const ai = { provider, apiKey: 'sk-test', url: 'http://ai.test/v1', model: 'm' };
  const module = createRecommendations(
    { dataDir, jellyfinUrl: 'http://jellyfin.test/', jellyfinApiKey: 'k' },
    { settings: { seerrUrl: 'http://seerr.test/', seerrApiKey: 's', ai }, requestJson, now: options.now || (() => Date.parse(`${TODAY}T12:00:00Z`)), log: () => {} },
  );
  return { module, sent, dataDir, call: (method, route, queryOrBody = '') => module.handle({ method, segments: route.split('/'),
    query: new URLSearchParams(typeof queryOrBody === 'string' ? queryOrBody : ''), body: typeof queryOrBody === 'string' ? undefined : queryOrBody, viewer: { id: VIEWER, admin: false } }) };
}
const anthropicReply = (data = AI_REPLY) => () => ({ status: 200, body: { content: [{ type: 'text', text: JSON.stringify(data) }] } });

test('AI picks lead the request row, each verified in Seerr (Anthropic)', async () => {
  const h = aiHarness('anthropic', anthropicReply());
  await h.module.refresh(VIEWER);
  const feed = (await h.call('GET', 'feed', 'types=movie,tv')).body;
  assert.equal(feed.ranking, 'ai');
  const movies = feed.items.filter(item => item.mediaType === 'movie');
  assert.equal(movies[0].tmdbId, 8001);
  assert.equal(movies[0].reason, 'Fits Movie 1');
  const ids = feed.items.map(item => item.tmdbId);
  for (const dropped of [8002, 8003, 2]) assert.equal(ids.includes(dropped), false, `drops ${dropped}`);
  assert.ok(feed.items.some(item => item.mediaType === 'tv' && item.tmdbId === 8100));
  assert.ok(movies.length >= 10, 'TMDB picks fill in behind the AI');
  const body = h.sent[0].options.body;
  assert.equal(h.sent[0].options.headers['x-api-key'], 'sk-test');
  assert.match(body.system, /untrusted data/);
  assert.equal(Object.hasOwn(body, 'temperature'), false, 'modern Claude rejects sampling parameters');
  const history = JSON.parse(body.messages[0].content);
  assert.deepEqual(history.alreadyOnServer, ['On Server (2012)']);
  assert.ok(!JSON.stringify(history).includes(VIEWER), 'no viewer ids go to the AI');
  const library = (await h.call('GET', 'library')).body;
  assert.ok(library.forYou.includes('e'.repeat(32)), 'an AI pick already on the server goes to Home');
});

test('the AI runs at most once a day per viewer, even when taste changes', async () => {
  let clock = Date.parse(`${TODAY}T12:00:00Z`);
  const h = aiHarness('anthropic', anthropicReply(), { now: () => clock });
  await h.module.refresh(VIEWER);
  assert.equal(h.sent.length, 1);
  await h.call('POST', 'feedback', { tmdbId: 8001, action: 'not_interested' });
  clock += 7 * 60 * 60 * 1000;
  await h.module.refresh(VIEWER);
  assert.equal(h.sent.length, 1, 'taste changed, but the cached AI picks are reused');
  const ids = (await h.call('GET', 'feed')).body.items.map(item => item.tmdbId);
  assert.equal(ids.includes(8001), false, 'cached picks are re-checked against new feedback');
  clock += 18 * 60 * 60 * 1000;
  await h.call('POST', 'feedback', { tmdbId: ids[0], action: 'seen' });
  await h.module.refresh(VIEWER);
  assert.equal(h.sent.length, 2, 'a day later the AI runs again');
});

test('AI picks work with OpenAI-compatible services', async () => {
  const h = aiHarness('openai', () => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify(AI_REPLY) } }] } }));
  await h.module.refresh(VIEWER);
  assert.equal((await h.call('GET', 'feed')).body.ranking, 'ai');
  assert.equal(h.sent[0].options.headers.Authorization, 'Bearer sk-test');
});

test('an AI failure falls back to the standard ranking', async () => {
  for (const reply of [() => ({ status: 500, body: {} }), () => ({ status: 200, body: { content: [{ type: 'text', text: 'no idea' }] } }), () => { throw new Error('timeout'); }]) {
    const h = aiHarness('anthropic', reply);
    await h.module.refresh(VIEWER);
    const feed = (await h.call('GET', 'feed')).body;
    assert.equal(feed.state, 'ready');
    assert.equal(feed.ranking, 'standard');
    assert.equal(feed.items[0].tmdbId, 500, 'deterministic order kept');
  }
});

test('an AI outage keeps the fallback for six hours before retrying', async () => {
  let clock = Date.parse(`${TODAY}T12:00:00Z`), reject = true;
  const h = aiHarness('anthropic', body => (reject ? { status: 503, body: {} } : anthropicReply()(body)), { now: () => clock });
  await h.module.refresh(VIEWER);
  await h.module.refresh(VIEWER);
  assert.equal(h.sent.length, 1, 'immediate requests reuse the fallback');
  clock += 6 * 60 * 60 * 1000 + 1;
  reject = false;
  await h.call('GET', 'feed');
  await h.module.refresh(VIEWER);
  assert.equal((await h.call('GET', 'feed')).body.ranking, 'ai');
  assert.equal(h.sent.length, 2);
});

test('Home picks: TMDB recommendations for recent watches, kept only when on the server and unwatched', async () => {
  const lib = (n, tmdb, extra = {}) => ({ Id: n.repeat(32), Type: 'Movie', Name: `Library ${n}`, ProductionYear: 2010, ProviderIds: { Tmdb: String(tmdb) }, UserData: { Played: false }, ...extra });
  const library = [
    lib('1', 1, { UserData: { Played: true } }), lib('2', 2, { UserData: { Played: true } }), lib('3', 3, { UserData: { Played: true } }),
    lib('a', 500), lib('b', 101), lib('c', 102), lib('d', 103), lib('f', 201, { UserData: { Played: true } }),
  ];
  const h = harness({ library });
  await h.module.refresh(VIEWER);
  const body = (await h.call('GET', 'library')).body;
  assert.equal(body.state, 'ready');
  assert.equal(body.forYou[0], 'a'.repeat(32), 'every seed agrees on it');
  assert.equal(body.forYou.includes('f'.repeat(32)), false, 'watched titles are left out');
  assert.equal(body.forYou.includes('1'.repeat(32)), false, 'seeds are left out');
  assert.equal(body.because[0].seedName, 'Library 1');
  assert.ok(body.because[0].itemIds.includes('b'.repeat(32)));
});

test('Pick Together likes push unwatched titles into Home picks; skips keep them out', async () => {
  const lib = (n, tmdb, extra = {}) => ({ Id: n.repeat(32), Type: 'Movie', Name: `Library ${n}`, ProductionYear: 2010, ProviderIds: { Tmdb: String(tmdb) }, UserData: { Played: false }, ...extra });
  const library = [lib('1', 1, { UserData: { Played: true } }), lib('2', 2, { UserData: { Played: true } }), lib('3', 3, { UserData: { Played: true } }),
    lib('a', 500), lib('b', 101), lib('c', 7777)];
  const h = harness({ library });
  const at = Date.parse(`${TODAY}T10:00:00Z`);
  recordGroupSwipe(h.dataDir, VIEWER, 'c'.repeat(32), 'like', at);
  recordGroupSwipe(h.dataDir, VIEWER, 'a'.repeat(32), 'skip', at);
  recordGroupSwipe(h.dataDir, VIEWER, '../x', 'like', at);
  await h.module.refresh(VIEWER);
  const body = (await h.call('GET', 'library')).body;
  assert.ok(body.forYou.includes('c'.repeat(32)), 'liked with friends, not watched yet');
  assert.equal(body.forYou.includes('a'.repeat(32)), false, 'skipped in a group');
  assert.ok(h.calls.some(call => call.startsWith('/api/v1/movie/7777/recommendations')), 'a group like is also a (weaker) seed');
});

test('Home picks fall back to shared director and cast, then genre', async () => {
  const seedId = '1'.repeat(32), director = '9'.repeat(32), actor = '5'.repeat(32);
  const library = [{ Id: seedId, Type: 'Movie', Name: 'Seed', ProductionYear: 2005, ProviderIds: { Tmdb: '1' }, UserData: { Played: true } }];
  const h = harness({
    played: [watched(1)], library,
    recommendations: () => [],
    catalog: { [seedId]: { Id: seedId, Type: 'Movie', Name: 'Seed', Genres: ['Crime'], People: [{ Id: director, Type: 'Director' }, { Id: actor, Type: 'Actor' }] } },
    people: [
      { Id: 'b'.repeat(32), Name: 'Same director', ProductionYear: 2007, Genres: ['Crime'], People: [{ Id: director }], UserData: {} },
      { Id: '6'.repeat(32), Name: 'One shared actor', ProductionYear: 2007, Genres: ['Crime'], People: [{ Id: actor }], UserData: {} },
      { Id: 'c'.repeat(32), Name: 'Watched already', ProductionYear: 2007, People: [{ Id: director }], UserData: { Played: true } },
    ],
    genreRows: ['d', 'e', 'f', 'a', '8', '7'].map(n => ({ Id: n.repeat(32), Name: `Genre ${n}`, ProductionYear: 2004, Genres: ['Crime'], UserData: {} })),
  });
  await h.module.refresh(VIEWER);
  const body = (await h.call('GET', 'library')).body;
  assert.equal(body.because[0].itemIds[0], 'b'.repeat(32), 'shared director first');
  assert.equal(body.because[0].itemIds.includes('c'.repeat(32)), false);
  assert.equal(body.because[0].itemIds.includes('6'.repeat(32)), false, 'one shared actor is not enough');
  assert.ok(body.because[0].itemIds.includes('d'.repeat(32)), 'genre fills the rest');
});

test('Catch Up likes are isolated taste preferences and can seed requests without watch history', async t => {
  const itemId = 'a'.repeat(32);
  const h = harness({ played: [], catalog: { [itemId]: {
    Id: itemId, Type: 'Movie', Name: 'A liked film', ProviderIds: { Tmdb: '13' },
    UserData: { Played: false, Likes: false, IsFavorite: false }, Genres: ['Mystery'],
  } } });
  t.after(() => fs.rmSync(h.dataDir, { recursive: true, force: true }));
  const result = await h.call('POST', 'taste', { itemId, action: 'like' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { schemaVersion: 1, likedItemIds: [itemId] });
  await h.module.refresh(VIEWER);
  assert.ok(h.calls.some(call => call.startsWith('/api/v1/movie/13/')), 'explicit taste becomes a recommendation seed');
  assert.equal((await h.call('GET', 'feed')).body.state, 'ready');
  assert.deepEqual(h.jellyfinWrites, [], 'never writes watched, rating, favorite or watchlist data');
  const other = await h.module.handle({ method: 'GET', segments: ['taste'], viewer: { id: 'b'.repeat(32) } });
  assert.deepEqual(other.body.likedItemIds, []);
  assert.equal((await h.call('POST', 'taste', { itemId, action: 'skip' })).status, 400, 'skip is not a negative preference');
  await h.call('POST', 'taste', { itemId, action: 'remove' });
  assert.deepEqual((await h.call('GET', 'taste')).body.likedItemIds, []);
});

test('Catch Up taste validates current viewer access and stores show preferences separately from watch data', async t => {
  const itemId = 'c'.repeat(32), hidden = 'd'.repeat(32);
  const h = harness({ catalog: { [itemId]: { Id: itemId, Type: 'Series', Name: 'A show', ProviderIds: { Tmdb: '100' } } } });
  t.after(() => fs.rmSync(h.dataDir, { recursive: true, force: true }));
  assert.equal((await h.call('POST', 'taste', { itemId: '../x', action: 'like' })).status, 400);
  assert.equal((await h.call('POST', 'taste', { itemId: hidden, action: 'like' })).status, 404);
  assert.equal((await h.call('POST', 'taste', { itemId, action: 'like' })).status, 200);
  await h.module.refresh(VIEWER);
  assert.deepEqual((await h.call('GET', 'taste')).body.likedItemIds, [itemId]);
  assert.deepEqual(h.jellyfinWrites, []);
  const other = await h.module.handle({ method: 'POST', segments: ['taste'], body: { itemId, action: 'like' }, viewer: { id: 'b'.repeat(32) } });
  assert.equal(other.status, 404);
});
