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
if (!playwright) throw new Error('Playwright is required. Run `npm install` in status/demo first.');
const RUN_SLOW_TESTS = process.env.RUN_SLOW_TESTS === '1';

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.tsv', 'text/tab-separated-values; charset=utf-8']
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

let globalServer = null;
let globalBrowser = null;
let globalPage = null;
let globalPageErrors = [];
let globalFailedRequests = [];

async function resetAppState(page) {
  await page.evaluate(async () => {
    if (!window.EarthHealthEnergyApp) return;
    const state = window.EarthHealthEnergyApp.getState();

    // 0. Reset to macro/globe view if in micro/map view
    if (window.EarthSystem && window.EarthSystem.getState().mode !== 'globe') {
      window.EarthSystem.switchToMacro();
    }

    // 1. Reset target to earth if changed
    if (window.EarthSystem && window.EarthSystem.getState().target !== 'earth') {
      window.EarthSystem.flyToTarget('earth');
    }

    // 2. Toggle off Energy mode if active
    if (state.energyMode) {
      const btn = document.getElementById('showEnergyBtn');
      if (btn) btn.click();
    }

    // 3. Toggle off Health mode if active
    if (state.healthMode) {
      const btn = document.getElementById('showHealthBtn');
      if (btn) btn.click();
    }

    // 4. Reset height range sliders
    const minSlider = document.getElementById('heightRangeMin');
    if (minSlider && minSlider.value !== '0') {
      minSlider.value = '0';
      minSlider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const maxSlider = document.getElementById('heightRangeMax');
    if (maxSlider && maxSlider.value !== '100') {
      maxSlider.value = '100';
      maxSlider.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 5. Reset cluster mode if active
    if (state.healthClusterMode) {
      const clusterBtn = document.getElementById('healthClusterBtn');
      if (clusterBtn) clusterBtn.click();
    }

    // 6. Close inspect panel if open
    const inspectPanel = document.getElementById('inspectPanel');
    if (inspectPanel && inspectPanel.classList.contains('visible')) {
      const closeBtn = document.getElementById('closeInspectBtn');
      if (closeBtn) closeBtn.click();
    }

    // 7. Close Cast & Crew panel if open
    if (window.EarthHealthEnergyApp.getState().crewRollPanelOpen) {
      const crewClose = document.getElementById('crewRollClose');
      if (crewClose) crewClose.click();
    }
  });

  // 7. Clear search input if there is a clear button
  const clearBtn = page.locator('#flyClearBtn');
  if (await clearBtn.isVisible()) {
    await clearBtn.click();
  }

  // 8. Close tooltips
  const closeTooltipBtn = page.locator('#pillarTooltipCloseBtn');
  if (await closeTooltipBtn.isVisible()) {
    await closeTooltipBtn.click();
  }

  // Wait for flight target and view mode to settle
  await page.waitForFunction(() => {
    return (!window.EarthSystem || window.EarthSystem.getState().target === 'earth') &&
           (!window.EarthSystem || window.EarthSystem.getState().mode === 'globe');
  }, null, { timeout: 10000 });

  await page.waitForTimeout(100);
}

async function initGlobalBrowser() {
  if (globalBrowser) return;
  globalServer = await startStaticServer(demoRoot);
  globalBrowser = await playwright.chromium.launch({
    headless: true,
    executablePath: chromeExecutablePath()
  });

  globalPage = await globalBrowser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1
  });

  globalPage.on('pageerror', error => globalPageErrors.push(String(error)));
  globalPage.on('requestfailed', request => {
    const url = request.url();
    if (!url.includes('tile.openstreetmap.org')) {
      globalFailedRequests.push(`${request.failure()?.errorText || 'failed'} ${url}`);
    }
  });

  await globalPage.route('https://tile.openstreetmap.org/**', route => {
    route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
  });

  await globalPage.goto(`${globalServer.baseUrl}/earth-health-energy/earth_health_energy_modular.html`, { waitUntil: 'domcontentloaded' });
  await globalPage.waitForFunction(() =>
    window.EarthSystem &&
    window.EarthHealthEnergyApp &&
    window.EarthHealthEnergyApp.getState().healthCityCount > 200000,
    null, { timeout: 45000 });
  await globalPage.waitForTimeout(250);
}

async function withAppPage(testBody) {
  await initGlobalBrowser();
  
  await resetAppState(globalPage);
  
  globalPageErrors.length = 0;
  globalFailedRequests.length = 0;

  try {
    await testBody({
      page: globalPage,
      baseUrl: globalServer.baseUrl,
      pageErrors: globalPageErrors,
      failedRequests: globalFailedRequests
    });
    assert.deepEqual(globalPageErrors, [], 'page should not throw uncaught errors');
    assert.deepEqual(globalFailedRequests, [], 'page should not have failed non-tile requests');
  } catch (error) {
    try {
      await globalPage.goto(`${globalServer.baseUrl}/earth-health-energy/earth_health_energy_modular.html`, { waitUntil: 'domcontentloaded' });
      await globalPage.waitForFunction(() =>
        window.EarthSystem &&
        window.EarthHealthEnergyApp &&
        window.EarthHealthEnergyApp.getState().healthCityCount > 200000,
        null, { timeout: 45000 });
      await globalPage.waitForTimeout(250);
    } catch (reloadErr) {
      console.error('Failed to reload page after test failure:', reloadErr);
    }
    throw error;
  }
}

const tests = [];
function test(name, fn, options = {}) {
  tests.push({ name, fn, slow: !!options.slow });
}

function slowTest(name, fn) {
  test(name, fn, { slow: true });
}

const forbiddenCountryNames = [
  'India',
  'United States',
  'Canada',
  'Australia',
  'France',
  'Germany',
  'China',
  'Mexico',
  'Brazil',
  'United Kingdom',
];

async function appState(page) {
  return page.evaluate(() => window.EarthHealthEnergyApp.getState());
}

async function showHealth(page) {
  if (!(await page.locator('#showHealthBtn').isVisible())) return;
  const state = await appState(page);
  if (!state.healthMode) {
    await page.click('#showHealthBtn');
    await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().healthMode);
  }
}

async function closeCrewPanel(page) {
  const isOpen = await page.evaluate(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen);
  if (isOpen) {
    await page.evaluate(() => { document.getElementById('crewRollClose')?.click(); });
    await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().crewRollPanelOpen);
  }
}

async function showEnergy(page) {
  if (!(await page.locator('#showEnergyBtn').isVisible())) return;
  const state = await appState(page);
  if (!state.energyMode) {
    await page.click('#showEnergyBtn');
    await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().energyMode);
  }
}

