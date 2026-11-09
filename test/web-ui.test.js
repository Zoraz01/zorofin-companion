'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWebUi, manifestFor } = require('../src/modules/webUi');

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zorofin-webui-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

test('manifest lists styles and scripts in name order and skips private files', () => {
  assert.deepEqual(manifestFor(['20-app.js', '10-theme.css', '_debug.js', 'logo.svg', '05-base.css', '../x.js']), {
    schemaVersion: 1, styles: ['05-base.css', '10-theme.css'], scripts: ['20-app.js'], classes: ['zoro-ui'],
  });
});

test('switches leave out their files and tell the theme what is off', () => {
  const names = ['10-theme-base.css', '30-theme-core.js', '39-banner-home.js', '40-player.js', '50-livetv-pages.js', '60-requests-hub.js', '90-extra.js'];
  const { featuresFrom } = require('../src/modules/webUi');
  assert.deepEqual(manifestFor(names, featuresFrom({})), {
    schemaVersion: 1, styles: ['10-theme-base.css'], scripts: ['30-theme-core.js', '39-banner-home.js', '40-player.js', '50-livetv-pages.js', '90-extra.js'], classes: ['zoro-ui', 'zorofin-off-requests'],
  });
  assert.deepEqual(manifestFor(names, featuresFrom({ ZOROFIN_WEB_UI_BANNER: 'off' })).scripts,
    ['30-theme-core.js', '40-player.js', '50-livetv-pages.js', '90-extra.js']);
  assert.deepEqual(manifestFor(names, featuresFrom({ ZOROFIN_WEB_UI_REQUESTS: '1', ZOROFIN_WEB_UI_PLAYER: 'false' })).scripts,
    ['30-theme-core.js', '39-banner-home.js', '50-livetv-pages.js', '60-requests-hub.js', '90-extra.js']);
  // Live TV and Requests need the theme.
  const plain = manifestFor(names, featuresFrom({ ZOROFIN_WEB_UI_THEME: '0', ZOROFIN_WEB_UI_REQUESTS: '1' }));
  assert.deepEqual(plain.styles, []);
  assert.deepEqual(plain.scripts, ['40-player.js', '90-extra.js']);
  assert.deepEqual(plain.classes, ['zorofin-off-theme', 'zorofin-off-banner', 'zorofin-off-livetv', 'zorofin-off-requests']);
});

test('capability is off with nothing to serve', () => {
  const empty = createWebUi({}, { settings: { dir: folder({}) } });
  assert.deepEqual(empty.capabilities(), { webUi: { version: 1, enabled: false } });
  const missing = createWebUi({}, { settings: { dir: path.join(os.tmpdir(), 'zorofin-webui-missing-' + process.pid) } });
  assert.equal(missing.capabilities().webUi.enabled, false);
});

test('serves listed files with types and caching, and refuses anything else', async () => {
  const dir = folder({ '10-theme.css': 'body{}', '20-app.js': 'void 0', 'notes.txt': 'secret' });
  fs.symlinkSync('/etc/hostname', path.join(dir, 'link.css'));
  const ui = createWebUi({}, { settings: { dir } });
  assert.equal(ui.capabilities().webUi.enabled, true);

  const manifest = await ui.handlePublic({ segments: ['manifest.json'] });
  const listed = JSON.parse(manifest.raw);
  assert.match(listed.version, /^[a-f0-9]{12}$/);
  delete listed.version;
  assert.deepEqual(listed, { schemaVersion: 1, styles: ['10-theme.css'], scripts: ['20-app.js'], classes: ['zoro-ui'] });

  const css = await ui.handlePublic({ segments: ['10-theme.css'] });
  assert.equal(css.status, 200);
  assert.equal(css.contentType, 'text/css; charset=utf-8');
  assert.equal(css.cacheControl, 'public, max-age=300');
  assert.equal(css.raw.toString(), 'body{}');

  for (const segments of [['notes.txt'], ['link.css'], ['..', '20-app.js'], ['.hidden.js'], ['missing.js'], []]) {
    assert.equal((await ui.handlePublic({ segments })).status, 404, segments.join('/'));
  }
  assert.equal((await ui.handle({ method: 'GET', segments: [] })).status, 404);
});

test('the packaged web-ui folder ships the Zorofin theme and web player', async () => {
  const ui = createWebUi({}, { env: {} });
  assert.equal(ui.capabilities().webUi.enabled, true);
  const manifest = JSON.parse((await ui.handlePublic({ segments: ['manifest.json'] })).raw);
  assert.ok(manifest.scripts.includes('40-player.js'), JSON.stringify(manifest));
  assert.equal(manifest.styles[0], '10-theme-base.css');
  assert.deepEqual(manifest.scripts.slice(0, 2), ['29-theme-runtime.js', '30-theme-core.js']);
  assert.ok(!manifest.scripts.includes('60-requests-hub.js'), 'Requests hub is off by default');
  for (const name of [...manifest.styles, ...manifest.scripts, 'InterVariable.woff2', 'wordmark.png', 'mark-512.png']) {
    assert.equal((await ui.handlePublic({ segments: [name] })).status, 200, name);
  }
  const script = await ui.handlePublic({ segments: ['40-player.js'] });
  assert.equal(script.status, 200);
  assert.equal(script.contentType, 'text/javascript; charset=utf-8');
  new (require('node:vm').Script)(script.raw.toString(), { filename: '40-player.js' });
});

