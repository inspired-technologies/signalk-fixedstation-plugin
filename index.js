'use strict'
var geoloc = require('./geoloc')

module.exports = function (app) {
    var plugin = {};

    plugin.id = 'signalk-fixedstation';
    plugin.name = 'Fixed Station';
    plugin.description = 'Provide fixed navigation data (position, altitude)';

    var unsubscribes = [ geoloc.clearAll ];

    plugin.start = function (options, restartPlugin) {
        app.debug('Plugin starting ...');
        geoloc.init(log, sendDelta);
        let delta = geoloc.onLoad(options["latitude"], options["longitude"], options["elevation"], options["dynamic"]);
        app.debug('Plugin started.');
        if (delta!==undefined && delta.length>0)
            sendDelta(delta);
    };

    plugin.stop = function () {
        unsubscribes.forEach(f => f());
        unsubscribes = [];
        app.debug('Plugin stopped');
    };

    plugin.schema = {
        // The plugin schema
        type: "object",
        title: "FixedStation Configuration",
        description: "Configure fixed navigation data (position, altitude)",
        required: ['lat', 'lon', 'elevation'],
        properties: {
          latitude: {
            type: 'number',
            title: 'Latitude. Used to export navigation.position',
            default: ''
          },
          longitude: {
            type: 'number',
            title: 'Longitude. Used to export navigation.position',
          },
          dynamic: {
            type: "boolean",
            title: "Overwrite with position from external IP address",
            description: "When enabled the position is dynamically determined at plugin start.",
            default: false
          },
          elevation: {
            type: 'number',
            title: 'Elevation above sea level. Used to export navigation.gnss.antennaAltitude'
          }
        }
    };

    /**
     * 
     * @param {Array<[{path:path, value:value}]>} messages 
     */
    function sendDelta(messages) {
        app.handleMessage('signalk-fixedstation', {
            updates: [
                {
                    values: messages
                }
            ]   
        })
    }

    function log(msg) { app.debug(msg); }

    return plugin;
};