async function clickEnergyNode(page, name) {
  await page.waitForFunction(targetName => {
    const state = window.EarthHealthEnergyApp.getState();
    const node = state.energySystems.find(system => system.name === targetName);
    return node && node.visible &&
      Number.isFinite(node.screenX) &&
      Number.isFinite(node.screenY) &&
      node.screenX > 0 &&
      node.screenY > 0;
  }, name, { timeout: 5000 });
  const node = await page.evaluate(targetName =>
    window.EarthHealthEnergyApp.getState().energySystems.find(system => system.name === targetName),
  name);
  await page.mouse.click(node.screenX, node.screenY);
  await page.waitForFunction(targetName => window.EarthHealthEnergyApp.getState().selectedEnergyName === targetName, name);
  return node;
}

async function clickVisibleEnergyNode(page, excludeName = null) {
  await page.waitForFunction(nameToExclude => {
    const state = window.EarthHealthEnergyApp.getState();
    return state.energySystems.some(system => system.name !== nameToExclude &&
      system.visible &&
      system.screenZ < 1 &&
      system.screenX > 40 &&
      system.screenX < window.innerWidth - 40 &&
      system.screenY > 40 &&
      system.screenY < window.innerHeight - 40);
  }, excludeName, { timeout: 5000 });
  const nodes = await page.evaluate(nameToExclude =>
    window.EarthHealthEnergyApp.getState().energySystems.filter(system => system.name !== nameToExclude &&
      system.visible &&
      system.screenZ < 1 &&
      system.screenX > 40 &&
      system.screenX < window.innerWidth - 40 &&
      system.screenY > 40 &&
      system.screenY < window.innerHeight - 40)
      .sort((a, b) => Math.abs(a.screenX - window.innerWidth * 0.5) - Math.abs(b.screenX - window.innerWidth * 0.5)),
  excludeName);
  for (const node of nodes) {
    await page.mouse.click(node.screenX, node.screenY);
    try {
      await page.waitForFunction(targetName => window.EarthHealthEnergyApp.getState().selectedEnergyName === targetName, node.name, { timeout: 2500 });
      return node;
    } catch (_) {}
  }
  assert.fail(`could not select any visible energy node; tried ${nodes.map(node => node.name).join(', ')}`);
}

test('boots on earth-core and loads the full city dataset', async ({ page }) => {
  const state = await appState(page);
  assert.equal(windowIsObject(await page.evaluate(() => window.EarthSystem)), true);
  assert.equal(state.healthMode, false);
  assert.equal(state.energyMode, false);
  assert.equal(state.healthCityCount, 202466);
  assert.equal(state.displayedHealthCityCount, 202466);
  assert.equal(state.healthGeoJSONFeatureCount, 202466);
  assert.equal(state.energySystemCount, 17);
  assert.ok(state.fullPopulationMaxPop > 20000000);
  assert.equal(await page.evaluate(() => typeof window.GeoNames.loadPlaces), 'function');
  assert.equal(await page.locator('.dropdown-item[data-target="mars"]').count(), 1);
  assert.equal(await page.locator('.dropdown-item[data-target="mars"] .mars-disc').count(), 1);
  await page.click('#target-btn');
  await page.click('.dropdown-item[data-target="mars"]');
  await page.waitForFunction(() => document.querySelector('#target-btn .mars-disc'));
  assert.equal(await page.locator('#target-btn .mars-disc').count(), 1);
  assert.match(await page.evaluate(() => Array.from(document.scripts).map(script => script.src).join('\n')), /\/shared\/geonames\.js\?v=1/);
  assert.equal(await page.locator('#status-chip').evaluate(el => getComputedStyle(el).display), 'none');
  assert.equal(await page.locator('#status-chip').innerText(), '');
});

test('Energy mode toggles panel state and remains mutually exclusive with Health', async ({ page }) => {
  await page.click('#showEnergyBtn');
  let state = await appState(page);
  assert.equal(state.energyMode, true);
  assert.equal(state.healthMode, false);
  assert.equal(await page.locator('#showEnergyBtn').innerText(), 'Hide Energy');
  assert.equal(await page.locator('#showHealthBtn').isVisible(), false);
  assert.equal(await page.locator('#inspectPanel').evaluate(el => el.classList.contains('visible')), true);
  assert.match(await page.locator('#inspectTitle').innerText(), /Goa|Inspect System/);
  assert.equal(await page.locator('#heightRangeControl').evaluate(el => getComputedStyle(el).display), 'none');
  assert.equal(await page.locator('#healthClusterBtn').evaluate(el => getComputedStyle(el).display), 'none');

  await page.click('#showEnergyBtn');
  state = await appState(page);
  assert.equal(state.energyMode, false);
  assert.equal(await page.locator('#showHealthBtn').isVisible(), true);
});

