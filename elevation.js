'use strict'
/*
    Terrain elevation of a position from an online provider.
    - Open-Meteo Elevation API (Copernicus DEM GLO-90, 90 m): free for non-commercial use without API key,
      with an API key the customer API is used (commercial use). Over sea it returns 0.
    - Google Maps Elevation API: requires an API key.
    Errors never contain the request URL - it may carry the API key.
*/

const TIMEOUT = 10000

const PROVIDERS = {
    'open-meteo': {
        name: 'Open-Meteo',
        keyRequired: false,
        url: (lat, lon, apikey) => {
            const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon) })
            if (apikey) params.set('apikey', apikey)
            return `${apikey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com'}/v1/elevation?${params}`
        },
        parse: (status, json) => {
            if (status !== 200 || !json || json.error)
                throw new Error(`HTTP ${status}${json && json.reason ? ' - ' + json.reason : ''}`)
            const value = Array.isArray(json.elevation) ? json.elevation[0] : undefined
            if (typeof value !== 'number' || Number.isNaN(value))
                throw new Error('no elevation in the response')
            return value
        }
    },
    google: {
        name: 'Google',
        keyRequired: true,
        url: (lat, lon, apikey) => {
            const params = new URLSearchParams({ locations: `${lat},${lon}`, key: apikey })
            return `https://maps.googleapis.com/maps/api/elevation/json?${params}`
        },
        parse: (status, json) => {
            if (status !== 200 || !json || json.status !== 'OK')
                throw new Error(`${json && json.status ? json.status : 'HTTP ' + status}${json && json.error_message ? ' - ' + json.error_message : ''}`)
            const value = Array.isArray(json.results) && json.results[0] ? json.results[0].elevation : undefined
            if (typeof value !== 'number' || Number.isNaN(value))
                throw new Error('no elevation in the response')
            return value
        }
    }
}

function providerName(provider) {
    return PROVIDERS[provider] ? PROVIDERS[provider].name : provider
}

// @returns {Promise<number>} elevation in m above sea level
async function lookup(provider, lat, lon, apikey) {
    const p = PROVIDERS[provider]
    if (!p)
        throw new Error(`unknown elevation provider '${provider}'`)
    if (p.keyRequired && !apikey)
        throw new Error(`${p.name} requires an API key`)
    let response
    try {
        response = await fetch(p.url(lat, lon, apikey), { signal: AbortSignal.timeout(TIMEOUT) })
    } catch (err) {
        // network errors and timeouts - the cause carries the reason (eg. ENOTFOUND), never the URL
        const reason = err && err.cause && err.cause.code ? err.cause.code : (err && err.name === 'TimeoutError' ? 'timeout' : 'network error')
        throw new Error(`${p.name}: ${reason}`)
    }
    let json = null
    try { json = await response.json() } catch { /* no JSON body */ }
    try {
        return p.parse(response.status, json)
    } catch (err) {
        throw new Error(`${p.name}: ${err.message}`)
    }
}

module.exports = {
    PROVIDERS,
    providerName,
    lookup
}
