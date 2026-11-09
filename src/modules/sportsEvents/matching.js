'use strict';

// Which event channel carries which game. Both teams must match one fixture
// of the leagues in play; an ambiguous match is left alone, because a wrong
// label is worse than none.

const { matchupFromName } = require('../liveTvSource/events');

const GENERIC = new Set(['united', 'city', 'fc', 'sc', 'the', 'state', 'university']);

function normalized(value) {
  return String(value || '').toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ł/g, 'l')
    .normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function teamNames(team, aliases) {
  const names = new Set([team.name, team.short, team.nickname, team.abbreviation].map(normalized).filter(Boolean));
  for (const [alias, target] of Object.entries(aliases)) {
    if (names.has(normalized(target))) names.add(normalized(alias));
  }
  return names;
}

function teamMatches(text, team, aliases) {
  const value = normalized(aliases[normalized(text)] || text);
  if (!value) return false;
  const names = teamNames(team, aliases);
  if (names.has(value)) return true;
  // "LA Lakers" ends with the nickname; "Bills" is the nickname.
  const nickname = normalized(team.nickname);
  if (nickname && nickname.length >= 4 && !GENERIC.has(nickname) && (` ${value} `).includes(` ${nickname} `)) return true;
  const full = normalized(team.name);
  return full.length >= 6 && (` ${value} `).includes(` ${full} `);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function zoneOffsetMs(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(ms / 1000) * 1000;
}

function zonedTime(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month, day, hour, minute);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

// "@ Nov 3 7:30 PM" in a channel name, read in the provider's time zone and
// placed in the year nearest to now.
function timeFromName(name, now, timeZone) {
  const match = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)\b/i.exec(String(name || ''));
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  let hour = Number(match[3]) % 12;
  if (match[5].toUpperCase() === 'PM') hour += 12;
  const year = new Date(now).getUTCFullYear();
  const options = [year - 1, year, year + 1].map(y => zonedTime(y, month, Number(match[2]), hour, Number(match[4]), timeZone));
  return options.reduce((best, value) => (Math.abs(value - now) < Math.abs(best - now) ? value : best));
}

// Returns the one fixture a channel carries, or null.
function matchChannel(channel, games, packs, { now, timeZone, extraAliases }) {
  const teams = matchupFromName(channel.name);
  if (!teams) return null;
  const text = `${channel.name} ${channel.group || ''}`;
  const named = Object.entries(packs).filter(([, pack]) => pack.words && pack.words.test(text)).map(([id]) => id);
  const pool = games.filter(game => !named.length || named.includes(game.pack));
  const candidates = pool.filter(game => {
    const aliases = { ...(packs[game.pack].aliases || {}), ...extraAliases };
    const [a, b] = teams;
    return (teamMatches(a, game.home, aliases) && teamMatches(b, game.away, aliases))
      || (teamMatches(a, game.away, aliases) && teamMatches(b, game.home, aliases));
  });
  if (candidates.length <= 1) return candidates[0] || null;
  const when = timeFromName(channel.name, now, timeZone);
  const near = candidates.filter(game => Math.abs((when ?? now) - game.start) <= (when ? 90 : 12 * 60) * 60000);
  if (near.length === 1) return near[0];
  return null;
}

module.exports = { matchChannel, normalized, teamMatches, timeFromName, zonedTime };