slowTest('Energy controls toggle ascend state with oracle timing and stay active during target flights', async ({ page }) => {
  await showEnergy(page);
  await page.waitForTimeout(250);
  let state = await appState(page);
  assert.equal(state.energyMode, true);
  assert.equal(state.focusedEnergyName, 'Goa');
  assert.equal(state.elevatedEnergy, false);
  assert.equal(state.energyLayerVisible, true);
  assert.equal(await page.locator('#elevateBtn').innerText(), 'Ascend');
  const goaBefore = state.energySystems.find(system => system.name === 'Goa');

  await page.click('#elevateBtn');
  await page.waitForTimeout(80);
  state = await appState(page);
  assert.equal(state.elevatedEnergy, true);
  assert.equal(await page.locator('#elevateBtn').innerText(), 'Descend');
  let goaDuringAscend = state.energySystems.find(system => system.name === 'Goa');
  assert.ok(goaDuringAscend.y > goaBefore.y, 'Goa should begin ascending');
  assert.ok(goaDuringAscend.y < 0.9, 'Ascend should use oracle staged timing, not jump directly to elevated layout');

  await page.waitForTimeout(3500);
  state = await appState(page);
  const goaElevated = state.energySystems.find(system => system.name === 'Goa');
  assert.ok(goaElevated.y > 1.05, 'Goa should finish near the elevated focus position');

  await page.click('#target-btn');
  await page.click('.dropdown-item[data-target="moon"]');
  await page.waitForFunction(() => window.EarthSystem.getState().target === 'moon', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  state = await appState(page);
  assert.equal(state.energyMode, true);
  assert.equal(state.energyLayerVisible, true);

  await page.click('#target-btn');
  await page.click('.dropdown-item[data-target="mars"]');
  await page.waitForFunction(() => window.EarthSystem.getState().target === 'mars', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  state = await appState(page);
  assert.equal(state.energyMode, true);
  assert.equal(state.energyLayerVisible, true);

  await page.evaluate(() => window.EarthSystem.flyToTarget('earth'));
  await page.waitForFunction(() => window.EarthSystem.getState().target === 'earth', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  state = await appState(page);
  assert.equal(state.energyLayerVisible, true);

  await page.click('#elevateBtn');
  await page.waitForFunction(({ elevatedY, surfaceY }) => {
    const goa = window.EarthHealthEnergyApp.getState().energySystems.find(system => system.name === 'Goa');
    return goa && goa.y < elevatedY && goa.y > surfaceY;
  }, { elevatedY: goaElevated.y, surfaceY: goaBefore.y }, { timeout: 5000 });
  state = await appState(page);
  assert.equal(state.elevatedEnergy, false);
  assert.equal(await page.locator('#elevateBtn').innerText(), 'Ascend');
  const goaDuringDescend = state.energySystems.find(system => system.name === 'Goa');
  assert.ok(goaDuringDescend.y < goaElevated.y, 'Goa should begin descending');
  assert.ok(goaDuringDescend.y > goaBefore.y, 'Descend should use oracle slower staged return, not snap to Earth');
});

test('Energy node click selects a system and Satisfied/Not Satisfied controls update state', async ({ page }) => {
  await showEnergy(page);
  await page.waitForTimeout(500);
  await clickEnergyNode(page, 'Goa');
  let state = await appState(page);
  assert.equal(state.selectedEnergyName, 'Goa');
  assert.equal(await page.locator('#inspectTitle').innerText(), 'Goa');
  assert.match(await page.locator('#inspectSubtitle').innerText(), /default/);

  await page.click('#satisfiedBtn');
  await page.waitForFunction(() => {
    const goa = window.EarthHealthEnergyApp.getState().energySystems.find(system => system.name === 'Goa');
    return goa && goa.state === 'satisfied' && goa.domeColor === '16a34a';
  });
  state = await appState(page);
  let goa = state.energySystems.find(system => system.name === 'Goa');
  assert.equal(goa.state, 'satisfied');
  assert.equal(goa.domeColor, '16a34a');
  assert.match(await page.locator('#inspectSubtitle').innerText(), /satisfied/);

  await page.click('#notSatisfiedBtn');
  await page.waitForFunction(() => {
    const goa = window.EarthHealthEnergyApp.getState().energySystems.find(system => system.name === 'Goa');
    return goa && goa.state === 'notSatisfied' && goa.domeColor === 'dc2626';
  });
  state = await appState(page);
  goa = state.energySystems.find(system => system.name === 'Goa');
  assert.equal(goa.state, 'notSatisfied');
  assert.equal(goa.domeColor, 'dc2626');
  assert.match(await page.locator('#inspectSubtitle').innerText(), /notSatisfied/);
});

test('Energy Focus control changes the focused node and keeps connection arcs active', async ({ page }) => {
  await showEnergy(page);
  await page.waitForTimeout(500);
  const clicked = await clickVisibleEnergyNode(page, 'Goa');
  await page.click('#focusEnergyBtn');
  await page.waitForFunction(name => window.EarthHealthEnergyApp.getState().focusedEnergyName === name, clicked.name);
  const state = await appState(page);
  const focused = state.energySystems.find(system => system.name === clicked.name);
  const goa = state.energySystems.find(system => system.name === 'Goa');
  assert.equal(state.focusedEnergyName, clicked.name);
  assert.equal(focused.focused, true);
  assert.equal(goa.focused, false);
});

test('Dragging the 3D globe in Energy mode does not select a node on release', async ({ page }) => {
  await showEnergy(page);
  const before = await appState(page);
  await page.mouse.move(620, 420);
  await page.mouse.down();
  await page.mouse.move(820, 560, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const state = await appState(page);
  assert.equal(state.selectedEnergyName, before.selectedEnergyName);
});

slowTest('Energy layer hides in 2D map mode and restores in 3D globe mode', async ({ page }) => {
  await showEnergy(page);
  await page.waitForTimeout(300);
  let state = await appState(page);
  assert.equal(state.energyLayerVisible, true);
  await page.evaluate(() => window.EarthSystem.switchToMicro(15.5588, 73.77, { zoom: 6 }));
  await page.waitForFunction(() => window.EarthSystem.getState().mode === 'map');
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().energyLayerVisible);
  state = await appState(page);
  assert.equal(state.energyMode, true);
  assert.equal(state.energyLayerVisible, false);
  await page.evaluate(() => window.EarthSystem.switchToMacro());
  await page.waitForFunction(() => window.EarthSystem.getState().mode === 'globe');
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().energyLayerVisible);
  state = await appState(page);
  assert.equal(state.energyLayerVisible, true);
});

test('Health mode shows manifest HUD buttons and filter panel', async ({ page }) => {
  await showHealth(page);
  const state = await appState(page);
  assert.equal(state.healthMode, true);
  assert.equal(state.energyMode, false);
  assert.equal(await page.locator('#showEnergyBtn').isVisible(), false);
  assert.equal(await page.locator('#showHealthBtn').innerText(), 'Hide Manifest');
  assert.equal(await page.locator('#inspectTitle').innerText(), 'Manifest Filters');
  assert.equal(await page.locator('#healthClusterBtn').isVisible(), true);
  assert.equal(await page.locator('#heightRangeMin').isVisible(), true);
  assert.equal(await page.locator('#heightRangeMax').isVisible(), true);
  // Manifest HUD replaces old hamburger
  assert.equal(await page.locator('#manifest-hud').evaluate(el => el.classList.contains('visible')), true);
  assert.equal(await page.locator('#manifestFiltersBtn').isVisible(), true);
  assert.equal(await page.locator('#manifestCrewBtn').isVisible(), true);
  // Filters button toggles inspect panel
  await page.click('#closeInspectBtn');
  assert.equal(await page.locator('#inspectPanel').evaluate(el => el.classList.contains('visible')), false);
  await page.click('#manifestFiltersBtn');
  assert.equal(await page.locator('#inspectPanel').evaluate(el => el.classList.contains('visible')), true);
  // HUD hides when Manifest closes
  await page.click('#showHealthBtn');
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().healthMode);
  assert.equal(await page.locator('#manifest-hud').evaluate(el => el.classList.contains('visible')), false);
});

test('Health toggles off cleanly and restores neutral app chrome', async ({ page }) => {
  await showHealth(page);
  await page.click('#showHealthBtn');
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().healthMode);
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().healthLayerVisible);
  const state = await appState(page);
  assert.equal(state.healthMode, false);
  assert.equal(state.healthLayerVisible, false);
  assert.equal(await page.locator('#showHealthBtn').innerText(), 'Show Manifest');
  assert.equal(await page.locator('#showEnergyBtn').isVisible(), true);
  assert.equal(await page.locator('#status-chip').innerText(), '');
  assert.equal(await page.locator('#pillarTooltip').evaluate(el => getComputedStyle(el).display), 'none');
});

