'use strict';

// pickTogether: a small group swipes Like or Skip on their own phones and the
// titles everyone liked become the group's matches. Design and contract:
// docs/PICK_TOGETHER.md in the source repository.
//
// - Only titles already in the library are offered, and only ones every voter
//   can see in Jellyfin (library access and parental limits per account).
// - One shared pool per round, so matches are possible, with a personal order
//   per seat from that person's watch history, favorites, Catch Up likes and
//   (when Seerr is configured) their own requests.
// - A session is Movies or Shows, never both.
// - Group swipes do not change anyone's Catch Up taste, watched state or
//   favorites. Each voter's own swipes are kept for their own
//   recommendations only (a weaker signal than a solo like). Results show
//   like counts, never who skipped.
// - A TV can host as a display: it creates the session and shows the lobby
//   and matches, but has no vote. Phones and browsers vote.
// Sessions are small JSON in the companion data folder, so a restart keeps them.

const crypto = require('crypto');
const path = require('path');
const { httpUrl } = require('../../config');
const { readJsonFile, readSecret, requestJson, writePrivateJson } = require('../../lib/io');
const { cleanText, jellyfinId } = require('../../lib/text');
const { readTasteItems, recordGroupSwipe } = require('../recommendations');

const ID = 'pickTogether';
const VERSION = 1;
const KINDS = { movie: 'Movie', series: 'Series' };
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LENGTH = 6;
const MAX_VOTERS = 8;
const MAX_SEATS = 12;
const MAX_SEATS_PER_ACCOUNT = 3;
const MAX_SESSIONS = 200;
const ROUND_SIZE = 20;
const CROWD_PICKS = 4;
const IDLE_MS = 3 * 60 * 60 * 1000;
const ENDED_MS = 30 * 60 * 1000;
const LIBRARY_FIELDS = 'Genres,ProviderIds,OfficialRating,CommunityRating,ProductionYear,ChildCount';

function settingsFrom(env, config) {
  const missing = [!config.jellyfinUrl && 'ZOROFIN_JELLYFIN_URL', !config.jellyfinApiKey && 'ZOROFIN_JELLYFIN_API_KEY'].filter(Boolean);
  if (missing.length) throw new Error(`needs ${missing.join(' and ')} to read each member's library`);
  // Seerr is optional: it only adds "you requested this" as a signal.
  const seerrUrl = httpUrl(env.ZOROFIN_SEERR_URL);
  const seerrApiKey = readSecret(env, 'ZOROFIN_SEERR_API_KEY');
  return { seerrUrl: seerrUrl && seerrApiKey ? seerrUrl : null, seerrApiKey: seerrUrl && seerrApiKey ? seerrApiKey : null };
}

function normaliseCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function hashNumber(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest().readUInt32BE(0) / 0xffffffff;
}

// Weights genres from what a person watched, favorited and liked.
function tasteProfile({ played = [], favorites = [], liked = [] }) {
  const weights = new Map();
  const add = (genres, weight) => (genres || []).forEach(genre => weights.set(genre, (weights.get(genre) || 0) + weight));
  played.forEach(item => add(item.Genres, 1));
  favorites.forEach(item => add(item.Genres, 2));
  liked.forEach(item => add(item.genres, 3));
  const total = [...weights.values()].reduce((sum, value) => sum + value, 0);
  const genres = new Map();
  if (total > 0) weights.forEach((value, genre) => genres.set(genre, value / total));
  const top = [...genres.entries()].sort((a, b) => b[1] - a[1]).map(entry => entry[0]);
  return {
    genres,
    top,
    played: new Set(played.map(item => jellyfinId(item.Id)).filter(Boolean)),
    liked: new Set(liked.map(item => item.itemId)),
    requested: new Set(),
  };
}

