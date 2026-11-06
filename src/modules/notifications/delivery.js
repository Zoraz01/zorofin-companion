'use strict';

// Request-ready delivery, ported from request-notifier/lib.js. Seerr's
// MEDIA_AVAILABLE webhook starts a delivery; the title must be visible to the
// requester in Jellyfin before anything is sent. Pending deliveries are retried
// until maxPendingMs, and each channel is tracked separately.

const crypto = require('crypto');
const { readJsonFile, writePrivateJson } = require('../../lib/io');
const { cleanText, jellyfinId, normalizeTitle, safeIdentifier } = require('../../lib/text');
const { renderAvailabilityEmail } = require('./email');

function numericIdentifier(value) {
  const cleaned = cleanText(value, 20);
  return /^[1-9][0-9]{0,19}$/.test(cleaned) ? cleaned : '';
}

function sanitizeAvailabilityEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Payload must be a JSON object');
  }
  const mediaStatus = cleanText(input.media_status, 32).toUpperCase();
  const mediaType = cleanText(input.media_type, 16).toLowerCase();
  const event = {
    notificationType: cleanText(input.notification_type, 64).toUpperCase(),
    requestId: numericIdentifier(input.request_id),
    requesterJellyfinUserId: jellyfinId(input.requestedBy_jellyfinUserId),
    subject: cleanText(input.subject, 240),
    mediaStatus,
    mediaType,
    jellyfinMediaId: safeIdentifier(input.media_jellyfinMediaId),
    tmdbId: numericIdentifier(input.media_tmdbid),
    tvdbId: numericIdentifier(input.media_tvdbid),
  };
  if (event.notificationType !== 'MEDIA_AVAILABLE') return { ignored: true, reason: 'not_request_available', event };
  const ready = mediaStatus === 'AVAILABLE' || (mediaType === 'tv' && mediaStatus === 'PARTIALLY_AVAILABLE');
  if (!ready) return { ignored: true, reason: 'not_available', event };
  if (!event.requestId || !event.requesterJellyfinUserId || !event.subject || !['movie', 'tv'].includes(event.mediaType)) {
    throw new Error('Missing or invalid requester, request, subject, or media type');
  }
  if (!event.jellyfinMediaId && !event.tmdbId && !event.tvdbId) {
    throw new Error('At least one Jellyfin, TMDb, or TVDB media identifier is required');
  }
  return { ignored: false, event };
}

function eventKey(event) {
  return crypto.createHash('sha256').update(JSON.stringify([
    event.requestId, event.requesterJellyfinUserId, event.mediaType, event.jellyfinMediaId, event.tmdbId, event.tvdbId,
  ])).digest('hex');
}

function itemMatchesEvent(item, event) {
  if (!item || typeof item !== 'object') return false;
  if (item.Type !== (event.mediaType === 'movie' ? 'Movie' : 'Series')) return false;
  if (event.jellyfinMediaId && item.Id === event.jellyfinMediaId) return true;
  const providerIds = item.ProviderIds || {};
  if (event.tmdbId && String(providerIds.Tmdb || '') === event.tmdbId) return true;
  if (event.tvdbId && String(providerIds.Tvdb || '') === event.tvdbId) return true;
  return !event.tmdbId && !event.tvdbId && normalizeTitle(item.Name) === normalizeTitle(event.subject);
}

function emptyState() {
  return { version: 1, events: {} };
}

class Delivery {
  // options: stateFile, preferences (Preferences), jellyfin { url, apiKey },
  // email { apiUrl, apiKey, from, replyTo, logoBase64 } | null, ntfy { url, token } | null,
  // serverName, appUrl, maxPendingMs, retentionMs, now, requestJson, log
  constructor(options) {
    this.stateFile = options.stateFile;
    this.preferences = options.preferences;
    this.jellyfin = options.jellyfin;
    this.email = options.email;
    this.ntfy = options.ntfy;
    this.serverName = options.serverName;
    this.appUrl = options.appUrl;
    this.maxPendingMs = options.maxPendingMs || 6 * 60 * 60 * 1000;
    this.retentionMs = options.retentionMs || 30 * 24 * 60 * 60 * 1000;
    this.now = options.now || Date.now;
    this.requestJson = options.requestJson;
    this.log = options.log || (() => {});
    this.inFlight = new Map();
  }

  readState() {
    const state = readJsonFile(this.stateFile, emptyState());
    return state && state.version === 1 && state.events && typeof state.events === 'object' ? state : emptyState();
  }