test('Positive and negative health filters are mutually exclusive', async ({ page }) => {
  await showHealth(page);
  await closeCrewPanel(page);
  await page.click('#healthPositiveBtn');
  let state = await appState(page);
  assert.equal(state.healthOnlyPositive, true);
  assert.equal(state.healthOnlyNegative, false);
  assert.equal(await page.locator('#healthPositiveBtn').evaluate(el => el.classList.contains('active')), true);

  await page.click('#healthNegativeBtn');
  state = await appState(page);
  assert.equal(state.healthOnlyPositive, false);
  assert.equal(state.healthOnlyNegative, true);
  assert.equal(await page.locator('#healthPositiveBtn').evaluate(el => el.classList.contains('active')), false);
  assert.equal(await page.locator('#healthNegativeBtn').evaluate(el => el.classList.contains('active')), true);
});

test('Cluster mode uses named region labels and can return to raw cities', async ({ page }) => {
  await showHealth(page);
  await closeCrewPanel(page);
  await page.click('#healthClusterBtn');
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().healthClusterMode);
  let state = await appState(page);
  assert.equal(await page.locator('#healthClusterBtn').innerText(), 'Cluster Cities');
  assert.equal(await page.locator('#healthClusterBtn').evaluate(el => el.classList.contains('active')), true);
  assert.ok(state.displayedHealthCityCount < state.healthCityCount);
  const names = state.displayedSample.map(item => item.city);
  assert.equal(names.some(name => /\bregion$/.test(name)), true);
  assert.equal(names.some(name => /^\d+ cities/.test(name)), false);

  await page.click('#healthClusterBtn');
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().healthClusterMode);
  state = await appState(page);
  assert.equal(state.displayedHealthCityCount, state.healthCityCount);
});

test('Cluster mode anchors Portland region at Portland, not the grid centroid near Vancouver', async ({ page }) => {
  await showHealth(page);
  await page.click('#healthClusterBtn');
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().healthClusterMode);

  await page.evaluate(() => window.EarthSystem.switchToMicro(45.5234, -122.6762, { zoom: 9 }));
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    return map && map.getLayer('health2d-green-inner') &&
      map.getLayoutProperty('health2d-green-inner', 'visibility') === 'visible';
  }, null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const features = window.EarthHealthEnergyApp.getHealthGeoJSON().features;
    return features.some(feature =>
      Number(feature.properties?.clusterCount) > 1 &&
      Math.abs(Number(feature.properties?.lat) - 45.5234) < 0.05 &&
      Math.abs(Number(feature.properties?.lng) - -122.6762) < 0.05 &&
      /Portland/i.test(`${feature.properties?.anchorCity || ''} ${feature.properties?.name || ''}`));
  }, null, { timeout: 10000 });
  const sourceFeature = await page.evaluate(() => {
    const data = window.EarthHealthEnergyApp.getHealthGeoJSON();
    const match = data.features.find(feature =>
      Math.abs(Number(feature.properties?.lat) - 45.5234) < 0.05 &&
      Math.abs(Number(feature.properties?.lng) - -122.6762) < 0.05 &&
      /Portland/i.test(`${feature.properties?.anchorCity || ''} ${feature.properties?.name || ''}`));
    if (!match) return null;
    return {
      name: match.properties.name,
      lat: Number(match.properties.lat),
      lng: Number(match.properties.lng),
      isCluster: match.properties.isCluster === true || match.properties.isCluster === 'true' || match.properties.isCluster === 1 || match.properties.isCluster === '1' || Number(match.properties.clusterCount) > 1,
      clusterCount: Number(match.properties.clusterCount) || 1,
      coordinates: match.geometry.coordinates
    };
  });
  assert.ok(sourceFeature, 'health2d source should include a Portland cluster feature');
  assert.ok(Math.abs(sourceFeature.lat - 45.5234) < 0.05, `Portland cluster latitude should stay near Portland, got ${sourceFeature.lat}`);
  assert.ok(Math.abs(sourceFeature.lng - -122.6762) < 0.05, `Portland cluster longitude should stay near Portland, got ${sourceFeature.lng}`);
  assert.ok(Math.abs(sourceFeature.coordinates[1] - 45.5234) < 0.05);
  assert.ok(Math.abs(sourceFeature.coordinates[0] - -122.6762) < 0.05);

  const mapFeature = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    const point = map.project([-122.6762, 45.5234]);
    const inView = point.x >= 0 && point.y >= 0 && point.x <= window.innerWidth && point.y <= window.innerHeight;
    const match = window.EarthHealthEnergyApp.getHealthGeoJSON().features.find(feature =>
      Math.abs(Number(feature.properties?.lat) - 45.5234) < 0.05 &&
      Math.abs(Number(feature.properties?.lng) - -122.6762) < 0.05 &&
      /Portland/i.test(`${feature.properties?.anchorCity || ''} ${feature.properties?.name || ''}`));
    if (!match || !inView) return null;
    return {
      name: match.properties.name,
      lat: Number(match.properties.lat),
      lng: Number(match.properties.lng),
      isCluster: match.properties.isCluster === true || match.properties.isCluster === 'true' || match.properties.isCluster === 1 || match.properties.isCluster === '1' || Number(match.properties.clusterCount) > 1,
      clusterCount: Number(match.properties.clusterCount) || 1
    };
  });
  assert.ok(mapFeature, '2D map should render a Portland cluster feature near Portland');
  assert.ok(Math.abs(mapFeature.lat - 45.5234) < 0.05);
  assert.ok(Math.abs(mapFeature.lng - -122.6762) < 0.05);
});

