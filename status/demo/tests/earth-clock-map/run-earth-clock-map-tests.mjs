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

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
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

async function withClockPage(testBody) {
  const server = await startStaticServer(demoRoot);
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: chromeExecutablePath()
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1
  });
  const pageErrors = [];
  const failedRequests = [];

  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('requestfailed', request => {
    const url = request.url();
    if (!url.includes('tile.openstreetmap.org')) failedRequests.push(`${request.failure()?.errorText || 'failed'} ${url}`);
  });
  await page.route('https://tile.openstreetmap.org/**', route => {
    route.fulfill({ status: 200, contentType: 'image/png', body: transparentPng });
  });

  try {
    await page.goto(`${server.baseUrl}/earth-clock-map/earth_clock_map.html?v=test`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      window.EarthSystem &&
      window.GeoNames &&
      window.EarthClockMapApp &&
      window.EarthClockMapApp.getState().cityCount > 200000,
    null, { timeout: 45000 });
    await page.waitForTimeout(250);
    await testBody({ page, baseUrl: server.baseUrl, pageErrors, failedRequests });
    assert.deepEqual(pageErrors, [], 'page should not throw uncaught errors');
    assert.deepEqual(failedRequests, [], 'page should not have failed non-tile requests');
  } finally {
    await browser.close();
    await server.close();
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function appState(page) {
  return page.evaluate(() => window.EarthClockMapApp.getState());
}

test('boots with earth-core, shared GeoNames, and full clock-map chrome', async ({ page }) => {
  const state = await appState(page);
  const chrome = await page.evaluate(() => ({
    hasGeoNames: !!window.GeoNames,
    hasEarthSystem: !!window.EarthSystem,
    scripts: Array.from(document.scripts).map(script => script.src),
    status: document.querySelector('#statusChip').textContent,
    dayTitle: document.querySelector('.clock-card:first-child .clock-title').textContent,
    seasonTitle: document.querySelectorAll('.clock-title')[1].textContent,
    coordinateTitle: document.querySelector('.coordinate-card .clock-title').textContent,
    estc: document.querySelector('#estcFullLabel').textContent,
    wstc: document.querySelector('#wstcFullLabel').textContent,
    pZero: document.querySelector('#pZeroButton').textContent
  }));

  assert.equal(chrome.hasGeoNames, true);
  assert.equal(chrome.hasEarthSystem, true);
  assert.equal(state.cityCount, 233259);
  assert.match(state.selectedCity, /Panjim|Goa/i);
  assert.match(chrome.status, /233,259 cities/);
  assert.match(chrome.scripts.join('\n'), /\/shared\/geonames\.js\?v=2/);
  assert.match(chrome.dayTitle, /Day Arc|Night Arc/);
  assert.equal(chrome.seasonTitle, 'Season Arc');
  assert.equal(chrome.coordinateTitle, 'Earth Space Time Coordinate');
  assert.match(chrome.estc, /^Y\d+, O\d+, P\d+\.\d{2}°/);
  assert.match(chrome.wstc, /^G\d+\.\d+°, S\d+\.\d{2}°, P\d+\.\d{2}°/);
  assert.match(chrome.pZero, /Earth under P0/);
});

test('city selection updates local arcs and coordinate labels', async ({ page }) => {
  const selected = await page.evaluate(() => window.EarthClockMapApp.selectCityByName('Mexico City'));
  assert.match(selected, /Mexico City/i);
  await page.waitForFunction(() => /Mexico City/i.test(window.EarthClockMapApp.getState().selectedCity));

  const state = await appState(page);
  const labels = await page.evaluate(() => ({
    input: document.querySelector('#citySearch').value,
    status: document.querySelector('#statusChip').textContent,
    dayMeta: document.querySelector('#dayNightMeta').textContent,
    dayValue: document.querySelector('#dayNightValue').textContent,
    seasonValue: document.querySelector('#seasonValue').textContent,
    estc: document.querySelector('#estcFullLabel').textContent,
    wstc: document.querySelector('#wstcFullLabel').textContent,
    focus: document.querySelector('#coordinateFocusLabel').textContent
  }));

  assert.match(state.selectedCity, /Mexico City/i);
  assert.match(labels.input, /Mexico City/i);
  assert.match(labels.status, /Mexico City/i);
  assert.match(labels.dayMeta, /Mexico City/i);
  assert.match(labels.dayValue, /^T\d+\.\d{2} \| P\d+\.\d{2}°$/);
  assert.match(labels.seasonValue, /^O\d+$/);
  assert.match(labels.estc, /E\d+\.\d{3}°/);
  assert.match(labels.wstc, /S\d+\.\d{2}°/);
  assert.match(labels.focus, /Mexico City/i);
  assert.ok(state.lastClock?.wstc?.P >= 0 && state.lastClock.wstc.P < 360);
});

test('city search suggestions support keyboard selection and clearing', async ({ page }) => {
  await page.fill('#citySearch', 'Victoria');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#citySuggestions')).display === 'block');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Victoria/i.test(window.EarthClockMapApp.getState().selectedCity));
  assert.match(await page.locator('#citySearch').inputValue(), /Victoria/i);

  await page.click('#clearCity');
  assert.equal(await page.locator('#citySearch').inputValue(), '');
  assert.equal(await page.locator('#citySuggestions').evaluate(el => getComputedStyle(el).display), 'none');
});

test('zero epoch control changes the clock source and reset restores default epoch', async ({ page }) => {
  await page.locator('#zeroEpochInput').evaluate(el => {
    el.value = '2026-05-25T00:00';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.EarthClockMapApp.getState().lastClock?.input?.epochUTC === '2026-05-25T00:00:00.000Z');
  let state = await appState(page);
  assert.equal(state.lastClock.input.epochUTC, '2026-05-25T00:00:00.000Z');

  await page.click('#resetEpochButton');
  await page.waitForFunction(() => window.EarthClockMapApp.getState().lastClock?.input?.epochUTC === '1974-03-13T04:40:00.000Z');
  state = await appState(page);
  assert.equal(state.lastClock.input.epochUTC, '1974-03-13T04:40:00.000Z');
});

test('P0 button emits a globe fly-to-location workflow', async ({ page }) => {
  await page.evaluate(() => {
    window.__pZeroFlights = [];
    window.EarthSystem.on('flytolocation', event => window.__pZeroFlights.push(event.detail));
  });
  await page.click('#pZeroButton');
  await page.waitForFunction(() => window.__pZeroFlights.length === 1);
  const event = await page.evaluate(() => window.__pZeroFlights[0]);
  assert.ok(Math.abs(event.lat) <= 90);
  assert.ok(Math.abs(event.lng) <= 180);
  assert.equal(await page.evaluate(() => window.EarthSystem.getState().target), 'earth');
});

test('target selector swaps Earth, Moon, Mars, and Sun coordinate views', async ({ page }) => {
  const targets = [
    ['moon', /Moon Space Time Coordinate/, /Moon zero/],
    ['mars', /Mars Space Time Coordinate/, /Mars zero/],
    ['sun', /Earth Space Time Coordinate/, null],
    ['earth', /Earth Space Time Coordinate/, null]
  ];

  for (const [target, titlePattern, metaPattern] of targets) {
    await page.click('#target-btn');
    await page.click(`.dropdown-item[data-target="${target}"]`);
    await page.waitForFunction(name => window.EarthSystem.getState().target === name, target, { timeout: 5000 });
    await page.waitForTimeout(target === 'sun' ? 3300 : 2600);
    const labels = await page.evaluate(() => ({
      title: document.querySelector('.coordinate-card .clock-title').textContent,
      meta: document.querySelector('#wstcMeta').textContent,
      active: document.querySelector('.dropdown-item.active')?.dataset.target
    }));
    assert.equal(labels.active, target);
    assert.match(labels.title, titlePattern);
    if (metaPattern) assert.match(labels.meta, metaPattern);
  }
});

let failures = 0;
for (const { name, fn } of tests) {
  process.stdout.write(`• ${name} ... `);
  try {
    await withClockPage(fn);
    process.stdout.write('ok\n');
  } catch (error) {
    failures += 1;
    process.stdout.write('failed\n');
    console.error(error);
  }
}

if (failures) {
  console.error(`\n${failures} earth-clock-map test${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

console.log(`\n${tests.length} earth-clock-map tests passed.`);
