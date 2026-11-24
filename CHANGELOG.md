# Change Log

Releases up to 0.6.0 are not documented here. 0.7.0 was an interim version on `dev` and is part of 0.8.0.

## [0.8.0]

### Fix
- Unset position or elevation values are no longer published - an empty delta on startup is avoided.

### Update
- Package updates.
- Release to NPM via npm trusted publishing (OIDC) on a push to `main`; the package contents are whitelisted (`files`), tests and repository files are no longer published.
- SignalK Plugin CI and automated tests (`npm test`): baseline and lifecycle tests with a stubbed geolocation, no network access required.
