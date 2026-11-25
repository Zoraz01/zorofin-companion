'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { buildPool, createPickTogether, normaliseCode, tally, tasteProfile, scoreFor } = require('../src/modules/pickTogether');
const { readGroupSwipes, tasteFile } = require('../src/modules/recommendations');

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32), D = 'd'.repeat(32);
const id = n => n.toString(16).padStart(32, '0');
const GENRES = ['Mystery', 'Comedy', 'Drama', 'Action'];

// A fictional library: 60 movies and 10 series. Movie 7 is hidden from C
// (parental limit); A has watched movies 1-3 (all Mystery).
function library() {
  const movies = Array.from({ length: 60 }, (_, i) => ({
    Id: id(i + 1), Name: `Movie ${i + 1}`, Type: 'Movie', ProductionYear: 2000 + (i % 25), RunTimeTicks: (80 + i * 2) * 600000000,
    Genres: [GENRES[i % 4]], CommunityRating: 5 + (i % 5), ProviderIds: { Tmdb: String(1000 + i) }, ImageTags: { Primary: `tag${i}` },
  }));
  const series = Array.from({ length: 10 }, (_, i) => ({ Id: id(500 + i), Name: `Show ${i}`, Type: 'Series', Genres: ['Drama'], CommunityRating: 8, ChildCount: 2 }));
  return { movies, series };
}

function harness({ hiddenFrom = { [C]: [id(7)] }, played = { [A]: [1, 2, 3] }, names = { [A]: 'Ana', [B]: 'Ben', [C]: 'Cy', [D]: 'Dee' } } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-pick-'));
  const { movies, series } = library();
  const writes = [];
  let counter = 0;
  const requestJson = async (url, options = {}) => {
    const target = new URL(String(url));
    if (options.method && options.method !== 'GET') writes.push(target.pathname);
    const user = /^\/Users\/([a-f0-9]{32})$/.exec(target.pathname);
    if (user) return { status: 200, body: { Name: names[user[1]] } };
    const items = /^\/Users\/([a-f0-9]{32})\/Items$/.exec(target.pathname);
    if (!items) throw new Error(`unexpected ${target}`);
    const viewer = items[1], q = target.searchParams;
    let rows = (q.get('IncludeItemTypes') === 'Series' ? series : movies).concat(q.get('Ids') ? series : []);
    rows = rows.filter(row => !(hiddenFrom[viewer] || []).includes(row.Id));
    const mine = new Set((played[viewer] || []).map(id));
    if (q.get('Filters') === 'IsPlayed') rows = rows.filter(row => mine.has(row.Id));
    if (q.get('Filters') === 'IsFavorite') rows = [];
    if (q.get('Ids')) {
      const wanted = new Set(q.get('Ids').split(','));
      rows = rows.filter(row => wanted.has(row.Id)).map(row => ({ ...row, UserData: { Played: mine.has(row.Id) } }));
    }
    return { status: 200, body: { Items: rows } };
  };
  const randomBytes = size => crypto.createHash('sha256').update(String(counter++)).digest().subarray(0, size);
  const module = createPickTogether({ dataDir, jellyfinUrl: 'http://jellyfin.test/', jellyfinApiKey: 'k' },
    { settings: { seerrUrl: null }, requestJson, randomBytes, awaitBuild: true, now: () => Date.parse('2026-11-17T20:00:00Z') });
  const call = (viewer, method, route, body, query = '') => module.handle({
    method, segments: route.split('/').filter(Boolean), query: new URLSearchParams(query), body, viewer: { id: viewer, admin: false },
  });
  return { module, call, dataDir, writes };
}

async function startedGroup(h, members = [A, B]) {
  const created = await h.call(members[0], 'POST', 'sessions', { kind: 'movie' });
  assert.equal(created.status, 200);
  for (const member of members.slice(1)) {
    const joined = await h.call(member, 'POST', 'join', { code: created.body.code.toLowerCase().replace(/(...)/, '$1-') });
    assert.equal(joined.status, 200, JSON.stringify(joined.body));
  }
  const started = await h.call(members[0], 'POST', `sessions/${created.body.id}/start`, {});
  assert.equal(started.body.status, 'swiping');
  return created.body.id;
}

