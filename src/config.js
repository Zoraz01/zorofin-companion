'use strict';

// Companion settings come from the environment. Secrets may instead be read
// from a file named by <NAME>_FILE (Docker/compose secrets). Nothing here has
// a built-in default secret.

const fs = require('fs');
const path = require('path');

const MIN_SECRET_LENGTH = 32;

const { readSecret } = require('./lib/io');

function httpUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return null;
    return url.href.endsWith('/') ? url.href : `${url.href}/`;
  } catch (_) {
    return null;
  }
}

function list(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

// Returns { config, errors }. The server refuses to start while errors is non-empty.
function loadConfig(env = process.env, readFile = fs.readFileSync) {
  const errors = [];
  const port = Number(env.ZOROFIN_COMPANION_PORT || 9310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('ZOROFIN_COMPANION_PORT must be a port number');

  const bridgeSecret = readSecret(env, 'ZOROFIN_BRIDGE_SECRET', readFile);
  if (bridgeSecret.length < MIN_SECRET_LENGTH) {
    errors.push(`ZOROFIN_BRIDGE_SECRET (or ZOROFIN_BRIDGE_SECRET_FILE) must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  const seerrWebhookSecret = readSecret(env, 'ZOROFIN_SEERR_WEBHOOK_SECRET', readFile);
  if (seerrWebhookSecret && seerrWebhookSecret.length < MIN_SECRET_LENGTH) {
    errors.push(`ZOROFIN_SEERR_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters when set`);
  }

  const jellyfinUrl = httpUrl(env.ZOROFIN_JELLYFIN_URL);
  if (jellyfinUrl === null) errors.push('ZOROFIN_JELLYFIN_URL must be a plain http(s) URL');

  return {
    errors,
    config: {
      port,
      bind: env.ZOROFIN_COMPANION_BIND || '127.0.0.1',
      dataDir: path.resolve(env.ZOROFIN_DATA_DIR || path.join(__dirname, '..', 'data')),
      bridgeSecret,
      seerrWebhookSecret,
      jellyfinUrl: jellyfinUrl || '',
      jellyfinApiKey: readSecret(env, 'ZOROFIN_JELLYFIN_API_KEY', readFile),
      modules: list(env.ZOROFIN_MODULES),
      privateModulesDir: env.ZOROFIN_PRIVATE_MODULES_DIR ? path.resolve(env.ZOROFIN_PRIVATE_MODULES_DIR) : '',
    },
  };
}

module.exports = { MIN_SECRET_LENGTH, httpUrl, loadConfig };
