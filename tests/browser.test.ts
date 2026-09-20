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

/** Dismiss the boot loading screen if it is up (fixture pages have none). */
async function dismissGate(page: Page) {
  await page.getByRole('button', { name: /Enter the paddock|Lights out/ }).click({ timeout: 9000 }).catch(() => { /* no gate on this page */ });
}

/**
 * Dismiss the "What's new" dialog. It is shown once per app version and every run starts from a
 * brand-new browser profile, so it is always up on the first load — and it is modal, so nothing
 * in the garage can be clicked until it is gone (a click just lands on the backdrop).
 */
async function dismissWhatsNew(page: Page) {
  await page.getByRole('button', { name: "Let's race" }).click({ timeout: 9000 }).catch(() => { /* not this load */ });
}

async function ready(page: Page, path = '/') {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3500))]));
  await dismissGate(page);
  await dismissWhatsNew(page);
}

test('Browser: garage controls preserve budget and select the actual circuit', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    assert.ok(await page.locator('#circuit-title').isVisible(), 'Garage did not reach the circuit pane.');
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
    await page.getByRole('button', { name: 'LIGHTS OUT', exact: true }).click();
    await dismissGate(page);
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
    // The garage is tabbed on mobile: the live preview lives in the Circuit pane.
    await page.getByRole('button', { name: 'Circuit', exact: true }).click();
    await page.getByRole('button', { name: 'Pause circuit preview' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Garage overflows on mobile.');
    await page.screenshot({ path: `${artifacts}/garage-mobile.png`, fullPage: true });
    await page.getByRole('button', { name: 'Quick race', exact: true }).click();
    await page.getByRole('button', { name: 'LIGHTS OUT', exact: true }).click();
    await dismissGate(page);
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

// A whole heat, at a fake clock, in a real browser: a Marblehurst heat is some seven minutes of
// race clock on today's three-times-longer circuits, and driving the page's fake clock through it
// costs a little over seven minutes of wall time even with the page rendering at 10 Hz — the
// frames are cheap, the simulation they span is not. The budget is twice the measured run so the
// test still passes on a loaded machine (it is the long pole of the whole suite).
test('Browser: a complete long heat pays winnings and the saved season advances correctly', { timeout: 900000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 900, height: 560 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => { let s = 42; Math.random = () => { s = Math.imul(s, 1664525) + 1013904223 | 0; return (s >>> 0) / 4294967296; }; });
    await page.addInitScript(() => {
      // Render at 10 Hz in this long browser test; the game still simulates at its real 120 Hz
      // (the loop drains as many steps as a frame spans — frames only cost wall time).
      window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 100);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    });
    await ready(page);
    await page.getByRole('button', { name: 'START CHAMPIONSHIP', exact: true }).click();
    await page.waitForSelector('.next-event');
    await page.screenshot({ path: `${artifacts}/championship-desktop.png`, fullPage: true });
    await page.clock.install();
    await page.getByRole('button', { name: 'START HEAT 1', exact: true }).click();
    await dismissGate(page);
    for (let i = 0; i < 80 && await page.locator('.results-panel').count() === 0; i++) await page.clock.runFor(10000);
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
    assert.ok(await page.getByRole('button', { name: 'Locked', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Constructors', exact: true }).click();
    assert.equal(await page.locator('.constructor-list li').count(), 5);
    await page.reload({ waitUntil: 'networkidle' });
    await dismissGate(page);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
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
    await dismissGate(page);
    assert.ok(await page.getByRole('button', { name: 'Open pit shop, 80 credits', exact: true }).isVisible());
    await page.getByRole('button', { name: 'Pause circuit preview', exact: true }).click();
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.getByRole('button', { name: 'Quick race', exact: true }).click();
    await page.getByRole('button', { name: 'LIGHTS OUT', exact: true }).click();
    // The virtual clock is paused, so wind it past the loading gate's minimum duration.
    await page.clock.runFor(3400);
    await page.getByRole('button', { name: 'Lights out', exact: true }).click();
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
test('Browser: template dialog blocks editor shortcuts and preserves the saved group', { timeout: 60000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const draft = () => page.evaluate(() => (window as any).templateFixture.readDraft());
  const shortcuts = ['Delete', 'Backspace', 'm', 'r', 'Shift+r', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Control+z', 'Control+y', 'Control+Shift+z', 'Control+d', 'Control+c', 'Control+v'];
  try {
    await page.goto(`${baseUrl}/tests/editor-template-fixture.html`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Two walls', exact: true }).click();
    const canvas = page.locator('.editor-canvas');
    const box = await canvas.boundingBox();
    assert.ok(box);
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForFunction(() => (window as any).templateFixture.readDraft().pieces.length === 2);
    const before = await draft();
    assert.equal(before.pieces[1].x - before.pieces[0].x, 200);
    assert.match(await page.locator('.editor-status').textContent() ?? '', /2 selected/);

    await page.getByRole('button', { name: 'Template', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save Template', exact: true });
    await dialog.getByRole('textbox').fill('Keyboard-safe walls');
    const icon = dialog.locator('button[title]').first();
    await icon.click();
    for (const key of shortcuts) {
      await page.keyboard.press(key);
      assert.deepEqual(await draft(), before, `${key} changed the map behind the dialog`);
      assert.match(await page.locator('.editor-status').textContent() ?? '', /2 selected/);
    }
    // Normal dialog keyboard behaviour is not swallowed by the editor guard.
    await dialog.getByRole('button', { name: 'Save Template', exact: true }).focus();
    await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button', { name: 'Close dialog' }).evaluate(el => el === document.activeElement), true);
    await dialog.getByRole('button', { name: 'Save Template', exact: true }).focus();
    await page.keyboard.press('Enter');
    await dialog.waitFor({ state: 'detached' });
    const saved = await page.evaluate(() => (window as any).templateFixture.getTemplates().find((t: any) => t.name === 'Keyboard-safe walls'));
    assert.equal(saved.version, 2);
    assert.deepEqual(saved.pieces.map((p: any) => [p.x, p.y]), [[-100, 0], [100, 0]]);
    assert.deepEqual(await draft(), before);

    // Reopen, type shortcut letters in the input, then Escape: selection survives.
    await page.getByRole('button', { name: 'Template', exact: true }).click();
    await dialog.getByRole('textbox').fill('m r Delete');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(await draft(), before);
    await page.getByRole('button', { name: 'Template', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(x => (window as any).templateFixture.readDraft().pieces[0].x === x + 1, before.pieces[0].x);
    await page.keyboard.press('Control+z');
    assert.deepEqual(await draft(), before, 'shortcuts should resume after closing the dialog');

    // Other editor modals (including child-owned tutorial) obey the same routing.
    for (const name of ['New track', 'Clear map', 'Tutorial']) {
      await page.getByRole('button', { name, exact: true }).first().click();
      const modal = page.getByRole('dialog');
      await modal.waitFor();
      await modal.getByRole('button').first().focus();
      for (const key of ['Delete', 'm', 'r', 'ArrowRight', 'Control+z']) {
        await page.keyboard.press(key);
        assert.deepEqual(await draft(), before, `${name}: ${key} changed the map`);
      }
      if (name === 'Tutorial') await modal.getByRole('button', { name: 'Dismiss tutorial' }).click();
      else if (name === 'New track') await modal.getByRole('button', { name: /cancel/i }).click();
      else await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'detached' });
    }
    // Insert the newly saved template, not just the seeded fixture template.
    await page.getByRole('button', { name: 'Base Items', exact: true }).click();
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Keyboard-safe walls', exact: true }).click();
    await canvas.hover({ position: { x: box.width * 0.6, y: box.height * 0.7 } });
    await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.7 } });
    await page.waitForFunction(() => (window as any).templateFixture.readDraft().pieces.length === 4);
    const after = await draft();
    assert.deepEqual(after.pieces.slice(0, 2), before.pieces);
    assert.equal(after.pieces[3].x - after.pieces[2].x, 200);
    assert.equal(after.pieces[3].y, after.pieces[2].y);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
});

test('Browser: workshop launchers animate on the correct clock and bridge art follows the deck', { timeout: 60000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${baseUrl}/tests/workshop-art-fixture.html`);
    await page.waitForFunction(() => (window as any).workshopArt?.ready);
    const leftIcon = page.locator('[data-tile="flipper"] img');
    const rightIcon = page.locator('[data-tile="flipper-right"] img');
    await rightIcon.waitFor();
    assert.match(await leftIcon.getAttribute('src') ?? '', /flipper\.png/);
    assert.equal(await leftIcon.getAttribute('src'), await rightIcon.getAttribute('src'));
    assert.equal(await rightIcon.evaluate(img => getComputedStyle(img).transform), 'matrix(-1, 0, 0, 1, 0, 0)');
    const rest = await page.evaluate(() => (window as any).workshopArt.frame(1000));
    await page.screenshot({ path: join(artifacts, 'workshop-art-rest.png') });
    const swing = await page.evaluate(() => (window as any).workshopArt.frame(1640));
    await page.screenshot({ path: join(artifacts, 'workshop-art-swing.png') });
    const draws = (frame: any, name: string) => frame.calls.filter((c: any) => c.name === name);
    assert.equal(draws(swing, 'flipper').length, 2);
    draws(swing, 'flipper').forEach((call: any, i: number) => {
      const expected = swing.expectedFlipper[i];
      assert.ok(Math.abs(Math.sin(call.angle) - Math.sin(expected)) < 1e-9);
      assert.ok(Math.abs(Math.cos(call.angle) - Math.cos(expected)) < 1e-9);
      assert.notDeepEqual(call.matrix, draws(rest, 'flipper')[i].matrix);
    });
    assert.equal(draws(swing, 'catapult_arm').length, 2);
    assert.notDeepEqual(draws(rest, 'catapult_arm'), draws(swing, 'catapult_arm'));
    assert.deepEqual(draws(rest, 'catapult_static'), draws(swing, 'catapult_static'), 'base must not rotate with its arm');
    assert.equal(draws(swing, 'bridge').length, 0, 'never tile a whole bridge sprite on every plank');
    const previewRest = await page.evaluate(() => (window as any).workshopArt.frame(1000, true));
    const previewSwing = await page.evaluate(() => (window as any).workshopArt.frame(110, true));
    assert.ok(previewRest.unchanged && previewSwing.unchanged, 'preview must not change physics or trigger clocks');
    assert.notDeepEqual(draws(previewRest, 'flipper'), draws(previewSwing, 'flipper'));
    await page.evaluate(() => (window as any).workshopArt.frame(1640));
    const beforeSag = await page.locator('canvas').screenshot();
    await page.evaluate(() => (window as any).workshopArt.sagBridge());
    await page.screenshot({ path: join(artifacts, 'workshop-art-sag.png') });
    assert.notDeepEqual(await page.locator('canvas').screenshot(), beforeSag);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
