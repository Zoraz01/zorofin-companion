'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const { NonceCache, verifyRequest } = require('./bridge-auth');
const { MODULE_ID } = require('./modules');

const VERSION = require('../package.json').version;
const MAX_BODY_BYTES = 64 * 1024;
// Administrators' settings can carry logo images.
const MAX_ADMIN_BODY_BYTES = 2 * 1024 * 1024;

function send(res, status, body) {
  const payload = body == null ? '' : `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function sendRaw(res, reply) {
  res.writeHead(reply.status, {
    'Content-Type': reply.contentType || 'application/octet-stream',
    'Content-Length': reply.raw.length,
    'Cache-Control': reply.cacheControl || 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(reply.raw);
}

// Streams a file reply ({ file }) from disk instead of reading it whole into
// memory, so several readers fetching a large guide at once cost little.
function sendFile(res, reply) {
  // Open first, then size the open copy: a refresh can rename a new file over
  // this one at any time, and the descriptor keeps reading the copy we sized.
  let fd;
  let size;
  try {
    fd = fs.openSync(reply.file, 'r');
    size = fs.fstatSync(fd).size;
  } catch (_) {
    if (fd !== undefined) fs.closeSync(fd);
    return send(res, 404, { error: 'Not found' });
  }
  res.writeHead(reply.status, {
    'Content-Type': reply.contentType || 'application/octet-stream',
    'Content-Length': size,
    'Cache-Control': reply.cacheControl || 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  const stream = fs.createReadStream(null, { fd });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}

function readBody(req, max = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(buffer) {
  if (!buffer.length) return null;
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (_) { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

function decodeSegments(rawPath) {
  try { return rawPath.split('/').filter(Boolean).map(decodeURIComponent); }
  catch (_) { throw Object.assign(new Error('invalid path'), { status: 400 }); }
}

function bearerMatches(req, secret) {
  if (!secret) return false;
  const value = String(req.headers.authorization || '');
  const supplied = Buffer.from(value.startsWith('Bearer ') ? value.slice(7) : '');
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

// Routes:
//   GET  /health                       unauthenticated liveness
//   GET  /v1/capabilities              bridge-signed, plugin-level
//   *    /v1/modules/{id}/{path}       bridge-signed, for one viewer
//   POST /v1/hooks/seerr               Seerr webhook, Bearer secret
//   GET  /v1/public/{id}/{path}        module-authorized (for Jellyfin itself, e.g. a guide URL)
//   GET  /v1/admin/settings            bridge-signed, Jellyfin administrator only
//   POST /v1/admin/settings/{id}       save one section (same)
//   POST /v1/admin/settings/{id}/test  check one section without saving (same)
function createServer({ config, registry, settings = null, now = Date.now, log = () => {} }) {
  const nonces = new NonceCache();

  async function bridge(req, res, url, body) {
    const result = verifyRequest(
      { method: req.method, pathAndQuery: url.pathname + url.search, headers: req.headers, body },
      config.bridgeSecret,
      now(),
      nonces,
    );
    if (!result.ok) {
      log(`bridge rejected ${req.method} ${url.pathname}: ${result.reason}`);
      send(res, result.status, { error: 'Unauthorised' });
      return null;
    }
    return result;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://companion.invalid');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { status: 'ok', service: 'zorofin-companion', version: VERSION });
      }

      if (url.pathname === '/v1/hooks/seerr') {
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const listeners = registry.seerrListeners();
        if (!config.seerrWebhookSecret || !listeners.length) return send(res, 404, { error: 'Not found' });
        if (!bearerMatches(req, config.seerrWebhookSecret)) return send(res, 401, { error: 'Unauthorised' });
        const event = parseJson(await readBody(req));
        if (!event || typeof event !== 'object') return send(res, 400, { error: 'Invalid event' });
        for (const module of listeners) {
          try { await module.onSeerrEvent(event); }
          catch (error) { log(`module ${module.id} failed Seerr event: ${error.message}`); }
        }
        return send(res, 202, { status: 'accepted' });
      }

      if (url.pathname === '/v1/capabilities') {
        if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
        const auth = await bridge(req, res, url, Buffer.alloc(0));
        if (!auth) return undefined;
        return send(res, 200, { ...registry.capabilities(), companionVersion: VERSION });
      }

      const open = /^\/v1\/public\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (open) {
        // HEAD too: Jellyfin and Threadfin check a stream's type with HEAD
        // before playing, and refuse to share it between viewers otherwise.
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
        const module = MODULE_ID.test(open[1]) ? registry.get(open[1]) : null;
        if (!module || typeof module.handlePublic !== 'function') return send(res, 404, { error: 'Not found' });
        const reply = await module.handlePublic({ segments: decodeSegments(open[2] || ''), query: url.searchParams });
        if (reply && Buffer.isBuffer(reply.raw)) return sendRaw(res, reply);
        if (reply && typeof reply.file === 'string') return sendFile(res, reply);
        if (reply && typeof reply.stream === 'function') {
          // A HEAD answers with the type only and never opens a stream.
          if (req.method === 'HEAD') {
            res.writeHead(200, { 'Content-Type': reply.contentType || 'application/octet-stream', 'Cache-Control': 'no-store' });
            return res.end();
          }
          return reply.stream(res);
        }
        return send(res, reply && Number.isInteger(reply.status) ? reply.status : 500, reply ? reply.body : null);
      }

      const admin = /^\/v1\/admin\/settings(?:\/([^/]+)(\/test)?)?\/?$/.exec(url.pathname);
      if (admin) {
        const isRead = !admin[1];
        if (req.method !== (isRead ? 'GET' : 'POST')) return send(res, 405, { error: 'Method not allowed' });
        const body = isRead ? Buffer.alloc(0) : await readBody(req, MAX_ADMIN_BODY_BYTES);
        const auth = await bridge(req, res, url, body);
        if (!auth) return undefined;
        if (!auth.viewer || !auth.viewer.admin) return send(res, 403, { error: 'Administrators only' });
        if (!settings) return send(res, 404, { error: 'Not found' });
        if (isRead) return send(res, 200, settings.view());
        const id = decodeSegments(admin[1])[0];
        const change = parseJson(body) || {};
        try {
          if (admin[2]) return send(res, 200, await settings.test(id, change));
          const section = settings.save(id, change);
          log(`settings for ${id} saved by an administrator`);
          return send(res, 200, section);
        } catch (error) {
          if (error.status) return send(res, error.status, { error: error.message });
          throw error;
        }
      }

      const match = /^\/v1\/modules\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (match) {
        if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        const body = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
        const auth = await bridge(req, res, url, body);
        if (!auth) return undefined;
        if (!auth.viewer) return send(res, 401, { error: 'Unauthorised' });
        const id = match[1];
        const module = MODULE_ID.test(id) ? registry.get(id) : null;
        if (!module) return send(res, 404, { error: 'Not found' });
        const reply = await module.handle({
          method: req.method,
          path: match[2] || '/',
          segments: decodeSegments(match[2] || ''),
          query: url.searchParams,
          body: parseJson(body),
          viewer: auth.viewer,
        });
        return send(res, reply && Number.isInteger(reply.status) ? reply.status : 500, reply ? reply.body : null);
      }

      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error.status) return send(res, error.status, { error: error.message });
      log(`request failed ${req.method} ${url.pathname}: ${error.message}`);
      return send(res, 500, { error: 'Internal error' });
    }
  });
}

module.exports = { MAX_BODY_BYTES, VERSION, createServer };
