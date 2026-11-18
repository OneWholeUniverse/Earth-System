/**
 * mars-space-time-coordinates.js
 * -------------------------------
 * Mars Space-Time Coordinates (MaSTC) application layer built on pure WSTC.
 *
 * Mars gets its own body-specific S/P/E/M/V layer:
 *   S = configured Mars orbital coordinate year around the Sun.
 *   P = configured Mars sol coordinate cycle.
 *   E/M/V = Mars surface frame anchored to the ESTC born-zero meridian.
 *   Mars zero is born with ESTC zero: March 13, 1974 02:05 IST, on the
 *   symbolic zero meridian through GPS 26.82989, 80.96572.
 *
 * This is a stable coordinate layer, not precision Mars astronomy.
 */

(function (root) {
  "use strict";

  const WSTC = root.WorldSpaceTimeCoordinates;
  if (!WSTC) throw new Error("MarsSpaceTimeCoordinates requires WorldSpaceTimeCoordinates.");

  const CONFIG = Object.freeze({
    system: "Mars Space-Time Coordinates",
    version: "v2 prototype",
    epochUTC: WSTC.CONFIG.epochUTC,
    marsZero: Object.freeze({
      latitude: 0,
      longitude: 80.96572,
      altitudeMeters: 0,
      sourceLatitude: 26.82989,
      sourceLongitude: 80.96572,
      note: "Mars clock-map zero follows the ESTC born-zero meridian.",
    }),
    constants: Object.freeze({
      marsSolSeconds: 88_775.244,
      marsYearSeconds: 59_355_072,
      galaxyCycleSeconds: WSTC.CONFIG.constants.galaxyCycleSeconds,
    }),
  });

  const DEFAULT_PRECISION = Object.freeze({
    machine: 12,
    label: Object.freeze({ G: 6, S: 2, Y: 0, O: 0, P: 2, E: 3, M: 3, V: 0 }),
  });

  function normalizeLongitude(value) {
    return ((((value + 180) % 360) + 360) % 360) - 180;
  }

  function validateMarsLocation(latitude, longitude, altitudeMeters) {
    WSTC.validateFinite("latitude", latitude);
    WSTC.validateFinite("longitude", longitude);
    WSTC.validateFinite("altitudeMeters", altitudeMeters);
    if (latitude < -90 || latitude > 90) throw new Error("latitude must be from -90 to +90.");
  }

  function zeroCoordinateFrom(value = CONFIG.marsZero) {
    const zero = {
      ...CONFIG.marsZero,
      ...(value || {}),
    };
    const altitudeMeters = zero.altitudeMeters ?? 0;
    validateMarsLocation(zero.latitude, zero.longitude, altitudeMeters);
    return {
      ...zero,
      longitude: normalizeLongitude(zero.longitude),
      altitudeMeters,
    };
  }

  function getEquatorCoordinate(longitude, zeroSpaceCoordinate = CONFIG.marsZero) {
    WSTC.validateFinite("longitude", longitude);
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    return WSTC.normalize360(zero.longitude - normalizeLongitude(longitude));
  }

  function getMeridianCoordinate(latitude, zeroSpaceCoordinate = CONFIG.marsZero) {
    WSTC.validateFinite("latitude", latitude);
    if (latitude < -90 || latitude > 90) throw new Error("latitude must be from -90 to +90.");
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    const value = zero.latitude - latitude;
    return Object.is(value, -0) ? 0 : value;
  }

  function formatLabels({ wstc, mastc }, precision = DEFAULT_PRECISION.label) {
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
      mastc: {
        Y: `Y${mastc.Y}`,
        O: `O${mastc.O}`,
        P: `P${WSTC.formatNumber(mastc.P, p.P)}°`,
        E: `E${WSTC.formatNumber(mastc.E, p.E)}°`,
        M: `M${WSTC.formatNumber(mastc.M, p.M)}°`,
        V: `V${WSTC.formatNumber(mastc.V, p.V)}m`,
      },
    };
  }

  function joinLabels(labels, keys) {
    return keys.map((key) => labels[key]).join(", ");
  }

  function getMarsSpaceTimeCoordinates({
    time,
    isoTime,
    epochUTC = CONFIG.epochUTC,
    latitude = CONFIG.marsZero.latitude,
    longitude = CONFIG.marsZero.longitude,
    altitudeMeters = CONFIG.marsZero.altitudeMeters,
    zeroSpaceCoordinate = CONFIG.marsZero,
    machinePrecision = DEFAULT_PRECISION.machine,
    labelPrecision = DEFAULT_PRECISION.label,
  } = {}) {
    validateMarsLocation(latitude, longitude, altitudeMeters);
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    const motion = WSTC.getWorldSpaceTimeCoordinates({
      time,
      isoTime,
      epochUTC,
      planetDaySeconds: CONFIG.constants.marsSolSeconds,
      starYearSeconds: CONFIG.constants.marsYearSeconds,
      galaxyCycleSeconds: CONFIG.constants.galaxyCycleSeconds,
      machinePrecision,
      labelPrecision,
    });

    const E = WSTC.roundNumber(getEquatorCoordinate(longitude, zero), machinePrecision);
    const M = WSTC.roundNumber(getMeridianCoordinate(latitude, zero), machinePrecision);
    const V = WSTC.roundNumber(altitudeMeters, machinePrecision);
    const P = motion.wstc.P;
    const wstc = { ...motion.wstc, E, M, V };
    const mastc = {
      Y: motion.completed.starYears,
      O: WSTC.completedCycles((motion.elapsed.seconds - motion.completed.starYears * CONFIG.constants.marsYearSeconds) / CONFIG.constants.marsSolSeconds),
      P,
      E,
      M,
      V,
    };
    const labels = formatLabels({ wstc, mastc }, labelPrecision);

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
      mastc,
      labels,
      strings: {
        wstc: joinLabels(labels.wstc, ["G", "S", "P", "E", "M", "V"]),
        mastc: joinLabels(labels.mastc, ["Y", "O", "P", "E", "M", "V"]),
      },
      motion,
      reference: CONFIG,
      notes: [
        "MaSTC composes WSTC motion coordinates with a Mars E/M/V surface frame.",
        "Mars S and P are configured application-layer coordinate cycles.",
      ],
    };
  }

  const api = {
    CONFIG,
    getMarsSpaceTimeCoordinates,
    getEquatorCoordinate,
    getMeridianCoordinate,
    zeroCoordinateFrom,
    normalizeLongitude,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.MarsSpaceTimeCoordinates = api;
})(typeof window !== "undefined" ? window : globalThis);
