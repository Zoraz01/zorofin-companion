'use strict';

// Guide (XMLTV) handling for liveTvSource: stream a large guide, keep only the
// channels we serve, and merge several guides so a backup fills any channel
// the first one leaves empty.

const { decode, encode } = require('../liveTvGuide/xmltv');

const KEEP_PAST_MS = 6 * 60 * 60 * 1000;

// "20261102180000 +0000" -> ms. The offset is optional (UTC when missing).
function xmltvTime(text) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?(\d{2})?/.exec(String(text || '').trim());
  if (!match) return NaN;
  const [, y, mo, d, h, mi, s = '00', sign, oh = '00', om = '00'] = match;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const offset = sign ? (sign === '-' ? -1 : 1) * (+oh * 60 + +om) * 60000 : 0;
  return utc - offset;
}

function stamp(ms) {
  const date = new Date(ms);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`;
}

function attribute(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? decode(match[1]) : '';
}

// Names that differ only in decoration ("US| ESPN HD" vs "ESPN") match.
function nameKey(name) {
  return decode(String(name || '')).toLowerCase()
    .replace(/^\s*[a-z]{2,4}\s*[|:]\s*/, '')
    .replace(/\b(?:fhd|uhd|hd|sd|4k|hevc|h265|1080p|720p)\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Calls onBlock(kind, block) for each <channel> and <programme> in a stream
// of XMLTV text chunks.
async function scanXmltv(chunks, onBlock) {
  let buffer = '';
  for await (const chunk of chunks) {
    buffer += chunk;
    let at = 0;
    for (;;) {
      const channel = buffer.indexOf('<channel', at);
      const programme = buffer.indexOf('<programme', at);
      const start = channel < 0 ? programme : programme < 0 ? channel : Math.min(channel, programme);
      if (start < 0) { at = Math.max(at, buffer.length - 12); break; }
      const kind = start === programme ? 'programme' : 'channel';
      const after = buffer[start + kind.length + 1];
      if (after === undefined) { at = start; break; }
      if (!/[\s>/]/.test(after)) { at = start + 1; continue; }
      const openEnd = buffer.indexOf('>', start);
      if (openEnd < 0) { at = start; break; }
      let end;
      if (buffer[openEnd - 1] === '/') end = openEnd + 1;
      else {
        const close = buffer.indexOf(`</${kind}>`, openEnd);
        if (close < 0) { at = start; break; }
        end = close + kind.length + 3;
      }
      onBlock(kind, buffer.slice(start, end));
      at = end;
    }
    buffer = buffer.slice(at);
  }
}

// Reads one guide and returns { channelId: [{ start, stop, block }] } for our
// channels. Programmes are matched by guide id, or by channel name for
// channels the source names differently.
async function collectGuide(chunks, { ids, names }, now) {
  const map = new Map();
  const found = {};
  let programmes = 0;
  await scanXmltv(chunks, (kind, block) => {
    const open = /^<[a-z]+\b[^>]*>/.exec(block)[0];
    if (kind === 'channel') {
      const id = attribute(open, 'id');
      if (!id || map.has(id)) return;
      if (ids.has(id)) { map.set(id, id); return; }
      const nameTags = block.match(/<display-name\b[^>]*>[\s\S]*?<\/display-name>/g) || [];
      for (const tag of nameTags) {
        const target = names.get(nameKey(tag.replace(/<[^>]+>/g, '')));
        if (target) { map.set(id, target); return; }
      }
      return;
    }
    const source = attribute(open, 'channel');
    const target = map.get(source) || (ids.has(source) ? source : null);
    if (!target) return;
    const start = xmltvTime(attribute(open, 'start'));
    const stop = xmltvTime(attribute(open, 'stop'));
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < now - KEEP_PAST_MS) return;
    const rewritten = target === source ? block : block.replace(open, open.replace(/\bchannel="[^"]*"/, `channel="${encode(target)}"`));
    (found[target] || (found[target] = [])).push({ start, stop, block: rewritten });
    programmes += 1;
  });
  return { channels: found, programmes };
}

function hasCurrent(list, now) {
  return Array.isArray(list) && list.some(entry => entry.stop > now);
}

// A programme for an event slot that has no listings, titled with its matchup.
function matchupProgramme(channelId, matchup, name, now) {
  const day = new Date(now);
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  const stop = start + 24 * 60 * 60 * 1000 - 60000;
  return {
    start, stop,
    block: `<programme channel="${encode(channelId)}" start="${stamp(start)}" stop="${stamp(stop)}"><title lang="en">${encode(`${matchup[0]} vs ${matchup[1]}`)}</title><desc lang="en">${encode(name)}</desc><category lang="en">Sports</category></programme>`,
  };
}

function renderGuide(channels, programmesById) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="Zorofin companion">'];
  const seen = new Set();
  for (const channel of channels) {
    if (seen.has(channel.guideId)) continue;
    seen.add(channel.guideId);
    out.push(`  <channel id="${encode(channel.guideId)}"><display-name>${encode(channel.name)}</display-name>${channel.logo ? `<icon src="${encode(channel.logo)}" />` : ''}</channel>`);
  }
  for (const id of seen) {
    const list = (programmesById[id] || []).slice().sort((a, b) => a.start - b.start);
    for (const entry of list) out.push(`  ${entry.block}`);
  }
  out.push('</tv>');
  return `${out.join('\n')}\n`;
}

module.exports = { collectGuide, hasCurrent, matchupProgramme, nameKey, renderGuide, scanXmltv, stamp, xmltvTime };
