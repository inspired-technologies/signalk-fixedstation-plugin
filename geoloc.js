var geoip = require('fast-geoip');

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
}

function onAltitudeUpdated(elevation) {
    latest.altitude.time = Date.now();
    latest.altitude.elevation = elevation;
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

function getpublicip (callback) {
    
    require('external-ip')()(function(err, ip) {
        if (!err) {
            log("Identified IP "+ip)
            callback(ip);
        } else {
            log("Cannot get IP: "+err)
            callback(err);
        }
    })
}

function getprettyip(ip) {
    // return geoip.pretty(ip);
    return ip;        
}

async function getgeodata(ip) {
    return await geoip.lookup(ip);
}

async function preparePosition(ip) {
    let update = []
    if (ip!==null)
    {
        var geo = await getgeodata(ip)
        log("Geo data: "+geo.ll)
    }
    else
    {
        geo = null;
        log("No geo data")
    }
    if (extractPosition(geo))
        update.push(buildDelta(navigationPosition, formatPosition()))
    deltahandler(update);
}

function formatPosition()
{
    let value = {
        "latitude":latest.position.lat,
        "longitude":latest.position.lon,
    }
    if (latest.altitude.elevation!==null)
        value.altitude = latest.altitude.elevation

    return value;
}

// not implemented due to require("@googlemaps/google-maps-services-js") not free any more
async function getelevation(lat, lon, fixed, callback) {

    if (true)
        callback(fixed);
    else
    {
        const {Client} = require("@googlemaps/google-maps-services-js");
        const client = new Client({});
    
        client
        .elevation({
            params: {
            locations: [{ lat: lat, lng: lon }],
            key: "provide you own key",
            },
            timeout: 1000, // milliseconds
        })
        .then((r) => {
            callback(r.data.results[0].elevation);
        })
        .catch((e) => {
            callback(e.response.data.error_message);
        });    
    }
}

async function prepareAltitude(mapdata) {
    let update = []
    let meta = []
    if (extractAltitude(mapdata))
    {
        update.push(buildDelta(navigationElevation, formatAltitude()))
        if (latest.position.lat!==null && latest.position.lon!==null)
            update.push(buildDelta(navigationPosition, formatPosition()))
    }
    deltahandler(update);
}

function formatAltitude()
{
    return latest.altitude.elevation;
}

function extractPosition(geodata)
{
    if (geodata!==null)
    {
        onPositionUpdated(geodata.ll[0],geodata.ll[1]);
        return true;
    }
    else if (latest.position.lat!==null && latest.position.lon!==null)
    {
        // use static data
        return true;
    }
    return false;
}

function extractAltitude(elevation)
{
    if (elevation!==null)
    {
        onAltitudeUpdated(elevation);
        return true;
    }
    else if (latest.altitude.elevation!==null)
    {
        // use static data
        return true;
    }
    return false;
}

module.exports = {

    getpublicip,
    getprettyip,
    getgeodata,
    getelevation,

    init: function(loghandler, messagehandler) {
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
            getpublicip(preparePosition);
            getelevation(lat, lon, elev, prepareAltitude);
        }
        else
        {
            onPositionUpdated(lat, lon);
            onAltitudeUpdated(elev);
            return prepareFixed();
        }
    }
}