'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NonceCache, sign, verifyRequest } = require('../src/bridge-auth');

// Shared with the plugin's C# tests; see docs/COMPANION_BRIDGE.md in the plugin.
const SECRET = 'zorofin-test-secret-0123456789abcdef';
const VECTOR = {
  method: 'POST',
  pathAndQuery: '/v1/modules/recommendations/rows?limit=10',
  timestamp: 1793232000,
  nonce: '00112233445566778899aabbccddeeff',
  userId: '4f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f',
  admin: false,
  body: Buffer.from('{"seed":"abc"}'),
};
const VECTOR_SIGNATURE = '726ef4520137fb3f18099e1e3c84f8579b1ff2a6c9fcbda68a6a1cc718254a0d';
const SYSTEM_SIGNATURE = '69898191872a06870b424cc2aabe76e7cd18600d85224a389a40cfc746edb71c';

function headersFor(fields, signature = sign(SECRET, fields)) {
  return {
    'x-zorofin-timestamp': String(fields.timestamp),
    'x-zorofin-nonce': fields.nonce,
    'x-zorofin-user': fields.userId,
    'x-zorofin-user-admin': fields.admin ? '1' : '0',
    'x-zorofin-signature': signature,
  };
}

function verify(fields, overrides = {}, nowMs = fields.timestamp * 1000, nonces = new NonceCache()) {
  return verifyRequest(
    { method: fields.method, pathAndQuery: fields.pathAndQuery, headers: { ...headersFor(fields), ...overrides }, body: fields.body },
    SECRET,
    nowMs,
    nonces,
  );
}

test('signature matches the shared test vectors', () => {
  assert.equal(sign(SECRET, VECTOR), VECTOR_SIGNATURE);
  assert.equal(sign(SECRET, {
    method: 'GET', pathAndQuery: '/v1/capabilities', timestamp: 1793232000,
    nonce: 'ffeeddccbbaa99887766554433221100', userId: '', admin: false, body: Buffer.alloc(0),
  }), SYSTEM_SIGNATURE);
});

test('accepts a signed viewer request and reports the viewer', () => {
  const result = verify(VECTOR);
  assert.deepEqual(result, { ok: true, viewer: { id: VECTOR.userId, admin: false } });
});

test('plugin-level calls have no viewer', () => {
  const fields = { ...VECTOR, method: 'GET', pathAndQuery: '/v1/capabilities', userId: '', body: Buffer.alloc(0) };
  assert.deepEqual(verify(fields), { ok: true, viewer: null });
});

test('rejects any change to what was signed', () => {
  const signature = sign(SECRET, VECTOR);
  const cases = [
    { ...VECTOR, method: 'GET' },
    { ...VECTOR, pathAndQuery: '/v1/modules/recommendations/rows?limit=11' },
    { ...VECTOR, body: Buffer.from('{"seed":"abd"}') },
    { ...VECTOR, userId: '0f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f' },
    { ...VECTOR, admin: true },
  ];
  for (const fields of cases) {
    const result = verifyRequest(
      { method: fields.method, pathAndQuery: fields.pathAndQuery, headers: headersFor(fields, signature), body: fields.body },
      SECRET, VECTOR.timestamp * 1000, new NonceCache(),
    );
    assert.equal(result.ok, false, JSON.stringify({ ...fields, body: fields.body.toString() }));
  }
});

test('rejects a wrong secret, stale clocks and replays', () => {
  const wrong = verifyRequest(
    { method: VECTOR.method, pathAndQuery: VECTOR.pathAndQuery, headers: headersFor(VECTOR, sign('another-secret-0123456789abcdef0123', VECTOR)), body: VECTOR.body },
    SECRET, VECTOR.timestamp * 1000, new NonceCache(),
  );
  assert.equal(wrong.reason, 'bad signature');
  assert.equal(verify(VECTOR, {}, (VECTOR.timestamp + 61) * 1000).reason, 'stale timestamp');
  assert.equal(verify(VECTOR, {}, (VECTOR.timestamp - 61) * 1000).reason, 'stale timestamp');
  assert.equal(verify(VECTOR, {}, (VECTOR.timestamp + 60) * 1000).ok, true);

  const nonces = new NonceCache();
  assert.equal(verify(VECTOR, {}, VECTOR.timestamp * 1000, nonces).ok, true);
  assert.equal(verify(VECTOR, {}, VECTOR.timestamp * 1000, nonces).reason, 'replayed nonce');
});

test('rejects malformed headers and an admin flag with no viewer', () => {
  assert.equal(verify(VECTOR, { 'x-zorofin-nonce': 'short' }).status, 401);
  assert.equal(verify(VECTOR, { 'x-zorofin-user': 'not-a-guid' }).reason, 'malformed user');
  assert.equal(verify(VECTOR, { 'x-zorofin-user-admin': 'yes' }).reason, 'malformed admin flag');
  assert.equal(verify({ ...VECTOR, userId: '', admin: true }).reason, 'admin flag without user');
  assert.equal(verifyRequest({ method: 'GET', pathAndQuery: '/', headers: {}, body: null }, '', 0, new NonceCache()).status, 503);
});

test('nonce cache stays bounded', () => {
  const cache = new NonceCache(1000, 4);
  for (let index = 0; index < 10; index += 1) cache.remember(`n${index}`, 0);
  assert.ok(cache.seen.size <= 4);
});
