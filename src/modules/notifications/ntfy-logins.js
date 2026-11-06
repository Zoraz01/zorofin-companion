'use strict';

// Private ntfy logins, one per viewer, through ntfy's admin API (ntfy 2.x).
// Each login can only read that viewer's topic, so knowing a topic name is not
// enough to read someone else's alerts. Ported from request-notifier/accounts.js,
// which did the same through `docker exec ntfy ...`.

const crypto = require('crypto');

function adminCall(ntfy, send, method, pathname, body) {
  return send(new URL(pathname.replace(/^\//, ''), ntfy.url), {
    method,
    headers: { Authorization: `Bearer ${ntfy.adminToken}` },
    body,
    timeout: 10000,
  }).then(response => {
    if (response.status < 200 || response.status >= 300) throw new Error(`ntfy ${method} ${pathname} returned HTTP ${response.status}`);
    return response.body;
  });
}

function newPassword() {
  return crypto.randomBytes(15).toString('base64url');
}

async function createLogin(ntfy, send, topic) {
  const username = `zf_${crypto.randomBytes(8).toString('hex')}`;
  const password = newPassword();
  await adminCall(ntfy, send, 'POST', '/v1/users', { username, password });
  try {
    await adminCall(ntfy, send, 'PUT', '/v1/users/access', { username, topic, permission: 'read-only' });
  } catch (error) {
    await adminCall(ntfy, send, 'DELETE', '/v1/users', { username }).catch(() => {});
    throw error;
  }
  return { username, password };
}

async function resetPassword(ntfy, send, username) {
  const password = newPassword();
  await adminCall(ntfy, send, 'PUT', '/v1/users', { username, password });
  return password;
}

function deleteLogin(ntfy, send, username) {
  return adminCall(ntfy, send, 'DELETE', '/v1/users', { username });
}

module.exports = { createLogin, deleteLogin, resetPassword };