test('the packaged web-ui folder matches branding/', { skip: !fs.existsSync(path.join(__dirname, '../../../tools/build-companion-web-ui.cjs')) }, () => {
  const run = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '../../../tools/build-companion-web-ui.cjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});

test('colours: greens follow the chosen accent, other colours stay', () => {
  const { recolor, targetFor, rgbToHsl } = require('../src/modules/webUi/palette');
  assert.equal(targetFor('zorofin', ''), null);
  assert.equal(targetFor('custom', 'not-a-colour'), null);
  const ocean = targetFor('ocean');
  const css = '.a{color:#42d779;background:rgba(37, 184, 95, .18);border:#fff;box-shadow:0 0 0 #111513} .b{color:#ff0000;fill:rgb(66,215,121)}';
  const out = recolor(css, ocean);
  assert.match(out, /border:#fff/);
  assert.match(out, /color:#ff0000/);
  const [accent] = out.match(/#[0-9a-f]{6}/);
  const hsl = rgbToHsl(...[1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16)));
  assert.ok(Math.abs(hsl.h - ocean.h) < 3, `accent hue ${hsl.h} follows ${ocean.h}`);
  assert.match(out, /rgba\(\d+, \d+, \d+, \.18\)/, 'keeps alpha');
  assert.doesNotMatch(out, /#42d779|rgba\(37, 184, 95|rgb\(66,215,121\)|#111513/);
  assert.equal(recolor(css, targetFor('custom', '#42D779')), css, 'custom Zorofin green changes nothing');
});

test('colours, logos and versions in the served files', async () => {
  const dir = folder({ '10-theme-a.css': '.x{color:#42d779}', '30-theme-core.js': 'var c="#25b85f";', 'wordmark.png': 'W', 'mark-512.png': 'M' });
  const uploads = folder({});
  const desktop = path.join(uploads, 'wide.png'); fs.writeFileSync(desktop, 'DESKTOP');
  const plain = createWebUi({}, { env: { ZOROFIN_WEB_UI_DIR: dir } });
  const base = JSON.parse((await plain.handlePublic({ segments: ['manifest.json'] })).raw);
  assert.equal((await plain.handlePublic({ segments: ['10-theme-a.css'] })).raw.toString(), '.x{color:#42d779}');

  const tinted = createWebUi({}, { env: { ZOROFIN_WEB_UI_DIR: dir, ZOROFIN_WEB_UI_COLORS: 'violet' } });
  const violet = JSON.parse((await tinted.handlePublic({ segments: ['manifest.json'] })).raw);
  assert.notEqual(violet.version, base.version, 'a colour change gives files a new version');
  assert.doesNotMatch((await tinted.handlePublic({ segments: ['10-theme-a.css'] })).raw.toString(), /#42d779/);
  assert.doesNotMatch((await tinted.handlePublic({ segments: ['30-theme-core.js'] })).raw.toString(), /#25b85f/);

  const none = createWebUi({}, { env: { ZOROFIN_WEB_UI_DIR: dir, ZOROFIN_WEB_UI_LOGO: 'none' } });
  const hidden = JSON.parse((await none.handlePublic({ segments: ['manifest.json'] })).raw);
  assert.ok(hidden.styles.includes('32-theme-brand.css'));
  assert.match((await none.handlePublic({ segments: ['32-theme-brand.css'] })).raw.toString(), /zoroBrand img/);
  assert.equal((await plain.handlePublic({ segments: ['32-theme-brand.css'] })).status, 404);

  const own = createWebUi({}, { env: { ZOROFIN_WEB_UI_DIR: dir, ZOROFIN_WEB_UI_LOGO: 'custom', ZOROFIN_WEB_UI_LOGO_DESKTOP: desktop } });
  assert.equal((await own.handlePublic({ segments: ['wordmark.png'] })).raw.toString(), 'DESKTOP');
  assert.equal((await own.handlePublic({ segments: ['mark-512.png'] })).raw.toString(), 'DESKTOP', 'phones fall back to the wide logo');
  assert.equal((await plain.handlePublic({ segments: ['wordmark.png'] })).raw.toString(), 'W');
});

const BANNER_SOURCE = path.join(__dirname, '../../../branding/zorofin-home-banner.js');
// The banner's source lives in the Zorofin monorepo's branding/ folder; a standalone export ships only the built pack.
test('Home banner picks titles with backdrops and writes their details line', { skip: !fs.existsSync(BANNER_SOURCE) && 'branding/ is not in this checkout' }, () => {
  const banner = require(BANNER_SOURCE);
  const movie = { Id: 'm', Type: 'Movie', BackdropImageTags: ['b'], ProductionYear: 2024, RunTimeTicks: 8 * 60 * 600000000 + 3 * 600000000, OfficialRating: 'PG-13', CommunityRating: 7.46 };
  const show = { Id: 's', Type: 'Series', BackdropImageTags: ['b'], ProductionYear: 2019, ChildCount: 1 };
  assert.equal(banner.details(movie), '2024 · 8h 3m · PG-13 · ★ 7.5');
  assert.equal(banner.details(show), '2019 · 1 season');
  assert.equal(banner.details({ Type: 'Series', ChildCount: 3 }), '3 seasons');
  assert.equal(banner.minutes(45 * 600000000), '45m');
  assert.equal(banner.minutes(0), '');
  const many = Array.from({ length: 12 }, (_, i) => ({ ...movie, Id: 'x' + i }));
  assert.deepEqual(banner.pick([null, { Id: 'e', Type: 'Episode', BackdropImageTags: ['b'] }, { Id: 'n', Type: 'Movie', BackdropImageTags: [] }, show]).map(i => i.Id), ['s']);
  assert.equal(banner.pick(many).length, 8);
});

test('an add-ons folder is listed with the pack, wins on the same name, and refuses symlinks', async () => {
  const dir = folder({ '10-theme-base.css': 'pack{}', '30-theme-core.js': 'pack()' });
  const extra = folder({ '70-site-support.js': 'site()', '30-theme-core.js': 'override()' });
  fs.symlinkSync('/etc/hostname', path.join(extra, '71-site-link.js'));
  const ui = createWebUi({}, { env: { ZOROFIN_WEB_UI_DIR: dir, ZOROFIN_WEB_UI_EXTRA_DIR: extra } });
  const manifest = JSON.parse((await ui.handlePublic({ segments: ['manifest.json'] })).raw.toString());
  assert.deepEqual(manifest.scripts, ['30-theme-core.js', '70-site-support.js']);
  assert.equal((await ui.handlePublic({ segments: ['70-site-support.js'] })).raw.toString(), 'site()');
  assert.equal((await ui.handlePublic({ segments: ['30-theme-core.js'] })).raw.toString(), 'override()');
  assert.equal((await ui.handlePublic({ segments: ['10-theme-base.css'] })).raw.toString(), 'pack{}');
  assert.equal((await ui.handlePublic({ segments: ['71-site-link.js'] })).status, 404);
  // Without the setting, the pack alone is served.
  const plain = createWebUi({}, { env: { ZOROFIN_WEB_UI_DIR: dir } });
  assert.equal((await plain.handlePublic({ segments: ['70-site-support.js'] })).status, 404);
});

test('server looks: one accent and card size for the web look and the apps', async () => {
  const { settingsFrom } = require('../src/modules/webUi');
  const dir = folder({ '10-theme-base.css': 'a{}' });
  const read = async env => {
    const ui = createWebUi({}, { settings: { ...settingsFrom({ ...env, ZOROFIN_WEB_UI_DIR: dir }) } });
    const looks = JSON.parse((await ui.handlePublic({ segments: ['looks.json'] })).raw);
    const manifest = JSON.parse((await ui.handlePublic({ segments: ['manifest.json'] })).raw);
    return { looks, classes: manifest.classes };
  };
  const plain = await read({});
  assert.deepEqual(plain.looks, { version: 1, colors: 'zorofin', accent: '#42d779', cardSize: 'standard', logo: 'zorofin', enforced: true });
  assert.ok(!plain.classes.some(name => name.startsWith('zoro-cards-')));
  const custom = await read({ ZOROFIN_WEB_UI_COLORS: 'custom', ZOROFIN_WEB_UI_ACCENT: '#FF00AA', ZOROFIN_WEB_UI_CARD_SIZE: 'large' });
  assert.equal(custom.looks.accent, '#ff00aa');
  assert.equal(custom.looks.cardSize, 'large');
  assert.ok(custom.classes.includes('zoro-cards-large'));
  assert.equal((await read({ ZOROFIN_WEB_UI_COLORS: 'ocean' })).looks.accent, '#3d9cff');
  assert.equal((await read({ ZOROFIN_WEB_UI_COLORS: 'custom', ZOROFIN_WEB_UI_ACCENT: 'red' })).looks.accent, '#42d779', 'a bad custom colour falls back');
  assert.equal((await read({ ZOROFIN_WEB_UI_CARD_SIZE: 'huge' })).looks.cardSize, 'standard');
  assert.equal((await read({ ZOROFIN_WEB_UI_LOOKS_ENFORCED: 'false' })).looks.enforced, false, 'a default viewers may change');
});
