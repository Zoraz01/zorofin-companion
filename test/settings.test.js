'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sign } = require('../src/bridge-auth');
const { createSettings, friendly, normalize } = require('../src/settings');
const { createServer } = require('../src/server');

const SECRET = 'zorofin-test-secret-0123456789abcdef';
const ADMIN = '4f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f';

// A stand-in for recommendations: needs Seerr from the shared connections and
// reads its AI choice from the environment, like the real module.
function fakeRecommendations(started) {
  return (config, deps) => {
    if (!deps.env.ZOROFIN_SEERR_URL || !deps.env.ZOROFIN_SEERR_API_KEY) throw new Error('needs ZOROFIN_SEERR_URL and ZOROFIN_SEERR_API_KEY');
    if (deps.env.ZOROFIN_RECOMMENDATIONS_AI === 'anthropic' && !deps.env.ZOROFIN_RECOMMENDATIONS_AI_KEY) throw new Error('ZOROFIN_RECOMMENDATIONS_AI needs ZOROFIN_RECOMMENDATIONS_AI_KEY');
    return {
      id: 'recommendations',
      ai: deps.env.ZOROFIN_RECOMMENDATIONS_AI || 'off',
      jellyfin: config.jellyfinUrl,
      capabilities: () => ({ recommendations: { version: 1, enabled: true } }),
      async handle() { return { status: 200, body: {} }; },
      start() { started.push('start'); },
      stop() { started.push('stop'); },
    };
  };
}
const webUi = () => ({ id: 'webUi', capabilities: () => ({ webUi: { version: 1, enabled: true } }), async handle() { return { status: 404, body: null }; } });

