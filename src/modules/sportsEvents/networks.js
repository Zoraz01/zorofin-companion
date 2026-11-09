'use strict';

// Finds the operator's channel for a broadcaster ESPN lists ("ESPN", "ABC",
// "NFL Net"), so games get listings on network channels without the operator
// typing a Networks list. Only confident matches count: the channel's name,
// without a country prefix or quality tag, must be the broadcaster (or a
// well-known spelling of it), or, for the over-the-air networks, the network
// followed by a local station number ("ABC 7 DC", "Fox 5 DC"). When two
// channels fit equally, neither is used.

const { normalized } = require('./matching');

// ESPN's broadcaster names -> other names channels go by.
const SPELLINGS = {
  espn2: ['espn 2'],
  espnu: ['espn u'],
  espnews: ['espn news'],
  'espn deportes': ['espn deportes'],
  fs1: ['fox sports 1'],
  fs2: ['fox sports 2'],
  'nfl net': ['nfl network'],
  'nhl net': ['nhl network'],
  'mlb net': ['mlb network'],
  'nba tv': ['nba tv'],
  cbssn: ['cbs sports network'],
  'cbs sports net': ['cbs sports network'],
  'usa net': ['usa network', 'usa'],
  'golf channel': ['golf channel', 'golf'],
  'tennis channel': ['tennis channel'],
  'big ten network': ['big ten network', 'btn'],
  btn: ['big ten network'],
  secn: ['sec network'],
  'sec network': ['sec network'],
  accn: ['acc network'],
  'acc network': ['acc network'],
  'bein sports': ['bein sports'],
  'fox soccer plus': ['fox soccer plus'],
  mnmt: ['monumental sports network', 'monumental sports'],
  'nbc sports wash': ['nbc sports washington'],
};
const OVER_THE_AIR = new Set(['abc', 'cbs', 'nbc', 'fox', 'cw', 'the cw', 'pbs']);
const QUALITY = /\b(?:fhd|uhd|hd|sd|4k|hevc|h265|backup|east)\s*$/;

function channelKey(name) {
  let value = String(name || '').replace(/^[A-Za-z]{2,4}\s*[|:]\s*/, ''); // "US| ESPN HD"
  value = normalized(value);
  for (let i = 0; i < 3 && QUALITY.test(value); i += 1) value = value.replace(QUALITY, '').trim();
  return value;
}

function createNetworkFinder(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = channelKey(entry.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  }
  const one = list => (list && list.length === 1 ? list[0] : null);
  const cache = new Map();
  return function find(broadcaster) {
    // Streaming services ("ESPN+", "Disney+", "Peacock") are not channels.
    if (/\+/.test(String(broadcaster))) return null;
    const name = normalized(broadcaster);
    if (!name) return null;
    if (cache.has(name)) return cache.get(name);
    let found = one(byKey.get(name));
    for (const spelling of SPELLINGS[name] || []) {
      if (found) break;
      found = one(byKey.get(spelling));
    }
    if (!found && OVER_THE_AIR.has(name)) {
      // "ABC 7 DC", "NBC 4 Washington", "Fox 5": the network, a station number,
      // then at most a place name.
      const local = new RegExp(`^${name} \\d{1,2}(?: [a-z]+){0,2}$`);
      const fits = [...byKey.entries()].filter(([key]) => local.test(key)).flatMap(([, list]) => list);
      found = one(fits);
    }
    cache.set(name, found);
    return found;
  };
}

module.exports = { createNetworkFinder, channelKey };
