const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const GEOLOC = require.resolve('../geoloc');

// Stands in for geoloc.js so the whole plugin lifecycle can be verified from the
// command line without hitting the public-ip service or the Google Maps API.
const geoloc = {
  ip: '203.0.113.7',
  lat: 52.52,
  lon: 13.405,
  elevation: 34.567891,
  calls: { init: [], getIP: [], getGeo: [], callElevation: [] },
  init: (config) => {
    geoloc.calls.init.push(config);
  },
  getIP: async (version) => {
    geoloc.calls.getIP.push(version);
    return geoloc.ip;
  },
  getGeo: (ip) => {
    geoloc.calls.getGeo.push(ip);
    return ip === geoloc.ip ? { ll: [geoloc.lat, geoloc.lon] } : null;
  },
  getElevation: () => geoloc.elevation,
  callElevation: (lat, lon, callback) => {
    geoloc.calls.callElevation.push({ lat, lon });
    callback(geoloc.elevation);
  },
};

require.cache[GEOLOC] = {
  id: GEOLOC,
  filename: GEOLOC,
  path: path.dirname(GEOLOC),
  loaded: true,
  children: [],
  paths: [],
  exports: geoloc,
};

const pluginFactory = require('../index');

async function waitFor(condition, description, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${description}`);
}

function createApp() {
  const app = {
    deltas: [],
    errors: [],
    debug: () => {},
    error: (msg) => app.errors.push(msg),
    handleMessage: (id, message) => app.deltas.push({ id, message }),
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

describe('plugin lifecycle', () => {
  const app = createApp();
  const options = { dynamic: true, elevation: 5, apikey: 'test-api-key' };
  let plugin;

  before(() => {
    plugin = pluginFactory(app);
  });

  after(() => {
    plugin.stop();
  });

  it('starts dynamically and publishes the configured elevation plus its meta', () => {
    plugin.start(options, () => {});

    assert.deepEqual(app.errors, []);
    assert.deepEqual(geoloc.calls.init, [options]);

    const published = values(app);
    assert.equal(published.length, 1);
    assert.deepEqual(published[0], { path: 'navigation.gnss.antennaAltitude', value: 5 });

    const units = meta(app);
    assert.equal(units.length, 1);
    assert.deepEqual(units[0], {
      path: 'navigation.gnss.antennaAltitude',
      value: { units: 'm', description: 'Altitude above sealevel', pgn: 129029 },
    });
  });

  it('resolves the position from the public IP address', async () => {
    await waitFor(
      () => values(app).some((v) => v.path === 'navigation.position'),
      'the position to be resolved',
    );

    assert.deepEqual(geoloc.calls.getIP, ['v4']);
    assert.deepEqual(geoloc.calls.getGeo, [geoloc.ip]);

    const position = values(app).find((v) => v.path === 'navigation.position');
    assert.equal(position.value.latitude, geoloc.lat);
    assert.equal(position.value.longitude, geoloc.lon);
    // no elevation has been looked up yet, so the position carries no altitude
    assert.equal(Object.hasOwn(position.value, 'altitude'), false);
  });

  it('looks up and publishes the elevation for the resolved position', async () => {
    await waitFor(
      () => values(app).filter((v) => v.path === 'navigation.gnss.antennaAltitude').length > 1,
      'the elevation to be looked up',
    );

    assert.deepEqual(geoloc.calls.callElevation, [{ lat: geoloc.lat, lon: geoloc.lon }]);

    const altitude = values(app).filter((v) => v.path === 'navigation.gnss.antennaAltitude').at(-1);
    // the looked up elevation is published rounded to millimetres
    assert.equal(altitude.value, 34.568);
    assert.deepEqual(app.errors, []);
  });

  it('stops without publishing any further data', async () => {
    const published = app.deltas.length;

    plugin.stop();
    await new Promise((resolve) => setTimeout(resolve, 250));

    assert.equal(app.deltas.length, published);
    assert.deepEqual(app.errors, []);
  });

  it('clears the retained position and elevation on stop', () => {
    const restarted = createApp();
    const restartedPlugin = pluginFactory(restarted);

    restartedPlugin.start({ latitude: -33.86, longitude: 151.21, dynamic: false }, () => {});
    restartedPlugin.stop();

    const position = values(restarted).find((v) => v.path === 'navigation.position');
    assert.equal(position.value.latitude, -33.86);
    assert.equal(position.value.longitude, 151.21);
    // the elevation of the previous run must not leak into the new position
    assert.equal(Object.hasOwn(position.value, 'altitude'), false);
  });
});