  saveState(state) {
    writePrivateJson(this.stateFile, state);
  }

  stamp() {
    return new Date(this.now()).toISOString();
  }

  async handleEvent(payload) {
    this.pruneState();
    const parsed = sanitizeAvailabilityEvent(payload);
    if (parsed.ignored) return { status: 'ignored', reason: parsed.reason };
    const event = parsed.event;
    if (!this.preferences.channelsFor(event.requesterJellyfinUserId)) return { status: 'not_subscribed' };

    const key = eventKey(event);
    const state = this.readState();
    if (state.events[key] && state.events[key].status === 'delivered') return { status: 'duplicate' };
    if (!state.events[key]) {
      state.events[key] = { status: 'pending', receivedAt: this.stamp(), attempts: 0, event };
      this.saveState(state);
    }
    if (this.inFlight.has(key)) {
      await this.inFlight.get(key);
      return { status: 'duplicate' };
    }
    return this.deliverOnce(key);
  }

  async deliverOnce(key) {
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const operation = this.attemptDelivery(key);
    this.inFlight.set(key, operation);
    try { return await operation; }
    finally { this.inFlight.delete(key); }
  }

  async verifyAvailability(event) {
    const headers = { Authorization: `MediaBrowser Token="${this.jellyfin.apiKey}"` };
    if (event.jellyfinMediaId) {
      const direct = await this.requestJson(new URL(
        `Users/${encodeURIComponent(event.requesterJellyfinUserId)}/Items/${encodeURIComponent(event.jellyfinMediaId)}`,
        this.jellyfin.url,
      ), { headers, timeout: 8000 });
      if (direct.status === 200 && itemMatchesEvent(direct.body, event)) return direct.body;
      if (![403, 404].includes(direct.status)) throw new Error(`Jellyfin item verification returned HTTP ${direct.status}`);
    }

    const search = new URL('Items', this.jellyfin.url);
    search.searchParams.set('UserId', event.requesterJellyfinUserId);
    search.searchParams.set('Recursive', 'true');
    search.searchParams.set('IncludeItemTypes', 'Movie,Series');
    search.searchParams.set('SearchTerm', event.subject);
    search.searchParams.set('Fields', 'ProviderIds');
    search.searchParams.set('Limit', '25');
    search.searchParams.set('EnableTotalRecordCount', 'false');
    const result = await this.requestJson(search, { headers, timeout: 10000 });
    if (result.status !== 200) throw new Error(`Jellyfin search returned HTTP ${result.status}`);
    const matches = ((result.body && result.body.Items) || []).filter(item => itemMatchesEvent(item, event));
    return matches.length === 1 ? matches[0] : null;
  }

