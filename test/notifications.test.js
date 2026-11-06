'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNotifications, settingsFrom } = require('../src/modules/notifications');
const { sanitizeAvailabilityEvent } = require('../src/modules/notifications/delivery');
const { renderAvailabilityEmail } = require('../src/modules/notifications/email');

const VIEWER = '4f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f';
const OTHER = '0f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f';
const SETTINGS = {
  email: { apiUrl: 'https://mail.example/', apiKey: 'mail-key', from: 'Alerts <alerts@example.com>', replyTo: '', logoBase64: '' },
  ntfy: { url: 'http://ntfy.example/', token: 'ntfy-token', publicUrl: 'https://push.example/' },
  appUrl: 'https://watch.example/',
  serverName: 'Example Home',
};

function event(overrides = {}) {
  return {
    notification_type: 'MEDIA_AVAILABLE',
    request_id: '42',
    requestedBy_jellyfinUserId: '4f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f',
    requestedBy_email: 'must-not-be-retained@example.com',
    subject: 'Example Movie',
    media_status: 'AVAILABLE',
    media_type: 'movie',
    media_jellyfinMediaId: 'item1',
    media_tmdbid: '1234',
    media_tvdbid: '',
    ...overrides,
  };
}

// Fake upstreams: Jellyfin answers from `visible`, mail and ntfy are recorded.
function harness({ visible = true, failEmail = false, settings = SETTINGS } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-notify-'));
  const calls = { ntfy: [], email: [], jellyfin: 0, admin: [] };
  const state = { visible, failEmail, time: Date.parse('2026-10-29T12:00:00Z') };
  const requestJson = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://jellyfin.test/')) {
      calls.jellyfin += 1;
      return state.visible
        ? { status: 200, body: { Id: 'item1', Type: 'Movie', Name: 'Example Movie', ProviderIds: { Tmdb: '1234' } } }
        : { status: 404, body: null };
    }
    if (target.startsWith('http://ntfy.example/v1/users')) {
      calls.admin.push({ method: options.method, path: new URL(target).pathname, body: options.body, auth: options.headers.Authorization });
      return { status: state.adminDown ? 500 : 200, body: { success: true } };
    }
    if (target === 'http://ntfy.example/') {
      calls.ntfy.push(options);
      return { status: 200, body: { id: `n${calls.ntfy.length}` } };
    }
    if (target === 'https://mail.example/emails') {
      calls.email.push(options);
      return state.failEmail ? { status: 500, body: null } : { status: 200, body: { id: `e${calls.email.length}` } };
    }
    throw new Error(`unexpected ${target}`);
  };
  const module = createNotifications(
    { dataDir, jellyfinUrl: 'http://jellyfin.test/', jellyfinApiKey: 'jf-key', seerrWebhookSecret: 's'.repeat(32) },
    { settings, requestJson, now: () => state.time, preferenceOptions: { newCode: () => '123456', newTopic: () => 'zorofin-topic' } },
  );
  const call = (method, route, body, viewer = { id: VIEWER, admin: false }) =>
    module.handle({ method, segments: route.split('/'), body, viewer });
  return { module, calls, state, call, dataDir };
}

async function subscribeEmail(h) {
  assert.equal((await h.call('POST', 'preferences/email', { address: 'Viewer@Example.com' })).status, 202);
  assert.equal((await h.call('POST', 'preferences/email/confirm', { code: '123456' })).status, 200);
}

test('sanitizes the event without keeping Seerr email fields and normalizes the requester id', () => {
  const parsed = sanitizeAvailabilityEvent(event());
  assert.equal(parsed.event.requesterJellyfinUserId, VIEWER);
  assert.equal(JSON.stringify(parsed).includes('must-not-be-retained'), false);
  assert.equal(sanitizeAvailabilityEvent(event({ media_status: 'PARTIALLY_AVAILABLE' })).ignored, true);
  assert.equal(sanitizeAvailabilityEvent(event({ media_type: 'tv', media_status: 'PARTIALLY_AVAILABLE' })).ignored, false);
  assert.equal(sanitizeAvailabilityEvent(event({ notification_type: 'MEDIA_APPROVED' })).ignored, true);
  assert.throws(() => sanitizeAvailabilityEvent(event({ requestedBy_jellyfinUserId: 'bob' })));
});

