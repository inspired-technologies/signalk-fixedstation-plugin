# signalk-fixedstation-plugin
SignalK Plugin to inject fixed station data in absence of GPS input (eg. for weather-station or marina use)
# Install & Use
Note: This plugin can be used to calculate elevation via '@googlemaps/google-maps-services-js', but requires a google API subscription - hence, the feature is deactivated by design, but can be activated with a proper api key in the plugin config post install.<br><br>
<p>Install the plugin through the SignalK plugin interface. After installation you can either enter the fixed position / elevation or you may want to 'Activate' automatic updates through the SignalK Plugin Config interface - nearest position will be determined based on public IP assgined to the SignalK server.</p>
<br>
<p>The plugin will output 2 new SignalK-values:<br>
<br>
  <code>'navigation.position'</code><br>
  <code>'navigation.gnss.antennaAltitude'</code><br>
<br></p>
