const geoip = require('geoip-lite')

let maps_api_key

function init(config)
{
    maps_api_key = config.apikey
}

async function getIP(version)
{  
    let result
    if (!version || version==='v4')
    {
        const { publicIpv4 } = await import('public-ip')
        await publicIpv4()
        .then((res) => {
            result = res
        })
    }
    else if (version==='v6')
    {
        const { publicIpv6 } = await import('public-ip')
        await publicIpv6({
            fallbackUrls: [
                'https://ifconfig.co/ip'
            ]
        }).then((res) => {
            result = res
        })    
    }
    else
        return undefined
    return result
}

function getGeo(ip)
{
    return geoip.lookup(ip)
}

function getElevation (lat, lon) {

    const { Client } = require("@googlemaps/google-maps-services-js");
    const client = new Client({});

    client
    .elevation({
        params: {
            locations: [{ lat: lat, lng: lon }],
            key: config.google.maps.key,
        },
        timeout: 1000, // milliseconds
    })
    .then((r) => {
        return r.data.results[0].elevation;
    })
    .catch((e) => {
        return e.response.data.error_message;
    });
}

async function callElevation (lat, lon, callback) {

    const { Client } = require("@googlemaps/google-maps-services-js");
    const client = new Client({});

    client
    .elevation({
        params: {
            locations: [{ lat: lat, lng: lon }],
            key: maps_api_key,
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

module.exports = { 
    init,
    getIP,
    getGeo,
    getElevation,
    callElevation
};