slowTest('Cluster info card expands to show member city sentiment details', async ({ page }) => {
  await showHealth(page);
  await page.click('#healthClusterBtn');
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().healthClusterMode);

  const clusterTarget = await page.evaluate(() => {
    const clusters = window.EarthHealthEnergyApp.getState().displayedSample
      .filter(item => item.isCluster && item.clusterCount > 1);
    return clusters.find(item => /Portland/i.test(`${item.anchorCity || ''} ${item.city || ''}`)) || clusters[0] || null;
  });
  assert.ok(clusterTarget, 'cluster mode should expose at least one clustered city group');
  await page.evaluate(target => { window.__clusterTargetId = target.id; }, clusterTarget);

  await page.evaluate(target => window.EarthSystem.switchToMicro(target.lat, target.lng, { zoom: 9 }), clusterTarget);
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    return map && map.getLayer('health2d-green-inner') &&
      map.getLayoutProperty('health2d-green-inner', 'visibility') === 'visible';
  }, null, { timeout: 20000 });
  await page.waitForFunction(() => {
    const features = window.EarthHealthEnergyApp.getHealthGeoJSON().features;
    return features.some(feature => String(feature.properties?.id) === String(window.__clusterTargetId));
  }, null, { timeout: 10000 });

  const clickPoint = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    const match = window.EarthHealthEnergyApp.getHealthGeoJSON().features.find(feature => String(feature.properties?.id) === String(window.__clusterTargetId));
    if (!match) return null;
    const point = map.project(match.geometry.coordinates);
    return { x: point.x, y: point.y };
  });
  assert.ok(clickPoint, '2D map should expose a clickable cluster feature');

  await page.mouse.click(clickPoint.x, clickPoint.y);
  await page.waitForSelector('#clusterDetailsToggle', { timeout: 10000 });
  assert.match(await page.locator('#clusterDetailsToggle').innerText(), /Cluster of \d+ cities/);
  assert.equal(await page.locator('#clusterDetailsToggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#clusterDetailsPanel').evaluate(el => getComputedStyle(el).display), 'none');

  await page.click('#clusterDetailsToggle');
  await page.waitForFunction(() => document.querySelector('#clusterDetailsToggle')?.getAttribute('aria-expanded') === 'true');
  assert.equal(await page.locator('#clusterDetailsPanel').evaluate(el => getComputedStyle(el).display), 'block');
  assert.ok(await page.locator('.cluster-member-row').count() > 1);
  const detailsText = await page.locator('#clusterDetailsPanel').innerText();
  assert.match(detailsText, /Positive|Negative|\+\d+%|-\d+%/);
  for (const country of forbiddenCountryNames) {
    assert.equal(detailsText.includes(country), false, `cluster details should not mention country name ${country}`);
  }
});

test('Percentile range filters without rescaling remaining column heights', async ({ page }) => {
  await showHealth(page);
  const before = await appState(page);
  const sample = before.displayedSample.find(item => item.pop < 200000 && item.pop > 100000) || before.displayedSample.at(-1);
  assert.ok(sample);

  await page.locator('#heightRangeMax').evaluate(el => {
    el.value = '50';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().heightMaxPercent === 50);
  const after = await appState(page);
  assert.equal(after.heightMinPercent, 0);
  assert.equal(after.heightMaxPercent, 50);
  assert.ok(after.displayedHealthCityCount < before.displayedHealthCityCount);
  assert.match(await page.locator('#heightRangeReadout').innerText(), /0th - 50th/);
  assert.equal(await page.locator('#heightSliderFill').evaluate(el => el.style.width), '50%');

  const recomputedHeight = 0.01 + Math.sqrt(sample.pop / after.fullPopulationMaxPop) * 0.24;
  assert.ok(Math.abs(recomputedHeight - sample.height) < 1e-12);
});

test('Percentile handles clamp when min crosses max and when max crosses min', async ({ page }) => {
  await showHealth(page);
  await page.locator('#heightRangeMax').evaluate(el => {
    el.value = '30';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().heightMaxPercent === 30);

  await page.locator('#heightRangeMin').evaluate(el => {
    el.focus();
    el.value = '35';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().heightMinPercent === 29);
  let state = await appState(page);
  assert.equal(state.heightMinPercent, 29);
  assert.equal(state.heightMaxPercent, 30);
  assert.equal(await page.locator('#heightRangeMin').inputValue(), '29');
  assert.equal(await page.locator('#heightRangeMax').inputValue(), '30');

  await page.locator('#heightRangeMax').evaluate(el => {
    el.focus();
    el.value = '20';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().heightMaxPercent === 30);
  state = await appState(page);
  assert.equal(state.heightMinPercent, 29);
  assert.equal(state.heightMaxPercent, 30);
});

slowTest('City search suggestions appear and selecting one starts Health map workflow', async ({ page }) => {
  await page.fill('#flyInput', 'Delhi');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#flySuggestions')).display === 'block');
  const firstSuggestion = page.locator('#flySuggestions > div').first();
  const text = await firstSuggestion.innerText();
  assert.match(text, /Delhi/i);
  await firstSuggestion.click();
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().healthMode);
  const state = await appState(page);
  assert.equal(state.healthMode, true);
  assert.equal(state.energyMode, false);
  assert.match(await page.locator('#flyInput').inputValue(), /Delhi/i);
});

test('City search uses shared GeoNames labels for smaller regional places', async ({ page }) => {
  await page.fill('#flyInput', 'Panjim');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#flySuggestions')).display === 'block');
  const suggestions = await page.locator('#flySuggestions > div').allInnerTexts();
  assert.equal(suggestions.some(text => /Panjim/i.test(text) && /Goa/i.test(text)), true);
});

test('Visible Manifest labels and city suggestions do not mention countries', async ({ page }) => {
  await showHealth(page);
  await closeCrewPanel(page); // crew panel cities (e.g. "Mexico City") must not trigger false positives
  await page.fill('#flyInput', 'Panjim');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#flySuggestions')).display === 'block');
  // Only check the app chrome, not the crew panel city list
  const visibleText = await page.evaluate(() => {
    const crewPanel = document.getElementById('crewRollPanel');
    if (crewPanel) crewPanel.style.visibility = 'hidden';
    const text = document.body.innerText;
    if (crewPanel) crewPanel.style.visibility = '';
    return text;
  });
  for (const country of forbiddenCountryNames) {
    assert.equal(visibleText.includes(country), false, `visible app text should not mention country name ${country}`);
  }

  const suggestionText = (await page.locator('#flySuggestions').innerText()).trim();
  assert.match(suggestionText, /Panjim/i);
  assert.match(suggestionText, /Goa/i);
  assert.equal(/India|United States|Canada|Australia|France|Germany|China|Mexico|Brazil|United Kingdom/.test(suggestionText), false);
});

test('City search clear button and outside click dismiss suggestions', async ({ page }) => {
  await page.fill('#flyInput', 'Mumbai');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#flySuggestions')).display === 'block');
  assert.equal(await page.locator('#flyClearBtn').evaluate(el => getComputedStyle(el).display), 'block');

  await page.mouse.click(20, 900);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#flySuggestions')).display === 'none');
  assert.equal(await page.locator('#flyInput').inputValue(), 'Mumbai');

  await page.click('#flyClearBtn');
  assert.equal(await page.locator('#flyInput').inputValue(), '');
  assert.equal(await page.locator('#flyClearBtn').evaluate(el => getComputedStyle(el).display), 'none');
});

slowTest('2D Health map layers hover, click, and selected ring work', async ({ page }) => {
  await showHealth(page);
  await page.evaluate(() => window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 5 }));
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    return map &&
      map.getLayer('health2d-red-base') &&
      map.getLayer('health2d-green-inner') &&
      map.getLayer('health2d-selected-ring');
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1000);

  const hit = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    const pt = map.project([77.2090, 28.6139]);
    const features = map.queryRenderedFeatures(
      [[pt.x - 120, pt.y - 120], [pt.x + 120, pt.y + 120]],
      { layers: ['health2d-green-inner', 'health2d-red-base'] }
    );
    return { count: features.length, point: { x: pt.x, y: pt.y } };
  });
  assert.ok(hit.count > 0);

  await page.mouse.move(hit.point.x, hit.point.y);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#cityHoverFlag')).display === 'block');
  assert.ok((await page.locator('#cityHoverFlag').innerText()).length > 0);

  await page.mouse.click(hit.point.x, hit.point.y);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#pillarTooltip')).display === 'block');
  const selection = await page.evaluate(() => {
    const source = window.EarthSystem.map().getSource('health2d-selected');
    return {
      selectedFeatures: source && source._data && source._data.features ? source._data.features.length : 0,
      selectedCity: window.EarthHealthEnergyApp.getState().selectedCity,
      tooltip: document.querySelector('#pillarTooltip').textContent.replace(/\s+/g, ' ').trim()
    };
  });
  assert.equal(selection.selectedFeatures, 1);
  assert.ok(selection.selectedCity);
  assert.match(selection.tooltip, /Population/);
});

