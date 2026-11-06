'use strict';

// notifications: tells a viewer when a title they requested is ready to watch.
// Seerr sends MEDIA_AVAILABLE to /v1/hooks/seerr; viewers manage their alert
// channels from the apps. Email goes through the operator's Resend account and
// push through the operator's ntfy server. Zorofin supplies no keys.

const fs = require('fs');
const path = require('path');
const { httpUrl } = require('../../config');
const { readSecret, requestJson } = require('../../lib/io');
const { cleanText, normalizeEmail } = require('../../lib/text');
const { Delivery, sendWithResend } = require('./delivery');
const { renderConfirmationEmail } = require('./email');
const { createLogin, deleteLogin, resetPassword } = require('./ntfy-logins');
const { Preferences } = require('./preferences');

const ID = 'notifications';
const VERSION = 1;
const TEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_TESTS_PER_WINDOW = 3;

function settingsFrom(env, config) {
  const errors = [];
  const emailApiKey = readSecret(env, 'ZOROFIN_NOTIFY_EMAIL_API_KEY');
  const emailFrom = cleanText(env.ZOROFIN_NOTIFY_EMAIL_FROM, 320);
  const emailApiUrl = httpUrl(env.ZOROFIN_NOTIFY_EMAIL_API_URL || 'https://api.resend.com');
  const ntfyUrl = httpUrl(env.ZOROFIN_NOTIFY_NTFY_URL);
  const ntfyPublicUrl = httpUrl(env.ZOROFIN_NOTIFY_NTFY_PUBLIC_URL);
  const appUrl = httpUrl(env.ZOROFIN_APP_URL);
  let logoBase64 = '';
  if (env.ZOROFIN_NOTIFY_EMAIL_LOGO) {
    try { logoBase64 = fs.readFileSync(env.ZOROFIN_NOTIFY_EMAIL_LOGO).toString('base64'); }
    catch (_) { errors.push('ZOROFIN_NOTIFY_EMAIL_LOGO cannot be read'); }
  }

  const jellyfinMissing = [!config.jellyfinUrl && 'ZOROFIN_JELLYFIN_URL', !config.jellyfinApiKey && 'ZOROFIN_JELLYFIN_API_KEY'].filter(Boolean);
  if (jellyfinMissing.length) errors.push(`needs ${jellyfinMissing.join(' and ')} to confirm titles are playable`);
  if (!config.seerrWebhookSecret) errors.push('needs ZOROFIN_SEERR_WEBHOOK_SECRET so Seerr can report ready requests');
  if (emailApiUrl === null) errors.push('ZOROFIN_NOTIFY_EMAIL_API_URL must be a plain http(s) URL');
  if ((emailApiKey && !emailFrom) || (!emailApiKey && emailFrom)) errors.push('email needs both ZOROFIN_NOTIFY_EMAIL_API_KEY and ZOROFIN_NOTIFY_EMAIL_FROM');
  if (ntfyUrl === null || ntfyPublicUrl === null || appUrl === null) errors.push('ntfy and app URLs must be plain http(s) URLs');
  const email = emailApiKey && emailFrom && emailApiUrl
    ? { apiUrl: emailApiUrl, apiKey: emailApiKey, from: emailFrom, replyTo: normalizeEmail(env.ZOROFIN_NOTIFY_EMAIL_REPLY_TO), logoBase64 }
    : null;
  const ntfy = ntfyUrl
    ? { url: ntfyUrl, token: readSecret(env, 'ZOROFIN_NOTIFY_NTFY_TOKEN'), adminToken: readSecret(env, 'ZOROFIN_NOTIFY_NTFY_ADMIN_TOKEN'), publicUrl: ntfyPublicUrl || ntfyUrl }
    : null;
  if (!email && !ntfy) errors.push('configure email (ZOROFIN_NOTIFY_EMAIL_*) and/or ntfy (ZOROFIN_NOTIFY_NTFY_URL)');
  if (errors.length) throw new Error(errors.join('; '));
  return { email, ntfy, appUrl: appUrl || '', serverName: cleanText(env.ZOROFIN_SERVER_NAME, 80) || 'your server' };
}

