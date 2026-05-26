/*
 * GeoNames shared place loader.
 *
 * This is the single browser entry point for Earth-System apps that need
 * cities, towns, and villages. Apps should ask this module for normalized
 * places, then apply their own domain filters and visual layers on top.
 */
(() => {
  const DEFAULT_DATA_URL = '../shared/assets/data/geonames-cities500.tsv';

  function normalizeSearch(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function labelForParts(city, cityAscii, adminName, country) {
    const name = city || cityAscii || 'Unknown city';
    const region = adminName ? `${adminName}, ${country}` : country;
    return region ? `${name}, ${region}` : name;
  }

  function labelForPlace(place) {
    if (!place) return '';
    return place.placeLabel || labelForParts(place.city, place.cityAscii, place.adminName, place.country)
      || `${Number(place.lat).toFixed(2)}, ${Number(place.lng).toFixed(2)}`;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (ch === '"' && quoted && next === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        row.push(value);
        value = '';
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && next === '\n') i += 1;
        row.push(value);
        if (row.some(cell => cell.trim())) rows.push(row);
        row = [];
        value = '';
      } else {
        value += ch;
      }
    }
    if (value || row.length) {
      row.push(value);
      rows.push(row);
    }
    return rows;
  }

  function parseTSV(text) {
    return text.trimEnd().split(/\r?\n/).map(line => line.split('\t'));
  }

  function normalizeRows(rows, options = {}) {
    const {
      requirePopulation = false,
      includeSearchText = true,
      sortByPopulation = true,
    } = options;
    const header = rows.shift().map(h => h.trim().toLowerCase());
    const idx = key => header.indexOf(key);
    const cityIdx = idx('name') >= 0 ? idx('name') : idx('city');
    const asciiIdx = idx('ascii') >= 0 ? idx('ascii') : idx('city_ascii');
    const adminIdx = idx('adminname') >= 0 ? idx('adminname') : idx('admin_name');
    const countryIdx = idx('countryname') >= 0 ? idx('countryname') : idx('country');
    const isoIdx = idx('country') >= 0 ? idx('country') : idx('iso2');
    const latIdx = idx('lat');
    const lngIdx = idx('lng');
    const popIdx = idx('population');
    const elevationIdx = idx('elevation');
    const timezoneIdx = idx('timezone');
    const featureIdx = idx('feature');
    const geonameIdx = idx('geonameid');

    const places = rows.map((row, index) => {
      const city = (row[cityIdx] || row[asciiIdx] || '').trim();
      const cityAscii = (row[asciiIdx] || row[cityIdx] || '').trim();
      const adminName = (row[adminIdx] || '').trim();
      const country = (row[countryIdx] || '').trim();
      const iso2 = (row[isoIdx] || '').trim();
      const lat = Number(row[latIdx]);
      const lng = Number(row[lngIdx]);
      const pop = Number(row[popIdx]) || 0;
      const elevation = Number(row[elevationIdx]);
      const timezone = (row[timezoneIdx] || '').trim();
      const feature = (row[featureIdx] || '').trim();
      const placeLabel = labelForParts(city, cityAscii, adminName, country);
      const place = {
        id: row[geonameIdx] ? `geonames-${row[geonameIdx]}` : `city-${index}`,
        geonameId: row[geonameIdx] || null,
        city,
        cityAscii,
        adminName,
        country,
        iso2,
        lat,
        lng,
        pop,
        elevation: Number.isFinite(elevation) ? elevation : null,
        timezone,
        feature,
        placeLabel,
      };
      if (includeSearchText) {
        place.searchText = normalizeSearch(`${placeLabel} ${cityAscii} ${country} ${iso2} ${timezone}`);
      }
      return place;
    }).filter(place =>
      place.city &&
      Number.isFinite(place.lat) &&
      Number.isFinite(place.lng) &&
      (!requirePopulation || place.pop > 0)
    );

    return sortByPopulation ? places.sort((a, b) => b.pop - a.pop) : places;
  }

  async function loadPlaces(options = {}) {
    const url = options.url || DEFAULT_DATA_URL;
    const res = await fetch(url, { cache: options.cache || 'no-store' });
    if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
    const text = await res.text();
    const rows = url.endsWith('.tsv') ? parseTSV(text) : parseCSV(text);
    return normalizeRows(rows, options);
  }

  window.GeoNames = {
    DEFAULT_DATA_URL,
    labelForParts,
    labelForPlace,
    loadPlaces,
    normalizeRows,
    normalizeSearch,
    parseCSV,
    parseTSV,
  };
})();