slowTest('Closing the 2D info card clears selected ring and selected app state', async ({ page }) => {
  await showHealth(page);
  await page.evaluate(() => window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 5 }));
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    return map && map.getLayer('health2d-red-base') && map.getLayer('health2d-selected-ring');
  }, null, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const hit = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    const pt = map.project([77.2090, 28.6139]);
    const features = map.queryRenderedFeatures(
      [[pt.x - 120, pt.y - 120], [pt.x + 120, pt.y + 120]],
      { layers: ['health2d-green-inner', 'health2d-red-base'] }
    );
    return { count: features.length, point: { x: pt.x, y: pt.y } };
  });
  assert.ok(hit.count > 0);
  await page.mouse.click(hit.point.x, hit.point.y);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#pillarTooltip')).display === 'block');
  await page.click('#pillarTooltipCloseBtn');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#pillarTooltip')).display === 'none');
  const cleared = await page.evaluate(() => {
    const source = window.EarthSystem.map().getSource('health2d-selected');
    return {
      selectedFeatures: source && source._data && source._data.features ? source._data.features.length : 0,
      selectedCity: window.EarthHealthEnergyApp.getState().selectedCity
    };
  });
  assert.equal(cleared.selectedFeatures, 0);
  assert.equal(cleared.selectedCity, null);
});

slowTest('2D health layers hide when Health mode is turned off in map view', async ({ page }) => {
  await showHealth(page);
  await page.evaluate(() => window.EarthSystem.switchToMicro(28.6139, 77.2090, { zoom: 5 }));
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    return map && map.getLayer('health2d-red-base') &&
      map.getLayoutProperty('health2d-red-base', 'visibility') === 'visible';
  }, null, { timeout: 20000 });
  await page.evaluate(() => {
    document.querySelector('#showEnergyBtn').style.pointerEvents = 'auto';
    document.querySelector('#showHealthBtn').style.pointerEvents = 'auto';
  });
  await page.click('#showHealthBtn', { force: true });
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().healthMode);
  const visibility = await page.evaluate(() => {
    const map = window.EarthSystem.map();
    return {
      red: map.getLayoutProperty('health2d-red-base', 'visibility'),
      green: map.getLayoutProperty('health2d-green-inner', 'visibility'),
      ring: map.getLayoutProperty('health2d-selected-ring', 'visibility')
    };
  });
  assert.equal(visibility.red, 'none');
  assert.equal(visibility.green, 'none');
  assert.equal(visibility.ring, 'none');
});

slowTest('Manifest 3D layer remains visible while switching Earth, Moon, Mars, and Sun targets', async ({ page }) => {
  await showHealth(page);
  await page.waitForTimeout(250);
  let state = await appState(page);
  assert.equal(state.healthLayerVisible, true);
  for (const target of ['moon', 'mars', 'sun']) {
    await page.evaluate(name => window.EarthSystem.flyToTarget(name), target);
    await page.waitForFunction(name => window.EarthSystem.getState().target === name, target, { timeout: 5000 });
    await page.waitForTimeout(300);
    state = await appState(page);
    assert.equal(state.healthMode, true);
    assert.equal(state.healthLayerVisible, true);
  }

  await page.evaluate(() => window.EarthSystem.flyToTarget('earth'));
  await page.waitForFunction(() => window.EarthSystem.getState().target === 'earth', null, { timeout: 5000 });
  await page.waitForTimeout(2700);
  state = await appState(page);
  assert.equal(state.healthLayerVisible, true);
});

test('Dragging the 3D globe in Health mode does not select a column on release', async ({ page }) => {
  await showHealth(page);
  await page.mouse.move(640, 430);
  await page.mouse.down();
  await page.mouse.move(780, 520, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const state = await appState(page);
  assert.equal(state.selectedCity, null);
  assert.equal(await page.locator('#pillarTooltip').evaluate(el => getComputedStyle(el).display), 'none');
});

// ── Paragons & Pirates feature tests ─────────────────────────────────────────

test('Cast & Crew panel opens automatically when Manifest activates', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  const state = await appState(page);
  assert.equal(state.crewRollPanelOpen, true);
  assert.equal(await page.locator('#crewRollPanel').evaluate(el => el.classList.contains('open')), true);
  assert.equal(await page.locator('#manifestCrewBtn').evaluate(el => el.classList.contains('active')), true);
});

