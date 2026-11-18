/**
 * earth-space-time-coordinates.js
 * --------------------------------
 * Earth Space-Time Coordinates (ESTC) application layer built on pure WSTC.
 *
 * ESTC composes the stable WSTC motion map with Earth-specific space
 * coordinates and Earth orientation overlays.
 *
 * Stable Earth space coordinates:
 *   Zero space coordinate: latitude 0.000000, longitude 80.965720°E, altitude 0m
 *   E = normalize360(zero longitude - GPS longitude)
 *   M = zero latitude - GPS latitude
 *   V = altitude meters
 *
 * Earth orientation overlays:
 *   The Earth surface under P0 uses sidereal rotation. This is deliberately not
 *   part of WSTC core because it describes physical Earth performance moving
 *   across the stable clock-map.
 */

(function (root) {
  "use strict";

  const WSTC = root.WorldSpaceTimeCoordinates;
  if (!WSTC) throw new Error("EarthSpaceTimeCoordinates requires WorldSpaceTimeCoordinates.");

  const DEFAULT_ZERO_SPACE_COORDINATE = Object.freeze({
    // Zero space is born on the equator at the meridian through GPS 26.82989, 80.96572.
    latitude: 0,
    longitude: 80.96572,
    altitudeMeters: 0,
    sourceLatitude: 26.82989,
    sourceLongitude: 80.96572,
    note: "Equator point on the meridian through 26.82989, 80.96572.",
  });

  const CONFIG = Object.freeze({
    system: "Earth Space-Time Coordinates",
    version: "v2 prototype",
    epochUTC: WSTC.CONFIG.epochUTC,
    zeroSpaceCoordinate: DEFAULT_ZERO_SPACE_COORDINATE,
    africaZero: DEFAULT_ZERO_SPACE_COORDINATE,
    constants: Object.freeze({
      planetDaySeconds: WSTC.CONFIG.constants.planetDaySeconds,
      starYearSeconds: WSTC.CONFIG.constants.starYearSeconds,
      galaxyCycleSeconds: WSTC.CONFIG.constants.galaxyCycleSeconds,
      earthSiderealRotationSeconds: 86_164.0905,
    }),
  });

  const DEFAULT_PRECISION = Object.freeze({
    machine: 12,
    label: Object.freeze({ G: 6, S: 2, Y: 0, O: 0, P: 2, E: 3, M: 3, V: 0 }),
  });

  function normalizeLongitude(value) {
    return ((((value + 180) % 360) + 360) % 360) - 180;
  }

  function validateEarthLocation(latitude, longitude, altitudeMeters) {
    WSTC.validateFinite("latitude", latitude);
    WSTC.validateFinite("longitude", longitude);
    WSTC.validateFinite("altitudeMeters", altitudeMeters);
    if (latitude < -90 || latitude > 90) throw new Error("latitude must be from -90 to +90.");
  }

  function zeroCoordinateFrom(value = CONFIG.zeroSpaceCoordinate) {
    const zero = {
      ...CONFIG.zeroSpaceCoordinate,
      ...(value || {}),
    };
    const altitudeMeters = zero.altitudeMeters ?? 0;
    validateEarthLocation(zero.latitude, zero.longitude, altitudeMeters);
    return {
      ...zero,
      longitude: normalizeLongitude(zero.longitude),
      altitudeMeters,
    };
  }

  function getEquatorCoordinate(longitude, zeroSpaceCoordinate = CONFIG.zeroSpaceCoordinate) {
    WSTC.validateFinite("longitude", longitude);
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    return WSTC.normalize360(zero.longitude - normalizeLongitude(longitude));
  }

  function getMeridianCoordinate(latitude, zeroSpaceCoordinate = CONFIG.zeroSpaceCoordinate) {
    WSTC.validateFinite("latitude", latitude);
    if (latitude < -90 || latitude > 90) throw new Error("latitude must be from -90 to +90.");
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    return zero.latitude - latitude;
  }

  function formatLabels({ wstc, estc }, precision = DEFAULT_PRECISION.label) {
    const p = { ...DEFAULT_PRECISION.label, ...precision };
    return {
      wstc: {
        G: `G${WSTC.formatNumber(wstc.G, p.G)}°`,
        S: `S${WSTC.formatNumber(wstc.S, p.S)}°`,
        P: `P${WSTC.formatNumber(wstc.P, p.P)}°`,
        E: `E${WSTC.formatNumber(wstc.E, p.E)}°`,
        M: `M${WSTC.formatNumber(wstc.M, p.M)}°`,
        V: `V${WSTC.formatNumber(wstc.V, p.V)}m`,
      },
      estc: {
        Y: `Y${estc.Y}`,
        O: `O${estc.O}`,
        P: `P${WSTC.formatNumber(estc.P, p.P)}°`,
        E: `E${WSTC.formatNumber(estc.E, p.E)}°`,
        M: `M${WSTC.formatNumber(estc.M, p.M)}°`,
        V: `V${WSTC.formatNumber(estc.V, p.V)}m`,
      },
    };
  }

  function joinLabels(labels, keys) {
    return keys.map((key) => labels[key]).join(", ");
  }

  function getEarthSpaceTimeCoordinates({
    time,
    isoTime,
    epochUTC = CONFIG.epochUTC,
    latitude,
    longitude,
    altitudeMeters = 0,
    zeroSpaceCoordinate = CONFIG.zeroSpaceCoordinate,
    machinePrecision = DEFAULT_PRECISION.machine,
    labelPrecision = DEFAULT_PRECISION.label,
  }) {
    validateEarthLocation(latitude, longitude, altitudeMeters);
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    const motion = WSTC.getWorldSpaceTimeCoordinates({
      time,
      isoTime,
      epochUTC,
      planetDaySeconds: CONFIG.constants.planetDaySeconds,
      starYearSeconds: CONFIG.constants.starYearSeconds,
      galaxyCycleSeconds: CONFIG.constants.galaxyCycleSeconds,
      machinePrecision,
      labelPrecision,
    });

    const E = WSTC.roundNumber(getEquatorCoordinate(longitude, zero), machinePrecision);
    const M = WSTC.roundNumber(getMeridianCoordinate(latitude, zero), machinePrecision);
    const V = WSTC.roundNumber(altitudeMeters, machinePrecision);
    const P = motion.wstc.P;
    const wstc = { ...motion.wstc, E, M, V };
    const estc = {
      Y: motion.completed.starYears,
      O: WSTC.completedCycles((motion.elapsed.seconds - motion.completed.starYears * CONFIG.constants.starYearSeconds) / CONFIG.constants.planetDaySeconds),
      P,
      E,
      M,
      V,
    };
    const labels = formatLabels({ wstc, estc }, labelPrecision);

    return {
      input: {
        ...motion.input,
        latitude,
        longitude,
        normalizedLongitude: normalizeLongitude(longitude),
        altitudeMeters,
        zeroSpaceCoordinate: zero,
      },
      wstc,
      estc,
      labels,
      strings: {
        wstc: joinLabels(labels.wstc, ["G", "S", "P", "E", "M", "V"]),
        estc: joinLabels(labels.estc, ["Y", "O", "P", "E", "M", "V"]),
      },
      motion,
      reference: CONFIG,
      notes: [
        "ESTC composes WSTC motion coordinates with Earth E/M/V space coordinates.",
        "Earth orientation, day/night, seasons, and weather are overlays moving across the stable map.",
      ],
    };
  }

  function getPZeroMeridian(coordinatesOrP, zeroSpaceCoordinate = CONFIG.zeroSpaceCoordinate) {
    const p = typeof coordinatesOrP === "number" ? coordinatesOrP : coordinatesOrP?.wstc?.P;
    WSTC.validateFinite("P", p);
    const zero = zeroCoordinateFrom(coordinatesOrP?.input?.zeroSpaceCoordinate || zeroSpaceCoordinate);
    return normalizeLongitude(zero.longitude + p);
  }

  function getEarthSurfaceUnderPZero({ time, isoTime, epochUTC = CONFIG.epochUTC, zeroSpaceCoordinate = CONFIG.zeroSpaceCoordinate } = {}) {
    const dateUTC = WSTC.parseDate(time ?? isoTime);
    const epochDateUTC = WSTC.parseDate(epochUTC);
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    const elapsedSeconds = (dateUTC.getTime() - epochDateUTC.getTime()) / 1000;
    const earthOrientationPhase =
      WSTC.cycleFraction(elapsedSeconds / CONFIG.constants.earthSiderealRotationSeconds) * 360;
    return {
      latitude: zero.latitude,
      longitude: normalizeLongitude(zero.longitude + earthOrientationPhase),
      earthOrientationPhase,
      elapsedSeconds,
      zeroSpaceCoordinate: zero,
      note:
        "This is the Earth surface point currently under the abstract P0 mark; it is an ESTC orientation overlay, not a WSTC coordinate.",
    };
  }

  const api = {
    CONFIG,
    getEarthSpaceTimeCoordinates,
    getPZeroMeridian,
    getEarthSurfaceUnderPZero,
    getEquatorCoordinate,
    getMeridianCoordinate,
    zeroCoordinateFrom,
    normalizeLongitude,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.EarthSpaceTimeCoordinates = api;
})(typeof window !== "undefined" ? window : globalThis);
