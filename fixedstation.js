const geoloc = require('./geoloc');

const navigationPosition = 'navigation.position';
const navigationElevation = 'navigation.gnss.antennaAltitude';
let deltahandler = null;
let log = null;

const latest = {
    position: {
        time: null,
        lat: null,
        lon: null
    },
    altitude: {
        time: null,
        elevation: null
    }
}

function onPositionUpdated(lat, lon) {
    latest.position.time = Date.now();
    latest.position.lat = lat;
    latest.position.lon = lon;

    if (lat && typeof lat==="number" && lon && typeof lon==="number")
    {
        let update = []
        update.push(buildDelta(navigationPosition, formatPosition()))
        deltahandler(update);    
    }
}

function onAltitudeUpdated(elevation) {
    latest.altitude.time = Date.now();
    latest.altitude.elevation = elevation;

    if (elevation && typeof elevation==="number")
    {
        let update = []
        update.push(buildDelta(navigationElevation, formatAltitude()))
        deltahandler(update);    
    }
}

function buildDelta(path, value) {
    return {
        path: path,
        value: value
    }
}

function prepareFixed() {
    let update = []
    let meta = []
    if (latest.position.lat!==null && latest.position.lon!==null)
        update.push(buildDelta(navigationPosition, formatPosition()))    
    if (latest.altitude.elevation!==null) {
        update.push(buildDelta(navigationElevation, formatAltitude()))
        meta.push(buildDelta(navigationElevation, { "units": "m", "description": "Altitude above sealevel", "pgn":129029 } ))
    }
    return { "update": update, "meta": meta }
}

function prepareMeta(alt) {
    let update = []
    let meta = []
    update.push(buildDelta(navigationElevation, alt && typeof alt==="number" ? alt : 0 ))
    meta.push(buildDelta(navigationElevation, { "units": "m", "description": "Altitude above sealevel", "pgn":129029 } ))
    return { "update": update, "meta": meta }
}

async function prepareDynamic (callback) {
    await geoloc.getIP('v4')
    .then (ip => {
        let geo = geoloc.getGeo(ip)
        if (ip && geo) {
            log(`Fixed Position determined [${geo.ll[0]},${geo.ll[1]}]`)
            onPositionUpdated(geo.ll[0], geo.ll[1])

        } else {
            log(`Failed to determine position via external IP [${ip}].`)
        }
    })
    .finally(() => {
        geoloc.callElevation(latest.position.lat, latest.position.lon, (e) => {
            if (e && typeof e==='number')
            {
                log(`Elevation determined for [${latest.position.lat},${latest.position.lon}] to ${e}m`)
                onAltitudeUpdated(Math.round(e*1000)/1000)
            } else {
                log(`Failed to determin elevation: ${e}`)
            }

        })                
    })
}

function formatPosition()
{
    let value = {
        "latitude": latest.position.lat,
        "longitude": latest.position.lon,
    } 
    if (latest.altitude.elevation!==null)
        value.altitude = latest.altitude.elevation

    return value;
}

function formatAltitude()
{
    return latest.altitude.elevation;
}

module.exports = {

    // initialize
    init: function(config, loghandler, messagehandler) {
        geoloc.init(config)
        log = loghandler
        deltahandler = messagehandler
    },

    // clear all data
    clearAll: function () {
        latest.position.lat = null;
        latest.position.lon = null;
        latest.altitude.elevation = null;
    },
    
    // @param {bool} value calculate from external IP.
    // @returns {Array<[{path:path, value:value}]>} Delta JSON-array of updates
    onLoad: function(lat, lon, elev, calc) {
        if (calc) // throw new Error("Cannot add null value");
        {
            prepareDynamic();
            return prepareMeta(elev);
        }
        else
        {
            onPositionUpdated(lat, lon);
            onAltitudeUpdated(elev);
            return prepareFixed();
        }
    }
}