'use strict';

// League packs: data, not code. Each pack names its fixture source (ESPN's
// public scoreboard path), the sport (the same kinds as the Zorofin apps'
// LiveSport), how its guide titles read, and the words that mark one of its
// event channels. New leagues are new entries here.
//
// style: 'at' writes "Away at Home" (US custom), 'vs' writes "Home vs Away".
// minutes: how long a game usually runs, for the guide slot.

const PACKS = Object.freeze({
  // US pro
  nfl: { label: 'NFL', title: 'NFL Football', path: 'football/nfl', sport: 'football', style: 'at', minutes: 210, words: /\bnfl\b/i },
  nba: { label: 'NBA', title: 'NBA Basketball', path: 'basketball/nba', sport: 'basketball', style: 'at', minutes: 150, words: /\bnba\b/i, aliases: { 'la clippers': 'los angeles clippers', 'la lakers': 'los angeles lakers' } },
  mlb: { label: 'MLB', title: 'MLB Baseball', path: 'baseball/mlb', sport: 'baseball', style: 'at', minutes: 190, words: /\bmlb\b/i },
  nhl: { label: 'NHL', title: 'NHL Hockey', path: 'hockey/nhl', sport: 'hockey', style: 'at', minutes: 165, words: /\bnhl\b/i },
  mls: { label: 'MLS', title: 'MLS Soccer', path: 'soccer/usa.1', sport: 'soccer', style: 'vs', minutes: 120, words: /\bmls\b/i },
  wnba: { label: 'WNBA', title: 'WNBA Basketball', path: 'basketball/wnba', sport: 'basketball', style: 'at', minutes: 140, words: /\bwnba\b/i },
  // College
  cfb: { label: 'College football', title: 'College Football', path: 'football/college-football', query: 'groups=80', sport: 'football', style: 'at', minutes: 210, words: /\b(?:ncaaf|cfb|college football)\b/i },
  mcbb: { label: "Men's college basketball", title: 'College Basketball', path: 'basketball/mens-college-basketball', query: 'groups=50&limit=300', sport: 'basketball', style: 'at', minutes: 140, words: /\b(?:ncaab|ncaam|college basketball)\b/i },
  wcbb: { label: "Women's college basketball", title: "Women's College Basketball", path: 'basketball/womens-college-basketball', query: 'groups=50&limit=300', sport: 'basketball', style: 'at', minutes: 140, words: /\b(?:ncaaw|women'?s college basketball)\b/i },
  // Top 5 soccer leagues
  epl: { label: 'Premier League', title: 'Premier League', path: 'soccer/eng.1', sport: 'soccer', style: 'vs', minutes: 120, words: /\b(?:epl|premier league)\b/i,
    aliases: { 'man utd': 'manchester united', 'man united': 'manchester united', 'man city': 'manchester city', spurs: 'tottenham hotspur', wolves: 'wolverhampton wanderers', 'brighton and hove albion': 'brighton', 'afc bournemouth': 'bournemouth' } },
  laliga: { label: 'LaLiga', title: 'LaLiga', path: 'soccer/esp.1', sport: 'soccer', style: 'vs', minutes: 120, words: /\b(?:la ?liga)\b/i, aliases: { barca: 'barcelona', 'atletico madrid': 'atletico madrid', atleti: 'atletico madrid' } },
  seriea: { label: 'Serie A', title: 'Serie A', path: 'soccer/ita.1', sport: 'soccer', style: 'vs', minutes: 120, words: /\bserie a\b/i, aliases: { inter: 'internazionale', 'inter milan': 'internazionale' } },
  bundesliga: { label: 'Bundesliga', title: 'Bundesliga', path: 'soccer/ger.1', sport: 'soccer', style: 'vs', minutes: 120, words: /\bbundesliga\b/i, aliases: { bayern: 'bayern munich', 'fc bayern': 'bayern munich', bvb: 'borussia dortmund' } },
  ligue1: { label: 'Ligue 1', title: 'Ligue 1', path: 'soccer/fra.1', sport: 'soccer', style: 'vs', minutes: 120, words: /\bligue 1\b/i, aliases: { psg: 'paris saint-germain' } },
  // Cups
  ucl: { label: 'Champions League', title: 'UEFA Champions League', path: 'soccer/uefa.champions', sport: 'soccer', style: 'vs', minutes: 120, words: /\b(?:ucl|champions league)\b/i, aliases: { inter: 'internazionale', 'inter milan': 'internazionale', psg: 'paris saint-germain' } },
  uel: { label: 'Europa League', title: 'UEFA Europa League', path: 'soccer/uefa.europa', sport: 'soccer', style: 'vs', minutes: 120, words: /\b(?:uel|europa league)\b/i },
  facup: { label: 'FA Cup', title: 'FA Cup', path: 'soccer/eng.fa', sport: 'soccer', style: 'vs', minutes: 120, words: /\bfa cup\b/i },
  // Tournaments: a list of matches, like a league with a calendar.
  worldcup: { label: 'FIFA World Cup', title: 'FIFA World Cup', path: 'soccer/fifa.world', sport: 'soccer', style: 'vs', minutes: 120, words: /\bworld cup\b/i },
  womensworldcup: { label: "FIFA Women's World Cup", title: "FIFA Women's World Cup", path: 'soccer/fifa.wwc', sport: 'soccer', style: 'vs', minutes: 120, words: /\bwomen'?s world cup\b/i },
  euro: { label: 'UEFA Euro', title: 'UEFA Euro', path: 'soccer/uefa.euro', sport: 'soccer', style: 'vs', minutes: 120, words: /\beuro(?:s|pean championship)?\b/i },
  copaamerica: { label: 'Copa América', title: 'Copa América', path: 'soccer/conmebol.america', sport: 'soccer', style: 'vs', minutes: 120, words: /\bcopa am[eé]rica\b/i },
});

// Ranked like the apps' Home row: basketball, then football, then soccer and the rest.
const DEFAULT_LEAGUES = ['nba', 'nfl', 'cfb', 'mlb', 'nhl', 'epl', 'ucl', 'mls'];

module.exports = { DEFAULT_LEAGUES, PACKS };
