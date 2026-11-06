'use strict';

// Recognizes sports listings and pulls "A vs B" matchups out of guide text.
// Ported from tools/enrich-live-tv-epg.py (text rules only; no provider data).

const SPORT = new RegExp([
  'world cup', 'fifa', 'fiba', 'nba', 'wnba', 'nfl', 'mlb', 'nhl', 'mls', 'ufc', 'mma', 'boxing', 'wrestling',
  'premier league', 'la liga', 'serie a', 'bundesliga', 'ligue 1', 'champions league', 'uefa',
  'concacaf', 'copa', 'libertadores', 'soccer', 'futbol', 'basketball', 'baseball', 'hockey',
  'tennis', 'golf', 'cricket', 'rugby', 'nascar', 'formula 1', 'f1 ', 'motogp', 'athletics', 'olympi',
].join('|'), 'i');

const ALIASES = {
  'united states': 'USA', 'the united states': 'USA', 'u.s.': 'USA', 'u.s.a.': 'USA',
  'korea republic': 'South Korea', 'republic of korea': 'South Korea',
  czechia: 'Czech Republic', 'czech rep.': 'Czech Republic',
  "côte d'ivoire": 'Ivory Coast', "cote d'ivoire": 'Ivory Coast',
  'dr congo': 'DR Congo', 'democratic republic of congo': 'DR Congo',
  'islamic republic of iran': 'Iran', 'republic of north macedonia': 'North Macedonia',
  'trinidad and tobago': 'Trinidad & Tobago', 'bosnia and herzegovina': 'Bosnia & Herzegovina',
};

const TEAM = "\\p{Lu}[\\p{L}\\p{N}_.'& ]{1,28}?";
const TITLE_VS = new RegExp(`(?<![\\p{L}\\p{N}])(${TEAM})\\s+(?:vs\\.?|v\\.)\\s+(${TEAM})(?:$|[,:(])`, 'u');
const DESC_PATTERNS = [
  new RegExp(`(?<![\\p{L}\\p{N}])(${TEAM})\\s+and\\s+(${TEAM})\\s+(?:compete|meet|clash|face|play|battle|square off)`, 'u'),
  new RegExp(`(?<![\\p{L}\\p{N}])(${TEAM})\\s+(?:takes? on|faces?|hosts?|visits?|battles?)\\s+(?:the\\s+)?(${TEAM})(?:$|[ ,.])`, 'u'),
  new RegExp(`(?<![\\p{L}\\p{N}])(${TEAM})\\s+(?:vs\\.?|v\\.)\\s+(${TEAM})(?:$|[,.:(])`, 'u'),
];
const NOT_A_TEAM = /news|live|show|today|tonight|coverage|highlights|host/i;
const HAS_MATCHUP = /\b(?:vs\.?|versus|v\.?)\s/i;

function isSport(title, desc) {
  return SPORT.test(`${title} ${desc}`);
}

function validTeam(name) {
  const trimmed = name.trim();
  return trimmed.length > 2 && trimmed.length <= 28 && !NOT_A_TEAM.test(trimmed);
}

function normalizeTeam(name) {
  let cleaned = name.trim().replace(/^the\s+/i, '').replace(/^No\.\s*\d+\s+/i, '');
  return ALIASES[cleaned.toLowerCase()] || cleaned;
}

function extractTeams(title, desc) {
  const fromTitle = TITLE_VS.exec(title);
  if (fromTitle && validTeam(fromTitle[1]) && validTeam(fromTitle[2])) return [fromTitle[1].trim(), fromTitle[2].trim()];
  for (const pattern of DESC_PATTERNS) {
    const found = pattern.exec(desc);
    if (found && validTeam(found[1]) && validTeam(found[2])) return [found[1].trim(), found[2].trim()];
  }
  return null;
}

function key(name) {
  return normalizeTeam(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
}

function teamsMatch(away, home, otherAway, otherHome) {
  const a = key(away);
  const h = key(home);
  const oa = key(otherAway);
  const oh = key(otherHome);
  const same = (x, y) => x && y && (x === y || x.includes(y) || y.includes(x));
  return (same(a, oa) && same(h, oh)) || (same(a, oh) && same(h, oa));
}

module.exports = { HAS_MATCHUP, extractTeams, isSport, normalizeTeam, teamsMatch };
