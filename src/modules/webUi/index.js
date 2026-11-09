'use strict';

// webUi: serves the Zorofin look and web features to Jellyfin's own web client.
// The open plugin adds one loader script to jellyfin-web; the loader reads
// manifest.json from here and adds the listed styles and scripts. Files come
// from one flat folder (ZOROFIN_WEB_UI_DIR, default ./web-ui next to src/).
// They load before sign-in, so this module serves them through the public
// route: they are the same for every viewer and carry no viewer data.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PRESETS, recolor, targetFor } = require('./palette');
const { createSportsArt } = require('./sportsArt');
const { fetchBuffer } = require('../liveTvGuide/sources');

const ID = 'webUi';
const VERSION = 1;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TYPES = {
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  woff2: 'font/woff2',
};
const CACHE = 'public, max-age=300';
const SPORTS_ART_REFRESH_MS = 30 * 60 * 1000;

// Parts of the web look an operator can switch off. A file belongs to a part
// when its name starts with an order number and the part's name, such as
// 30-theme-core.js. Other files are always served. Live TV and Requests build
// on the theme, so they are left out when the theme is off.
const FEATURES = Object.freeze({
  theme: { env: 'ZOROFIN_WEB_UI_THEME', default: true },
  player: { env: 'ZOROFIN_WEB_UI_PLAYER', default: true },
  banner: { env: 'ZOROFIN_WEB_UI_BANNER', default: true, needs: 'theme' },
  pause: { env: 'ZOROFIN_WEB_UI_PAUSE_SCREEN', default: true },
  // No file of its own: the pause-screen script reads html.zorofin-off-autopause.
  autopause: { env: 'ZOROFIN_WEB_UI_AUTO_PAUSE', default: true, needs: 'pause' },
  livetv: { env: 'ZOROFIN_WEB_UI_LIVE_TV', default: true, needs: 'theme' },
  requests: { env: 'ZOROFIN_WEB_UI_REQUESTS', default: false, needs: 'theme' },
});

function flag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function featuresFrom(env) {
  const on = {};
  for (const [name, feature] of Object.entries(FEATURES)) on[name] = flag(env[feature.env], feature.default);
  for (const [name, feature] of Object.entries(FEATURES)) if (feature.needs && !on[feature.needs]) on[name] = false;
  return on;
}

const LOGOS = ['zorofin', 'none', 'custom'];
const CARD_SIZES = ['compact', 'standard', 'large'];
const HEX = /^#[0-9a-f]{6}$/i;

// The server's look as plain values, for the web look and for the apps:
// one accent colour and one card size for every viewer.
function looksFrom(colors, accent, cardSize, logoMode, enforced = true) {
  const hex = colors === 'custom' ? (HEX.test(accent) ? accent.toLowerCase() : PRESETS.zorofin.color) : PRESETS[colors].color;
  return { version: 1, colors, accent: hex, cardSize: CARD_SIZES.includes(cardSize) ? cardSize : 'standard', logo: logoMode, enforced: Boolean(enforced) };
}

function settingsFrom(env) {
  const colors = Object.prototype.hasOwnProperty.call(PRESETS, env.ZOROFIN_WEB_UI_COLORS) || env.ZOROFIN_WEB_UI_COLORS === 'custom'
    ? env.ZOROFIN_WEB_UI_COLORS : 'zorofin';
  return {
    dir: path.resolve(env.ZOROFIN_WEB_UI_DIR || path.join(__dirname, '..', '..', '..', 'web-ui')),
    // Optional second folder for one server's own add-ons (the reference server keeps
    // its private scripts here). Listed with the pack; a file here with the same name wins.
    extraDir: env.ZOROFIN_WEB_UI_EXTRA_DIR ? path.resolve(env.ZOROFIN_WEB_UI_EXTRA_DIR) : '',
    features: featuresFrom(env),
    palette: targetFor(colors, (env.ZOROFIN_WEB_UI_ACCENT || '').trim()),
    logo: {
      mode: LOGOS.includes(env.ZOROFIN_WEB_UI_LOGO) ? env.ZOROFIN_WEB_UI_LOGO : 'zorofin',
      desktop: env.ZOROFIN_WEB_UI_LOGO_DESKTOP || '',
      mobile: env.ZOROFIN_WEB_UI_LOGO_MOBILE || '',
    },
    sportsArt: sportsArtFrom(env),
    looks: looksFrom(colors, (env.ZOROFIN_WEB_UI_ACCENT || '').trim(), (env.ZOROFIN_WEB_UI_CARD_SIZE || '').trim(),
      LOGOS.includes(env.ZOROFIN_WEB_UI_LOGO) ? env.ZOROFIN_WEB_UI_LOGO : 'zorofin', flag(env.ZOROFIN_WEB_UI_LOOKS_ENFORCED, true)),
  };
}

