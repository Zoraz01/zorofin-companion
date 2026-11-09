'use strict';

// liveTvStreams: tells apps how many Live TV streams the server's provider
// allows, how many are in use, and which channel each one is playing, so a
// client can say "1 of 1 in use: ESPN" and offer Join instead of a failed start.
//
// In-use streams come from Jellyfin's own sessions (one stream per distinct
// live channel, since Threadfin and Jellyfin share one upstream connection
// between viewers of the same channel). The limit is the operator's setting,
// or, when Xtream login details are given, the provider's own max_connections.
// The provider's active_cons also reveals streams used outside this server.
//
// Viewers see channel names and counts, never other people's names. Admins
// can see who is watching (unless turned off) and the provider's numbers.
// This is advisory: it does not reserve a stream. Provider and tuner limits
// stay authoritative.

const { httpUrl } = require('../../config');
const { readSecret, requestJson } = require('../../lib/io');
const { cleanText, jellyfinId } = require('../../lib/text');

const ID = 'liveTvStreams';
const VERSION = 1;
const SNAPSHOT_MS = 5000;
const PROGRAMME_MS = 60 * 1000;
const PROVIDER_MS = 2 * 60 * 1000;
const POLICY_MS = 5 * 60 * 1000;
const MAX_LIMIT = 50;

function settingsFrom(env, config) {
  const errors = [];
  const limit = Number(env.ZOROFIN_STREAMS_LIMIT || 1);
  const staleSeconds = Number(env.ZOROFIN_STREAMS_STALE_SECONDS || 90);
  const xtreamUrl = httpUrl(env.ZOROFIN_STREAMS_XTREAM_URL);
  const xtreamUser = String(env.ZOROFIN_STREAMS_XTREAM_USERNAME || '').trim();
  const xtreamPassword = readSecret(env, 'ZOROFIN_STREAMS_XTREAM_PASSWORD');
  const viewerNames = String(env.ZOROFIN_STREAMS_VIEWER_NAMES || 'admins').trim();

  const missing = [!config.jellyfinUrl && 'ZOROFIN_JELLYFIN_URL', !config.jellyfinApiKey && 'ZOROFIN_JELLYFIN_API_KEY'].filter(Boolean);
  if (missing.length) errors.push(`needs ${missing.join(' and ')} to see who is watching Live TV`);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) errors.push(`ZOROFIN_STREAMS_LIMIT must be a whole number from 1 to ${MAX_LIMIT}`);
  if (!Number.isFinite(staleSeconds) || staleSeconds < 30 || staleSeconds > 900) errors.push('ZOROFIN_STREAMS_STALE_SECONDS must be 30 to 900');
  if (xtreamUrl === null) errors.push('ZOROFIN_STREAMS_XTREAM_URL must be a plain http(s) URL');
  const xtreamParts = [xtreamUrl, xtreamUser, xtreamPassword].filter(Boolean).length;
  if (xtreamParts > 0 && xtreamParts < 3) errors.push('ZOROFIN_STREAMS_XTREAM_URL, ZOROFIN_STREAMS_XTREAM_USERNAME and ZOROFIN_STREAMS_XTREAM_PASSWORD go together');
  if (!['admins', 'off'].includes(viewerNames)) errors.push('ZOROFIN_STREAMS_VIEWER_NAMES must be admins or off');
  if (errors.length) throw new Error(errors.join('; '));
  return {
    limit,
    staleMs: staleSeconds * 1000,
    xtream: xtreamParts === 3 ? { url: xtreamUrl, username: xtreamUser, password: xtreamPassword } : null,
    useProviderLimit: env.ZOROFIN_STREAMS_USE_PROVIDER_LIMIT !== '0',
    namesForAdmins: viewerNames === 'admins',
  };
}

function wholeNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < 10000 ? number : null;
}

