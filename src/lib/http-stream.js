'use strict';

// Streams a large text download (an M3U or XMLTV that may be hundreds of MB)
// as string chunks, without holding it all in memory. Follows a few
// redirects and gunzips .gz guides (detected from the bytes, not the name).

const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { Readable } = require('stream');
const { StringDecoder } = require('string_decoder');

const USER_AGENT = 'Zorofin-Companion/1.0';

function get(url, { timeout, headers }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, timeout }, resolve);
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('timed out')));
  });
}

// Resolves an async iterable of strings. Rejects on HTTP errors.
async function openText(target, { timeout = 60000, maxBytes = 1024 * 1024 * 1024, headers = {}, redirects = 3 } = {}) {
  let url = new URL(target);
  let response;
  for (let hop = 0; ; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported URL');
    response = await get(url, { timeout, headers });
    const status = response.statusCode || 0;
    if (status >= 300 && status < 400 && response.headers.location && hop < redirects) {
      response.resume();
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status !== 200) {
      response.resume();
      throw Object.assign(new Error(`HTTP ${status}`), { status });
    }
    break;
  }
  const iterator = response[Symbol.asyncIterator]();
  const head = await iterator.next();
  async function* raw() {
    for (let step = head; !step.done; step = await iterator.next()) yield step.value;
  }
  const gzip = !head.done && head.value[0] === 0x1f && head.value[1] === 0x8b;
  const source = gzip ? Readable.from(raw()).pipe(zlib.createGunzip()) : raw();
  return (async function* text() {
    const decoder = new StringDecoder('utf8');
    let size = 0;
    try {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('download too large');
        yield decoder.write(chunk);
      }
      const rest = decoder.end();
      if (rest) yield rest;
    } finally {
      response.destroy();
    }
  })();
}

// Yields lines from an async iterable of strings.
async function* lines(chunks) {
  let carry = '';
  for await (const chunk of chunks) {
    const parts = (carry + chunk).split('\n');
    carry = parts.pop();
    if (carry.length > 1024 * 1024) carry = ''; // a runaway line is not a playlist entry
    for (const part of parts) yield part.replace(/\r$/, '');
  }
  if (carry) yield carry.replace(/\r$/, '');
}

module.exports = { lines, openText };
