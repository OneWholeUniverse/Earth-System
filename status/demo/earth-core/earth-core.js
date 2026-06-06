(() => {
  const assetBase = new URL(window.EARTH_CORE_ASSET_BASE || './assets/', document.baseURI);
  const assetUrl = value => new URL(value, assetBase).toString();
  const ASSETS = {
    earthDay: assetUrl('textures/earth-blue-marble.jpg'),
    earthNight: assetUrl('textures/earth-night.jpg'),
    earthNormal: assetUrl('textures/earth_normal_2048.jpg'),
    earthSpecular: assetUrl('textures/earth_specular_2048.jpg'),
    moon: assetUrl('textures/moon-8k.jpg'),
    mars: assetUrl('textures/mars-viking-mdim21-1km.jpg'),
    sun: assetUrl('textures/sun_disk.jpg')
  };

  const options = window.EARTH_CORE_OPTIONS || {};
  const canvas = document.getElementById(options.canvasId || 'c');
  const mapContainer = document.getElementById(options.mapContainerId || 'map-container');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.0015, 1000);
  const loader = new THREE.TextureLoader();
  const eventHandlers = new Map();
  const threeLayers = new Map();
  const mapLayers = new Map();
  const appLayers = new Map();

  const MACRO_MIN_RADIUS = 1.35;
  const MICRO_START_ZOOM = 4.5;
  const MICRO_EXIT_ZOOM = 4.3;
  const ORBIT_ZOOM_SPEED = 0.0015;
  const SUN_BASE_SCALE = 1.0;
  const SUN_CINEMATIC_SCALE = 18.0;
  const READABLE_DISTANCES = { moon: 1.72, mars: 3.25, sun: 9.5 };
  const REAL_DISTANCES_KM = {
    moon: 384400,
    sun: 149597870.7,
    marsOrbitRadius: 1.523679 * 149597870.7
  };
  const REAL_RADII_KM = {
    moon: 1737.4,
    mars: 3389.5,
    earth: 6371,
    sun: 696340
  };
  const READABLE_RADII = {
    moon: 0.072,
    mars: 0.096,
    sunCore: 0.115
  };
  const MAPLIBRE_VERSION = '4.1.2';
  const MAPLIBRE_JS_URL = options.mapLibreJsUrl || `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
  const MAPLIBRE_CSS_URL = options.mapLibreCssUrl || `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
  const MAP_STYLE_URLS = {
    day: options.mapDayStyleUrl || 'https://tiles.openfreemap.org/styles/bright',
    night: options.mapNightStyleUrl || options.mapDayStyleUrl || 'https://tiles.openfreemap.org/styles/bright'
  };
  const MAP_TERRAIN_SOURCE_ID = 'earth-core-terrain-dem';
  const MAP_TERRAIN_LAYER_ID = 'earth-core-terrain-hillshade';

  const TARGET_CONFIGS = {
    earth: { minRadius: MACRO_MIN_RADIUS, maxRadius: 20.0, defaultRadius: 3.1, discStart: 1.42 },
    moon:  { minRadius: 0.08, maxRadius: 20.0, defaultRadius: 0.35, discStart: 0.12 },
    mars:  { minRadius: 0.10, maxRadius: 24.0, defaultRadius: 0.48, discStart: 0.16 },
    sun:   { minRadius: 0.15, maxRadius: 35.0, defaultRadius: 10.5, discStart: 0.3 }
  };

  const orbit = { radius: TARGET_CONFIGS.earth.defaultRadius, theta: 0, phi: 0.22 };
  const dynamicCenter = new THREE.Vector3(0, 0, 0);
  const flight = {
    active: false,
    startTime: 0,
    duration: 2500,
    startRadius: 0,
    endRadius: 0,
    startCenter: new THREE.Vector3(),
    endCenterName: 'earth',
    startEarthScale: 1.0,
    startTheta: 0,
    endTheta: 0,
    startPhi: 0,
    endPhi: 0,
    startSunFocus: 0,
    endSunFocus: 0,
    cameraCurve: null
  };

  let currentTargetName = 'earth';
  let currentConfig = TARGET_CONFIGS.earth;
  let isMicroView = false;
  let streetMap = null;
  let mapLibreLoadPromise = null;
  let pendingMapRequest = null;
  let mapNightModeActive = false;
  let currentMapStyleMode = 'day';
  let lastMapSubsolar = null;
  let lastPolishedStyleMode = null;
  const mapPaintDefaults = new Map();
  let t = 0;
  let sunFocusBlend = 0.0;
  let mobilePinching = false;
  let mobileLastPinchDistance = 0;
  const spaceScaleMode = 'log';
  const spaceSizeMode = 'log';

  function emit(name, detail = {}) {
    const handlers = eventHandlers.get(name);
    if (!handlers) return;
    handlers.forEach(handler => handler({ type: name, detail, state: getState() }));
  }

  function on(name, handler) {
    if (!eventHandlers.has(name)) eventHandlers.set(name, new Set());
    eventHandlers.get(name).add(handler);
    return () => eventHandlers.get(name).delete(handler);
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function smoothstep01(v) {
    const x = clamp01(v);
    return x * x * (3 - 2 * x);
  }

  function logSceneDistance(km) {
    const minLog = Math.log10(REAL_DISTANCES_KM.moon);
    const maxLog = Math.log10(REAL_DISTANCES_KM.sun);
    const p = clamp01((Math.log10(Math.max(km, 1)) - minLog) / (maxLog - minLog));
    return 1.45 + p * 8.15;
  }

  function logSceneRadius(km) {
    const minLog = Math.log10(REAL_RADII_KM.moon);
    const maxLog = Math.log10(REAL_RADII_KM.sun);
    const p = clamp01((Math.log10(Math.max(km, 1)) - minLog) / (maxLog - minLog));
    return 0.07 + p * 0.30;
  }

  function currentMoonDistance() {
    return logSceneDistance(REAL_DISTANCES_KM.moon);
  }

  function currentMarsDistanceKm() {
    const now = new Date();
    const d = (now.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
    const marsLongitude = normalizeDeg(355.433 + 0.52402075 * d);
    const earthLongitude = normalizeDeg(100.464 + 0.98564736 * d);
    const relativeLongitude = degToRad(normalizeDeg(marsLongitude - earthLongitude));
    const earthKm = REAL_DISTANCES_KM.sun;
    const marsKm = REAL_DISTANCES_KM.marsOrbitRadius;
    return Math.sqrt(earthKm * earthKm + marsKm * marsKm - 2 * earthKm * marsKm * Math.cos(relativeLongitude));
  }

  function currentMarsDistance() {
    return logSceneDistance(currentMarsDistanceKm());
  }

  function currentSunDistance() {
    return logSceneDistance(REAL_DISTANCES_KM.sun);
  }

  function currentMoonSizeScale() {
    return logSceneRadius(REAL_RADII_KM.moon) / READABLE_RADII.moon;
  }

  function currentMarsSizeScale() {
    return logSceneRadius(REAL_RADII_KM.mars) / READABLE_RADII.mars;
  }

  function currentSunSizeScale() {
    return logSceneRadius(REAL_RADII_KM.sun) / READABLE_RADII.sunCore;
  }

  function updateCamera() {
    const r = orbit.radius;
    const cp = Math.cos(orbit.phi);
    camera.position.set(
      dynamicCenter.x + Math.sin(orbit.theta) * cp * r,
      dynamicCenter.y + Math.sin(orbit.phi) * r,
      dynamicCenter.z + Math.cos(orbit.theta) * cp * r
    );
    camera.lookAt(dynamicCenter);
  }

  function zoomPanSensitivity() {
    const zoomIn = clamp01((currentConfig.maxRadius - orbit.radius) / (currentConfig.maxRadius - currentConfig.minRadius));
    return 1.0 - zoomIn * 0.82;
  }

  function zoomMassFactor() {
    const closeBlend = clamp01((currentConfig.discStart - orbit.radius) / (currentConfig.discStart - currentConfig.minRadius));
    return 1.0 + closeBlend * 0.5;
  }

  function createStars() {
    const starsGeom = new THREE.BufferGeometry();
    const starCount = 4000;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    const minRadius = 35;
    const maxRadius = 85;

    for (let i = 0; i < starCount; i++) {
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.cos(phi);
      starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const depthStr = 1.0 - ((radius - minRadius) / (maxRadius - minRadius));
      const intensity = 0.15 + 0.85 * Math.pow(depthStr, 2.5);
      starColors[i * 3] = 0.85 * intensity + 0.15 * depthStr;
      starColors[i * 3 + 1] = 0.90 * intensity + 0.10 * depthStr;
      starColors[i * 3 + 2] = 1.00 * intensity;
    }

    starsGeom.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starsGeom.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    scene.add(new THREE.Points(starsGeom, new THREE.PointsMaterial({
      size: 0.22,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })));
  }

  function createMilkyWay() {
    const group = new THREE.Group();
    const sphereMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec3 vPos;
        float hash(vec3 p) { p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float noise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) { float f = 0.0; float amp = 0.5; for(int i=0; i<4; i++){ f += amp * noise(p); p *= 2.0; amp *= 0.5; } return f; }
        void main() {
          vec3 nPos = normalize(vPos);
          float lat = asin(nPos.y);
          float lon = atan(nPos.z, nPos.x);
          float isCore = exp(-pow(lon, 2.0) * 0.5);
          float thickness = 4.0 - 1.5 * isCore;
          float band = exp(-pow(abs(lat) * thickness, 2.0));
          float n = fbm(nPos * 15.0);
          float dust = fbm(nPos * 30.0 + vec3(10.0));
          float rift = smoothstep(0.3, 0.7, dust);
          band *= (0.4 + 0.6 * n) * (1.0 - rift * 0.5 * exp(-abs(lat)*10.0));
          vec3 coreColor = vec3(1.0, 0.8, 0.6);
          vec3 edgeColor = vec3(0.08, 0.15, 0.35);
          vec3 color = mix(edgeColor, coreColor, isCore * band);
          gl_FragColor = vec4(color * band * 0.9, band * 0.6);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(300, 64, 64), sphereMat));

    const pointsGeo = new THREE.BufferGeometry();
    const pointCount = 40000;
    const positions = new Float32Array(pointCount * 3);
    const colors = new Float32Array(pointCount * 3);
    for (let i = 0; i < pointCount; i++) {
      let l = Math.random() * Math.PI * 2;
      if (Math.random() > 0.6) l = (Math.random() - 0.5) * 1.5;
      const isCore = Math.exp(-Math.pow(l, 2.0) * 0.5);
      const spread = 0.12 + 0.1 * isCore;
      const b = (Math.random() + Math.random() + Math.random() - 1.5) * spread;
      positions[i * 3] = 250 * Math.cos(b) * Math.cos(l);
      positions[i * 3 + 1] = 250 * Math.sin(b);
      positions[i * 3 + 2] = 250 * Math.cos(b) * Math.sin(l);

      const intensity = 0.3 + Math.random() * 0.7;
      if (isCore > 0.5 && Math.random() > 0.3) {
        colors[i * 3] = 1.0 * intensity;
        colors[i * 3 + 1] = 0.85 * intensity;
        colors[i * 3 + 2] = 0.7 * intensity;
      } else {
        colors[i * 3] = 0.6 * intensity;
        colors[i * 3 + 1] = 0.8 * intensity;
        colors[i * 3 + 2] = 1.0 * intensity;
      }
    }
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.add(new THREE.Points(pointsGeo, new THREE.PointsMaterial({
      size: 0.25,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })));

    const raNGP = 192.8595 * Math.PI / 180;
    const decNGP = 27.1283 * Math.PI / 180;
    const yAxisVec = new THREE.Vector3(Math.cos(decNGP) * Math.cos(raNGP), Math.sin(decNGP), Math.cos(decNGP) * Math.sin(raNGP)).normalize();
    const raGC = 266.4051 * Math.PI / 180;
    const decGC = -28.9362 * Math.PI / 180;
    const xAxisVec = new THREE.Vector3(Math.cos(decGC) * Math.cos(raGC), Math.sin(decGC), Math.cos(decGC) * Math.sin(raGC)).normalize();
    const zAxisVec = new THREE.Vector3().crossVectors(xAxisVec, yAxisVec).normalize();
    xAxisVec.crossVectors(yAxisVec, zAxisVec).normalize();
    group.applyMatrix4(new THREE.Matrix4().makeBasis(xAxisVec, yAxisVec, zAxisVec));
    scene.add(group);
  }

  function createCroppedSunTexture(src) {
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = 2048;
    textureCanvas.height = 1024;
    const ctx = textureCanvas.getContext('2d');
    const fill = ctx.createLinearGradient(0, 0, textureCanvas.width, textureCanvas.height);
    fill.addColorStop(0, '#8f1304');
    fill.addColorStop(0.45, '#ff6a18');
    fill.addColorStop(1, '#ffd15c');
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 1);

    const img = new Image();
    img.onload = () => {
      const crop = Math.min(img.width, img.height) * 0.52;
      const sx = (img.width - crop) * 0.5;
      const sy = (img.height - crop) * 0.5;
      ctx.clearRect(0, 0, textureCanvas.width, textureCanvas.height);
      ctx.drawImage(img, sx, sy, crop, crop, 0, 0, textureCanvas.width, textureCanvas.height);
      texture.needsUpdate = true;
    };
    img.src = src;
    return texture;
  }

  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  sun.position.set(8, 2.5, 0);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.18));

  const sunGroup = new THREE.Group();
  const sunDiskTexture = createCroppedSunTexture(ASSETS.sun);
  const sunMaterial = new THREE.MeshBasicMaterial({ map: sunDiskTexture, color: 0xffffff });
  const sunCore = new THREE.Mesh(new THREE.SphereGeometry(0.115, 96, 96), sunMaterial);
  sunGroup.add(sunCore);
  let sunTextureModeActive = true;

  function setSunTextureMode(active) {
    if (sunTextureModeActive === active) return;
    sunTextureModeActive = active;
    sunMaterial.map = active ? sunDiskTexture : null;
    sunMaterial.color.set(active ? 0xffffff : 0xfff8de);
    sunMaterial.needsUpdate = true;
  }

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 256;
  glowCanvas.height = 256;
  const glowCtx = glowCanvas.getContext('2d');
  const gradient = glowCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255,255,235,1)');
  gradient.addColorStop(0.16, 'rgba(255,245,200,0.95)');
  gradient.addColorStop(0.34, 'rgba(255,228,120,0.60)');
  gradient.addColorStop(0.62, 'rgba(255,216,90,0.18)');
  gradient.addColorStop(1, 'rgba(255,210,70,0)');
  glowCtx.fillStyle = gradient;
  glowCtx.fillRect(0, 0, 256, 256);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(glowCanvas),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }));
  sunGlow.scale.set(1.28, 1.28, 1);
  sunGroup.add(sunGlow);

  const raysGroup = new THREE.Group();
  [0, Math.PI / 5, -Math.PI / 5, Math.PI * 2 / 5, -Math.PI * 2 / 5].forEach((angle, i) => {
    const ray = new THREE.Mesh(
      new THREE.PlaneGeometry(i === 0 ? 0.48 : 0.34, i === 0 ? 0.010 : 0.007),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: i === 0 ? 0.95 : 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ray.rotation.z = angle;
    raysGroup.add(ray);
  });
  sunGroup.add(raysGroup);
  sunGroup.position.copy(sun.position.clone().normalize().multiplyScalar(9.5));
  scene.add(sunGroup);
  const sunScaleTarget = new THREE.Vector3(SUN_BASE_SCALE, SUN_BASE_SCALE, SUN_BASE_SCALE);
  setSunTextureMode(false);

  const moonOrbitGroup = new THREE.Group();
  scene.add(moonOrbitGroup);
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.072, 48, 48),
    new THREE.MeshPhongMaterial({ map: loader.load(ASSETS.moon), shininess: 2 })
  );
  moonOrbitGroup.add(moon);

  const marsOrbitGroup = new THREE.Group();
  scene.add(marsOrbitGroup);
  const mars = new THREE.Mesh(
    new THREE.SphereGeometry(0.096, 64, 64),
    new THREE.MeshPhongMaterial({
      map: loader.load(ASSETS.mars),
      color: 0xffffff,
      emissive: 0x120502,
      shininess: 3,
      specular: 0x1d0f09,
    })
  );
  marsOrbitGroup.add(mars);

  function degToRad(deg) {
    return deg * Math.PI / 180;
  }

  function radToDeg(rad) {
    return rad * 180 / Math.PI;
  }

  function normalizeDeg(deg) {
    return ((deg % 360) + 360) % 360;
  }

  function getApproxMoonScenePosition(distance = currentMoonDistance()) {
    const now = new Date();
    const d = (now.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
    const sunMeanAnomaly = normalizeDeg(357.529 + 0.98560028 * d);
    const sunMeanLongitude = normalizeDeg(280.459 + 0.98564736 * d);
    const sunLongitude = normalizeDeg(sunMeanLongitude + 1.915 * Math.sin(degToRad(sunMeanAnomaly)) + 0.020 * Math.sin(degToRad(2 * sunMeanAnomaly)));
    const L = normalizeDeg(218.316 + 13.176396 * d);
    const Mm = normalizeDeg(134.963 + 13.064993 * d);
    const D = normalizeDeg(297.850 + 12.190749 * d);
    const F = normalizeDeg(93.272 + 13.229350 * d);
    const moonLongitude = normalizeDeg(L + 6.289 * Math.sin(degToRad(Mm)) + 1.274 * Math.sin(degToRad(2 * D - Mm)) + 0.658 * Math.sin(degToRad(2 * D)) + 0.214 * Math.sin(degToRad(2 * Mm)) - 0.186 * Math.sin(degToRad(sunMeanAnomaly)));
    const moonLatitude = 5.128 * Math.sin(degToRad(F)) + 0.280 * Math.sin(degToRad(Mm + F)) + 0.277 * Math.sin(degToRad(Mm - F)) + 0.173 * Math.sin(degToRad(2 * D - F));
    const elongation = degToRad(normalizeDeg(moonLongitude - sunLongitude));
    const latRad = degToRad(moonLatitude);
    const sunDir = sun.position.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    let orbitRight = new THREE.Vector3().crossVectors(up, sunDir).normalize();
    if (orbitRight.lengthSq() < 0.0001) orbitRight = new THREE.Vector3(1, 0, 0);
    const orbitUp = new THREE.Vector3().crossVectors(sunDir, orbitRight).normalize();
    const inPlane = sunDir.clone().multiplyScalar(Math.cos(elongation)).add(orbitRight.clone().multiplyScalar(Math.sin(elongation)));
    return inPlane.multiplyScalar(Math.cos(latRad)).add(orbitUp.clone().multiplyScalar(Math.sin(latRad))).normalize().multiplyScalar(distance);
  }

  function getApproxMarsScenePosition(distance = currentMarsDistance()) {
    const now = new Date();
    const d = (now.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
    const marsLongitude = normalizeDeg(355.433 + 0.52402075 * d);
    const earthLongitude = normalizeDeg(100.464 + 0.98564736 * d);
    const relativeLongitude = degToRad(normalizeDeg(marsLongitude - earthLongitude));
    const sunDir = sun.position.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    let orbitRight = new THREE.Vector3().crossVectors(up, sunDir).normalize();
    if (orbitRight.lengthSq() < 0.0001) orbitRight = new THREE.Vector3(1, 0, 0);
    return sunDir.clone().multiplyScalar(Math.cos(relativeLongitude))
      .add(orbitRight.multiplyScalar(Math.sin(relativeLongitude)))
      .normalize()
      .multiplyScalar(distance);
  }

  function orientMoonTowardEarth() {
    moon.lookAt(0, 0, 0);
    moon.rotateY(Math.PI);
  }

  function updateCelestialPositions() {
    sunGroup.position.copy(sun.position.clone().normalize().multiplyScalar(currentSunDistance()));
    moon.position.copy(getApproxMoonScenePosition(currentMoonDistance()));
    moon.scale.setScalar(currentMoonSizeScale());
    orientMoonTowardEarth();
    mars.position.copy(getApproxMarsScenePosition(currentMarsDistance()));
    mars.scale.setScalar(currentMarsSizeScale());
  }

  const earthGroup = new THREE.Group();
  scene.add(earthGroup);
  const dayMap = loader.load(ASSETS.earthDay);
  const nightMap = loader.load(ASSETS.earthNight);
  const normalMap = loader.load(ASSETS.earthNormal);
  const specularMap = loader.load(ASSETS.earthSpecular);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), new THREE.MeshPhongMaterial({
    map: dayMap,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    specularMap,
    shininess: 12,
    specular: new THREE.Color(0x111111),
    color: new THREE.Color(0xffffff),
    emissive: new THREE.Color(0x000000)
  }));
  earthGroup.add(earth);

  const nightMaterial = new THREE.ShaderMaterial({
    uniforms: { nightMap: { value: nightMap }, lightDir: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: `varying vec2 vUv; varying vec3 vNormalW; void main() { vUv = uv; vNormalW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D nightMap; uniform vec3 lightDir; varying vec2 vUv; varying vec3 vNormalW; void main() { float lDot = dot(normalize(vNormalW), normalize(lightDir)); float alpha = smoothstep(0.2, -0.2, lDot); gl_FragColor = vec4(texture2D(nightMap, vUv).rgb, alpha); }`,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false
  });
  earthGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.0015, 128, 128), nightMaterial));

  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: { lightDir: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: `varying vec3 vNormalView; varying vec3 vNormalWorld; void main() { vNormalView = normalize(normalMatrix * normal); vNormalWorld = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 lightDir; varying vec3 vNormalView; varying vec3 vNormalWorld; void main() { float fresnel = pow(1.0 - max(0.0, dot(vNormalView, vec3(0.0, 0.0, 1.0))), 2.8); float lDot = dot(normalize(vNormalWorld), normalize(lightDir)); gl_FragColor = vec4(mix(vec3(1.5, 0.5, 0.1), vec3(0.3, 0.6, 1.0), smoothstep(-0.15, 0.4, lDot)), fresnel * smoothstep(-0.05, 0.2, lDot) * 1.2); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide
  });
  earthGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.032, 128, 128), atmosphereMaterial));

  const auroraMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, lightDir: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: `varying vec3 vPos; varying vec3 vNormalWorld; void main() { vPos = position; vNormalWorld = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; uniform vec3 lightDir; varying vec3 vPos; varying vec3 vNormalWorld;
      float hash(vec3 p) { p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float f = 0.0; float amp = 0.5; for(int i=0; i<4; i++){ f += amp * noise(p); p *= 2.0; amp *= 0.5; } return f; }
      void main() {
        vec3 nPos = normalize(vPos);
        float lat = abs(nPos.y);
        float band = smoothstep(0.78, 0.88, lat) * smoothstep(0.98, 0.90, lat);
        if (band <= 0.0) discard;
        float n1 = fbm(vec3(nPos.x * 20.0, nPos.y * 5.0, nPos.z * 20.0) + vec3(time * 0.12, 0, 0));
        float n2 = fbm(vec3(nPos.x * 40.0, nPos.y * 10.0, nPos.z * 40.0) - vec3(0, 0, time * 0.22));
        float cur = smoothstep(0.4, 0.75, n1 * n2 + n2 * 0.45);
        gl_FragColor = vec4(mix(vec3(0.1, 1.0, 0.3), vec3(1.0, 0.2, 0.8), n1 * 1.5), band * cur * smoothstep(0.1, -0.2, dot(normalize(vNormalWorld), normalize(lightDir))) * 0.95);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide
  });
  earthGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.02, 128, 128), auroraMaterial));

  function updateEarthSpin() {
    const now = new Date();
    earthGroup.rotation.y = (((now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600) / 24) * Math.PI * 2) - Math.PI;
  }

  function latLngToVec(lat, lng, radius = 1) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  function getSunCinematicAnchor() {
    return sunGroup.position.clone().multiplyScalar(0.30);
  }

  function getTargetPosition(name) {
    if (name === 'earth') return new THREE.Vector3(0, 0, 0);
    if (name === 'sun') return getSunCinematicAnchor();
    if (name === 'moon') return moon.position.clone();
    if (name === 'mars') return mars.position.clone();
    return new THREE.Vector3(0, 0, 0);
  }

  function sphericalOffset(theta, phi, radius) {
    const cp = Math.cos(phi);
    return new THREE.Vector3(
      Math.sin(theta) * cp * radius,
      Math.sin(phi) * radius,
      Math.cos(theta) * cp * radius
    );
  }

  function slerpUnitVectors(from, to, amount) {
    const a = from.clone().normalize();
    const b = to.clone().normalize();
    const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
    if (dot > 0.9995) return a.lerp(b, amount).normalize();
    const theta = Math.acos(dot);
    const sinTheta = Math.sin(theta);
    if (Math.abs(sinTheta) < 0.0001) {
      const fallbackAxis = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const axis = new THREE.Vector3().crossVectors(a, fallbackAxis).normalize();
      return a.applyAxisAngle(axis, Math.PI * amount).normalize();
    }
    return a.multiplyScalar(Math.sin((1 - amount) * theta) / sinTheta).add(b.multiplyScalar(Math.sin(amount * theta) / sinTheta)).normalize();
  }

  function closestPointOnSegment(a, b, point) {
    const ab = b.clone().sub(a);
    const denom = ab.lengthSq();
    if (denom < 0.0001) return { point: a.clone(), amount: 0 };
    const amount = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / denom, 0, 1);
    return { point: a.clone().add(ab.multiplyScalar(amount)), amount };
  }

  function routeDetourAroundSphere(a, b, obstacle) {
    const closest = closestPointOnSegment(a, b, obstacle.center);
    const startDistance = a.distanceTo(obstacle.center);
    const endDistance = b.distanceTo(obstacle.center);
    if (startDistance < obstacle.radius || endDistance < obstacle.radius) return null;
    if (closest.point.distanceTo(obstacle.center) >= obstacle.radius) return null;

    const segmentDir = b.clone().sub(a).normalize();
    let away = closest.point.clone().sub(obstacle.center);
    if (away.lengthSq() < 0.0001) {
      away = new THREE.Vector3().crossVectors(segmentDir, new THREE.Vector3(0, 1, 0));
      if (away.lengthSq() < 0.0001) away.crossVectors(segmentDir, new THREE.Vector3(1, 0, 0));
    }
    away.normalize();
    const sideBias = obstacle.center.clone().cross(segmentDir);
    if (sideBias.lengthSq() > 0.0001 && away.dot(sideBias) < 0) away.multiplyScalar(-1);
    return closest.point.clone().add(away.multiplyScalar(obstacle.radius * 1.18));
  }

  function addAvoidanceForObstacles(points, obstacles) {
    const result = [points[0].clone()];
    for (let i = 1; i < points.length; i++) {
      const start = result[result.length - 1];
      const end = points[i].clone();
      for (const obstacle of obstacles) {
        const detour = routeDetourAroundSphere(start, end, obstacle);
        if (detour) result.push(detour);
      }
      result.push(end);
    }
    return result;
  }

  function targetFlightObstacles(targetName) {
    const obstacles = [];
    if (targetName !== 'earth') obstacles.push({ name: 'earth', center: new THREE.Vector3(0, 0, 0), radius: 1.46 });
    if (targetName !== 'sun') obstacles.push({ name: 'sun', center: sunGroup.position.clone(), radius: Math.max(0.42, 0.115 * Math.max(sunGroup.scale.x, SUN_CINEMATIC_SCALE) + 0.42) });
    if (targetName !== 'moon') obstacles.push({ name: 'moon', center: moon.position.clone(), radius: 0.22 });
    if (targetName !== 'mars') obstacles.push({ name: 'mars', center: mars.position.clone(), radius: 0.24 });
    return obstacles;
  }

  function buildTargetFlightCurve(startVec, endVec, targetName) {
    const midpoint = startVec.clone().add(endVec).multiplyScalar(0.5);
    const outward = midpoint.lengthSq() > 0.0001 ? midpoint.clone().normalize() : endVec.clone().normalize();
    const distance = startVec.distanceTo(endVec);
    const lift = Math.min(3.4, Math.max(0.35, distance * 0.18));
    const points = [startVec.clone(), midpoint.add(outward.multiplyScalar(lift)), endVec.clone()];
    return new THREE.CatmullRomCurve3(addAvoidanceForObstacles(points, targetFlightObstacles(targetName)), false, 'centripetal', 0.35);
  }

  function flyToTarget(targetName) {
    if (!TARGET_CONFIGS[targetName]) return;
    if (isMicroView) switchToMacro();
    if (targetName === currentTargetName && !flight.active) return;

    flight.active = true;
    flight.startTime = performance.now();
    flight.duration = targetName === 'sun' ? 3200 : 2500;
    flight.startRadius = orbit.radius;
    flight.endRadius = TARGET_CONFIGS[targetName].defaultRadius;
    flight.startCenter.copy(dynamicCenter);
    flight.endCenterName = targetName;
    flight.startEarthScale = 1.0;
    flight.startSunFocus = sunFocusBlend;
    flight.endSunFocus = targetName === 'sun' ? 1.0 : 0.0;
    flight.startTheta = orbit.theta;
    flight.startPhi = orbit.phi;

    const targetPosition = getTargetPosition(targetName);
    if (targetName === 'moon') {
      flight.endTheta = Math.atan2(targetPosition.x, targetPosition.z) + 0.4;
      flight.endPhi = 0.15;
    } else if (targetName === 'mars') {
      flight.endTheta = Math.atan2(targetPosition.x, targetPosition.z) + 0.32;
      flight.endPhi = 0.12;
    } else if (targetName === 'sun') {
      flight.endTheta = 0.0;
      flight.endPhi = 0.05;
    } else {
      const naturalEarthDir = camera.position.lengthSq() > 0.0001
        ? camera.position.clone().normalize()
        : sun.position.clone().normalize();
      flight.endTheta = Math.atan2(naturalEarthDir.x, naturalEarthDir.z);
      flight.endPhi = Math.asin(THREE.MathUtils.clamp(naturalEarthDir.y, -1, 1));
    }

    let dTheta = flight.endTheta - flight.startTheta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    flight.endTheta = flight.startTheta + dTheta;

    const endCameraPos = targetPosition.clone().add(sphericalOffset(flight.endTheta, flight.endPhi, flight.endRadius));
    flight.cameraCurve = buildTargetFlightCurve(camera.position.clone(), endCameraPos, targetName);

    currentTargetName = targetName;
    currentConfig = TARGET_CONFIGS[targetName];
    syncTargetDropdownActive(targetName);
    emit('targetchange', { targetName });
  }

  function ensureMapLibreCss() {
    if (!MAPLIBRE_CSS_URL) return;
    const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .some(link => link.href === MAPLIBRE_CSS_URL || link.href.includes('/maplibre-gl.css'));
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = MAPLIBRE_CSS_URL;
    link.dataset.earthCoreDependency = 'maplibre-css';
    document.head.appendChild(link);
  }

  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (mapLibreLoadPromise) return mapLibreLoadPromise;
    ensureMapLibreCss();
    mapLibreLoadPromise = new Promise((resolve, reject) => {
      const existingScript = Array.from(document.scripts)
        .find(script => script.src === MAPLIBRE_JS_URL || script.src.includes('/maplibre-gl.js'));
      const script = existingScript || document.createElement('script');
      const finish = () => {
        if (window.maplibregl) resolve(window.maplibregl);
        else reject(new Error('MapLibre loaded without exposing window.maplibregl.'));
      };
      if (window.maplibregl) {
        resolve(window.maplibregl);
        return;
      }
      script.addEventListener('load', finish, { once: true });
      script.addEventListener('error', () => reject(new Error(`Could not load MapLibre from ${MAPLIBRE_JS_URL}`)), { once: true });
      if (!existingScript) {
        script.src = MAPLIBRE_JS_URL;
        script.async = true;
        script.dataset.earthCoreDependency = 'maplibre-js';
        document.head.appendChild(script);
      }
    }).catch(error => {
      mapLibreLoadPromise = null;
      console.warn(error.message || error);
      return null;
    });
    return mapLibreLoadPromise;
  }

  function normalizeLng(lng) {
    let value = lng;
    while (value < -180) value += 360;
    while (value > 180) value -= 360;
    return value;
  }

  function subsolarPoint(date = new Date()) {
    const days = (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86400000;
    const meanAnomaly = degToRad(normalizeDeg(357.529 + 0.98560028 * days));
    const meanLongitude = normalizeDeg(280.459 + 0.98564736 * days);
    const eclipticLongitude = degToRad(normalizeDeg(
      meanLongitude +
      1.915 * Math.sin(meanAnomaly) +
      0.020 * Math.sin(2 * meanAnomaly)
    ));
    const obliquity = degToRad(23.439 - 0.00000036 * days);
    const rightAscension = normalizeDeg(radToDeg(Math.atan2(
      Math.cos(obliquity) * Math.sin(eclipticLongitude),
      Math.cos(eclipticLongitude)
    )));
    const declination = radToDeg(Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)));
    const gmst = normalizeDeg((18.697374558 + 24.06570982441908 * days) * 15);
    return { lat: declination, lng: normalizeLng(rightAscension - gmst) };
  }

  function sunAltitudeSignal(lat, lng, subsolar) {
    const phi = degToRad(lat);
    const decl = degToRad(subsolar.lat);
    const hourAngle = degToRad(normalizeLng(lng - subsolar.lng));
    return (
      Math.sin(phi) * Math.sin(decl) +
      Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle)
    );
  }

  function isMapCenterInNight(lat, lng, date = new Date()) {
    const subsolar = subsolarPoint(date);
    lastMapSubsolar = subsolar;
    return sunAltitudeSignal(lat, lng, subsolar) < 0;
  }

  function mapStyleModeForLocation(lat, lng) {
    const center = Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : streetMap && streetMap.getCenter ? streetMap.getCenter() : { lat: 0, lng: 0 };
    const useNight = isMapCenterInNight(center.lat, center.lng);
    mapNightModeActive = useNight;
    return useNight ? 'night' : 'day';
  }

  function updateBaseMapNightMode(lat, lng) {
    if (options.mapNightMode === false || !streetMap) return;
    const nextMode = mapStyleModeForLocation(lat, lng);
    if (nextMode === currentMapStyleMode) return;
    const previousMode = currentMapStyleMode;
    currentMapStyleMode = nextMode;
    lastPolishedStyleMode = null;
    if (MAP_STYLE_URLS[nextMode] !== MAP_STYLE_URLS[previousMode]) {
      mapPaintDefaults.clear();
      streetMap.setStyle(MAP_STYLE_URLS[nextMode]);
    } else {
      tuneVectorMapStyle();
    }
    scheduleMapLayerInstall();
    scheduleVectorMapTune();
  }

  function scheduleVectorMapTune() {
    requestAnimationFrame(tuneVectorMapStyle);
    setTimeout(tuneVectorMapStyle, 100);
    setTimeout(tuneVectorMapStyle, 500);
  }

  function layerName(layer) {
    return `${layer.id || ''} ${layer['source-layer'] || ''}`.toLowerCase();
  }

  function firstLayerBeforeRoadsAndLabels() {
    const style = streetMap && streetMap.getStyle ? streetMap.getStyle() : null;
    const layers = style && Array.isArray(style.layers) ? style.layers : [];
    const match = layers.find(layer => {
      const name = layerName(layer);
      return layer.type === 'line' || layer.type === 'symbol' || /road|transport|place|label/.test(name);
    });
    return match ? match.id : undefined;
  }

  function installMapCredits() {
    if (!mapContainer || mapContainer.querySelector('.earth-core-map-credits')) return;

    if (!document.getElementById('earth-core-map-credit-styles')) {
      const style = document.createElement('style');
      style.id = 'earth-core-map-credit-styles';
      style.textContent = `
        .earth-core-map-credits{
          position:absolute;
          left:12px;
          bottom:12px;
          z-index:3;
          width:190px;
          border-radius:16px;
          background:rgba(8,14,24,.72);
          color:rgba(238,244,255,.86);
          box-shadow:0 12px 34px rgba(0,0,0,.32);
          backdrop-filter:blur(14px);
          -webkit-backdrop-filter:blur(14px);
          font:700 10px/1.2 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
          pointer-events:auto;
          overflow:hidden;
        }
        .earth-core-map-credit-toggle{
          width:100%;
          border:1px solid rgba(255,255,255,.14);
          border-radius:999px;
          padding:7px 11px;
          background:rgba(8,14,24,.74);
          color:rgba(238,244,255,.90);
          font:850 10px/1.2 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
          text-align:left;
          cursor:pointer;
          box-shadow:0 8px 22px rgba(0,0,0,.24);
        }
        .earth-core-map-credit-toggle:after{content:"+";float:right;opacity:.72}
        .earth-core-map-credits.open .earth-core-map-credit-toggle{border-radius:14px 14px 0 0}
        .earth-core-map-credits.open .earth-core-map-credit-toggle:after{content:"×"}
        .earth-core-map-credit-panel{
          display:none;
          padding:9px 11px 10px;
          border:1px solid rgba(255,255,255,.12);
          border-top:0;
          border-radius:0 0 14px 14px;
          background:rgba(8,14,24,.82);
        }
        .earth-core-map-credits.open .earth-core-map-credit-panel{display:grid;gap:7px}
        .earth-core-map-credits a{color:inherit;text-decoration:none}
        .earth-core-map-credits a:hover{text-decoration:underline}
        @media (max-width:760px){
          .earth-core-map-credits{left:8px;bottom:8px;width:176px;font-size:9px}
        }
      `;
      document.head.appendChild(style);
    }

    const credits = document.createElement('div');
    credits.className = 'earth-core-map-credits';
    credits.innerHTML = `
      <button class="earth-core-map-credit-toggle" type="button" aria-expanded="false">Credits</button>
      <div class="earth-core-map-credit-panel" aria-label="Map credits">
        <a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>
        <a href="https://www.eorc.jaxa.jp/ALOS/en/aw3d30/" target="_blank" rel="noopener">AW3D30 (JAXA)</a>
        <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a>
        <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap</a>
      </div>
    `;
    const toggle = credits.querySelector('.earth-core-map-credit-toggle');
    toggle.addEventListener('click', () => {
      const open = credits.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    mapContainer.appendChild(credits);
  }

  function addTerrainReliefLayer() {
    if (options.mapTerrain !== true) return false;
    if (!streetMap || !streetMap.isStyleLoaded || !streetMap.isStyleLoaded()) return false;
    try {
      if (!streetMap.getSource(MAP_TERRAIN_SOURCE_ID)) {
        streetMap.addSource(MAP_TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',
          tileSize: 256
        });
      }
      if (!streetMap.getLayer(MAP_TERRAIN_LAYER_ID)) {
        streetMap.addLayer({
          id: MAP_TERRAIN_LAYER_ID,
          type: 'hillshade',
          source: MAP_TERRAIN_SOURCE_ID,
          paint: {}
        }, firstLayerBeforeRoadsAndLabels());
      }
      const night = currentMapStyleMode === 'night';
      streetMap.setPaintProperty(MAP_TERRAIN_LAYER_ID, 'hillshade-exaggeration', night ? 0.5 : 0.45);
      streetMap.setPaintProperty(MAP_TERRAIN_LAYER_ID, 'hillshade-shadow-color', night ? '#091220' : '#6b6657');
      streetMap.setPaintProperty(MAP_TERRAIN_LAYER_ID, 'hillshade-highlight-color', night ? '#6f8fb9' : '#fff4d0');
      streetMap.setPaintProperty(MAP_TERRAIN_LAYER_ID, 'hillshade-accent-color', night ? '#233b5a' : '#9f8e67');
      return true;
    } catch (error) {
      console.warn('Could not add earth-core terrain relief layer.', error);
      return false;
    }
  }

  function paintIfSupported(layerId, property, value) {
    try {
      const key = `${layerId}:${property}`;
      if (!mapPaintDefaults.has(key)) {
        mapPaintDefaults.set(key, streetMap.getPaintProperty(layerId, property));
      }
      streetMap.setPaintProperty(layerId, property, value);
    } catch (_) {
      // Different vector styles expose different layer paint contracts.
    }
  }

  function restorePaintIfSupported(layerId, property) {
    try {
      const key = `${layerId}:${property}`;
      if (!mapPaintDefaults.has(key)) return;
      const original = mapPaintDefaults.get(key);
      streetMap.setPaintProperty(layerId, property, original);
    } catch (_) {
      // Different vector styles expose different layer paint contracts.
    }
  }

  function tuneVectorMapStyle() {
    if (!streetMap || !streetMap.isStyleLoaded || !streetMap.isStyleLoaded()) return;
    if (lastPolishedStyleMode === currentMapStyleMode) return;
    const style = streetMap.getStyle();
    const layers = style && Array.isArray(style.layers) ? style.layers : [];
    const night = currentMapStyleMode === 'night';

    addTerrainReliefLayer();

    layers.forEach(layer => {
      const name = layerName(layer);
      if (layer.type === 'symbol') {
        if (night) {
          paintIfSupported(layer.id, 'text-color', '#edf4ff');
          paintIfSupported(layer.id, 'text-halo-color', '#06111f');
          paintIfSupported(layer.id, 'text-halo-width', 2.1);
          paintIfSupported(layer.id, 'text-halo-blur', 0.12);
          paintIfSupported(layer.id, 'icon-opacity', 0.96);
        } else {
          restorePaintIfSupported(layer.id, 'text-color');
          restorePaintIfSupported(layer.id, 'text-halo-color');
          restorePaintIfSupported(layer.id, 'text-halo-width');
          restorePaintIfSupported(layer.id, 'text-halo-blur');
          restorePaintIfSupported(layer.id, 'icon-opacity');
        }
      } else if (layer.type === 'line') {
        if (night && /building/.test(name)) {
          paintIfSupported(layer.id, 'line-color', '#f1e2bc');
          paintIfSupported(layer.id, 'line-opacity', 0.94);
        } else if (night && /boundary/.test(name)) {
          paintIfSupported(layer.id, 'line-opacity', 0.78);
        } else if (!night) {
          restorePaintIfSupported(layer.id, 'line-color');
          restorePaintIfSupported(layer.id, 'line-opacity');
        }
      } else if (layer.type === 'fill') {
        if (/building/.test(name)) {
          if (night) {
            paintIfSupported(layer.id, 'fill-color', '#ead7aa');
            paintIfSupported(layer.id, 'fill-opacity', 0.9);
          } else {
            restorePaintIfSupported(layer.id, 'fill-color');
            restorePaintIfSupported(layer.id, 'fill-opacity');
          }
        } else if (/water|ocean|river|lake/.test(name)) {
          if (night) {
            paintIfSupported(layer.id, 'fill-color', /river|lake|water/.test(name) ? '#1b5f87' : '#0a2542');
          } else {
            restorePaintIfSupported(layer.id, 'fill-color');
          }
        } else if (/park|green|wood|forest|grass|landcover|landuse/.test(name)) {
          if (night) {
            paintIfSupported(layer.id, 'fill-color', '#1f6f45');
            paintIfSupported(layer.id, 'fill-opacity', 0.82);
          } else {
            restorePaintIfSupported(layer.id, 'fill-color');
            restorePaintIfSupported(layer.id, 'fill-opacity');
          }
        } else if (/land|background|earth/.test(name)) {
          if (night) {
            paintIfSupported(layer.id, 'fill-color', '#0a1220');
          } else {
            restorePaintIfSupported(layer.id, 'fill-color');
          }
        }
      } else if (layer.type === 'background') {
        if (night) {
          paintIfSupported(layer.id, 'background-color', '#07101e');
        } else {
          restorePaintIfSupported(layer.id, 'background-color');
        }
      }
    });

    lastPolishedStyleMode = currentMapStyleMode;
  }

  function initOrUpdateMap(lat, lng, zoom = MICRO_START_ZOOM) {
    if (!window.maplibregl) {
      pendingMapRequest = { lat, lng, zoom };
      loadMapLibre().then(library => {
        if (!library || !pendingMapRequest) return;
        const next = pendingMapRequest;
        pendingMapRequest = null;
        initOrUpdateMap(next.lat, next.lng, next.zoom);
        if (isMicroView && streetMap) streetMap.resize();
      });
      return null;
    }

    pendingMapRequest = null;
    if (!streetMap) {
      currentMapStyleMode = options.mapNightMode === false ? 'day' : mapStyleModeForLocation(lat, lng);
      streetMap = new window.maplibregl.Map({
        container: mapContainer,
        style: MAP_STYLE_URLS[currentMapStyleMode],
        center: [lng, lat],
        zoom,
        pitch: 0,
        interactive: true,
        attributionControl: false
      });
      installMapCredits();

      streetMap.on('zoom', () => {
        if (isMicroView && streetMap.getZoom() < MICRO_EXIT_ZOOM) switchToMacro();
      });
      streetMap.on('moveend', () => updateBaseMapNightMode());
      streetMap.on('load', () => {
        tuneVectorMapStyle();
        scheduleVectorMapTune();
        installStoredMapLayers();
        scheduleMapLayerInstall();
        emit('mapload', { map: streetMap });
      });
      streetMap.on('styledata', () => {
        tuneVectorMapStyle();
        scheduleVectorMapTune();
        scheduleMapLayerInstall();
      });
    } else {
      streetMap.jumpTo({ center: [lng, lat], zoom });
      streetMap.resize();
      updateBaseMapNightMode(lat, lng);
      tuneVectorMapStyle();
      scheduleVectorMapTune();
      scheduleMapLayerInstall();
    }
    return streetMap;
  }

  function switchToMicro(lat, lng, options = {}) {
    const zoom = Number.isFinite(options.zoom) ? options.zoom : MICRO_START_ZOOM;
    isMicroView = true;
    initOrUpdateMap(lat, lng, zoom);
    document.body.classList.add('micro-view');
    requestAnimationFrame(() => {
      if (streetMap) streetMap.resize();
    });
    emit('viewchange', { mode: 'map', lat, lng, zoom });
  }

  function switchToMacro() {
    isMicroView = false;
    document.body.classList.remove('micro-view');
    orbit.radius = MACRO_MIN_RADIUS + 0.05;
    updateCamera();
    emit('viewchange', { mode: 'globe' });
  }

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(0, 0);

  function getScreenCenterLatLng() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObject(earth, false);
    if (!intersects.length) return null;
    const pt = intersects[0].point.clone();
    earthGroup.worldToLocal(pt);
    pt.normalize();

    const lat = Math.asin(pt.y) * 180 / Math.PI;
    let lng = Math.atan2(pt.z, -pt.x) * 180 / Math.PI - 180;
    while (lng < -180) lng += 360;
    while (lng > 180) lng -= 360;
    return { lat, lng };
  }

  function flyToLocation({ lat, lng, altitude = 1.39, mapZoom = MICRO_START_ZOOM, enterMap = false, duration = 4200 } = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (flight.active) flight.active = false;

    const startCameraPos = camera.position.clone();
    const targetSurface = latLngToVec(lat, lng, 1.045).applyAxisAngle(new THREE.Vector3(0, 1, 0), earthGroup.rotation.y);
    const targetDir = targetSurface.clone().normalize();
    const startDir = startCameraPos.lengthSq() > 0.0001 ? startCameraPos.clone().normalize() : targetDir.clone();
    const highApproach = targetDir.clone().multiplyScalar(1.72);
    const points = [
      startCameraPos.clone(),
      slerpUnitVectors(startDir, targetDir, 0.36).multiplyScalar(Math.max(startCameraPos.length(), 2.75)),
      slerpUnitVectors(startDir, targetDir, 0.70).multiplyScalar(2.05),
      highApproach,
      targetDir.clone().multiplyScalar(altitude)
    ];
    const cameraCurve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
    const startTime = performance.now();
    const startCenter = dynamicCenter.clone();
    const startSunFocus = sunFocusBlend;
    currentTargetName = 'earth';
    currentConfig = TARGET_CONFIGS.earth;
    syncTargetDropdownActive('earth');

    function step() {
      const raw = Math.min(1, (performance.now() - startTime) / duration);
      const p = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      dynamicCenter.lerpVectors(startCenter, new THREE.Vector3(0, 0, 0), p);
      earthGroup.scale.setScalar(1);
      sunFocusBlend = startSunFocus + (0 - startSunFocus) * p;
      const cameraPos = cameraCurve.getPoint(p);
      const relativeCamera = cameraPos.clone().sub(dynamicCenter);
      const radius = Math.max(0.0001, relativeCamera.length());
      orbit.radius = radius;
      orbit.theta = Math.atan2(relativeCamera.x, relativeCamera.z);
      orbit.phi = Math.asin(THREE.MathUtils.clamp(relativeCamera.y / radius, -1, 1));
      updateCamera();

      if (raw < 1) {
        requestAnimationFrame(step);
      } else if (enterMap) {
        switchToMicro(lat, lng, { zoom: mapZoom });
      }
    }
    step();
    emit('flytolocation', { lat, lng });
  }

  function installMapLayer(layer) {
    if (!streetMap || !streetMap.getStyle || !streetMap.getStyle()) return false;
    try {
      if (layer.source && !streetMap.getSource(layer.sourceId)) {
        streetMap.addSource(layer.sourceId, layer.source);
      }
      (layer.layers || []).forEach(mapLayer => {
        if (!streetMap.getLayer(mapLayer.id)) streetMap.addLayer(mapLayer, layer.beforeId);
      });
      return true;
    } catch (error) {
      const message = String(error && (error.message || error));
      if (/style/i.test(message) || /loaded/i.test(message)) return false;
      throw error;
    }
  }

  function installStoredMapLayers() {
    for (const layer of mapLayers.values()) installMapLayer(layer);
  }

  function scheduleMapLayerInstall() {
    requestAnimationFrame(installStoredMapLayers);
    setTimeout(installStoredMapLayers, 100);
    setTimeout(installStoredMapLayers, 500);
  }

  function addThreeLayer(id, object, options = {}) {
    if (!id || !object) return null;
    if (threeLayers.has(id)) removeThreeLayer(id);
    const parent = options.parent === 'scene' ? scene : earthGroup;
    parent.add(object);
    threeLayers.set(id, { id, object, parent, update: options.update || null });
    emit('layeradd', { id, type: 'three' });
    return object;
  }

  function removeThreeLayer(id) {
    const layer = threeLayers.get(id);
    if (!layer) return false;
    layer.parent.remove(layer.object);
    threeLayers.delete(id);
    emit('layerremove', { id, type: 'three' });
    return true;
  }

  function addMapLayer(id, definition) {
    if (!id || !definition) return false;
    mapLayers.set(id, { id, ...definition });
    const installed = installMapLayer(mapLayers.get(id));
    if (!installed && streetMap) scheduleMapLayerInstall();
    emit('layeradd', { id, type: 'map', installed });
    return installed;
  }

  function removeMapLayer(id) {
    const definition = mapLayers.get(id);
    if (!definition) return false;
    if (streetMap) {
      [...(definition.layers || [])].reverse().forEach(layer => {
        if (streetMap.getLayer(layer.id)) streetMap.removeLayer(layer.id);
      });
      if (definition.sourceId && streetMap.getSource(definition.sourceId)) streetMap.removeSource(definition.sourceId);
    }
    mapLayers.delete(id);
    emit('layerremove', { id, type: 'map' });
    return true;
  }

  function registerLayer(id, layer = {}) {
    if (!id) return null;
    if (appLayers.has(id)) unregisterLayer(id);

    const mounted = { id, layer, threeId: null, mapId: null };
    if (layer.threeObject) {
      mounted.threeId = `${id}:three`;
      addThreeLayer(mounted.threeId, layer.threeObject, {
        parent: layer.threeParent,
        update: layer.update
      });
    }
    if (layer.mapDefinition) {
      mounted.mapId = `${id}:map`;
      addMapLayer(mounted.mapId, layer.mapDefinition);
    }
    if (typeof layer.mount === 'function') layer.mount(window.EarthSystem);
    appLayers.set(id, mounted);
    emit('layerregister', { id });
    return mounted;
  }

  function unregisterLayer(id) {
    const mounted = appLayers.get(id);
    if (!mounted) return false;
    if (typeof mounted.layer.unmount === 'function') mounted.layer.unmount(window.EarthSystem);
    if (mounted.threeId) removeThreeLayer(mounted.threeId);
    if (mounted.mapId) removeMapLayer(mounted.mapId);
    appLayers.delete(id);
    emit('layerunregister', { id });
    return true;
  }

  function getState() {
    return {
      mode: isMicroView ? 'map' : 'globe',
      target: currentTargetName,
      spaceScaleMode,
      spaceSizeMode,
      spaceDistances: {
        moon: currentMoonDistance(),
        mars: currentMarsDistance(),
        sun: currentSunDistance(),
        marsKm: currentMarsDistanceKm()
      },
      spaceSizes: {
        moonScale: currentMoonSizeScale(),
        marsScale: currentMarsSizeScale(),
        sunScale: currentSunSizeScale()
      },
      mapNightMode: {
        enabled: options.mapNightMode !== false,
        active: mapNightModeActive,
        style: currentMapStyleMode,
        subsolar: lastMapSubsolar ? { ...lastMapSubsolar } : null
      },
      orbit: { ...orbit },
      center: dynamicCenter.clone(),
      cameraPosition: camera.position.clone()
    };
  }

  function setOrbit(nextOrbit = {}) {
    if (Number.isFinite(nextOrbit.radius)) {
      orbit.radius = Math.max(currentConfig.minRadius, Math.min(currentConfig.maxRadius, nextOrbit.radius));
    }
    if (Number.isFinite(nextOrbit.theta)) orbit.theta = nextOrbit.theta;
    if (Number.isFinite(nextOrbit.phi)) orbit.phi = Math.max(-1.25, Math.min(1.25, nextOrbit.phi));
    updateCamera();
  }

  function mobileTouchDistance(touches) {
    if (!touches || touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function applyZoom(deltaY) {
    if (flight.active || isMicroView) return;
    const zoomAmount = (deltaY * ORBIT_ZOOM_SPEED) / zoomMassFactor();
    orbit.radius += zoomAmount;
    orbit.phi = Math.max(-1.25, Math.min(1.25, orbit.phi));

    if (currentTargetName === 'earth' && orbit.radius <= currentConfig.minRadius && deltaY < 0) {
      const loc = getScreenCenterLatLng();
      if (loc) {
        switchToMicro(loc.lat, loc.lng);
        return;
      }
    }
    orbit.radius = Math.max(currentConfig.minRadius, Math.min(currentConfig.maxRadius, orbit.radius));
    updateCamera();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', e => {
    if (flight.active || isMicroView || mobilePinching) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  canvas.addEventListener('pointermove', e => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (!dragging || flight.active || isMicroView || mobilePinching) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    const panSpeed = zoomPanSensitivity() / zoomMassFactor();
    orbit.theta -= dx * 0.005 * panSpeed;
    orbit.phi += dy * 0.004 * panSpeed;
    orbit.phi = Math.max(-1.25, Math.min(1.25, orbit.phi));
    lastX = e.clientX;
    lastY = e.clientY;
    updateCamera();
  });

  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointerleave', () => { dragging = false; });

  canvas.addEventListener('touchstart', e => {
    if (isMicroView) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      mobilePinching = true;
      dragging = false;
      mobileLastPinchDistance = mobileTouchDistance(e.touches);
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (isMicroView) return;
    if (e.touches.length === 2 && mobilePinching) {
      e.preventDefault();
      const dist = mobileTouchDistance(e.touches);
      const delta = dist - mobileLastPinchDistance;
      mobileLastPinchDistance = dist;
      applyZoom(-delta * 2.25);
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    if (e.touches.length < 2) {
      mobilePinching = false;
      mobileLastPinchDistance = 0;
    }
  }, { passive: false });

  canvas.addEventListener('touchcancel', () => {
    mobilePinching = false;
    mobileLastPinchDistance = 0;
  }, { passive: false });

  canvas.addEventListener('wheel', e => {
    if (flight.active || isMicroView) return;
    e.preventDefault();
    applyZoom(e.deltaY);
  }, { passive: false });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    updateCamera();
    if (streetMap) streetMap.resize();
  });

  const targetBtn = document.getElementById('target-btn');
  const dropdownMenu = document.getElementById('dropdown-menu');
  const dropdownItems = document.querySelectorAll('.dropdown-item');
  const bodyIcons = { earth: '🌍', moon: '<span class="gray-moon">🌕</span>', mars: '<span class="mars-disc" aria-hidden="true"></span>', sun: '☀️' };
  const bodyNames = { earth: 'Earth', moon: 'Moon', mars: 'Mars', sun: 'Sun' };
  let scaleInfoPanel = null;

  function syncTargetDropdownActive(targetName) {
    targetBtn.innerHTML = `<span class="target-label" style="display:inline-flex;align-items:center;gap:8px;white-space:nowrap;"><span class="target-icon" style="display:inline-flex;align-items:center;justify-content:center;width:18px;">${bodyIcons[targetName]}</span><span>${bodyNames[targetName]}</span></span><span aria-hidden="true" style="margin-left:8px;">▾</span>`;
    dropdownItems.forEach(item => item.classList.toggle('active', item.dataset.target === targetName));
  }

  function createScaleInfoPill() {
    if (options.showSpaceScaleToggle === false) return;
    const container = document.getElementById('ui-container');
    if (!container || document.getElementById('space-scale-info-btn')) return;
    const button = document.createElement('button');
    button.id = 'space-scale-info-btn';
    button.type = 'button';
    button.textContent = 'Scale info';
    button.style.cssText = 'margin-top:10px;border:1px solid rgba(255,255,255,.13);border-radius:999px;padding:8px 12px;color:#dceaff;background:rgba(8,12,24,.62);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 12px 34px rgba(0,0,0,.30);font:800 10px/1 Inter,system-ui,sans-serif;cursor:pointer;';

    scaleInfoPanel = document.createElement('div');
    scaleInfoPanel.id = 'space-scale-info-panel';
    scaleInfoPanel.style.cssText = 'display:none;position:absolute;left:0;bottom:calc(100% + 10px);width:260px;padding:12px 13px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(8,12,24,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 18px 48px rgba(0,0,0,.45);color:#dceaff;font:11px/1.45 Inter,system-ui,sans-serif;';
    scaleInfoPanel.innerHTML = `
      <div style="color:#ffffff;font-weight:850;font-size:12px;margin-bottom:6px;">Log scale view</div>
      <div style="color:#bcd0f5;margin-bottom:8px;">Distances and sizes use real Moon, Mars, Earth, and Sun measurements, then compress them with a logarithmic scale so the whole local space system stays visible.</div>
      <div style="margin-bottom:6px;"><span style="color:#f4d06f;font-weight:850;">Distances:</span> Moon is the near anchor, Sun is the far anchor, and Mars moves between them from its current approximate distance.</div>
      <div><span style="color:#f4d06f;font-weight:850;">Sizes:</span> Moon, Mars, and Sun are sized from their real radii, then fit into a readable log range. Earth remains the visual home reference.</div>`;

    button.addEventListener('click', event => {
      event.stopPropagation();
      const visible = scaleInfoPanel.style.display === 'block';
      scaleInfoPanel.style.display = visible ? 'none' : 'block';
    });
    scaleInfoPanel.addEventListener('click', event => event.stopPropagation());
    container.appendChild(button);
    container.appendChild(scaleInfoPanel);
  }

  targetBtn.addEventListener('click', e => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('show');
  });

  window.addEventListener('click', () => {
    dropdownMenu.classList.remove('show');
    if (scaleInfoPanel) scaleInfoPanel.style.display = 'none';
  });
  dropdownItems.forEach(item => {
    item.addEventListener('click', e => {
      const target = e.target.closest('.dropdown-item').dataset.target;
      if (target) flyToTarget(target);
    });
  });

  createStars();
  createMilkyWay();
  createScaleInfoPill();
  updateCelestialPositions();
  updateEarthSpin();
  updateCamera();

  function animate() {
    requestAnimationFrame(animate);
    updateEarthSpin();
    updateCelestialPositions();

    if (flight.active) {
      const p = Math.min((performance.now() - flight.startTime) / flight.duration, 1);
      const routeP = smoothstep01(p);
      const sunRevealP = flight.endCenterName === 'sun' ? smoothstep01((p - 0.28) / 0.72) : routeP;
      const endPos = getTargetPosition(flight.endCenterName);
      dynamicCenter.lerpVectors(flight.startCenter, endPos, routeP);
      earthGroup.scale.setScalar(1);
      sunFocusBlend = flight.startSunFocus + (flight.endSunFocus - flight.startSunFocus) * sunRevealP;

      if (flight.cameraCurve) {
        const cameraPos = flight.cameraCurve.getPoint(routeP);
        const relativeCamera = cameraPos.clone().sub(dynamicCenter);
        const radius = Math.max(0.0001, relativeCamera.length());
        orbit.radius = radius;
        orbit.theta = Math.atan2(relativeCamera.x, relativeCamera.z);
        orbit.phi = Math.asin(THREE.MathUtils.clamp(relativeCamera.y / radius, -1, 1));
      }

      if (p >= 1) {
        flight.active = false;
        flight.cameraCurve = null;
      }
    } else {
      dynamicCenter.copy(getTargetPosition(currentTargetName));
      earthGroup.scale.setScalar(1);
      sunFocusBlend = currentTargetName === 'sun' ? 1.0 : 0.0;
    }

    nightMaterial.uniforms.lightDir.value.copy(sun.position).normalize();
    atmosphereMaterial.uniforms.lightDir.value.copy(sun.position).normalize();
    auroraMaterial.uniforms.lightDir.value.copy(sun.position).normalize();
    auroraMaterial.uniforms.time.value = t;
    t += 0.04;

    const sunPulse = 1 + Math.sin(t * 0.55) * 0.035;
    const easedSunFocus = smoothstep01(sunFocusBlend);
    setSunTextureMode(easedSunFocus > 0.28);
    sunGlow.scale.set(1.28 * sunPulse, 1.28 * sunPulse, 1);
    const desiredSunScale = (SUN_BASE_SCALE + (SUN_CINEMATIC_SCALE - SUN_BASE_SCALE) * easedSunFocus) * currentSunSizeScale();
    sunScaleTarget.set(desiredSunScale, desiredSunScale, desiredSunScale);
    sunGroup.scale.lerp(sunScaleTarget, flight.active ? 0.18 : 0.08);
    raysGroup.visible = easedSunFocus < 0.35;
    raysGroup.rotation.z += 0.0008;

    emit('beforeRender', { time: performance.now(), delta: 0 });

    threeLayers.forEach(layer => {
      if (typeof layer.update === 'function') layer.update(getState(), performance.now());
    });

    if (!isMicroView) {
      updateCamera();
      renderer.render(scene, camera);
    }
  }

  window.EarthSystem = {
    version: '0.1.0',
    THREE,
    scene,
    camera,
    renderer,
    earthGroup,
    earth,
    moon,
    mars,
    sun,
    sunGroup,
    map: () => streetMap,
    config: { targets: TARGET_CONFIGS, assets: ASSETS },
    getState,
    setOrbit,
    on,
    flyToTarget,
    flyToLocation,
    switchToMicro,
    switchToMacro,
    latLngToVec,
    addThreeLayer,
    removeThreeLayer,
    addMapLayer,
    removeMapLayer,
    registerLayer,
    unregisterLayer
  };

  emit('ready', { api: window.EarthSystem });
  window.dispatchEvent(new CustomEvent('earthsystem:ready', { detail: { api: window.EarthSystem } }));
  animate();
})();
