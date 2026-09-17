import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium as playwright } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

let server: ViteDevServer;
let browser: Browser;
let baseUrl: string;
let libraryDir: string;
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = fileURLToPath(new URL('./artifacts/', import.meta.url));

before(async () => {
  process.env.NODE_ENV = 'development';
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    configFile: false, root, plugins: [react(), tailwindcss()], logLevel: 'error',
    css: { postcss: { plugins: [] } },
    server: { port: 0, host: '127.0.0.1' },
  });
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
  // Off Linux (Windows/macOS dev machines) the bundled Chromium cannot run: use a locally installed Chrome or Edge.
  // Override with BROWSER_PATH if it lives somewhere else.
  if (process.platform !== 'linux') {
    const candidates = [process.env.BROWSER_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean) as string[];
    const { existsSync } = await import('node:fs');
    const executablePath = candidates.find((path) => existsSync(path));
    assert.ok(executablePath, 'No local Chrome or Edge found; set BROWSER_PATH.');
    browser = await playwright.launch({ executablePath, headless: true, args: ['--disable-gpu'] });
    return;
  }
  // Use the browser package's bundled Linux libraries in minimal CI images, too.
  libraryDir = await mkdtemp(join(tmpdir(), 'marble-browser-libs-'));
  const archive = await readFile(join(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
  const extraction = spawnSync('tar', ['-xf', '-', '-C', libraryDir], { input: brotliDecompressSync(archive) });
  assert.equal(extraction.status, 0, 'Could not extract bundled browser libraries.');
  chromium.setGraphicsMode = false;
  browser = await playwright.launch({
    args: [...chromium.args.filter((arg) => !['--single-process', '--in-process-gpu'].includes(arg)), '--disable-gpu'], executablePath: await chromium.executablePath(), headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: `${libraryDir}/lib:${libraryDir}/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}`, FONTCONFIG_PATH: join(tmpdir(), 'fonts') },
  });
}, { timeout: 60000 });

after(async () => { await browser?.close(); await server?.close(); if (libraryDir) await rm(libraryDir, { recursive: true, force: true }); });

async function ready(page: Page, path = '/') {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3500))]));
}

