'use strict';

// Event channels: provider slots (PPV, per-game feeds) that only carry
// something now and then. No provider names: the operator says which groups
// are event groups.

const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ES_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pad = value => String(value).padStart(2, '0');

// Ways a channel name may spell yesterday, today or tomorrow (UTC), lowercased.
function dateTokens(now, window = 1) {
  const tokens = new Set();
  for (let offset = -window; offset <= window; offset += 1) {
    const day = new Date(now + offset * 86400000);
    const D = day.getUTCDate();
    const M = day.getUTCMonth() + 1;
    const Y = day.getUTCFullYear();
    for (const token of [
      `${pad(D)}-${pad(M)}-${Y}`, `${Y}-${pad(M)}-${pad(D)}`, `${pad(D)}/${pad(M)}/${Y}`,
      `${pad(D)}/${pad(M)}`, `${pad(M)}/${pad(D)}`, `${pad(D)}-${pad(M)}`, `${D}/${M}`, `${M}/${D}`,
    ]) tokens.add(token);
    for (const month of [EN_MONTHS[M - 1], ES_MONTHS[M - 1], EN_MONTHS[M - 1].slice(0, 3), ES_MONTHS[M - 1].slice(0, 3)]) {
      for (const token of [`${month} ${D}`, `${D} ${month}`, `${month} ${pad(D)}`]) tokens.add(token);
    }
  }
  return tokens;
}

const LIVE = /(^|[|\s])(live|now)\b/i;
const DEAD = /no event|coming soon|\bend\b|\bended\b|offline|^#|test stream/i;

// Short tokens such as "5/11" must not match inside "15/11" or "5/112".
function containsToken(name, token) {
  let from = 0;
  for (;;) {
    const at = name.indexOf(token, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : name[at - 1];
    const after = name[at + token.length] || '';
    if (!/[0-9a-z]/.test(before) && !/[0-9a-z]/.test(after)) return true;
    from = at + 1;
  }
}

// Does an event slot have something on around now?
function eventActive(name, tokens) {
  const trimmed = String(name || '').trim();
  if (!trimmed || DEAD.test(trimmed)) return false;
  if (LIVE.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  for (const token of tokens) if (containsToken(lower, token)) return true;
  return false;
}

// "TeamA vs TeamB" from an event channel name, sport-agnostic.
const VS = /\s+(?:vs\.?|v\.)\s+/i;
const LEFT_JUNK = /^\s*(?:\([^)]*\)|(?:US|UK|CA|DE|NL|BR|AR|ES|FR|LIVE|END|ENDED|NEXT|NOW)\b[\s:|-]*|[A-Za-z+.' ]*?\d{1,4}\s*[|:]\s*|[A-Za-z+ ]*?:\s*)/i;
const RIGHT_STOP = /\s*(?:[|@(,]|kick-?off|:\s*[A-Za-z]|\s\d{1,2}:\d{2}|\s\d{1,2}\s*(?:am|pm)\b|\s@|\bEDT\b|\bCEST\b|\bGMT\b|\bET\b|\d{4}-\d{2}-\d{2}|\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\s\d{1,2}\/\d{1,2}\b)/i;
const BAD_TEAM = /exclusive|feed|^all$|^\d+$|no event|^the$|^\W*$|press conference/i;

function cleanTeam(text) {
  return text.trim().replace(/^[\s\-|:_]+|[\s\-|:_]+$/g, '').replace(/\s+/g, ' ').trim();
}

function matchupFromName(name) {
  const text = String(name || '');
  const vs = VS.exec(text);
  if (!vs) return null;
  let left = text.slice(0, vs.index).replace(LEFT_JUNK, '').split(/[|:]/).pop();
  left = left.replace(/^\s*(?:world cup|rugby|tennis|cricket|game|match)\s*\d*\s*[-:]?\s*/i, '');
  let right = text.slice(vs.index + vs[0].length);
  const stop = RIGHT_STOP.exec(right);
  if (stop) right = right.slice(0, stop.index);
  const a = cleanTeam(left);
  const b = cleanTeam(right);
  if (a.length < 2 || a.length > 34 || b.length < 2 || b.length > 34) return null;
  if (BAD_TEAM.test(a) || BAD_TEAM.test(b)) return null;
  return [a, b];
}

module.exports = { dateTokens, eventActive, matchupFromName };
