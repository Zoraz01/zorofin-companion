#!/usr/bin/env node
'use strict';

const { loadConfig } = require('./config');
const { loadPrivateModules } = require('./modules');
const { createServer } = require('./server');
const { createSettings } = require('./settings');

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

const { config, errors } = loadConfig();
const extra = loadPrivateModules(config.privateModulesDir);
// Core settings and unknown module ids stop the companion. A module whose own
// settings are incomplete stays off instead, with the reason shown in the
// Jellyfin Dashboard, so a bad setting can't keep the companion down.
const unknown = config.modules.filter(id => !Object.prototype.hasOwnProperty.call(extra.available, id)).map(id => `unknown module "${id}"`);
const problems = [...errors, ...extra.errors, ...unknown];
if (problems.length) {
  for (const problem of problems) log(`configuration error: ${problem}`);
  process.exit(78); // EX_CONFIG
}

const settings = createSettings({ baseEnv: process.env, startupConfig: config, available: extra.available, deps: { log } });
const registry = settings.registry;
const server = createServer({ config, registry, settings, log });
server.listen(config.port, config.bind, () => {
  log(`zorofin companion listening on ${config.bind}:${config.port}; modules: ${registry.ids().join(', ') || 'none'}`);
});

function shutdown() {
  registry.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
