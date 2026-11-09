'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { sign } = require('../src/bridge-auth');
const { createRegistry } = require('../src/modules');
const { createServer } = require('../src/server');

const SECRET = 'zorofin-test-secret-0123456789abcdef';
const HOOK_SECRET = 'h'.repeat(40);
const VIEWER = '4f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f';

function fakeModule(events) {
  return () => ({
    id: 'echo',
    capabilities: () => ({ echo: { version: 1, enabled: true }, sneaky: { version: 1, enabled: true } }),
    async handle(request) {
      return { status: 200, body: { path: request.path, segments: request.segments, limit: request.query.get('limit'), body: request.body, viewer: request.viewer } };
    },
    async onSeerrEvent(event) { events.push(event); },
  });
}

async function withServer(fn, { seerrWebhookSecret = HOOK_SECRET } = {}) {
  const events = [];
  const config = { bridgeSecret: SECRET, seerrWebhookSecret };
  const registry = createRegistry(['echo'], config, {}, { echo: fakeModule(events) });
  const server = createServer({ config, registry });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base, events); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function signed(method, pathAndQuery, { user = VIEWER, admin = false, body = '' } = {}) {
  const fields = {
    method, pathAndQuery, timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomBytes(16).toString('hex'), userId: user, admin, body: Buffer.from(body),
  };
  return {
    method,
    body: body || undefined,
    headers: {
      'content-type': 'application/json',
      'x-zorofin-timestamp': String(fields.timestamp),
      'x-zorofin-nonce': fields.nonce,
      'x-zorofin-user': user,
      'x-zorofin-user-admin': admin ? '1' : '0',
      'x-zorofin-signature': sign(SECRET, fields),
    },
  };
}

test('health is open and reveals no configuration', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(await response.json()).sort(), ['service', 'status', 'version']);
  });
});

test('capabilities need a signature and list only module-owned names', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/v1/capabilities`)).status, 401);
    const response = await fetch(`${base}/v1/capabilities`, signed('GET', '/v1/capabilities', { user: '' }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.features, { echo: { version: 1, enabled: true } });
    assert.equal(body.schemaVersion, 1);
  });
});

test('module routes receive the signed viewer, path, query and body', async () => {
  await withServer(async base => {
    const path = '/v1/modules/echo/rows/my%20home?limit=5';
    const response = await fetch(base + path, signed('POST', path, { body: '{"a":1}' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { path: '/rows/my%20home', segments: ['rows', 'my home'], limit: '5', body: { a: 1 }, viewer: { id: VIEWER, admin: false } });
  });
});

test('module routes need a viewer and a known module', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/v1/modules/echo/x`, signed('GET', '/v1/modules/echo/x', { user: '' }))).status, 401);
    assert.equal((await fetch(`${base}/v1/modules/other/x`, signed('GET', '/v1/modules/other/x'))).status, 404);
    // A signature for one path does not authorize another.
    assert.equal((await fetch(`${base}/v1/modules/echo/y`, signed('GET', '/v1/modules/echo/x'))).status, 401);
  });
});

test('oversized bodies are refused', async () => {
  await withServer(async base => {
    const big = JSON.stringify({ text: 'a'.repeat(70 * 1024) });
    const response = await fetch(`${base}/v1/modules/echo/x`, signed('POST', '/v1/modules/echo/x', { body: big })).catch(() => null);
    assert.ok(!response || response.status === 413);
  });
});

test('Seerr webhook needs its Bearer secret and reaches listening modules', async () => {
  await withServer(async (base, events) => {
    const post = authorization => fetch(`${base}/v1/hooks/seerr`, {
      method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: '{"notification_type":"MEDIA_AVAILABLE"}',
    });
    assert.equal((await post('Bearer wrong')).status, 401);
    assert.equal((await post(`Bearer ${HOOK_SECRET}`)).status, 202);
    assert.deepEqual(events, [{ notification_type: 'MEDIA_AVAILABLE' }]);
  });
  await withServer(async base => {
    assert.equal((await fetch(`${base}/v1/hooks/seerr`, { method: 'POST', body: '{}' })).status, 404);
  }, { seerrWebhookSecret: '' });
});

test('registry rejects unknown modules', () => {
  assert.deepEqual(createRegistry(['missing'], {}).errors, ['unknown module "missing"']);
  assert.deepEqual(createRegistry(['__proto__'], {}).errors, ['unknown module "__proto__"']);
});

test('private modules load from a directory and cannot replace built-ins', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { loadPrivateModules } = require('../src/modules');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-private-'));
  fs.writeFileSync(path.join(dir, 'a.js'), "module.exports = { id: 'eventGate', create: () => ({ id: 'eventGate', capabilities: () => ({}) }) };");
  fs.writeFileSync(path.join(dir, 'b.js'), "module.exports = { id: 'notifications', create: () => null };");
  fs.writeFileSync(path.join(dir, 'c.js'), "module.exports = {};");
  const { available, errors } = loadPrivateModules(dir);
  assert.equal(typeof available.eventGate, 'function');
  assert.equal(typeof available.notifications, 'function');
  assert.equal(errors.length, 2);
  assert.deepEqual(createRegistry(['eventGate'], {}, {}, available).ids(), ['eventGate']);
  assert.deepEqual(loadPrivateModules('').errors, []);
});

test('public file replies stream from disk with the right length', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-file-'));
  const file = path.join(dir, 'guide.xml');
  const text = `<tv>${'<programme/>'.repeat(50000)}</tv>\n`;
  fs.writeFileSync(file, text);
  const files = () => ({
    id: 'files',
    capabilities: () => ({ files: { version: 1, enabled: true } }),
    async handle() { return { status: 404, body: {} }; },
    async handlePublic({ segments }) {
      if (segments[0] === 'guide.xml') return { status: 200, file, contentType: 'application/xml' };
      return { status: 200, file: path.join(dir, 'missing.xml') };
    },
  });
  const config = { bridgeSecret: SECRET };
  const server = createServer({ config, registry: createRegistry(['files'], config, {}, { files }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const ok = await fetch(`${base}/v1/public/files/guide.xml`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'application/xml');
    assert.equal(Number(ok.headers.get('content-length')), Buffer.byteLength(text));
    assert.equal(await ok.text(), text);
    assert.equal((await fetch(`${base}/v1/public/files/other`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a HEAD on a public stream answers its type without opening it', async () => {
  let opened = 0;
  const streams = () => ({
    id: 'streams',
    capabilities: () => ({ streams: { version: 1, enabled: true } }),
    async handle() { return { status: 404, body: {} }; },
    async handlePublic() {
      return { contentType: 'video/mp2t', stream: res => { opened += 1; res.writeHead(200, { 'Content-Type': 'video/mp2t' }); res.end('ts'); } };
    },
  });
  const config = { bridgeSecret: SECRET };
  const server = createServer({ config, registry: createRegistry(['streams'], config, {}, { streams }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const head = await fetch(`${base}/v1/public/streams/line/1`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-type'), 'video/mp2t');
    assert.equal(opened, 0);
    const get = await fetch(`${base}/v1/public/streams/line/1`);
    assert.equal(await get.text(), 'ts');
    assert.equal(opened, 1);
    assert.equal((await fetch(`${base}/v1/public/streams/line/1`, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
