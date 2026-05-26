(() => {
  const DATA_URL = '../shared/assets/data/geonames-cities500.tsv';
  const DEFAULT_CITY = 'Panjim';
  const DEFAULT_ZERO_EPOCH_UTC = '1974-03-13T04:40:00Z';
  const ZERO_EPOCH_STORAGE_KEY = 'earth-clock-map.zeroEpochUTC';
  const CENTER = 110;
  const EM_LAYER_ID = 'wstc-em-coordinate-layer';
  const EM_SOURCE_ID = 'wstc-em-coordinate-source';
  const EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection', features: [] };
  const KNOWN_ALTITUDES = new Map([
    ['mexico|ciudad de mexico|mx', 2240],
    ['mexico city|ciudad de mexico|mx', 2240],
    ['pune|maharashtra|in', 560],
    ['mumbai|maharashtra|in', 14],
    ['goa|goa|in', 15],
    ['new york|new york|us', 10],
    ['victoria|british columbia|ca', 23],
    ['charlotte|north carolina|us', 229],
  ]);
  const TIMEZONE_DEFAULTS = new Map([
    ['Asia/Calcutta', { city: 'Panjim', admin: 'Goa', iso2: 'IN' }],
    ['Asia/Kolkata', { city: 'Panjim', admin: 'Goa', iso2: 'IN' }],
    ['America/Vancouver', { city: 'Victoria', admin: 'British Columbia', iso2: 'CA' }],
    ['America/Mexico_City', { city: 'Mexico City', admin: 'Mexico City', iso2: 'MX' }],
    ['America/New_York', { city: 'New York', admin: 'New York', iso2: 'US' }],
  ]);
  const clocks = {};
  const els = {
    citySearch: document.getElementById('citySearch'),
    clearCity: document.getElementById('clearCity'),
    suggestions: document.getElementById('citySuggestions'),
    status: document.getElementById('statusChip'),
    dayNightMeta: document.getElementById('dayNightMeta'),
    dayNightValue: document.getElementById('dayNightValue'),
    dayNightTitle: document.querySelector('.clock-card:first-child .clock-title'),
    seasonMeta: document.getElementById('seasonMeta'),
    seasonValue: document.getElementById('seasonValue'),
    coordinateTitle: document.querySelector('.coordinate-card .clock-title'),
    coordinateFocusLabel: document.getElementById('coordinateFocusLabel'),
    wstcMeta: document.getElementById('wstcMeta'),
    wstcValue: document.getElementById('wstcValue'),
    estcLabelName: document.querySelector('.coord-labels div:first-child b'),
    wstcLabelName: document.querySelector('.coord-labels div:nth-child(2) b'),
    estcFullLabel: document.getElementById('estcFullLabel'),
    wstcFullLabel: document.getElementById('wstcFullLabel'),
    pZeroButton: document.getElementById('pZeroButton'),
    zeroEpochInput: document.getElementById('zeroEpochInput'),
    resetEpochButton: document.getElementById('resetEpochButton'),
    mapCoordinateChip: document.getElementById('mapCoordinateChip'),
  };

  let cities = [];
  let selectedCity = null;
  let activeSuggestion = -1;
  let lastClock = null;
  let currentDayNight = null;
  let currentSeason = null;
  let earthApi = null;
  let emLayerRegistered = false;
  let displayedFocusCity = null;
  let wstcFocusAnimation = null;
  let pendingMapReentry = null;
  let currentPZero = null;
  let zeroEpochUTC = loadZeroEpochUTC();
  let activeTarget = 'earth';
  const skyDrag = { active: false };
  const seasonDrag = { active: false };

  function toEpochInputValue(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '1974-03-13T04:40';
    return date.toISOString().slice(0, 16);
  }

  function epochInputToUTC(value) {
    if (!value) return DEFAULT_ZERO_EPOCH_UTC;
    const date = new Date(`${value}:00Z`);
    if (Number.isNaN(date.getTime())) return DEFAULT_ZERO_EPOCH_UTC;
    return date.toISOString();
  }

  function loadZeroEpochUTC() {
    try {
      const saved = localStorage.getItem(ZERO_EPOCH_STORAGE_KEY);
      if (saved && !Number.isNaN(new Date(saved).getTime())) return new Date(saved).toISOString();
    } catch (error) {
      // Storage can be unavailable in private or embedded browser contexts.
    }
    return DEFAULT_ZERO_EPOCH_UTC;
  }

  function saveZeroEpochUTC(value) {
    try {
      localStorage.setItem(ZERO_EPOCH_STORAGE_KEY, value);
    } catch (error) {
      // The control still works for the current session if persistence is blocked.
    }
  }

  async function loadCities() {
    return window.GeoNames.loadPlaces({ url: DATA_URL });
  }

  function labelForCity(city) {
    return window.GeoNames.labelForPlace(city);
  }

  function shortPlace(city) {
    const label = city?.city || city?.cityAscii || 'Earth';
    return label.length > 16 ? `${label.slice(0, 14)}...` : label;
  }

  function cityAltitudeMeters(city) {
    if (!city) return 0;
    if (Number.isFinite(city.elevation)) return city.elevation;
    const keys = [
      `${normalizeSearch(city.cityAscii)}|${normalizeSearch(city.adminName)}|${normalizeSearch(city.iso2)}`,
      `${normalizeSearch(city.city)}|${normalizeSearch(city.adminName)}|${normalizeSearch(city.iso2)}`,
    ];
    for (const key of keys) {
      if (KNOWN_ALTITUDES.has(key)) return KNOWN_ALTITUDES.get(key);
    }
    return 0;
  }

  function normalizeSearch(value) {
    return window.GeoNames.normalizeSearch(value);
  }

  function svg(tag, attrs = {}, text = '') {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    if (text) node.textContent = text;
    return node;
  }

  function setStackedSvgLabel(node, top, bottom = '') {
    const x = node.getAttribute('x');
    node.textContent = '';
    const topLine = svg('tspan', { x, y: 160 }, top);
    node.appendChild(topLine);
    if (bottom) node.appendChild(svg('tspan', { x, dy: 10 }, bottom));
  }

  function polar(angleDegrees, radius) {
    const radians = (angleDegrees - 90) * Math.PI / 180;
    return {
      x: CENTER + Math.cos(radians) * radius,
      y: CENTER + Math.sin(radians) * radius,
    };
  }

  function arcPath(radius, startDegrees, endDegrees) {
    const start = polar(startDegrees, radius);
    const end = polar(endDegrees, radius);
    const sweep = ((endDegrees - startDegrees) % 360 + 360) % 360;
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
  }

  function prepareCircle(circle, radius) {
    const circumference = 2 * Math.PI * radius;
    circle.style.strokeDasharray = `${circumference}`;
    circle.style.strokeDashoffset = `${circumference}`;
    circle.style.transformOrigin = `${CENTER}px ${CENTER}px`;
    circle.style.transform = 'rotate(-90deg)';
  }

  function setCircleArc(circle, radius, degrees) {
    const circumference = 2 * Math.PI * radius;
    const normalized = ((degrees % 360) + 360) % 360;
    circle.style.strokeDashoffset = `${circumference * (1 - normalized / 360)}`;
  }

  function setHand(line, degrees, radius) {
    const point = polar(degrees, radius);
    line.setAttribute('x1', CENTER);
    line.setAttribute('y1', CENTER);
    line.setAttribute('x2', point.x.toFixed(3));
    line.setAttribute('y2', point.y.toFixed(3));
  }

  function drawTicks(group, outer = 100) {
    for (let degree = 0; degree < 360; degree += 15) {
      const major = degree % 90 === 0;
      const a = polar(degree, outer);
      const b = polar(degree, major ? outer - 10 : outer - 5);
      group.appendChild(svg('line', {
        class: major ? 'tick major' : 'tick',
        x1: a.x.toFixed(3),
        y1: a.y.toFixed(3),
        x2: b.x.toFixed(3),
        y2: b.y.toFixed(3),
      }));
    }
  }

  function createConcentricClock(svgId, labels) {
    const root = document.getElementById(svgId);
    root.innerHTML = '';
    const tickGroup = svg('g');
    drawTicks(tickGroup);
    root.appendChild(svg('circle', { cx: CENTER, cy: CENTER, r: 104, fill: 'rgba(3,8,14,.34)', stroke: 'rgba(255,255,255,.16)', 'stroke-width': 1 }));
    root.appendChild(tickGroup);
    const defs = [
      { key: 'outer', radius: 82, color: labels.outer.color, width: 11 },
      { key: 'middle', radius: 57, color: labels.middle.color, width: 9 },
      { key: 'inner', radius: 34, color: labels.inner.color, width: 7 },
    ];
    const parts = { hands: {} };
    defs.forEach(def => {
      root.appendChild(svg('circle', { class: 'ring-bg', cx: CENTER, cy: CENTER, r: def.radius }));
      root.appendChild(svg('circle', { class: 'arc-track', cx: CENTER, cy: CENTER, r: def.radius, 'stroke-width': def.width }));
      const arc = svg('circle', { class: 'arc', cx: CENTER, cy: CENTER, r: def.radius, 'stroke-width': def.width, stroke: def.color, style: `color:${def.color}` });
      prepareCircle(arc, def.radius);
      root.appendChild(arc);
      parts[`${def.key}Arc`] = arc;
      parts[`${def.key}Radius`] = def.radius;
    });
    defs.forEach(def => {
      const hand = svg('line', { class: 'hand', stroke: def.color, 'stroke-width': def.key === 'outer' ? 3 : 2.3 });
      root.appendChild(hand);
      parts.hands[def.key] = hand;
    });
    root.appendChild(svg('circle', { class: 'pin', cx: CENTER, cy: CENTER, r: 5 }));
    root.appendChild(svg('text', { class: 'svg-label', x: CENTER, y: CENTER - 4 }, labels.center));
    root.appendChild(svg('text', { class: 'svg-small', x: CENTER, y: CENTER + 10 }, labels.sub));
    return parts;
  }

  function createWorldCoordinateClock() {
    const root = document.getElementById('wstcClock');
    root.innerHTML = '';
    const defs = svg('defs');
    const cityClip = svg('clipPath', { id: 'cityFocusClip' });
    cityClip.appendChild(svg('circle', { cx: CENTER, cy: CENTER, r: 32 }));
    defs.appendChild(cityClip);
    root.appendChild(defs);
    const tickGroup = svg('g');
    drawTicks(tickGroup);
    root.appendChild(svg('circle', { cx: CENTER, cy: CENTER, r: 104, fill: 'rgba(3,8,14,.34)', stroke: 'rgba(255,255,255,.16)', 'stroke-width': 1 }));
    root.appendChild(tickGroup);
    const galaxyRadius = 92;
    const starRadius = 70;
    const planetRadius = 49;
    [
      { radius: galaxyRadius, width: 8, color: 'var(--galaxy)' },
      { radius: starRadius, width: 10, color: 'var(--orbit)' },
      { radius: planetRadius, width: 10, color: 'var(--planet)' },
    ].forEach(def => {
      root.appendChild(svg('circle', { class: 'ring-bg', cx: CENTER, cy: CENTER, r: def.radius }));
      root.appendChild(svg('circle', { class: 'arc-track', cx: CENTER, cy: CENTER, r: def.radius, 'stroke-width': def.width }));
    });
    const galaxyArc = svg('circle', { class: 'arc', cx: CENTER, cy: CENTER, r: galaxyRadius, 'stroke-width': 8, stroke: 'var(--galaxy)', style: 'color:var(--galaxy)' });
    const starArc = svg('circle', { class: 'arc', cx: CENTER, cy: CENTER, r: starRadius, 'stroke-width': 10, stroke: 'var(--orbit)', style: 'color:var(--orbit)' });
    const planetArc = svg('circle', { class: 'arc', cx: CENTER, cy: CENTER, r: planetRadius, 'stroke-width': 10, stroke: 'var(--planet)', style: 'color:var(--planet)' });
    [galaxyArc, starArc, planetArc].forEach((arc, index) => prepareCircle(arc, [galaxyRadius, starRadius, planetRadius][index]));
    root.append(galaxyArc, starArc, planetArc);
    const focus = svg('g', { 'clip-path': 'url(#cityFocusClip)' });
    focus.appendChild(svg('circle', { cx: CENTER, cy: CENTER, r: 32, fill: 'rgba(3,8,14,.9)' }));
    const mapTile = svg('image', { x: 78, y: 78, width: 64, height: 64, preserveAspectRatio: 'xMidYMid slice', opacity: '.92' });
    focus.appendChild(mapTile);
    root.appendChild(focus);
    root.appendChild(svg('circle', { cx: CENTER, cy: CENTER, r: 32, fill: 'none', stroke: 'rgba(71,85,105,.54)', 'stroke-width': 1.1 }));
    root.appendChild(svg('circle', { cx: CENTER, cy: CENTER, r: 10, fill: 'none', stroke: 'rgba(148,163,184,.42)', 'stroke-width': .9 }));
    root.appendChild(svg('circle', { cx: CENTER, cy: CENTER, r: 1.7, fill: 'rgba(71,85,105,.82)' }));
    [
      { x1: CENTER, y1: CENTER - 32, x2: CENTER, y2: CENTER - 24 },
      { x1: CENTER + 32, y1: CENTER, x2: CENTER + 24, y2: CENTER },
      { x1: CENTER, y1: CENTER + 32, x2: CENTER, y2: CENTER + 24 },
      { x1: CENTER - 32, y1: CENTER, x2: CENTER - 24, y2: CENTER },
    ].forEach(tick => {
      root.appendChild(svg('line', { ...tick, stroke: 'rgba(51,65,85,.82)', 'stroke-width': 1.45, 'stroke-linecap': 'round' }));
    });
    return {
      planetArc,
      planetRadius,
      starArc,
      starRadius,
      galaxyArc,
      galaxyRadius,
      mapTile,
    };
  }

  function createSeasonClock() {
    const root = document.getElementById('seasonClock');
    root.innerHTML = '';
    const defs = svg('defs');
    const skyGradient = svg('linearGradient', { id: 'seasonSkyGradient', x1: '0', y1: '0', x2: '0', y2: '1' });
    const skyTop = svg('stop', { offset: '0%', 'stop-color': '#7dd3fc' });
    const skyBottom = svg('stop', { offset: '100%', 'stop-color': '#dcfce7' });
    skyGradient.append(skyTop, skyBottom);
    const groundGradient = svg('linearGradient', { id: 'seasonGroundGradient', x1: '0', y1: '0', x2: '0', y2: '1' });
    const groundTop = svg('stop', { offset: '0%', 'stop-color': '#86efac' });
    const groundBottom = svg('stop', { offset: '100%', 'stop-color': '#2f6f3e' });
    groundGradient.append(groundTop, groundBottom);
    defs.append(skyGradient, groundGradient);
    root.appendChild(defs);
    root.appendChild(svg('rect', { x: 8, y: 8, width: 204, height: 102, rx: 7, fill: 'url(#seasonSkyGradient)' }));
    const sun = svg('circle', { cx: 178, cy: 34, r: 12, fill: '#fff4b8', opacity: '.86' });
    const cloud = svg('path', { d: 'M31 38c4-7 16-8 22-1 7-2 17 3 18 11H16c1-7 7-12 15-10Z', fill: 'rgba(255,255,255,.55)' });
    const hill = svg('path', { d: 'M8 103 C43 84 73 102 111 84 C145 68 172 90 212 76 L212 132 L8 132 Z', fill: 'url(#seasonGroundGradient)' });
    const treeTrunk = svg('rect', { x: 58, y: 80, width: 8, height: 35, rx: 3, fill: '#6b3f25' });
    const treeCrown = svg('circle', { cx: 62, cy: 76, r: 20, fill: '#58b86d' });
    const accent = svg('path', { d: 'M103 105 C128 95 158 96 194 88', fill: 'none', stroke: 'rgba(255,255,255,.45)', 'stroke-width': 3, 'stroke-linecap': 'round' });
    const snow = svg('g');
    for (let i = 0; i < 10; i += 1) {
      snow.appendChild(svg('circle', { cx: 24 + i * 18, cy: 23 + (i % 3) * 17, r: 1.5, fill: 'rgba(255,255,255,.85)' }));
    }
    const scale = svg('line', { x1: 18, y1: 145, x2: 202, y2: 145, stroke: 'rgba(255,255,255,.28)', 'stroke-width': 6, 'stroke-linecap': 'round' });
    const scaleFill = svg('line', { x1: 18, y1: 145, x2: 18, y2: 145, stroke: '#86efac', 'stroke-width': 6, 'stroke-linecap': 'round' });
    const marker = svg('circle', { cx: 18, cy: 145, r: 6.2, fill: '#f9fdff', stroke: 'rgba(3,8,14,.88)', 'stroke-width': 2 });
    const hitArea = svg('rect', { x: 8, y: 132, width: 204, height: 34, fill: 'transparent', style: 'cursor:pointer' });
    const leftLabel = svg('text', { class: 'svg-small', x: 24, y: 162 }, 'spring');
    const midLabel = svg('text', { class: 'svg-small', x: 110, y: 162 }, 'summer');
    const rightLabel = svg('text', { class: 'svg-small', x: 196, y: 162 }, 'winter');
    const seasonLabel = svg('text', { class: 'svg-label', x: 110, y: 18 }, 'SEASON');
    root.append(sun, cloud, hill, treeTrunk, treeCrown, accent, snow, scale, scaleFill, marker, hitArea, leftLabel, midLabel, rightLabel, seasonLabel);
    return { root, skyTop, skyBottom, groundTop, groundBottom, sun, cloud, hill, treeTrunk, treeCrown, accent, snow, scaleFill, marker, hitArea, leftLabel, midLabel, rightLabel, seasonLabel };
  }

  function createDayNightClock() {
    const root = document.getElementById('dayNightClock');
    root.innerHTML = '';
    const defs = svg('defs');
    const skyGradient = svg('linearGradient', { id: 'localSkyGradient', x1: '0', y1: '0', x2: '0', y2: '1' });
    const skyTop = svg('stop', { offset: '0%', 'stop-color': '#59bfff' });
    const skyMid = svg('stop', { offset: '58%', 'stop-color': '#bdeaff' });
    const skyBottom = svg('stop', { offset: '100%', 'stop-color': '#ffd79a' });
    skyGradient.append(skyTop, skyMid, skyBottom);
    const groundGradient = svg('linearGradient', { id: 'localGroundGradient', x1: '0', y1: '0', x2: '0', y2: '1' });
    const groundTop = svg('stop', { offset: '0%', 'stop-color': '#82c66f' });
    const groundBottom = svg('stop', { offset: '100%', 'stop-color': '#244c2e' });
    groundGradient.append(groundTop, groundBottom);
    defs.append(skyGradient, groundGradient);
    root.appendChild(defs);
    const skyRect = svg('rect', { x: 8, y: 8, width: 204, height: 102, rx: 7, fill: 'url(#localSkyGradient)' });
    const sunGlow = svg('circle', { cx: 20, cy: 92, r: 22, fill: '#ffd36f', opacity: '.30' });
    const sun = svg('circle', { cx: 20, cy: 92, r: 8, fill: '#fff4b8', stroke: 'rgba(255,255,255,.86)', 'stroke-width': 1.4 });
    const moon = svg('circle', { cx: 176, cy: 42, r: 8, fill: '#dbeafe', opacity: '0' });
    const stars = svg('g', { opacity: '0' });
    [
      [24, 25, 1.1], [49, 31, .8], [73, 20, 1], [96, 39, .7],
      [121, 27, 1.1], [150, 22, .75], [191, 36, .9], [169, 55, .65],
    ].forEach(([cx, cy, r]) => {
      stars.appendChild(svg('circle', { cx, cy, r, fill: 'rgba(226,240,255,.9)' }));
    });
    const cloud1 = svg('path', { d: 'M139 34c5-7 17-7 22 0 7-2 15 3 16 10H121c1-7 9-12 18-10Z', fill: 'rgba(255,255,255,.58)' });
    const cloud2 = svg('path', { d: 'M42 43c4-5 12-5 16 0 6-1 12 3 13 8H28c1-6 7-10 14-8Z', fill: 'rgba(255,255,255,.36)' });
    const horizon = svg('path', { d: 'M8 102 C38 88 62 96 89 88 C122 77 153 91 212 82 L212 122 L8 122 Z', fill: 'rgba(70,126,75,.84)' });
    const ground = svg('path', { d: 'M8 102 C43 90 71 101 102 95 C139 87 171 99 212 90 L212 134 L8 134 Z', fill: 'url(#localGroundGradient)' });
    const earthCurve = svg('path', { d: 'M8 132 C61 122 139 122 212 132', fill: 'none', stroke: 'rgba(183,228,190,.80)', 'stroke-width': 2 });
    const scale = svg('line', { x1: 18, y1: 145, x2: 202, y2: 145, stroke: 'rgba(255,255,255,.28)', 'stroke-width': 6, 'stroke-linecap': 'round' });
    const scaleFill = svg('line', { x1: 18, y1: 145, x2: 18, y2: 145, stroke: '#f7c95f', 'stroke-width': 6, 'stroke-linecap': 'round' });
    const marker = svg('circle', { cx: 18, cy: 145, r: 6.2, fill: '#f9fdff', stroke: 'rgba(3,8,14,.88)', 'stroke-width': 2 });
    const hitArea = svg('rect', { x: 8, y: 132, width: 204, height: 34, fill: 'transparent', style: 'cursor:pointer' });
    const leftLabel = svg('text', { class: 'svg-small', x: 24, y: 160 }, 'sunrise');
    const midLabel = svg('text', { class: 'svg-small', x: 110, y: 166 }, 'noon');
    const rightLabel = svg('text', { class: 'svg-small', x: 196, y: 160 }, 'sunset');
    const skyLabel = svg('text', { class: 'svg-label', x: 110, y: 18 }, 'LOCAL SKY');
    root.append(skyRect, stars, moon, sunGlow, sun, cloud1, cloud2, horizon, ground, earthCurve, scale, scaleFill, marker, hitArea, leftLabel, midLabel, rightLabel, skyLabel);
    return { root, skyTop, skyMid, skyBottom, groundTop, groundBottom, sunGlow, sun, moon, stars, cloud1, cloud2, scaleFill, marker, hitArea, leftLabel, midLabel, rightLabel, skyLabel };
  }

  function dayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  }

  function solarEventUTC(date, lat, lng, sunrise) {
    const zenith = 90.833;
    const n = dayOfYear(date);
    const lngHour = lng / 15;
    const t = n + ((sunrise ? 6 : 18) - lngHour) / 24;
    const meanAnomaly = (0.9856 * t) - 3.289;
    let trueLongitude = meanAnomaly + (1.916 * Math.sin(degToRad(meanAnomaly))) + (0.020 * Math.sin(2 * degToRad(meanAnomaly))) + 282.634;
    trueLongitude = normalize360(trueLongitude);
    let rightAscension = radToDeg(Math.atan(0.91764 * Math.tan(degToRad(trueLongitude))));
    rightAscension = normalize360(rightAscension);
    const lQuadrant = Math.floor(trueLongitude / 90) * 90;
    const raQuadrant = Math.floor(rightAscension / 90) * 90;
    rightAscension = (rightAscension + lQuadrant - raQuadrant) / 15;
    const sinDec = 0.39782 * Math.sin(degToRad(trueLongitude));
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosHour = (Math.cos(degToRad(zenith)) - (sinDec * Math.sin(degToRad(lat)))) / (cosDec * Math.cos(degToRad(lat)));
    if (cosHour > 1 || cosHour < -1) return null;
    const hourAngle = sunrise ? 360 - radToDeg(Math.acos(cosHour)) : radToDeg(Math.acos(cosHour));
    const localMeanTime = (hourAngle / 15) + rightAscension - (0.06571 * t) - 6.622;
    const rawUtcHour = localMeanTime - lngHour;
    const dayOffset = Math.floor(rawUtcHour / 24);
    const utcHour = normalizeHour(rawUtcHour);
    const event = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    event.setUTCDate(event.getUTCDate() + dayOffset);
    event.setUTCMinutes(Math.round(utcHour * 60));
    return event;
  }

  function pAt(date, city) {
    return window.EarthSpaceTimeCoordinates.getEarthSpaceTimeCoordinates({
      time: date,
      epochUTC: zeroEpochUTC,
      latitude: city.lat,
      longitude: city.lng,
      altitudeMeters: 0,
      labelPrecision: { G: 6, S: 2, P: 2, E: 3, M: 3, V: 0 },
    }).wstc.P;
  }

  function pPhaseFraction(currentP, startP, endP) {
    const span = normalize360(endP - startP) || 360;
    return clamp01(normalize360(currentP - startP) / span);
  }

  function timePhaseFraction(nowValue, startValue, endValue) {
    if (!Number.isFinite(nowValue) || !Number.isFinite(startValue) || !Number.isFinite(endValue) || endValue <= startValue) return 0;
    return clamp01((nowValue - startValue) / (endValue - startValue));
  }

  function skyLabelFor(mode, fraction) {
    if (mode === 'day') {
      if (fraction < 0.10) return 'sunrise glow';
      if (fraction < 0.37) return 'blue morning';
      if (fraction < 0.63) return 'full sun';
      if (fraction < 0.90) return 'blue afternoon';
      return 'dusk glow';
    }
    if (fraction < 0.10) return 'evening twilight';
    if (fraction < 0.37) return 'deep night';
    if (fraction < 0.63) return 'moonlit arc';
    if (fraction < 0.90) return 'pre-dawn night';
    return 'dawn edge';
  }

  function skyPalette(mode, fraction) {
    if (mode === 'day') {
      if (fraction < 0.12) return ['#ff9168', '#ffd49a', '#fff0c8'];
      if (fraction < 0.38) return ['#4fb7ff', '#a7e7ff', '#f5fbff'];
      if (fraction < 0.64) return ['#278cef', '#8ed8ff', '#fff4b8'];
      if (fraction < 0.90) return ['#45a7ff', '#b9eaff', '#d6f2ff'];
      return ['#f97373', '#fbbf77', '#533f8f'];
    }
    if (fraction < 0.12) return ['#5840a5', '#f97373', '#171938'];
    if (fraction < 0.40) return ['#111a3d', '#263a7a', '#050816'];
    if (fraction < 0.65) return ['#182652', '#3d5fa7', '#0a1028'];
    if (fraction < 0.90) return ['#0f1838', '#263a7a', '#070b19'];
    return ['#243f8f', '#ff9f6e', '#10142f'];
  }

  function updateSkyWindow(clock, state) {
    const fraction = clamp01(state.t / 12);
    const [top, mid, bottom] = skyPalette(state.mode, fraction);
    clock.skyTop.setAttribute('stop-color', top);
    clock.skyMid.setAttribute('stop-color', mid);
    clock.skyBottom.setAttribute('stop-color', bottom);
    if (state.mode === 'day') {
      clock.groundTop.setAttribute('stop-color', '#82c66f');
      clock.groundBottom.setAttribute('stop-color', '#244c2e');
    } else {
      clock.groundTop.setAttribute('stop-color', '#365f86');
      clock.groundBottom.setAttribute('stop-color', '#10243d');
    }
    const x = 18 + fraction * 184;
    const arcY = state.mode === 'day'
      ? 100 - Math.sin(fraction * Math.PI) * 74
      : 104 + Math.sin(fraction * Math.PI) * 18;
    const sunColor = state.mode === 'day' ? '#fff4b8' : '#dbeafe';
    const glowOpacity = state.mode === 'day' ? 0.32 + Math.sin(fraction * Math.PI) * 0.30 : 0.12;
    clock.sun.setAttribute('cx', x.toFixed(3));
    clock.sun.setAttribute('cy', arcY.toFixed(3));
    clock.sun.setAttribute('fill', sunColor);
    clock.sun.setAttribute('opacity', state.mode === 'day' ? '1' : '.64');
    clock.sunGlow.setAttribute('cx', x.toFixed(3));
    clock.sunGlow.setAttribute('cy', arcY.toFixed(3));
    clock.sunGlow.setAttribute('fill', state.mode === 'day' ? '#ffd36f' : '#b7d4ff');
    clock.sunGlow.setAttribute('opacity', glowOpacity.toFixed(2));
    clock.stars.setAttribute('opacity', state.mode === 'day' ? '0' : (0.26 + Math.sin(fraction * Math.PI) * 0.58).toFixed(2));
    clock.moon.setAttribute('opacity', state.mode === 'day' ? '0' : (0.42 + Math.sin(fraction * Math.PI) * 0.38).toFixed(2));
    clock.moon.setAttribute('cx', (186 - fraction * 88).toFixed(3));
    clock.moon.setAttribute('cy', (62 - Math.sin(fraction * Math.PI) * 38).toFixed(3));
    clock.scaleFill.setAttribute('x2', x.toFixed(3));
    clock.scaleFill.setAttribute('stroke', state.mode === 'day' ? '#f7c95f' : '#8ec5ff');
    clock.marker.setAttribute('cx', x.toFixed(3));
    clock.cloud1.setAttribute('opacity', state.mode === 'day' ? '.78' : '.16');
    clock.cloud2.setAttribute('opacity', state.mode === 'day' ? '.64' : '.12');
    const startName = state.mode === 'day' ? 'sunrise' : 'sunset';
    const midName = state.mode === 'day' ? 'noon' : 'midnight';
    const endName = state.mode === 'day' ? 'sunset' : 'sunrise';
    setStackedSvgLabel(clock.leftLabel, startName, state.startLabel);
    clock.midLabel.textContent = midName;
    setStackedSvgLabel(clock.rightLabel, endName, state.endLabel);
    clock.skyLabel.textContent = state.skyLabel.toUpperCase();
  }

  function updateSeasonWindow(clock, season) {
    const palettes = {
      spring: { sky: ['#78d7ff', '#dcfce7'], ground: ['#86efac', '#2f7d45'], crown: '#58b86d', accent: '#ffd1dc', sun: '#fff4b8', snow: 0, cloud: .55 },
      summer: { sky: ['#39a7ff', '#fff0a8'], ground: ['#a3e635', '#3f7f2f'], crown: '#3fa34d', accent: '#fef08a', sun: '#ffe36e', snow: 0, cloud: .22 },
      autumn: { sky: ['#fda66b', '#fee2b3'], ground: ['#d97706', '#78350f'], crown: '#f97316', accent: '#fed7aa', sun: '#ffd28a', snow: 0, cloud: .42 },
      winter: { sky: ['#93c5fd', '#e0f2fe'], ground: ['#dbeafe', '#94a3b8'], crown: '#e5edf7', accent: '#ffffff', sun: '#f8fbff', snow: 1, cloud: .75 },
      hot: { sky: ['#38bdf8', '#fde68a'], ground: ['#c7d85c', '#8a6f2a'], crown: '#74a84f', accent: '#fbbf24', sun: '#ffe36e', snow: 0, cloud: .18 },
      monsoon: { sky: ['#475569', '#93c5fd'], ground: ['#22c55e', '#166534'], crown: '#16a34a', accent: '#7dd3fc', sun: '#dbeafe', snow: 0, cloud: .86 },
      'post-monsoon': { sky: ['#60a5fa', '#bbf7d0'], ground: ['#4ade80', '#15803d'], crown: '#22c55e', accent: '#a7f3d0', sun: '#fff4b8', snow: 0, cloud: .48 },
      dry: { sky: ['#7dd3fc', '#fed7aa'], ground: ['#b7b45b', '#6b6f31'], crown: '#84a15a', accent: '#fde68a', sun: '#ffe8a3', snow: 0, cloud: .18 },
      warming: { sky: ['#67e8f9', '#dcfce7'], ground: ['#86efac', '#2f7d45'], crown: '#58b86d', accent: '#bef264', sun: '#fff4b8', snow: 0, cloud: .42 },
      wet: { sky: ['#64748b', '#bae6fd'], ground: ['#22c55e', '#14532d'], crown: '#16a34a', accent: '#7dd3fc', sun: '#dbeafe', snow: 0, cloud: .86 },
      lush: { sky: ['#38bdf8', '#dcfce7'], ground: ['#4ade80', '#166534'], crown: '#22c55e', accent: '#bbf7d0', sun: '#fff4b8', snow: 0, cloud: .44 },
    };
    const p = palettes[season.name] || palettes.spring;
    const x = 18 + normalize360(season.s) / 360 * 184;
    clock.skyTop.setAttribute('stop-color', p.sky[0]);
    clock.skyBottom.setAttribute('stop-color', p.sky[1]);
    clock.groundTop.setAttribute('stop-color', p.ground[0]);
    clock.groundBottom.setAttribute('stop-color', p.ground[1]);
    clock.treeCrown.setAttribute('fill', p.crown);
    clock.accent.setAttribute('stroke', p.accent);
    clock.sun.setAttribute('fill', p.sun);
    clock.cloud.setAttribute('opacity', p.cloud);
    clock.snow.setAttribute('opacity', p.snow);
    clock.scaleFill.setAttribute('x2', x.toFixed(3));
    clock.scaleFill.setAttribute('stroke', p.accent);
    clock.marker.setAttribute('cx', x.toFixed(3));
    clock.leftLabel.textContent = season.labels[0];
    clock.midLabel.textContent = season.labels[1];
    clock.rightLabel.textContent = season.labels[3];
    clock.seasonLabel.textContent = `${season.climate.toUpperCase()} ${season.name.toUpperCase()}`;
  }

  function skyFractionFromEvent(event) {
    const rect = clocks.dayNight.root.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 220;
    return clamp01((x - 18) / 184);
  }

  function seasonFractionFromEvent(event) {
    const source = event.touches ? event.touches[0] : event;
    const rect = clocks.season.root.getBoundingClientRect();
    const x = ((source.clientX - rect.left) / rect.width) * 220;
    return clamp01((x - 18) / 184);
  }

  function previewSkyAtFraction(fraction) {
    if (!currentDayNight) return;
    const mode = currentDayNight.mode === 'night' ? 'night' : 'day';
    const preview = {
      ...currentDayNight,
      mode,
      t: fraction * 12,
      skyLabel: skyLabelFor(mode, fraction),
    };
    const previewP = currentDayNight.start && currentDayNight.end
      ? normalize360(pAt(currentDayNight.start, selectedCity) + normalize360(pAt(currentDayNight.end, selectedCity) - pAt(currentDayNight.start, selectedCity)) * fraction)
      : null;
    updateSkyWindow(clocks.dayNight, preview);
    els.dayNightMeta.textContent = `${shortPlace(selectedCity)} | preview ${preview.skyLabel}`;
    els.dayNightValue.textContent = previewP === null
      ? `T${preview.t.toFixed(2)}`
      : `T${preview.t.toFixed(2)} | P${previewP.toFixed(2)}°`;
  }

  function bindSkySlider() {
    const startDrag = event => {
      event.preventDefault();
      skyDrag.active = true;
      clocks.dayNight.root.setPointerCapture?.(event.pointerId);
      previewSkyAtFraction(skyFractionFromEvent(event));
    };
    const moveDrag = event => {
      if (!skyDrag.active) return;
      event.preventDefault();
      previewSkyAtFraction(skyFractionFromEvent(event));
    };
    const stopDrag = event => {
      if (!skyDrag.active) return;
      skyDrag.active = false;
      clocks.dayNight.root.releasePointerCapture?.(event.pointerId);
      updateClock();
    };
    clocks.dayNight.hitArea.addEventListener('pointerdown', startDrag);
    clocks.dayNight.marker.addEventListener('pointerdown', startDrag);
    clocks.dayNight.root.addEventListener('pointermove', moveDrag);
    clocks.dayNight.root.addEventListener('pointerup', stopDrag);
    clocks.dayNight.root.addEventListener('pointercancel', stopDrag);
    clocks.dayNight.root.addEventListener('lostpointercapture', () => {
      if (!skyDrag.active) return;
      skyDrag.active = false;
      updateClock();
    });
  }

  function previewSeasonAtFraction(fraction) {
    if (!selectedCity) return;
    const preview = seasonAtFraction(fraction, selectedCity);
    updateSeasonWindow(clocks.season, preview);
    els.seasonMeta.textContent = `${preview.climate} preview | ${preview.name}`;
    els.seasonValue.textContent = `O${Math.round((preview.s / 360) * 365)}`;
  }

  function bindSeasonSlider() {
    const startDrag = event => {
      event.preventDefault();
      seasonDrag.active = true;
      clocks.season.root.setPointerCapture?.(event.pointerId);
      previewSeasonAtFraction(seasonFractionFromEvent(event));
    };
    const moveDrag = event => {
      if (!seasonDrag.active) return;
      event.preventDefault();
      previewSeasonAtFraction(seasonFractionFromEvent(event));
    };
    const stopDrag = event => {
      if (!seasonDrag.active) return;
      seasonDrag.active = false;
      clocks.season.root.releasePointerCapture?.(event.pointerId);
      updateClock();
    };
    clocks.season.hitArea.addEventListener('pointerdown', startDrag);
    clocks.season.marker.addEventListener('pointerdown', startDrag);
    clocks.season.root.addEventListener('pointermove', moveDrag);
    clocks.season.root.addEventListener('pointerup', stopDrag);
    clocks.season.root.addEventListener('pointercancel', stopDrag);
    clocks.season.root.addEventListener('lostpointercapture', () => {
      if (!seasonDrag.active) return;
      seasonDrag.active = false;
      updateClock();
    });
    const startMouseDrag = event => {
      event.preventDefault();
      seasonDrag.active = true;
      previewSeasonAtFraction(seasonFractionFromEvent(event));
    };
    const moveMouseDrag = event => {
      if (!seasonDrag.active) return;
      event.preventDefault();
      previewSeasonAtFraction(seasonFractionFromEvent(event));
    };
    const stopMouseDrag = () => {
      if (!seasonDrag.active) return;
      seasonDrag.active = false;
      updateClock();
    };
    clocks.season.hitArea.addEventListener('mousedown', startMouseDrag);
    clocks.season.marker.addEventListener('mousedown', startMouseDrag);
    window.addEventListener('mousemove', moveMouseDrag);
    window.addEventListener('mouseup', stopMouseDrag);
    clocks.season.hitArea.addEventListener('touchstart', startMouseDrag, { passive: false });
    window.addEventListener('touchmove', moveMouseDrag, { passive: false });
    window.addEventListener('touchend', stopMouseDrag);
  }

  function localEventTime(event, city) {
    return event.date.getTime() + legacyOffsetMinutes(city, event.date) * 60000;
  }

  function solarEventsAround(now, city) {
    const events = [];
    const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    for (let offset = -2; offset <= 2; offset += 1) {
      const date = new Date(base.getTime());
      date.setUTCDate(date.getUTCDate() + offset);
      const sunrise = solarEventUTC(date, city.lat, city.lng, true);
      const sunset = solarEventUTC(date, city.lat, city.lng, false);
      if (sunrise) events.push({ type: 'sunrise', date: sunrise });
      if (sunset) events.push({ type: 'sunset', date: sunset });
    }
    return events
      .map(event => ({ ...event, localTime: localEventTime(event, city) }))
      .sort((a, b) => a.localTime - b.localTime);
  }

  function dayNightState(now, city) {
    const events = solarEventsAround(now, city);
    const nowLocal = now.getTime() + legacyOffsetMinutes(city, now) * 60000;
    const previous = [...events].reverse().find(event => event.localTime < nowLocal);
    const next = previous
      ? events.find(event => event.localTime >= nowLocal && event.type !== previous.type)
      : events.find(event => event.localTime >= nowLocal);
    if (!previous || !next) {
      const syntheticAngle = normalize360(((now.getUTCHours() * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 86400) * 360);
      return {
        mode: 'polar arc',
        t: syntheticAngle / 30,
        meta: 'polar daylight model',
        skyLabel: 'polar sky',
      };
    }
    const start = previous.date;
    const end = next.date;
    const mode = previous.type === 'sunrise' ? 'day' : 'night';
    const fraction = timePhaseFraction(nowLocal, previous.localTime, next.localTime);
    return {
      mode,
      t: fraction * 12,
      meta: `${formatClock(start)} to ${formatClock(end)}`,
      start,
      end,
      startLabel: formatLegacyLocal(start, city),
      endLabel: formatLegacyLocal(end, city),
      skyLabel: skyLabelFor(mode, fraction),
    };
  }

  function degToRad(v) {
    return v * Math.PI / 180;
  }

  function radToDeg(v) {
    return v * 180 / Math.PI;
  }

  function normalize360(v) {
    return ((v % 360) + 360) % 360;
  }

  function normalizeHour(v) {
    return ((v % 24) + 24) % 24;
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function osmTileUrl(city, zoom = 10) {
    const latRad = degToRad(Math.max(-85.0511, Math.min(85.0511, city.lat)));
    const n = 2 ** zoom;
    const x = Math.floor(((city.lng + 180) / 360) * n);
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function shortestLngDelta(from, to) {
    let delta = to - from;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  }

  function setWstcMapFocus(city, zoom = 10, scale = 1) {
    if (!city || !clocks.wstc?.mapTile) return;
    clocks.wstc.mapTile.setAttribute('href', osmTileUrl(city, zoom));
    clocks.wstc.mapTile.setAttribute('transform', `translate(${CENTER} ${CENTER}) scale(${scale.toFixed(3)}) translate(${-CENTER} ${-CENTER})`);
    clocks.wstc.mapTile.setAttribute('opacity', '.94');
    if (els.coordinateFocusLabel) els.coordinateFocusLabel.textContent = labelForCity(city);
    displayedFocusCity = city;
  }

  function animateWstcMapFocus(fromCity, toCity, duration = 4200) {
    if (!fromCity || !toCity || !clocks.wstc?.mapTile) {
      setWstcMapFocus(toCity);
      return;
    }
    if (wstcFocusAnimation) cancelAnimationFrame(wstcFocusAnimation);
    const start = performance.now();
    const lngDelta = shortestLngDelta(fromCity.lng, toCity.lng);
    const step = now => {
      const raw = clamp01((now - start) / duration);
      const p = easeInOutCubic(raw);
      const zoom = Math.max(3, Math.min(10, Math.round(4 + p * 6)));
      const scale = 1.16 - Math.sin(p * Math.PI) * 0.18;
      const focusCity = {
        ...toCity,
        lat: fromCity.lat + (toCity.lat - fromCity.lat) * p,
        lng: normalizeLng(fromCity.lng + lngDelta * p),
      };
      setWstcMapFocus(focusCity, zoom, scale);
      if (raw < 1) {
        wstcFocusAnimation = requestAnimationFrame(step);
      } else {
        wstcFocusAnimation = null;
        setWstcMapFocus(toCity);
      }
    };
    wstcFocusAnimation = requestAnimationFrame(step);
  }

  function normalizeLng(lng) {
    let value = lng;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
  }

  function distanceKm(latA, lngA, latB, lngB) {
    const radiusKm = 6371;
    const dLat = degToRad(latB - latA);
    const dLng = degToRad(lngB - lngA);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(degToRad(latA)) * Math.cos(degToRad(latB)) * Math.sin(dLng / 2) ** 2;
    return radiusKm * 2 * Math.asin(Math.sqrt(a));
  }

  function nearestCityToPZero(p0Longitude) {
    if (!cities.length) return null;
    return cities.reduce((best, city) => {
      const distance = distanceKm(0, p0Longitude, city.lat, city.lng);
      if (!best || distance < best.distance) return { city, distance };
      return best;
    }, null);
  }

  function pZeroLocation(clock) {
    if (!clock?.wstc) return 'tracking...';
    const p0Surface = window.EarthSpaceTimeCoordinates.getEarthSurfaceUnderPZero({
      time: clock.input.timeUTC,
      epochUTC: clock.input.epochUTC,
    });
    const p0Longitude = p0Surface.longitude;
    const now = new Date();
    const localSeconds = normalizeHour((now.getUTCHours() + now.getUTCMinutes() / 60 + p0Longitude / 15)) * 3600;
    const hh = String(Math.floor(localSeconds / 3600)).padStart(2, '0');
    const mm = String(Math.floor((localSeconds % 3600) / 60)).padStart(2, '0');
    const eastWest = p0Longitude >= 0 ? 'E' : 'W';
    const nearest = nearestCityToPZero(p0Longitude);
    currentPZero = { lat: p0Surface.latitude, lng: p0Longitude, nearest };
    const place = nearest
      ? `near ${nearest.city.city}, ${nearest.city.adminName || nearest.city.country}`
      : 'nearest city loading';
    return `Earth under P0 ${place} | ${Math.abs(p0Longitude).toFixed(2)}°${eastWest} | local ${hh}:${mm}`;
  }

  function moonZeroLocation(clock) {
    if (!clock?.wstc) return 'tracking...';
    return `Moon zero focus | E0.000° | M0.000° | configured lunar P`;
  }

  function marsZeroLocation(clock) {
    if (!clock?.wstc) return 'tracking...';
    return `Mars zero focus | E0.000° | M0.000° | configured Mars sol`;
  }

  function formatClock(date) {
    if (!date) return '--:--';
    return date.toISOString().slice(11, 16);
  }

  function isNorthernDst(date) {
    const month = date.getUTCMonth();
    return month >= 2 && month <= 9;
  }

  function lastSundayUTC(year, monthIndex) {
    const date = new Date(Date.UTC(year, monthIndex + 1, 0, 1));
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return date;
  }

  function isEuropeDst(date) {
    const year = date.getUTCFullYear();
    const start = lastSundayUTC(year, 2);
    const end = lastSundayUTC(year, 9);
    return date >= start && date < end;
  }

  function timeZoneOffsetMinutes(date, timeZone) {
    if (!timeZone) return null;
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
      }, {});
      const localAsUtc = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second)
      );
      return Math.round((localAsUtc - date.getTime()) / 60000);
    } catch (_) {
      return null;
    }
  }

  function legacyOffsetMinutes(city, date) {
    const zoneOffset = timeZoneOffsetMinutes(date, city.timezone);
    if (Number.isFinite(zoneOffset)) return zoneOffset;
    const fixedByCountry = {
      IN: 330,
      NP: 345,
      LK: 330,
      BD: 360,
      PK: 300,
      CN: 480,
      JP: 540,
      KR: 540,
      SG: 480,
      AE: 240,
    };
    if (fixedByCountry[city.iso2]) return fixedByCountry[city.iso2];
    const europeCentral = new Set(['AL', 'AD', 'AT', 'BA', 'BE', 'CH', 'CZ', 'DE', 'DK', 'ES', 'FR', 'HR', 'HU', 'IT', 'LI', 'LU', 'MC', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'RS', 'SE', 'SI', 'SK', 'SM', 'VA']);
    const europeWestern = new Set(['GB', 'IE', 'PT']);
    const europeEastern = new Set(['BG', 'CY', 'EE', 'FI', 'GR', 'LV', 'LT', 'MD', 'RO', 'UA']);
    if (europeCentral.has(city.iso2)) return 60 + (isEuropeDst(date) ? 60 : 0);
    if (europeWestern.has(city.iso2)) return isEuropeDst(date) ? 60 : 0;
    if (europeEastern.has(city.iso2)) return 120 + (isEuropeDst(date) ? 60 : 0);
    if (city.iso2 === 'US') {
      const admin = city.adminName;
      const dst = isNorthernDst(date) ? 60 : 0;
      const eastern = new Set(['Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Indiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'New Hampshire', 'New Jersey', 'New York', 'North Carolina', 'Ohio', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'Vermont', 'Virginia', 'West Virginia']);
      const central = new Set(['Alabama', 'Arkansas', 'Illinois', 'Iowa', 'Louisiana', 'Minnesota', 'Mississippi', 'Missouri', 'Oklahoma', 'Tennessee', 'Wisconsin']);
      const mountain = new Set(['Arizona', 'Colorado', 'Idaho', 'Montana', 'New Mexico', 'Utah', 'Wyoming']);
      const pacific = new Set(['California', 'Nevada', 'Oregon', 'Washington']);
      if (eastern.has(admin)) return -300 + dst;
      if (central.has(admin)) return -360 + dst;
      if (mountain.has(admin)) return admin === 'Arizona' ? -420 : -420 + dst;
      if (pacific.has(admin)) return -480 + dst;
    }
    return Math.round((city.lng / 15) * 4) * 15;
  }

  function formatLegacyLocal(date, city) {
    if (!date) return '--:--';
    const local = new Date(date.getTime() + legacyOffsetMinutes(city, date) * 60000);
    return local.toISOString().slice(11, 16);
  }

  function currentLegacyLocal(city) {
    return formatLegacyLocal(new Date(), city);
  }

  function formatDeg(value, places = 2) {
    return `${Number(value).toFixed(places)} deg`;
  }

  function seasonSchemeForCity(city) {
    if (Math.abs(city.lat) < 23.5) {
      if (['IN', 'LK', 'BD', 'NP'].includes(city.iso2)) {
        return {
          climate: 'tropical monsoon',
          labels: ['hot', 'monsoon', 'post-monsoon', 'dry'],
          palette: 'monsoon',
        };
      }
      return {
        climate: 'tropical',
        labels: ['warming', 'wet', 'lush', 'dry'],
        palette: 'tropical',
      };
    }
    return {
      climate: city.lat >= 0 ? 'northern temperate' : 'southern temperate',
      labels: ['spring', 'summer', 'autumn', 'winter'],
      palette: 'temperate',
    };
  }

  function seasonForS(s, city) {
    const scheme = seasonSchemeForCity(city);
    const normalized = normalize360(s);
    const index = Math.min(3, Math.floor(normalized / 90));
    const seasonName = scheme.labels[index];
    const fraction = (normalized - index * 90) / 90;
    return {
      name: seasonName,
      climate: scheme.climate,
      labels: scheme.labels,
      progress: clamp01(fraction),
      s: normalized,
    };
  }

  function seasonAtFraction(fraction, city) {
    return seasonForS(clamp01(fraction) * 360, city);
  }

  function coordinateLabel(clock, system, key, fallback) {
    const label = clock?.labels?.[system]?.[key];
    return label || `${key}${Number(fallback || 0).toFixed(3)}`;
  }

  function clampLatitude(lat) {
    return Math.max(-85, Math.min(85, lat));
  }

  function makeEMGeoJSON(city, clock = lastClock) {
    if (!city) return EMPTY_FEATURE_COLLECTION;
    const latitude = clampLatitude(city.lat);
    const longitude = Math.max(-180, Math.min(180, city.lng));
    const eLabel = coordinateLabel(clock, 'wstc', 'E', window.EarthSpaceTimeCoordinates.getEquatorCoordinate(longitude));
    const mLabel = coordinateLabel(clock, 'wstc', 'M', window.EarthSpaceTimeCoordinates.getMeridianCoordinate(latitude));
    const place = city.city || city.cityAscii || 'city';
    const eLabelLat = clampLatitude(latitude + (latitude > 72 ? -8 : 8));
    const mLabelLng = longitude > 145 ? longitude - 26 : longitude + 26;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { axis: 'E', label: eLabel },
          geometry: { type: 'LineString', coordinates: [[longitude, -85], [longitude, 85]] },
        },
        {
          type: 'Feature',
          properties: { axis: 'M', label: mLabel },
          geometry: { type: 'LineString', coordinates: [[-180, latitude], [180, latitude]] },
        },
        {
          type: 'Feature',
          properties: { role: 'city', label: `${place} | ${eLabel} | ${mLabel}` },
          geometry: { type: 'Point', coordinates: [longitude, latitude] },
        },
        {
          type: 'Feature',
          properties: { role: 'label', axis: 'E', label: eLabel },
          geometry: { type: 'Point', coordinates: [longitude, eLabelLat] },
        },
        {
          type: 'Feature',
          properties: { role: 'label', axis: 'M', label: mLabel },
          geometry: { type: 'Point', coordinates: [mLabelLng, latitude] },
        },
        {
          type: 'Feature',
          properties: { role: 'origin', label: 'E0 / equator' },
          geometry: { type: 'Point', coordinates: [20, 0] },
        },
      ],
    };
  }

  function getMapInstance() {
    return earthApi?.map?.() || window.EarthSystem?.map?.() || null;
  }

  function registerEMMapLayer() {
    const api = earthApi || window.EarthSystem;
    if (!api?.addMapLayer || emLayerRegistered) return;
    api.addMapLayer(EM_LAYER_ID, {
      sourceId: EM_SOURCE_ID,
      source: {
        type: 'geojson',
        data: selectedCity ? makeEMGeoJSON(selectedCity, lastClock) : EMPTY_FEATURE_COLLECTION,
      },
      layers: [
        {
          id: 'wstc-em-e-meridian',
          type: 'line',
          source: EM_SOURCE_ID,
          filter: ['==', ['get', 'axis'], 'E'],
          paint: {
            'line-color': '#f4d06f',
            'line-width': 2.6,
            'line-opacity': 0.86,
            'line-dasharray': [1.2, 1.1],
          },
        },
        {
          id: 'wstc-em-m-parallel',
          type: 'line',
          source: EM_SOURCE_ID,
          filter: ['==', ['get', 'axis'], 'M'],
          paint: {
            'line-color': '#4fd1c5',
            'line-width': 2.6,
            'line-opacity': 0.86,
            'line-dasharray': [1.2, 1.1],
          },
        },
        {
          id: 'wstc-em-city-halo',
          type: 'circle',
          source: EM_SOURCE_ID,
          filter: ['==', ['get', 'role'], 'city'],
          paint: {
            'circle-radius': 17,
            'circle-color': '#050c14',
            'circle-opacity': 0.18,
            'circle-stroke-color': '#f9fdff',
            'circle-stroke-width': 1.4,
          },
        },
        {
          id: 'wstc-em-city-dot',
          type: 'circle',
          source: EM_SOURCE_ID,
          filter: ['==', ['get', 'role'], 'city'],
          paint: {
            'circle-radius': 5.5,
            'circle-color': '#ff6b8b',
            'circle-stroke-color': '#f9fdff',
            'circle-stroke-width': 1.8,
          },
        },
        {
          id: 'wstc-em-origin-dot',
          type: 'circle',
          source: EM_SOURCE_ID,
          filter: ['==', ['get', 'role'], 'origin'],
          paint: {
            'circle-radius': 4,
            'circle-color': '#9fb0c3',
            'circle-stroke-color': '#050c14',
            'circle-stroke-width': 1.2,
          },
        },
      ],
    });
    emLayerRegistered = true;
  }

  function refreshEMMapLayer(clock = lastClock) {
    if (!selectedCity) return;
    const map = getMapInstance();
    const source = map?.getSource?.(EM_SOURCE_ID);
    if (source?.setData) source.setData(makeEMGeoJSON(selectedCity, clock));
  }

  function updateMapCoordinateChip(clock = lastClock) {
    if (!els.mapCoordinateChip || !selectedCity || !clock) return;
    const eLabel = coordinateLabel(clock, 'wstc', 'E', window.EarthSpaceTimeCoordinates.getEquatorCoordinate(selectedCity.lng));
    const mLabel = coordinateLabel(clock, 'wstc', 'M', window.EarthSpaceTimeCoordinates.getMeridianCoordinate(selectedCity.lat));
    els.mapCoordinateChip.textContent = `${shortPlace(selectedCity)} map focus | ${eLabel} | ${mLabel}`;
  }

  function moonClock(now) {
    if (typeof window.MoonSpaceTimeCoordinates?.getMoonSpaceTimeCoordinates !== 'function') return null;
    return window.MoonSpaceTimeCoordinates.getMoonSpaceTimeCoordinates({
      time: now,
      epochUTC: zeroEpochUTC,
      latitude: 0,
      longitude: 0,
      altitudeMeters: 0,
      labelPrecision: { G: 6, S: 2, P: 2, E: 3, M: 3, V: 0 },
    });
  }

  function marsClock(now) {
    if (typeof window.MarsSpaceTimeCoordinates?.getMarsSpaceTimeCoordinates !== 'function') return null;
    return window.MarsSpaceTimeCoordinates.getMarsSpaceTimeCoordinates({
      time: now,
      epochUTC: zeroEpochUTC,
      latitude: 0,
      longitude: 0,
      altitudeMeters: 0,
      labelPrecision: { G: 6, S: 2, P: 2, E: 3, M: 3, V: 0 },
    });
  }

  function updateMoonCoordinates(now) {
    const clock = moonClock(now);
    if (!clock) return false;
    lastClock = clock;
    const P = clock.wstc.P;
    const S = clock.wstc.S;
    const G = clock.wstc.G;
    setCircleArc(clocks.wstc.planetArc, clocks.wstc.planetRadius, P);
    setCircleArc(clocks.wstc.starArc, clocks.wstc.starRadius, S);
    setCircleArc(clocks.wstc.galaxyArc, clocks.wstc.galaxyRadius, G);
    if (els.coordinateTitle) els.coordinateTitle.textContent = 'Moon Space Time Coordinate';
    if (els.estcLabelName) els.estcLabelName.textContent = 'MSTC';
    if (els.wstcLabelName) els.wstcLabelName.textContent = 'WSTC';
    els.wstcMeta.textContent = 'Moon zero | lunar coordinate layer';
    els.wstcValue.textContent = '';
    els.estcFullLabel.textContent = clock.strings.mstc;
    els.wstcFullLabel.textContent = clock.strings.wstc;
    els.pZeroButton.textContent = moonZeroLocation(clock);
    if (els.coordinateFocusLabel) els.coordinateFocusLabel.textContent = 'Moon zero';
    if (clocks.wstc.mapTile) clocks.wstc.mapTile.setAttribute('opacity', '0');
    return true;
  }

  function updateMarsCoordinates(now) {
    const clock = marsClock(now);
    if (!clock) return false;
    lastClock = clock;
    const P = clock.wstc.P;
    const S = clock.wstc.S;
    const G = clock.wstc.G;
    setCircleArc(clocks.wstc.planetArc, clocks.wstc.planetRadius, P);
    setCircleArc(clocks.wstc.starArc, clocks.wstc.starRadius, S);
    setCircleArc(clocks.wstc.galaxyArc, clocks.wstc.galaxyRadius, G);
    if (els.coordinateTitle) els.coordinateTitle.textContent = 'Mars Space Time Coordinate';
    if (els.estcLabelName) els.estcLabelName.textContent = 'MaSTC';
    if (els.wstcLabelName) els.wstcLabelName.textContent = 'WSTC';
    els.wstcMeta.textContent = 'Mars zero | sol coordinate layer';
    els.wstcValue.textContent = '';
    els.estcFullLabel.textContent = clock.strings.mastc;
    els.wstcFullLabel.textContent = clock.strings.wstc;
    els.pZeroButton.textContent = marsZeroLocation(clock);
    if (els.coordinateFocusLabel) els.coordinateFocusLabel.textContent = 'Mars zero';
    if (clocks.wstc.mapTile) clocks.wstc.mapTile.setAttribute('opacity', '0');
    return true;
  }

  function restoreEarthCoordinateLabels() {
    if (els.coordinateTitle) els.coordinateTitle.textContent = 'Earth Space Time Coordinate';
    if (els.estcLabelName) els.estcLabelName.textContent = 'ESTC';
    if (els.wstcLabelName) els.wstcLabelName.textContent = 'WSTC';
  }

  function flyToPZero() {
    if (activeTarget === 'moon' || activeTarget === 'mars') {
      const api = earthApi || window.EarthSystem;
      api?.flyToTarget?.(activeTarget);
      return;
    }
    if (!currentPZero) return;
    const api = earthApi || window.EarthSystem;
    api?.flyToLocation?.({
      lat: currentPZero.lat,
      lng: currentPZero.lng,
      altitude: 2.2,
      mapZoom: 6,
      enterMap: false,
      duration: 4200,
    });
  }

  function bindEarthCore() {
    const connect = event => {
      earthApi = event?.detail?.api || window.EarthSystem || earthApi;
      activeTarget = earthApi?.getState?.().target || activeTarget;
      registerEMMapLayer();
      refreshEMMapLayer();
      earthApi?.on?.('mapload', () => refreshEMMapLayer());
      earthApi?.on?.('targetchange', event => {
        activeTarget = event.detail?.targetName || 'earth';
        if (activeTarget !== 'moon' && activeTarget !== 'mars') {
          restoreEarthCoordinateLabels();
          if (selectedCity) setWstcMapFocus(selectedCity);
        }
        updateClock();
      });
      earthApi?.on?.('viewchange', event => {
        refreshEMMapLayer();
        if (event.detail.mode === 'globe' && pendingMapReentry) {
          const next = pendingMapReentry;
          pendingMapReentry = null;
          requestAnimationFrame(() => {
            earthApi?.flyToLocation?.({
              lat: next.city.lat,
              lng: next.city.lng,
              altitude: 1.39,
              mapZoom: 11.2,
              enterMap: true,
              duration: 5200,
            });
          });
        }
      });
    };
    if (window.EarthSystem) connect({ detail: { api: window.EarthSystem } });
    window.addEventListener('earthsystem:ready', connect, { once: true });
  }

  function findMatches(query) {
    const q = normalizeSearch(query);
    if (q.length < 2) return [];
    return cities.map(city => {
      let score = 999;
      if (city.searchText === q) score = 0;
      else if (normalizeSearch(city.city).startsWith(q)) score = 1;
      else if (city.searchText.startsWith(q)) score = 2;
      else if (city.searchText.includes(q)) score = 3;
      return { city, score };
    }).filter(item => item.score < 999)
      .sort((a, b) => a.score - b.score || b.city.pop - a.city.pop)
      .slice(0, 10);
  }

  function defaultCityForEnvironment() {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const preferred = TIMEZONE_DEFAULTS.get(timeZone);
    if (preferred) {
      const exact = cities.find(city =>
        normalizeSearch(city.cityAscii) === normalizeSearch(preferred.city)
        && normalizeSearch(city.adminName) === normalizeSearch(preferred.admin)
        && city.iso2 === preferred.iso2
      );
      if (exact) return exact;
    }
    const zoneCity = timeZone?.split('/').pop()?.replace(/_/g, ' ');
    if (zoneCity) {
      const match = cities.find(city => normalizeSearch(city.cityAscii) === normalizeSearch(zoneCity));
      if (match) return match;
    }
    return cities.find(city => normalizeSearch(city.cityAscii) === normalizeSearch(DEFAULT_CITY) && city.iso2 === 'IN')
      || cities.find(city => normalizeSearch(city.cityAscii) === normalizeSearch(DEFAULT_CITY))
      || cities[0];
  }

  function renderSuggestions() {
    const matches = findMatches(els.citySearch.value);
    activeSuggestion = -1;
    els.suggestions.innerHTML = '';
    els.citySearch.setAttribute('aria-expanded', matches.length ? 'true' : 'false');
    if (!matches.length) {
      els.suggestions.style.display = 'none';
      return;
    }
    matches.forEach(({ city }) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'suggestion';
      row.setAttribute('role', 'option');
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = city.city || city.cityAscii;
      const meta = document.createElement('span');
      meta.textContent = [city.adminName, city.country].filter(Boolean).join(', ');
      text.append(strong, meta);
      const pop = document.createElement('em');
      pop.textContent = city.pop ? Math.round(city.pop).toLocaleString() : '';
      row.append(text, pop);
      row.addEventListener('click', () => selectCity(city, true, true));
      els.suggestions.appendChild(row);
    });
    els.suggestions.style.display = 'block';
  }

  function updateActiveSuggestion(nextIndex) {
    const rows = Array.from(els.suggestions.querySelectorAll('.suggestion'));
    if (!rows.length) return;
    activeSuggestion = (nextIndex + rows.length) % rows.length;
    rows.forEach((row, index) => row.classList.toggle('active', index === activeSuggestion));
  }

  function selectCity(city, updateInput, enterMap = false) {
    const previousCity = selectedCity || displayedFocusCity;
    selectedCity = city;
    if (updateInput) els.citySearch.value = labelForCity(city);
    els.clearCity.style.display = 'block';
    els.suggestions.style.display = 'none';
    els.citySearch.setAttribute('aria-expanded', 'false');
    const api = earthApi || window.EarthSystem;
    const map = api?.map?.();
    const isMapMode = api?.getState?.().mode === 'map';
    if (enterMap && isMapMode && api?.switchToMacro) {
      pendingMapReentry = { city };
      api.switchToMacro();
    } else if (api?.flyToLocation) {
      api.flyToLocation({
        lat: city.lat,
        lng: city.lng,
        altitude: enterMap ? 1.39 : 2.8,
        mapZoom: 11.2,
        enterMap,
        duration: enterMap ? 5200 : 1600,
      });
    }
    if (enterMap && previousCity && previousCity.id !== city.id) {
      animateWstcMapFocus(previousCity, city, 5200);
    } else {
      setWstcMapFocus(city);
    }
    updateClock();
    refreshEMMapLayer();
  }

  function clearCity() {
    els.citySearch.value = '';
    els.suggestions.style.display = 'none';
    els.clearCity.style.display = 'none';
    els.citySearch.focus();
  }

  function updateClock() {
    const now = new Date();
    if (activeTarget === 'moon') {
      if (updateMoonCoordinates(now)) return;
    }
    if (activeTarget === 'mars') {
      if (updateMarsCoordinates(now)) return;
    }
    if (!selectedCity || typeof window.EarthSpaceTimeCoordinates?.getEarthSpaceTimeCoordinates !== 'function') return;
    restoreEarthCoordinateLabels();
    const clock = window.EarthSpaceTimeCoordinates.getEarthSpaceTimeCoordinates({
      time: now,
      epochUTC: zeroEpochUTC,
      latitude: selectedCity.lat,
      longitude: selectedCity.lng,
      altitudeMeters: cityAltitudeMeters(selectedCity),
      labelPrecision: { G: 6, S: 2, P: 2, E: 3, M: 3, V: 0 },
    });
    lastClock = clock;
    const P = clock.wstc.P;
    const S = clock.wstc.S;
    const G = clock.wstc.G;
    const dayNight = dayNightState(now, selectedCity);
    const season = seasonForS(S, selectedCity);
    const O = clock.estc.O;
    currentDayNight = dayNight;
    currentSeason = season;

    if (!skyDrag.active) {
      updateSkyWindow(clocks.dayNight, dayNight);
      const localRange = dayNight.start && dayNight.end
        ? `${formatLegacyLocal(dayNight.start, selectedCity)} to ${formatLegacyLocal(dayNight.end, selectedCity)}`
        : dayNight.meta;
      els.dayNightTitle.textContent = dayNight.mode === 'night' ? 'Night Arc' : 'Day Arc';
      els.dayNightMeta.textContent = `${shortPlace(selectedCity)} | ${dayNight.skyLabel} | local ${currentLegacyLocal(selectedCity)}`;
      els.dayNightValue.textContent = `T${dayNight.t.toFixed(2)} | ${clock.labels.wstc.P}`;
    }

    if (!seasonDrag.active) {
      updateSeasonWindow(clocks.season, season);
      els.seasonMeta.textContent = `${season.climate} | ${season.name}`;
      els.seasonValue.textContent = `O${O}`;
    }

    setCircleArc(clocks.wstc.planetArc, clocks.wstc.planetRadius, P);
    setCircleArc(clocks.wstc.starArc, clocks.wstc.starRadius, S);
    setCircleArc(clocks.wstc.galaxyArc, clocks.wstc.galaxyRadius, G);
    if (!wstcFocusAnimation) setWstcMapFocus(selectedCity);
    els.wstcMeta.textContent = '';
    els.wstcValue.textContent = '';
    els.estcFullLabel.textContent = clock.strings.estc;
    els.wstcFullLabel.textContent = clock.strings.wstc;
    els.pZeroButton.textContent = pZeroLocation(clock);
    updateMapCoordinateChip(clock);
    refreshEMMapLayer(clock);
    els.status.textContent = `${labelForCity(selectedCity)} | ${cities.length.toLocaleString()} cities`;
  }

  function bindEvents() {
    if (els.zeroEpochInput) {
      els.zeroEpochInput.value = toEpochInputValue(zeroEpochUTC);
      els.zeroEpochInput.addEventListener('change', () => {
        zeroEpochUTC = epochInputToUTC(els.zeroEpochInput.value);
        els.zeroEpochInput.value = toEpochInputValue(zeroEpochUTC);
        saveZeroEpochUTC(zeroEpochUTC);
        updateClock();
      });
    }
    els.resetEpochButton?.addEventListener('click', () => {
      zeroEpochUTC = DEFAULT_ZERO_EPOCH_UTC;
      if (els.zeroEpochInput) els.zeroEpochInput.value = toEpochInputValue(zeroEpochUTC);
      saveZeroEpochUTC(zeroEpochUTC);
      updateClock();
    });
    els.citySearch.addEventListener('input', renderSuggestions);
    els.citySearch.addEventListener('focus', renderSuggestions);
    els.citySearch.addEventListener('keydown', event => {
      const rows = Array.from(els.suggestions.querySelectorAll('.suggestion'));
      if (event.key === 'ArrowDown' && rows.length) {
        event.preventDefault();
        updateActiveSuggestion(activeSuggestion + 1);
      } else if (event.key === 'ArrowUp' && rows.length) {
        event.preventDefault();
        updateActiveSuggestion(activeSuggestion - 1);
      } else if (event.key === 'Enter' && activeSuggestion >= 0 && rows[activeSuggestion]) {
        event.preventDefault();
        rows[activeSuggestion].click();
      } else if (event.key === 'Escape') {
        els.suggestions.style.display = 'none';
      }
    });
    els.clearCity.addEventListener('click', clearCity);
    els.pZeroButton?.addEventListener('click', flyToPZero);
    document.addEventListener('click', event => {
      if (event.target === els.citySearch || event.target === els.clearCity || els.suggestions.contains(event.target)) return;
      els.suggestions.style.display = 'none';
      els.citySearch.setAttribute('aria-expanded', 'false');
    });
  }

  async function boot() {
    clocks.dayNight = createDayNightClock();
    bindSkySlider();
    clocks.season = createSeasonClock();
    bindSeasonSlider();
    clocks.wstc = createWorldCoordinateClock();
    bindEvents();
    bindEarthCore();
    try {
      cities = await loadCities();
      const defaultCity = defaultCityForEnvironment();
      window.EarthClockMapApp = {
        getState: () => ({
          cityCount: cities.length,
          selectedCity: selectedCity ? labelForCity(selectedCity) : null,
          lastClock,
        }),
        selectCityByName: name => {
          const q = normalizeSearch(name);
          const match = cities.find(city => normalizeSearch(city.city) === q || normalizeSearch(city.cityAscii) === q)
            || cities.find(city => normalizeSearch(`${city.city} ${city.adminName} ${city.country}`).includes(q))
            || cities.find(city => city.searchText.includes(q));
          if (match) selectCity(match, true, true);
          return match ? labelForCity(match) : null;
        },
      };
      selectCity(defaultCity, true, false);
      setInterval(updateClock, 1000);
    } catch (error) {
      els.status.textContent = 'City data unavailable';
      console.error(error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
