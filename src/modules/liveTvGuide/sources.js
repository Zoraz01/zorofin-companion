'use strict';

// Outside lookups for guide art, each opt-in by the operator, plus image
// mirroring so Jellyfin never depends on a third party staying up.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { teamsMatch } = require('./sports');

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const USER_AGENT = 'Zorofin-Companion/1.0 (guide enrichment)';

// GET with a size cap. Resolves { status, type, body: Buffer }.
function fetchBuffer(target, { maxBytes, timeout = 15000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(new Error('unsupported URL'));
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, timeout }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        type: String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase(),
        body: Buffer.concat(chunks),
      }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('timed out')));
  });
}

async function fetchJson(fetcher, url) {
  try {
    const response = await fetcher(url, { maxBytes: 2_000_000 });
    if (response.status !== 200) return { ok: false, transient: response.status >= 500 || response.status === 429 };
    return { ok: true, data: JSON.parse(response.body.toString('utf8')) };
  } catch (_) {
    return { ok: false, transient: true };
  }
}

function similar(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  // Dice coefficient over bigrams, close to the Python script's SequenceMatcher >= 0.75.
  const grams = text => new Map([...Array(Math.max(text.length - 1, 0)).keys()]
    .map(index => text.slice(index, index + 2))
    .reduce((map, gram) => map.set(gram, (map.get(gram) || 0) + 1), new Map()));
  const left = grams(x);
  const right = grams(y);
  let overlap = 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) || 0);
  return (2 * overlap) / (x.length - 1 + y.length - 1) >= 0.75;
}

const NO_SHOW_ART = /news|good morning|good day|paid program|infomercial|\bat \d{1,2}/i;

// TVmaze show poster for a programme title. TVmaze data is CC BY-SA; operators
// enabling it accept that licence. Returns { url } or { miss } or { transient }.
async function tvmazePoster(fetcher, title) {
  const cleaned = title.replace(/^Live:\s*/i, '').replace(/\s*[:—-]\s*(OT|Live)$/i, '').trim();
  if (cleaned.length < 4 || NO_SHOW_ART.test(cleaned)) return { miss: true };
  const result = await fetchJson(fetcher, `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(cleaned)}`);
  if (!result.ok) return result.transient ? { transient: true } : { miss: true };
  const show = result.data || {};
  if (!similar(cleaned, String(show.name || ''))) return { miss: true };
  const image = show.image || {};
  return image.medium || image.original ? { url: image.medium || image.original } : { miss: true };
}

// TheSportsDB matchup card, with the operator's own API key.
async function sportsDbCard(fetcher, apiKey, [away, home]) {
  for (const [a, b] of [[home, away], [away, home]]) {
    const result = await fetchJson(fetcher,
      `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/searchevents.php?e=${encodeURIComponent(`${a} vs ${b}`)}`);
    if (!result.ok) return result.transient ? { transient: true } : { miss: true };
    for (const event of (result.data && result.data.event) || []) {
      if (teamsMatch(away, home, String(event.strAwayTeam || ''), String(event.strHomeTeam || ''))) {
        const art = event.strThumb || event.strPoster || event.strBanner;
        if (art) return { url: art };
      }
    }
  }
  return { miss: true };
}

// Copies an image into dir and returns its file name, or null.
async function mirrorImage(fetcher, dir, url) {
  const name = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
  for (const extension of Object.values(IMAGE_TYPES)) {
    if (fs.existsSync(path.join(dir, `${name}.${extension}`))) return `${name}.${extension}`;
  }
  try {
    const response = await fetcher(url, { maxBytes: MAX_IMAGE_BYTES });
    const extension = IMAGE_TYPES[response.type];
    if (response.status !== 200 || !extension || !response.body.length) return null;
    fs.mkdirSync(dir, { recursive: true });
    const file = `${name}.${extension}`;
    const temporary = path.join(dir, `${file}.tmp`);
    fs.writeFileSync(temporary, response.body);
    fs.renameSync(temporary, path.join(dir, file));
    return file;
  } catch (_) {
    return null;
  }
}

module.exports = { IMAGE_TYPES, fetchBuffer, mirrorImage, similar, sportsDbCard, tvmazePoster };
