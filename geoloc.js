'use strict'
/*
    Position from the public IP address.
    - public IP: `public-ip` (DNS OpenDNS / Google, HTTPS fallback icanhazip / ipify)
    - location: MaxMind GeoLite data bundled with `geoip-lite`, looked up locally - no online geolocation service.
      geoip-lite reads its data files into memory when required, hence it is loaded only when a position is determined.
*/

let geoip = null

// @returns {Promise<string>} public IP address, rejects if it cannot be determined (eg. no internet)
async function getIP(version = 'v4') {
    const { publicIpv4, publicIpv6 } = await import('public-ip')
    if (version === 'v6')
        return publicIpv6({ fallbackUrls: ['https://ifconfig.co/ip'] })
    return publicIpv4()
}

// @returns {{ ll: [number, number] } | null} geoip-lite record of the IP address
function getGeo(ip) {
    if (!geoip)
        geoip = require('geoip-lite')
    return geoip.lookup(ip)
}

module.exports = {
    getIP,
    getGeo
}
