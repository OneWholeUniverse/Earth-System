import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const demoRoot = path.resolve(__dirname, '../..');
const wstcPath = path.join(demoRoot, 'earth-clock-map/world-space-time-coordinates.js');
const estcPath = path.join(demoRoot, 'earth-clock-map/earth-space-time-coordinates.js');
const mstcPath = path.join(demoRoot, 'earth-clock-map/moon-space-time-coordinates.js');
const mastcPath = path.join(demoRoot, 'earth-clock-map/mars-space-time-coordinates.js');

async function loadApis() {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(await readFile(wstcPath, 'utf8'), context, { filename: wstcPath });
  vm.runInContext(await readFile(estcPath, 'utf8'), context, { filename: estcPath });
  vm.runInContext(await readFile(mstcPath, 'utf8'), context, { filename: mstcPath });
  vm.runInContext(await readFile(mastcPath, 'utf8'), context, { filename: mastcPath });
  return {
    wstc: context.WorldSpaceTimeCoordinates,
    estc: context.EarthSpaceTimeCoordinates,
    mstc: context.MoonSpaceTimeCoordinates,
    mastc: context.MarsSpaceTimeCoordinates,
  };
}

const { wstc, estc, mstc, mastc } = await loadApis();
const epoch = wstc.CONFIG.epochUTC;
const daySeconds = wstc.CONFIG.constants.planetDaySeconds;
const yearSeconds = wstc.CONFIG.constants.starYearSeconds;
const galaxySeconds = wstc.CONFIG.constants.galaxyCycleSeconds;
const earthZero = estc.CONFIG.zeroSpaceCoordinate;

