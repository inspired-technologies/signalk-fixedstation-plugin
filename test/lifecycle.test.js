'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GEOLOC = require.resolve('../geoloc');

// Stands in for geoloc.js so the whole plugin lifecycle can be verified without
// the public-ip services or the GeoLite data; elevation requests go to a stubbed fetch.
const geoloc = {
  ip: '203.0.113.7',
  ll: [52.52, 13.405],
  failures: 0,      // number of getIP calls that fail before one succeeds
  delay: 0,         // ms until getIP answers
  calls: { getIP: 0, getGeo: [] },
  getIP: async () => {
    geoloc.calls.getIP += 1;
    if (geoloc.delay) await new Promise((resolve) => setTimeout(resolve, geoloc.delay));
    if (geoloc.failures > 0) {
      geoloc.failures -= 1;
      throw new Error('Could not get the public IP address');
    }
    return geoloc.ip;
  },
  getGeo: (ip) => {
    geoloc.calls.getGeo.push(ip);
    return ip === geoloc.ip ? { ll: geoloc.ll } : null;
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
const station = require('../fixedstation');
const { createApp, values, latest, waitFor, sleep, stubFetch } = require('./helpers/signalk-app');

const POSITION = 'navigation.position';
const ALTITUDE = 'navigation.gnss.antennaAltitude';

describe('plugin lifecycle', () => {
  let fetch;
  let plugin;
  const retryFirst = station.timing.retryFirst;

  before(() => {
    station.timing.retryFirst = 0.05;
    station.timing.republishMin = 0.01;
  });

  beforeEach(() => {
    Object.assign(geoloc, { failures: 0, delay: 0, ll: [52.52, 13.405], calls: { getIP: 0, getGeo: [] } });
    fetch = stubFetch(() => ({ body: { elevation: [34.567891] } }));
  });

  afterEach(() => {
    if (plugin) plugin.stop();
    plugin = null;
    fetch.restore();
    station.timing.retryFirst = 0.05;
    station.timing.republishMin = 0.01;
  });

  after(() => {
    station.timing.retryFirst = retryFirst;
    station.timing.republishMin = 1;
  });

  function start(options, app = createApp()) {
    plugin = pluginFactory(app);
    plugin.start(options, () => {});
    return app;
  }

  it('determines the position from the public IP address and looks up its elevation', async () => {
    const app = start({ dynamic: true, elevationProvider: 'open-meteo' });

    assert.equal(app.statuses.at(-1), 'Position from the public IP address pending');
    await waitFor(() => latest(app, ALTITUDE), 'the elevation');

    assert.deepEqual(geoloc.calls.getGeo, [geoloc.ip]);
    assert.equal(fetch.requests.length, 1);
    assert.equal(fetch.requests[0].searchParams.get('latitude'), '52.52');
    // the looked up elevation is published rounded to millimetres
    assert.equal(latest(app, ALTITUDE).value, 34.568);
    assert.deepEqual(latest(app, POSITION).value, { latitude: 52.52, longitude: 13.405, altitude: 34.568 });
    assert.equal(app.statuses.at(-1), 'Position 52.5200° N, 13.4050° E (public IP) · elevation 34.6 m (Open-Meteo)');
    assert.deepEqual(app.errors, []);

    const cache = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'station.json'), 'utf8'));
    assert.deepEqual(cache.position, { latitude: 52.52, longitude: 13.405 });
    assert.equal(cache.elevation.value, 34.568);
    assert.equal(cache.elevation.provider, 'open-meteo');
    // the IP address is not stored
    assert.doesNotMatch(JSON.stringify(cache), /203\.0\.113\.7/);
  });

  it('keeps a configured elevation while the position is determined', async () => {
    const app = start({ dynamic: true, elevation: 5, elevationProvider: 'open-meteo' });

    // the elevation is published right away
    assert.deepEqual(values(app), [{ path: ALTITUDE, value: 5 }]);
    await waitFor(() => latest(app, POSITION), 'the position');

    assert.deepEqual(latest(app, POSITION).value, { latitude: 52.52, longitude: 13.405, altitude: 5 });
    await sleep(50);
    assert.equal(fetch.requests.length, 0);
  });

  it('publishes the last determined position at start and retries a failed lookup', async () => {
    const first = start({ dynamic: true, elevationProvider: 'open-meteo' });
    await waitFor(() => latest(first, ALTITUDE), 'the elevation');
    plugin.stop();

    geoloc.failures = 2;
    const app = start({ dynamic: true, elevationProvider: 'open-meteo' }, createApp({ dataDir: first.dataDir }));

    // cached values right away, before the lookup
    assert.deepEqual(latest(app, POSITION).value, { latitude: 52.52, longitude: 13.405, altitude: 34.568 });
    assert.equal(app.statuses[0], 'Position 52.5200° N, 13.4050° E (public IP, cached) · elevation 34.6 m (Open-Meteo, cached)');

    await waitFor(() => app.statuses.includes(''), 'the recovery');
    assert.equal(geoloc.calls.getIP, 4);
    // reported once per outage, the retries show on the status
    assert.deepEqual(app.errors, ['Position not determined from the public IP address (Could not get the public IP address)']);
    assert.ok(app.statuses.some((s) => / · position lookup again in \d+s$/.test(s)));
    assert.equal(app.statuses.at(-1), 'Position 52.5200° N, 13.4050° E (public IP) · elevation 34.6 m (Open-Meteo, cached)');
    // same position - the cached elevation is kept, no new lookup
    assert.equal(fetch.requests.length, 1);
  });

  it('looks up the elevation again once the position moved', async () => {
    const first = start({ dynamic: true, elevationProvider: 'open-meteo' });
    await waitFor(() => latest(first, ALTITUDE), 'the elevation');
    plugin.stop();

    geoloc.ll = [48.85, 2.35];
    fetch.restore();
    fetch = stubFetch(() => ({ body: { elevation: [35] } }));
    const app = start({ dynamic: true, elevationProvider: 'open-meteo' }, createApp({ dataDir: first.dataDir }));
    await waitFor(() => latest(app, ALTITUDE) && latest(app, ALTITUDE).value === 35, 'the new elevation');

    // the elevation of the previous position is not carried along with the new one
    const positions = values(app).filter((v) => v.path === POSITION).map((v) => v.value);
    assert.deepEqual(positions.at(-1), { latitude: 48.85, longitude: 2.35, altitude: 35 });
    assert.ok(positions.every((p) => p.latitude !== 48.85 || p.altitude === undefined || p.altitude === 35));
  });

  it('uses the customer API of Open-Meteo with an API key', async () => {
    const app = start({ latitude: 1, longitude: 2, elevationProvider: 'open-meteo', apikey: 'commercial-key' });
    await waitFor(() => latest(app, ALTITUDE), 'the elevation');

    assert.equal(fetch.requests[0].origin, 'https://customer-api.open-meteo.com');
    assert.equal(fetch.requests[0].searchParams.get('apikey'), 'commercial-key');
  });

  it('looks up the elevation from Google with its API key', async () => {
    fetch.restore();
    fetch = stubFetch(() => ({ body: { status: 'OK', results: [{ elevation: 12.3456 }] } }));
    const app = start({ latitude: 1, longitude: 2, elevationProvider: 'google', apikey: 'google-key' });
    await waitFor(() => latest(app, ALTITUDE), 'the elevation');

    assert.equal(fetch.requests[0].origin, 'https://maps.googleapis.com');
    assert.equal(fetch.requests[0].searchParams.get('locations'), '1,2');
    assert.equal(fetch.requests[0].searchParams.get('key'), 'google-key');
    assert.equal(latest(app, ALTITUDE).value, 12.346);
    assert.match(app.statuses.at(-1), /elevation 12.3 m \(Google\)$/);
  });

  it('reports a missing Google API key once, without request and retry', async () => {
    const app = start({ latitude: 1, longitude: 2, elevationProvider: 'google' });
    await sleep(200);

    assert.equal(fetch.requests.length, 0);
    assert.deepEqual(app.errors, ['Elevation not determined (Google requires an API key)']);
    assert.equal(latest(app, ALTITUDE), undefined);
  });

  it('reports a rejected request without the API key and retries it', async () => {
    fetch.restore();
    fetch = stubFetch((url, n) => (n === 1
      ? { status: 200, body: { status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' } }
      : { body: { status: 'OK', results: [{ elevation: 7 }] } }));
    const app = start({ latitude: 1, longitude: 2, elevationProvider: 'google', apikey: 'secret-key' });
    await waitFor(() => latest(app, ALTITUDE), 'the retried elevation');

    assert.deepEqual(app.errors, ['Elevation not determined (Google: REQUEST_DENIED - The provided API key is invalid.)']);
    assert.ok(app.errors.every((e) => !e.includes('secret-key')));
    assert.equal(fetch.requests.length, 2);
  });

  it('reports network errors without crashing', async () => {
    fetch.restore();
    fetch = stubFetch(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
    const app = start({ latitude: 1, longitude: 2, elevationProvider: 'open-meteo' });
    await waitFor(() => app.errors.length > 0, 'the error');

    assert.deepEqual(app.errors, ['Elevation not determined (Open-Meteo: ENOTFOUND)']);
    assert.match(app.statuses.at(-1), / · elevation lookup again in \d+s$/);
  });

  it('publishes nothing after stop while a lookup is pending', async () => {
    geoloc.delay = 100;
    const app = start({ dynamic: true, elevationProvider: 'open-meteo' });
    plugin.stop();
    await sleep(250);

    assert.deepEqual(values(app), []);
    assert.equal(fetch.requests.length, 0);
    assert.deepEqual(app.errors, []);
  });

  it('stops retrying on stop', async () => {
    station.timing.retryFirst = 0.1;
    geoloc.failures = 100;
    const app = start({ dynamic: true, elevationProvider: 'open-meteo' });
    await waitFor(() => app.errors.length > 0, 'the error');
    plugin.stop();
    const calls = geoloc.calls.getIP;
    await sleep(300);

    assert.equal(geoloc.calls.getIP, calls);
  });

  it('re-publishes before the meta timeout of the position expires', async () => {
    const app = createApp();
    app.selfPaths[POSITION] = { value: {}, meta: { timeout: 0.1 } };
    start({ latitude: 1, longitude: 2, elevation: 3, elevationProvider: 'none' }, app);
    await sleep(230);

    const published = values(app).filter((v) => v.path === POSITION).length;
    assert.ok(published >= 3, `published ${published} times`);
  });

  it('publishes only once without meta timeout', async () => {
    const app = start({ latitude: 1, longitude: 2, elevation: 3, elevationProvider: 'none' });
    await sleep(150);

    assert.equal(values(app).filter((v) => v.path === POSITION).length, 1);
  });
});