function reply(status, body) {
  return { status, body };
}

function createNotifications(config, deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || (() => {});
  const now = deps.now || Date.now;
  const settings = deps.settings || settingsFrom(env, config);
  const send = deps.requestJson || requestJson;
  const dir = path.join(config.dataDir, ID);
  const preferences = new Preferences(path.join(dir, 'preferences.json'), { now, ...(deps.preferenceOptions || {}) });
  preferences.available = { email: Boolean(settings.email), ntfy: Boolean(settings.ntfy) };
  const delivery = new Delivery({
    stateFile: path.join(dir, 'deliveries.json'),
    preferences,
    jellyfin: { url: config.jellyfinUrl, apiKey: config.jellyfinApiKey },
    email: settings.email,
    ntfy: settings.ntfy,
    serverName: settings.serverName,
    appUrl: settings.appUrl,
    now,
    requestJson: send,
    log,
  });
  let timer = null;

  function view(userId) {
    const entry = preferences.get(userId);
    return {
      channels: { email: Boolean(settings.email), ntfy: Boolean(settings.ntfy) },
      email: entry.email ? { address: entry.email.address, enabled: Boolean(entry.email.enabled) } : null,
      pendingEmail: entry.pendingEmail && entry.pendingEmail.expiresAt > now() ? entry.pendingEmail.address : null,
      ntfy: settings.ntfy && entry.ntfy
        ? { enabled: Boolean(entry.ntfy.enabled), server: settings.ntfy.publicUrl, topic: entry.ntfy.topic, username: entry.ntfy.user || null }
        : null,
    };
  }

  const privateLogins = () => Boolean(settings.ntfy && settings.ntfy.adminToken);

  // Turns push on. With an ntfy admin token each viewer also gets a private
  // read-only login; its password is returned once.
  async function enablePush(userId) {
    const entry = preferences.get(userId);
    if (entry.ntfy && entry.ntfy.topic && (!privateLogins() || entry.ntfy.user)) {
      preferences.update(userId, current => { current.ntfy.enabled = true; });
      return {};
    }
    const topic = (entry.ntfy && entry.ntfy.topic) || preferences.newTopic();
    const login = privateLogins() ? await createLogin(settings.ntfy, send, topic) : null;
    preferences.update(userId, current => {
      current.ntfy = { topic, enabled: true, ...(login ? { user: login.username } : {}) };
    });
    return login ? { password: login.password } : {};
  }

  async function disablePush(userId) {
    const entry = preferences.get(userId);
    if (!entry.ntfy) return;
    if (entry.ntfy.user && privateLogins()) {
      try {
        await deleteLogin(settings.ntfy, send, entry.ntfy.user);
        preferences.update(userId, current => { delete current.ntfy; }); // a new topic and login next time
        return;
      } catch (error) {
        log(`could not delete a push login, it stays disabled: ${error.message}`);
      }
    }
    preferences.update(userId, current => { current.ntfy.enabled = false; });
  }

  async function sendTest(userId, channel) {
    const allowed = preferences.update(userId, entry => {
      const sent = (entry.testsSent || []).filter(at => at > now() - TEST_WINDOW_MS);
      if (sent.length >= MAX_TESTS_PER_WINDOW) {
        entry.testsSent = sent;
        return false;
      }
      entry.testsSent = [...sent, now()];
      return true;
    });
    if (!allowed) return reply(429, { error: 'too_many_tests' });
    const channels = preferences.channelsFor(userId) || {};
    const sample = { subject: 'Test alert', mediaType: 'movie' };
    try {
      if (channel === 'ntfy' && channels.ntfy) await delivery.publishNtfy(sample, channels.ntfy, true);
      else if (channel === 'email' && channels.email) await delivery.sendEmail(sample, channels.email, `test/${userId}/${now()}`);
      else return reply(400, { error: 'channel_not_enabled' });
    } catch (error) {
      log(`test ${channel} alert failed: ${error.message}`);
      return reply(502, { error: 'test_failed' });
    }
    return reply(200, { sent: channel });
  }

  async function startEmail(userId, body) {
    if (!settings.email) return reply(404, { error: 'email_unavailable' });
    const started = preferences.startEmail(userId, body && body.address);
    if (started.error) return reply(started.error === 'too_many_codes' ? 429 : 400, { error: started.error });
    const message = renderConfirmationEmail({
      code: started.code,
      serverName: settings.serverName,
      logoSrc: settings.email.logoBase64 ? 'cid:zorofin-mark' : '',
    });
    try {
      await sendWithResend({ email: settings.email, requestJson: send }, { to: started.address, ...message }, `confirm/${userId}/${now()}`);
    } catch (error) {
      log(`confirmation email failed: ${error.message}`);
      return reply(502, { error: 'email_failed' });
    }
    return reply(202, view(userId));
  }

  return {
    id: ID,
    capabilities: () => ({ [ID]: { version: VERSION, enabled: true } }),

    async handle({ method, segments, body, viewer }) {
      const route = `${method} ${segments.join('/')}`;
      switch (route) {
        case 'GET preferences':
          return reply(200, view(viewer.id));
        case 'POST preferences': {
          const flags = body && typeof body === 'object' ? body : {};
          let password = null;
          if (settings.ntfy && typeof flags.ntfyEnabled === 'boolean') {
            try {
              if (flags.ntfyEnabled) password = (await enablePush(viewer.id)).password || null;
              else await disablePush(viewer.id);
            } catch (error) {
              log(`push setup failed: ${error.message}`);
              return reply(502, { error: 'push_setup_failed' });
            }
          }
          preferences.setEnabled(viewer.id, { email: typeof flags.emailEnabled === 'boolean' ? flags.emailEnabled : undefined });
          if (!preferences.channelsFor(viewer.id)) delivery.forgetUser(viewer.id);
          return reply(200, password ? { ...view(viewer.id), ntfyPassword: password } : view(viewer.id));
        }
        case 'POST preferences/push/reset-password': {
          const entry = preferences.get(viewer.id);
          if (!privateLogins() || !entry.ntfy || !entry.ntfy.user) return reply(404, { error: 'no_push_login' });
          try {
            return reply(200, { ...view(viewer.id), ntfyPassword: await resetPassword(settings.ntfy, send, entry.ntfy.user) });
          } catch (error) {
            log(`push password reset failed: ${error.message}`);
            return reply(502, { error: 'push_setup_failed' });
          }
        }
        case 'POST preferences/test':
          return sendTest(viewer.id, body && body.channel);
        case 'POST preferences/email':
          return startEmail(viewer.id, body);
        case 'POST preferences/email/confirm': {
          const result = preferences.confirmEmail(viewer.id, body && body.code);
          if (result === 'ok') return reply(200, view(viewer.id));
          return reply(result === 'locked' ? 429 : 400, { error: result === 'wrong' ? 'wrong_code' : `code_${result}` });
        }
        case 'POST preferences/email/remove':
          preferences.removeEmail(viewer.id);
          if (!preferences.channelsFor(viewer.id)) delivery.forgetUser(viewer.id);
          return reply(200, view(viewer.id));
        case 'GET status':
          if (!viewer.admin) return reply(403, { error: 'admin_only' });
          return reply(200, { channels: view(viewer.id).channels, preferences: preferences.counts(), deliveries: delivery.counts() });
        default:
          return reply(404, { error: 'Not found' });
      }
    },

    async onSeerrEvent(event) {
      try { await delivery.handleEvent(event); }
      catch (error) { log(`ignored Seerr event: ${error.message}`); }
    },

    start() {
      timer = setInterval(() => delivery.retryPending().catch(error => log(`retry failed: ${error.message}`)), 60_000);
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    // For tests.
    delivery,
    preferences,
  };
}

module.exports = { ID, createNotifications, settingsFrom };