// Higher is a better fit for this person. Unknown history still ranks well-rated titles first.
function scoreFor(profile, item) {
  let genreFit = 0;
  (item.genres || []).forEach(genre => { genreFit += profile.genres.get(genre) || 0; });
  let score = Math.min(genreFit, 1) * 3 + (item.communityRating || 6) / 10;
  if (profile.liked.has(item.itemId)) score += 2;
  if (item.tmdbId && profile.requested.has(item.tmdbId)) score += 2.5;
  if (profile.played.has(item.itemId)) score -= 0.8;
  return score;
}

function reasonFor(profile, item, seen) {
  if (item.tmdbId && profile.requested.has(item.tmdbId)) return 'You requested this';
  if (profile.liked.has(item.itemId)) return 'You liked this in Catch Up';
  if (seen === 'partway') return 'You’re partway through';
  if (seen === 'watched') return 'You’ve seen this';
  const genre = (item.genres || []).find(g => profile.top.slice(0, 3).includes(g));
  return genre ? `Because you watch ${genre}` : '';
}

// One shared pool: each voter's best picks in turn, then a few well-rated
// titles nobody has watched. Returns item ids.
function buildPool(rankings, crowd, size = ROUND_SIZE, used = new Set()) {
  const pool = [], seen = new Set(used);
  const personal = Math.max(size - CROWD_PICKS, 1);
  const cursors = rankings.map(() => 0);
  let progress = true;
  while (pool.length < personal && progress) {
    progress = false;
    rankings.forEach((list, index) => {
      while (cursors[index] < list.length && seen.has(list[cursors[index]])) cursors[index]++;
      if (pool.length < personal && cursors[index] < list.length) {
        const id = list[cursors[index]++];
        seen.add(id); pool.push(id); progress = true;
      }
    });
  }
  for (const id of crowd) {
    if (pool.length >= size) break;
    if (!seen.has(id)) { seen.add(id); pool.push(id); }
  }
  // Top up from anyone's list when the crowd list runs short.
  for (const list of rankings) for (const id of list) {
    if (pool.length >= size) break;
    if (!seen.has(id)) { seen.add(id); pool.push(id); }
  }
  return pool;
}

// Seat order: own fit first, but other members' favourites mixed in early so
// overlap shows up within the first cards. A small per-seat jitter keeps
// everyone's order a little different.
function deckOrder(pool, seatScores, otherScores, salt) {
  return [...pool].sort((a, b) => {
    const value = id => 0.6 * (seatScores.get(id) || 0) + 0.4 * (otherScores.get(id) || 0) + 0.3 * hashNumber(salt, id);
    return value(b) - value(a);
  });
}

// Everyone active liked it = match; with three or more voters, all but one = almost.
function tally(session) {
  const voters = session.seats.filter(seat => !seat.display && !seat.left);
  const matches = [], almost = [];
  for (const itemId of session.pool) {
    const likes = voters.filter(seat => session.swipes[seat.id] && session.swipes[seat.id][itemId] === 'like').length;
    if (voters.length >= 2 && likes === voters.length) matches.push({ itemId, likes, of: voters.length });
    else if (voters.length >= 3 && likes === voters.length - 1) almost.push({ itemId, likes, of: voters.length });
  }
  const order = (a, b) => (b.likes - a.likes) || ((session.items[b.itemId].groupScore || 0) - (session.items[a.itemId].groupScore || 0));
  return { matches: matches.sort(order), almost: almost.sort(order) };
}

