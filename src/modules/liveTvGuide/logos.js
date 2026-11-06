'use strict';

// Matches guide channels to logos in the public tv-logo/tv-logos collection.
// Operator opt-in: logos are broadcasters' trademarks, fetched by the
// operator's server for its own guide; Zorofin ships none. Ported from
// tools/fetch-real-channel-logos.py without one server's provider-specific rules.

const TREE_URL = 'https://api.github.com/repos/tv-logo/tv-logos/git/trees/main?recursive=1';
const RAW_BASE = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/';
const NOISE = new Set(['hd', 'fhd', 'uhd', '4k', 'tv', 'raw', 'us', 'uk', 'ca', 'qa', 'mx', 'east', 'west', 'network', 'channel']);
const { similar } = require('./sources');

function cleanChannelName(name) {
  const cleaned = String(name)
    .replace(/^[A-Z]{2,6}\|\s*/, '')
    .replace(/ᴴᴰ/g, 'HD')
    .replace(/ᴿᴬᵂ/g, 'RAW')
    .replace(/\bUHD\/4K\b/gi, '4K')
    .replace(/\bHDTV\b/gi, 'TV')
    .replace(/\bFHD\b/gi, 'HD')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '');
  return cleaned || String(name);
}

function tokens(text) {
  return new Set(String(text).toLowerCase().split(/[^a-z0-9]+/).filter(token => token && !NOISE.has(token)));
}

function stem(file) {
  return file.split('/').pop().replace(/\.png$/i, '');
}

function bestLogo(name, files) {
  const cleaned = cleanChannelName(name);
  const channel = tokens(cleaned);
  const callsign = /\(([A-Z]{3,5})(?:-[A-Z0-9]+)?\)/.exec(name);
  const call = callsign ? callsign[1].toLowerCase() : null;
  let best = null;
  let bestScore = 0;
  for (const file of files) {
    const candidate = tokens(stem(file));
    if (!candidate.size) continue;
    const shared = [...channel].filter(token => candidate.has(token)).length;
    const subset = channel.size && (shared === channel.size || shared === candidate.size);
    let score;
    if (call && candidate.has(call)) score = 1;
    else if (subset && channel.size === candidate.size) score = 0.98;
    else if (subset) score = 0.85 + 0.1 * (shared / new Set([...channel, ...candidate]).size);
    else score = similar([...channel].sort().join(''), [...candidate].sort().join('')) ? 0.8 : 0;
    score -= 0.01 * Math.max(candidate.size - channel.size, 0);
    if (score > bestScore) {
      best = file;
      bestScore = score;
    }
  }
  return bestScore >= 0.78 ? best : null;
}

// Lists logo files for the chosen countries. Returns null on a transient failure.
async function logoFiles(fetcher, countries) {
  try {
    const response = await fetcher(TREE_URL, { maxBytes: 30 * 1024 * 1024, headers: { Accept: 'application/vnd.github+json' } });
    if (response.status !== 200) return null;
    const tree = JSON.parse(response.body.toString('utf8')).tree || [];
    const prefixes = countries.map(country => `countries/${country}/`);
    return tree.map(node => node.path).filter(file => typeof file === 'string' && file.endsWith('.png') && prefixes.some(prefix => file.startsWith(prefix)));
  } catch (_) {
    return null;
  }
}

function rawUrl(file) {
  return RAW_BASE + file.split('/').map(encodeURIComponent).join('/');
}

module.exports = { bestLogo, cleanChannelName, logoFiles, rawUrl };
