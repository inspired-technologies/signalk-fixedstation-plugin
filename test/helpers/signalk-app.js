'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

// Minimal stand-in for the SignalK server app object. Every member used by the
// plugin has to be present, otherwise the plugin fails at startup.
function createApp(overrides = {}) {
  const app = {
    deltas: [],
    statuses: [],
    errors: [],
    savedOptions: [],
    selfPaths: {},
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fixedstation-')),

    debug: () => {},
    error: (msg) => app.errors.push(msg),
    setPluginStatus: (msg) => app.statuses.push(msg),
    setPluginError: (msg) => app.errors.push(msg),
    handleMessage: (id, message) => app.deltas.push({ id, message }),
    getSelfPath: (p) => app.selfPaths[p],
    getDataDirPath: () => app.dataDir,
    savePluginOptions: (options, callback) => {
      app.savedOptions.push(options);
      if (callback) callback();
    },

    ...overrides,
  };
  return app;
}

function values(app) {
  return app.deltas
    .filter((d) => d.message.updates[0].values)
    .flatMap((d) => d.message.updates[0].values);
}

function meta(app) {
  return app.deltas
    .filter((d) => d.message.updates[0].meta)
    .flatMap((d) => d.message.updates[0].meta);
}

function latest(app, p) {
  return values(app).filter((v) => v.path === p).at(-1);
}

async function waitFor(condition, description, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${description}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Replaces the global fetch; every request is recorded, the handler returns
// { status, body } or throws to simulate a network error.
function stubFetch(handler) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(new URL(url));
    const { status = 200, body } = await handler(new URL(url), requests.length);
    return { status, json: async () => body };
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}

module.exports = { createApp, values, meta, latest, waitFor, sleep, stubFetch };
