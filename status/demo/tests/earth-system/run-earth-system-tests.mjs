import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  html,
  systemApp,
  sharedApp,
  core,
  geonames,
  cityData,
] = await Promise.all([
  readFile('earth-system/earth_system.html', 'utf8'),
  readFile('earth-system/earth-system-app.js', 'utf8'),
  readFile('shared/earth-health-energy-app.js', 'utf8'),
  readFile('earth-core/earth-core.js', 'utf8'),
  readFile('shared/geonames.js', 'utf8'),
  readFile('shared/assets/data/geonames-cities500.tsv', 'utf8'),
]);

assert.match(html, /<body class="system-host">/);
assert.match(html, /ownsAppButtons:\s*false/);
assert.match(html, /initialMode:\s*'none'/);
assert.match(html, /autoOpenManifestCrew:\s*false/);
assert.match(html, /body\.system-host:not\(\.clock-mode\):not\(\.manifest-mode\):not\(\.energy-mode\) #flyPanel\{display:none!important\}/);
assert.match(html, /earth-core\.js\?v=moonlight-map-10/);
assert.match(html, /earth-health-energy-app\.js\?v=modular-apps-6/);
assert.match(html, /earth-system-app\.js\?v=14/);

assert.match(systemApp, /setMode\('none'\)/);
assert.match(systemApp, /classList\.toggle\('manifest-mode', mode === 'manifest'\)/);
assert.match(systemApp, /classList\.toggle\('energy-mode', mode === 'energy'\)/);
assert.doesNotMatch(systemApp, /earthsystem:cityfly/);

assert.match(sharedApp, /ownsAppButtons:\s*true/);
assert.match(sharedApp, /if \(APP_CONFIG\.ownsAppButtons\)/);
assert.match(sharedApp, /els\.healthBtn\.textContent = healthMode \? 'Hide Manifest' : 'Show Manifest'/);

assert.match(core, /if \(options\.mapTerrain !== true\) return false/);
assert.match(core, /earth-core-map-credit-toggle/);
assert.match(core, />Credits<\/button>/);
assert.match(core, /attributionControl:\s*false/);

assert.match(geonames, /function labelForParts\(city, cityAscii, adminName\)/);
assert.doesNotMatch(geonames, /\biso2\b/);
assert.doesNotMatch(geonames, /\bcountryName\b/);
assert.doesNotMatch(geonames, /\bcountry\b/);

const header = cityData.split(/\r?\n/, 1)[0].split('\t');
assert.deepEqual(header, [
  'geonameid',
  'name',
  'ascii',
  'lat',
  'lng',
  'admin1',
  'adminName',
  'population',
  'elevation',
  'timezone',
  'feature',
]);

console.log('Earth System shell smoke tests passed.');
