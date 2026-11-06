'use strict';

// Small HTTP and file helpers shared by modules. Ported from request-notifier.

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

function requestJson(target, options = {}) {
  return new Promise((resolve, reject) => {
    const url = target instanceof URL ? target : new URL(target);
    const client = url.protocol === 'https:' ? https : http;
    const payload = options.body == null
      ? null
      : typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    const request = client.request(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(options.headers || {}),
      },
      timeout: options.timeout || 10000,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > (options.maxResponseBytes || 2_000_000)) request.destroy(new Error('Response too large'));
      });
      response.on('end', () => {
        let parsed = null;
        if (body) {
          try { parsed = JSON.parse(body); }
          catch (_) { parsed = body; }
        }
        resolve({ status: response.statusCode || 0, body: parsed, headers: response.headers });
      });
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    if (payload) request.write(payload);
    request.end();
  });
}

function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function readSecret(env, name, readFile = fs.readFileSync) {
  if (env[name]) return String(env[name]).trim();
  const file = env[`${name}_FILE`];
  if (!file) return '';
  try { return String(readFile(file, 'utf8')).trim(); }
  catch (_) { return ''; }
}

module.exports = { readJsonFile, readSecret, requestJson, writePrivateJson };
