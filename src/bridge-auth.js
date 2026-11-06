'use strict';

// Signed bridge between the open Zorofin Jellyfin plugin and this companion.
// The contract is documented in server/jellyfin-plugin-zorofin/docs/COMPANION_BRIDGE.md
// and is the only thing the two programs share; no code is shared.

const crypto = require('crypto');

const SCHEME = 'zorofin-bridge-v1';
const MAX_SKEW_SECONDS = 60;
const USER_ID = /^[0-9a-f]{32}$/;
const NONCE = /^[0-9a-f]{32}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

function sha256Hex(body) {
  return crypto.createHash('sha256').update(body || Buffer.alloc(0)).digest('hex');
}

function canonicalString({ method, pathAndQuery, timestamp, nonce, userId, admin, body }) {
  return [
    SCHEME,
    String(method).toUpperCase(),
    pathAndQuery,
    String(timestamp),
    nonce,
    userId || '',
    admin ? '1' : '0',
    sha256Hex(body),
  ].join('\n');
}

function sign(secret, fields) {
  return crypto.createHmac('sha256', secret).update(canonicalString(fields), 'utf8').digest('hex');
}

function header(headers, name) {
  const value = headers[name];
  return Array.isArray(value) ? '' : String(value || '');
}

// Remembers nonces for the skew window so a captured request cannot be replayed.
class NonceCache {
  constructor(windowMs = 2 * MAX_SKEW_SECONDS * 1000, maxEntries = 50_000) {
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.seen = new Map();
  }

  // Returns false when the nonce was already used.
  remember(nonce, nowMs) {
    if (this.seen.size >= this.maxEntries) this.prune(nowMs);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, nowMs + this.windowMs);
    return true;
  }

  prune(nowMs) {
    for (const [nonce, expires] of this.seen) {
      if (expires <= nowMs) this.seen.delete(nonce);
    }
    // Still full after pruning means a flood; drop the oldest half rather than grow without bound.
    if (this.seen.size >= this.maxEntries) {
      const drop = Math.floor(this.seen.size / 2);
      let index = 0;
      for (const nonce of this.seen.keys()) {
        if (index++ >= drop) break;
        this.seen.delete(nonce);
      }
    }
  }
}

function reject(status, reason) {
  return { ok: false, status, reason };
}

// Verifies a bridge request. Returns { ok, viewer } where viewer is null for
// plugin-level calls (capabilities) and { id, admin } for calls made for a viewer.
function verifyRequest({ method, pathAndQuery, headers, body }, secret, nowMs, nonces) {
  if (!secret) return reject(503, 'bridge not configured');
  const timestamp = header(headers, 'x-zorofin-timestamp');
  const nonce = header(headers, 'x-zorofin-nonce');
  const userId = header(headers, 'x-zorofin-user');
  const admin = header(headers, 'x-zorofin-user-admin');
  const signature = header(headers, 'x-zorofin-signature').toLowerCase();

  if (!/^\d{1,12}$/.test(timestamp) || !NONCE.test(nonce) || !SIGNATURE.test(signature)) {
    return reject(401, 'missing or malformed bridge headers');
  }
  if (userId && !USER_ID.test(userId)) return reject(401, 'malformed user');
  if (admin !== '0' && admin !== '1') return reject(401, 'malformed admin flag');
  if (!userId && admin === '1') return reject(401, 'admin flag without user');
  if (Math.abs(Math.floor(nowMs / 1000) - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return reject(401, 'stale timestamp');
  }

  const expected = sign(secret, { method, pathAndQuery, timestamp, nonce, userId, admin: admin === '1', body });
  const left = Buffer.from(signature, 'hex');
  const right = Buffer.from(expected, 'hex');
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return reject(401, 'bad signature');
  }
  // Checked after the signature so unsigned noise cannot fill the cache.
  if (!nonces.remember(nonce, nowMs)) return reject(401, 'replayed nonce');

  return { ok: true, viewer: userId ? { id: userId, admin: admin === '1' } : null };
}

module.exports = {
  MAX_SKEW_SECONDS,
  NonceCache,
  SCHEME,
  canonicalString,
  sha256Hex,
  sign,
  verifyRequest,
};
