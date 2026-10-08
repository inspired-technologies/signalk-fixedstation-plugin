const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const pluginFactory = require('../index');

// Minimal stand-in for the SignalK server app object. Every member used by
// index.js has to be present, otherwise the plugin fails at startup.
function createApp() {
  const app = {
    deltas: [],
    debug: () => {},
    error: (msg) => app.errors.push(msg),
    errors: [],
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

describe('plugin', () => {
  it('has required interface', () => {
    const plugin = pluginFactory(createApp());
    assert.equal(typeof plugin.start, 'function');
    assert.equal(typeof plugin.stop, 'function');
    assert.equal(plugin.id, 'signalk-fixedstation');
    assert.ok(plugin.name);
    assert.ok(plugin.description);
    assert.ok(plugin.schema);
  });

  it('exposes a configuration schema for position, elevation and lookups', () => {
    const plugin = pluginFactory(createApp());
    const properties = plugin.schema.properties;

    assert.equal(plugin.schema.type, 'object');
    assert.deepEqual(Object.keys(properties).sort(), [
      'apikey',
      'dynamic',
      'elevation',
      'latitude',
      'longitude',
    ]);
    assert.equal(properties.latitude.type, 'number');
    assert.equal(properties.longitude.type, 'number');
    assert.equal(properties.elevation.type, 'number');
    assert.equal(properties.dynamic.type, 'boolean');
    assert.equal(properties.dynamic.default, false);
    assert.equal(properties.apikey.type, 'string');
  });

  it('publishes the configured position, elevation and meta on start', (t) => {
    const app = createApp();
    const plugin = pluginFactory(app);
    t.after(() => plugin.stop());

    plugin.start({ latitude: 52.5, longitude: 13.4, elevation: 34.5, dynamic: false }, () => {});

    assert.deepEqual(app.errors, []);
    assert.deepEqual(app.deltas.map((d) => d.id), Array(app.deltas.length).fill('signalk-fixedstation'));

    const published = values(app);
    const position = published.filter((v) => v.path === 'navigation.position');
    const altitude = published.filter((v) => v.path === 'navigation.gnss.antennaAltitude');

    assert.ok(position.length > 0);
    assert.ok(altitude.length > 0);
    assert.equal(position.at(-1).value.latitude, 52.5);
    assert.equal(position.at(-1).value.longitude, 13.4);
    // once the elevation is known it is carried along in the position value
    assert.equal(position.at(-1).value.altitude, 34.5);
    assert.equal(altitude.at(-1).value, 34.5);

    const units = meta(app);
    assert.equal(units.length, 1);
    assert.equal(units[0].path, 'navigation.gnss.antennaAltitude');
    assert.deepEqual(units[0].value, {
      units: 'm',
      description: 'Altitude above sealevel',
      pgn: 129029,
    });
  });

  it('publishes a position without altitude when no elevation is configured', (t) => {
    const app = createApp();
    const plugin = pluginFactory(app);
    t.after(() => plugin.stop());

    plugin.start({ latitude: -33.86, longitude: 151.21, dynamic: false }, () => {});

    const position = values(app).find((v) => v.path === 'navigation.position');
    assert.ok(position);
    assert.equal(position.value.latitude, -33.86);
    assert.equal(position.value.longitude, 151.21);
    assert.equal(Object.hasOwn(position.value, 'altitude'), false);
  });

  it('publishes nothing when neither position nor elevation is configured', (t) => {
    const app = createApp();
    const plugin = pluginFactory(app);
    t.after(() => plugin.stop());

    plugin.start({ dynamic: false }, () => {});

    assert.deepEqual(values(app), []);
    assert.deepEqual(meta(app), []);
    assert.deepEqual(app.errors, []);
  });

  it('publishes only the elevation when no position is configured', (t) => {
    const app = createApp();
    const plugin = pluginFactory(app);
    t.after(() => plugin.stop());

    plugin.start({ elevation: 12, dynamic: false }, () => {});

    const published = values(app);
    assert.ok(published.length > 0);
    assert.ok(published.every((v) => v.path === 'navigation.gnss.antennaAltitude'));
    assert.ok(published.every((v) => v.value === 12));
    assert.equal(meta(app).length, 1);
    assert.deepEqual(app.errors, []);
  });

  it('starts and stops without error', () => {
    const app = createApp();
    const plugin = pluginFactory(app);

    plugin.start({ latitude: 52.5, longitude: 13.4, elevation: 34.5 }, () => {});
    const published = app.deltas.length;

    plugin.stop();
    plugin.stop();

    assert.equal(app.deltas.length, published);
    assert.deepEqual(app.errors, []);
  });
});
