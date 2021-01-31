# signalk-fixedstation-plugin
SignalK Plugin to inject fixed station data in absence of GPS input (eg. for weather-station or marina use)
# Install & Use
Note: This plugin can be used to calculate elevation via '@googlemaps/google-maps-services-js', but requires a google API subscription - hence, the feature is deactivated by design.<br><br>
Install the plugin through the SignalK plugin interface. After installation you can either enter the fixed position / elevation or you may want to 'Activate' automatic updates through the SignalK Plugin Config interface - nearest position will be determined based on public IP assgined to the SignalK server.<br>
<br>
The plugin will output 2 new SignalK-values:<br>
<br>
'navigation.position'<br>
'navigation.gnss.antennaAltitude'<br>
<br>
