'use strict'
const log = require('debug')('signalk-fixedstation')
const station = require('./fixedstation')

module.exports = function (app) {
    let current = null

    const plugin = {
        id: 'signalk-fixedstation',
        name: 'Fixed Station',
        description: 'Provide fixed navigation data (position, altitude)',
    }

    plugin.start = function (options) {
        if (current) current.stop()
        const config = station.normalize(options)
        // configurations before 0.8.0 have no provider - keep Google for those with an API key and save
        // the provider, so that the configuration form shows it instead of the default
        if (!options || options.elevationProvider === undefined) {
            app.savePluginOptions({ ...(options || {}), elevationProvider: config.provider }, (err) => {
                if (err) log(`Elevation provider not saved to the configuration (${err.message || err})`)
                else log(`Elevation provider '${config.provider}' saved to the configuration`)
            })
        }
        current = station.create(app, plugin.id, config, log)
        current.start()
    }

    plugin.stop = function () {
        if (current) current.stop()
        current = null
        log('Stopped')
    }

    plugin.schema = {
        type: 'object',
        title: 'Fixed Station',
        description: 'Publishes navigation.position and navigation.gnss.antennaAltitude of a fixed station (weather station, marina) in absence of a GPS - the determined position and elevation are shown on the plugin status.',
        properties: {
            latitude: {
                type: 'number',
                title: 'Latitude',
                description: 'Decimal degrees (WGS84), negative south - published on navigation.position',
            },
            longitude: {
                type: 'number',
                title: 'Longitude',
                description: 'Decimal degrees (WGS84), negative west - published on navigation.position',
            },
            dynamic: {
                type: 'boolean',
                title: 'Determine the position from the public IP address',
                description: 'At every start, instead of latitude / longitude - looked up locally (GeoLite data, city level), the last determined position is published while the lookup is pending or without internet',
                default: false,
            },
            elevation: {
                type: 'number',
                title: 'Elevation (m)',
                description: 'Above sea level - published on navigation.gnss.antennaAltitude and as altitude of navigation.position; leave empty to look it up from the elevation provider',
            },
            elevationProvider: {
                type: 'string',
                title: 'Elevation provider',
                description: 'Looks up the elevation of the position if none is entered',
                enum: ['open-meteo', 'google', 'none'],
                enumNames: ['Open-Meteo (free for non-commercial use)', 'Google Maps (API key required)', 'None'],
                default: 'open-meteo',
            },
            apikey: {
                type: 'string',
                title: 'API key of the elevation provider',
                description: 'Google Maps: required. Open-Meteo: optional, only for commercial use (customer API, https://open-meteo.com/en/pricing). Change the key together with the provider.',
            },
        },
    }

    return plugin
}