function setup({ env = {}, modules = [], dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-settings-')), reach } = {}) {
  const started = [];
  const startupConfig = { port: 9310, bind: '127.0.0.1', dataDir, bridgeSecret: SECRET, seerrWebhookSecret: '', jellyfinUrl: '', jellyfinApiKey: '', modules, privateModulesDir: '' };
  const baseEnv = { ZOROFIN_BRIDGE_SECRET: SECRET, ...env };
  const available = { recommendations: fakeRecommendations(started), webUi };
  const settings = createSettings({ baseEnv, startupConfig, available, deps: { requestJson: reach || (async () => ({ status: 200 })) } });
  return { settings, started, dataDir, section: id => settings.view().sections.find(s => s.id === id) };
}

test('shows environment values as defaults and never returns secrets', () => {
  const { section } = setup({ env: { ZOROFIN_SEERR_URL: 'http://seerr:5055', ZOROFIN_SEERR_API_KEY: 'seerr-key' } });
  const connections = section('connections');
  const url = connections.options.find(o => o.key === 'seerrUrl');
  const key = connections.options.find(o => o.key === 'seerrApiKey');
  assert.deepEqual([url.value, url.source], ['http://seerr:5055', 'environment']);
  assert.deepEqual([key.set, key.source, 'value' in key], [true, 'environment', false]);
  assert.equal(JSON.stringify(connections).includes('seerr-key'), false);
  const recs = section('recommendations');
  assert.equal(recs.enabled, false);
  assert.equal(recs.options.find(o => o.key === 'ai').value, 'off', 'choice default');
});

test('turning a module on applies at once and is kept across restarts', () => {
  const env = { ZOROFIN_SEERR_URL: 'http://seerr:5055' };
  const first = setup({ env });
  assert.throws(() => first.settings.save('recommendations', { enabled: true }), /Recommendations: needs Seerr address/);
  assert.equal(first.settings.registry.get('recommendations'), null, 'a failed save changes nothing');
  assert.equal(fs.existsSync(path.join(first.dataDir, 'settings.json')), false);

  first.settings.save('connections', { values: { seerrApiKey: 'typed-key' } });
  const view = first.settings.save('recommendations', { enabled: true, values: { ai: 'off' } });
  assert.deepEqual([view.enabled, view.running], [true, true]);
  assert.ok(first.settings.registry.get('recommendations'), 'running without a restart');
  assert.equal(first.settings.registry.capabilities().features.recommendations.enabled, true);
  const file = path.join(first.dataDir, 'settings.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const again = setup({ env, dataDir: first.dataDir });
  assert.ok(again.settings.registry.get('recommendations'), 'saved settings survive a restart');
  assert.equal(again.section('connections').options.find(o => o.key === 'seerrApiKey').source, 'dashboard');
});

test('an empty secret keeps the saved one; null goes back to the environment', () => {
  const { settings, section } = setup({ env: { ZOROFIN_SEERR_URL: 'http://seerr:5055', ZOROFIN_SEERR_API_KEY: 'env-key' }, modules: ['recommendations'] });
  settings.save('recommendations', { values: { ai: 'anthropic', aiKey: 'sk-1' } });
  assert.equal(settings.registry.get('recommendations').ai, 'anthropic');
  settings.save('recommendations', { values: { aiKey: '' } });
  assert.equal(settings.registry.get('recommendations').ai, 'anthropic', 'key kept, so the module still starts');
  assert.throws(() => settings.save('recommendations', { values: { aiKey: null } }), /needs AI API key/);
  settings.save('recommendations', { values: { ai: null, aiKey: null } });
  assert.equal(section('recommendations').options.find(o => o.key === 'ai').source, 'default');
});

test('connection changes reach modules that read the shared config', () => {
  const { settings } = setup({ env: { ZOROFIN_SEERR_URL: 'http://seerr:5055', ZOROFIN_SEERR_API_KEY: 'k' }, modules: ['recommendations'] });
  settings.save('connections', { values: { jellyfinUrl: 'http://jellyfin:8096' } });
  assert.equal(settings.registry.get('recommendations').jellyfin, 'http://jellyfin:8096/');
});

test('a module with incomplete settings stays off at startup instead of stopping the companion', () => {
  const { settings, section } = setup({ modules: ['recommendations', 'webUi'] });
  assert.equal(settings.registry.get('recommendations'), null);
  assert.ok(settings.registry.get('webUi'));
  assert.equal(section('recommendations').error, 'needs Seerr address and Seerr API key');
  // Unrelated saves still work while it is broken.
  settings.save('webUi', { enabled: true });
});

test('values are checked before saving', () => {
  const option = { label: 'Refresh', type: 'number', min: 5, max: 1440 };
  assert.equal(normalize(option, 30), '30');
  assert.throws(() => normalize(option, 2), /5 to 1440/);
  assert.throws(() => normalize({ label: 'Guide', type: 'url' }, 'ftp://x'), /http\(s\)/);
  assert.equal(normalize({ label: 'On', type: 'boolean' }, false), '0');
  assert.equal(normalize({ label: 'List', type: 'list' }, ' a, b ,,c'), 'a,b,c');
  const { settings } = setup();
  assert.throws(() => settings.save('connections', { values: { nope: 'x' } }), /Unknown setting/);
  assert.throws(() => settings.save('connections', { enabled: true }), /on\/off/);
  assert.throws(() => settings.save('missing', {}), /Unknown section/);
});

test('test checks settings and addresses without saving', async () => {
  const reached = [];
  const { settings, dataDir } = setup({ reach: async url => { reached.push(String(url)); if (String(url).includes('seerr')) throw new Error('connect ECONNREFUSED'); return { status: 200 }; } });
  const result = await settings.test('connections', { values: { jellyfinUrl: 'http://jellyfin:8096', seerrUrl: 'http://seerr:5055' } });
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.map(c => [c.label, c.ok]), [['Jellyfin address', true], ['Seerr address', false]]);
  assert.equal(fs.existsSync(path.join(dataDir, 'settings.json')), false, 'nothing saved');
  const module = await settings.test('recommendations', {});
  assert.deepEqual(module.checks[0], { label: 'Settings', ok: false, detail: 'needs Seerr address and Seerr API key' });
});

function signed(method, pathAndQuery, { user = ADMIN, admin = true, body = '' } = {}) {
  const fields = { method, pathAndQuery, timestamp: Math.floor(Date.now() / 1000), nonce: crypto.randomBytes(16).toString('hex'), userId: user, admin, body: Buffer.from(body) };
  return {
    method, body: body || undefined,
    headers: {
      'content-type': 'application/json', 'x-zorofin-timestamp': String(fields.timestamp), 'x-zorofin-nonce': fields.nonce,
      'x-zorofin-user': user, 'x-zorofin-user-admin': admin ? '1' : '0', 'x-zorofin-signature': sign(SECRET, fields),
    },
  };
}

test('admin routes need a signed request from a Jellyfin administrator', async () => {
  const { settings } = setup({ env: { ZOROFIN_SEERR_URL: 'http://seerr:5055', ZOROFIN_SEERR_API_KEY: 'k' } });
  const server = createServer({ config: { bridgeSecret: SECRET }, registry: settings.registry, settings });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/v1/admin/settings`)).status, 401);
    assert.equal((await fetch(`${base}/v1/admin/settings`, signed('GET', '/v1/admin/settings', { admin: false }))).status, 403);
    const read = await fetch(`${base}/v1/admin/settings`, signed('GET', '/v1/admin/settings'));
    assert.equal(read.status, 200);
    assert.deepEqual((await read.json()).sections.map(s => s.id), ['connections', 'recommendations', 'webUi']);

    const body = JSON.stringify({ enabled: true });
    const saved = await fetch(`${base}/v1/admin/settings/recommendations`, signed('POST', '/v1/admin/settings/recommendations', { body }));
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).running, true);
    assert.ok(settings.registry.get('recommendations'));

    const bad = JSON.stringify({ values: { refreshMinutes: 1 } });
    const rejected = await fetch(`${base}/v1/admin/settings/recommendations`, signed('POST', '/v1/admin/settings/recommendations', { body: bad }));
    assert.equal(rejected.status, 400);

    const probe = JSON.stringify({ values: {} });
    const tested = await fetch(`${base}/v1/admin/settings/recommendations/test`, signed('POST', '/v1/admin/settings/recommendations/test', { body: probe }));
    assert.equal(tested.status, 200);
    assert.equal((await tested.json()).ok, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a key file named on the container counts only when it exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-keys-'));
  fs.writeFileSync(path.join(dir, 'seerr'), 'k\n');
  const { section } = setup({ env: { ZOROFIN_SEERR_API_KEY_FILE: path.join(dir, 'seerr'), ZOROFIN_JELLYFIN_API_KEY_FILE: path.join(dir, 'missing') } });
  const options = section('connections').options;
  assert.deepEqual([options.find(o => o.key === 'seerrApiKey').set, options.find(o => o.key === 'seerrApiKey').source], [true, 'environment']);
  assert.deepEqual([options.find(o => o.key === 'jellyfinApiKey').set, options.find(o => o.key === 'jellyfinApiKey').source], [false, 'default']);
});

test('messages use the Dashboard\'s field names', () => {
  assert.equal(friendly('needs ZOROFIN_JELLYFIN_URL and ZOROFIN_JELLYFIN_API_KEY to read watch history'), 'needs Jellyfin address and Jellyfin API key to read watch history');
  assert.equal(friendly('needs ZOROFIN_SEERR_WEBHOOK_SECRET so Seerr can report'), 'needs the Seerr webhook secret (set on the container) so Seerr can report');
  assert.equal(friendly('configure email (ZOROFIN_NOTIFY_EMAIL_*) and/or ntfy (ZOROFIN_NOTIFY_NTFY_URL)'), 'configure email (the email settings) and/or ntfy (ntfy address)');
});

test('web look: colours, presets and uploaded logos', () => {
  const { settings, section, dataDir } = setup({ modules: ['webUi'] });
  const look = section('webUi');
  const colors = look.options.find(o => o.key === 'colors');
  assert.equal(colors.display, 'swatches');
  assert.deepEqual(colors.choices[0], { value: 'zorofin', label: 'Zorofin green', color: '#42d779' });
  assert.deepEqual(look.options.find(o => o.key === 'accent').when, { key: 'colors', value: 'custom' });

  assert.throws(() => settings.save('webUi', { values: { accent: 'blue' } }), /colour like/);
  settings.save('webUi', { values: { colors: 'custom', accent: '#3D9CFF' } });
  assert.equal(section('webUi').options.find(o => o.key === 'accent').value, '#3d9cff');

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  assert.throws(() => settings.save('webUi', { values: { logoDesktop: 'data:image/svg+xml;base64,PHN2Zz4=' } }), /PNG, JPEG or WebP/);
  assert.throws(() => settings.save('webUi', { values: { logoDesktop: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}` } }), /valid PNG/);
  settings.save('webUi', { values: { logo: 'custom', logoDesktop: `data:image/png;base64,${png.toString('base64')}` } });
  const saved = section('webUi').options.find(o => o.key === 'logoDesktop');
  assert.deepEqual([saved.set, saved.source, 'value' in saved], [true, 'dashboard', false]);
  const stored = fs.readdirSync(path.join(dataDir, 'uploads'));
  assert.equal(stored.length, 1);
  assert.ok(fs.readFileSync(path.join(dataDir, 'uploads', stored[0])).equals(png));
  // An empty value keeps the upload; null removes it.
  settings.save('webUi', { values: { logoDesktop: '' } });
  assert.equal(section('webUi').options.find(o => o.key === 'logoDesktop').set, true);
  settings.save('webUi', { values: { logoDesktop: null } });
  assert.equal(section('webUi').options.find(o => o.key === 'logoDesktop').set, false);
});

