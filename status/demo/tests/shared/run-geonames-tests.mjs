import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const moduleSource = await readFile('shared/geonames.js', 'utf8');
const context = { window: {} };
vm.runInNewContext(moduleSource, context, { filename: 'shared/geonames.js' });

const GeoNames = context.window.GeoNames;
assert.equal(typeof GeoNames.loadPlaces, 'function');
assert.equal(GeoNames.normalizeSearch('São Paulo'), 'sao paulo');
assert.equal(GeoNames.labelForParts('Panjim', 'Panjim', 'Goa', 'India'), 'Panjim, Goa, India');

const sampleRows = GeoNames.parseTSV(`geonameid\tname\tascii\tlat\tlng\tcountry\tcountryName\tadmin1\tadminName\tpopulation\televation\ttimezone\tfeature
1259429\tPune\tPune\t18.51957\t73.85535\tIN\tIndia\t16\tMaharashtra\t3124458\t560\tAsia/Kolkata\tPPLA2
1271157\tGoa Velha\tGoa Velha\t15.44384\t73.88572\tIN\tIndia\t33\tGoa\t0\t9\tAsia/Kolkata\tPPL`);

const allPlaces = GeoNames.normalizeRows(sampleRows.map(row => row.slice()));
assert.equal(allPlaces.length, 2);
assert.equal(allPlaces[0].id, 'geonames-1259429');
assert.equal(allPlaces[0].placeLabel, 'Pune, Maharashtra, India');
assert.equal(allPlaces[0].elevation, 560);
assert.equal(allPlaces[0].timezone, 'Asia/Kolkata');
assert.match(allPlaces[0].searchText, /pune/);

const populatedPlaces = GeoNames.normalizeRows(sampleRows.map(row => row.slice()), { requirePopulation: true });
assert.equal(populatedPlaces.length, 1);
assert.equal(populatedPlaces[0].cityAscii, 'Pune');

const datasetText = await readFile('shared/assets/data/geonames-cities500.tsv', 'utf8');
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