test('codes are short, readable and forgiving when typed', () => {
  assert.equal(normaliseCode(' k7p-4qm '), 'K7P4QM');
  assert.equal(normaliseCode('a b c'), 'ABC');
});

test('the shared pool takes each person’s picks in turn, then crowd picks, without repeats', () => {
  // Size 8 leaves 4 personal slots, then 4 crowd picks.
  const pool = buildPool([['x1', 'x2', 'x3'], ['y1', 'x1', 'y2']], ['c1', 'x2', 'c2'], 8);
  assert.deepEqual(pool, ['x1', 'y1', 'x2', 'y2', 'c1', 'c2', 'x3']);
});

test('history and Catch Up likes raise a title for that person only', () => {
  const profile = tasteProfile({ played: [{ Id: id(1), Genres: ['Mystery'] }], liked: [{ itemId: id(9), genres: ['Comedy'] }] });
  const mystery = { itemId: id(5), genres: ['Mystery'], communityRating: 6 };
  const action = { itemId: id(6), genres: ['Action'], communityRating: 6 };
  assert.ok(scoreFor(profile, mystery) > scoreFor(profile, action));
  assert.ok(scoreFor(profile, { itemId: id(9), genres: ['Comedy'], communityRating: 6 }) > scoreFor(profile, mystery));
});

test('a group gets one shared pool of about 20 titles, everyone can see every title, and decks differ in order', async () => {
  const h = harness();
  const sessionId = await startedGroup(h, [A, B, C]);
  const deckA = (await h.call(A, 'GET', `sessions/${sessionId}/deck`)).body.cards;
  const deckC = (await h.call(C, 'GET', `sessions/${sessionId}/deck`)).body.cards;
  assert.equal(deckA.length, 20);
  assert.deepEqual(new Set(deckA.map(c => c.itemId)), new Set(deckC.map(c => c.itemId)));
  assert.ok(!deckA.some(c => c.itemId === id(7)), 'a title one member cannot see is never offered');
  assert.notDeepEqual(deckA.map(c => c.itemId), deckC.map(c => c.itemId));
  assert.ok(deckA.every(c => c.type === 'Movie'), 'Movies sessions never show series');
  assert.ok(!('tmdbId' in deckA[0]) && !('groupScore' in deckA[0]));
  const seenCard = deckA.find(c => c.seen === 'watched');
  if (seenCard) assert.equal(seenCard.reason, 'You’ve seen this');
  assert.deepEqual(h.writes, [], 'nothing is written to Jellyfin');
});

test('a match needs every voter; three or more voters also see "almost"; counts only, no names', async () => {
  const h = harness();
  const sessionId = await startedGroup(h, [A, B, C]);
  const deck = (await h.call(A, 'GET', `sessions/${sessionId}/deck`)).body.cards.map(c => c.itemId);
  const [first, second] = deck;
  await h.call(A, 'POST', `sessions/${sessionId}/swipes`, { itemId: first, choice: 'like' });
  await h.call(B, 'POST', `sessions/${sessionId}/swipes`, { itemId: first, choice: 'like' });
  let state = (await h.call(B, 'GET', `sessions/${sessionId}`)).body;
  assert.equal(state.matches.length, 0);
  assert.deepEqual(state.almost.map(e => [e.itemId, e.likes, e.of]), [[first, 2, 3]]);
  const last = await h.call(C, 'POST', `sessions/${sessionId}/swipes`, { itemId: first, choice: 'like' });
  assert.equal(last.body.match.itemId, first);
  await h.call(A, 'POST', `sessions/${sessionId}/swipes`, { itemId: second, choice: 'skip' });
  state = (await h.call(C, 'GET', `sessions/${sessionId}`)).body;
  assert.deepEqual(state.matches.map(e => [e.itemId, e.likes, e.of]), [[first, 3, 3]]);
  assert.ok(!JSON.stringify(state).includes('skip'), 'results never reveal who skipped');
  assert.equal(state.members.find(m => m.you).swiped, 1);
});