test('Browser: garage controls preserve budget and select the actual circuit', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    assert.ok(await page.getByRole('heading', { name: 'MARBLE RUN. RUMBLE.' }).isVisible());
    await page.getByRole('button', { name: 'Pause circuit preview' }).click();
    await page.screenshot({ path: `${artifacts}/garage-desktop.png`, fullPage: true });
    await page.getByRole('slider', { name: 'Weight', exact: true }).focus();
    await page.keyboard.press('End');
    const values = await page.locator('.stat-control input').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
    assert.equal(values[0], 10);
    assert.equal(values.reduce((a, b) => a + b, 0), 15);
    await page.getByRole('button', { name: 'Glacier livery' }).click();
    assert.equal(await page.getByRole('button', { name: 'Glacier livery' }).getAttribute('aria-pressed'), 'true');
    await page.locator('.circuit-selector button').nth(1).click();
    assert.equal(await page.locator('#circuit-title').textContent(), 'MONTE PIPO');
    await page.getByRole('button', { name: 'Quick race', exact: true }).click();
    await page.getByRole('button', { name: "LIGHTS OUT. LET'S RACE." }).click();
    await page.waitForSelector('.race-canvas');
    assert.match(await page.locator('.race-event').textContent() ?? '', /Monte Pipo/);
    await page.getByRole('button', { name: 'Pause race', exact: true }).click();
    await page.waitForSelector('#pause-title');
    const clock = await page.locator('.race-clock strong').textContent();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('.race-clock strong').textContent(), clock, 'Pause did not stop the clock.');
    await page.getByRole('button', { name: 'Back to the race' }).click();
    await page.waitForTimeout(5200);
    await page.screenshot({ path: `${artifacts}/race-desktop.png`, timeout: 12000, animations: 'disabled' });
    const boxes = await page.locator('.race-topbar,.race-stage,.race-dashboard').evaluateAll((elements) => elements.map((e) => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }));
    assert.ok(boxes[0].bottom <= boxes[1].top + 1 && boxes[1].bottom <= boxes[2].top + 1, 'HUD overlaps the race canvas.');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Browser: mobile layout stays in-bounds and controls remain usable', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    await page.getByRole('button', { name: 'Pause circuit preview' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Garage overflows on mobile.');
    await page.screenshot({ path: `${artifacts}/garage-mobile.png`, fullPage: true });
    await page.getByRole('button', { name: 'Quick race', exact: true }).click();
    await page.getByRole('button', { name: "LIGHTS OUT. LET'S RACE." }).click();
    await page.waitForSelector('.race-canvas');
    assert.ok(await page.getByRole('button', { name: 'Nudge left', exact: true }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Nudge right', exact: true }).isVisible());
    assert.equal(await page.locator('.inventory-slot').count(), 8);
    assert.ok(await page.getByLabel('Circuit minimap', { exact: true }).isVisible());
    await page.getByRole('button', { name: 'Collapse minimap' }).click();
    assert.equal(await page.locator('.minimap-svg').count(), 0);
    await page.getByRole('button', { name: 'Expand minimap' }).click();
    assert.ok(await page.locator('.minimap-svg').isVisible());
    const slots = await page.locator('.inventory-slot').evaluateAll((elements) => elements.map((e) => { const rect = e.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }; }));
    assert.ok(slots.every((b) => b.left >= 0 && b.right <= 391 && b.bottom <= 845), 'An inventory slot is off-screen on mobile.');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Race HUD overflows on mobile.');
    await page.waitForTimeout(5500);
    const left = page.getByRole('button', { name: 'Nudge left', exact: true });
    const bounds = await left.boundingBox();
    assert.ok(bounds);
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.screenshot({ path: `${artifacts}/race-mobile.png` });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Browser: results have readable contrast, real finish times and accessible actions', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 940 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await ready(page, '/tests/ui-fixture.html');
    assert.equal(await page.locator('.results-table tbody tr').count(), 10);
    assert.equal(await page.locator('.player-result .classification-points').textContent(), '+10');
    assert.equal(await page.locator('.dnf-label').count(), 0);
    const colors = await page.locator('.results-title').evaluate((el) => ({ text: getComputedStyle(el).color, background: getComputedStyle(document.querySelector('.results-panel')!).backgroundColor }));
    const luminance = (rgb: string) => {
      const values = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((c) => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    };
    assert.ok((luminance(colors.text) + .05) / (luminance(colors.background) + .05) >= 7, 'Results title fails AAA contrast.');
    await page.screenshot({ path: `${artifacts}/results-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.getByRole('button', { name: 'Standings & next heat' }).isVisible());
    await page.screenshot({ path: `${artifacts}/results-mobile.png` });
    await ready(page, '/tests/ui-fixture.html?dnf');
    assert.equal(await page.locator('.player-result .classification-points').textContent(), '0');
    assert.equal(await page.locator('.player-result .dnf-label').textContent(), 'DNF');
  } finally { await context.close(); }
});

test('Browser: a complete long heat pays winnings and the saved season advances correctly', { timeout: 240000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => { let s = 42; Math.random = () => { s = Math.imul(s, 1664525) + 1013904223 | 0; return (s >>> 0) / 4294967296; }; });
    await page.addInitScript(() => {
      // Render at 20 Hz in this long browser test; the game still simulates at its real 120 Hz.
      window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 50);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    });
    await ready(page);
    await page.getByRole('button', { name: 'START CHAMPIONSHIP', exact: true }).click();
    await page.waitForSelector('.next-event');
    await page.screenshot({ path: `${artifacts}/championship-desktop.png`, fullPage: true });
    await page.clock.install();
    await page.getByRole('button', { name: 'START HEAT 1', exact: true }).click();
    for (let i = 0; i < 55 && await page.locator('.results-panel').count() === 0; i++) await page.clock.runFor(10000);
    await page.waitForSelector('.results-panel', { timeout: 5000 });
    assert.equal(await page.locator('.results-table tbody tr').count(), 10);
    assert.equal(await page.locator('.dnf-label').count(), 0, 'Race cut off while marbles were still on track.');
    const saved = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-season-v1' || k.endsWith(':mrr-season-v1'))![1]));
    assert.equal(saved.results[0].length, 1, 'Finished heat was not saved immediately.');
    const paid = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    assert.ok(paid.credits > 400, 'Finishing did not pay race winnings.');
    assert.equal(paid.paidRaces.length, 1, 'Race payout was recorded multiple times.');
    assert.ok(await page.locator('.race-payout').isVisible());
    await page.getByRole('button', { name: 'Standings & next heat' }).click();
    await page.waitForSelector('.next-event');
    assert.ok(await page.getByRole('button', { name: 'START HEAT 2', exact: true }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Setup locked', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Constructors', exact: true }).click();
    assert.equal(await page.locator('.constructor-list li').count(), 5);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue season', exact: true }).click();
    assert.ok(await page.getByRole('button', { name: 'START HEAT 2', exact: true }).isVisible());
    assert.equal((await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-season-v1' || k.endsWith(':mrr-season-v1'))![1]))).seed, saved.seed);
    assert.equal((await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]))).credits, paid.credits, 'Returning to the paddock or reloading duplicated the payout.');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Browser: shop purchases persist, number keys spend only selected items, and quitting pays nothing', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    await page.getByRole('button', { name: /Open pit shop/ }).click();
    assert.equal(await page.locator('.shop-item').count(), 8);
    await page.getByRole('button', { name: 'Buy Speed boost for 90 credits', exact: true }).click();
    await page.getByRole('button', { name: 'Buy Speed boost for 90 credits', exact: true }).click();
    await page.getByRole('button', { name: 'Buy Jump for 65 credits', exact: true }).click();
    await page.getByRole('button', { name: 'Buy Slipstream for 75 credits', exact: true }).click();
    let account = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    assert.equal(account.credits, 80);
    assert.equal(account.inventory.rocket, 2);
    assert.ok(await page.getByRole('button', { name: 'Buy Shockwave for 100 credits', exact: true }).isDisabled());
    await page.screenshot({ path: `${artifacts}/pit-shop-desktop.png` });
    await page.getByRole('button', { name: 'Loadout ready', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' });
    assert.ok(await page.getByRole('button', { name: 'Open pit shop, 80 credits', exact: true }).isVisible());
    await page.getByRole('button', { name: 'Pause circuit preview', exact: true }).click();
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.getByRole('button', { name: 'Quick race', exact: true }).click();
    await page.getByRole('button', { name: "LIGHTS OUT. LET'S RACE." }).click();
    assert.equal(await page.locator('.inventory-slot').count(), 8);
    assert.ok(await page.locator('.inventory-slot').first().isDisabled(), 'Item could be spent on the start grid.');
    await page.clock.runFor(5300);
    account = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    const initialBoost = account.inventory.rocket;
    await page.keyboard.press('1');
    const afterBoost = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    assert.equal(afterBoost.inventory.rocket, initialBoost - 1);
    assert.equal(afterBoost.inventory.jump, account.inventory.jump);
    await page.clock.runFor(100);
    assert.ok(await page.locator('.inventory-slot').nth(0).getAttribute('class').then((c) => c?.includes('effect-active')));
    await page.clock.runFor(500);
    for (let i = 0; i < 8 && await page.locator('.inventory-slot').nth(1).isDisabled(); i++) await page.clock.runFor(500);
    const beforeJump = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    await page.keyboard.press('2');
    const afterJump = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    assert.equal(afterJump.inventory.jump, beforeJump.inventory.jump - 1);
    await page.clock.runFor(500);
    for (let i = 0; i < 8 && await page.locator('.inventory-slot').nth(5).isDisabled(); i++) await page.clock.runFor(500);
    const beforeAero = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    await page.keyboard.press('6');
    const afterAero = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    assert.equal(afterAero.inventory.aero, beforeAero.inventory.aero - 1);
    await page.clock.runFor(100);
    const used = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    await page.screenshot({ path: `${artifacts}/inventory-toolbar-desktop.png`, animations: 'disabled' });
    await page.keyboard.press('p');
    const timer = await page.locator('.inventory-slot').nth(5).getAttribute('aria-label');
    await page.clock.runFor(2000);
    assert.equal(await page.locator('.inventory-slot').nth(5).getAttribute('aria-label'), timer, 'Pause failed to stop item timers.');
    await page.getByRole('button', { name: 'Return to paddock', exact: true }).click();
    await page.getByRole('button', { name: 'Leave heat', exact: true }).click();
    const exited = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    assert.equal(exited.credits, 80);
    assert.equal(exited.paidRaces.length, 0);
    assert.equal(exited.inventory.rocket, used.inventory.rocket, 'Leaving refunded a spent item.');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});