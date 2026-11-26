# signalk-fixedstation-plugin

SignalK plugin to inject fixed station data in absence of GPS input (e.g. for weather-station or marina use).

## Install & Use

Install the plugin through the SignalK plugin interface and configure it in the *Plugin Config*:

- **Position** - enter latitude / longitude, or *Determine the position from the public IP address* at every
  start. The location of the public IP address is looked up locally in the GeoLite data bundled with
  [`geoip-lite`](https://www.npmjs.com/package/geoip-lite) (city level); only the public IP address itself is
  determined online ([`public-ip`](https://www.npmjs.com/package/public-ip): DNS queries to OpenDNS / Google,
  HTTPS fallback icanhazip / ipify). No online geolocation service learns the position.
- **Elevation** - enter it, or leave it empty to look it up for the position from the elevation provider:
  - *Open-Meteo* (default): [Elevation API](https://open-meteo.com/en/docs/elevation-api), free for non-commercial
    use without API key. With an API key the customer API is used (commercial use, see
    [pricing](https://open-meteo.com/en/pricing)). Returns 0 over sea.
  - *Google Maps*: [Elevation API](https://developers.google.com/maps/documentation/elevation), requires an API key.
  - *None*: no elevation lookup.

  There is one API key field - change the key together with the provider. Configurations from before 0.8.0
  with a Google API key keep Google as provider.

The plugin publishes

- `navigation.position` (latitude, longitude and - once known - altitude)
- `navigation.gnss.antennaAltitude` (m above sea level)

The determined position and elevation are shown on the plugin status, eg.
`Position 52.5200° N, 13.4050° E (public IP) · elevation 38 m (Open-Meteo)`. Determined values are kept in the
plugin data directory and published right away at the next start - also without internet; failed lookups are
reported as plugin error and retried after 1 minute, doubling up to 1 hour.

The values are published at start and when they change. If a `timeout` is set in the meta data of the paths
(eg. in the *Data Browser* of the server), they are re-published at half of the timeout, so that they don't expire.

### Data sources

- Elevation data from [Open-Meteo.com](https://open-meteo.com/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  based on the Copernicus DEM GLO-90 ([doi:10.5270/ESA-c5d3d65](https://doi.org/10.5270/ESA-c5d3d65)) of the
  European Union's Copernicus programme.
- This product includes GeoLite data created by MaxMind, available from [maxmind.com](https://www.maxmind.com).

## Development

The plugin ships with baseline and lifecycle tests based on the built-in
[`node:test`](https://nodejs.org/api/test.html) runner — no services or network access required:

```sh
npm install
npm test
```

- [`test/baseline.test.js`](./test/baseline.test.js) verifies the plugin interface, the configuration
  schema, the migration of the elevation provider and the deltas published for a configured position and elevation.
- [`test/lifecycle.test.js`](./test/lifecycle.test.js) runs the dynamic lifecycle — start, IP based position
  lookup, elevation lookup from Open-Meteo / Google, cached values, retries, meta timeout, stop — against a
  stubbed geolocation module and a stubbed `fetch`.

***

## Release Notes
See [Changelog](CHANGELOG.md).
