import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const moduleSource = await readFile('shared/geonames.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(moduleSource, context, { filename: 'shared/geonames.js' });

const GeoNames = context.window.GeoNames;
assert.equal(typeof GeoNames.loadPlaces, 'function');
assert.equal(GeoNames.normalizeSearch('São Paulo'), 'sao paulo');
assert.equal(GeoNames.labelForParts('Panjim', 'Panjim', 'Goa'), 'Panjim, Goa');

const sampleRows = GeoNames.parseTSV(`geonameid\tname\tascii\tlat\tlng\tadmin1\tadminName\tpopulation\televation\ttimezone\tfeature
1259429\tPune\tPune\t18.51957\t73.85535\t16\tMaharashtra\t3124458\t560\tAsia/Kolkata\tPPLA2
1271157\tGoa Velha\tGoa Velha\t15.44384\t73.88572\t33\tGoa\t0\t9\tAsia/Kolkata\tPPL`);

const allPlaces = GeoNames.normalizeRows(sampleRows.map(row => row.slice()));
assert.equal(allPlaces.length, 2);
assert.equal(allPlaces[0].id, 'geonames-1259429');
assert.equal(allPlaces[0].placeLabel, 'Pune, Maharashtra');
assert.equal(allPlaces[0].elevation, 560);
assert.equal(allPlaces[0].timezone, 'Asia/Kolkata');
assert.match(allPlaces[0].searchText, /pune/);
assert.ok(!('country' in allPlaces[0]));
assert.ok(!('countryName' in allPlaces[0]));
assert.ok(!('iso2' in allPlaces[0]));

const populatedPlaces = GeoNames.normalizeRows(sampleRows.map(row => row.slice()), { requirePopulation: true });
assert.equal(populatedPlaces.length, 1);
assert.equal(populatedPlaces[0].cityAscii, 'Pune');

const unsortedPlaces = GeoNames.normalizeRows(sampleRows.map(row => row.slice()), { sortByPopulation: false });
assert.equal(unsortedPlaces[0].cityAscii, 'Pune');
assert.equal(GeoNames.labelForPlace({ city: 'Victoria', adminName: 'British Columbia' }), 'Victoria, British Columbia');

const csvRows = GeoNames.parseCSV('city,city_ascii,lat,lng,admin_name,population\n"Quote, City",Quote City,1,2,Region,500');
const csvPlaces = GeoNames.normalizeRows(csvRows);
assert.equal(csvPlaces.length, 1);
assert.equal(csvPlaces[0].city, 'Quote, City');
assert.ok(!('iso2' in csvPlaces[0]));

const datasetText = await readFile('shared/assets/data/geonames-cities500.tsv', 'utf8');
const datasetHeader = datasetText.split(/\r?\n/, 1)[0].split('\t');
assert.ok(!datasetHeader.includes('country'));
assert.ok(!datasetHeader.includes('countryName'));
const datasetRows = GeoNames.parseTSV(datasetText);
const datasetPlaces = GeoNames.normalizeRows(datasetRows.map(row => row.slice()), { includeSearchText: false });
const populatedDatasetPlaces = GeoNames.normalizeRows(datasetRows.map(row => row.slice()), {
  includeSearchText: false,
  requirePopulation: true,
});

assert.equal(datasetPlaces.length, 233259);
assert.equal(populatedDatasetPlaces.length, 202466);
assert.ok(populatedDatasetPlaces[0].pop > 20000000);

console.log('GeoNames shared module tests passed.');
