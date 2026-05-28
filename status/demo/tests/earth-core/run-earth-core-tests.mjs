import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const demoRoot = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  try {
    return require('playwright');
  } catch (_) {
    const bundledRoot = '/Users/ranjit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/';
    try {
      const bundledRequire = createRequire(bundledRoot);
      bundledRequire.resolve('playwright');
      return bundledRequire('playwright');
    } catch {
      return null;
    }
  }
}

const playwright = loadPlaywright();
if (!playwright) {
  throw new Error('Playwright is required. Run `npm install` in status/demo first.');
}

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.csv', 'text/csv; charset=utf-8']
]);

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax2x8UAAAAASUVORK5CYII=',
  'base64'
);

function startStaticServer(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const decoded = decodeURIComponent(url.pathname);
      const safePath = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(root, safePath === '/' ? '/index.html' : safePath);
      if (!filePath.startsWith(root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        'content-type': MIME_TYPES.get(path.extname(filePath)) || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(body);
    } catch (_) {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}

function chromeExecutablePath() {
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  return existsSync(macChrome) ? macChrome : undefined;
}

async function withCorePage(testBody, options = {}) {
  const server = await startStaticServer(demoRoot);
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: chromeExecutablePath()
  });

  const page = await browser.newPage({
    viewport: options.viewport || { width: 1366, height: 900 },
    deviceScaleFactor: options.deviceScaleFactor || 1,
    isMobile: options.isMobile || false,
    hasTouch: options.hasTouch || false
  });
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];

  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    const url = request.url();
    if (!url.includes('tile.openstreetmap.org')) failedRequests.push(`${request.failure()?.errorText || 'failed'} ${url}`);
  });

  await page.route('https://tile.openstreetmap.org/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: transparentPng
    });
  });

  if (typeof options.init === 'function') {
    await options.init(page, server.baseUrl);
  }

  try {
    await page.goto(`${server.baseUrl}/earth-core/earth_core.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.EarthSystem && window.EarthSystem.getState, null, { timeout: 30000 });
    await page.waitForTimeout(250);
    await testBody({ page, baseUrl: server.baseUrl, pageErrors, consoleErrors, failedRequests });
    assert.deepEqual(pageErrors, [], 'page should not throw uncaught errors');
    assert.deepEqual(failedRequests, [], 'page should not have failed non-tile requests');
  } finally {
    await browser.close();
    await server.close();
  }
}

const tests = [];
function test(name, fn, options = {}) {
  tests.push({ name, fn, options });
}

test('boots and exposes the public EarthSystem contract', async ({ page }) => {
  const contract = await page.evaluate(() => {
    const api = window.EarthSystem;
    const methods = [
      'getState', 'on', 'flyToTarget', 'flyToLocation', 'switchToMicro', 'switchToMacro',
      'latLngToVec', 'addThreeLayer', 'removeThreeLayer', 'addMapLayer', 'removeMapLayer',
      'registerLayer', 'unregisterLayer', 'setOrbit', 'map'
    ];
    const objects = ['scene', 'camera', 'renderer', 'earthGroup', 'earth', 'moon', 'mars', 'sun', 'sunGroup'];
    return {
      version: api.version,
      methods: Object.fromEntries(methods.map(name => [name, typeof api[name]])),
      objects: Object.fromEntries(objects.map(name => [name, !!api[name]])),
      state: api.getState(),
      canvasDisplay: getComputedStyle(document.querySelector('#c')).display,
      mapOpacity: getComputedStyle(document.querySelector('#map-container')).opacity,
      activeTarget: document.querySelector('.dropdown-item.active')?.dataset.target,
      buttonText: document.querySelector('#target-btn')?.textContent.trim()
    };
  });

  assert.match(contract.version, /^\d+\.\d+\.\d+$/);
  for (const [name, type] of Object.entries(contract.methods)) assert.equal(type, 'function', `${name} should be a function`);
  for (const [name, present] of Object.entries(contract.objects)) assert.equal(present, true, `${name} should be exposed`);
  assert.equal(contract.state.mode, 'globe');
  assert.equal(contract.state.target, 'earth');
  assert.equal(contract.canvasDisplay, 'block');
  assert.equal(contract.mapOpacity, '0');
  assert.equal(contract.activeTarget, 'earth');
  assert.match(contract.buttonText, /Earth/);
});

test('scale info pill explains the fixed log distance and size view', async ({ page }) => {
  const before = await page.evaluate(() => ({
    buttonText: document.querySelector('#space-scale-info-btn')?.innerText || '',
    panelDisplay: getComputedStyle(document.querySelector('#space-scale-info-panel')).display,
    state: window.EarthSystem.getState()
  }));
  assert.equal(before.buttonText, 'Scale info');
  assert.equal(before.panelDisplay, 'none');
  assert.equal(before.state.spaceScaleMode, 'log');
  assert.equal(before.state.spaceSizeMode, 'log');
  assert.ok(before.state.spaceDistances.sun > before.state.spaceDistances.moon);
  assert.ok(before.state.spaceSizes.sunScale > before.state.spaceSizes.moonScale);

  await page.click('#space-scale-info-btn');
  const after = await page.evaluate(() => {
    return {
      text: document.querySelector('#space-scale-info-panel')?.innerText || '',
      panelDisplay: getComputedStyle(document.querySelector('#space-scale-info-panel')).display
    };
  });
  assert.equal(after.panelDisplay, 'block');
  assert.match(after.text, /Distances:/);
  assert.match(after.text, /Sizes:/);
  assert.match(after.text, /logarithmic scale/);
});

test('renders the 3D scene', async ({ page }) => {
  await page.waitForTimeout(500);
  const renderState = await page.evaluate(() => {
    const api = window.EarthSystem;
    return {
      renderCalls: api.renderer.info.render.calls,
      sceneChildren: api.scene.children.length,
      earthVisible: api.earth.visible,
      moonVisible: api.moon.visible,
      sunVisible: api.sunGroup.visible,
      cameraFinite: Number.isFinite(api.camera.position.x) &&
        Number.isFinite(api.camera.position.y) &&
        Number.isFinite(api.camera.position.z)
    };
  });
  assert.ok(renderState.renderCalls > 0, 'renderer should have completed draw calls');
  assert.ok(renderState.sceneChildren > 4, 'scene should contain core celestial objects and sky');
  assert.equal(renderState.earthVisible, true);
  assert.equal(renderState.moonVisible, true);
  assert.equal(renderState.sunVisible, true);
  assert.equal(renderState.cameraFinite, true);
});

test('target dropdown opens, selects Moon, Mars, and Sun, and emits targetchange', async ({ page }) => {
  await page.evaluate(() => {
    window.__targetChanges = [];
    window.EarthSystem.on('targetchange', event => window.__targetChanges.push(event.detail.targetName));
  });

  await page.click('#target-btn');
  await expectClass(page, '#dropdown-menu', 'show', true);
  await page.click('.dropdown-item[data-target="moon"]');
  await page.waitForTimeout(100);
  await expectClass(page, '#dropdown-menu', 'show', false);
  await page.waitForFunction(() => window.EarthSystem.getState().target === 'moon', null, { timeout: 4000 });

  let ui = await page.evaluate(() => ({
    active: document.querySelector('.dropdown-item.active')?.dataset.target,
    buttonText: document.querySelector('#target-btn').textContent.trim(),
    changes: window.__targetChanges
  }));
  assert.equal(ui.active, 'moon');
  assert.match(ui.buttonText, /Moon/);
  assert.deepEqual(ui.changes, ['moon']);

  await page.click('#target-btn');
  await page.click('.dropdown-item[data-target="mars"]');
  await page.waitForFunction(() => window.EarthSystem.getState().target === 'mars', null, { timeout: 4000 });
  ui = await page.evaluate(() => ({
    active: document.querySelector('.dropdown-item.active')?.dataset.target,
    buttonText: document.querySelector('#target-btn').textContent.trim(),
    marsIconClass: document.querySelector('#target-btn .mars-disc')?.className || '',
    changes: window.__targetChanges
  }));
  assert.equal(ui.active, 'mars');
  assert.match(ui.buttonText, /Mars/);
  assert.equal(ui.marsIconClass, 'mars-disc');
  assert.deepEqual(ui.changes, ['moon', 'mars']);

  await page.click('#target-btn');
  await page.click('.dropdown-item[data-target="sun"]');
  await page.waitForFunction(() => window.EarthSystem.getState().target === 'sun', null, { timeout: 4000 });
  ui = await page.evaluate(() => ({
    active: document.querySelector('.dropdown-item.active')?.dataset.target,
    buttonText: document.querySelector('#target-btn').textContent.trim(),
    changes: window.__targetChanges
  }));
  assert.equal(ui.active, 'sun');
  assert.match(ui.buttonText, /Sun/);
  assert.deepEqual(ui.changes, ['moon', 'mars', 'sun']);
});

test('target dropdown closes on outside click and keeps a single active target', async ({ page }) => {
  await page.click('#target-btn');
  await expectClass(page, '#dropdown-menu', 'show', true);
  await page.mouse.click(1200, 120);
  await expectClass(page, '#dropdown-menu', 'show', false);

  await page.click('#target-btn');
  await page.click('.dropdown-item[data-target="earth"]');
  await page.waitForTimeout(100);
  const ui = await page.evaluate(() => ({
    activeTargets: Array.from(document.querySelectorAll('.dropdown-item.active')).map(item => item.dataset.target),
    buttonText: document.querySelector('#target-btn').textContent.trim(),
    stateTarget: window.EarthSystem.getState().target
  }));
  assert.deepEqual(ui.activeTargets, ['earth']);
  assert.match(ui.buttonText, /Earth/);
  assert.equal(ui.stateTarget, 'earth');
});

test('invalid target and invalid fly-to-location inputs are ignored safely', async ({ page }) => {
  const before = await page.evaluate(() => ({
    target: window.EarthSystem.getState().target,
    mode: window.EarthSystem.getState().mode,
    orbit: window.EarthSystem.getState().orbit
  }));

  const after = await page.evaluate(() => {
    window.EarthSystem.flyToTarget('pluto');
    window.EarthSystem.flyToLocation({ lat: Number.NaN, lng: 77 });
    window.EarthSystem.flyToLocation({ lat: 28, lng: Infinity });
    return {
      target: window.EarthSystem.getState().target,
      mode: window.EarthSystem.getState().mode,
      orbit: window.EarthSystem.getState().orbit
    };
  });

  assert.equal(after.target, before.target);
  assert.equal(after.mode, before.mode);
  assert.equal(Number.isFinite(after.orbit.radius), true);
});

test('pointer drag and wheel update globe orbit without breaking state', async ({ page }) => {
  await page.evaluate(() => window.EarthSystem.flyToTarget('earth'));
  await page.waitForFunction(() => window.EarthSystem.getState().target === 'earth', null, { timeout: 4000 });
  const before = await page.evaluate(() => window.EarthSystem.getState().orbit);

  await page.mouse.move(640, 420);
  await page.mouse.down();
  await page.mouse.move(760, 470, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(100);

  const afterDrag = await page.evaluate(() => window.EarthSystem.getState().orbit);
  assert.notEqual(afterDrag.theta, before.theta, 'drag should change orbit theta');
  assert.ok(Number.isFinite(afterDrag.phi), 'orbit phi should remain finite');

  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(100);
  const afterWheel = await page.evaluate(() => window.EarthSystem.getState().orbit);
  assert.notEqual(afterWheel.radius, afterDrag.radius, 'wheel should change orbit radius in globe mode');
  assert.ok(afterWheel.radius >= 1.35, 'Earth orbit radius should stay above macro minimum');
});

test('pointer release and pointer leave stop globe dragging', async ({ page }) => {
  const start = await page.evaluate(() => window.EarthSystem.getState().orbit);
  await page.mouse.move(520, 420);
  await page.mouse.down();
  await page.mouse.move(610, 455, { steps: 5 });
  await page.mouse.up();
  const afterRelease = await page.evaluate(() => window.EarthSystem.getState().orbit);
  await page.mouse.move(760, 620, { steps: 5 });
  await page.waitForTimeout(100);
  const afterReleasedMove = await page.evaluate(() => window.EarthSystem.getState().orbit);
  assert.notEqual(afterRelease.theta, start.theta);
  assert.equal(afterReleasedMove.theta, afterRelease.theta);
  assert.equal(afterReleasedMove.phi, afterRelease.phi);

  await page.mouse.move(520, 420);
  await page.mouse.down();
  await page.mouse.move(700, 500, { steps: 5 });
  await page.mouse.move(-20, -20, { steps: 2 });
  await page.mouse.up();
  const afterLeave = await page.evaluate(() => window.EarthSystem.getState().orbit);
  await page.mouse.move(900, 700, { steps: 5 });
  await page.waitForTimeout(100);
  const afterLeaveMove = await page.evaluate(() => window.EarthSystem.getState().orbit);
  assert.equal(afterLeaveMove.theta, afterLeave.theta);
  assert.equal(afterLeaveMove.phi, afterLeave.phi);
});

test('real wheel zoom crosses from 3D globe into 2D map at the screen center', async ({ page }) => {
  const viewChanges = await page.evaluate(() => {
    window.__wheelViewChanges = [];
    window.EarthSystem.on('viewchange', event => window.__wheelViewChanges.push(event.detail));
    return window.EarthSystem.getState().mode;
  });
  assert.equal(viewChanges, 'globe');

  await page.mouse.move(683, 450);
  for (let i = 0; i < 8; i += 1) {
    if (await page.evaluate(() => window.EarthSystem.getState().mode === 'map')) break;
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(120);
  }

  await page.waitForFunction(() => window.EarthSystem.getState().mode === 'map' && window.EarthSystem.map(), null, { timeout: 6000 });
  const result = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    const center = map.getCenter();
    return {
      mode: window.EarthSystem.getState().mode,
      center: { lat: center.lat, lng: center.lng },
      zoom: map.getZoom(),
      viewChanges: window.__wheelViewChanges
    };
  });
  assert.equal(result.mode, 'map');
  assert.ok(Number.isFinite(result.center.lat));
  assert.ok(Number.isFinite(result.center.lng));
  assert.ok(result.center.lat <= 90 && result.center.lat >= -90);
  assert.ok(result.center.lng <= 180 && result.center.lng >= -180);
  assert.ok(result.zoom >= 4.4);
  assert.equal(result.viewChanges.some(event => event.mode === 'map'), true);
});

test('switches between globe and map modes through the public API', async ({ page }) => {
  const events = await page.evaluate(() => {
    window.__viewChanges = [];
    window.EarthSystem.on('viewchange', event => window.__viewChanges.push(event.detail));
    window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 6 });
    return window.__viewChanges;
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].mode, 'map');

  await page.waitForFunction(() => window.EarthSystem.map() && window.EarthSystem.getState().mode === 'map', null, { timeout: 10000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#c')).opacity === '0', null, { timeout: 2000 });
  const mapState = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    const center = map.getCenter();
    return {
      bodyClass: document.body.classList.contains('micro-view'),
      mode: window.EarthSystem.getState().mode,
      center: { lat: center.lat, lng: center.lng },
      zoom: map.getZoom(),
      canvasOpacity: getComputedStyle(document.querySelector('#c')).opacity,
      mapOpacity: getComputedStyle(document.querySelector('#map-container')).opacity
    };
  });
  assert.equal(mapState.bodyClass, true);
  assert.equal(mapState.mode, 'map');
  assert.ok(Math.abs(mapState.center.lat - 28.6139) < 0.01);
  assert.ok(Math.abs(mapState.center.lng - 77.2090) < 0.01);
  assert.ok(Math.abs(mapState.zoom - 6) < 0.01);
  assert.equal(mapState.canvasOpacity, '0');
  assert.equal(mapState.mapOpacity, '1');

  await page.evaluate(() => window.EarthSystem.switchToMacro());
  await page.waitForFunction(() => window.EarthSystem.getState().mode === 'globe', null, { timeout: 4000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#map-container')).opacity === '0', null, { timeout: 2000 });
  const macroState = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains('micro-view'),
    mode: window.EarthSystem.getState().mode,
    canvasOpacity: getComputedStyle(document.querySelector('#c')).opacity,
    mapOpacity: getComputedStyle(document.querySelector('#map-container')).opacity,
    viewChanges: window.__viewChanges
  }));
  assert.equal(macroState.bodyClass, false);
  assert.equal(macroState.mode, 'globe');
  assert.equal(macroState.canvasOpacity, '1');
  assert.equal(macroState.mapOpacity, '0');
  assert.deepEqual(macroState.viewChanges.map(event => event.mode), ['map', 'globe']);
});

test('map zooming below the exit threshold returns to globe mode', async ({ page }) => {
  await page.evaluate(() => window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 6 }));
  await page.waitForFunction(() => window.EarthSystem.map() && window.EarthSystem.getState().mode === 'map', null, { timeout: 10000 });
  await page.evaluate(() => window.EarthSystem.map().setZoom(4.0));
  await page.waitForFunction(() => window.EarthSystem.getState().mode === 'globe', null, { timeout: 5000 });
  const state = await page.evaluate(() => ({
    mode: window.EarthSystem.getState().mode,
    microClass: document.body.classList.contains('micro-view'),
    orbitRadius: window.EarthSystem.getState().orbit.radius
  }));
  assert.equal(state.mode, 'globe');
  assert.equal(state.microClass, false);
  assert.ok(state.orbitRadius > 1.35);
});

test('actual map wheel zoom can exit 2D mode back to the 3D globe', async ({ page }) => {
  await page.evaluate(() => window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 5.2 }));
  await page.waitForFunction(() => window.EarthSystem.map() && window.EarthSystem.getState().mode === 'map', null, { timeout: 10000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#map-container')).opacity === '1', null, { timeout: 2000 });
  await page.mouse.move(683, 450);
  for (let i = 0; i < 8; i += 1) {
    if (await page.evaluate(() => window.EarthSystem.getState().mode === 'globe')) break;
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(180);
  }
  await page.waitForFunction(() => window.EarthSystem.getState().mode === 'globe', null, { timeout: 6000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#map-container')).opacity === '0', null, { timeout: 2000 });
  const result = await page.evaluate(() => ({
    mode: window.EarthSystem.getState().mode,
    microClass: document.body.classList.contains('micro-view'),
    mapOpacity: getComputedStyle(document.querySelector('#map-container')).opacity
  }));
  assert.equal(result.mode, 'globe');
  assert.equal(result.microClass, false);
  assert.equal(result.mapOpacity, '0');
});

test('flyToLocation emits, can stay in globe mode, and can enter map mode', async ({ page }) => {
  const emitted = await page.evaluate(() => {
    window.__flyEvents = [];
    window.EarthSystem.on('flytolocation', event => window.__flyEvents.push(event.detail));
    window.EarthSystem.flyToLocation({ lat: 12.9716, lng: 77.5946, duration: 80, enterMap: false });
    return window.__flyEvents;
  });
  assert.equal(emitted.length, 1);
  assert.ok(Math.abs(emitted[0].lat - 12.9716) < 0.0001);
  assert.ok(Math.abs(emitted[0].lng - 77.5946) < 0.0001);
  await page.waitForTimeout(180);
  assert.equal(await page.evaluate(() => window.EarthSystem.getState().mode), 'globe');

  await page.evaluate(() => window.EarthSystem.flyToLocation({
    lat: 19.0760,
    lng: 72.8777,
    duration: 80,
    enterMap: true,
    mapZoom: 8
  }));
  await page.waitForFunction(() => window.EarthSystem.map() && window.EarthSystem.getState().mode === 'map', null, { timeout: 10000 });
  const mapState = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    const center = map.getCenter();
    return { mode: window.EarthSystem.getState().mode, lat: center.lat, lng: center.lng, zoom: map.getZoom() };
  });
  assert.equal(mapState.mode, 'map');
  assert.ok(Math.abs(mapState.lat - 19.0760) < 0.01);
  assert.ok(Math.abs(mapState.lng - 72.8777) < 0.01);
  assert.ok(Math.abs(mapState.zoom - 8) < 0.01);
});

test('flyToLocation from 2D map mode returns to Earth and lands at the destination map', async ({ page }) => {
  await page.evaluate(() => window.EarthSystem.switchToMicro(18.5204, 73.8567, { zoom: 8 }));
  await page.waitForFunction(() => window.EarthSystem.map() && window.EarthSystem.getState().mode === 'map', null, { timeout: 10000 });
  await page.evaluate(() => window.EarthSystem.flyToLocation({
    lat: 19.4326,
    lng: -99.1332,
    duration: 120,
    enterMap: true,
    mapZoom: 9
  }));
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    if (!map || window.EarthSystem.getState().mode !== 'map') return false;
    const center = map.getCenter();
    return Math.abs(center.lat - 19.4326) < 0.02 && Math.abs(center.lng - -99.1332) < 0.02;
  }, null, { timeout: 10000 });
  const state = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    const center = map.getCenter();
    return {
      target: window.EarthSystem.getState().target,
      mode: window.EarthSystem.getState().mode,
      lat: center.lat,
      lng: center.lng,
      zoom: map.getZoom()
    };
  });
  assert.equal(state.target, 'earth');
  assert.equal(state.mode, 'map');
  assert.ok(Math.abs(state.lat - 19.4326) < 0.02);
  assert.ok(Math.abs(state.lng - -99.1332) < 0.02);
  assert.ok(Math.abs(state.zoom - 9) < 0.05);
});

test('flyToTarget settles on Earth, Moon, Mars, and Sun with finite camera state', async ({ page }) => {
  const targets = ['moon', 'mars', 'sun', 'earth'];
  for (const target of targets) {
    await page.evaluate(name => window.EarthSystem.flyToTarget(name), target);
    await page.waitForFunction(name => !window.EarthSystem.getState().mode.includes('map') &&
      window.EarthSystem.getState().target === name, target, { timeout: 5000 });
    await page.waitForTimeout(2700);
    const state = await page.evaluate(() => {
      const s = window.EarthSystem.getState();
      return {
        target: s.target,
        mode: s.mode,
        radius: s.orbit.radius,
        cameraFinite: Number.isFinite(s.cameraPosition.x) &&
          Number.isFinite(s.cameraPosition.y) &&
          Number.isFinite(s.cameraPosition.z),
        earthScale: window.EarthSystem.earthGroup.scale.x,
        sunScale: window.EarthSystem.sunGroup.scale.x
      };
    });
    assert.equal(state.mode, 'globe');
    assert.equal(state.target, target);
    assert.ok(state.radius > 0);
    assert.equal(state.cameraFinite, true);
    assert.ok(Math.abs(state.earthScale - 1) < 0.05, `${target} target should keep Earth physically stable`);
    if (target === 'sun') assert.ok(state.sunScale > 8, 'Sun target should use cinematic sun scale');
  }
});

test('Sun is a simple orb from Earth and Moon and detailed only at Sun target', async ({ page }) => {
  async function sunVisualState(target) {
    await page.evaluate(name => window.EarthSystem.flyToTarget(name), target);
    await page.waitForFunction(name => window.EarthSystem.getState().target === name, target, { timeout: 5000 });
    await page.waitForTimeout(2700);
    return page.evaluate(() => {
      const sunCore = window.EarthSystem.sunGroup.children[0];
      const raysGroup = window.EarthSystem.sunGroup.children[2];
      return {
        hasTexture: !!sunCore.material.map,
        raysVisible: raysGroup.visible,
        scale: window.EarthSystem.sunGroup.scale.x
      };
    });
  }

  const earthSun = await sunVisualState('earth');
  const moonSun = await sunVisualState('moon');
  const detailedSun = await sunVisualState('sun');
  assert.equal(earthSun.hasTexture, false);
  assert.equal(moonSun.hasTexture, false);
  assert.equal(earthSun.raysVisible, true);
  assert.equal(moonSun.raysVisible, true);
  assert.equal(detailedSun.hasTexture, true);
  assert.equal(detailedSun.raysVisible, false);
  assert.ok(detailedSun.scale > earthSun.scale);
});

test('repeated 3D/2D transitions reuse one MapLibre instance', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.EarthSystem.switchToMicro(10, 20, { zoom: 6 });
    await new Promise(resolve => setTimeout(resolve, 300));
    const first = window.EarthSystem.map();
    window.EarthSystem.switchToMacro();
    await new Promise(resolve => setTimeout(resolve, 100));
    window.EarthSystem.switchToMicro(-15, 120, { zoom: 7 });
    await new Promise(resolve => setTimeout(resolve, 300));
    const second = window.EarthSystem.map();
    const center = second.getCenter();
    return {
      sameMap: first === second,
      mode: window.EarthSystem.getState().mode,
      lat: center.lat,
      lng: center.lng,
      zoom: second.getZoom()
    };
  });
  assert.equal(result.sameMap, true);
  assert.equal(result.mode, 'map');
  assert.ok(Math.abs(result.lat - -15) < 0.01);
  assert.ok(Math.abs(result.lng - 120) < 0.01);
  assert.ok(Math.abs(result.zoom - 7) < 0.01);
});

test('mobile pinch gesture zooms the globe without entering a stuck touch state', async ({ page }) => {
  const before = await page.evaluate(() => window.EarthSystem.getState().orbit.radius);
  const center = { x: 360, y: 360 };
  await page.touchscreen.tap(center.x, center.y);
  await page.evaluate(() => {
    const canvas = document.querySelector('#c');
    const makeTouch = (identifier, x, y) => new Touch({
      identifier,
      target: canvas,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      pageX: x,
      pageY: y
    });
    const startTouches = [makeTouch(1, 330, 360), makeTouch(2, 390, 360)];
    canvas.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: startTouches,
      targetTouches: startTouches,
      changedTouches: startTouches
    }));
    const moveTouches = [makeTouch(1, 280, 360), makeTouch(2, 440, 360)];
    canvas.dispatchEvent(new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
      touches: moveTouches,
      targetTouches: moveTouches,
      changedTouches: moveTouches
    }));
    canvas.dispatchEvent(new TouchEvent('touchend', {
      bubbles: true,
      cancelable: true,
      touches: [],
      targetTouches: [],
      changedTouches: moveTouches
    }));
  });
  await page.waitForTimeout(150);
  const afterPinch = await page.evaluate(() => window.EarthSystem.getState().orbit.radius);
  assert.notEqual(afterPinch, before);

  await page.mouse.move(360, 360);
  await page.mouse.down();
  await page.mouse.move(460, 390, { steps: 4 });
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => window.EarthSystem.getState().orbit);
  assert.ok(Number.isFinite(afterDrag.theta));
  assert.ok(Number.isFinite(afterDrag.phi));
}, { viewport: { width: 720, height: 720 }, isMobile: true, hasTouch: true });

test('three layer and app layer APIs mount, update, emit, and unmount', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.EarthSystem;
    const events = [];
    ['layeradd', 'layerremove', 'layerregister', 'layerunregister'].forEach(name => {
      api.on(name, event => events.push({ type: event.type, detail: event.detail }));
    });

    const mesh = new api.THREE.Mesh(
      new api.THREE.SphereGeometry(0.01, 8, 8),
      new api.THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    const added = api.addThreeLayer('test-three', mesh);
    const inEarthGroup = api.earthGroup.children.includes(mesh);
    const removed = api.removeThreeLayer('test-three');
    const removedFromEarthGroup = !api.earthGroup.children.includes(mesh);

    const appGroup = new api.THREE.Group();
    let mounted = 0;
    let unmounted = 0;
    let updates = 0;
    api.registerLayer('test-app', {
      threeObject: appGroup,
      update: () => { updates += 1; },
      mount: () => { mounted += 1; },
      unmount: () => { unmounted += 1; }
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    const appInEarthGroup = api.earthGroup.children.includes(appGroup);
    const unregistered = api.unregisterLayer('test-app');
    const appRemoved = !api.earthGroup.children.includes(appGroup);

    return {
      added: !!added,
      inEarthGroup,
      removed,
      removedFromEarthGroup,
      mounted,
      unmounted,
      updates,
      appInEarthGroup,
      unregistered,
      appRemoved,
      events
    };
  });

  assert.equal(result.added, true);
  assert.equal(result.inEarthGroup, true);
  assert.equal(result.removed, true);
  assert.equal(result.removedFromEarthGroup, true);
  assert.equal(result.mounted, 1);
  assert.equal(result.unmounted, 1);
  assert.ok(result.updates > 0, 'app layer update should run during animation frames');
  assert.equal(result.appInEarthGroup, true);
  assert.equal(result.unregistered, true);
  assert.equal(result.appRemoved, true);
  assert.deepEqual(result.events.map(event => event.type), [
    'layeradd',
    'layerremove',
    'layeradd',
    'layerregister',
    'layerremove',
    'layerunregister'
  ]);
});

test('event unsubscribe stops future callbacks', async ({ page }) => {
  const counts = await page.evaluate(() => {
    let calls = 0;
    const unsubscribe = window.EarthSystem.on('viewchange', () => { calls += 1; });
    window.EarthSystem.switchToMicro(10, 20, { zoom: 6 });
    unsubscribe();
    window.EarthSystem.switchToMacro();
    return calls;
  });
  assert.equal(counts, 1);
});

test('map layer API stores layers before map load and removes them cleanly', async ({ page }) => {
  const added = await page.evaluate(() => {
    window.__layerEvents = [];
    window.EarthSystem.on('layeradd', event => window.__layerEvents.push({ type: event.type, detail: event.detail }));
    window.EarthSystem.on('layerremove', event => window.__layerEvents.push({ type: event.type, detail: event.detail }));
    return window.EarthSystem.addMapLayer('test-map-layer', {
      sourceId: 'test-map-source',
      source: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [77.2090, 28.6139] },
            properties: {}
          }]
        }
      },
      layers: [{
        id: 'test-map-circle',
        type: 'circle',
        source: 'test-map-source',
        paint: { 'circle-radius': 8, 'circle-color': '#ff0000' }
      }]
    });
  });
  assert.equal(added, false, 'layer cannot install before map exists but should be stored');

  await page.evaluate(() => window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 6 }));
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    return map && map.getSource('test-map-source') && map.getLayer('test-map-circle');
  }, null, { timeout: 10000 });

  const installed = await page.evaluate(() => ({
    hasSource: !!window.EarthSystem.map().getSource('test-map-source'),
    hasLayer: !!window.EarthSystem.map().getLayer('test-map-circle'),
    removed: window.EarthSystem.removeMapLayer('test-map-layer')
  }));
  assert.equal(installed.hasSource, true);
  assert.equal(installed.hasLayer, true);
  assert.equal(installed.removed, true);

  const afterRemove = await page.evaluate(() => ({
    hasSource: !!window.EarthSystem.map().getSource('test-map-source'),
    hasLayer: !!window.EarthSystem.map().getLayer('test-map-circle'),
    events: window.__layerEvents
  }));
  assert.equal(afterRemove.hasSource, false);
  assert.equal(afterRemove.hasLayer, false);
  assert.deepEqual(afterRemove.events.map(event => event.type), ['layeradd', 'layerremove']);
  assert.equal(afterRemove.events[0].detail.type, 'map');
});

test('map layer API installs immediately after map load and handles unknown removals', async ({ page }) => {
  await page.evaluate(() => window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 6 }));
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    return map && map.isStyleLoaded && map.isStyleLoaded();
  }, null, { timeout: 10000 });

  const result = await page.evaluate(() => {
    const installed = window.EarthSystem.addMapLayer('late-map-layer', {
      sourceId: 'late-map-source',
      source: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      },
      layers: [{
        id: 'late-map-circle',
        type: 'circle',
        source: 'late-map-source',
        paint: { 'circle-radius': 4, 'circle-color': '#00ff00' }
      }]
    });
    const map = window.EarthSystem.map();
    return {
      installed,
      hasSource: !!map.getSource('late-map-source'),
      hasLayer: !!map.getLayer('late-map-circle'),
      unknownRemove: window.EarthSystem.removeMapLayer('missing-map-layer'),
      removed: window.EarthSystem.removeMapLayer('late-map-layer'),
      hasSourceAfter: !!map.getSource('late-map-source'),
      hasLayerAfter: !!map.getLayer('late-map-circle')
    };
  });

  assert.equal(result.installed, true);
  assert.equal(result.hasSource, true);
  assert.equal(result.hasLayer, true);
  assert.equal(result.unknownRemove, false);
  assert.equal(result.removed, true);
  assert.equal(result.hasSourceAfter, false);
  assert.equal(result.hasLayerAfter, false);
});

test('resize updates renderer, camera, and map sizing paths', async ({ page }) => {
  const before = await page.evaluate(() => ({
    width: window.EarthSystem.renderer.domElement.width,
    height: window.EarthSystem.renderer.domElement.height,
    aspect: window.EarthSystem.camera.aspect
  }));
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    width: window.EarthSystem.renderer.domElement.width,
    height: window.EarthSystem.renderer.domElement.height,
    aspect: window.EarthSystem.camera.aspect
  }));
  assert.notEqual(after.width, before.width);
  assert.notEqual(after.height, before.height);
  assert.ok(Math.abs(after.aspect - (900 / 700)) < 0.01);

  await page.evaluate(() => window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 6 }));
  await page.waitForFunction(() => window.EarthSystem.map() && window.EarthSystem.getState().mode === 'map', null, { timeout: 10000 });
  await page.setViewportSize({ width: 760, height: 640 });
  await page.waitForTimeout(150);
  const mapSize = await page.evaluate(() => {
    const canvas = window.EarthSystem.map().getCanvas();
    return { width: canvas.width, height: canvas.height };
  });
  assert.ok(mapSize.width > 0);
  assert.ok(mapSize.height > 0);
});

test('core visual scene invariants are present', async ({ page }) => {
  const invariants = await page.evaluate(() => {
    const api = window.EarthSystem;
    return {
      earthHasMap: !!api.earth.material.map,
      earthHasNormalMap: !!api.earth.material.normalMap,
      earthHasSpecularMap: !!api.earth.material.specularMap,
      sunGroupChildren: api.sunGroup.children.length,
      sceneChildren: api.scene.children.length,
      moonFinite: Number.isFinite(api.moon.position.x) && Number.isFinite(api.moon.position.y) && Number.isFinite(api.moon.position.z),
      sunFinite: Number.isFinite(api.sun.position.x) && Number.isFinite(api.sun.position.y) && Number.isFinite(api.sun.position.z)
    };
  });
  assert.equal(invariants.earthHasMap, true);
  assert.equal(invariants.earthHasNormalMap, true);
  assert.equal(invariants.earthHasSpecularMap, true);
  assert.ok(invariants.sunGroupChildren >= 3);
  assert.ok(invariants.sceneChildren >= 6);
  assert.equal(invariants.moonFinite, true);
  assert.equal(invariants.sunFinite, true);
});

test('loads expected high-resolution texture maps', async ({ page }) => {
  await page.waitForFunction(() => {
    const api = window.EarthSystem;
    return api.earth.material.map?.image &&
      api.earth.material.normalMap?.image &&
      api.earth.material.specularMap?.image &&
      api.moon.material.map?.image;
  }, null, { timeout: 10000 });

  const textures = await page.evaluate(() => {
    const api = window.EarthSystem;
    const read = texture => ({
      src: texture.image?.currentSrc || texture.image?.src || '',
      width: texture.image?.naturalWidth || texture.image?.videoWidth || texture.image?.width || 0,
      height: texture.image?.naturalHeight || texture.image?.videoHeight || texture.image?.height || 0,
      isTexture: texture.isTexture === true
    });
    const loadImage = src => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({
        src,
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0
      });
      img.onerror = () => reject(new Error(`Could not load texture asset: ${src}`));
      img.src = src;
    });
    return Promise.all([
      loadImage(api.config.assets.earthDay),
      loadImage(api.config.assets.earthNight),
      loadImage(api.config.assets.earthNormal),
      loadImage(api.config.assets.earthSpecular),
      loadImage(api.config.assets.moon),
      loadImage(api.config.assets.mars),
      loadImage(api.config.assets.sun)
    ]).then(([earthDayAsset, earthNightAsset, earthNormalAsset, earthSpecularAsset, moonAsset, marsAsset, sunAsset]) => ({
      earthDay: read(api.earth.material.map),
      earthNormal: read(api.earth.material.normalMap),
      earthSpecular: read(api.earth.material.specularMap),
      moon: read(api.moon.material.map),
      mars: read(api.mars.material.map),
      earthDayAsset,
      earthNightAsset,
      earthNormalAsset,
      earthSpecularAsset,
      moonAsset,
      marsAsset,
      sunAsset,
      assets: api.config.assets
    }));
  });

  assert.match(textures.assets.earthDay, /earth-blue-marble\.jpg$/);
  assert.match(textures.assets.earthNight, /earth-night\.jpg$/);
  assert.match(textures.assets.earthNormal, /earth_normal_2048\.jpg$/);
  assert.match(textures.assets.earthSpecular, /earth_specular_2048\.jpg$/);
  assert.match(textures.assets.moon, /moon-8k\.jpg$/);
  assert.match(textures.assets.mars, /mars-viking-mdim21-1km\.jpg$/);
  assert.match(textures.assets.sun, /sun_disk\.jpg$/);

  assert.equal(textures.earthDay.isTexture, true);
  assert.ok(textures.earthDay.width >= 4096, 'Earth day texture should be at least 4K wide');
  assert.ok(textures.earthDay.height >= 2048, 'Earth day texture should be at least 2K tall');
  assert.ok(textures.earthDayAsset.width >= 4096, 'Earth day source asset should be at least 4K wide');
  assert.ok(textures.earthDayAsset.height >= 2048, 'Earth day source asset should be at least 2K tall');
  assert.ok(textures.earthNightAsset.width >= 4096, 'Earth night source asset should be at least 4K wide');
  assert.ok(textures.earthNightAsset.height >= 2048, 'Earth night source asset should be at least 2K tall');

  assert.equal(textures.earthNormal.isTexture, true);
  assert.ok(textures.earthNormal.width >= 2048, 'Earth normal texture should be at least 2048 wide');
  assert.ok(textures.earthNormal.height >= 1024, 'Earth normal texture should be at least 1024 tall');
  assert.ok(textures.earthNormalAsset.width >= 2048, 'Earth normal source asset should be at least 2048 wide');
  assert.ok(textures.earthNormalAsset.height >= 1024, 'Earth normal source asset should be at least 1024 tall');

  assert.equal(textures.earthSpecular.isTexture, true);
  assert.ok(textures.earthSpecular.width >= 2048, 'Earth specular texture should be at least 2048 wide');
  assert.ok(textures.earthSpecular.height >= 1024, 'Earth specular texture should be at least 1024 tall');
  assert.ok(textures.earthSpecularAsset.width >= 2048, 'Earth specular source asset should be at least 2048 wide');
  assert.ok(textures.earthSpecularAsset.height >= 1024, 'Earth specular source asset should be at least 1024 tall');

  assert.equal(textures.moon.isTexture, true);
  assert.ok(textures.moon.width >= 8192, 'Moon texture should be 8K wide');
  assert.ok(textures.moon.height >= 4096, 'Moon texture should be 4K tall');
  assert.ok(textures.moonAsset.width >= 8192, 'Moon source asset should be 8K wide');
  assert.ok(textures.moonAsset.height >= 4096, 'Moon source asset should be 4K tall');

  assert.equal(textures.mars.isTexture, true);
  assert.ok(textures.mars.width >= 8192, 'Mars texture should be at least 8K wide');
  assert.ok(textures.mars.height >= 4096, 'Mars texture should be at least 4K tall');
  assert.ok(textures.marsAsset.width >= 8192, 'Mars source asset should be at least 8K wide');
  assert.ok(textures.marsAsset.height >= 4096, 'Mars source asset should be at least 4K tall');

  assert.ok(textures.sunAsset.width >= 2048, 'Sun source asset should be at least 2048 wide');
  assert.ok(textures.sunAsset.height >= 2048, 'Sun source asset should be at least 2048 tall');
});

test('EARTH_CORE_ASSET_BASE redirects configured asset URLs', async ({ page, baseUrl }) => {
  const assets = await page.evaluate(() => window.EarthSystem.config.assets);
  assert.equal(assets.earthDay, `${baseUrl}/earth-core/assets/textures/earth-blue-marble.jpg`);
  assert.equal(assets.earthNight, `${baseUrl}/earth-core/assets/textures/earth-night.jpg`);
  assert.equal(assets.moon, `${baseUrl}/earth-core/assets/textures/moon-8k.jpg`);
  assert.equal(assets.mars, `${baseUrl}/earth-core/assets/textures/mars-viking-mdim21-1km.jpg`);
  assert.equal(assets.sun, `${baseUrl}/earth-core/assets/textures/sun_disk.jpg`);
}, {
  init: async (page, baseUrl) => {
    await page.addInitScript(url => {
      window.EARTH_CORE_ASSET_BASE = url;
    }, `${baseUrl}/earth-core/assets/`);
  }
});

test('latLngToVec returns expected radius and pole directions', async ({ page }) => {
  const values = await page.evaluate(() => {
    const api = window.EarthSystem;
    const equator = api.latLngToVec(0, 0, 1);
    const north = api.latLngToVec(90, 0, 2);
    const south = api.latLngToVec(-90, 0, 3);
    return {
      equatorLength: equator.length(),
      north: { x: north.x, y: north.y, z: north.z, length: north.length() },
      south: { x: south.x, y: south.y, z: south.z, length: south.length() }
    };
  });

  assert.ok(Math.abs(values.equatorLength - 1) < 0.000001);
  assert.ok(Math.abs(values.north.length - 2) < 0.000001);
  assert.ok(values.north.y > 1.999);
  assert.ok(Math.abs(values.south.length - 3) < 0.000001);
  assert.ok(values.south.y < -2.999);
});

async function expectClass(page, selector, className, expected) {
  const hasClass = await page.locator(selector).evaluate((el, name) => el.classList.contains(name), className);
  assert.equal(hasClass, expected);
}

let failures = 0;
for (const { name, fn, options } of tests) {
  process.stdout.write(`• ${name} ... `);
  try {
    await withCorePage(fn, options);
    process.stdout.write('ok\n');
  } catch (error) {
    failures += 1;
    process.stdout.write('failed\n');
    console.error(error);
  }
}

if (failures) {
  console.error(`\n${failures} earth-core test${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} earth-core tests passed.`);