test('email is used only after the viewer confirms the code sent to it', async () => {
  const h = harness();
  const started = await h.call('POST', 'preferences/email', { address: 'Viewer@Example.com' });
  assert.equal(started.status, 202);
  assert.equal(started.body.pendingEmail, 'viewer@example.com');
  assert.equal(started.body.email, null);
  assert.match(h.calls.email[0].body.text, /123456/);
  assert.deepEqual(h.calls.email[0].body.to, ['viewer@example.com']);

  await h.module.onSeerrEvent(event());
  assert.equal(h.calls.email.length, 1, 'no alert before confirmation');

  assert.equal((await h.call('POST', 'preferences/email/confirm', { code: '000000' })).body.error, 'wrong_code');
  const confirmed = await h.call('POST', 'preferences/email/confirm', { code: '123456' });
  assert.deepEqual(confirmed.body.email, { address: 'viewer@example.com', enabled: true });
});

test('code attempts and code sends are limited', async () => {
  const h = harness();
  await h.call('POST', 'preferences/email', { address: 'a@example.com' });
  for (let i = 0; i < 5; i += 1) await h.call('POST', 'preferences/email/confirm', { code: '999999' });
  assert.equal((await h.call('POST', 'preferences/email/confirm', { code: '123456' })).status, 429);
  await h.call('POST', 'preferences/email', { address: 'a@example.com' });
  await h.call('POST', 'preferences/email', { address: 'a@example.com' });
  assert.equal((await h.call('POST', 'preferences/email', { address: 'a@example.com' })).status, 429);
  assert.equal((await h.call('POST', 'preferences/email', { address: 'not an email' })).status, 400);
  h.state.time += 31 * 60 * 1000;
  assert.equal((await h.call('POST', 'preferences/email/confirm', { code: '123456' })).body.error, 'code_expired');
});

