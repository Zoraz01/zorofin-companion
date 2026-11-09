#!/usr/bin/env node
'use strict';

// Measures the companion's memory while liveTvSource reads a large guide.
// A child process serves a synthetic M3U and XMLTV guide on 127.0.0.1; this
// process runs two refreshes and prints resident and heap memory after each.
//
//   node --expose-gc tools/memory-bench.js [channels=8000] [hoursPerChannel=72] [keepEvery=5]
//
// The defaults make a ~200 MB guide with 1,600 kept channels. Add Node flags
// (for example --max-semi-space-size=2) to compare settings. Nothing leaves
// the machine and the temporary data folder is removed at the end.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const [CH = 8000, P = 72, EVERY = 5] = process.argv.slice(2).filter(arg => /^\d+$/.test(arg)).map(Number);

function* guide(now) {
  const pad = value => String(value).padStart(2, '0');
  const stamp = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`; };
  let out = '<?xml version="1.0"?>\n<tv>\n';
  const flush = function* () { while (out.length >= 65536) { yield out.slice(0, 65536); out = out.slice(65536); } };
  for (let c = 0; c < CH; c += 1) {
    out += `  <channel id="ch${c}.us"><display-name>US| Channel ${c} HD</display-name></channel>\n`;
    yield* flush();
  }
  for (let c = 0; c < CH; c += 1) for (let p = 0; p < P; p += 1) {
    const start = now - 3 * 3600e3 + p * 3600e3;
    out += `  <programme start="${stamp(start)}" stop="${stamp(start + 3600e3)}" channel="ch${c}.us"><title lang="en">Show ${p} on ${c}</title><sub-title lang="en">Episode ${p}</sub-title><desc lang="en">A description of programme ${p} long enough to look like a real guide entry with a few words.</desc><category lang="en">Series</category></programme>\n`;
    yield* flush();
  }
  yield `${out}</tv>\n`;
}

function serve() {
  const now = Date.now();
  const server = http.createServer((req, res) => {
    if (req.url === '/p.m3u') {
      let out = '#EXTM3U\n';
      for (let c = 0; c < CH; c += 1) out += `#EXTINF:-1 tvg-id="ch${c}.us" group-title="${c % EVERY === 0 ? 'US| ENTERTAINMENT' : 'XX| OTHER'}",US| Channel ${c} HD\nhttp://stream.invalid/${c}.ts\n`;
      return res.end(out);
    }
    if (req.url === '/guide.xml') {
      const parts = guide(now);
      const pump = () => {
        for (;;) {
          const next = parts.next();
          if (next.done) return res.end();
          if (!res.write(next.value)) return res.once('drain', pump);
        }
      };
      return pump();
    }
    res.statusCode = 404;
    return res.end();
  });
  server.listen(0, '127.0.0.1', () => process.send(server.address().port));
}

async function bench() {
  if (typeof global.gc !== 'function') throw new Error('run with node --expose-gc');
  const child = fork(__filename, ['--serve', String(CH), String(P), String(EVERY)]);
  const port = await new Promise(resolve => child.once('message', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-memory-'));
  const { createLiveTvSource } = require('../src/modules/liveTvSource');
  const module = createLiveTvSource({ dataDir: dir }, {
    env: {
      ZOROFIN_LIVE_SOURCE_TYPE: 'm3u',
      ZOROFIN_LIVE_SOURCE_M3U_URL: `http://127.0.0.1:${port}/p.m3u`,
      ZOROFIN_LIVE_SOURCE_TOKEN: 'b'.repeat(40),
      ZOROFIN_LIVE_SOURCE_GROUPS: 'US|',
      ZOROFIN_LIVE_SOURCE_BACKUP_GUIDES: `http://127.0.0.1:${port}/guide.xml`,
    },
  });
  const mb = bytes => Math.round(bytes / 1048576);
  // Linux reports the true high-water mark; elsewhere we sample.
  let sampled = 0;
  const sampler = setInterval(() => { sampled = Math.max(sampled, process.memoryUsage.rss()); }, 5);
  const peak = () => {
    try { return Number(/VmHWM:\s+(\d+)/.exec(fs.readFileSync('/proc/self/status', 'utf8'))[1]) * 1024; }
    catch (_) { return sampled; }
  };
  const show = label => {
    global.gc();
    const use = process.memoryUsage();
    sampled = Math.max(sampled, use.rss);
    console.log(`${label.padEnd(28)} rss ${mb(use.rss)} MB, heap ${mb(use.heapUsed)}/${mb(use.heapTotal)} MB, peak ${mb(peak())} MB`);
  };
  try {
    show('start');
    const started = Date.now();
    await module.refresh();
    if (module.status.lastError) throw new Error(module.status.lastError);
    show(`refresh (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    await module.refresh();
    show('second refresh (cached)');
    const guideMb = mb(fs.statSync(path.join(dir, 'liveTvSource', 'guide.xml')).size);
    console.log(`${module.status.channels} channels, guide.xml ${guideMb} MB`);
  } finally {
    clearInterval(sampler);
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--serve') serve();
else bench().catch(error => { console.error(error.message); process.exitCode = 1; });