function closeTo(actual, expected, epsilon = 1e-9, message = 'values should be close') {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

function timeAfter(seconds) {
  return new Date(new Date(epoch).getTime() + seconds * 1000);
}

function worldAt(secondsAfterEpoch, options = {}) {
  return wstc.getWorldSpaceTimeCoordinates({
    time: timeAfter(secondsAfterEpoch),
    epochUTC: options.epochUTC ?? epoch,
    machinePrecision: options.machinePrecision ?? 12,
    labelPrecision: options.labelPrecision,
  });
}

function earthAt(secondsAfterEpoch, options = {}) {
  return estc.getEarthSpaceTimeCoordinates({
    time: timeAfter(secondsAfterEpoch),
    epochUTC: options.epochUTC ?? epoch,
    latitude: options.latitude ?? earthZero.latitude,
    longitude: options.longitude ?? earthZero.longitude,
    altitudeMeters: options.altitudeMeters ?? earthZero.altitudeMeters,
    zeroSpaceCoordinate: options.zeroSpaceCoordinate ?? earthZero,
    machinePrecision: options.machinePrecision ?? 12,
    labelPrecision: options.labelPrecision,
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('WSTC exports only stable coordinate-map primitives', () => {
  for (const name of [
    'CONFIG',
    'getWorldSpaceTimeCoordinates',
    'millisecondsSinceEpoch',
    'normalize360',
    'fractionalPart',
    'completedCycles',
    'cycleFraction',
    'roundNumber',
    'formatNumber',
    'parseDate',
    'validateFinite',
  ]) {
    assert.ok(wstc[name], `${name} should be exported`);
  }
  assert.equal(wstc.getEquatorCoordinate, undefined);
  assert.equal(wstc.getEarthSurfaceUnderPZero, undefined);
  assert.equal(wstc.CONFIG.africaZero, undefined);
  assert.equal(wstc.CONFIG.constants.earthSiderealRotationSeconds, undefined);
  assert.equal(wstc.CONFIG.constants.planetDaySeconds, 86400);
  assert.equal(wstc.CONFIG.constants.starYearSeconds, 31556926.08);
  assert.equal(wstc.CONFIG.constants.galaxyCycleSeconds, 31556926.08 * 230_000_000);
});

test('WSTC Zero Era starts at G0/S0/P0', () => {
  const clock = worldAt(0);
  assert.equal(epoch, '1974-03-12T20:35:00Z');
  assert.equal(clock.input.epochUTC, new Date(epoch).toISOString());
  closeTo(clock.wstc.G, 0);
  closeTo(clock.wstc.S, 0);
  closeTo(clock.wstc.P, 0);
  assert.equal(clock.completed.planetDays, 0);
  assert.equal(clock.completed.starYears, 0);
});

test('WSTC P is an exact 86,400-second coordinate circle', () => {
  closeTo(worldAt(daySeconds / 4).wstc.P, 90);
  closeTo(worldAt(daySeconds / 2).wstc.P, 180);
  closeTo(worldAt(daySeconds * 3 / 4).wstc.P, 270);
  closeTo(worldAt(daySeconds).wstc.P, 0);
  assert.equal(worldAt(daySeconds).completed.planetDays, 1);
});

test('WSTC can be driven directly by elapsed milliseconds since Zero Epoch', () => {
  const direct = wstc.getWorldSpaceTimeCoordinates({
    elapsedMillisecondsSinceEpoch: daySeconds * 250,
  });
  const viaDate = worldAt(daySeconds / 4);
  closeTo(direct.wstc.P, 90);
  closeTo(direct.wstc.P, viaDate.wstc.P);
  assert.equal(direct.input.source, 'elapsedMillisecondsSinceEpoch');
  assert.equal(direct.input.timeUTC, null);

  const epochMs = Date.parse(epoch);
  const unix = wstc.getWorldSpaceTimeCoordinates({
    unixMilliseconds: epochMs + daySeconds * 500,
    epochUTC: epoch,
  });
  closeTo(unix.wstc.P, 180);
  assert.equal(unix.input.source, 'unixMilliseconds');
  assert.equal(wstc.millisecondsSinceEpoch({
    unixMilliseconds: epochMs + 1234,
    epochUTC: epoch,
  }).elapsedMilliseconds, 1234);
});

test('WSTC direct elapsed milliseconds is independent of legacy epoch date choice', () => {
  const a = wstc.getWorldSpaceTimeCoordinates({
    elapsedMillisecondsSinceEpoch: 0,
    epochUTC: '1974-03-13T04:40:00Z',
  });
  const b = wstc.getWorldSpaceTimeCoordinates({
    elapsedMillisecondsSinceEpoch: 0,
    epochUTC: '2026-05-25T00:00:00Z',
  });
  closeTo(a.wstc.P, 0);
  closeTo(b.wstc.P, 0);
  assert.notEqual(a.input.epochUTC, b.input.epochUTC);
});

test('WSTC S and G are exact configured atomic-second cycles', () => {
  closeTo(worldAt(yearSeconds / 4).wstc.S, 90);
  closeTo(worldAt(yearSeconds / 2).wstc.S, 180);
  closeTo(worldAt(yearSeconds).wstc.S, 0);
  assert.equal(worldAt(yearSeconds).completed.starYears, 1);
  const customGalaxy = wstc.getWorldSpaceTimeCoordinates({
    time: timeAfter(1000),
    epochUTC: epoch,
    galaxyCycleSeconds: 4000,
  });
  closeTo(customGalaxy.wstc.G, 90);
});

test('WSTC supports custom epochs without Earth assumptions', () => {
  const customEpoch = '2026-05-25T00:00:00Z';
  const zero = wstc.getWorldSpaceTimeCoordinates({ time: customEpoch, epochUTC: customEpoch });
  closeTo(zero.wstc.G, 0);
  closeTo(zero.wstc.S, 0);
  closeTo(zero.wstc.P, 0);
  const nextDay = wstc.getWorldSpaceTimeCoordinates({
    time: '2026-05-26T00:00:00Z',
    epochUTC: customEpoch,
  });
  closeTo(nextDay.wstc.P, 0);
  assert.equal(nextDay.completed.planetDays, 1);
});

test('WSTC handles negative elapsed time by wrapping coordinates and counting completed cycles', () => {
  const before = wstc.getWorldSpaceTimeCoordinates({
    elapsedMillisecondsSinceEpoch: -daySeconds * 250,
    machinePrecision: 12,
  });
  closeTo(before.wstc.P, 270);
  assert.equal(before.completed.planetDays, -1);

  const beforeYear = wstc.getWorldSpaceTimeCoordinates({
    elapsedMillisecondsSinceEpoch: -yearSeconds * 500,
    machinePrecision: 12,
  });
  closeTo(beforeYear.wstc.S, 180);
  assert.equal(beforeYear.completed.starYears, -1);
});

test('ESTC exports Earth application helpers', () => {
  for (const name of [
    'CONFIG',
    'getEarthSpaceTimeCoordinates',
    'getPZeroMeridian',
    'getEarthSurfaceUnderPZero',
    'getEquatorCoordinate',
    'getMeridianCoordinate',
    'zeroCoordinateFrom',
    'normalizeLongitude',
  ]) {
    assert.ok(estc[name], `${name} should be exported`);
  }
  assert.equal(estc.CONFIG.zeroSpaceCoordinate.latitude, 0);
  assert.equal(estc.CONFIG.zeroSpaceCoordinate.longitude, 80.96572);
  assert.equal(estc.CONFIG.zeroSpaceCoordinate.sourceLatitude, 26.82989);
  assert.equal(estc.CONFIG.zeroSpaceCoordinate.sourceLongitude, 80.96572);
  assert.equal(estc.CONFIG.africaZero.longitude, 80.96572);
  assert.equal(estc.CONFIG.constants.earthSiderealRotationSeconds, 86164.0905);
});

test('ESTC composes WSTC motion with Earth E/M/V and Y/O counters', () => {
  const clock = earthAt(0);
  closeTo(clock.wstc.G, 0);
  closeTo(clock.wstc.S, 0);
  closeTo(clock.wstc.P, 0);
  closeTo(clock.wstc.E, 0);
  closeTo(clock.wstc.M, 0);
  closeTo(clock.wstc.V, 0);
  assert.equal(clock.estc.Y, 0);
  assert.equal(clock.estc.O, 0);
  closeTo(estc.getPZeroMeridian(clock), 80.96572);

  const nextDay = earthAt(daySeconds);
  closeTo(nextDay.wstc.P, 0);
  assert.equal(nextDay.estc.O, 1);
});

test('ESTC Earth surface under P0 is an orientation overlay, not WSTC core', () => {
  const afterOneAtomicDay = timeAfter(daySeconds).toISOString();
  const clock = estc.getEarthSpaceTimeCoordinates({
    time: afterOneAtomicDay,
    epochUTC: epoch,
    latitude: earthZero.latitude,
    longitude: earthZero.longitude,
    altitudeMeters: 0,
  });
  const surface = estc.getEarthSurfaceUnderPZero({ time: afterOneAtomicDay, epochUTC: epoch });

  closeTo(clock.wstc.P, 0);
  closeTo(estc.getPZeroMeridian(clock), 80.96572);
  closeTo(surface.latitude, 0);
  closeTo(surface.longitude, 81.951367495461, 1e-9);
  closeTo(surface.earthOrientationPhase, 0.985647495461, 1e-9);
  assert.match(surface.note, /ESTC orientation overlay/);
});

test('ESTC P0 surface overlay moves east while stable P remains on the coordinate circle', () => {
  const afterTenAtomicDays = timeAfter(daySeconds * 10).toISOString();
  const clock = estc.getEarthSpaceTimeCoordinates({
    time: afterTenAtomicDays,
    epochUTC: epoch,
    latitude: earthZero.latitude,
    longitude: earthZero.longitude,
    altitudeMeters: 0,
  });
  const surface = estc.getEarthSurfaceUnderPZero({ time: afterTenAtomicDays, epochUTC: epoch });
  closeTo(clock.wstc.P, 0);
  closeTo(estc.getPZeroMeridian(clock), 80.96572);
  assert.ok(surface.longitude > 90 && surface.longitude < 91, 'Earth orientation overlay should be east of zero space after ten atomic days');
});

test('ESTC E and M helpers match the documented GPS conversion', () => {
  const cases = [
    { longitude: 80.96572, expectedE: 0 },
    { longitude: 81.96572, expectedE: 359 },
    { longitude: 79.96572, expectedE: 1 },
    { longitude: -99.03428, expectedE: 180 },
    { longitude: 260.96572, expectedE: 180 },
  ];
  for (const testCase of cases) {
    closeTo(estc.getEquatorCoordinate(testCase.longitude), testCase.expectedE);
    closeTo(earthAt(0, { longitude: testCase.longitude }).wstc.E, testCase.expectedE);
  }

  closeTo(estc.getMeridianCoordinate(45), -45);
  closeTo(estc.getMeridianCoordinate(-45), 45);
  closeTo(earthAt(0, { latitude: 45 }).wstc.M, -45);
  closeTo(earthAt(0, { latitude: -45 }).wstc.M, 45);
});

test('ESTC zero space coordinate can be configured per call', () => {
  const customZero = { latitude: 12, longitude: 20, altitudeMeters: 0 };
  closeTo(estc.getEquatorCoordinate(20, customZero), 0);
  closeTo(estc.getMeridianCoordinate(10, customZero), 2);
  const clock = earthAt(0, { latitude: 10, longitude: 25, zeroSpaceCoordinate: customZero });
  closeTo(clock.wstc.E, 355);
  closeTo(clock.wstc.M, 2);
  closeTo(estc.getPZeroMeridian(clock), 20);
  const surface = estc.getEarthSurfaceUnderPZero({ time: epoch, epochUTC: epoch, zeroSpaceCoordinate: customZero });
  closeTo(surface.latitude, 12);
  closeTo(surface.longitude, 20);
});

test('ESTC labels and strings use the selected precision', () => {
  const clock = estc.getEarthSpaceTimeCoordinates({
    time: timeAfter(12345),
    latitude: 45.4642,
    longitude: 9.19,
    altitudeMeters: 127,
    labelPrecision: { G: 6, S: 2, P: 2, E: 3, M: 3, V: 0 },
  });
  assert.match(clock.labels.wstc.P, /^P\d+\.\d{2}°$/);
  assert.equal(clock.labels.wstc.E, 'E71.776°');
  assert.equal(clock.labels.wstc.M, 'M-45.464°');
  assert.equal(clock.labels.wstc.V, 'V127m');
  assert.equal(clock.strings.wstc, [
    clock.labels.wstc.G,
    clock.labels.wstc.S,
    clock.labels.wstc.P,
    clock.labels.wstc.E,
    clock.labels.wstc.M,
    clock.labels.wstc.V,
  ].join(', '));
});

test('MSTC composes WSTC motion with Moon E/M/V and lunar P cycle', () => {
  assert.equal(mstc.CONFIG.moonZero.longitude, 80.96572);
  assert.equal(mstc.CONFIG.moonZero.sourceLatitude, 26.82989);
  assert.equal(mstc.CONFIG.moonZero.sourceLongitude, 80.96572);
  assert.equal(mstc.CONFIG.constants.lunarDaySeconds, 2551442.88);
  assert.equal(mstc.getEquatorCoordinate(80.96572), 0);
  assert.equal(mstc.getMeridianCoordinate(0), 0);

  const zero = mstc.getMoonSpaceTimeCoordinates({ time: epoch, epochUTC: epoch });
  closeTo(zero.wstc.G, 0);
  closeTo(zero.wstc.S, 0);
  closeTo(zero.wstc.P, 0);
  closeTo(zero.wstc.E, 0);
  closeTo(zero.wstc.M, 0);
  assert.equal(zero.mstc.Y, 0);
  assert.equal(zero.mstc.O, 0);

  const quarter = mstc.getMoonSpaceTimeCoordinates({
    time: new Date(new Date(epoch).getTime() + mstc.CONFIG.constants.lunarDaySeconds * 250).toISOString(),
    epochUTC: epoch,
  });
  closeTo(quarter.wstc.P, 90);

  const place = mstc.getMoonSpaceTimeCoordinates({
    time: epoch,
    epochUTC: epoch,
    latitude: 12.5,
    longitude: -31,
    altitudeMeters: 1200,
  });
  closeTo(place.wstc.E, 111.96572);
  closeTo(place.wstc.M, -12.5);
  closeTo(place.wstc.V, 1200);
  assert.match(place.strings.mstc, /^Y0, O0, P0/);
});

test('MSTC and MaSTC keep body-specific P cycles separate from WSTC planet-day P', () => {
  const oneEarthDay = new Date(new Date(epoch).getTime() + daySeconds * 1000).toISOString();
  const moonClock = mstc.getMoonSpaceTimeCoordinates({ time: oneEarthDay, epochUTC: epoch });
  const marsClock = mastc.getMarsSpaceTimeCoordinates({ time: oneEarthDay, epochUTC: epoch });
  const worldClock = wstc.getWorldSpaceTimeCoordinates({ time: oneEarthDay, epochUTC: epoch });

  closeTo(worldClock.wstc.P, 0);
  assert.notEqual(moonClock.wstc.P, worldClock.wstc.P);
  assert.notEqual(marsClock.wstc.P, worldClock.wstc.P);
  assert.ok(moonClock.wstc.P > 0 && moonClock.wstc.P < 360);
  assert.ok(marsClock.wstc.P > 0 && marsClock.wstc.P < 360);
});

test('MaSTC composes WSTC motion with Mars E/M/V and Mars S/P cycles', () => {
  assert.equal(mastc.CONFIG.marsZero.longitude, 80.96572);
  assert.equal(mastc.CONFIG.marsZero.sourceLatitude, 26.82989);
  assert.equal(mastc.CONFIG.marsZero.sourceLongitude, 80.96572);
  assert.equal(mastc.CONFIG.constants.marsSolSeconds, 88775.244);
  assert.equal(mastc.CONFIG.constants.marsYearSeconds, 59355072);
  assert.equal(mastc.getEquatorCoordinate(80.96572), 0);
  assert.equal(mastc.getMeridianCoordinate(0), 0);

  const zero = mastc.getMarsSpaceTimeCoordinates({ time: epoch, epochUTC: epoch });
  closeTo(zero.wstc.G, 0);
  closeTo(zero.wstc.S, 0);
  closeTo(zero.wstc.P, 0);
  closeTo(zero.wstc.E, 0);
  closeTo(zero.wstc.M, 0);
  assert.equal(zero.mastc.Y, 0);
  assert.equal(zero.mastc.O, 0);

  const quarterSol = mastc.getMarsSpaceTimeCoordinates({
    time: new Date(new Date(epoch).getTime() + mastc.CONFIG.constants.marsSolSeconds * 250).toISOString(),
    epochUTC: epoch,
  });
  closeTo(quarterSol.wstc.P, 90);

  const halfYear = mastc.getMarsSpaceTimeCoordinates({
    time: new Date(new Date(epoch).getTime() + mastc.CONFIG.constants.marsYearSeconds * 500).toISOString(),
    epochUTC: epoch,
  });
  closeTo(halfYear.wstc.S, 180);

  const place = mastc.getMarsSpaceTimeCoordinates({
    time: epoch,
    epochUTC: epoch,
    latitude: -4.5,
    longitude: 137.4,
    altitudeMeters: -4500,
  });
  closeTo(place.wstc.E, 303.56572);
  closeTo(place.wstc.M, 4.5);
  closeTo(place.wstc.V, -4500);
  assert.match(place.strings.mastc, /^Y0, O0, P0/);
});

test('normalization helpers and validation are stable at boundaries', () => {
  assert.equal(wstc.normalize360(360), 0);
  assert.equal(wstc.normalize360(-1), 359);
  assert.equal(estc.normalizeLongitude(180), -180);
  assert.equal(estc.normalizeLongitude(181), -179);
  assert.equal(estc.normalizeLongitude(-181), 179);

  assert.throws(() => earthAt(0, { latitude: 91 }), /latitude/);
  assert.throws(() => earthAt(0, { latitude: -91 }), /latitude/);
  assert.throws(() => estc.getEquatorCoordinate(Number.NaN), /longitude/);
  assert.throws(() => estc.getMeridianCoordinate(91), /latitude/);
  assert.throws(() => wstc.getWorldSpaceTimeCoordinates({
    time: epoch,
    machinePrecision: 16,
  }), /machinePrecision/);
  assert.throws(() => wstc.getWorldSpaceTimeCoordinates({ time: 'not-a-date' }), /Invalid time/);
  assert.throws(() => mstc.getMoonSpaceTimeCoordinates({ time: epoch, latitude: 91 }), /latitude/);
  assert.throws(() => mastc.getMarsSpaceTimeCoordinates({ time: epoch, latitude: 91 }), /latitude/);
  assert.throws(() => mstc.zeroCoordinateFrom({ latitude: 91, longitude: 0 }), /latitude/);
  assert.throws(() => mastc.zeroCoordinateFrom({ latitude: 91, longitude: 0 }), /latitude/);
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
  }
}

if (failures > 0) {
  console.error(`${failures} WSTC/ESTC API test${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log(`${tests.length} WSTC/ESTC API tests passed.`);
