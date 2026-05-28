(() => {
  const DATA_URL = '../shared/assets/data/geonames-cities500.tsv';
  const FLY_TO_CITY_2D_ZOOM = 10.4;
  const ENERGY_SYSTEMS = [
    { name: 'Goa', lat: 15.5588, lng: 73.7700, primary: true },
    { name: 'Milan', lat: 45.4642, lng: 9.1900 },
    { name: 'Charlotte', lat: 35.2271, lng: -80.8431 },
    { name: 'Portland', lat: 45.5152, lng: -122.6784 },
    { name: 'Pune', lat: 18.5204, lng: 73.8567 },
    { name: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
    { name: 'Delhi', lat: 28.6139, lng: 77.2090 },
    { name: 'Bozeman', lat: 45.6770, lng: -111.0429 },
    { name: 'Victoria', lat: 48.4284, lng: -123.3656 },
    { name: 'Manchester', lat: 53.4808, lng: -2.2426 },
    { name: 'Chicago', lat: 41.8781, lng: -87.6298 },
    { name: 'Sydney', lat: -33.8688, lng: 151.2093 },
    { name: 'Bangalore', lat: 12.9716, lng: 77.5946 },
    { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
    { name: 'Singapore', lat: 1.3521, lng: 103.8198 },
    { name: 'Amritsar', lat: 31.6340, lng: 74.8723 },
    { name: 'Indore', lat: 22.7196, lng: 75.8577 }
  ];

  let api;
  let energyMode = false;
  let healthMode = false;
  let healthOnlyPositive = false;
  let healthOnlyNegative = false;
  let healthClusterMode = false;
  let heightMinPercent = 0;
  let heightMaxPercent = 100;
  let healthCities = [];
  let fullPopulationMaxPop = 1;
  let displayedHealthCities = [];
  let selectedEnergySystem = null;
  let focusedEnergySystem = null;
  let elevatedEnergy = false;
  let selectedHealthMeta = null;
  let energyLayer = null;
  let healthLayer = null;
  let healthGeoJSON = { type: 'FeatureCollection', features: [] };
  let mapHealthInteractionsReady = false;
  let flyRequestId = 0;

  const els = {
    energyBtn: document.getElementById('showEnergyBtn'),
    healthBtn: document.getElementById('showHealthBtn'),
    statusChip: document.getElementById('status-chip'),
    inspectPanel: document.getElementById('inspectPanel'),
    inspectTitle: document.getElementById('inspectTitle'),
    inspectSubtitle: document.getElementById('inspectSubtitle'),
    closeInspectBtn: document.getElementById('closeInspectBtn'),
    satisfiedBtn: document.getElementById('satisfiedBtn'),
    notSatisfiedBtn: document.getElementById('notSatisfiedBtn'),
    focusEnergyBtn: document.getElementById('focusEnergyBtn'),
    elevateBtn: document.getElementById('elevateBtn'),
    healthPositiveBtn: document.getElementById('healthPositiveBtn'),
    healthNegativeBtn: document.getElementById('healthNegativeBtn'),
    healthClusterBtn: document.getElementById('healthClusterBtn'),
    heightRangeMin: document.getElementById('heightRangeMin'),
    heightRangeMax: document.getElementById('heightRangeMax'),
    heightSliderFill: document.getElementById('heightSliderFill'),
    heightRangeReadout: document.getElementById('heightRangeReadout'),
    heightRangeCount: document.getElementById('heightRangeCount'),
    openFiltersBtn: document.getElementById('openFiltersBtn'),
    tooltip: document.getElementById('pillarTooltip'),
    hoverFlag: document.getElementById('cityHoverFlag'),
    flyInput: document.getElementById('flyInput'),
    flyClearBtn: document.getElementById('flyClearBtn'),
    flySuggestions: document.getElementById('flySuggestions')
  };

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  async function loadCities() {
    return window.GeoNames.loadPlaces({ url: DATA_URL, requirePopulation: true });
  }

  function labelForCity(d) {
    if (!d) return '';
    const name = d.city || d.cityAscii || d.placeLabel || `${Number(d.lat).toFixed(2)}, ${Number(d.lng).toFixed(2)}`;
    return d.adminName ? `${name}, ${d.adminName}` : name;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function normalizeSearch(value) {
    return window.GeoNames.normalizeSearch(value);
  }

  function healthShare(lat, lng) {
    const a = 0.5 + 0.5 * Math.sin((lat + 18.0) * 0.11);
    const b = 0.5 + 0.5 * Math.cos((lng - 22.0) * 0.08);
    const c = 0.5 + 0.5 * Math.sin((lat + lng) * 0.045);
    const d = 0.5 + 0.5 * Math.cos((lat - lng) * 0.035);
    return Math.pow(clamp01(a * 0.34 + b * 0.28 + c * 0.22 + d * 0.16), 1.65);
  }

  function fullPopulationMax() {
    return fullPopulationMaxPop || 1;
  }

  function populationNorm(pop) {
    return Math.sqrt((Number(pop) || 0) / fullPopulationMax());
  }

  function buildDisplayCities() {
    let data = healthCities.filter(d => {
      const percentile = populationNorm(d.pop) * 100;
      return percentile >= heightMinPercent && percentile <= heightMaxPercent;
    });
    if (!healthClusterMode) return data;

    const cells = new Map();
    for (const d of data) {
      const key = `${Math.floor((d.lat + 90) / 2.5)}_${Math.floor((d.lng + 180) / 2.5)}`;
      if (!cells.has(key)) {
        cells.set(key, {
          pop: 0,
          latSum: 0,
          lngSum: 0,
          count: 0,
          largestCity: null,
          largestPop: -Infinity,
          members: []
        });
      }
      const cell = cells.get(key);
      cell.pop += d.pop;
      cell.latSum += d.lat * d.pop;
      cell.lngSum += d.lng * d.pop;
      cell.count += 1;
      cell.members.push(d);
      if (d.pop > cell.largestPop) {
        cell.largestPop = d.pop;
        cell.largestCity = d;
      }
    }
    return Array.from(cells.values()).filter(d => d.pop && d.largestCity).map((d, i) => {
      const labelBase = labelForCity(d.largestCity) || 'Region';
      const placeLabel = d.count > 1 ? `${labelBase} region` : labelBase;
      return {
        id: `cluster-${i}`,
        source: 'cluster',
        city: placeLabel,
        cityAscii: placeLabel,
        adminName: d.largestCity.adminName || null,
        country: d.largestCity.country || null,
        iso2: d.largestCity.iso2 || null,
        placeLabel,
        anchorCity: d.largestCity.city || d.largestCity.cityAscii || '',
        lat: d.largestCity.lat,
        lng: d.largestCity.lng,
        centroidLat: d.latSum / d.pop,
        centroidLng: d.lngSum / d.pop,
        pop: d.pop,
        isCluster: d.count > 1,
        clusterCount: d.count,
        clusterMembers: d.members
          .slice()
          .sort((a, b) => b.pop - a.pop)
          .map(member => {
            const greenShare = healthShare(member.lat, member.lng);
            return {
              id: member.id,
              city: member.city,
              cityAscii: member.cityAscii,
              adminName: member.adminName || null,
              lat: member.lat,
              lng: member.lng,
              pop: member.pop,
              greenShare,
              redShare: 1 - greenShare
            };
          })
      };
    }).sort((a, b) => b.pop - a.pop);
  }

  function makeHealthGeoJSON(data) {
    return {
      type: 'FeatureCollection',
      features: data.map(d => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
        properties: {
          id: d.id,
          name: labelForCity(d),
          lat: d.lat,
          lng: d.lng,
          pop: d.pop,
          popNorm: populationNorm(d.pop),
          greenShare: healthShare(d.lat, d.lng),
          isCluster: !!d.isCluster,
          clusterCount: d.clusterCount || 1,
          anchorCity: d.anchorCity || d.city || d.cityAscii || ''
        }
      }))
    };
  }

  function showPanel(mode, payload) {
    els.inspectPanel.classList.add('visible');
    document.body.classList.toggle('health-panel-mode', mode === 'health');
    const healthControls = [els.healthPositiveBtn, els.healthNegativeBtn, els.healthClusterBtn, document.getElementById('heightRangeControl')];
    const energyControls = [els.satisfiedBtn, els.notSatisfiedBtn, els.focusEnergyBtn, els.elevateBtn];
    healthControls.forEach(el => { el.style.display = mode === 'health' ? 'block' : 'none'; });
    energyControls.forEach(el => { el.style.display = mode === 'energy' ? 'block' : 'none'; });
    if (mode === 'health') {
      els.inspectTitle.textContent = 'Manifest Filters';
      els.inspectSubtitle.textContent = 'Filter positive, negative, cluster, and column height.';
    } else {
      els.inspectTitle.textContent = payload ? payload.name : 'Inspect System';
      els.inspectSubtitle.textContent = payload ? `Energy node: ${payload.state || 'default'}` : 'Set the system state.';
    }
  }

  function closePanel() {
    els.inspectPanel.classList.remove('visible');
    if ((healthMode || energyMode) && els.openFiltersBtn) els.openFiltersBtn.classList.add('visible');
  }

  function resetEnergyElevation() {
    elevatedEnergy = false;
    if (energyLayer && typeof energyLayer.resetElevation === 'function') energyLayer.resetElevation();
    els.elevateBtn.textContent = 'Ascend';
  }

  function restorePanel() {
    if (els.openFiltersBtn) els.openFiltersBtn.classList.remove('visible');
    if (healthMode) showPanel('health');
    else if (energyMode) showPanel('energy', selectedEnergySystem || focusedEnergySystem);
  }

  function updateButtons() {
    els.energyBtn.classList.toggle('active', energyMode);
    els.healthBtn.classList.toggle('active', healthMode);
    els.energyBtn.textContent = energyMode ? 'Hide Energy' : 'Show Energy';
    els.healthBtn.textContent = healthMode ? 'Hide Manifest' : 'Show Manifest';
    els.energyBtn.style.display = healthMode ? 'none' : 'block';
    els.healthBtn.style.display = energyMode ? 'none' : 'block';
    els.healthPositiveBtn.classList.toggle('active', healthOnlyPositive);
    els.healthNegativeBtn.classList.toggle('active', healthOnlyNegative);
    els.healthClusterBtn.classList.toggle('active', healthClusterMode);
    els.healthClusterBtn.textContent = 'Cluster Cities';
    if (healthLayer && typeof healthLayer.applyVisualState === 'function') healthLayer.applyVisualState();
    els.heightRangeReadout.textContent = `Showing ${heightMinPercent}th - ${heightMaxPercent}th percentile column height`;
    els.heightRangeCount.textContent = displayedHealthCities.length
      ? `${displayedHealthCities.length.toLocaleString()} displayed of ${healthCities.length.toLocaleString()} cities`
      : 'No cities in range';
    if (els.heightSliderFill) {
      els.heightSliderFill.style.left = `${heightMinPercent}%`;
      els.heightSliderFill.style.width = `${heightMaxPercent - heightMinPercent}%`;
    }
    els.statusChip.textContent = '';
    setMapHealthVisibility();
  }

  function createEnergyLayer() {
    const THREE = api.THREE;
    const group = new THREE.Group();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let globalMaxArcLength = 0;
    let energyTime = 0;
    let elevateBlend = 0.0;
    let elevateTransitionActive = false;
    let autoPanDelay = 0.0;
    let descendCameraRadius = api.getState().orbit.radius;
    let formationRetargetActive = false;
    let formationRetargetBlend = 1.0;
    const formationRetargetStarts = new Map();
    const COLORS = {
      defaultDome: 0x6fbaff,
      defaultGlow: 0x4da6ff,
      defaultRing: 0x4da6ff,
      defaultPulse: 0xffd700,
      selectedRing: 0xffd700,
      satisfied: 0x16a34a,
      notSatisfied: 0xdc2626
    };
    const arcShaderSource = {
      uniforms: {
        time: { value: 0 },
        colorGoa: { value: new THREE.Color(0xffd700) },
        colorSys: { value: new THREE.Color(0xffd700) },
        isCore: { value: 1.0 },
        arcLength: { value: 1.0 },
        maxArcLength: { value: 1.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 colorGoa;
        uniform vec3 colorSys;
        uniform float isCore;
        uniform float arcLength;
        uniform float maxArcLength;
        varying vec2 vUv;
        void main() {
          float V = 0.15;
          float D_leg = maxArcLength + 0.5;
          float D_cycle = D_leg * 2.0;
          float d_total = time * V;
          float d_mod = mod(d_total, D_cycle);
          float isRev = step(D_leg, d_mod);
          float head_pos = d_mod - isRev * D_leg;
          float x_fwd = (1.0 - vUv.x) * arcLength;
          float x_rev = vUv.x * arcLength;
          float x_pixel = mix(x_fwd, x_rev, isRev);
          float dBehind = head_pos - x_pixel;
          float validMask = step(0.0, dBehind);
          float L_tail = 0.45;
          float L_head = 0.035;
          float trail = smoothstep(L_tail, 0.0, dBehind) * validMask;
          float head = smoothstep(L_head, 0.0, dBehind) * validMask;
          float baseAlpha = isCore > 0.5 ? 0.25 : 0.06;
          float pulseAlpha = trail * 0.6 + head * 1.0;
          if (isCore < 0.5) pulseAlpha *= 0.5;
          vec3 travelColor = mix(colorSys, colorGoa, isRev);
          vec3 previousColor = mix(colorGoa, colorSys, isRev);
          vec3 baseColor = mix(previousColor, travelColor, validMask);
          vec3 goldColor = vec3(1.0, 0.843, 0.0);
          float baseIsGold = 1.0 - smoothstep(0.05, 0.25, distance(baseColor, goldColor));
          float baseBoost = 1.0 + (1.0 - baseIsGold) * 0.5;
          baseColor = min(baseColor * baseBoost, vec3(1.0));
          vec3 finalColor = baseColor + (travelColor * pulseAlpha * 2.0);
          float outAlpha = (baseAlpha + pulseAlpha) * smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
          gl_FragColor = vec4(finalColor, outAlpha);
        }
      `
    };
    function createArcLine() {
      const placeholderCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.2, 0),
        new THREE.Vector3(0.2, 0, 0)
      );
      const matCore = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(arcShaderSource.uniforms),
        vertexShader: arcShaderSource.vertexShader,
        fragmentShader: arcShaderSource.fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      matCore.uniforms.isCore.value = 1.0;
      const matGlow = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(arcShaderSource.uniforms),
        vertexShader: arcShaderSource.vertexShader,
        fragmentShader: arcShaderSource.fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      matGlow.uniforms.isCore.value = 0.0;
      const tubeCore = new THREE.Mesh(new THREE.TubeGeometry(placeholderCurve, 64, 0.0015, 8, false), matCore);
      const tubeGlow = new THREE.Mesh(new THREE.TubeGeometry(placeholderCurve, 64, 0.0045, 8, false), matGlow);
      tubeCore.visible = false;
      tubeGlow.visible = false;
      group.add(tubeCore, tubeGlow);
      return { tubeCore, tubeGlow };
    }
    const systems = ENERGY_SYSTEMS.map((data, index) => {
      const node = new THREE.Group();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.0225, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.defaultDome }));
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.0275, 20, 20), new THREE.MeshBasicMaterial({ color: COLORS.defaultGlow, transparent: true, opacity: 0.06 }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.025, 0.036, 64), new THREE.MeshBasicMaterial({ color: COLORS.defaultRing, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      node.add(glow, dome, ring);
      group.add(node);
      return {
        ...data,
        index,
        node,
        dome,
        glow,
        ring,
        state: 'default',
        currentPosition: new THREE.Vector3(),
        currentAnchor: new THREE.Vector3(),
        currentOutward: new THREE.Vector3(0, 1, 0),
        surfaceNormal: new THREE.Vector3(0, 1, 0),
        earthPosition: new THREE.Vector3(),
        earthAnchor: new THREE.Vector3()
      };
    });
    focusedEnergySystem = systems[0];
    const arcLines = systems.slice(1).map(system => {
      return { system, arc: createArcLine() };
    });

    function colorForState(state) {
      if (state === 'satisfied') return { dome: COLORS.satisfied, glow: COLORS.satisfied, ring: COLORS.defaultRing, pulse: COLORS.satisfied };
      if (state === 'notSatisfied') return { dome: COLORS.notSatisfied, glow: COLORS.notSatisfied, ring: COLORS.defaultRing, pulse: COLORS.notSatisfied };
      return { dome: COLORS.defaultDome, glow: COLORS.defaultGlow, ring: COLORS.defaultRing, pulse: COLORS.defaultPulse };
    }

    function smoothstep01(x) {
      const t = THREE.MathUtils.clamp(x, 0, 1);
      return t * t * (3.0 - 2.0 * t);
    }

    function quadraticBezierVec3(p0, p1, p2, t) {
      const omt = 1.0 - t;
      return p0.clone().multiplyScalar(omt * omt)
        .add(p1.clone().multiplyScalar(2.0 * omt * t))
        .add(p2.clone().multiplyScalar(t * t));
    }

    function lerpAngle(current, target, amount) {
      let delta = target - current;
      while (delta > Math.PI) delta -= Math.PI * 2.0;
      while (delta < -Math.PI) delta += Math.PI * 2.0;
      return current + delta * amount;
    }

    function computeSurfaceState(system) {
      const earthVisualScale = api.earthGroup.scale.x;
      const surface = api.latLngToVec(system.lat, system.lng, 1.001)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), api.earthGroup.rotation.y);
      const outward = surface.clone().normalize();
      const scaledSurface = surface.clone().multiplyScalar(earthVisualScale);
      const position = scaledSurface.clone().add(outward.clone().multiplyScalar(0.02 * earthVisualScale));
      const anchor = outward.clone().multiplyScalar(1.03 * earthVisualScale);
      system.surfaceNormal.copy(outward);
      system.earthPosition.copy(position);
      system.earthAnchor.copy(anchor);
    }

    function computeStagedOrbitPosition(earthPos, surfaceNormal, targetPos, blend) {
      const stageSplit = 0.5;
      const orbitLift = 0.28;
      const launchPoint = earthPos.clone().add(surfaceNormal.clone().multiplyScalar(orbitLift));
      if (blend <= stageSplit) {
        const t = smoothstep01(blend / stageSplit);
        return earthPos.clone().lerp(launchPoint, t);
      }
      const t = smoothstep01((blend - stageSplit) / (1.0 - stageSplit));
      const spaceMid = launchPoint.clone().add(targetPos).multiplyScalar(0.5);
      const midNormal = spaceMid.clone().normalize();
      const control = midNormal.multiplyScalar(Math.max(launchPoint.length(), targetPos.length()) + 0.18)
        .add(new THREE.Vector3(0, 0.06, 0));
      return quadraticBezierVec3(launchPoint, control, targetPos, t);
    }

    function elevatedLayoutTargets() {
      const earthVisualScale = api.earthGroup.scale.x;
      const center = new THREE.Vector3(0, 1.09 * earthVisualScale, 0);
      const ringAxisA = new THREE.Vector3(1, 0, 0);
      const ringAxisB = new THREE.Vector3(0, 0, 1);
      const others = systems.filter(item => item !== focusedEnergySystem);
      const ringRadius = 0.42 * earthVisualScale;
      const focusLift = new THREE.Vector3(0, 0.04 * earthVisualScale, 0);
      const targets = new Map();
      targets.set(focusedEnergySystem, {
        position: center.clone().add(focusLift),
        anchor: center.clone().add(focusLift),
        outward: new THREE.Vector3(0, 1, 0)
      });
      others.forEach((system, idx) => {
        const angle = (idx / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
        const circularOffset = ringAxisA.clone().multiplyScalar(Math.cos(angle) * ringRadius)
          .add(ringAxisB.clone().multiplyScalar(Math.sin(angle) * ringRadius));
        const elevatedPos = center.clone().add(circularOffset);
        const outward = elevatedPos.clone().sub(center).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.35).normalize();
        targets.set(system, {
          position: elevatedPos,
          anchor: elevatedPos.clone(),
          outward
        });
      });
      return targets;
    }

    function startFormationRetarget(newFocusSystem) {
      formationRetargetStarts.clear();
      systems.forEach(system => {
        formationRetargetStarts.set(system, {
          position: (system.currentPosition || system.node.position).clone(),
          anchor: (system.currentAnchor || system.earthAnchor).clone(),
          outward: (system.currentOutward || system.surfaceNormal).clone()
        });
      });
      focusedEnergySystem = newFocusSystem;
      formationRetargetActive = true;
      formationRetargetBlend = 0.0;
    }

    function resetElevationState() {
      elevatedEnergy = false;
      elevateTransitionActive = true;
      autoPanDelay = 0.0;
      descendCameraRadius = api.getState().orbit.radius;
      formationRetargetActive = false;
      formationRetargetBlend = 1.0;
      formationRetargetStarts.clear();
      els.elevateBtn.textContent = 'Ascend';
    }

    function setFocused(system) {
      if (!system) return;
      if (elevatedEnergy && focusedEnergySystem !== system) startFormationRetarget(system);
      else focusedEnergySystem = system;
    }

    function toggleElevation() {
      if (!selectedEnergySystem) return;
      if (elevatedEnergy && focusedEnergySystem === selectedEnergySystem) {
        resetElevationState();
      } else if (elevatedEnergy) {
        startFormationRetarget(selectedEnergySystem);
      } else {
        focusedEnergySystem = selectedEnergySystem;
        elevatedEnergy = true;
        elevateTransitionActive = true;
        autoPanDelay = 0.0;
      }
      els.elevateBtn.textContent = elevatedEnergy ? 'Descend' : 'Ascend';
    }

    function updateArcPositions(startVec, endVec, arcObj) {
      const earthVisualScale = api.earthGroup.scale.x;
      const surfaceAnchorRadius = 1.03 * earthVisualScale;
      const startLen = startVec.length();
      const endLen = endVec.length();
      const avgLen = (startLen + endLen) * 0.5;
      const styleBlendRaw = THREE.MathUtils.clamp((avgLen - surfaceAnchorRadius) / Math.max(0.01, 0.10 * earthVisualScale), 0, 1);
      const styleBlend = styleBlendRaw * styleBlendRaw * (3.0 - 2.0 * styleBlendRaw);
      const globeStart = startVec.clone().normalize().multiplyScalar(surfaceAnchorRadius);
      const globeEnd = endVec.clone().normalize().multiplyScalar(surfaceAnchorRadius);
      const globeMid = globeStart.clone().add(globeEnd).multiplyScalar(0.5).normalize();
      const globeDistance = globeStart.distanceTo(globeEnd);
      const globeLift = Math.min(1.4 * earthVisualScale, (0.35 * earthVisualScale) + globeDistance * 0.6);
      const globeControl = globeMid.multiplyScalar(surfaceAnchorRadius + globeLift);
      const spaceStart = startVec.clone();
      const spaceEnd = endVec.clone();
      const spaceMid = spaceStart.clone().add(spaceEnd).multiplyScalar(0.5);
      const spaceDistance = spaceStart.distanceTo(spaceEnd);
      const spaceMidRadius = spaceMid.length();
      const spaceLift = Math.min(0.55, 0.12 + spaceDistance * 0.22);
      const spaceControl = spaceMid.clone().normalize().multiplyScalar(spaceMidRadius + spaceLift);
      const start = globeStart.clone().lerp(spaceStart, styleBlend);
      const end = globeEnd.clone().lerp(spaceEnd, styleBlend);
      const control = globeControl.clone().lerp(spaceControl, styleBlend);
      const curve = new THREE.QuadraticBezierCurve3(start, control, end);
      const trueArcLength = curve.getLength();
      if (trueArcLength > globalMaxArcLength) globalMaxArcLength = trueArcLength;
      arcObj.tubeCore.material.uniforms.arcLength.value = trueArcLength;
      arcObj.tubeGlow.material.uniforms.arcLength.value = trueArcLength;
      arcObj.tubeCore.material.uniforms.maxArcLength.value = globalMaxArcLength;
      arcObj.tubeGlow.material.uniforms.maxArcLength.value = globalMaxArcLength;
      if (arcObj.tubeCore.geometry) arcObj.tubeCore.geometry.dispose();
      if (arcObj.tubeGlow.geometry) arcObj.tubeGlow.geometry.dispose();
      arcObj.tubeCore.geometry = new THREE.TubeGeometry(curve, 64, 0.0015 * earthVisualScale, 8, false);
      arcObj.tubeGlow.geometry = new THREE.TubeGeometry(curve, 64, 0.0045 * earthVisualScale, 8, false);
    }

    function setSelected(system) {
      selectedEnergySystem = system;
      showPanel('energy', system);
      if (els.openFiltersBtn) els.openFiltersBtn.classList.remove('visible');
    }

    function update() {
      const coreState = api.getState();
      const visible = energyMode && coreState.mode === 'globe';
      group.visible = visible;
      if (!visible) {
        arcLines.forEach(({ arc }) => {
          arc.tubeCore.visible = false;
          arc.tubeGlow.visible = false;
        });
        return;
      }
      const elevateBlendRate = elevatedEnergy ? 0.01 : 0.005;
      elevateBlend += ((elevatedEnergy ? 1.0 : 0.0) - elevateBlend) * elevateBlendRate;
      const easedElevateBlend = elevateBlend * elevateBlend * (3.0 - 2.0 * elevateBlend);

      if (elevateTransitionActive && elevatedEnergy && typeof api.setOrbit === 'function') {
        autoPanDelay = Math.min(1.0, autoPanDelay + 0.01);
        const delayedPanBlend = THREE.MathUtils.clamp((autoPanDelay - 0.16) / 0.58, 0, 1);
        const easedPanBlend = delayedPanBlend * delayedPanBlend * (3.0 - 2.0 * delayedPanBlend);
        api.setOrbit({ phi: coreState.orbit.phi + (1.25 - coreState.orbit.phi) * (0.006 * easedPanBlend) });
        if (elevateBlend > 0.985) elevateTransitionActive = false;
      }

      systems.forEach(system => {
        computeSurfaceState(system);
      });

      const elevatedTargets = elevatedLayoutTargets();
      if (formationRetargetActive) {
        formationRetargetBlend = Math.min(1.0, formationRetargetBlend + 0.0175);
        if (formationRetargetBlend >= 0.999) {
          formationRetargetActive = false;
          formationRetargetBlend = 1.0;
          formationRetargetStarts.clear();
        }
      }

      systems.forEach(system => {
        const target = elevatedTargets.get(system);
        let currentPosition;
        let currentAnchor;
        let currentOutward;
        if (elevatedEnergy && formationRetargetActive && formationRetargetStarts.has(system)) {
          const retargetEase = formationRetargetBlend * formationRetargetBlend * (3.0 - 2.0 * formationRetargetBlend);
          const start = formationRetargetStarts.get(system);
          currentPosition = start.position.clone().lerp(target.position, retargetEase);
          currentAnchor = start.anchor.clone().lerp(target.anchor, retargetEase);
          currentOutward = start.outward.clone().lerp(target.outward, retargetEase).normalize();
        } else {
          currentPosition = computeStagedOrbitPosition(system.earthPosition, system.surfaceNormal, target.position, easedElevateBlend);
          currentAnchor = computeStagedOrbitPosition(system.earthAnchor, system.surfaceNormal, target.anchor, easedElevateBlend);
          currentOutward = system.surfaceNormal.clone().lerp(target.outward, easedElevateBlend).normalize();
        }
        system.node.position.copy(currentPosition);
        system.node.scale.setScalar(api.earthGroup.scale.x);
        system.node.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), currentOutward);
        system.currentPosition.copy(currentPosition);
        system.currentAnchor.copy(currentAnchor);
        system.currentOutward.copy(currentOutward);
        const colors = colorForState(system.state);
        system.dome.material.color.setHex(colors.dome);
        system.glow.material.color.setHex(colors.glow);
        const isHighlighted = (selectedEnergySystem === system) || (selectedEnergySystem === null && focusedEnergySystem === system);
        system.ring.material.color.setHex(isHighlighted ? COLORS.selectedRing : colors.ring);
        const pulseWave = isHighlighted ? (0.5 + 0.5 * Math.sin(energyTime * 1.8)) : (0.5 + 0.5 * Math.sin(energyTime));
        system.dome.scale.setScalar(isHighlighted ? (1.0 + pulseWave * 0.055) : (1.0 + Math.sin(energyTime) * 0.02));
        system.glow.scale.setScalar(isHighlighted ? (1.02 + pulseWave * 0.095) : (1.0 + Math.sin(energyTime) * 0.02));
        system.glow.material.opacity = isHighlighted ? (0.09 + pulseWave * 0.08) : 0.06;
      });
      if (elevateTransitionActive && !elevatedEnergy && typeof api.setOrbit === 'function') {
        const freshState = api.getState();
        const focusViewDir = focusedEnergySystem.earthPosition.clone().normalize();
        const targetPhi = THREE.MathUtils.clamp(Math.asin(focusViewDir.y), -1.25, 1.25);
        const targetTheta = Math.atan2(focusViewDir.x, focusViewDir.z);
        api.setOrbit({
          radius: freshState.orbit.radius + (descendCameraRadius - freshState.orbit.radius) * 0.04,
          phi: freshState.orbit.phi + (targetPhi - freshState.orbit.phi) * 0.015,
          theta: lerpAngle(freshState.orbit.theta, targetTheta, 0.015)
        });
        if (elevateBlend < 0.05) elevateTransitionActive = false;
      }
      const focusColors = colorForState(focusedEnergySystem.state);
      arcLines.forEach(({ system, arc }) => {
        arc.tubeCore.visible = !!focusedEnergySystem;
        arc.tubeGlow.visible = !!focusedEnergySystem;
        updateArcPositions(focusedEnergySystem.currentAnchor, system.currentAnchor, arc);
        const targetColors = colorForState(system.state);
        arc.tubeCore.material.uniforms.colorGoa.value.setHex(focusColors.pulse);
        arc.tubeGlow.material.uniforms.colorGoa.value.setHex(focusColors.pulse);
        arc.tubeCore.material.uniforms.colorSys.value.setHex(targetColors.pulse);
        arc.tubeGlow.material.uniforms.colorSys.value.setHex(targetColors.pulse);
        arc.tubeCore.material.uniforms.time.value = energyTime;
        arc.tubeGlow.material.uniforms.time.value = energyTime;
      });
      energyTime += 0.04;
    }

    const canvas = document.getElementById('c');
    let downX = 0;
    let downY = 0;
    let pointerMoved = false;
    canvas.addEventListener('pointerdown', event => {
      downX = event.clientX;
      downY = event.clientY;
      pointerMoved = false;
    });
    canvas.addEventListener('pointermove', event => {
      if (Math.abs(event.clientX - downX) > 5 || Math.abs(event.clientY - downY) > 5) pointerMoved = true;
    });
    canvas.addEventListener('click', event => {
      if (!energyMode || api.getState().mode !== 'globe') return;
      if (pointerMoved) {
        pointerMoved = false;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, api.camera);
      const hit = systems.find(system => raycaster.intersectObject(system.dome, false).length);
      if (hit) setSelected(hit);
    });

    return {
      threeObject: group,
      threeParent: 'scene',
      update,
      systems,
      setSelected,
      setFocused,
      toggleElevation,
      resetElevation: resetElevationState
    };
  }

  function createHealthLayer() {
    const THREE = api.THREE;
    const group = new THREE.Group();
    group.renderOrder = 10;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const baseGeometry = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false);
    function makeColumnMaterial() {
      return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `
          attribute vec3 instanceColumnColor;
          attribute float instanceColumnAlpha;
          varying vec3 vColumnColor;
          varying float vColumnAlpha;
          void main() {
            vColumnColor = instanceColumnColor;
            vColumnAlpha = instanceColumnAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          varying vec3 vColumnColor;
          varying float vColumnAlpha;
          void main() {
            gl_FragColor = vec4(vColumnColor, vColumnAlpha);
          }
        `
      });
    }
    const greenMaterial = makeColumnMaterial();
    const redMaterial = makeColumnMaterial();
    const selectedRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.035, 0.0022, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false })
    );
    selectedRing.visible = false;
    const tmpMatrix = new THREE.Matrix4();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();
    let greenInstances = null;
    let redInstances = null;
    let greenColorAttribute = null;
    let redColorAttribute = null;
    let greenAlphaAttribute = null;
    let redAlphaAttribute = null;
    let pickTargets = [];
    const greenColor = new THREE.Color(0x16a34a);
    const redColor = new THREE.Color(0xdc2626);
    const disabledColor = new THREE.Color(0x9aa3af);

    function sameMeta(a, b) {
      if (!a || !b) return false;
      if (a.id != null && b.id != null) return String(a.id) === String(b.id);
      return Math.abs(Number(a.lat) - Number(b.lat)) < 0.0001 && Math.abs(Number(a.lng) - Number(b.lng)) < 0.0001;
    }

    function applyVisualState() {
      if (!greenInstances || !redInstances) return;
      const greenDisabled = healthOnlyNegative;
      const redDisabled = healthOnlyPositive;
      const hasSelection = !!selectedHealthMeta;
      const count = greenInstances.count;
      let matchedSelection = false;
      const writeColor = (array, index, color) => {
        const offset = index * 3;
        array[offset] = color.r;
        array[offset + 1] = color.g;
        array[offset + 2] = color.b;
      };
      for (let i = 0; i < count; i++) {
        const meta = greenInstances.userData.metas[i];
        const activeColumn = hasSelection && sameMeta(meta, selectedHealthMeta);
        if (activeColumn) matchedSelection = true;
        writeColor(greenColorAttribute.array, i, greenDisabled ? disabledColor : greenColor);
        writeColor(redColorAttribute.array, i, redDisabled ? disabledColor : redColor);
        greenAlphaAttribute.array[i] = hasSelection && !activeColumn ? 0 : greenDisabled ? 0 : 0.92;
        redAlphaAttribute.array[i] = hasSelection && !activeColumn ? 0 : redDisabled ? 0.3 : 0.88;
      }
      if (hasSelection && !matchedSelection) {
        selectedHealthMeta = null;
        for (let i = 0; i < count; i++) {
          writeColor(greenColorAttribute.array, i, greenDisabled ? disabledColor : greenColor);
          writeColor(redColorAttribute.array, i, redDisabled ? disabledColor : redColor);
          greenAlphaAttribute.array[i] = greenDisabled ? 0 : 0.92;
          redAlphaAttribute.array[i] = redDisabled ? 0.3 : 0.88;
        }
      }
      greenColorAttribute.needsUpdate = true;
      redColorAttribute.needsUpdate = true;
      greenAlphaAttribute.needsUpdate = true;
      redAlphaAttribute.needsUpdate = true;
    }

    function rebuild() {
      while (group.children.length) {
        group.children.pop();
      }
      selectedRing.visible = false;
      pickTargets = [];
      displayedHealthCities = buildDisplayCities();
      healthGeoJSON = makeHealthGeoJSON(displayedHealthCities);
      if (!displayedHealthCities.length) {
        updateMapHealthSource();
        return;
      }
      const greenGeometry = baseGeometry.clone();
      const redGeometry = baseGeometry.clone();
      greenColorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(displayedHealthCities.length * 3), 3);
      redColorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(displayedHealthCities.length * 3), 3);
      greenAlphaAttribute = new THREE.InstancedBufferAttribute(new Float32Array(displayedHealthCities.length), 1);
      redAlphaAttribute = new THREE.InstancedBufferAttribute(new Float32Array(displayedHealthCities.length), 1);
      greenGeometry.setAttribute('instanceColumnColor', greenColorAttribute);
      redGeometry.setAttribute('instanceColumnColor', redColorAttribute);
      greenGeometry.setAttribute('instanceColumnAlpha', greenAlphaAttribute);
      redGeometry.setAttribute('instanceColumnAlpha', redAlphaAttribute);
      greenInstances = new THREE.InstancedMesh(greenGeometry, greenMaterial, displayedHealthCities.length);
      redInstances = new THREE.InstancedMesh(redGeometry, redMaterial, displayedHealthCities.length);
      greenInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      redInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      greenInstances.userData.metas = [];
      redInstances.userData.metas = [];

      displayedHealthCities.forEach((city, index) => {
        const pos = api.latLngToVec(city.lat, city.lng, 1.003);
        const normal = pos.clone().normalize();
        const popNorm = populationNorm(city.pop);
        const totalHeight = 0.01 + popNorm * 0.24;
        const radius = 0.0025 + popNorm * 0.0095;
        const greenShare = healthShare(city.lat, city.lng);
        const greenHeight = Math.max(0.001, totalHeight * greenShare);
        const redHeight = Math.max(0.001, totalHeight - greenHeight);
        const meta = {
          ...city,
          greenShare,
          redShare: 1 - greenShare,
          radius,
          normal,
          basePosition: pos.clone(),
          topPosition: pos.clone().add(normal.clone().multiplyScalar(totalHeight)),
          totalHeight
        };

        tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

        const redCenter = pos.clone().add(normal.clone().multiplyScalar(redHeight * 0.5));
        tmpScale.set(radius, redHeight, radius);
        tmpMatrix.compose(redCenter, tmpQuat, tmpScale);
        redInstances.setMatrixAt(index, tmpMatrix);
        redInstances.userData.metas[index] = meta;

        const greenCenter = pos.clone().add(normal.clone().multiplyScalar(redHeight + greenHeight * 0.5));
        tmpScale.set(radius, greenHeight, radius);
        tmpMatrix.compose(greenCenter, tmpQuat, tmpScale);
        greenInstances.setMatrixAt(index, tmpMatrix);
        greenInstances.userData.metas[index] = meta;
      });
      greenInstances.instanceMatrix.needsUpdate = true;
      redInstances.instanceMatrix.needsUpdate = true;
      group.add(greenInstances, redInstances, selectedRing);
      pickTargets = [greenInstances, redInstances];
      applyVisualState();
      updateMapHealthSource();
    }

    function update() {
      group.visible = healthMode && api.getState().mode === 'globe';
      if (greenInstances) greenInstances.visible = group.visible;
      if (redInstances) redInstances.visible = group.visible;
      if (selectedRing.visible && selectedHealthMeta) {
        selectedRing.position.copy(selectedHealthMeta.topPosition);
        selectedRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), selectedHealthMeta.normal);
        const pulse = 1 + Math.sin(performance.now() * 0.004) * 0.06;
        selectedRing.scale.setScalar(pulse);
      }
    }

    function pickMeta(event) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, api.camera);
      const targets = pickTargets.filter(mesh => mesh && mesh.visible);
      const hit = raycaster.intersectObjects(targets, false)[0];
      if (!hit || hit.instanceId === undefined) return null;
      return hit.object.userData.metas[hit.instanceId] || null;
    }

    function showSelectionRing(meta) {
      if (!meta) {
        selectedRing.visible = false;
        return;
      }
      if (!meta.topPosition || !meta.normal) {
        const base = api.latLngToVec(meta.lat, meta.lng, 1.003);
        const normal = base.clone().normalize();
        const popNorm = populationNorm(meta.pop || 1);
        const totalHeight = 0.01 + popNorm * 0.24;
        meta.normal = normal;
        meta.radius = meta.radius || 0.0025 + popNorm * 0.0095;
        meta.basePosition = base;
        meta.totalHeight = totalHeight;
        meta.topPosition = base.clone().add(normal.clone().multiplyScalar(totalHeight));
      }
      selectedRing.visible = true;
      selectedRing.position.copy(meta.topPosition);
      selectedRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), meta.normal);
      selectedRing.scale.setScalar(Math.max(0.7, meta.radius * 34));
      applyVisualState();
    }

    const canvas = document.getElementById('c');
    let downX = 0;
    let downY = 0;
    let pointerMoved = false;
    canvas.addEventListener('pointerdown', event => {
      downX = event.clientX;
      downY = event.clientY;
      pointerMoved = false;
    });
    canvas.addEventListener('pointermove', event => {
      if (!healthMode || api.getState().mode !== 'globe') return;
      if (Math.abs(event.clientX - downX) > 5 || Math.abs(event.clientY - downY) > 5) pointerMoved = true;
      const meta = pickMeta(event);
      if (meta) showHoverFlag(meta, event.clientX, event.clientY);
      else hideHoverFlag();
    });
    canvas.addEventListener('click', event => {
      if (!healthMode || api.getState().mode !== 'globe') return;
      if (pointerMoved) {
        pointerMoved = false;
        return;
      }
      const meta = pickMeta(event);
      if (meta) {
        showSelectionRing(meta);
        selectHealthMeta(meta, event.clientX, event.clientY);
      }
    });

    return { threeObject: group, update, rebuild, showSelectionRing, applyVisualState };
  }

  function registerHealthMapLayer() {
    api.addMapLayer('health2d', {
      sourceId: 'health2d',
      source: { type: 'geojson', data: healthGeoJSON, generateId: true },
      layers: [
        {
          id: 'health2d-red-base',
          type: 'circle',
          source: 'health2d',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['+', 2, ['*', 9, ['get', 'popNorm']]], 10, ['+', 5, ['*', 24, ['get', 'popNorm']]], 14, ['+', 7, ['*', 38, ['get', 'popNorm']]]],
            'circle-color': '#dc2626',
            'circle-opacity': 0.78,
            'circle-stroke-width': 0.8,
            'circle-stroke-color': 'rgba(255,255,255,0.28)'
          }
        },
        {
          id: 'health2d-green-inner',
          type: 'circle',
          source: 'health2d',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['*', ['+', 2, ['*', 9, ['get', 'popNorm']]], ['sqrt', ['max', 0.001, ['get', 'greenShare']]]], 10, ['*', ['+', 5, ['*', 24, ['get', 'popNorm']]], ['sqrt', ['max', 0.001, ['get', 'greenShare']]]], 14, ['*', ['+', 7, ['*', 38, ['get', 'popNorm']]], ['sqrt', ['max', 0.001, ['get', 'greenShare']]]]],
            'circle-color': '#16a34a',
            'circle-opacity': 0.86,
            'circle-stroke-width': 0
          }
        },
        {
          id: 'health2d-center-pin',
          type: 'circle',
          source: 'health2d',
          minzoom: 4.2,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 9, 1.4, 14, 2.4],
            'circle-color': '#f8fafc',
            'circle-opacity': 0.55
          }
        }
      ]
    });
  }

  function ensure2DSelectedLayer() {
    const map = api && api.map && api.map();
    if (!map || !map.getStyle || !map.getStyle()) return;
    try {
      if (!map.getSource('health2d-selected')) {
        map.addSource('health2d-selected', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });
      }
      if (!map.getLayer('health2d-selected-halo')) {
        map.addLayer({
          id: 'health2d-selected-halo',
          type: 'circle',
          source: 'health2d-selected',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['+', 5, ['*', 10, ['get', 'popNorm']]], 6, ['+', 7, ['*', 15, ['get', 'popNorm']]], 10, ['+', 10, ['*', 25, ['get', 'popNorm']]], 14, ['+', 14, ['*', 39, ['get', 'popNorm']]]],
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 5, 10, 7, 14, 9],
            'circle-opacity': 0.85
          }
        });
      }
      if (!map.getLayer('health2d-selected-ring')) {
        map.addLayer({
          id: 'health2d-selected-ring',
          type: 'circle',
          source: 'health2d-selected',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, ['+', 5, ['*', 10, ['get', 'popNorm']]], 6, ['+', 7, ['*', 15, ['get', 'popNorm']]], 10, ['+', 10, ['*', 25, ['get', 'popNorm']]], 14, ['+', 14, ['*', 39, ['get', 'popNorm']]]],
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#000000',
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 2, 10, 3, 14, 4],
            'circle-opacity': 1
          }
        });
      }
    } catch (_) {}
  }

  function metaFromMapFeature(feature) {
    const p = feature && feature.properties ? feature.properties : {};
    const meta = {
      id: p.id,
      city: p.name,
      lat: Number(p.lat),
      lng: Number(p.lng),
      pop: Number(p.pop) || 0,
      greenShare: Number(p.greenShare) || 0,
      redShare: 1 - (Number(p.greenShare) || 0),
      isCluster: p.isCluster === true || p.isCluster === 'true' || p.isCluster === 1 || p.isCluster === '1' || Number(p.clusterCount) > 1,
      clusterCount: Number(p.clusterCount) || 1
    };
    const source = displayedHealthCities.find(d => String(d.id) === String(meta.id));
    if (source) {
      meta.city = source.city || meta.city;
      meta.cityAscii = source.cityAscii || meta.cityAscii;
      meta.adminName = source.adminName || null;
      meta.placeLabel = source.placeLabel || meta.placeLabel;
      meta.clusterMembers = source.clusterMembers || [];
    }
    return meta;
  }

  function set2DSelectedHealthDisk(meta) {
    const map = api && api.map && api.map();
    if (!map) return;
    ensure2DSelectedLayer();
    if (!map.getSource('health2d-selected')) return;
    const data = meta && Number.isFinite(meta.lat) && Number.isFinite(meta.lng)
      ? {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [meta.lng, meta.lat] },
            properties: { popNorm: populationNorm(meta.pop) }
          }]
        }
      : { type: 'FeatureCollection', features: [] };
    map.getSource('health2d-selected').setData(data);
  }

  function setup2DHealthInteractions() {
    const map = api && api.map && api.map();
    if (!map || mapHealthInteractionsReady || !map.getLayer('health2d-red-base') || !map.getLayer('health2d-green-inner')) return;
    ensure2DSelectedLayer();
    mapHealthInteractionsReady = true;
    const healthMapLayers = ['health2d-red-base', 'health2d-green-inner'];
    function nearestHealthFeatureAtPoint(point, maxDistance = 42) {
      if (!healthGeoJSON || !Array.isArray(healthGeoJSON.features)) return null;
      let closest = null;
      let closestDistanceSq = maxDistance * maxDistance;
      healthGeoJSON.features.forEach(feature => {
        const coordinates = feature && feature.geometry ? feature.geometry.coordinates : null;
        if (!Array.isArray(coordinates) || coordinates.length < 2) return;
        const projected = map.project(coordinates);
        const dx = projected.x - point.x;
        const dy = projected.y - point.y;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq <= closestDistanceSq) {
          closestDistanceSq = distanceSq;
          closest = feature;
        }
      });
      return closest;
    }
    function selectMapFeature(feature, event) {
      const meta = metaFromMapFeature(feature);
      selectedHealthMeta = meta;
      set2DSelectedHealthDisk(meta);
      selectHealthMeta(meta, event.originalEvent.clientX, event.originalEvent.clientY);
    }
    ['health2d-red-base', 'health2d-green-inner'].forEach(layerId => {
      map.on('mousemove', layerId, e => {
        if (!healthMode || api.getState().mode !== 'map' || !e.features || !e.features.length) return;
        const meta = metaFromMapFeature(e.features[0]);
        map.getCanvas().style.cursor = 'pointer';
        showHoverFlag(meta, e.originalEvent.clientX, e.originalEvent.clientY);
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        hideHoverFlag();
      });
    });
    map.on('click', e => {
      if (!healthMode || api.getState().mode !== 'map') return;
      const features = map.queryRenderedFeatures(e.point, { layers: healthMapLayers });
      const feature = features[0] || nearestHealthFeatureAtPoint(e.point);
      if (!feature) return;
      selectMapFeature(feature, e);
    });
  }

  function updateMapHealthSource() {
    const map = api && api.map && api.map();
    if (map && map.getSource('health2d')) map.getSource('health2d').setData(healthGeoJSON);
    ensure2DSelectedLayer();
    setup2DHealthInteractions();
    if (selectedHealthMeta) set2DSelectedHealthDisk(selectedHealthMeta);
    setMapHealthVisibility();
  }

  function setMapHealthVisibility() {
    if (!api) return;
    const map = api.map();
    if (!map) return;
    const visible = healthMode && api.getState().mode === 'map' ? 'visible' : 'none';
    ensure2DSelectedLayer();
    setup2DHealthInteractions();
    if (selectedHealthMeta) set2DSelectedHealthDisk(selectedHealthMeta);
    ['health2d-red-base', 'health2d-green-inner', 'health2d-center-pin', 'health2d-selected-halo', 'health2d-selected-ring'].forEach(id => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible);
    });
  }

  function refreshMapHealthLifecycleSoon() {
    requestAnimationFrame(() => {
      setMapHealthVisibility();
      setTimeout(setMapHealthVisibility, 250);
    });
  }

  function showHoverFlag(meta, x, y) {
    els.hoverFlag.textContent = labelForCity(meta);
    els.hoverFlag.style.left = `${x + 12}px`;
    els.hoverFlag.style.top = `${y + 12}px`;
    els.hoverFlag.style.display = 'block';
  }

  function hideHoverFlag() {
    els.hoverFlag.style.display = 'none';
  }

  function clusterDetailsHTML(meta) {
    if (!meta.isCluster) return '';
    const members = Array.isArray(meta.clusterMembers) ? meta.clusterMembers : [];
    const rows = members.length ? members.map(member => {
      const green = Number.isFinite(member.greenShare) ? member.greenShare : healthShare(member.lat, member.lng);
      const greenPct = Math.round(green * 100);
      const redPct = Math.max(0, 100 - greenPct);
      return `
        <div class="cluster-member-row" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.08);">
          <div style="min-width:0;">
            <div style="font-size:11px;font-weight:650;color:#eef4ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(labelForCity(member))}</div>
            <div style="font-size:9px;color:#91a4c7;">${Math.round(member.pop || 0).toLocaleString()} people</div>
          </div>
          <div style="width:96px;">
            <div style="height:7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.1);box-shadow:inset 0 0 8px rgba(0,0,0,.18);">
              <div style="height:100%;width:${greenPct}%;background:linear-gradient(90deg,#16a34a,#34d399);float:left;"></div>
              <div style="height:100%;width:${redPct}%;background:linear-gradient(90deg,#dc2626,#fb7185);float:left;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:8px;font-weight:650;">
              <span style="color:#86efac;">+${greenPct}%</span>
              <span style="color:#fca5a5;">-${redPct}%</span>
            </div>
          </div>
        </div>`;
    }).join('') : '<div style="padding:8px 0;font-size:10px;color:#91a4c7;">No city details available.</div>';
    return `
      <button id="clusterDetailsToggle" aria-expanded="false" style="appearance:none;width:100%;border:0;background:rgba(250,204,21,.1);color:#fde047;border-radius:8px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;font-size:11px;font-weight:750;text-align:left;">
        <span>Cluster of ${(meta.clusterCount || members.length || 1).toLocaleString()} cities</span>
        <span id="clusterDetailsChevron" style="font-size:10px;color:#fff7bd;">Show</span>
      </button>
      <div id="clusterDetailsPanel" style="display:none;margin-top:7px;max-height:188px;overflow:auto;padding:0 3px 0 1px;border-radius:8px;">
        ${rows}
      </div>`;
  }

  function selectHealthMeta(meta, x = window.innerWidth * 0.5, y = window.innerHeight * 0.5) {
    selectedHealthMeta = meta;
    set2DSelectedHealthDisk(meta);
    if (healthLayer && typeof healthLayer.applyVisualState === 'function') healthLayer.applyVisualState();
    const green = meta.greenShare || healthShare(meta.lat, meta.lng);
    const red = meta.redShare || 1 - green;
    const city = labelForCity(meta);
    const greenPct = Math.round(green * 100);
    const redPct = Math.max(0, 100 - greenPct);
    els.tooltip.innerHTML = `
      <button class="pillarTooltipClose" id="pillarTooltipCloseBtn" aria-label="Close info card">×</button>
      <div style="display:flex;flex-direction:column;gap:9px;padding-right:18px;">
        <div style="font-size:17px;font-weight:700;color:#ffffff;line-height:1.15;">
          ${escapeHTML(city)}
        </div>

        <div style="font-size:11px;color:#bcd0f5;">
          ${meta.lat.toFixed(4)}, ${meta.lng.toFixed(4)}
        </div>

        ${clusterDetailsHTML(meta)}

        <div style="height:1px;background:linear-gradient(90deg, rgba(255,255,255,.16), rgba(255,255,255,.04));margin:2px 0;"></div>

        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:11px;color:#9fb3d9;">Population</span>
          <span style="font-size:13px;font-weight:650;color:#eef4ff;">${Math.round(meta.pop).toLocaleString()}</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px;">
          <span style="font-size:11px;color:#9fb3d9;">Sentiment</span>
          <span style="font-size:10px;color:#d9e5ff;">Positive / Negative</span>
        </div>

        <div style="height:11px;width:100%;background:rgba(255,255,255,.075);border:1px solid rgba(255,255,255,.055);border-radius:999px;overflow:hidden;box-shadow:inset 0 0 12px rgba(0,0,0,.22);">
          <div id="tooltipGreenBar" style="height:100%;width:0%;background:linear-gradient(90deg,#16a34a,#34d399);float:left;transition:width 320ms ease;"></div>
          <div id="tooltipRedBar" style="height:100%;width:0%;background:linear-gradient(90deg,#dc2626,#fb7185);float:left;transition:width 320ms ease;"></div>
        </div>

        <div style="display:flex;justify-content:space-between;font-size:10px;">
          <span style="color:#86efac;">Positive ${greenPct}%</span>
          <span style="color:#fca5a5;">Negative ${redPct}%</span>
        </div>
      </div>`;
    els.tooltip.style.display = 'block';
    els.tooltip.style.opacity = '1';
    els.tooltip.style.pointerEvents = 'auto';
    els.tooltip.style.width = meta.isCluster ? '380px' : '';
    const tooltipWidth = meta.isCluster ? 420 : 260;
    const tooltipHeight = meta.isCluster ? 330 : 190;
    els.tooltip.style.left = Math.max(12, Math.min(window.innerWidth - tooltipWidth, x + 14)) + 'px';
    els.tooltip.style.top = Math.max(12, Math.min(window.innerHeight - tooltipHeight, y + 14)) + 'px';

    requestAnimationFrame(() => {
      const greenBar = document.getElementById('tooltipGreenBar');
      const redBar = document.getElementById('tooltipRedBar');
      if (greenBar) greenBar.style.width = greenPct + '%';
      if (redBar) redBar.style.width = redPct + '%';
    });

    const closeBtn = document.getElementById('pillarTooltipCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', event => {
        event.stopPropagation();
        clearHealthSelection();
      });
    }
    const clusterToggle = document.getElementById('clusterDetailsToggle');
    const clusterPanel = document.getElementById('clusterDetailsPanel');
    const clusterChevron = document.getElementById('clusterDetailsChevron');
    if (clusterToggle && clusterPanel) {
      clusterToggle.addEventListener('click', event => {
        event.stopPropagation();
        const expanded = clusterToggle.getAttribute('aria-expanded') === 'true';
        clusterToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        clusterPanel.style.display = expanded ? 'none' : 'block';
        if (clusterChevron) clusterChevron.textContent = expanded ? 'Show' : 'Hide';
      });
    }
  }

  function clearHealthSelection() {
    selectedHealthMeta = null;
    els.tooltip.style.display = 'none';
    hideHoverFlag();
    set2DSelectedHealthDisk(null);
    if (healthLayer && healthLayer.showSelectionRing) healthLayer.showSelectionRing(null);
    if (healthLayer && typeof healthLayer.applyVisualState === 'function') healthLayer.applyVisualState();
  }

  function findFlyMatches(query) {
    const q = normalizeSearch(query);
    if (q.length < 2) return [];
    return healthCities.map(d => {
      const label = labelForCity(d);
      const haystack = normalizeSearch(`${label} ${d.cityAscii}`);
      let score = 999;
      if (haystack === q) score = 0;
      else if (haystack.startsWith(q)) score = 1;
      else if (haystack.includes(q)) score = 2;
      return { d, label, score };
    }).filter(item => item.score < 999).sort((a, b) => a.score - b.score || b.d.pop - a.d.pop).slice(0, 10);
  }

  function renderFlySuggestions() {
    const matches = findFlyMatches(els.flyInput.value);
    els.flySuggestions.innerHTML = '';
    els.flyClearBtn.style.display = els.flyInput.value ? 'block' : 'none';
    if (!matches.length) {
      els.flySuggestions.style.display = 'none';
      return;
    }
    matches.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText = 'padding:9px 11px;cursor:pointer;color:#eef4ff;border-bottom:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;gap:10px';
      row.innerHTML = `<span>${item.label}</span><span style="color:#9fb3d9;font-size:10px">${Math.round(item.d.pop).toLocaleString()}</span>`;
      row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,.10)');
      row.addEventListener('mouseleave', () => row.style.background = 'transparent');
      row.addEventListener('click', () => flyToDatum(item.d));
      els.flySuggestions.appendChild(row);
    });
    els.flySuggestions.style.display = 'block';
  }

  function easeOutToGlobeSpace(duration = 1100) {
    return new Promise(resolve => {
      if (!api || api.getState().mode !== 'map') {
        resolve();
        return;
      }
      api.switchToMacro();
      const start = api.getState().orbit;
      const target = {
        radius: Math.max(start.radius, 2.85),
        theta: start.theta,
        phi: Math.max(-0.55, Math.min(0.55, start.phi || 0.22))
      };
      const startTime = performance.now();
      function step() {
        const raw = Math.min(1, (performance.now() - startTime) / duration);
        const p = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
        api.setOrbit({
          radius: start.radius + (target.radius - start.radius) * p,
          theta: start.theta + (target.theta - start.theta) * p,
          phi: start.phi + (target.phi - start.phi) * p
        });
        if (raw < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  function flyToDatum(d) {
    if (!d) return;
    const requestId = ++flyRequestId;
    const wasMapMode = api && api.getState().mode === 'map';
    clearHealthSelection();
    els.flyInput.value = labelForCity(d);
    els.flySuggestions.style.display = 'none';
    if (!healthMode) {
      healthMode = true;
      energyMode = false;
      showPanel('health');
      updateButtons();
    }
    const startFlight = () => {
      if (requestId !== flyRequestId) return;
      api.flyToLocation({ lat: d.lat, lng: d.lng, altitude: 1.39, mapZoom: FLY_TO_CITY_2D_ZOOM, enterMap: true, duration: 7200 });
    };
    if (wasMapMode) easeOutToGlobeSpace().then(startFlight);
    else startFlight();
    setTimeout(() => {
      if (requestId !== flyRequestId) return;
      const meta = { ...d, greenShare: healthShare(d.lat, d.lng), redShare: 1 - healthShare(d.lat, d.lng) };
      if (healthLayer && healthLayer.showSelectionRing) healthLayer.showSelectionRing(meta);
      selectHealthMeta(meta);
    }, (wasMapMode ? 1100 : 0) + 7600);
  }

  function refreshHealth() {
    displayedHealthCities = buildDisplayCities();
    healthGeoJSON = makeHealthGeoJSON(displayedHealthCities);
    if (healthLayer) healthLayer.rebuild();
    updateButtons();
  }

  function getAppState() {
    const selectedCity = selectedHealthMeta ? labelForCity(selectedHealthMeta) : null;
    return {
      energyMode,
      healthMode,
      healthOnlyPositive,
      healthOnlyNegative,
      healthClusterMode,
      heightMinPercent,
      heightMaxPercent,
      healthCityCount: healthCities.length,
      displayedHealthCityCount: displayedHealthCities.length,
      healthGeoJSONFeatureCount: healthGeoJSON.features.length,
      selectedCity,
      selectedIsCluster: !!(selectedHealthMeta && selectedHealthMeta.isCluster),
      selectedClusterCount: selectedHealthMeta ? selectedHealthMeta.clusterCount || 1 : 0,
      selectedEnergyName: selectedEnergySystem ? selectedEnergySystem.name : null,
      focusedEnergyName: focusedEnergySystem ? focusedEnergySystem.name : null,
      elevatedEnergy,
      energyLayerVisible: !!(energyLayer && energyLayer.threeObject && energyLayer.threeObject.visible),
      healthLayerVisible: !!(healthLayer && healthLayer.threeObject && healthLayer.threeObject.visible),
      fullPopulationMaxPop,
      energySystemCount: energyLayer && energyLayer.systems ? energyLayer.systems.length : 0,
      energySystems: energyLayer && energyLayer.systems ? energyLayer.systems.map(system => {
        const world = new api.THREE.Vector3();
        system.node.getWorldPosition(world);
        const projected = world.clone().project(api.camera);
        const rect = api.renderer.domElement.getBoundingClientRect();
        return {
          name: system.name,
          state: system.state,
          focused: system === focusedEnergySystem,
          selected: system === selectedEnergySystem,
          ringOpacity: system.ring.material.opacity,
          domeColor: system.dome.material.color.getHexString(),
          x: world.x,
          y: world.y,
          z: world.z,
          screenX: (projected.x * 0.5 + 0.5) * rect.width + rect.left,
          screenY: (-projected.y * 0.5 + 0.5) * rect.height + rect.top,
          screenZ: projected.z,
          visible: !!(energyLayer.threeObject && energyLayer.threeObject.visible)
        };
      }) : [],
      displayedSample: displayedHealthCities.slice(0, 50).map(d => ({
        id: d.id,
        city: labelForCity(d),
        lat: d.lat,
        lng: d.lng,
        pop: d.pop,
        isCluster: !!d.isCluster,
        clusterCount: d.clusterCount || 1,
        anchorCity: d.anchorCity || d.city || d.cityAscii || '',
        centroidLat: d.centroidLat ?? null,
        centroidLng: d.centroidLng ?? null,
        height: 0.01 + populationNorm(d.pop) * 0.24
      }))
    };
  }

  window.EarthHealthEnergyApp = {
    getState: getAppState,
    getHealthGeoJSON: () => healthGeoJSON
  };

  async function boot(event) {
    api = event.detail.api;
    healthCities = await loadCities();
    fullPopulationMaxPop = healthCities.reduce((max, d) => Math.max(max, d.pop), 1);
    displayedHealthCities = buildDisplayCities();
    healthGeoJSON = makeHealthGeoJSON(displayedHealthCities);
    energyLayer = createEnergyLayer();
    healthLayer = createHealthLayer();
    api.registerLayer('energy-app-layer', energyLayer);
    api.registerLayer('health-app-layer', healthLayer);
    healthLayer.rebuild();
    registerHealthMapLayer();

    api.on('viewchange', refreshMapHealthLifecycleSoon);
    api.on('mapload', refreshMapHealthLifecycleSoon);
    els.energyBtn.addEventListener('click', () => {
      energyMode = !energyMode;
      if (energyMode) {
        healthMode = false;
        els.tooltip.style.display = 'none';
        selectedEnergySystem = selectedEnergySystem || focusedEnergySystem;
        if (energyLayer && energyLayer.setSelected && selectedEnergySystem) energyLayer.setSelected(selectedEnergySystem);
        showPanel('energy', selectedEnergySystem || focusedEnergySystem);
        if (els.openFiltersBtn) els.openFiltersBtn.classList.remove('visible');
      } else {
        resetEnergyElevation();
        closePanel();
      }
      updateButtons();
    });
    els.healthBtn.addEventListener('click', () => {
      healthMode = !healthMode;
      if (healthMode) {
        energyMode = false;
        resetEnergyElevation();
        selectedEnergySystem = null;
        clearHealthSelection();
        showPanel('health');
        if (els.openFiltersBtn) els.openFiltersBtn.classList.remove('visible');
      } else {
        els.tooltip.style.display = 'none';
        closePanel();
      }
      updateButtons();
    });
    els.closeInspectBtn.addEventListener('click', closePanel);
    els.openFiltersBtn.addEventListener('click', restorePanel);
    els.satisfiedBtn.addEventListener('click', () => { if (selectedEnergySystem) selectedEnergySystem.state = 'satisfied'; showPanel('energy', selectedEnergySystem); });
    els.notSatisfiedBtn.addEventListener('click', () => { if (selectedEnergySystem) selectedEnergySystem.state = 'notSatisfied'; showPanel('energy', selectedEnergySystem); });
    els.focusEnergyBtn.addEventListener('click', () => {
      if (!selectedEnergySystem) return;
      if (energyLayer && typeof energyLayer.setFocused === 'function') energyLayer.setFocused(selectedEnergySystem);
      else focusedEnergySystem = selectedEnergySystem;
    });
    els.elevateBtn.addEventListener('click', () => {
      if (!selectedEnergySystem) return;
      if (energyLayer && typeof energyLayer.toggleElevation === 'function') energyLayer.toggleElevation();
    });
    els.healthPositiveBtn.addEventListener('click', () => { healthOnlyPositive = !healthOnlyPositive; if (healthOnlyPositive) healthOnlyNegative = false; updateButtons(); });
    els.healthNegativeBtn.addEventListener('click', () => { healthOnlyNegative = !healthOnlyNegative; if (healthOnlyNegative) healthOnlyPositive = false; updateButtons(); });
    els.healthClusterBtn.addEventListener('click', () => { healthClusterMode = !healthClusterMode; refreshHealth(); });
    function handleHeightRangeInput() {
      let min = Math.max(0, Math.min(100, Number(els.heightRangeMin.value)));
      let max = Math.max(0, Math.min(100, Number(els.heightRangeMax.value)));
      if (min >= max) {
        if (document.activeElement === els.heightRangeMin) min = max - 1;
        else max = min + 1;
      }
      heightMinPercent = min;
      heightMaxPercent = max;
      els.heightRangeMin.value = String(min);
      els.heightRangeMax.value = String(max);
      refreshHealth();
    }
    els.heightRangeMin.addEventListener('input', handleHeightRangeInput);
    els.heightRangeMax.addEventListener('input', handleHeightRangeInput);
    els.flyInput.addEventListener('input', renderFlySuggestions);
    els.flyInput.addEventListener('focus', renderFlySuggestions);
    els.flyClearBtn.addEventListener('click', () => { els.flyInput.value = ''; renderFlySuggestions(); els.flyInput.focus(); });
    document.addEventListener('click', event => {
      if (event.target === els.flyInput || event.target === els.flyClearBtn || els.flySuggestions.contains(event.target)) return;
      els.flySuggestions.style.display = 'none';
    });
    updateButtons();
    console.log(`Modular Health/Energy app mounted on earth-core with ${healthCities.length.toLocaleString()} cities.`);
  }

  if (window.EarthSystem) {
    boot({ detail: { api: window.EarthSystem } });
  } else {
    window.addEventListener('earthsystem:ready', boot, { once: true });
  }
})();
