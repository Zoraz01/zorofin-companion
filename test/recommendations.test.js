'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecommendations, buildSignals, parseAiRanking, rank, settingsFrom } = require('../src/modules/recommendations');

const VIEWER = '4f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f';
const TODAY = '2026-10-29';

function movie(id, overrides = {}) {
  return {
    id, mediaType: 'movie', title: `Movie ${id}`, posterPath: `/p${id}.jpg`, overview: 'A film.',
    releaseDate: '2020-01-01', voteCount: 500, voteAverage: 7, ...overrides,
  };
}

function watched(id, extra = {}) {
  return { Id: `j${id}`, ProviderIds: { Tmdb: String(id) }, UserData: { Played: true, PlayCount: 1, ...extra } };
}

function harness({ played = [watched(1), watched(2), watched(3)], favorites = [], seerrUsers = [{ id: 7, jellyfinUserId: VIEWER }], requests = [] } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-recs-'));
  const calls = [];
  const requestJson = async url => {
    const target = new URL(String(url));
    calls.push(target.pathname + target.search);
    if (target.host === 'jellyfin.test') {
      return { status: 200, body: { Items: target.searchParams.get('Filters') === 'IsPlayed' ? played : favorites } };
    }
    if (target.pathname === '/api/v1/user') return { status: 200, body: { results: seerrUsers } };
    if (target.pathname === '/api/v1/request') return { status: 200, body: { results: requests } };
    const match = /^\/api\/v1\/movie\/(\d+)\/(recommendations|similar)$/.exec(target.pathname);
    if (match) {
      const seed = Number(match[1]);
      // Each seed recommends 100+seed..., all overlap on 500 so it ranks first.
      const results = [movie(500), ...Array.from({ length: 12 }, (_, index) => movie(seed * 100 + index))];
      results.push(movie(900, { mediaInfo: { status: 5 } }), movie(901, { adult: true }), movie(902, { releaseDate: '2099-01-01' }), movie(1));
      return { status: 200, body: { results } };
    }
    throw new Error(`unexpected ${target}`);
  };
  const module = createRecommendations(
    { dataDir, jellyfinUrl: 'http://jellyfin.test/', jellyfinApiKey: 'k' },
    { settings: { seerrUrl: 'http://seerr.test/', seerrApiKey: 's' }, requestJson, now: () => Date.parse(`${TODAY}T12:00:00Z`) },
  );
  const call = (method, route, body) => module.handle({ method, segments: route.split('/'), body, viewer: { id: VIEWER, admin: false } });
  return { module, calls, call, requestJson };
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

test('signals weigh favorites and more-like-this above plain watches', () => {
  const signals = buildSignals([watched(1)], [watched(2)], [], [{ tmdbId: 3, action: 'more_like_this' }]);
  assert.deepEqual(signals.map(signal => signal.tmdbId), [3, 2, 1]);
  assert.deepEqual(rank([{ movie: movie(5, { voteCount: 10 }), weight: 1 }], new Set(), TODAY), []);
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

test('parseAiRanking keeps known, unique ids in the model\'s order', () => {
  const known = new Set([1, 2, 3]);
  const text = 'Sure: {"recommendations":[{"tmdbId":2,"reason":"Because you liked X"},{"tmdbId":99},{"tmdbId":2},{"tmdbId":"1"}]}';
  assert.deepEqual(parseAiRanking(text, known), [{ tmdbId: 2, reason: 'Because you liked X' }, { tmdbId: 1, reason: '' }]);
  assert.deepEqual(parseAiRanking('not json', known), []);
});

function aiHarness(provider, reply) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-recs-ai-'));
  const sent = [];
  const base = harness();
  const requestJson = async (url, options = {}) => {
    const target = new URL(String(url));
    if (target.host === 'ai.test') { sent.push({ url: target.href, options }); return reply(options.body); }
    return base.requestJson(url, options);
  };
  const ai = { provider, apiKey: 'sk-test', url: 'http://ai.test/v1', model: 'm' };
  const module = createRecommendations(
    { dataDir, jellyfinUrl: 'http://jellyfin.test/', jellyfinApiKey: 'k' },
    { settings: { seerrUrl: 'http://seerr.test/', seerrApiKey: 's', ai }, requestJson, now: () => Date.parse(`${TODAY}T12:00:00Z`), log: () => {} },
  );
  return { module, sent, call: (method, route) => module.handle({ method, segments: route.split('/'), viewer: { id: VIEWER, admin: false } }) };
}

test('AI ranking reorders requestable candidates and adds reasons (Anthropic)', async () => {
  const h = aiHarness('anthropic', body => {
    const ids = JSON.parse(body.messages[0].content).candidates.map(c => c.tmdbId).reverse();
    return { status: 200, body: { content: [{ type: 'text', text: JSON.stringify({ recommendations: ids.slice(0, 20).map(id => ({ tmdbId: id, reason: `pick ${id}` })).concat([{ tmdbId: 424242 }]) }) }] } };
  });
  await h.module.refresh(VIEWER);
  const feed = (await h.call('GET', 'feed')).body;
  assert.equal(feed.ranking, 'ai');
  assert.equal(feed.items.length, 20);
  assert.ok(feed.items.every(item => item.reason === `pick ${item.tmdbId}`), 'reasons attached');
  assert.ok(!feed.items.some(item => item.tmdbId === 424242), 'invented ids dropped');
  assert.equal(h.sent[0].options.headers['x-api-key'], 'sk-test');
  assert.match(h.sent[0].options.body.system, /untrusted data/);
});

test('AI ranking works with OpenAI-compatible services', async () => {
  const h = aiHarness('openai', body => {
    const ids = JSON.parse(body.messages[1].content).candidates.map(c => c.tmdbId);
    return { status: 200, body: { choices: [{ message: { content: JSON.stringify({ recommendations: ids.slice(5, 25).map(id => ({ tmdbId: id })) }) } }] } };
  });
  await h.module.refresh(VIEWER);
  const feed = (await h.call('GET', 'feed')).body;
  assert.equal(feed.ranking, 'ai');
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
