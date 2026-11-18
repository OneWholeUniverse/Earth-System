/**
 * moon-space-time-coordinates.js
 * -------------------------------
 * Moon Space-Time Coordinates (MSTC) application layer built on pure WSTC.
 *
 * This module intentionally mirrors earth-space-time-coordinates.js, but with
 * Moon-specific coordinate-cycle settings and a Moon surface frame. It is a
 * prototype layer for asking better questions, not a precision lunar ephemeris.
 *
 * Moon zero point:
 *   latitude 0.000000, longitude 80.965720, altitude 0m
 *   Moon zero is born with ESTC zero: March 13, 1974 02:05 IST, on the
 *   symbolic zero meridian through GPS 26.82989, 80.96572.
 *
 * Moon surface coordinates:
 *   E = normalize360(zero longitude - lunar longitude)
 *   M = zero latitude - lunar latitude
 *   V = altitude meters
 *
 * Motion coordinates:
 *   P uses a configured lunar coordinate day in atomic seconds. Moon P0 is
 *   phase-aligned to the shared WSTC Zero Era by default, not to a separate
 *   arbitrary Moon-only epoch.
 */

(function (root) {
  "use strict";

  const WSTC = root.WorldSpaceTimeCoordinates;
  if (!WSTC) throw new Error("MoonSpaceTimeCoordinates requires WorldSpaceTimeCoordinates.");

  const CONFIG = Object.freeze({
    system: "Moon Space-Time Coordinates",
    version: "v2 prototype",
    epochUTC: WSTC.CONFIG.epochUTC,
    moonZero: Object.freeze({
      latitude: 0,
      longitude: 80.96572,
      altitudeMeters: 0,
      sourceLatitude: 26.82989,
      sourceLongitude: 80.96572,
      note: "Moon clock-map zero follows the ESTC born-zero meridian.",
    }),
    constants: Object.freeze({
      lunarDaySeconds: 2_551_442.88,
      starYearSeconds: WSTC.CONFIG.constants.starYearSeconds,
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

  function validateMoonLocation(latitude, longitude, altitudeMeters) {
    WSTC.validateFinite("latitude", latitude);
    WSTC.validateFinite("longitude", longitude);
    WSTC.validateFinite("altitudeMeters", altitudeMeters);
    if (latitude < -90 || latitude > 90) throw new Error("latitude must be from -90 to +90.");
  }

  function zeroCoordinateFrom(value = CONFIG.moonZero) {
    const zero = {
      ...CONFIG.moonZero,
      ...(value || {}),
    };
    const altitudeMeters = zero.altitudeMeters ?? 0;
    validateMoonLocation(zero.latitude, zero.longitude, altitudeMeters);
    return {
      ...zero,
      longitude: normalizeLongitude(zero.longitude),
      altitudeMeters,
    };
  }

  function getEquatorCoordinate(longitude, zeroSpaceCoordinate = CONFIG.moonZero) {
    WSTC.validateFinite("longitude", longitude);
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    return WSTC.normalize360(zero.longitude - normalizeLongitude(longitude));
  }

  function getMeridianCoordinate(latitude, zeroSpaceCoordinate = CONFIG.moonZero) {
    WSTC.validateFinite("latitude", latitude);
    if (latitude < -90 || latitude > 90) throw new Error("latitude must be from -90 to +90.");
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    const value = zero.latitude - latitude;
    return Object.is(value, -0) ? 0 : value;
  }

  function formatLabels({ wstc, mstc }, precision = DEFAULT_PRECISION.label) {
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
      mstc: {
        Y: `Y${mstc.Y}`,
        O: `O${mstc.O}`,
        P: `P${WSTC.formatNumber(mstc.P, p.P)}°`,
        E: `E${WSTC.formatNumber(mstc.E, p.E)}°`,
        M: `M${WSTC.formatNumber(mstc.M, p.M)}°`,
        V: `V${WSTC.formatNumber(mstc.V, p.V)}m`,
      },
    };
  }

  function joinLabels(labels, keys) {
    return keys.map((key) => labels[key]).join(", ");
  }

  function getMoonSpaceTimeCoordinates({
    time,
    isoTime,
    epochUTC = CONFIG.epochUTC,
    latitude = CONFIG.moonZero.latitude,
    longitude = CONFIG.moonZero.longitude,
    altitudeMeters = CONFIG.moonZero.altitudeMeters,
    zeroSpaceCoordinate = CONFIG.moonZero,
    machinePrecision = DEFAULT_PRECISION.machine,
    labelPrecision = DEFAULT_PRECISION.label,
  } = {}) {
    validateMoonLocation(latitude, longitude, altitudeMeters);
    const zero = zeroCoordinateFrom(zeroSpaceCoordinate);
    const motion = WSTC.getWorldSpaceTimeCoordinates({
      time,
      isoTime,
      epochUTC,
      planetDaySeconds: CONFIG.constants.lunarDaySeconds,
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
    const mstc = {
      Y: motion.completed.starYears,
      O: WSTC.completedCycles((motion.elapsed.seconds - motion.completed.starYears * CONFIG.constants.starYearSeconds) / CONFIG.constants.lunarDaySeconds),
      P,
      E,
      M,
      V,
    };
    const labels = formatLabels({ wstc, mstc }, labelPrecision);

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
      mstc,
      labels,
      strings: {
        wstc: joinLabels(labels.wstc, ["G", "S", "P", "E", "M", "V"]),
        mstc: joinLabels(labels.mstc, ["Y", "O", "P", "E", "M", "V"]),
      },
      motion,
      reference: CONFIG,
      notes: [
        "MSTC composes WSTC motion coordinates with a Moon E/M/V surface frame.",
        "The lunar P cycle is a configured application-layer coordinate cycle.",
      ],
    };
  }

  const api = {
    CONFIG,
    getMoonSpaceTimeCoordinates,
    getEquatorCoordinate,
    getMeridianCoordinate,
    zeroCoordinateFrom,
    normalizeLongitude,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.MoonSpaceTimeCoordinates = api;
})(typeof window !== "undefined" ? window : globalThis);
