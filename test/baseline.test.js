'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const pluginFactory = require('../index');
const station = require('../fixedstation');
const { createApp, values, meta, latest, waitFor, sleep, stubFetch } = require('./helpers/signalk-app');

const POSITION = 'navigation.position';
const ALTITUDE = 'navigation.gnss.antennaAltitude';

// Static configurations - no lookups of the position, network requests are stubbed.
describe('plugin', () => {
  let fetch;
  let plugin;

  beforeEach(() => {
    fetch = stubFetch(() => assert.fail('no elevation lookup expected'));
  });

  afterEach(() => {
    if (plugin) plugin.stop();
    plugin = null;
    fetch.restore();
  });

  function start(options, app = createApp()) {
    plugin = pluginFactory(app);
    plugin.start(options, () => {});
    return app;
  }

  it('has required interface', () => {
    const p = pluginFactory(createApp());
    assert.equal(typeof p.start, 'function');
    assert.equal(typeof p.stop, 'function');
    assert.equal(p.id, 'signalk-fixedstation');
    assert.ok(p.name);
    assert.ok(p.description);
    assert.ok(p.schema);
  });

  it('exposes a configuration schema for position, elevation and the elevation provider', () => {
    const { properties, required } = pluginFactory(createApp()).schema;

    assert.equal(required, undefined);
    assert.deepEqual(Object.keys(properties).sort(), [
      'apikey', 'dynamic', 'elevation', 'elevationProvider', 'latitude', 'longitude',
    ]);
    assert.equal(properties.latitude.type, 'number');
    assert.equal(properties.longitude.type, 'number');
    assert.equal(properties.elevation.type, 'number');
    assert.equal(properties.dynamic.default, false);
    assert.deepEqual(properties.elevationProvider.enum, ['open-meteo', 'google', 'none']);
    assert.equal(properties.elevationProvider.enumNames.length, 3);
    assert.equal(properties.elevationProvider.default, 'open-meteo');
    assert.equal(properties.apikey.type, 'string');
  });

  it('publishes the configured position, elevation and meta and shows them on the status', () => {
    const app = start({ latitude: 52.5, longitude: 13.4, elevation: 34.5, elevationProvider: 'open-meteo' });

    assert.deepEqual(app.errors, []);
    assert.ok(app.deltas.every((d) => d.id === 'signalk-fixedstation'));
    assert.deepEqual(latest(app, POSITION).value, { latitude: 52.5, longitude: 13.4, altitude: 34.5 });
    assert.equal(latest(app, ALTITUDE).value, 34.5);
    assert.deepEqual(meta(app), [
      { path: ALTITUDE, value: { units: 'm', description: 'Altitude above sea level' } },
    ]);
    assert.equal(app.statuses.at(-1), 'Position 52.5000° N, 13.4000° E (configured) · elevation 34.5 m (configured)');
    assert.equal(fetch.requests.length, 0);
  });

  it('publishes a position without altitude when no elevation is configured and the provider is none', () => {
    const app = start({ latitude: -33.86, longitude: -151.21, elevationProvider: 'none' });

    assert.deepEqual(values(app), [{ path: POSITION, value: { latitude: -33.86, longitude: -151.21 } }]);
    assert.deepEqual(meta(app), []);
    assert.equal(app.statuses.at(-1), 'Position 33.8600° S, 151.2100° W (configured)');
  });

  it('accepts a position on the equator and the prime meridian', () => {
    const app = start({ latitude: 0, longitude: 0, elevation: 0, elevationProvider: 'none' });

    assert.deepEqual(latest(app, POSITION).value, { latitude: 0, longitude: 0, altitude: 0 });
    assert.equal(latest(app, ALTITUDE).value, 0);
  });

  it('publishes nothing when neither position nor elevation is configured', () => {
    const app = start({ elevationProvider: 'open-meteo' });

    assert.deepEqual(values(app), []);
    assert.deepEqual(meta(app), []);
    assert.deepEqual(app.errors, []);
    assert.equal(app.statuses.at(-1), 'No position configured');
  });

  it('publishes only the elevation when no position is configured', () => {
    const app = start({ elevation: 12, elevationProvider: 'open-meteo' });

    assert.deepEqual(values(app), [{ path: ALTITUDE, value: 12 }]);
    assert.equal(meta(app).length, 1);
    assert.deepEqual(app.errors, []);
  });

  it('looks up the elevation of a configured position without elevation from Open-Meteo', async () => {
    fetch.restore();
    fetch = stubFetch(() => ({ body: { elevation: [38.0] } }));
    const app = start({ latitude: 52.52, longitude: 13.41, elevationProvider: 'open-meteo' });

    // the position is published right away, the elevation once it is known
    assert.deepEqual(values(app)[0], { path: POSITION, value: { latitude: 52.52, longitude: 13.41 } });
    await waitFor(() => latest(app, ALTITUDE), 'the elevation');

    const [request] = fetch.requests;
    assert.equal(request.origin, 'https://api.open-meteo.com');
    assert.equal(request.pathname, '/v1/elevation');
    assert.equal(request.searchParams.get('latitude'), '52.52');
    assert.equal(request.searchParams.get('longitude'), '13.41');
    assert.equal(request.searchParams.has('apikey'), false);
    assert.deepEqual(latest(app, POSITION).value, { latitude: 52.52, longitude: 13.41, altitude: 38 });
    assert.equal(app.statuses.at(-1), 'Position 52.5200° N, 13.4100° E (configured) · elevation 38 m (Open-Meteo)');
  });

  it('keeps the looked up elevation for the next start instead of looking it up again', async () => {
    fetch.restore();
    fetch = stubFetch(() => ({ body: { elevation: [38.0] } }));
    const options = { latitude: 52.52, longitude: 13.41, elevationProvider: 'open-meteo' };
    const app = start(options);
    await waitFor(() => latest(app, ALTITUDE), 'the elevation');
    plugin.stop();

    const restarted = start(options, createApp({ dataDir: app.dataDir }));
    await sleep(50);

    assert.equal(fetch.requests.length, 1);
    assert.equal(latest(restarted, ALTITUDE).value, 38);
    assert.equal(restarted.statuses.at(-1), 'Position 52.5200° N, 13.4100° E (configured) · elevation 38 m (Open-Meteo, cached)');
  });

  it('saves the elevation provider of a configuration without one, Google if it has an API key', () => {
    const withKey = start({ latitude: 1, longitude: 2, elevation: 3, apikey: 'key' });
    assert.deepEqual(withKey.savedOptions, [{ latitude: 1, longitude: 2, elevation: 3, apikey: 'key', elevationProvider: 'google' }]);
    plugin.stop();

    const withoutKey = start({ latitude: 1, longitude: 2, elevation: 3 });
    assert.equal(withoutKey.savedOptions[0].elevationProvider, 'open-meteo');
    plugin.stop();

    const saved = start({ latitude: 1, longitude: 2, elevation: 3, elevationProvider: 'none' });
    assert.deepEqual(saved.savedOptions, []);
  });

  it('starts and stops without error', () => {
    const app = start({ latitude: 52.5, longitude: 13.4, elevation: 34.5, elevationProvider: 'none' });
    const published = app.deltas.length;

    plugin.stop();
    plugin.stop();

    assert.equal(app.deltas.length, published);
    assert.deepEqual(app.errors, []);
  });
});

describe('configuration', () => {
  it('keeps Google for configurations with an API key and no provider', () => {
    assert.equal(station.normalize({ apikey: ' key ' }).provider, 'google');
    assert.equal(station.normalize({ apikey: ' key ' }).apikey, 'key');
    assert.equal(station.normalize({}).provider, 'open-meteo');
    assert.equal(station.normalize({ apikey: 'key', elevationProvider: 'open-meteo' }).provider, 'open-meteo');
    assert.equal(station.normalize({ elevationProvider: 'unknown' }).provider, 'open-meteo');
  });

  it('accepts numbers given as text and ignores empty values', () => {
    const config = station.normalize({ latitude: '52.5', longitude: '', elevation: 'abc' });
    assert.equal(config.latitude, 52.5);
    assert.equal(config.longitude, undefined);
    assert.equal(config.elevation, undefined);
    assert.equal(config.dynamic, false);
  });
});
