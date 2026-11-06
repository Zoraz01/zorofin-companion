'use strict';

// Per-viewer alert preferences, keyed by Jellyfin user id. Viewers manage them
// from the apps; an email address is used only after the viewer confirms a
// code sent to it.

const crypto = require('crypto');
const { readJsonFile, writePrivateJson } = require('../../lib/io');
const { normalizeEmail } = require('../../lib/text');

const CODE_TTL_MS = 30 * 60 * 1000;
const CODE_WINDOW_MS = 60 * 60 * 1000;
const MAX_CODES_PER_WINDOW = 3;
const MAX_CODE_ATTEMPTS = 5;

function hashCode(userId, code) {
  return crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

class Preferences {
  constructor(file, { now = Date.now, newCode, newTopic } = {}) {
    this.file = file;
    this.now = now;
    this.newCode = newCode || (() => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'));
    this.newTopic = newTopic || (() => `zorofin-${crypto.randomBytes(18).toString('hex')}`);
  }

  read() {
    const data = readJsonFile(this.file, null);
    return data && data.version === 1 && data.users && typeof data.users === 'object' && !Array.isArray(data.users)
      ? data
      : { version: 1, users: {} };
  }

  update(userId, change) {
    const data = this.read();
    const entry = data.users[userId] || {};
    const result = change(entry);
    if (Object.keys(entry).length) data.users[userId] = entry;
    else delete data.users[userId];
    writePrivateJson(this.file, data);
    return result;
  }

  get(userId) {
    return this.read().users[userId] || {};
  }

  // Channels to deliver on, limited to what the operator configured.
  channelsFor(userId, available = this.available || { email: true, ntfy: true }) {
    const entry = this.get(userId);
    const channels = {};
    if (available.email && entry.email && entry.email.enabled && normalizeEmail(entry.email.address)) {
      channels.email = entry.email.address;
    }
    if (available.ntfy && entry.ntfy && entry.ntfy.enabled && entry.ntfy.topic) channels.ntfy = entry.ntfy.topic;
    return Object.keys(channels).length ? channels : null;
  }

  // Returns { code, address } to send, or { error }.
  startEmail(userId, value) {
    const address = normalizeEmail(value);
    if (!address) return { error: 'invalid_email' };
    return this.update(userId, entry => {
      const now = this.now();
      const sent = (entry.codesSent || []).filter(at => at > now - CODE_WINDOW_MS);
      if (sent.length >= MAX_CODES_PER_WINDOW) {
        entry.codesSent = sent;
        return { error: 'too_many_codes' };
      }
      const code = this.newCode();
      entry.codesSent = [...sent, now];
      entry.pendingEmail = { address, codeHash: hashCode(userId, code), expiresAt: now + CODE_TTL_MS, attempts: 0 };
      return { code, address };
    });
  }

  confirmEmail(userId, code) {
    return this.update(userId, entry => {
      const pending = entry.pendingEmail;
      if (!pending || pending.expiresAt < this.now()) {
        delete entry.pendingEmail;
        return 'expired';
      }
      if (pending.attempts >= MAX_CODE_ATTEMPTS) return 'locked';
      const expected = Buffer.from(pending.codeHash, 'hex');
      const actual = Buffer.from(hashCode(userId, String(code || '').trim()), 'hex');
      if (!crypto.timingSafeEqual(expected, actual)) {
        pending.attempts += 1;
        return pending.attempts >= MAX_CODE_ATTEMPTS ? 'locked' : 'wrong';
      }
      entry.email = { address: pending.address, enabled: true, confirmedAt: new Date(this.now()).toISOString() };
      delete entry.pendingEmail;
      return 'ok';
    });
  }

  setEnabled(userId, { email }) {
    this.update(userId, entry => {
      if (typeof email === 'boolean' && entry.email) entry.email.enabled = email;
    });
  }

  removeEmail(userId) {
    this.update(userId, entry => {
      delete entry.email;
      delete entry.pendingEmail;
    });
  }

  counts() {
    const users = Object.values(this.read().users);
    return {
      viewers: users.length,
      email: users.filter(user => user.email && user.email.enabled).length,
      ntfy: users.filter(user => user.ntfy && user.ntfy.enabled).length,
    };
  }
}

module.exports = { CODE_TTL_MS, MAX_CODE_ATTEMPTS, MAX_CODES_PER_WINDOW, Preferences };
