'use strict'
/*
    Fixed station - publishes a position and elevation in absence of a GPS.
    - position: configured, or determined from the public IP address at every start
    - elevation: configured, or looked up from the elevation provider for the position
    Determined values are cached in the plugin data directory and published right away at the next start
    (no internet at boot), lookups that fail are retried with a growing delay.
*/
const fs = require('fs')
const path = require('path')
const geoloc = require('./geoloc')
const elevation = require('./elevation')

const POSITION = 'navigation.position'
const ALTITUDE = 'navigation.gnss.antennaAltitude'
const CACHE_FILE = 'station.json'
const PROVIDERS = ['open-meteo', 'google', 'none']

// seconds - exported for the tests
const timing = {
    retryFirst: 60,         // first retry of a failed lookup, doubling ...
    retryMax: 3600,         // ... up to one hour
    republishMin: 1,        // shortest re-publish interval for a meta timeout
    republishCheck: 60,     // check for a meta timeout without one
}

function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value)
}

function toNumber(value) {
    if (typeof value === 'string' && value.trim() !== '')
        value = Number(value)
    return isNumber(value) ? value : undefined
}

function isPosition(lat, lon) {
    return isNumber(lat) && isNumber(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

function samePosition(a, b) {
    return !!a && !!b && Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.longitude - b.longitude) < 1e-6
}

function formatPosition(p) {
    const lat = `${Math.abs(p.latitude).toFixed(4)}° ${p.latitude < 0 ? 'S' : 'N'}`
    const lon = `${Math.abs(p.longitude).toFixed(4)}° ${p.longitude < 0 ? 'W' : 'E'}`
    return `${lat}, ${lon}`
}

function formatDelay(seconds) {
    return seconds < 120 ? `${Math.round(seconds)}s` : `${Math.round(seconds / 60)} min`
}

// plugin options → configuration; an unknown provider falls back to Google for configurations with
// an API key (installs before 0.8.0 only knew Google), Open-Meteo otherwise
function normalize(options) {
    const o = options || {}
    const apikey = typeof o.apikey === 'string' ? o.apikey.trim() : ''
    const provider = PROVIDERS.includes(o.elevationProvider) ? o.elevationProvider : (apikey ? 'google' : 'open-meteo')
    return {
        latitude: toNumber(o.latitude),
        longitude: toNumber(o.longitude),
        elevation: toNumber(o.elevation),
        dynamic: o.dynamic === true,
        provider,
        apikey,
    }
}

function create(app, sourceId, config, log) {
    let running = false
    let generation = 0
    const timers = new Set()

    let position = null     // { latitude, longitude, source }
    let altitude = null     // { value, source, latitude?, longitude?, provider? }
    let cache = {}
    let metaSent = false
    const errors = {}       // kind → reported reason
    const retries = {}      // kind → { delay, next }

    const stale = (started) => !running || started !== generation

    function later(started, fn, ms) {
        const id = setTimeout(() => {
            timers.delete(id)
            if (!stale(started)) fn()
        }, ms)
        timers.add(id)
    }

    // cache

    function cacheFile() {
        const dir = typeof app.getDataDirPath === 'function' ? app.getDataDirPath() : null
        return dir ? path.join(dir, CACHE_FILE) : null
    }

    function readCache() {
        const file = cacheFile()
        if (!file) return {}
        try {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'))
            return data && typeof data === 'object' ? data : {}
        } catch (err) {
            if (err.code !== 'ENOENT') log(`Cache ${file} not readable (${err.message}) - ignored`)
            return {}
        }
    }

    function writeCache() {
        const file = cacheFile()
        if (!file) return
        if (position && position.source === 'public IP')
            cache.position = { latitude: position.latitude, longitude: position.longitude }
        if (altitude && altitude.provider)
            cache.elevation = { value: altitude.value, provider: altitude.provider, latitude: altitude.latitude, longitude: altitude.longitude }
        cache.updated = new Date().toISOString()
        try {
            fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache, null, 2))
            fs.renameSync(`${file}.tmp`, file)
        } catch (err) {
            log(`Cache ${file} not written (${err.message})`)
        }
    }

    // SignalK

    function publish() {
        const values = []
        if (position) {
            const value = { latitude: position.latitude, longitude: position.longitude }
            if (altitude) value.altitude = altitude.value
            values.push({ path: POSITION, value })
        }
        if (altitude)
            values.push({ path: ALTITUDE, value: altitude.value })
        if (values.length === 0) return
        app.handleMessage(sourceId, { updates: [{ values }] })
        if (altitude && !metaSent) {
            app.handleMessage(sourceId, { updates: [{ meta: [{ path: ALTITUDE, value: { units: 'm', description: 'Altitude above sea level' } }] }] })
            metaSent = true
        }
    }

    // a meta timeout on the published paths (eg. set in the server's data browser) means the value expires -
    // it is re-published at half of the shortest timeout, no timer without timeout
    function metaTimeout() {
        if (typeof app.getSelfPath !== 'function') return undefined
        const timeouts = [POSITION, ALTITUDE]
            .map(p => app.getSelfPath(p))
            .map(node => node && node.meta ? toNumber(node.meta.timeout) : undefined)
            .filter(t => t > 0)
        return timeouts.length > 0 ? Math.min(...timeouts) : undefined
    }

    function scheduleRepublish(started) {
        // without timeout check again in a minute - a timeout may be configured meanwhile
        const next = () => {
            const timeout = metaTimeout()
            return (timeout ? Math.max(timing.republishMin, timeout / 2) : timing.republishCheck) * 1000
        }
        const check = () => {
            if (metaTimeout()) publish()
            later(started, check, next())
        }
        later(started, check, next())
    }

    // status and errors

    function status() {
        const parts = []
        if (position)
            parts.push(`Position ${formatPosition(position)} (${position.source})`)
        else
            parts.push(config.dynamic ? 'Position from the public IP address pending' : 'No position configured')
        if (altitude)
            parts.push(`elevation ${Math.round(altitude.value * 10) / 10} m (${altitude.source})`)
        else if (position && config.provider !== 'none')
            parts.push(`elevation from ${elevation.providerName(config.provider)} pending`)
        Object.keys(errors).forEach(kind => {
            if (retries[kind] && retries[kind].next)
                parts.push(`${kind} lookup again in ${formatDelay((retries[kind].next - Date.now()) / 1000)}`)
        })
        app.setPluginStatus(parts.join(' · '))
    }

    function fail(started, kind, reason, retry) {
        if (errors[kind] !== reason) {
            log(reason)
            app.setPluginError(reason)
            errors[kind] = reason
        }
        if (retry) {
            const r = retries[kind] || (retries[kind] = { delay: timing.retryFirst })
            r.next = Date.now() + r.delay * 1000
            later(started, retry, r.delay * 1000)
            r.delay = Math.min(r.delay * 2, timing.retryMax)
        }
        status()
    }

    function recovered(kind) {
        delete retries[kind]
        if (!errors[kind]) return
        log(`${kind} lookup succeeded again`)
        delete errors[kind]
        // an empty status removes the reported error from the plugin state
        if (Object.keys(errors).length === 0)
            app.setPluginStatus('')
    }

    // lookups

    function needsElevation() {
        if (!position || isNumber(config.elevation) || config.provider === 'none') return false
        return !(altitude && altitude.provider === config.provider && samePosition(altitude, position))
    }

    async function determinePosition(started) {
        let geo
        try {
            const ip = await geoloc.getIP('v4')
            geo = ip ? geoloc.getGeo(ip) : null
            if (!geo || !Array.isArray(geo.ll) || !isPosition(geo.ll[0], geo.ll[1]))
                throw new Error('no location known for the public IP address')
        } catch (err) {
            if (stale(started)) return
            fail(started, 'position', `Position not determined from the public IP address (${err && err.message ? err.message : err})`,
                () => determinePosition(started))
            return
        }
        if (stale(started)) return
        recovered('position')
        const determined = { latitude: geo.ll[0], longitude: geo.ll[1], source: 'public IP' }
        log(`Position determined from the public IP address: ${formatPosition(determined)}`)
        if (!samePosition(determined, position) && altitude && altitude.source !== 'configured')
            altitude = null
        position = determined
        writeCache()
        publish()
        status()
        if (needsElevation())
            lookupElevation(started)
    }

    async function lookupElevation(started) {
        const at = position
        let value
        try {
            value = await elevation.lookup(config.provider, at.latitude, at.longitude, config.apikey)
        } catch (err) {
            if (stale(started)) return
            // a missing API key does not resolve by itself - no retry
            const permanent = config.provider === 'google' && !config.apikey
            fail(started, 'elevation', `Elevation not determined (${err && err.message ? err.message : err})`,
                permanent ? null : () => { if (needsElevation()) lookupElevation(started) })
            return
        }
        if (stale(started) || !samePosition(at, position)) return
        recovered('elevation')
        altitude = {
            value: Math.round(value * 1000) / 1000,
            source: elevation.providerName(config.provider),
            provider: config.provider,
            latitude: at.latitude,
            longitude: at.longitude,
        }
        log(`Elevation determined for ${formatPosition(at)}: ${altitude.value} m (${altitude.source})`)
        writeCache()
        publish()
        status()
    }

    return {
        start() {
            running = true
            const started = ++generation
            cache = readCache()

            if (!config.dynamic && isPosition(config.latitude, config.longitude))
                position = { latitude: config.latitude, longitude: config.longitude, source: 'configured' }
            else if (config.dynamic && cache.position && isPosition(cache.position.latitude, cache.position.longitude))
                position = { latitude: cache.position.latitude, longitude: cache.position.longitude, source: 'public IP, cached' }

            if (isNumber(config.elevation))
                altitude = { value: config.elevation, source: 'configured' }
            else if (position && config.provider !== 'none' && cache.elevation && cache.elevation.provider === config.provider
                && isNumber(cache.elevation.value) && samePosition(cache.elevation, position))
                altitude = { ...cache.elevation, source: `${elevation.providerName(config.provider)}, cached` }

            log(`Started - position ${position ? formatPosition(position) + ' (' + position.source + ')' : 'none'}, ` +
                `elevation ${altitude ? altitude.value + ' m (' + altitude.source + ')' : 'none'}, ` +
                `${config.dynamic ? 'position from the public IP address, ' : ''}elevation provider ${config.provider}`)
            publish()
            status()
            scheduleRepublish(started)

            if (config.dynamic)
                determinePosition(started)
            else if (needsElevation())
                lookupElevation(started)
        },

        stop() {
            running = false
            generation++
            timers.forEach(clearTimeout)
            timers.clear()
        },
    }
}

module.exports = {
    POSITION,
    ALTITUDE,
    PROVIDERS,
    timing,
    normalize,
    create,
}
