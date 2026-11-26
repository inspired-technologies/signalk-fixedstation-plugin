# Change Log

Releases up to 0.6.0 are not documented here. 0.7.0 was an interim version on `dev` and is part of 0.8.0.

## [0.8.0]

### Feature
- Elevation provider *Open-Meteo* (default, free for non-commercial use without API key, customer API with an API key), *Google Maps* or *None*; one API key field for the selected provider. Configurations from before 0.8.0 with a Google API key keep Google - the provider is saved to their configuration.
- The elevation is also looked up for a configured position without elevation - it was looked up only for the position determined from the public IP address.
- The determined position and elevation are shown on the plugin status, lookup failures as plugin error (once per outage, cleared once the lookup succeeds again).
- Determined position and elevation are kept in the plugin data directory and published right away at the next start, also without internet; the elevation is looked up again only once the position or the provider changed.
- Failed lookups are retried after 1 minute, doubling up to 1 hour - they were tried once per start.
- With a `timeout` in the meta data of `navigation.position` or `navigation.gnss.antennaAltitude` the values are re-published at half of the timeout, so that they don't expire.
- Plugin logo, shown in the App Store of the SignalK server (`signalk.appIcon`).

### Fix
- No public IP address (eg. no internet at boot) no longer causes an unhandled promise rejection, and the elevation is no longer looked up for an empty position.
- A network error or timeout of the elevation lookup no longer crashes the error handling; the Google API is no longer called without API key.
- Lookups still pending on stop or restart no longer publish values of the stopped plugin.
- A position on the equator or the prime meridian (0) is valid.
- Configuration schema: `required` listed field names that don't exist (`lat`, `lon`), the latitude defaulted to an empty text.
- Unset position or elevation values are no longer published - an empty delta on startup is avoided.
- The altitude meta no longer carries a `pgn` (not a meta field).

### Update
- Elevation lookups via `fetch` - `@googlemaps/google-maps-services-js` and axios removed; `geoip-lite` (GeoLite data in memory) is loaded only when the position is determined from the public IP address.
- Logging via the `signalk-fixedstation` debug log.
- Package updates.
- Release to NPM via npm trusted publishing (OIDC) on a push to `main`; the package contents are whitelisted (`files`), tests and repository files are no longer published.
- SignalK Plugin CI and automated tests (`npm test`) - no network access required.