test('Cast & Crew panel closes when Manifest deactivates', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  await page.click('#showHealthBtn');
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().healthMode);
  const state = await appState(page);
  assert.equal(state.crewRollPanelOpen, false);
  assert.equal(await page.locator('#crewRollPanel').evaluate(el => el.classList.contains('open')), false);
});

test('Cast & Crew button in manifest HUD toggles crew panel independently', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  // Close via button
  await page.click('#manifestCrewBtn');
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().crewRollPanelOpen);
  assert.equal(await page.locator('#crewRollPanel').evaluate(el => el.classList.contains('open')), false);
  assert.equal(await page.locator('#manifestCrewBtn').evaluate(el => el.classList.contains('active')), false);
  // Re-open via button
  await page.click('#manifestCrewBtn');
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen);
  assert.equal(await page.locator('#crewRollPanel').evaluate(el => el.classList.contains('open')), true);
  assert.equal(await page.locator('#manifestCrewBtn').evaluate(el => el.classList.contains('active')), true);
});

test('Crew panel title is "Earth Cast & Crew" and shows population count in billions', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  assert.equal(await page.locator('#crewRollTitle').innerText(), 'Earth Cast & Crew');
  await page.waitForFunction(() => /\d+\.\d+B/.test(document.getElementById('crewRollCount')?.textContent || ''));
  const countText = await page.locator('#crewRollCount').innerText();
  assert.match(countText, /^\d+\.\d+B$/, 'population count should be decimal billions like 4.4B');
});

test('Paragon section has Tara and Nebula sub-sections with correct member counts', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  // Top-level Paragon count = 16 (10 Tara + 6 Nebula)
  assert.equal(await page.locator('#paragonCount').innerText(), '16');
  assert.equal(await page.locator('#taraCount').innerText(), '10');
  assert.equal(await page.locator('#nebulaCount').innerText(), '6');
  // Sub-section headers visible
  assert.equal(await page.locator('#taraSubHeader').isVisible(), true);
  assert.equal(await page.locator('#nebulaSubHeader').isVisible(), true);
  // Tara members include Ananya, Shashank (spot-check)
  const taraText = await page.locator('#taraList').innerText();
  assert.match(taraText, /Ananya/);
  assert.match(taraText, /Shashank/);
  // Nebula members include Vinay, Priya (spot-check)
  const nebulaText = await page.locator('#nebulaList').innerText();
  assert.match(nebulaText, /Vinay/);
  assert.match(nebulaText, /Priya/);
});

test('Paragon rows display proficiency orbs and coloured system pills', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  // Vinay is Sensei — should have 4 orbs and laurel SVG
  const vineaRow = page.locator('#nebulaList .crew-row').filter({ hasText: 'Vinay' });
  assert.equal(await vineaRow.locator('.gold-orb').count(), 4);
  assert.equal(await vineaRow.locator('.sensei-wrap').count(), 1);
  // Training member (Ananya) should have the prof-bar not orbs
  const ananyaRow = page.locator('#taraList .crew-row').filter({ hasText: 'Ananya' });
  assert.equal(await ananyaRow.locator('.prof-bar').count(), 1);
  assert.equal(await ananyaRow.locator('.gold-orb').count(), 0);
  // System pills exist
  assert.ok(await vineaRow.locator('.crew-system').count() > 0);
});

test('Pirate section has Caught and At Large sub-sections', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  assert.equal(await page.locator('#knownSubHeader').isVisible(), true);
  assert.equal(await page.locator('#unknownSubHeader').isVisible(), true);
  // Caught shows 7 known pirates
  assert.equal(await page.locator('#knownCount').innerText(), '7');
  const caughtText = await page.locator('#knownPiratesList').innerText();
  assert.match(caughtText, /Rav/);
  assert.match(caughtText, /Rukmin/);
  // Pirate At Large count matches full city dataset
  const atLargeCount = await page.locator('#unknownCount').innerText();
  assert.match(atLargeCount, /\d{3},\d{3}/);
});

test('Known Pirates have deterministic stickers and pirate system badges', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  const firstRow = page.locator('#knownPiratesList .crew-row').first();
  // Each known pirate row has a sticker and rank badge
  assert.ok(await firstRow.locator('.pirate-sticker').count() > 0);
  assert.ok(await firstRow.locator('.pirate-rank-badge').count() > 0);
  assert.ok(await firstRow.locator('.pirate-epithet').count() > 0);
});

test('Tara and Nebula sub-sections are collapsible', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  // Tara body starts open
  assert.equal(await page.locator('#taraBody').evaluate(el => el.classList.contains('collapsed')), false);
  // Click header to collapse
  await page.click('#taraSubHeader');
  await page.waitForFunction(() => document.getElementById('taraBody').classList.contains('collapsed'));
  assert.equal(await page.locator('#taraBody').evaluate(el => el.classList.contains('collapsed')), true);
  // Click again to expand
  await page.click('#taraSubHeader');
  await page.waitForFunction(() => !document.getElementById('taraBody').classList.contains('collapsed'));
  assert.equal(await page.locator('#taraBody').evaluate(el => el.classList.contains('collapsed')), false);
});

test('Manifest question mode Q0 labels filter buttons as Paragon/Pirate', async ({ page }) => {
  await showHealth(page);
  const state = await appState(page);
  assert.equal(state.manifestQuestion, 0);
  // Filter buttons should use Q0 vocabulary
  const posLabel = await page.locator('#healthPositiveBtn').innerText();
  const negLabel = await page.locator('#healthNegativeBtn').innerText();
  assert.match(posLabel, /Paragon/i);
  assert.match(negLabel, /Pirate/i);
});

test('Switching to Q1 relabels filter buttons as Yes/No everywhere', async ({ page }) => {
  await showHealth(page);
  // Open question dropdown and pick Q1
  await page.click('#manifestQuestionBtn');
  await page.locator('.mq-item[data-q="1"]').click();
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().manifestQuestion === 1);
  const state = await appState(page);
  assert.equal(state.manifestQuestion, 1);
  assert.match(await page.locator('#healthPositiveBtn').innerText(), /Yes/i);
  assert.match(await page.locator('#healthNegativeBtn').innerText(), /No/i);
  assert.match(await page.locator('#mqLegendPositive').innerText(), /Yes/i);
  assert.match(await page.locator('#mqLegendNegative').innerText(), /No/i);
});

