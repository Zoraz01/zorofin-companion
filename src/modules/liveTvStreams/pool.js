'use strict';

// Line pool: shares several provider logins ("lines") behind one stream
// address, so N one-connection logins act like one N-connection account.
//
// The channel list (Threadfin's playlist) points every channel at
//   /v1/public/liveTvStreams/{token}/line/{streamId}
// and each request is relayed from whichever login has no stream open. Threadfin
// already shares one upstream stream between everyone watching a channel, so
// each line carries one channel at a time. When every line is busy the request
// gets 503 and Threadfin reports no free tuner, exactly as with a single login.
//
// Lines are Xtream logins written as either the provider's M3U link
// (http://host:port/get.php?username=U&password=P...) or http://host:port/U/P.
// They are passwords in all but name: never log or return them.

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';
const STREAM_ID = /^(\d{1,12})(?:\.(ts|m3u8))?$/;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const CONNECT_MS = 15000;
const IDLE_MS = 30000;
const MAX_REDIRECTS = 4;
const MAX_LINES = 20;

// Returns [{ base, username, password }] or throws with a message that never
// repeats the input (it holds passwords).
function parseLines(text) {
  const entries = String(text || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  if (entries.length > MAX_LINES) throw new Error(`at most ${MAX_LINES} provider logins`);
  return entries.map((entry, index) => {
    let url;
    try { url = new URL(entry.replace(/&amp;/g, '&')); }
    catch (_) { throw new Error(`login ${index + 1} is not a web address`); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`login ${index + 1} must start with http:// or https://`);
    const base = `${url.protocol}//${url.host}`;
    const username = url.searchParams.get('username');
    const password = url.searchParams.get('password');
    if (username && password) return { base, username, password };
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'live') parts.shift();
    if (parts.length === 2) return { base, username: parts[0], password: parts[1] };
    throw new Error(`login ${index + 1} needs a username and password (paste the M3U link)`);
  });
}

function lineKey(line) {
  return `${line.base}|${line.username}`;
}

// The token comes from settings, or is made once and kept in the data folder
// so the address handed to Threadfin survives restarts.
function poolToken(configured, dir, fsImpl = fs) {
  if (configured) return configured;
  const file = path.join(dir, 'pool-token');
  try {
    const saved = String(fsImpl.readFileSync(file, 'utf8')).trim();
    if (TOKEN.test(saved)) return saved;
  } catch (_) { /* first run */ }
  const token = crypto.randomBytes(24).toString('hex');
  fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fsImpl.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

function sameToken(supplied, expected) {
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function openUpstream(target, { request, timeout }) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const client = request || (url.protocol === 'https:' ? https.get : http.get);
    const req = client(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, timeout }, resolve);
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timed out')));
  });
}

function createLinePool({ lines, perLine = 1, request, log = () => {}, connectMs = CONNECT_MS, idleMs = IDLE_MS }) {
  const open = new Map(lines.map(line => [lineKey(line), 0]));
  let opened = 0;
  let refused = 0;

  function busy() {
    let count = 0;
    for (const value of open.values()) count += value;
    return count;
  }

  // Least-used line first, keeping the configured order on ties.
  function candidates() {
    return lines.filter(line => open.get(lineKey(line)) < perLine)
      .sort((a, b) => open.get(lineKey(a)) - open.get(lineKey(b)));
  }

  async function connect(line, streamId, extension) {
    let target = `${line.base}/${encodeURIComponent(line.username)}/${encodeURIComponent(line.password)}/${streamId}${extension ? `.${extension}` : ''}`;
    for (let hop = 0; ; hop += 1) {
      const response = await openUpstream(target, { request, timeout: connectMs });
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location && hop < MAX_REDIRECTS) {
        response.resume();
        target = new URL(response.headers.location, target).toString();
        continue;
      }
      if (status !== 200) {
        response.resume();
        throw Object.assign(new Error(`provider answered HTTP ${status}`), { status });
      }
      return response;
    }
  }

  // Relays one stream to res. Resolves once the stream has started or failed.
  async function relay(streamId, extension, res) {
    const tried = new Set();
    let lastError = null;
    for (;;) {
      const line = candidates().find(l => !tried.has(lineKey(l)));
      if (!line) break;
      const key = lineKey(line);
      tried.add(key);
      open.set(key, open.get(key) + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        open.set(key, Math.max(0, open.get(key) - 1));
      };
      let upstream;
      try {
        upstream = await connect(line, streamId, extension);
      } catch (error) {
        release();
        lastError = error;
        log(`Live TV line ${lines.indexOf(line) + 1} could not start stream ${streamId}: ${String(error.message).replace(/https?:\/\/\S+/g, '[provider]')}`);
        continue;
      }
      if (res.destroyed || res.writableEnded) {
        upstream.destroy();
        release();
        return;
      }
      opened += 1;
      res.writeHead(200, {
        'Content-Type': upstream.headers['content-type'] || 'video/mp2t',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      upstream.setTimeout(idleMs, () => upstream.destroy(new Error('stream stalled')));
      const finish = () => {
        release();
        upstream.destroy();
        if (!res.writableEnded) res.end();
      };
      upstream.on('error', finish);
      upstream.on('end', finish);
      upstream.on('close', finish);
      res.on('close', finish);
      res.on('error', finish);
      upstream.pipe(res);
      return;
    }
    refused += 1;
    const full = tried.size === 0;
    const body = JSON.stringify({ error: full ? 'all_lines_busy' : 'provider_unavailable' });
    if (!res.headersSent) {
      res.writeHead(full ? 503 : 502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '5' });
    }
    res.end(`${body}\n`);
    if (full) log(`Live TV: all ${lines.length} provider logins are busy; stream ${streamId} refused`);
    else if (lastError) log(`Live TV: no provider login could start stream ${streamId}`);
  }

  return {
    size: lines.length,
    capacity: lines.length * perLine,
    busy,
    status: () => ({ lines: lines.length, capacity: lines.length * perLine, inUse: busy(), opened, refused }),
    relay,
  };
}

module.exports = { STREAM_ID, TOKEN, createLinePool, parseLines, poolToken, sameToken };