test('sends one alert per channel after Jellyfin shows the title to the requester', async () => {
  const h = harness();
  await subscribeEmail(h);
  const prefs = await h.call('POST', 'preferences', { ntfyEnabled: true });
  assert.deepEqual(prefs.body.ntfy, { enabled: true, server: 'https://push.example/', topic: 'zorofin-topic', username: null });

  await h.module.onSeerrEvent(event());
  await h.module.onSeerrEvent(event());
  assert.equal(h.calls.ntfy.length, 1);
  assert.equal(h.calls.ntfy[0].body.topic, 'zorofin-topic');
  assert.equal(h.calls.ntfy[0].body.message, 'Example Movie is now available on Example Home.');
  assert.equal(h.calls.email.length, 2); // confirmation + alert
  assert.equal(h.calls.email[1].body.subject, 'Ready to watch: Example Movie');
  assert.match(h.calls.email[1].headers['Idempotency-Key'], /^request-available\//);
});

test('waits until the title is visible, and retries only the failed channel', async () => {
  const h = harness({ visible: false });
  await subscribeEmail(h);
  await h.call('POST', 'preferences', { ntfyEnabled: true });
  await h.module.onSeerrEvent(event());
  assert.equal(h.calls.ntfy.length, 0);

  h.state.visible = true;
  h.state.failEmail = true;
  await h.module.delivery.retryPending();
  assert.equal(h.calls.ntfy.length, 1);
  assert.equal(h.module.delivery.counts().pending, 1);

  h.state.failEmail = false;
  await h.module.delivery.retryPending();
  assert.equal(h.calls.ntfy.length, 1, 'push not repeated');
  assert.equal(h.module.delivery.counts().delivered, 1);
});

test('ignores viewers without alerts and forgets history when the last channel is turned off', async () => {
  const h = harness();
  await h.module.onSeerrEvent(event({ requestedBy_jellyfinUserId: OTHER }));
  assert.equal(h.calls.jellyfin, 0);

  await h.call('POST', 'preferences', { ntfyEnabled: true });
  await h.module.onSeerrEvent(event());
  assert.equal(h.module.delivery.counts().delivered, 1);
  const off = await h.call('POST', 'preferences', { ntfyEnabled: false });
  assert.equal(off.body.ntfy.enabled, false);
  assert.deepEqual(h.module.delivery.counts(), {});
});

test('status is admin-only and preferences are per viewer', async () => {
  const h = harness();
  await h.call('POST', 'preferences', { ntfyEnabled: true });
  assert.equal((await h.call('GET', 'status')).status, 403);
  const status = await h.call('GET', 'status', null, { id: OTHER, admin: true });
  assert.deepEqual(status.body.preferences, { viewers: 1, email: 0, ntfy: 1 });
  assert.equal((await h.call('GET', 'preferences', null, { id: OTHER, admin: true })).body.ntfy, null);
  assert.equal((await h.call('GET', 'nope')).status, 404);
});

test('hides channels the operator did not configure', async () => {
  const h = harness({ settings: { ...SETTINGS, email: null } });
  assert.deepEqual((await h.call('GET', 'preferences')).body.channels, { email: false, ntfy: true });
  assert.equal((await h.call('POST', 'preferences/email', { address: 'a@example.com' })).status, 404);
});

test('settings require Jellyfin, the Seerr secret and at least one channel', () => {
  const base = { jellyfinUrl: 'http://jf/', jellyfinApiKey: 'k', seerrWebhookSecret: 's'.repeat(32) };
  assert.throws(() => settingsFrom({}, base), /configure email/);
  assert.throws(() => settingsFrom({ ZOROFIN_NOTIFY_NTFY_URL: 'http://ntfy' }, { ...base, jellyfinApiKey: '' }), /needs ZOROFIN_JELLYFIN_API_KEY to confirm/);
  assert.throws(() => settingsFrom({ ZOROFIN_NOTIFY_EMAIL_API_KEY: 'k' }, base), /both/);
  const settings = settingsFrom({ ZOROFIN_NOTIFY_NTFY_URL: 'http://ntfy:80', ZOROFIN_SERVER_NAME: 'Den' }, base);
  assert.equal(settings.ntfy.publicUrl, 'http://ntfy/');
  assert.equal(settings.serverName, 'Den');
});

test('availability email escapes titles', () => {
  const message = renderAvailabilityEmail({ title: '<script>x</script>', mediaType: 'movie', serverName: 'Den', appUrl: 'javascript:alert(1)' });
  assert.equal(message.html.includes('<script>'), false);
  assert.equal(message.html.includes('javascript:'), false);
});

test('with an ntfy admin token each viewer gets a private read-only login', async () => {
  const h = harness({ settings: { ...SETTINGS, ntfy: { ...SETTINGS.ntfy, adminToken: 'admin-token' } } });
  const on = await h.call('POST', 'preferences', { ntfyEnabled: true });
  assert.match(on.body.ntfy.username, /^zf_[0-9a-f]{16}$/);
  assert.ok(on.body.ntfyPassword.length >= 16, 'password shown once');
  assert.deepEqual(h.calls.admin.map(call => `${call.method} ${call.path}`), ['POST /v1/users', 'PUT /v1/users/access']);
  assert.deepEqual(h.calls.admin[1].body, { username: on.body.ntfy.username, topic: 'zorofin-topic', permission: 'read-only' });
  assert.equal(h.calls.admin[0].auth, 'Bearer admin-token');
  assert.equal((await h.call('GET', 'preferences')).body.ntfyPassword, undefined);

  const reset = await h.call('POST', 'preferences/push/reset-password');
  assert.ok(reset.body.ntfyPassword && reset.body.ntfyPassword !== on.body.ntfyPassword);

  await h.call('POST', 'preferences', { ntfyEnabled: false });
  assert.equal(h.calls.admin.at(-1).method, 'DELETE');
  assert.equal((await h.call('GET', 'preferences')).body.ntfy, null, 'login and topic removed');
});

test('a failed login setup leaves push off', async () => {
  const h = harness({ settings: { ...SETTINGS, ntfy: { ...SETTINGS.ntfy, adminToken: 'admin-token' } } });
  h.state.adminDown = true;
  assert.equal((await h.call('POST', 'preferences', { ntfyEnabled: true })).status, 502);
  assert.equal((await h.call('GET', 'preferences')).body.ntfy, null);
});

test('test alerts go only to enabled channels and are limited', async () => {
  const h = harness();
  assert.equal((await h.call('POST', 'preferences/test', { channel: 'ntfy' })).status, 400);
  await h.call('POST', 'preferences', { ntfyEnabled: true });
  assert.equal((await h.call('POST', 'preferences/test', { channel: 'ntfy' })).status, 200);
  assert.equal(h.calls.ntfy[0].body.message, 'Request alerts from Example Home will appear here.');
  await h.call('POST', 'preferences/test', { channel: 'ntfy' });
  assert.equal((await h.call('POST', 'preferences/test', { channel: 'ntfy' })).status, 429);
});
