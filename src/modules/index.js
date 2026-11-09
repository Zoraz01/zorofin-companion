'use strict';

// Module registry. A module is an object created by a factory(config, deps):
//
//   {
//     id: 'recommendations',          // lowercase start, letters/digits, used in routes
//     capabilities() -> { name: { version, enabled } },  // merged into the plugin's manifest
//     async handle({ method, path, segments, query, body, viewer }) -> { status, body },
//                                     // path is still escaped; segments are decoded
//     async onSeerrEvent(event),      // optional, for Seerr webhooks
//     start(), stop(),                // optional background work
//   }
//
// Capability names a module advertises must equal its id, so the plugin's
// proxy can allow exactly the modules the manifest lists.

const fs = require('fs');
const path = require('path');

const MODULE_ID = /^[a-z][a-zA-Z0-9]{0,31}$/;

// Modules that ship with this build.
const BUILT_IN = Object.freeze({
  notifications: (config, deps) => require('./notifications').createNotifications(config, deps),
  liveTvGuide: (config, deps) => require('./liveTvGuide').createLiveTvGuide(config, deps),
  liveTvSource: (config, deps) => require('./liveTvSource').createLiveTvSource(config, deps),
  liveTvStreams: (config, deps) => require('./liveTvStreams').createLiveTvStreams(config, deps),
  sportsEvents: (config, deps) => require('./sportsEvents').createSportsEvents(config, deps),
  recommendations: (config, deps) => require('./recommendations').createRecommendations(config, deps),
  webUi: (config, deps) => require('./webUi').createWebUi(config, deps),
});

function createRegistry(names, config, deps = {}, available = BUILT_IN) {
  const errors = [];
  const modules = new Map();
  for (const name of names) {
    const factory = Object.prototype.hasOwnProperty.call(available, name) ? available[name] : null;
    if (!factory) {
      errors.push(`unknown module "${name}"`);
      continue;
    }
    let module;
    try { module = factory(config, deps); }
    catch (error) {
      errors.push(`module "${name}": ${error.message}`);
      continue;
    }
    if (!module || module.id !== name || !MODULE_ID.test(module.id)) {
      errors.push(`module "${name}" has an invalid id`);
      continue;
    }
    modules.set(module.id, module);
  }

  return {
    errors,
    get(id) { return modules.get(id) || null; },
    ids() { return [...modules.keys()]; },
    capabilities() {
      const features = {};
      for (const module of modules.values()) {
        let advertised = {};
        try { advertised = module.capabilities() || {}; }
        catch (_) { advertised = {}; }
        const feature = advertised[module.id];
        if (feature && Number.isInteger(feature.version) && feature.version > 0) {
          features[module.id] = { version: feature.version, enabled: feature.enabled !== false };
        }
      }
      return { schemaVersion: 1, features };
    },
    seerrListeners() {
      return [...modules.values()].filter(module => typeof module.onSeerrEvent === 'function');
    },
    start() { for (const module of modules.values()) if (typeof module.start === 'function') module.start(); },
    stop() { for (const module of modules.values()) if (typeof module.stop === 'function') module.stop(); },
  };
}

// Loads site-specific modules from a directory outside this source tree, for
// logic one server keeps private (for example provider-specific Live TV rules).
// Each file exports { id, create(config, deps) }. Built-in ids cannot be replaced.
function loadPrivateModules(dir, builtIn = BUILT_IN) {
  const available = { ...builtIn };
  const errors = [];
  if (!dir) return { available, errors };
  let files = [];
  try { files = fs.readdirSync(dir).filter(file => file.endsWith('.js')).sort(); }
  catch (error) { return { available, errors: [`ZOROFIN_PRIVATE_MODULES_DIR cannot be read: ${error.message}`] }; }
  for (const file of files) {
    try {
      const entry = require(path.resolve(dir, file));
      if (!entry || !MODULE_ID.test(String(entry.id)) || typeof entry.create !== 'function') {
        errors.push(`private module ${file} must export { id, create }`);
      } else if (Object.prototype.hasOwnProperty.call(available, entry.id)) {
        errors.push(`private module ${file} reuses the id "${entry.id}"`);
      } else {
        available[entry.id] = entry.create;
      }
    } catch (error) {
      errors.push(`private module ${file} failed to load: ${error.message}`);
    }
  }
  return { available, errors };
}

module.exports = { BUILT_IN, MODULE_ID, createRegistry, loadPrivateModules };
