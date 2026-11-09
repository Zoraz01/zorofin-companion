'use strict';

// Fixtures from ESPN's public scoreboard, behind one adapter so another
// schedule provider can replace it. The API is unofficial: anything
// unexpected is skipped, never guessed.

function teamOf(team) {
  return {
    id: String(team.id || ''),
    name: String(team.displayName || ''),
    short: String(team.shortDisplayName || team.name || team.displayName || ''),
    nickname: String(team.name || ''),
    location: String(team.location || ''),
    abbreviation: String(team.abbreviation || ''),
    color: /^[0-9a-f]{6}$/i.test(team.color || '') ? `#${team.color.toLowerCase()}` : null,
  };
}

function broadcastsOf(competition) {
  const names = new Set();
  for (const entry of competition.broadcasts || []) for (const name of entry.names || []) if (name) names.add(String(name));
  for (const entry of competition.geoBroadcasts || []) {
    const name = entry && entry.media && entry.media.shortName;
    if (name) names.add(String(name));
  }
  return [...names];
}

function parseScoreboard(data, packId) {
  const out = [];
  for (const event of (data && Array.isArray(data.events) ? data.events : [])) {
    try {
      const competition = event.competitions[0];
      const sides = {};
      for (const competitor of competition.competitors) sides[competitor.homeAway] = competitor;
      const start = Date.parse(event.date);
      const home = teamOf(sides.home.team);
      const away = teamOf(sides.away.team);
      if (!event.id || !Number.isFinite(start) || !home.name || !away.name || home.name === away.name) continue;
      const type = (event.status && event.status.type) || {};
      const note = (competition.notes || []).map(item => item && item.headline).find(Boolean);
      out.push({
        id: `${packId}:${event.id}`,
        pack: packId,
        start,
        state: ['pre', 'in', 'post'].includes(type.state) ? type.state : 'pre',
        status: String(type.name || ''),
        detail: String(type.shortDetail || type.detail || ''),
        completed: type.completed === true,
        home, away,
        score: { home: String(sides.home.score ?? ''), away: String(sides.away.score ?? '') },
        broadcasts: broadcastsOf(competition),
        round: note ? String(note) : (event.week && event.week.number ? `Week ${event.week.number}` : ''),
        venue: String((competition.venue && competition.venue.fullName) || ''),
      });
    } catch (_) { /* skip a malformed fixture */ }
  }
  return out;
}

const CANCELLED = /POSTPON|CANCEL|SUSPEND|FORFEIT|DELAYED/i;

// Is a game worth showing now: from the pregame window until it ends (plus
// the postgame buffer), with sanity bounds on bad data.
function visible(game, now, { pregameMs, postgameMs, endedAt }) {
  if (CANCELLED.test(game.status)) return false;
  if (game.completed || game.state === 'post') return endedAt !== undefined && now <= endedAt + postgameMs;
  const opens = game.start - pregameMs;
  if (game.state === 'in') return opens <= now && now <= game.start + 12 * 3600000;
  return opens <= now && now <= game.start + 6 * 3600000;
}

module.exports = { CANCELLED, parseScoreboard, visible };