function createPickTogether(config, deps = {}) {
  const settings = deps.settings || settingsFrom(deps.env || process.env, config);
  const send = deps.requestJson || requestJson;
  const now = deps.now || Date.now;
  const random = deps.randomBytes || crypto.randomBytes;
  const log = deps.log || (() => {});
  const file = path.join(config.dataDir, ID, 'sessions.json');
  const loaded = readJsonFile(file, null);
  const sessions = new Map(loaded && loaded.schemaVersion === 1 && Array.isArray(loaded.sessions) ? loaded.sessions.map(s => [s.id, s]) : []);
  const names = new Map();
  const building = new Map();

  function save() {
    writePrivateJson(file, { schemaVersion: 1, sessions: [...sessions.values()] }, { compact: true });
  }
  function sweep() {
    let changed = false;
    for (const session of sessions.values()) {
      const limit = session.status === 'ended' ? ENDED_MS : IDLE_MS;
      if (now() - session.updatedAt > limit) { sessions.delete(session.id); changed = true; }
    }
    if (changed) save();
  }
  function touch(session) { session.version++; session.updatedAt = now(); save(); }
  function newCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = random(CODE_LENGTH);
      const code = [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      if (![...sessions.values()].some(s => s.code === code)) return code;
    }
    throw Object.assign(new Error('no free code'), { status: 503 });
  }

  async function jellyfin(pathname, query = {}, maxResponseBytes) {
    const url = new URL(pathname, config.jellyfinUrl);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    const response = await send(url, { headers: { Authorization: `MediaBrowser Token="${config.jellyfinApiKey}"` }, timeout: 20000, maxResponseBytes });
    if (response.status !== 200) throw new Error(`Jellyfin ${pathname.split('/')[0]} returned HTTP ${response.status}`);
    return response.body;
  }
  async function nameOf(userId) {
    if (names.has(userId)) return names.get(userId);
    let name = 'Guest';
    try { name = cleanText((await jellyfin(`Users/${userId}`)).Name, 40) || name; }
    catch (error) { log(`pick together: name lookup failed: ${error.message}`); }
    names.set(userId, name);
    return name;
  }
  function itemsFrom(body) { return (body && Array.isArray(body.Items)) ? body.Items : []; }
  function card(raw) {
    const ticks = Number(raw.RunTimeTicks) || 0;
    return {
      itemId: jellyfinId(raw.Id), type: raw.Type, title: cleanText(raw.Name, 200), year: raw.ProductionYear || null,
      runtimeMinutes: ticks ? Math.round(ticks / 600000000) : null, officialRating: cleanText(raw.OfficialRating, 20) || null,
      communityRating: typeof raw.CommunityRating === 'number' ? Math.round(raw.CommunityRating * 10) / 10 : null,
      genres: (raw.Genres || []).slice(0, 6).map(g => cleanText(g, 60)), seasons: raw.ChildCount || null,
      tmdbId: raw.ProviderIds && /^\d+$/.test(String(raw.ProviderIds.Tmdb || '')) ? Number(raw.ProviderIds.Tmdb) : null,
      imageTag: raw.ImageTags && raw.ImageTags.Primary ? cleanText(raw.ImageTags.Primary, 64) : null,
    };
  }
  function seenState(raw) {
    const data = raw && raw.UserData;
    if (!data) return null;
    if (raw.Type === 'Series') {
      if (data.Played) return 'watched';
      const total = Number(raw.RecursiveItemCount) || 0;
      const partway = (data.PlayedPercentage || 0) > 0 || (total > 0 && data.UnplayedItemCount != null && data.UnplayedItemCount < total);
      return partway ? 'partway' : null;
    }
    return data.Played ? 'watched' : null;
  }

  async function requestedTmdb(userId) {
    if (!settings.seerrUrl) return new Set();
    try {
      const seerr = async (pathname, query) => {
        const url = new URL(`api/v1/${pathname}`, settings.seerrUrl);
        Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
        const response = await send(url, { headers: { 'X-Api-Key': settings.seerrApiKey }, timeout: 15000 });
        if (response.status !== 200) throw new Error(`Seerr returned HTTP ${response.status}`);
        return response.body;
      };
      let seerrUser = null;
      for (let skip = 0; skip < 1000 && !seerrUser; skip += 100) {
        const page = await seerr('user', { take: 100, skip });
        const results = (page && page.results) || [];
        seerrUser = results.find(user => jellyfinId(user.jellyfinUserId) === userId) || null;
        if (results.length < 100) break;
      }
      if (!seerrUser) return new Set();
      const page = await seerr('request', { take: 100, skip: 0, requestedBy: seerrUser.id, sort: 'added' });
      return new Set(((page && page.results) || []).map(r => Number(r.media && r.media.tmdbId)).filter(Number.isInteger));
    } catch (error) {
      log(`pick together: requests unavailable: ${error.message}`);
      return new Set();
    }
  }

  async function profileFor(userId, type) {
    const query = { IncludeItemTypes: type, Recursive: true, Fields: 'Genres', Limit: 300, SortBy: 'DatePlayed', SortOrder: 'Descending' };
    const [played, favorites, requested] = await Promise.all([
      jellyfin(`Users/${userId}/Items`, { ...query, Filters: 'IsPlayed' }).then(itemsFrom),
      jellyfin(`Users/${userId}/Items`, { ...query, Filters: 'IsFavorite', SortBy: 'SortName', SortOrder: 'Ascending' }).then(itemsFrom),
      requestedTmdb(userId),
    ]);
    const liked = readTasteItems(config.dataDir, userId).filter(item => item.type === type);
    const profile = tasteProfile({ played, favorites, liked });
    profile.requested = requested;
    return profile;
  }

  // Builds (or extends) the pool for the current round. Everything the
  // session stores about titles comes from Jellyfin as seen by each member.
  async function buildRound(session) {
    const type = KINDS[session.kind];
    const voters = session.seats.filter(seat => !seat.display && !seat.left);
    const accounts = [...new Set(voters.map(seat => seat.userId))];
    const profiles = new Map();
    for (const userId of accounts) profiles.set(userId, await profileFor(userId, type));
    const library = itemsFrom(await jellyfin(`Users/${accounts[0]}/Items`, {
      IncludeItemTypes: type, Recursive: true, Fields: LIBRARY_FIELDS, ExcludeLocationTypes: 'Virtual',
      ImageTypeLimit: 1, EnableImageTypes: 'Primary', EnableUserData: false,
    }, 40_000_000)).map(card).filter(item => item.itemId && item.title);
    let candidates = library;
    if (session.filters.maxRuntimeMinutes && session.kind === 'movie') {
      candidates = candidates.filter(item => !item.runtimeMinutes || item.runtimeMinutes <= session.filters.maxRuntimeMinutes);
    }
    const byId = new Map(candidates.map(item => [item.itemId, item]));
    const rankings = accounts.map(userId => {
      const profile = profiles.get(userId);
      return candidates.map(item => ({ id: item.itemId, score: scoreFor(profile, item) }))
        .sort((a, b) => b.score - a.score).slice(0, 200).map(entry => entry.id);
    });
    const crowd = candidates.filter(item => accounts.every(userId => !profiles.get(userId).played.has(item.itemId)))
      .sort((a, b) => (b.communityRating || 0) - (a.communityRating || 0)).slice(0, 60).map(item => item.itemId);

    const used = new Set(session.pool);
    let fresh = [];
    // The first account's library may include titles another member cannot
    // see; check with each member and refill until the round is full.
    const hidden = new Set();
    const seen = new Map();
    for (let attempt = 0; attempt < 4 && fresh.length < ROUND_SIZE; attempt++) {
      const proposal = buildPool(rankings, crowd, ROUND_SIZE - fresh.length, new Set([...used, ...fresh, ...hidden]));
      if (!proposal.length) break;
      const visible = new Set(proposal);
      for (const userId of accounts) {
        const rows = itemsFrom(await jellyfin(`Users/${userId}/Items`, { Ids: proposal.join(','), Fields: 'ChildCount,RecursiveItemCount', EnableUserData: true }));
        const ids = new Set(rows.map(row => jellyfinId(row.Id)));
        rows.forEach(row => seen.set(`${userId}:${jellyfinId(row.Id)}`, seenState(row)));
        proposal.forEach(id => { if (!ids.has(id)) { visible.delete(id); hidden.add(id); } });
      }
      fresh = fresh.concat(proposal.filter(id => visible.has(id)));
    }

    for (const id of fresh) {
      const item = byId.get(id);
      const scores = accounts.map(userId => scoreFor(profiles.get(userId), item));
      session.items[id] = { ...item, groupScore: scores.reduce((a, b) => a + b, 0) };
      session.reasons[id] = {};
      for (const userId of accounts) {
        const state = seen.get(`${userId}:${id}`) || null;
        session.reasons[id][userId] = { reason: reasonFor(profiles.get(userId), item, state), seen: state };
      }
    }
    session.pool = session.pool.concat(fresh);
    // Personal order per voting seat over this round's titles.
    for (const seat of voters) {
      const own = new Map(), others = new Map();
      for (const id of fresh) {
        own.set(id, scoreFor(profiles.get(seat.userId), session.items[id]));
        const rest = accounts.filter(userId => userId !== seat.userId);
        others.set(id, rest.length ? rest.reduce((sum, userId) => sum + scoreFor(profiles.get(userId), session.items[id]), 0) / rest.length : 0);
      }
      session.decks[seat.id] = (session.decks[seat.id] || []).concat(deckOrder(fresh, own, others, `${session.id}:${seat.id}`));
    }
    return fresh.length;
  }

  function startBuild(session, nextStatus) {
    if (building.has(session.id)) return building.get(session.id);
    session.status = 'preparing'; touch(session);
    const run = buildRound(session).then(added => {
      session.status = added || session.pool.length ? nextStatus : 'empty';
      session.round = (session.round || 0) + 1;
      touch(session);
    }, error => {
      log(`pick together: could not build a round: ${error.message}`);
      session.status = session.pool.length ? 'swiping' : 'failed';
      touch(session);
    }).finally(() => building.delete(session.id));
    building.set(session.id, run);
    return run;
  }

  function seatsOf(session, userId) { return session.seats.filter(seat => seat.userId === userId && !seat.left); }
  function seatFor(session, viewer, wanted) {
    const own = seatsOf(session, viewer.id);
    if (wanted) return own.find(seat => seat.id === wanted) || null;
    return own.find(seat => !seat.display) || own[0] || null;
  }
  function deckFor(session, seat) {
    const swiped = session.swipes[seat.id] || {};
    // A late joiner gets every title in the pool, in a personal order computed on join.
    const deck = session.decks[seat.id] || [];
    return deck.filter(id => session.pool.includes(id) && !swiped[id]);
  }
  function view(session, viewer, seat) {
    const { matches, almost } = tally(session);
    const voters = session.seats.filter(s => !s.display && !s.left);
    const describe = entry => ({ ...publicCard(session.items[entry.itemId]), likes: entry.likes, of: entry.of });
    return {
      schemaVersion: 1, id: session.id, code: session.code, kind: session.kind, status: session.status, round: session.round || 0,
      version: session.version, filters: session.filters, host: session.hostId === viewer.id,
      seat: seat ? seat.id : null, display: Boolean(seat && seat.display),
      members: session.seats.filter(s => !s.left).map(s => {
        const total = (session.decks[s.id] || []).filter(id => session.pool.includes(id)).length;
        const swiped = Object.keys(session.swipes[s.id] || {}).filter(id => session.pool.includes(id)).length;
        return { seat: s.id, name: s.name, display: s.display, host: s.userId === session.hostId && s.id === hostSeat(session), you: s.userId === viewer.id, swiped, total, done: !s.display && total > 0 && swiped >= total };
      }),
      voters: voters.length, poolSize: session.pool.length,
      matches: matches.map(describe), almost: almost.map(describe),
    };
  }
  function hostSeat(session) {
    const seats = seatsOf(session, session.hostId);
    return (seats.find(s => !s.display) || seats[0] || {}).id;
  }
  function publicCard(item) {
    const { groupScore, tmdbId, ...rest } = item; // eslint-disable-line no-unused-vars
    return rest;
  }
  function addSeat(session, viewer, name, display) {
    if (session.seats.filter(s => !s.left).length >= MAX_SEATS) return { error: 'session_full' };
    if (!display && session.seats.filter(s => !s.display && !s.left).length >= MAX_VOTERS) return { error: 'session_full' };
    if (seatsOf(session, viewer.id).length >= MAX_SEATS_PER_ACCOUNT) return { error: 'too_many_seats' };
    const seat = { id: random(8).toString('hex'), userId: viewer.id, name, display, joinedAt: now() };
    session.seats.push(seat);
    return { seat };
  }
  // A seat joining after the pool exists gets the whole pool in its own order.
  function dealLateSeat(session, seat) {
    if (seat.display || !session.pool.length) return;
    session.decks[seat.id] = deckOrder(session.pool, new Map(), new Map(session.pool.map(id => [id, session.items[id].groupScore || 0])), `${session.id}:${seat.id}`);
  }

  const routes = {
    async 'POST sessions'({ body, viewer }) {
      sweep();
      const kind = body && body.kind;
      if (!KINDS[kind]) return { status: 400, body: { error: 'invalid_kind' } };
      const active = [...sessions.values()].filter(s => s.status !== 'ended');
      if (active.length >= MAX_SESSIONS) return { status: 503, body: { error: 'busy' } };
      const minutes = Number(body.filters && body.filters.maxRuntimeMinutes);
      const filters = kind === 'movie' && Number.isInteger(minutes) && minutes >= 60 && minutes <= 300 ? { maxRuntimeMinutes: minutes } : {};
      const session = {
        id: random(16).toString('hex'), code: newCode(), kind, filters, hostId: viewer.id, status: 'lobby', round: 0,
        version: 1, createdAt: now(), updatedAt: now(), seats: [], pool: [], items: {}, reasons: {}, decks: {}, swipes: {},
      };
      const seatName = cleanText(body.seatName, 40) || await nameOf(viewer.id);
      addSeat(session, viewer, seatName, body.display === true);
      sessions.set(session.id, session); touch(session);
      return { status: 200, body: view(session, viewer, session.seats[0]) };
    },
    async 'POST join'({ body, viewer }) {
      sweep();
      const code = normaliseCode(body && body.code);
      const session = [...sessions.values()].find(s => s.code === code && s.status !== 'ended');
      if (!session) return { status: 404, body: { error: 'code_not_found' } };
      const existing = seatFor(session, viewer);
      const wantsExtra = Boolean(body.seatName) && existing && !existing.display;
      if (existing && !existing.display && !wantsExtra) return { status: 200, body: view(session, viewer, existing) };
      const name = cleanText(body.seatName, 40) || await nameOf(viewer.id);
      const added = addSeat(session, viewer, name, false);
      if (added.error) return { status: 409, body: { error: added.error } };
      dealLateSeat(session, added.seat);
      touch(session);
      return { status: 200, body: view(session, viewer, added.seat) };
    },
  };

  async function sessionRoute({ method, segments, query, body, viewer }) {
    const session = sessions.get(segments[1]);
    if (!session || !/^[0-9a-f]{32}$/.test(segments[1])) return { status: 404, body: { error: 'not_found' } };
    const wanted = (query && typeof query.get === 'function' ? query.get('seat') : null) || (body && body.seat) || null;
    const seat = seatFor(session, viewer, wanted);
    if (!seat) return { status: 403, body: { error: 'not_a_member' } };
    const action = segments[2] || '';
    const isHost = session.hostId === viewer.id;
    const route = `${method} ${action}`;

    if (route === 'GET ') {
      const since = Number(query && typeof query.get === 'function' ? query.get('since') : NaN);
      if (Number.isInteger(since) && since === session.version) return { status: 200, body: { unchanged: true, version: session.version } };
      return { status: 200, body: view(session, viewer, seat) };
    }
    if (route === 'GET deck') {
      if (seat.display) return { status: 409, body: { error: 'display_has_no_deck' } };
      const cards = deckFor(session, seat).map(id => {
        const extra = (session.reasons[id] && session.reasons[id][seat.userId]) || {};
        return { ...publicCard(session.items[id]), reason: extra.reason || '', seen: extra.seen || null };
      });
      return { status: 200, body: { schemaVersion: 1, status: session.status, round: session.round || 0, version: session.version, cards } };
    }
    if (route === 'POST swipes') {
      if (seat.display) return { status: 409, body: { error: 'display_cannot_vote' } };
      if (session.status !== 'swiping') return { status: 409, body: { error: 'not_swiping' } };
      const itemId = jellyfinId(body && body.itemId), choice = body && body.choice;
      if (!itemId || !['like', 'skip'].includes(choice)) return { status: 400, body: { error: 'invalid_swipe' } };
      if (!session.pool.includes(itemId)) return { status: 404, body: { error: 'not_in_session' } };
      const before = new Set(tally(session).matches.map(entry => entry.itemId));
      session.swipes[seat.id] = session.swipes[seat.id] || {};
      session.swipes[seat.id][itemId] = choice;
      touch(session);
      try { recordGroupSwipe(config.dataDir, seat.userId, itemId, choice, now()); } catch (error) { log(`pickTogether: swipe not kept for recommendations (${error.message})`); }
      const match = tally(session).matches.find(entry => entry.itemId === itemId && !before.has(itemId));
      return { status: 200, body: { version: session.version, match: match ? { ...publicCard(session.items[itemId]), likes: match.likes, of: match.of } : null } };
    }
    if (route === 'POST start') {
      if (!isHost) return { status: 403, body: { error: 'host_only' } };
      if (session.status !== 'lobby') return { status: 409, body: { error: 'already_started' } };
      if (!session.seats.some(s => !s.display && !s.left)) return { status: 409, body: { error: 'no_voters' } };
      const run = startBuild(session, 'swiping');
      if (deps.awaitBuild) await run;
      return { status: 200, body: view(session, viewer, seat) };
    }
    if (route === 'POST next-round') {
      if (!isHost) return { status: 403, body: { error: 'host_only' } };
      if (!['swiping', 'empty'].includes(session.status)) return { status: 409, body: { error: 'not_swiping' } };
      const run = startBuild(session, 'swiping');
      if (deps.awaitBuild) await run;
      return { status: 200, body: view(session, viewer, seat) };
    }
    if (route === 'POST end') {
      if (!isHost) return { status: 403, body: { error: 'host_only' } };
      session.status = 'ended'; touch(session);
      return { status: 200, body: view(session, viewer, seat) };
    }
    if (route === 'POST remove') {
      if (!isHost) return { status: 403, body: { error: 'host_only' } };
      const target = session.seats.find(s => s.id === (body && body.seat) && !s.left);
      if (!target || target.userId === session.hostId) return { status: 404, body: { error: 'seat_not_found' } };
      target.left = true; touch(session);
      return { status: 200, body: view(session, viewer, seat) };
    }
    if (route === 'POST leave') {
      seat.left = true;
      if (isHost && !seatsOf(session, viewer.id).length) {
        const next = session.seats.find(s => !s.left && !s.display) || session.seats.find(s => !s.left);
        if (next) session.hostId = next.userId;
        else session.status = 'ended';
      }
      touch(session);
      return { status: 200, body: { left: true } };
    }
    return { status: 404, body: { error: 'Not found' } };
  }

  return {
    id: ID,
    capabilities: () => ({ [ID]: { version: VERSION, enabled: true } }),
    async handle(request) {
      const { method, segments, viewer } = request;
      if (!viewer || !jellyfinId(viewer.id)) return { status: 401, body: { error: 'viewer_required' } };
      const key = `${method} ${segments.join('/')}`;
      if (routes[key]) return routes[key](request);
      if (segments[0] === 'sessions' && segments[1]) return sessionRoute(request);
      return { status: 404, body: { error: 'Not found' } };
    },
    stop() { save(); },
  };
}

module.exports = { ID, buildPool, createPickTogether, deckOrder, normaliseCode, scoreFor, settingsFrom, tally, tasteProfile };
