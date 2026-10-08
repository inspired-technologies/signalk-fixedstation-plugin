# signalk-fixedstation-plugin

SignalK plugin to inject fixed station data in absence of GPS input (e.g. for weather-station or marina use).

## Install & Use

> **Note:** This plugin can be used to calculate elevation via
> [`@googlemaps/google-maps-services-js`](https://www.npmjs.com/package/@googlemaps/google-maps-services-js),
> but requires a Google API subscription. Hence, the feature is deactivated by design, but can be activated
> with a proper API key in the plugin config post install.

Install the plugin through the SignalK plugin interface. After installation you can either enter the fixed
position / elevation, or you may want to *Activate* automatic updates through the SignalK Plugin Config
interface — the nearest position will be determined based on the public IP assigned to the SignalK server.

The plugin will output 2 new SignalK values:

- `navigation.position`
- `navigation.gnss.antennaAltitude`

## Development

The plugin ships with baseline and lifecycle tests based on the built-in
[`node:test`](https://nodejs.org/api/test.html) runner — no services or network access required:

```sh
npm install
npm test        # or: node --test
```

- [`test/baseline.test.js`](./test/baseline.test.js) verifies the plugin interface, the configuration
  schema and the deltas published for a statically configured position and elevation.
- [`test/lifecycle.test.js`](./test/lifecycle.test.js) runs the full dynamic lifecycle — start, IP based
  position lookup, elevation lookup, stop — against a stubbed geolocation module.
