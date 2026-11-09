'use strict';

// Xtream Codes ("player_api.php") sources. Only the live catalogue is read,
// never the VOD lists that make some providers' get.php hundreds of MB.

const { encode } = require('../liveTvGuide/xmltv');
const { stamp } = require('./guide');

function apiUrl(source, params) {
  const url = new URL('player_api.php', source.base);
  url.searchParams.set('username', source.username);
  url.searchParams.set('password', source.password);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

function guideUrl(source) {
  const url = new URL('xmltv.php', source.base);
  url.searchParams.set('username', source.username);
  url.searchParams.set('password', source.password);
  return url.href;
}

// Stream formats: "ts" and "m3u8" are the documented /live/ paths; "short"
// (/user/pass/id) is what some panels' own M3U uses.
function streamUrl(source, streamId, format) {
  const user = encodeURIComponent(source.username);
  const pass = encodeURIComponent(source.password);
  const id = encodeURIComponent(String(streamId));
  if (format === 'short') return new URL(`${user}/${pass}/${id}`, source.base).href;
  return new URL(`live/${user}/${pass}/${id}.${format === 'm3u8' ? 'm3u8' : 'ts'}`, source.base).href;
}

// Yields playlist-shaped entries for every live stream.
async function liveCatalog(fetchJson, source, format) {
  const categories = await fetchJson(apiUrl(source, { action: 'get_live_categories' }));
  const streams = await fetchJson(apiUrl(source, { action: 'get_live_streams' }));
  if (!Array.isArray(categories) || !Array.isArray(streams)) throw new Error('the provider did not return its live channel list (check the login)');
  const names = new Map(categories.map(category => [String(category.category_id), String(category.category_name || '')]));
  return streams.map(stream => {
    let group = names.get(String(stream.category_id)) || '';
    if (!group && Array.isArray(stream.category_ids)) {
      const hit = stream.category_ids.map(String).find(id => names.has(id));
      if (hit) group = names.get(hit);
    }
    return {
      name: String(stream.name || '').trim(),
      id: String(stream.epg_channel_id || ''),
      logo: String(stream.stream_icon || ''),
      group,
      streamId: String(stream.stream_id),
      url: streamUrl(source, stream.stream_id, format),
    };
  }).filter(entry => /^\d+$/.test(entry.streamId));
}

function base64Text(value) {
  try { return Buffer.from(String(value || ''), 'base64').toString('utf8'); }
  catch (_) { return String(value || ''); }
}

// The provider's per-channel guide, for channels the full guide misses.
async function shortGuide(fetchJson, source, streamId, channelId) {
  const data = await fetchJson(apiUrl(source, { action: 'get_short_epg', stream_id: streamId, limit: '12' }));
  const listings = (data && Array.isArray(data.epg_listings)) ? data.epg_listings : [];
  const out = [];
  for (const listing of listings) {
    const start = Number(listing.start_timestamp) * 1000;
    const stop = Number(listing.stop_timestamp) * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) continue;
    const title = base64Text(listing.title).trim();
    if (!title) continue;
    const desc = base64Text(listing.description).trim();
    out.push({
      start, stop,
      block: `<programme channel="${encode(channelId)}" start="${stamp(start)}" stop="${stamp(stop)}"><title lang="en">${encode(title)}</title>${desc ? `<desc lang="en">${encode(desc)}</desc>` : ''}</programme>`,
    });
  }
  return out;
}

module.exports = { apiUrl, guideUrl, liveCatalog, shortGuide, streamUrl };