// Team crests and event photos for the Home sports row, downloaded by this
// server. Off until the operator turns it on, and only with the Live TV pages.
function sportsArtFrom(env) {
  const mb = Number(env.ZOROFIN_WEB_UI_SPORTS_ART_MAX_MB || 200);
  return {
    enabled: flag(env.ZOROFIN_WEB_UI_SPORTS_ART, false),
    maxBytes: (Number.isFinite(mb) ? Math.min(Math.max(mb, 20), 2000) : 200) * 1024 * 1024,
    sportsDbKey: env.ZOROFIN_GUIDE_SPORTSDB_KEY || '',
  };
}

// Hides the brand everywhere the theme shows it, for "No logo".
const NO_LOGO_CSS = `/* Zorofin web look: logo turned off in the Dashboard. */
html.zoro-ui .zoroBrand img, html.zoro-ui .zoroMobileBrand img, html.zoro-ui .zoroSigninBrand,
html.zoro-ui img[src*="icon-transparent"] { display: none !important; }
html.zoro-ui .pageTitleWithDefaultLogo, html.zoro-ui .pageTitleWithLogo, html.zoro-ui .splashLogo { background-image: none !important; }
`;
const BRAND_FILE = '32-theme-brand.css';
// The theme's two logo slots: the wide wordmark and the square mark used on phones and TVs.
const LOGO_SLOTS = { 'wordmark.png': 'desktop', 'mark-512.png': 'mobile' };

function featureOf(name) {
  const match = /^\d+-([a-z]+)[-.]/.exec(name);
  return match && Object.prototype.hasOwnProperty.call(FEATURES, match[1]) ? match[1] : null;
}

function imageType(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
}

function typeOf(name) {
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(TYPES, ext) ? TYPES[ext] : null;
}

// Styles and scripts in name order, so operators control order with prefixes
// such as 10-theme.css. Files starting with "_" are served but not listed.
// "classes" go on the page's <html> element before the styles load: zoro-ui
// turns the theme on, and zorofin-off-<part> lets the theme hide links to a
// part that is switched off.
function manifestFor(names, features = {}, version, extraClasses = []) {
  const on = name => features[name] !== false;
  const listed = names.filter(name => FILE.test(name) && !name.startsWith('_'))
    .filter(name => { const feature = featureOf(name); return !feature || on(feature); })
    .sort();
  const classes = [];
  if (listed.some(name => featureOf(name) === 'theme')) classes.push('zoro-ui');
  for (const name of Object.keys(FEATURES)) if (!on(name)) classes.push(`zorofin-off-${name}`);
  classes.push(...extraClasses);
  return {
    schemaVersion: 1,
    styles: listed.filter(name => name.endsWith('.css')),
    scripts: listed.filter(name => name.endsWith('.js')),
    classes,
    ...(version ? { version } : {}),
  };
}