// Xtream player_api.php answers { user_info: { max_connections, active_cons, exp_date, status } }.
function parseProvider(body) {
  const info = body && typeof body === 'object' ? body.user_info : null;
  if (!info || typeof info !== 'object') return null;
  const expires = Number(info.exp_date);
  return {
    maxConnections: wholeNumber(info.max_connections),
    activeConnections: wholeNumber(info.active_cons),
    status: cleanText(info.status, 40) || null,
    expiresAt: Number.isFinite(expires) && expires > 0 ? new Date(expires * 1000).toISOString() : null,
  };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function createLiveTvStreams(config, deps = {}) {
  const settings = deps.settings || settingsFrom(deps.env || process.env, config);
  const send = deps.requestJson || requestJson;
  const now = deps.now || Date.now;
  const log = deps.log || (() => {});
  const auth = { Authorization: `MediaBrowser Token="${config.jellyfinApiKey}"` };
  const firstSeen = new Map();      // channelId -> ms the stream was first seen in use
  const policies = new Map();       // userId -> { at, liveTv }
  let snapshotCache = null, snapshotPending = null;
  let programmeCache = { at: 0, key: '', byChannel: new Map() };
  let provider = { at: 0, value: null, error: null };
  let providerPending = null;

  async function jellyfin(pathAndQuery) {
    const response = await send(new URL(pathAndQuery, config.jellyfinUrl), { headers: auth, timeout: 8000 });
    if (response.status !== 200) throw new Error(`Jellyfin returned HTTP ${response.status}`);
    return response.body;
  }

  async function liveTvAllowed(viewer) {
    if (viewer.admin) return true;
    const cached = policies.get(viewer.id);
    if (cached && now() - cached.at < POLICY_MS) return cached.liveTv;
    const user = await jellyfin(`Users/${encodeURIComponent(viewer.id)}`);
    const liveTv = Boolean(user && user.Policy && user.Policy.EnableLiveTvAccess);
    policies.set(viewer.id, { at: now(), liveTv });
    return liveTv;
  }

  function providerCheck() {
    if (!settings.xtream) return Promise.resolve(null);
    if (now() - provider.at < PROVIDER_MS) return Promise.resolve(provider.value);
    if (providerPending) return providerPending;
    const url = new URL('player_api.php', settings.xtream.url);
    url.searchParams.set('username', settings.xtream.username);
    url.searchParams.set('password', settings.xtream.password);
    providerPending = send(url, { timeout: 8000, maxResponseBytes: 200000 })
      .then(response => {
        const value = response.status === 200 ? parseProvider(response.body) : null;
        if (!value) throw new Error(`provider returned ${response.status === 200 ? 'no account details' : `HTTP ${response.status}`}`);
        provider = { at: now(), value: { ...value, checkedAt: new Date(now()).toISOString() }, error: null };
        return provider.value;
      })
      .catch(error => {
        // Never log the URL: it carries the provider password.
        const message = cleanText(String(error.message).replace(/https?:\/\/\S+/g, '[provider]'), 160);
        if (provider.error !== message) log(`Live TV provider check failed: ${message}`);
        provider = { at: now(), value: null, error: message };
        return null;
      })
      .finally(() => { providerPending = null; });
    return providerPending;
  }

  async function programmes(channelIds) {
    const key = [...channelIds].sort().join(',');
    if (!key) return new Map();
    if (programmeCache.key === key && now() - programmeCache.at < PROGRAMME_MS) return programmeCache.byChannel;
    const byChannel = new Map();
    try {
      const body = await jellyfin(`LiveTv/Programs?ChannelIds=${encodeURIComponent(key)}&IsAiring=true&EnableImages=false&Limit=${channelIds.length * 2}`);
      for (const item of (body && Array.isArray(body.Items) ? body.Items : [])) {
        const channelId = jellyfinId(item.ChannelId);
        if (channelId && !byChannel.has(channelId)) {
          byChannel.set(channelId, { title: cleanText(item.Name, 160), endsAt: cleanText(item.EndDate, 40) || null });
        }
      }
    } catch (_) {
      // Programme titles are a nicety; streams are still reported without them.
    }
    programmeCache = { at: now(), key, byChannel };
    return byChannel;
  }

  // One entry per live channel being played right now, with its sessions.
  async function snapshot() {
    if (snapshotCache && now() - snapshotCache.at < SNAPSHOT_MS) return snapshotCache.value;
    if (snapshotPending) return snapshotPending;
    snapshotPending = (async () => {
      const [sessions, providerValue] = await Promise.all([
        jellyfin(`Sessions?ActiveWithinSeconds=${Math.ceil(settings.staleMs / 1000)}`),
        providerCheck(),
      ]);
      if (!Array.isArray(sessions)) throw new Error('Jellyfin returned no sessions');
      const time = now();
      const channels = new Map();
      for (const session of sessions) {
        const item = session && session.NowPlayingItem;
        if (!item || item.Type !== 'TvChannel') continue;
        // A NowPlayingItem can outlive a closed player; require a recent check-in.
        const checkIn = Date.parse(session.LastPlaybackCheckIn || session.LastActivityDate || '');
        if (!Number.isFinite(checkIn) || time - checkIn > settings.staleMs) continue;
        const channelId = jellyfinId(item.Id);
        if (!channelId) continue;
        const entry = channels.get(channelId) || {
          channelId,
          channelName: cleanText(item.Name, 120),
          channelNumber: cleanText(item.ChannelNumber || item.Number, 20) || null,
          sessions: [],
        };
        entry.sessions.push({
          userId: jellyfinId(session.UserId),
          userName: cleanText(session.UserName, 80),
          deviceId: cleanText(session.DeviceId, 200),
          deviceName: cleanText(session.DeviceName, 80),
          paused: Boolean(session.PlayState && session.PlayState.IsPaused),
        });
        channels.set(channelId, entry);
      }
      for (const id of [...firstSeen.keys()]) if (!channels.has(id)) firstSeen.delete(id);
      for (const id of channels.keys()) if (!firstSeen.has(id)) firstSeen.set(id, time);
      const titles = await programmes([...channels.keys()]);
      const value = { channels: [...channels.values()], titles, provider: providerValue };
      snapshotCache = { at: now(), value };
      return value;
    })().finally(() => { snapshotPending = null; });
    return snapshotPending;
  }

  function limitFor(providerValue) {
    if (settings.useProviderLimit && providerValue && providerValue.maxConnections > 0) {
      return { limit: providerValue.maxConnections, source: 'provider' };
    }
    return { limit: settings.limit, source: 'setting' };
  }

  async function status(viewer, query) {
    const snap = await snapshot();
    const { limit, source } = limitFor(snap.provider);
    const deviceId = cleanText(query && query.get('deviceId'), 200);
    const requested = jellyfinId(query && query.get('channelId'));
    const inUseHere = snap.channels.length;
    // Streams the provider counts that no Jellyfin viewer explains: another app
    // on the same account, or a relay that hasn't closed yet.
    const active = snap.provider ? snap.provider.activeConnections : null;
    const otherUse = active !== null && active > inUseHere ? active - inUseHere : 0;
    const inUse = inUseHere + otherUse;
    const free = Math.max(0, limit - inUse);
    const showNames = viewer.admin && settings.namesForAdmins;

    const streams = snap.channels
      .sort((a, b) => firstSeen.get(a.channelId) - firstSeen.get(b.channelId))
      .map(entry => {
        const yours = entry.sessions.some(s => s.userId === viewer.id);
        const stream = {
          channelId: entry.channelId,
          channelName: entry.channelName,
          channelNumber: entry.channelNumber,
          programme: snap.titles.get(entry.channelId) || null,
          startedAt: new Date(firstSeen.get(entry.channelId)).toISOString(),
          viewers: entry.sessions.length,
          paused: entry.sessions.every(s => s.paused),
          yours,
        };
        if (showNames) stream.watching = entry.sessions.map(s => ({ name: s.userName, device: s.deviceName, paused: s.paused }));
        return stream;
      });

    const body = {
      version: VERSION,
      state: free > 0 ? 'available' : 'full',
      limit,
      inUse,
      free,
      otherUse,
      streams,
      message: summary(limit, inUse, streams, otherUse),
    };

    if (requested) {
      const playing = snap.channels.some(entry => entry.channelId === requested);
      // Switching channels on the device that alone holds a stream frees it first.
      const ownSlot = Boolean(deviceId) && snap.channels.some(entry =>
        entry.sessions.length > 0 && entry.sessions.every(s => s.userId === viewer.id && s.deviceId === deviceId));
      const canStart = playing || free > 0 || ownSlot;
      body.request = {
        channelId: requested,
        playing,
        canStart,
        reason: playing ? 'join' : free > 0 ? 'free' : ownSlot ? 'switch' : 'full',
        message: playing ? 'This channel is already playing. You can join without using another stream.'
          : free > 0 ? 'A Live TV stream is free.'
            : ownSlot ? 'Starting this channel will stop the one you are watching.'
              : limit === 1 ? 'The Live TV stream is in use on another channel. You can join that channel, or try again when it is free.'
                : `All ${limit} Live TV streams are in use. You can join a channel that is already playing.`,
      };
    }

    if (viewer.admin) {
      body.limitSource = source;
      body.provider = snap.provider ? { ...snap.provider } : (settings.xtream ? { error: provider.error || 'not checked yet' } : null);
      body.warnings = warnings(snap.provider);
    }
    return body;
  }

  function summary(limit, inUse, streams, otherUse) {
    const names = streams.map(s => s.channelName).filter(Boolean);
    if (otherUse) names.push(otherUse === 1 ? 'another app' : `${otherUse} other apps`);
    const head = `${inUse} of ${plural(limit, 'Live TV stream')} in use`;
    return names.length ? `${head}: ${names.join(', ')}.` : `${head}.`;
  }

  function warnings(providerValue) {
    const out = [];
    if (!providerValue) return out;
    if (providerValue.maxConnections !== null && settings.limit > providerValue.maxConnections) {
      out.push(`The provider allows ${plural(providerValue.maxConnections, 'stream')}, fewer than the ${settings.limit} set here.`);
    }
    if (providerValue.status && providerValue.status.toLowerCase() !== 'active') out.push(`The provider reports the account as ${providerValue.status}.`);
    if (providerValue.expiresAt) {
      const days = Math.floor((Date.parse(providerValue.expiresAt) - now()) / 86400000);
      if (days >= 0 && days <= 14) out.push(`The provider account ends in ${plural(days, 'day')}.`);
    }
    return out;
  }

  return {
    id: ID,
    capabilities: () => ({ [ID]: { version: VERSION, enabled: true } }),

    async handle({ method, segments, query, viewer }) {
      const route = `${method} ${segments.join('/')}`;
      if (route !== 'GET status') return { status: 404, body: { error: 'Not found' } };
      try {
        if (!(await liveTvAllowed(viewer))) return { status: 403, body: { error: 'live_tv_not_allowed' } };
        return { status: 200, body: await status(viewer, query) };
      } catch (error) {
        log(`Live TV stream status failed: ${cleanText(error.message, 160)}`);
        return { status: 503, body: { version: VERSION, state: 'unknown', error: 'status_unavailable' } };
      }
    },
  };
}

module.exports = { ID, createLiveTvStreams, parseProvider, settingsFrom };
