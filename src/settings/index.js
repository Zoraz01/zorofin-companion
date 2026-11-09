'use strict';

// Settings saved from the Jellyfin Dashboard, applied without a restart.
//
// Saved values live in <dataDir>/settings.json (mode 600) and take the place
// of the environment variables the modules already read. Environment
// variables stay as defaults, so env-only installs behave as before. Secrets
// are write-only: they are never sent back, only whether one is set.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { createRegistry } = require('../modules');
const { readJsonFile, requestJson, writePrivateJson } = require('../lib/io');
const { SECTIONS } = require('./schemas');

const SETTINGS_VERSION = 1;
const MAX_VALUE_LENGTH = 2048;
const MAX_IMAGE_BYTES = 1024 * 1024;
// Uploads accepted for image settings. Browsers recognise these by their bytes,
// so they show wherever the theme expects its PNG logos.
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const IMAGE_MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] };

// Keeps an uploaded image (a data: URL) in the data folder and returns its path.
// Names come from the content, so a refused save leaves nothing half-written.
function storeImage(option, value, dataDir) {
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  const ext = match && IMAGE_TYPES[match[1]];
  if (!ext) throw new Error(`${option.label} must be a PNG, JPEG or WebP image`);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error(`${option.label} must be 1 MB or smaller`);
  if (!IMAGE_MAGIC[ext].every((byte, i) => bytes[i] === byte)) throw new Error(`${option.label} isn't a valid ${ext.toUpperCase()} image`);
  const dir = path.join(dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${option.key}-${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { mode: 0o644 });
  return file;
}

function imageSet(raw) {
  if (!raw) return false;
  try { return fs.statSync(raw).isFile(); } catch (_) { return false; }
}

// Variables that are only set on the container, named the way the Dashboard should.
const CONTAINER_ONLY = {
  ZOROFIN_SEERR_WEBHOOK_SECRET: 'the Seerr webhook secret (set on the container)',
  ZOROFIN_BRIDGE_SECRET: 'the bridge secret (set on the container)',
  ZOROFIN_NOTIFY_EMAIL_: 'the email settings',
};

// Module errors name environment variables; show the Dashboard's field names instead.
function friendly(message) {
  const labels = { ...CONTAINER_ONLY };
  for (const section of Object.values(SECTIONS)) for (const option of section.options) labels[option.env] = option.label;
  return String(message)
    .replace(/\(or (ZOROFIN_[A-Z_]+)_FILE\)/g, '')
    .replace(/ZOROFIN_[A-Z_]+\*?/g, name => {
      const bare = name.replace(/\*$/, '').replace(/_FILE$/, '');
      return labels[bare] || name;
    })
    .replace(/\s{2,}/g, ' ');
}

// A key counts as set on the container when the variable has a value, or
// names a file that exists and isn't empty (compose files point at files
// that may not have been created yet).
function containerHasSecret(env, name) {
  if (env[name]) return true;
  const file = env[`${name}_FILE`];
  if (!file) return false;
  try { return fs.readFileSync(file, 'utf8').trim().length > 0; } catch (_) { return false; }
}

function sectionFor(id, available) {
  if (Object.prototype.hasOwnProperty.call(SECTIONS, id)) return SECTIONS[id];
  if (Object.prototype.hasOwnProperty.call(available, id)) {
    return { kind: 'module', title: id, description: 'A module installed on this server.', options: [] };
  }
  return null;
}

// Turns a submitted value into the string the module's environment variable
// expects, or throws a message for the Dashboard.
function normalize(option, value) {
  if (value === null) return null;
  switch (option.type) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new Error(`${option.label} must be on or off`);
      return value ? '1' : '0';
    case 'number': {
      const number = Number(value);
      if (!Number.isFinite(number) || (option.min !== undefined && number < option.min) || (option.max !== undefined && number > option.max)) {
        throw new Error(`${option.label} must be a number from ${option.min} to ${option.max}`);
      }
      return String(number);
    }
    case 'color':
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.trim())) throw new Error(`${option.label} must be a colour like #42d779`);
      return value.trim().toLowerCase();
    case 'choice':
      if (!option.choices.some(([key]) => key === value)) throw new Error(`${option.label} has an unknown choice`);
      return value;
    case 'list':
      if (!Array.isArray(value) && typeof value !== 'string') throw new Error(`${option.label} must be a list`);
      return (Array.isArray(value) ? value : value.split(',')).map(item => String(item).trim()).filter(Boolean).join(',');
    default: {
      if (typeof value !== 'string') throw new Error(`${option.label} must be text`);
      const text = value.trim();
      if (text.length > Math.min(option.max || MAX_VALUE_LENGTH, MAX_VALUE_LENGTH) || /[\r\n\0]/.test(text)) throw new Error(`${option.label} is too long or has line breaks`);
      if (option.type === 'url' && text) {
        let url;
        try { url = new URL(text); } catch (_) { throw new Error(`${option.label} must be an http(s) address`); }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${option.label} must be an http(s) address`);
      }
      return text;
    }
  }
}

function displayValue(option, raw) {
  if (raw === undefined || raw === '') {
    if (option.type === 'list') return Array.isArray(option.default) ? [...option.default] : [];
    return option.default !== undefined ? option.default : (option.type === 'boolean' ? false : '');
  }
  if (option.type === 'boolean') return /^(1|true|yes|on)$/i.test(String(raw).trim());
  if (option.type === 'number') return Number(raw);
  if (option.type === 'list') return String(raw).split(',').map(item => item.trim()).filter(Boolean);
  return String(raw);
}

function createSettings({ baseEnv, startupConfig, available, deps = {}, now = Date.now }) {
  const file = path.join(startupConfig.dataDir, 'settings.json');
  const reach = deps.requestJson || requestJson;
  const log = deps.log || (() => {});
  let saved = readJsonFile(file, null);
  if (!saved || saved.version !== SETTINGS_VERSION || typeof saved.sections !== 'object') saved = { version: SETTINGS_VERSION, sections: {} };

  let registry = null;
  let config = startupConfig;
  let problems = {}; // module id -> message, for modules that could not start

  function envFor(sections) {
    const env = { ...baseEnv };
    for (const [id, entry] of Object.entries(sections)) {
      const section = sectionFor(id, available);
      if (!section || !entry || !entry.values) continue;
      for (const option of section.options) {
        if (Object.prototype.hasOwnProperty.call(entry.values, option.key)) {
          env[option.env] = entry.values[option.key];
          delete env[`${option.env}_FILE`];
        }
      }
    }
    return env;
  }

  function enabledFor(sections) {
    const fromEnv = new Set(startupConfig.modules);
    return Object.keys(available).filter(id => {
      const entry = sections[id];
      return entry && typeof entry.enabled === 'boolean' ? entry.enabled : fromEnv.has(id);
    });
  }

  // Builds every enabled module from a candidate set of saved settings. A
  // module whose settings are incomplete is left off and its error kept.
  function build(sections) {
    const env = envFor(sections);
    const loaded = loadConfig(env);
    // The bridge secret, address and data folder are fixed at startup.
    const nextConfig = { ...loaded.config, port: startupConfig.port, bind: startupConfig.bind, dataDir: startupConfig.dataDir, bridgeSecret: startupConfig.bridgeSecret, seerrWebhookSecret: startupConfig.seerrWebhookSecret, privateModulesDir: startupConfig.privateModulesDir };
    const ids = enabledFor(sections);
    const nextProblems = {};
    const good = [];
    for (const id of ids) {
      const single = createRegistry([id], nextConfig, { ...deps, env }, available);
      if (single.errors.length) nextProblems[id] = friendly(single.errors.join('; ').replace(/^module "[^"]+": /, ''));
      else good.push(id);
    }
    const next = createRegistry(good, nextConfig, { ...deps, env }, available);
    return { registry: next, config: nextConfig, problems: nextProblems, env };
  }

  function activate(built) {
    const previous = registry;
    registry = built.registry;
    config = built.config;
    problems = built.problems;
    if (previous) previous.stop();
    registry.start();
    for (const [id, message] of Object.entries(problems)) log(`module ${id} is off: ${message}`);
  }

  function sectionView(id) {
    const section = sectionFor(id, available);
    const entry = saved.sections[id] || {};
    const env = envFor(saved.sections);
    const view = {
      id,
      kind: section.kind,
      title: section.title,
      description: section.description,
      options: section.options.map(option => {
        const stored = entry.values && Object.prototype.hasOwnProperty.call(entry.values, option.key);
        const fromEnv = option.type === 'secret'
          ? containerHasSecret(baseEnv, option.env)
          : baseEnv[option.env] !== undefined && baseEnv[option.env] !== '';
        const out = {
          key: option.key, type: option.type, label: option.label,
          ...(option.help ? { help: option.help } : {}),
          ...(option.placeholder ? { placeholder: option.placeholder } : {}),
          ...(option.choices ? { choices: option.choices.map(([value, label, color]) => ({ value, label, ...(color ? { color } : {}) })) } : {}),
          ...(option.display ? { display: option.display } : {}),
          ...(option.when ? { when: { key: option.when[0], value: option.when[1] } } : {}),
          ...(option.slot ? { slot: option.slot } : {}),
          ...(option.min !== undefined ? { min: option.min, max: option.max } : {}),
          source: stored ? 'dashboard' : fromEnv ? 'environment' : 'default',
        };
        if (option.type === 'secret') out.set = !!(stored ? entry.values[option.key] : fromEnv);
        else if (option.type === 'image') out.set = imageSet(env[option.env]);
        else out.value = displayValue(option, env[option.env]);
        return out;
      }),
    };
    if (section.kind === 'module') {
      view.enabled = enabledFor(saved.sections).includes(id);
      view.running = !!(registry && registry.get(id));
      if (problems[id]) view.error = problems[id];
    }
    return view;
  }

  // Applies a change from the Dashboard to a copy of the saved settings.
  // values: { key: value } sets a value, { key: null } goes back to the
  // environment default; an empty or missing secret keeps the current one.
  function candidate(id, change) {
    const section = sectionFor(id, available);
    if (!section) throw Object.assign(new Error('Unknown section'), { status: 404 });
    if (!change || typeof change !== 'object') throw Object.assign(new Error('Invalid settings'), { status: 400 });
    const sections = JSON.parse(JSON.stringify(saved.sections));
    const entry = sections[id] || { values: {} };
    entry.values = entry.values || {};
    if (change.enabled !== undefined) {
      if (section.kind !== 'module' || typeof change.enabled !== 'boolean') throw Object.assign(new Error('Invalid on/off value'), { status: 400 });
      entry.enabled = change.enabled;
    }
    const values = change.values || {};
    if (typeof values !== 'object' || Array.isArray(values)) throw Object.assign(new Error('Invalid settings'), { status: 400 });
    for (const [key, value] of Object.entries(values)) {
      const option = section.options.find(item => item.key === key);
      if (!option) throw Object.assign(new Error(`Unknown setting ${key}`), { status: 400 });
      if ((option.type === 'secret' || option.type === 'image') && (value === '' || value === undefined)) continue;
      let normalized;
      try { normalized = option.type === 'image' && value !== null ? storeImage(option, value, startupConfig.dataDir) : normalize(option, value); }
      catch (error) { throw Object.assign(error, { status: 422 }); }
      if (normalized === null) delete entry.values[key];
      else entry.values[key] = normalized;
    }
    sections[id] = entry;
    return sections;
  }

  async function reachable(url) {
    try {
      const reply = await reach(url, { timeout: 5000, maxResponseBytes: 65536 });
      return { ok: reply.status > 0 && reply.status < 500, detail: `answered ${reply.status}` };
    } catch (error) {
      return { ok: false, detail: error.message };
    }
  }

  activate(build(saved.sections));

  return {
    // The live registry; the server reads through this so changes apply at once.
    registry: {
      get: id => registry.get(id),
      ids: () => registry.ids(),
      capabilities: () => registry.capabilities(),
      seerrListeners: () => registry.seerrListeners(),
      start() {},
      stop: () => registry.stop(),
    },
    config: () => config,
    problems: () => ({ ...problems }),

    view() {
      const ids = ['connections', ...Object.keys(available)];
      return { schemaVersion: 1, sections: ids.filter(id => sectionFor(id, available)).map(sectionView) };
    },

    // Saves only when every module that is on can still start.
    save(id, change) {
      const sections = candidate(id, change);
      const built = build(sections);
      const wantOn = enabledFor(sections);
      const failed = wantOn.filter(name => built.problems[name] && (name === id || !problems[name]));
      if (failed.length) {
        built.registry.stop();
        const error = new Error(failed.map(name => `${sectionFor(name, available).title}: ${built.problems[name]}`).join('\n'));
        throw Object.assign(error, { status: 422 });
      }
      saved = { version: SETTINGS_VERSION, sections, updatedAt: new Date(now()).toISOString() };
      writePrivateJson(file, saved);
      activate(built);
      return sectionView(id);
    },

    // Checks a change without saving: can the module start, and do its addresses answer?
    async test(id, change) {
      const sections = candidate(id, { ...change, ...(sectionFor(id, available).kind === 'module' ? { enabled: true } : {}) });
      const env = envFor(sections);
      const section = sectionFor(id, available);
      const checks = [];
      if (section.kind === 'module') {
        const loaded = loadConfig(env);
        const single = createRegistry([id], { ...loaded.config, dataDir: path.join(startupConfig.dataDir, '.settings-test'), bridgeSecret: startupConfig.bridgeSecret, seerrWebhookSecret: startupConfig.seerrWebhookSecret }, { ...deps, env }, available);
        checks.push(single.errors.length
          ? { label: 'Settings', ok: false, detail: friendly(single.errors.join('; ').replace(/^module "[^"]+": /, '')) }
          : { label: 'Settings', ok: true, detail: 'complete' });
        single.stop();
      }
      const urls = section.options.filter(option => option.type === 'url' && env[option.env]);
      const connectionUrls = section.kind === 'module' && id !== 'webUi'
        ? SECTIONS.connections.options.filter(option => option.type === 'url' && option.key !== 'appUrl' && env[option.env])
        : [];
      for (const option of [...urls, ...connectionUrls]) {
        const result = await reachable(env[option.env]);
        checks.push({ label: option.label, ok: result.ok, detail: result.detail });
      }
      return { ok: checks.every(check => check.ok), checks };
    },
  };
}

module.exports = { SETTINGS_VERSION, createSettings, friendly, normalize };