  async publishNtfy(event, topic, test = false) {
    if (!this.ntfy) throw new Error('ntfy is not configured');
    const payload = {
      topic,
      title: test ? 'Test alert' : 'Ready to watch',
      message: test ? `Request alerts from ${this.serverName} will appear here.` : `${event.subject} is now available on ${this.serverName}.`,
      priority: 3,
      tags: ['movie_camera'],
    };
    if (this.appUrl) payload.click = this.appUrl;
    const response = await this.requestJson(this.ntfy.url, {
      method: 'POST',
      headers: this.ntfy.token ? { Authorization: `Bearer ${this.ntfy.token}` } : {},
      body: payload,
      timeout: 10000,
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`ntfy publish returned HTTP ${response.status}`);
    return (response.body && response.body.id) || null;
  }

  async sendEmail(event, address, key) {
    if (!this.email) throw new Error('email is not configured');
    const message = renderAvailabilityEmail({
      title: event.subject,
      mediaType: event.mediaType,
      serverName: this.serverName,
      appUrl: this.appUrl,
      logoSrc: this.email.logoBase64 ? 'cid:zorofin-mark' : '',
    });
    return sendWithResend(this, { to: address, ...message }, `request-available/${key}`);
  }

  async attemptDelivery(key) {
    const state = this.readState();
    const record = state.events[key];
    if (!record || record.status !== 'pending') return { status: (record && record.status) || 'missing' };
    const ageMs = this.now() - Date.parse(record.receivedAt);
    if (!Number.isFinite(ageMs) || ageMs > this.maxPendingMs) {
      record.status = 'expired';
      record.expiredAt = this.stamp();
      this.saveState(state);
      this.log(`availability event expired key=${key.slice(0, 12)}`);
      return { status: 'expired' };
    }

    record.attempts += 1;
    record.lastAttemptAt = this.stamp();
    try {
      const channels = this.preferences.channelsFor(record.event.requesterJellyfinUserId);
      if (!channels) {
        record.status = 'unsubscribed';
        record.completedAt = this.stamp();
        this.saveState(state);
        return { status: 'unsubscribed' };
      }
      const item = await this.verifyAvailability(record.event);
      if (!item) {
        record.lastError = 'not_visible_in_jellyfin';
        this.saveState(state);
        return { status: 'pending' };
      }
      record.jellyfinItemId = item.Id;
      record.deliveries = record.deliveries && typeof record.deliveries === 'object' ? record.deliveries : {};
      const names = Object.keys(channels);
      for (const channel of names) {
        if (record.deliveries[channel] && record.deliveries[channel].status === 'delivered') continue;
        try {
          const messageId = channel === 'ntfy'
            ? await this.publishNtfy(record.event, channels.ntfy)
            : await this.sendEmail(record.event, channels.email, key);
          record.deliveries[channel] = { status: 'delivered', deliveredAt: this.stamp(), messageId };
        } catch (error) {
          record.deliveries[channel] = { status: 'pending', lastAttemptAt: this.stamp(), lastError: cleanText(error.message, 240) || 'delivery_failed' };
        }
        this.saveState(state);
      }

      const pending = names.filter(channel => record.deliveries[channel].status !== 'delivered');
      if (pending.length) {
        record.lastError = pending.map(channel => `${channel}:${record.deliveries[channel].lastError}`).join(',');
        this.saveState(state);
        this.log(`availability notification pending key=${key.slice(0, 12)} channels=${pending.join(',')}`);
        return { status: 'pending' };
      }
      record.status = 'delivered';
      record.deliveredAt = this.stamp();
      delete record.lastError;
      this.saveState(state);
      this.log(`availability notification delivered key=${key.slice(0, 12)} channels=${names.join(',')}`);
      return { status: 'delivered' };
    } catch (error) {
      record.lastError = cleanText(error.message, 240) || 'delivery_failed';
      this.saveState(state);
      this.log(`availability notification pending key=${key.slice(0, 12)} reason=${record.lastError}`);
      return { status: 'pending' };
    }
  }

  async retryPending() {
    const keys = Object.entries(this.readState().events)
      .filter(([, record]) => record && record.status === 'pending')
      .map(([key]) => key);
    const results = [];
    for (const key of keys) results.push(await this.deliverOnce(key));
    this.pruneState();
    return results;
  }

  pruneState() {
    const state = this.readState();
    const cutoff = this.now() - this.retentionMs;
    let changed = false;
    for (const [key, record] of Object.entries(state.events)) {
      if (!record || record.status === 'pending') continue;
      const at = Date.parse(record.deliveredAt || record.expiredAt || record.completedAt || record.receivedAt || '');
      if (Number.isFinite(at) && at < cutoff) {
        delete state.events[key];
        changed = true;
      }
    }
    if (changed) this.saveState(state);
    return changed;
  }

  // Forgets one viewer's delivery history (account removal or opt-out).
  forgetUser(userId) {
    const state = this.readState();
    let changed = false;
    for (const [key, record] of Object.entries(state.events)) {
      if (record && record.event && record.event.requesterJellyfinUserId === userId) {
        delete state.events[key];
        changed = true;
      }
    }
    if (changed) this.saveState(state);
  }

  counts() {
    const counts = {};
    for (const record of Object.values(this.readState().events)) {
      const status = (record && record.status) || 'invalid';
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }
}

async function sendWithResend(owner, { to, subject, html, text }, idempotencyKey) {
  const email = owner.email;
  const payload = { from: email.from, to: [to], subject, html, text };
  if (email.logoBase64) {
    payload.attachments = [{ content: email.logoBase64, filename: 'zorofin-mark.png', content_id: 'zorofin-mark' }];
  }
  if (email.replyTo) payload.reply_to = email.replyTo;
  const response = await owner.requestJson(new URL('emails', email.apiUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${email.apiKey}`,
      'User-Agent': 'Zorofin-Companion/1.0',
      'Idempotency-Key': idempotencyKey,
    },
    body: payload,
    timeout: 15000,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`email publish returned HTTP ${response.status}`);
  return (response.body && response.body.id) || null;
}

module.exports = { Delivery, eventKey, itemMatchesEvent, sanitizeAvailabilityEvent, sendWithResend };