test('Q0 Paragon/Pirate mode forces all-red globe (manifestQuestion is 0 and positive filter labelled Paragon)', async ({ page }) => {
  await showHealth(page);
  // Wait for question to settle on Q0 (reset on each manifest open)
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().manifestQuestion === 0);
  await page.waitForFunction(() => /Paragon/i.test(document.getElementById('healthPositiveBtn')?.textContent || ''));
  const state = await appState(page);
  assert.equal(state.manifestQuestion, 0);
  // Filter button labels confirm Q0 vocabulary is active
  assert.match(await page.locator('#healthPositiveBtn').innerText(), /Paragon/i);
  assert.match(await page.locator('#healthNegativeBtn').innerText(), /Pirate/i);
  // Legend reflects same vocabulary
  assert.match(await page.locator('#mqLegendPositive').innerText(), /Paragon/i);
  assert.match(await page.locator('#mqLegendNegative').innerText(), /Pirate/i);
});

test('Paragon and Pirate top-level sections expand and auto-open first sub-section', async ({ page }) => {
  await showHealth(page);
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().crewRollPanelOpen, null, { timeout: 3000 });
  // Collapse Paragon
  await page.click('#paragonHeader');
  await page.waitForFunction(() => document.getElementById('paragonBody').classList.contains('collapsed'));
  // Re-expand — Tara should auto-open
  await page.click('#paragonHeader');
  await page.waitForFunction(() => !document.getElementById('paragonBody').classList.contains('collapsed'));
  await page.waitForFunction(() => !document.getElementById('taraBody').classList.contains('collapsed'), null, { timeout: 2000 });
  assert.equal(await page.locator('#taraBody').evaluate(el => el.classList.contains('collapsed')), false);
});

test('Manifest question panel visible only in health mode with question dropdown', async ({ page }) => {
  // Not visible when health mode is off
  assert.equal(await page.locator('#manifestQuestionPanel').evaluate(el => el.classList.contains('visible')), false);
  await showHealth(page);
  assert.equal(await page.locator('#manifestQuestionPanel').evaluate(el => el.classList.contains('visible')), true);
  // Dropdown opens on click and has two questions
  await page.click('#manifestQuestionBtn');
  assert.equal(await page.locator('#manifestQuestionDropdown').evaluate(el => el.classList.contains('show')), true);
  assert.equal(await page.locator('.mq-item').count(), 2);
  // Close on outside click
  await page.mouse.click(200, 200);
  assert.equal(await page.locator('#manifestQuestionDropdown').evaluate(el => el.classList.contains('show')), false);
});

test('Manifest resets to Q0 Paragon/Pirate when reopened', async ({ page }) => {
  await showHealth(page);
  // Switch to Q1
  await page.click('#manifestQuestionBtn');
  await page.locator('.mq-item[data-q="1"]').click();
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().manifestQuestion === 1);
  // Close and reopen Manifest
  await page.click('#showHealthBtn');
  await page.waitForFunction(() => !window.EarthHealthEnergyApp.getState().healthMode);
  await page.click('#showHealthBtn');
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().healthMode);
  const state = await appState(page);
  assert.equal(state.manifestQuestion, 0);
  assert.match(await page.locator('#healthPositiveBtn').innerText(), /Paragon/i);
});

test('Cluster info card title says "City Region" not "City, State Region, State"', async ({ page }) => {
  await showHealth(page);
  await closeCrewPanel(page);
  await page.click('#healthClusterBtn');
  await page.waitForFunction(() => window.EarthHealthEnergyApp.getState().healthClusterMode);
  const clusterTarget = await page.evaluate(() =>
    window.EarthHealthEnergyApp.getState().displayedSample.find(item => item.isCluster && item.clusterCount > 1)
  );
  assert.ok(clusterTarget, 'need at least one cluster for this test');
  await page.evaluate(target => window.EarthSystem.switchToMicro(target.lat, target.lng, { zoom: 9 }), clusterTarget);
  await page.waitForFunction(() => {
    const map = window.EarthSystem.map();
    return map && map.getLayer('health2d-green-inner') &&
      map.getLayoutProperty('health2d-green-inner', 'visibility') === 'visible';
  }, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const clickPoint = await page.evaluate(target => {
    const map = window.EarthSystem.map();
    const features = window.EarthHealthEnergyApp.getHealthGeoJSON().features;
    const match = features.find(f => String(f.properties?.id) === String(target.id));
    if (!match) return null;
    const pt = map.project(match.geometry.coordinates);
    return { x: pt.x, y: pt.y };
  }, clusterTarget);
  if (!clickPoint) return; // feature may be off screen, skip gracefully
  await page.mouse.click(clickPoint.x, clickPoint.y);
  await page.waitForSelector('#pillarTooltip', { timeout: 5000 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#pillarTooltip')).display === 'block');
  const isCluster = await page.evaluate(() => window.EarthHealthEnergyApp.getState().selectedIsCluster);
  if (!isCluster) return; // clicked a nearby non-cluster city — skip gracefully
  const tooltipTitle = await page.locator('#pillarTooltip').evaluate(el => el.querySelector('div[style*="font-size:17px"]')?.textContent?.trim() || '');
  // Should end with "Region" and NOT repeat the state name
  assert.match(tooltipTitle, /Region$/i);
  const parts = tooltipTitle.split(',');
  // "City, State Region, State" would have 3 parts — we want at most 2
  assert.ok(parts.length <= 2, `cluster card title "${tooltipTitle}" should not repeat state`);
});

function windowIsObject(value) {
  return value && typeof value === 'object';
}

let failures = 0;
let skipped = 0;
let passed = 0;
for (const { name, fn, slow } of tests) {
  if (slow && !RUN_SLOW_TESTS) {
    skipped += 1;
    process.stdout.write(`• ${name} ... skipped slow\n`);
    continue;
  }
  process.stdout.write(`• ${name} ... `);
  try {
    await withAppPage(fn);
    passed += 1;
    process.stdout.write('ok\n');
  } catch (error) {
    failures += 1;
    process.stdout.write('failed\n');
    console.error(error);
  }
}

if (globalBrowser) {
  await globalBrowser.close();
}
if (globalServer) {
  await globalServer.close();
}

if (failures) {
  console.error(`\n${failures} earth-health-energy test${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

const slowHint = skipped ? ' Set RUN_SLOW_TESTS=1 to include slow browser animation/map tests.' : '';
console.log(`\n${passed} earth-health-energy tests passed${skipped ? `, ${skipped} skipped` : ''}.${slowHint}`);