test('only members can read a session, swipes outside the pool are refused, and polling returns unchanged', async () => {
  const h = harness();
  const sessionId = await startedGroup(h);
  assert.equal((await h.call(D, 'GET', `sessions/${sessionId}`)).status, 403);
  assert.equal((await h.call(A, 'POST', `sessions/${sessionId}/swipes`, { itemId: id(55555), choice: 'like' })).status, 404);
  assert.equal((await h.call(A, 'POST', `sessions/${sessionId}/swipes`, { itemId: id(1), choice: 'love' })).status, 400);
  const state = (await h.call(A, 'GET', `sessions/${sessionId}`)).body;
  assert.deepEqual((await h.call(A, 'GET', `sessions/${sessionId}`, null, `since=${state.version}`)).body, { unchanged: true, version: state.version });
  assert.equal((await h.call(B, 'POST', `sessions/${sessionId}/end`, {})).status, 403, 'only the host ends');
  assert.equal((await h.call(A, 'POST', 'join', { code: 'NOPE00' })).status, 404);
});

test('a TV hosts as a display with no vote, and the same account can still vote from a phone', async () => {
  const h = harness();
  const tv = await h.call(A, 'POST', 'sessions', { kind: 'series', display: true });
  assert.equal(tv.body.display, true);
  const tvSeat = tv.body.seat;
  const phone = await h.call(A, 'POST', 'join', { code: tv.body.code });
  assert.notEqual(phone.body.seat, tvSeat);
  await h.call(B, 'POST', 'join', { code: tv.body.code });
  await h.call(A, 'POST', `sessions/${tv.body.id}/start`, { seat: tvSeat });
  assert.equal((await h.call(A, 'GET', `sessions/${tv.body.id}/deck`, null, `seat=${tvSeat}`)).status, 409);
  const deck = (await h.call(A, 'GET', `sessions/${tv.body.id}/deck`, null, `seat=${phone.body.seat}`)).body.cards;
  assert.ok(deck.length > 0 && deck.every(c => c.type === 'Series'), 'Shows sessions never show movies');
  const state = (await h.call(A, 'GET', `sessions/${tv.body.id}`, null, `seat=${tvSeat}`)).body;
  assert.equal(state.voters, 2);
});

test('a late joiner gets the whole pool, and sessions survive a restart', async () => {
  const h = harness();
  const sessionId = await startedGroup(h);
  const code = (await h.call(A, 'GET', `sessions/${sessionId}`)).body.code;
  await h.call(C, 'POST', 'join', { code });
  const late = (await h.call(C, 'GET', `sessions/${sessionId}/deck`)).body.cards;
  assert.equal(late.length, 20);
  const again = createPickTogether({ dataDir: h.dataDir, jellyfinUrl: 'http://jellyfin.test/', jellyfinApiKey: 'k' }, { settings: { seerrUrl: null }, now: () => Date.parse('2026-11-17T20:30:00Z') });
  const state = await again.handle({ method: 'GET', segments: ['sessions', sessionId], query: new URLSearchParams(), viewer: { id: B } });
  assert.equal(state.body.status, 'swiping');
});

test('Catch Up likes are read but never written by group swipes', async () => {
  const h = harness();
  const file = tasteFile(h.dataDir, B);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, items: [{ itemId: id(40), type: 'Movie', genres: ['Mystery'] }] }));
  const before = fs.readFileSync(file, 'utf8');
  const sessionId = await startedGroup(h);
  const deck = (await h.call(B, 'GET', `sessions/${sessionId}/deck`)).body.cards;
  const liked = deck.find(c => c.itemId === id(40));
  assert.ok(liked, 'a title the person liked in Catch Up is in their deck');
  assert.equal(liked.reason, 'You liked this in Catch Up');
  await h.call(B, 'POST', `sessions/${sessionId}/swipes`, { itemId: deck[0].itemId, choice: 'like' });
  await h.call(B, 'POST', `sessions/${sessionId}/swipes`, { itemId: deck[1].itemId, choice: 'skip' });
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(readGroupSwipes(h.dataDir, B).map(item => [item.itemId, item.choice]),
    [[deck[0].itemId, 'like'], [deck[1].itemId, 'skip']], 'each voter\'s own swipes are kept for their own recommendations');
  assert.deepEqual(readGroupSwipes(h.dataDir, A), [], 'never shared with other voters');
});

test('tally ignores people who left', () => {
  const session = { pool: ['x'], items: { x: {} }, seats: [{ id: 's1' }, { id: 's2' }, { id: 's3', left: true }], swipes: { s1: { x: 'like' }, s2: { x: 'like' } } };
  assert.equal(tally(session).matches.length, 1);
});
