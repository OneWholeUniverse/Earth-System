/**
 * world-space-time-coordinates.js
 * --------------------------------
 * Pure World Space-Time Coordinates (WSTC) engine.
 *
 * WSTC is the stable clock-map grammar. Its motion circles are exact atomic
 * second counters. Its G/S/P marks are abstract coordinates on the map, not
 * physical bodies or places. Planet-specific location systems, astronomy,
 * orientation, seasons, weather, sunrise, and local time belong in application
 * layers such as earth-space-time-coordinates.js.
 *
 * Motion coordinates:
 *   G = Galaxy circle, exact configured atomic-second cycle.
 *   S = Star circle, exact configured atomic-second cycle.
 *   P = Planet circle, exact configured atomic-second cycle.
 *
 * WSTC core intentionally does not know about Earth longitude, latitude,
 * altitude, sidereal rotation, or Earth zero-space origins. Those are ESTC
 * concerns.
 *
 * Primary input:
 *   elapsedMillisecondsSinceEpoch
 *
 * Date/UTC inputs are adapters for this prototype. JavaScript Date does not
 * model leap seconds, so a future atomic-time adapter can replace the legacy
 * conversion without changing the coordinate math.
 */

(function (root) {
  "use strict";

  const CYCLE_EPSILON = 1e-10;
  const STAR_YEAR_SECONDS = 31_556_926.08;

  const CONFIG = Object.freeze({
    system: "World Space-Time Coordinates",
    version: "v5 prototype",
    // Zero is born at March 13, 1974 02:05 IST, stored here as UTC.
    epochUTC: "1974-03-12T20:35:00Z",
    constants: Object.freeze({
      planetDaySeconds: 86_400,
      starYearSeconds: STAR_YEAR_SECONDS,
      galaxyCycleSeconds: STAR_YEAR_SECONDS * 230_000_000,
    }),
  });

  const DEFAULT_PRECISION = Object.freeze({
    machine: 12,
    label: Object.freeze({ G: 6, S: 2, P: 2 }),
  });

  function normalize360(value) {
    return ((value % 360) + 360) % 360;
  }

  function fractionalPart(value) {
    return ((value % 1) + 1) % 1;
  }

  function completedCycles(value) {
    const nearest = Math.round(value);
    if (Math.abs(value - nearest) <= CYCLE_EPSILON) return Object.is(nearest, -0) ? 0 : nearest;
    return Math.floor(value);
  }

  function cycleFraction(value) {
    const nearest = Math.round(value);
    if (Math.abs(value - nearest) <= CYCLE_EPSILON) return 0;
    return fractionalPart(value);
  }

  function roundNumber(value, places = 0) {
    const factor = 10 ** places;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function formatNumber(value, places = 0) {
    return roundNumber(value, places).toFixed(places);
  }

  function parseDate(input) {
    const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid time. Use a Date, timestamp, or ISO string with a timezone.");
    }
    return date;
  }

  function millisecondsSinceEpoch({ elapsedMillisecondsSinceEpoch, unixMilliseconds, time, isoTime, epochUTC = CONFIG.epochUTC } = {}) {
    if (elapsedMillisecondsSinceEpoch !== undefined) {
      validateFinite("elapsedMillisecondsSinceEpoch", elapsedMillisecondsSinceEpoch);
      return {
        elapsedMilliseconds: elapsedMillisecondsSinceEpoch,
        timeUTC: null,
        epochUTC: parseDate(epochUTC).toISOString(),
        source: "elapsedMillisecondsSinceEpoch",
      };
    }

    const epochDateUTC = parseDate(epochUTC);
    if (unixMilliseconds !== undefined) {
      validateFinite("unixMilliseconds", unixMilliseconds);
      return {
        elapsedMilliseconds: unixMilliseconds - epochDateUTC.getTime(),
        timeUTC: new Date(unixMilliseconds).toISOString(),
        epochUTC: epochDateUTC.toISOString(),
        source: "unixMilliseconds",
      };
    }

    const dateUTC = parseDate(time ?? isoTime);
    return {
      elapsedMilliseconds: dateUTC.getTime() - epochDateUTC.getTime(),
      timeUTC: dateUTC.toISOString(),
      epochUTC: epochDateUTC.toISOString(),
      source: "legacyDateAdapter",
    };
  }

  function validateFinite(name, value) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  }

  function validatePrecision(machinePrecision) {
    if (!Number.isInteger(machinePrecision) || machinePrecision < 0 || machinePrecision > 15) {
      throw new Error("machinePrecision must be an integer from 0 to 15.");
    }
  }

  function buildLabels(wstc, precision = DEFAULT_PRECISION.label) {
    const p = { ...DEFAULT_PRECISION.label, ...precision };
    return {
      G: `G${formatNumber(wstc.G, p.G)}°`,
      S: `S${formatNumber(wstc.S, p.S)}°`,
      P: `P${formatNumber(wstc.P, p.P)}°`,
    };
  }

  function getWorldSpaceTimeCoordinates({
    elapsedMillisecondsSinceEpoch,
    unixMilliseconds,
    time,
    isoTime,
    epochUTC = CONFIG.epochUTC,
    planetDaySeconds = CONFIG.constants.planetDaySeconds,
    starYearSeconds = CONFIG.constants.starYearSeconds,
    galaxyCycleSeconds = CONFIG.constants.galaxyCycleSeconds,
    machinePrecision = DEFAULT_PRECISION.machine,
    labelPrecision = DEFAULT_PRECISION.label,
  } = {}) {
    validateFinite("planetDaySeconds", planetDaySeconds);
    validateFinite("starYearSeconds", starYearSeconds);
    validateFinite("galaxyCycleSeconds", galaxyCycleSeconds);
    validatePrecision(machinePrecision);
    if (planetDaySeconds <= 0 || starYearSeconds <= 0 || galaxyCycleSeconds <= 0) {
      throw new Error("coordinate cycle seconds must be greater than zero.");
    }

    const elapsedInput = millisecondsSinceEpoch({
      elapsedMillisecondsSinceEpoch,
      unixMilliseconds,
      time,
      isoTime,
      epochUTC,
    });
    const elapsedSeconds = elapsedInput.elapsedMilliseconds / 1000;
    const elapsedPlanetDays = elapsedSeconds / planetDaySeconds;
    const elapsedStarYears = elapsedSeconds / starYearSeconds;
    const elapsedGalaxyCycles = elapsedSeconds / galaxyCycleSeconds;

    const raw = {
      G: cycleFraction(elapsedGalaxyCycles) * 360,
      S: cycleFraction(elapsedStarYears) * 360,
      P: cycleFraction(elapsedPlanetDays) * 360,
    };

    const wstc = {
      G: roundNumber(raw.G, machinePrecision),
      S: roundNumber(raw.S, machinePrecision),
      P: roundNumber(raw.P, machinePrecision),
    };
    const labels = buildLabels(wstc, labelPrecision);

    return {
      input: {
        timeUTC: elapsedInput.timeUTC,
        epochUTC: elapsedInput.epochUTC,
        elapsedMillisecondsSinceEpoch: elapsedInput.elapsedMilliseconds,
        source: elapsedInput.source,
      },
      cycles: {
        planetDaySeconds,
        starYearSeconds,
        galaxyCycleSeconds,
      },
      elapsed: {
        seconds: elapsedSeconds,
        planetDays: elapsedPlanetDays,
        starYears: elapsedStarYears,
        galaxyCycles: elapsedGalaxyCycles,
      },
      completed: {
        planetDays: completedCycles(elapsedPlanetDays),
        starYears: completedCycles(elapsedStarYears),
        galaxyCycles: completedCycles(elapsedGalaxyCycles),
      },
      wstc,
      labels,
      string: [labels.G, labels.S, labels.P].join(", "),
      reference: CONFIG,
      notes: [
        "WSTC is the stable coordinate-map grammar.",
        "G/S/P are exact atomic-second coordinate cycles.",
        "Physical astronomy and planet surface locations are application layers.",
      ],
    };
  }

  const api = {
    CONFIG,
    getWorldSpaceTimeCoordinates,
    millisecondsSinceEpoch,
    normalize360,
    fractionalPart,
    completedCycles,
    cycleFraction,
    roundNumber,
    formatNumber,
    parseDate,
    validateFinite,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.WorldSpaceTimeCoordinates = api;
})(typeof window !== "undefined" ? window : globalThis);
