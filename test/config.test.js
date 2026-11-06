'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

const SECRET = 'x'.repeat(32);

test('requires a strong bridge secret', () => {
  assert.match(loadConfig({}).errors.join('\n'), /ZOROFIN_BRIDGE_SECRET/);
  assert.match(loadConfig({ ZOROFIN_BRIDGE_SECRET: 'short' }).errors.join('\n'), /at least 32/);
  assert.deepEqual(loadConfig({ ZOROFIN_BRIDGE_SECRET: SECRET }).errors, []);
});

test('reads secrets from files and lists modules', () => {
  const files = { '/run/secrets/bridge': `${SECRET}\n` };
  const { config, errors } = loadConfig(
    { ZOROFIN_BRIDGE_SECRET_FILE: '/run/secrets/bridge', ZOROFIN_MODULES: ' notifications , recommendations,', ZOROFIN_COMPANION_BIND: '0.0.0.0' },
    file => { if (!(file in files)) throw new Error('missing'); return files[file]; },
  );
  assert.deepEqual(errors, []);
  assert.equal(config.bridgeSecret, SECRET);
  assert.deepEqual(config.modules, ['notifications', 'recommendations']);
  assert.equal(config.bind, '0.0.0.0');
  assert.equal(config.port, 9310);
});

test('rejects unsafe Jellyfin URLs and bad ports', () => {
  assert.match(loadConfig({ ZOROFIN_BRIDGE_SECRET: SECRET, ZOROFIN_JELLYFIN_URL: 'http://user:pass@jellyfin:8096' }).errors.join(), /JELLYFIN_URL/);
  assert.match(loadConfig({ ZOROFIN_BRIDGE_SECRET: SECRET, ZOROFIN_JELLYFIN_URL: 'file:///etc/passwd' }).errors.join(), /JELLYFIN_URL/);
  assert.match(loadConfig({ ZOROFIN_BRIDGE_SECRET: SECRET, ZOROFIN_COMPANION_PORT: '70000' }).errors.join(), /PORT/);
  assert.equal(loadConfig({ ZOROFIN_BRIDGE_SECRET: SECRET, ZOROFIN_JELLYFIN_URL: 'http://jellyfin:8096' }).config.jellyfinUrl, 'http://jellyfin:8096/');
});