function createWebUi(config, deps = {}) {
  const settings = deps.settings || settingsFrom(deps.env || process.env);
  const root = settings.dir;
  const extraRoot = settings.extraDir || '';
  const features = settings.features || {};
  const palette = settings.palette || null;
  const logo = settings.logo || { mode: 'zorofin' };
  const cache = new Map(); // name -> { stamp, raw } for recoloured files
  const sports = settings.sportsArt || { enabled: false };
  const sportsOn = Boolean(sports.enabled) && features.theme !== false && features.livetv !== false;
  const art = sportsOn ? (deps.sportsArt || createSportsArt({
    dir: path.join(config.dataDir || path.join(__dirname, '..', '..', '..', 'data'), ID, 'sports-art'),
    fetcher: deps.fetcher || fetchBuffer,
    log: deps.log || (() => {}),
    sportsDbKey: sports.sportsDbKey,
    maxBytes: sports.maxBytes,
  })) : null;
  // Tells the sports row it can ask this server for the catalogue.
  const looks = settings.looks || looksFrom('zorofin', '', 'standard', logo.mode);
  const extraClasses = art ? ['zorofin-sports-art'] : [];
  // Card size for every viewer: the theme reads html.zoro-cards-compact / -large.
  if (looks.cardSize !== 'standard') extraClasses.push(`zoro-cards-${looks.cardSize}`);
  let timer = null;

  function list(dir) {
    if (!dir) return [];
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name);
    } catch (_) {
      return [];
    }
  }

  // The folder a served name comes from: the add-ons folder first, then the pack.
  function locate(name) {
    if (extraRoot && list(extraRoot).includes(name)) return path.join(extraRoot, name);
    return path.join(root, name);
  }

  function files() {
    const names = [...new Set([...list(root), ...list(extraRoot)])];
    if (logo.mode === 'none' && features.theme !== false && names.some(name => featureOf(name) === 'theme')) names.push(BRAND_FILE);
    return names;
  }

  function stat(file) {
    try { const st = fs.statSync(file); return st.isFile() && st.size <= MAX_FILE_BYTES ? st : null; } catch (_) { return null; }
  }

  // An uploaded logo for a slot, when "Your own" is chosen. Phones fall back to the wide logo.
  function customLogo(name) {
    if (logo.mode !== 'custom' || !LOGO_SLOTS[name]) return null;
    for (const file of LOGO_SLOTS[name] === 'mobile' ? [logo.mobile, logo.desktop] : [logo.desktop]) {
      if (file && stat(file)) return file;
    }
    return null;
  }

  // Changes whenever a file, the colours or the logo change, so browsers can keep files until then.
  function version(names) {
    const parts = names.sort().map(name => {
      const st = stat(locate(name));
      return st ? `${name}:${st.size}:${st.mtimeMs}` : name;
    });
    for (const name of Object.keys(LOGO_SLOTS)) {
      const file = customLogo(name);
      const st = file && stat(file);
      parts.push(st ? `${name}=${st.size}:${st.mtimeMs}` : `${name}=default`);
    }
    parts.push(palette ? palette.key : 'zorofin', logo.mode);
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
  }

  function read(name, file, st) {
    if (!palette || !/\.(css|js)$/.test(name)) return fs.readFileSync(file);
    const stamp = `${st.size}:${st.mtimeMs}:${palette.key}`;
    const hit = cache.get(name);
    if (hit && hit.stamp === stamp) return hit.raw;
    const raw = Buffer.from(recolor(fs.readFileSync(file, 'utf8'), palette));
    cache.set(name, { stamp, raw });
    return raw;
  }

  return {
    id: ID,
    // Enabled only when there is something to serve, so the plugin leaves
    // Jellyfin's web client plain when the folder is empty or missing.
    capabilities() {
      const manifest = manifestFor(files(), features, undefined, extraClasses);
      return { [ID]: { version: VERSION, enabled: manifest.styles.length + manifest.scripts.length > 0 } };
    },

    async handlePublic({ segments }) {
      if (segments.length === 3 && segments[0] === 'live-tv-logos' && segments[1] === 'art') {
        const file = art && art.file(segments[2]);
        if (!file) return { status: 404, body: { error: 'Not found' } };
        const catalogue = segments[2] === 'events.json';
        return {
          status: 200,
          raw: fs.readFileSync(file),
          contentType: catalogue ? TYPES.json : imageType(file),
          // Image names carry a content hash, so they never change.
          cacheControl: catalogue ? 'public, max-age=60' : 'public, max-age=604800, immutable',
        };
      }
      if (segments.length !== 1) return { status: 404, body: { error: 'Not found' } };
      const name = segments[0];
      // Public like the rest of the look (it loads before sign-in) and the same
      // for every viewer. The apps read it to match the server's look.
      if (name === 'looks.json') {
        return { status: 200, raw: Buffer.from(`${JSON.stringify(looks)}\n`), contentType: TYPES.json, cacheControl: 'no-cache' };
      }
      if (name === 'manifest.json') {
        const names = files();
        const raw = Buffer.from(`${JSON.stringify(manifestFor(names, features, version(names), extraClasses))}\n`);
        return { status: 200, raw, contentType: TYPES.json, cacheControl: 'no-cache' };
      }
      const type = FILE.test(name) ? typeOf(name) : null;
      if (!type) return { status: 404, body: { error: 'Not found' } };
      if (name === BRAND_FILE && logo.mode === 'none') return { status: 200, raw: Buffer.from(NO_LOGO_CSS), contentType: type, cacheControl: CACHE };
      const custom = customLogo(name);
      if (custom) return { status: 200, raw: fs.readFileSync(custom), contentType: imageType(custom), cacheControl: CACHE };
      const file = locate(name);
      let st;
      try { st = fs.lstatSync(file); } catch (_) { return { status: 404, body: { error: 'Not found' } }; }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return { status: 404, body: { error: 'Not found' } };
      return { status: 200, raw: read(name, file, st), contentType: type, cacheControl: CACHE };
    },

    // Admin only: how the sports artwork is doing, and a way to refresh it now.
    async handle({ method, segments, viewer }) {
      const route = `${method} ${segments.join('/')}`;
      if (route !== 'GET sportsArt' && route !== 'POST sportsArt/refresh') return { status: 404, body: { error: 'Not found' } };
      if (!viewer || !viewer.admin) return { status: 403, body: { error: 'admin_only' } };
      if (!art) return { status: 200, body: { enabled: false } };
      if (method === 'POST') art.refresh({ force: true });
      return { status: method === 'POST' ? 202 : 200, body: { enabled: true, ...art.status } };
    },

    start() {
      if (!art) return;
      art.refresh();
      timer = setInterval(() => art.refresh(), SPORTS_ART_REFRESH_MS);
      if (timer.unref) timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { ID, FEATURES, CARD_SIZES, createWebUi, looksFrom, featureOf, featuresFrom, manifestFor, settingsFrom };
