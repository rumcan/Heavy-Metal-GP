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
    // Its own dependency cache: sharing node_modules/.vite with a running dev server made that server re-bundle and
    // reload the page someone was playing on.
    cacheDir: join(root, 'node_modules/.vite-browser-test'),
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
  } else {
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
  }
  // Warm Vite's dependency optimiser: the very first page load of a cold dev server can take longer
  // than a single test's navigation budget and used to fail whichever test happened to run first.
  const warm = await browser.newPage();
  await warm.goto(baseUrl, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => { /* the tests report real load failures */ });
  await warm.close();
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const ctx = await origNewContext(options);
    ctx.setDefaultTimeout(60000);
    return ctx;
  };
  const origNewPage = browser.newPage.bind(browser);
  browser.newPage = async (options) => {
    const pg = await origNewPage(options);
    pg.setDefaultTimeout(60000);
    return pg;
  };
}, { timeout: 60000 });

after(async () => { await browser?.close(); await server?.close(); if (libraryDir) await rm(libraryDir, { recursive: true, force: true }); });

/** Dismiss the boot loading screen if it is up (fixture pages have none). */
async function dismissGate(page: Page, timeout = 45000) {
  // P2-10b: a race may open on the loadout screen first; keep the bar as it is and go
  const loadoutOrGate = page.getByRole('button', { name: /Same as last time|Enter the paddock|Lights out/ }).first();
  await loadoutOrGate.waitFor({ timeout }).catch(() => { /* no gate on this page */ });
  if (await page.getByRole('button', { name: 'Same as last time' }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Same as last time' }).click();
  await page.getByRole('button', { name: /Enter the paddock|Lights out/ }).click({ timeout }).catch(() => { /* no gate on this page */ });
}

/**
 * Dismiss the "What's new" dialog. It is shown once per app version and every run starts from a
 * brand-new browser profile, so it is always up on the first load — and it is modal, so nothing
 * in the garage can be clicked until it is gone (a click just lands on the backdrop).
 */
async function dismissWhatsNew(page: Page, timeout = 45000) {
  await page.getByRole('button', { name: "Let's race" }).click({ timeout }).catch(() => { /* not this load */ });
}

/** Open a home tab (Story, Championship, Quick race, Online, Workshop). */
async function openTab(page: Page, name: string) {
  // The main menu picks a mode; inside a mode, the header's back button returns to the menu first.
  const back = page.getByRole('button', { name: 'Back to the main menu' });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.getByRole('main', { name: 'Main menu' }).getByRole('button', { name: new RegExp(name, 'i') }).click();
}

async function ready(page: Page, path = '/') {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3500))]));
  if (path === '/') {
    await dismissGate(page);
    await dismissWhatsNew(page);
    await page.getByRole('main', { name: 'Main menu' }).or(page.getByRole('button', { name: 'Back to the main menu' })).first().waitFor({ state: 'visible', timeout: 45000 });
  } else if (path.includes('ui-fixture.html')) {
    await page.locator('.results-table').waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
  }
}

test('Browser: garage controls preserve budget and select the actual circuit', { timeout: 120000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    await openTab(page, 'Quick race');
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
    await page.getByRole('button', { name: 'Race', exact: true }).click();
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

test('Browser: the pause menu restarts the race from the lights', { timeout: 120000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    await openTab(page, 'Quick race');
    await page.getByRole('button', { name: 'Race', exact: true }).click();
    await dismissGate(page);
    await page.waitForSelector('.race-canvas');
    const seconds = async () => { const t = (await page.locator('.race-clock strong').textContent()) ?? ''; const [m, s] = t.split(':'); return Number(m) * 60 + Number(s); };
    await page.waitForFunction(() => { const t = document.querySelector('.race-clock strong')?.textContent ?? '0:00'; const [m, s] = t.split(':'); return Number(m) * 60 + Number(s) > 3; }, undefined, { timeout: 40000 });
    await page.getByRole('button', { name: 'Pause race', exact: true }).click();
    await page.getByRole('button', { name: 'Restart race' }).click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#pause-title').count(), 0, 'the pause menu closed');
    assert.ok(await seconds() < 1, 'the clock is back at the start');
    await page.waitForFunction(() => { const t = document.querySelector('.race-clock strong')?.textContent ?? '0:00'; const [m, s] = t.split(':'); return Number(m) * 60 + Number(s) > 1; }, undefined, { timeout: 40000 });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Browser: knocked out, you watch whoever did it, can fast forward, and the race goes on to the results', { timeout: 180000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    await openTab(page, 'Quick race');
    await page.getByRole('button', { name: 'Race', exact: true }).click();
    await dismissGate(page);
    await page.waitForSelector('.race-canvas');
    await page.waitForFunction(() => (window as any).__race?.gateOpen, undefined, { timeout: 40000 });
    // a rival knocks the player out
    const killer = await page.evaluate(() => { const g = (window as any).__race; const k = g.marbles[3]; g.damage(g.player, 1000, k.info.id, 'wrecker'); return k.info.name; });
    await page.getByText(`Knocked out by ${killer}`).waitFor({ timeout: 5000 });
    assert.equal(await page.locator('.results-panel').count(), 0, 'the race does not end the moment you are out');
    await page.getByRole('button', { name: /Replay speed/ }).click();
    await page.getByRole('button', { name: /Replay speed 2x/ }).waitFor();
    await page.locator('.results-panel').waitFor({ timeout: 150000 });
    assert.ok(await page.locator('.results-table .dnf-label').count() >= 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Browser: the loadout opens before a race; Same as last time keeps the bar; Do not ask skips it next time', { timeout: 150000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    await openTab(page, 'Quick race');
    await page.getByRole('button', { name: 'Race', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'LOADOUT' });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('group', { name: 'Loadout mode' }).count(), 0, 'the bar is the race mode one');
    const before = await dialog.locator('.loadout-slot').allInnerTexts();
    // change a slot, then Same as last time puts it back
    await dialog.getByRole('button', { name: /Clear slot Q/ }).click().catch(() => {});
    await dialog.getByLabel("Don't ask before every race").check();
    await dialog.getByRole('button', { name: 'Same as last time' }).click();
    await page.getByRole('button', { name: /Lights out/i }).click({ timeout: 45000 });
    await page.waitForSelector('.race-canvas');
    await page.getByRole('button', { name: 'Pause race', exact: true }).click();
    await page.getByRole('button', { name: 'Return to paddock' }).click();
    await page.getByRole('button', { name: 'Leave heat' }).click();
    await openTab(page, 'Quick race');
    await page.getByRole('button', { name: 'Pit shop' }).click().catch(() => {});
    const shop = page.getByRole('dialog', { name: 'LOADOUT' });
    await shop.waitFor();
    assert.deepEqual(await shop.locator('.loadout-slot').allInnerTexts(), before, 'Same as last time kept the bar');
    await shop.getByRole('button', { name: 'Done' }).click();
    // asked not to: Race goes straight to the race
    await page.getByRole('button', { name: 'Race', exact: true }).click();
    await page.getByRole('button', { name: /Lights out/i }).waitFor({ timeout: 45000 });
    assert.equal(await page.getByRole('dialog', { name: 'LOADOUT' }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Browser: mobile layout stays in-bounds and controls remain usable', { timeout: 120000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    await openTab(page, 'Quick race');
    // The garage is tabbed on mobile: the live preview lives in the Circuit pane.
    await page.getByRole('button', { name: 'Circuit', exact: true }).click();
    await page.getByRole('button', { name: 'Pause circuit preview' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Garage overflows on mobile.');
    await page.screenshot({ path: `${artifacts}/garage-mobile.png`, fullPage: true });
    await page.getByRole('button', { name: 'Race', exact: true }).click();
    await dismissGate(page);
    await page.waitForSelector('.race-canvas');
    assert.ok(await page.getByRole('button', { name: 'Nudge left', exact: true }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Nudge right', exact: true }).isVisible());
    assert.equal(await page.locator('.inventory-slot').count(), 8);
    assert.ok(await page.getByLabel('Course map', { exact: true }).isVisible());
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

test('Browser: results have readable contrast, real finish times and accessible actions', { timeout: 120000 }, async () => {
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
    await openTab(page, 'Championship');
    await page.getByRole('button', { name: 'Start season', exact: true }).click();
    await page.waitForSelector('.next-event');
    await page.screenshot({ path: `${artifacts}/championship-desktop.png`, fullPage: true });
    await page.clock.install();
    await page.getByRole('button', { name: 'START HEAT 1', exact: true }).click();
    await dismissGate(page);
    for (let i = 0; i < 140 && await page.locator('.results-panel').count() === 0; i++) await page.clock.runFor(10000);
    await page.waitForSelector('.results-panel', { timeout: 5000 });
    assert.equal(await page.locator('.results-table tbody tr').count(), 10);
    // A driver still out 20 s after the most recent finish is classified DNF (and health can knock one out), so DNFs
    // are allowed now; what must never happen is the race ending with nobody home.
    assert.ok(await page.locator('.dnf-label').count() < 10, 'nobody finished the heat');
    const saved = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-season-v1' || k.endsWith(':mrr-season-v1'))![1]));
    assert.equal(saved.results[0].length, 1, 'Finished heat was not saved immediately.');
    const paid = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    // The test driver never steers: it may be classified DNF (20 s after the last finisher) and then earns nothing.
    const youDnf = (await page.locator('.results-table tbody tr', { hasText: 'You' }).innerText()).includes('DNF');
    if (!youDnf) assert.ok(paid.credits > 400, 'Finishing did not pay race winnings.');
    assert.equal(paid.paidRaces.length, 1, 'Race payout was recorded multiple times.');
    assert.ok(await page.locator('.race-payout').isVisible());
    // The first race earns XP: a fresh driver levels up, and the card is modal until it is closed.
    await page.getByRole('dialog', { name: 'LEVEL UP!' }).getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 5000 }).catch(() => { /* no level-up this time */ });
    await page.getByRole('button', { name: 'Standings & next heat' }).click();
    await page.waitForSelector('.next-event');
    assert.ok(await page.getByRole('button', { name: 'START HEAT 2', exact: true }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Locked', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Constructors', exact: true }).click();
    assert.equal(await page.locator('.constructor-list li').count(), 5);
    await page.reload({ waitUntil: 'networkidle' });
    await dismissGate(page);
    await openTab(page, 'Championship');
    await page.getByRole('button', { name: 'Continue season', exact: true }).click();
    await page.getByRole('button', { name: 'START HEAT 2', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    assert.ok(await page.getByRole('button', { name: 'START HEAT 2', exact: true }).isVisible());
    assert.equal((await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-season-v1' || k.endsWith(':mrr-season-v1'))![1]))).seed, saved.seed);
    assert.equal((await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]))).credits, paid.credits, 'Returning to the paddock or reloading duplicated the payout.');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Browser: shop purchases persist, number keys spend only selected items, and quitting pays nothing', { timeout: 120000 }, async () => {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await ready(page);
    await page.getByRole('button', { name: /Open pit shop/ }).click();
    const loadout = page.getByRole('dialog', { name: 'LOADOUT' });
    await loadout.waitFor();
    assert.equal(await loadout.locator('.loadout-slot').count(), 8);
    // The pit shop is folded into the Loadout screen: every slotted skill has a "+1" buy button.
    const buy = (skill: string) => loadout.locator('.loadout-slot').filter({ has: page.getByRole('button', { name: new RegExp(`^Slot \\w: ${skill},`) }) }).getByRole('button', { name: /^\+1/ });
    await buy('Speed boost').click();
    await buy('Speed boost').click();
    await buy('Jump').click();
    await buy('Slipstream').click();
    let account = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k === 'mrr-account-v1' || k.endsWith(':mrr-account-v1'))![1]));
    assert.equal(account.credits, 80);
    assert.equal(account.inventory.rocket, 2);
    assert.ok(await buy('Shockwave').isDisabled());
    await page.screenshot({ path: `${artifacts}/pit-shop-desktop.png` });
    await loadout.getByRole('button', { name: 'Done', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await dismissGate(page);
    await page.getByRole('button', { name: 'Open pit shop, 80 credits', exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    assert.ok(await page.getByRole('button', { name: 'Open pit shop, 80 credits', exact: true }).isVisible());
    await openTab(page, 'Quick race');
    await page.getByRole('button', { name: 'Pause circuit preview', exact: true }).click();
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.getByRole('button', { name: 'Race', exact: true }).click();
    await page.getByRole('button', { name: 'Same as last time' }).click(); // P2-10b: the loadout asks first
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
test('Browser: template dialog blocks editor shortcuts and preserves the saved group', { timeout: 120000 }, async () => {
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
    // The editor saves its draft after a pause (not per edit), so wait for the undo to land in storage.
    await page.waitForFunction(x => (window as any).templateFixture.readDraft().pieces[0].x === x, before.pieces[0].x);
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
      else if (name === 'New track') await modal.getByRole('button', { name: 'Close', exact: true }).click();
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

test('Browser: workshop launchers animate on the correct clock and bridge art follows the deck', { timeout: 120000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${baseUrl}/tests/workshop-art-fixture.html`);
    await page.waitForFunction(() => (window as any).workshopArt?.ready);
    const leftIcon = page.locator('[data-tile="flipper"] img');
    const rightIcon = page.locator('[data-tile="flipper-right"] img');
    await rightIcon.waitFor();
    assert.match(await leftIcon.getAttribute('src') ?? '', /flipper\.(png|webp)/);
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

test('Browser: War Drum uses the supplied artwork and the Updraft gust is vector chevrons', { timeout: 120000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${baseUrl}/tests/workshop-art-fixture.html?drum-wind`);
    await page.waitForFunction(() => (window as any).workshopArt?.ready);
    const button = page.locator('[data-tile="sling"]');
    await button.waitFor();
    assert.match(await button.textContent() ?? '', /War Drum/);
    assert.match(await button.locator('img').getAttribute('src') ?? '', /sling\.webp/);
    assert.equal(await page.locator('.prop-head strong').textContent(), 'WAR DRUM');
    const first = await page.evaluate(() => (window as any).workshopArt.frame(1000, true));
    await page.screenshot({ path: join(artifacts, 'war-drum-updraft.png') });
    const later = await page.evaluate(() => (window as any).workshopArt.frame(1600, true));
    await page.screenshot({ path: join(artifacts, 'war-drum-updraft-pulse.png') });
    assert.ok(first.unchanged && later.unchanged, 'art must not mutate obstacle bodies or forces');
    const draws = (frame: any, name: string) => frame.calls.filter((c: any) => c.name === name);
    assert.equal(draws(first, 'sling').length, 3, 'all sizes and mirrored drums use supplied image');
    assert.ok(draws(first, 'sling')[1].rect[2] > draws(first, 'sling')[0].rect[2], 'size setting scales drum art');
    const vents = draws(first, 'wind');
    assert.equal(vents.length, 2);
    vents.forEach((vent: any) => {
      assert.equal(vent.rect[2], 112, 'vent is four times wider than the old 28px sprite');
      assert.equal(vent.rect[3], 80);
      assert.equal(vent.opacity, 1, 'machine stays opaque');
    });
    // The Updraft's gust is drawn as vector chevrons (intentional), not a dust sprite.
    assert.equal(draws(first, 'wind-dust').length, 0, 'the gust is vector chevrons, not the dust sprite');
    assert.equal(draws(later, 'wind-dust').length, 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Browser: canvas settings cog opens the selected piece dialog without moving it', { timeout: 120000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  try {
    // Record the rendered cog centre so the test clicks its actual canvas hit target.
    await page.addInitScript(() => {
      const arc = CanvasRenderingContext2D.prototype.arc;
      CanvasRenderingContext2D.prototype.arc = function (x, y, radius, start, end, anticlockwise) {
        if (this.canvas.classList.contains('editor-canvas') && radius === 4.5) {
          (window as any).settingsCog = { x, y };
        }
        return arc.call(this, x, y, radius, start, end, anticlockwise);
      };
    });
    await page.goto(`${baseUrl}/tests/editor-template-fixture.html`, { waitUntil: 'networkidle' });
    await page.locator('[data-tile="conveyor"]').click();
    const canvas = page.locator('.editor-canvas');
    const box = await canvas.boundingBox();
    assert.ok(box);
    const centre = { x: box.width / 2, y: box.height / 2 };
    await canvas.click({ position: centre });
    await page.waitForFunction(() => (window as any).templateFixture.readDraft().pieces.length === 1);
    await page.keyboard.press('Escape');
    await canvas.click({ position: centre });
    await page.waitForFunction(() => (window as any).settingsCog);
    const before = await page.evaluate(() => (window as any).templateFixture.readDraft());
    const cog = await page.evaluate(() => (window as any).settingsCog);
    await canvas.click({ position: cog });
    const dialog = page.getByRole('dialog', { name: 'Conveyor belt settings', exact: true });
    await dialog.waitFor();
    assert.deepEqual(await page.evaluate(() => (window as any).templateFixture.readDraft()), before);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await canvas.click({ position: cog });
    await dialog.waitFor();
  } finally { await page.close(); }
});

test('Browser: Workshop loop shows its entry and exit route', { timeout: 120000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(`${baseUrl}/tests/workshop-art-fixture.html?loop`);
    await page.waitForFunction(() => (window as any).workshopArt?.ready);
    const frame = await page.evaluate(() => (window as any).workshopArt.frame(1000, true));
    assert.ok(frame.unchanged);
    await page.screenshot({ path: join(artifacts, 'workshop-loop-route.png') });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

// P2-23: the three screens the garage opens — Loadout (the pit shop folded in), Talents and the Ball customizer —
// at phone portrait (375 px) and on the desktop.
const SCREEN_VIEWPORTS = [
  { label: 'phone 375', options: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  { label: 'desktop', options: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 } },
] as const;

/** A modal must fit the screen: inside the viewport horizontally and no page-wide horizontal scroll. */
async function assertDialogFits(page: Page, name: string) {
  const box = await page.getByRole('dialog', { name }).boundingBox();
  assert.ok(box);
  const width = page.viewportSize()!.width;
  assert.ok(box.x >= -1 && box.x + box.width <= width + 1, `${name} dialog overflows the ${width}px screen.`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} makes the page scroll sideways.`);
}

for (const { label, options } of SCREEN_VIEWPORTS) {
  const slug = label.replace(' ', '-');

  test(`Browser: Loadout screen picks skills for the keys and sells charges (${label})`, { timeout: 120000 }, async () => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await ready(page);
      await page.getByRole('button', { name: /Open pit shop/ }).click();
      const loadout = page.getByRole('dialog', { name: 'LOADOUT' });
      await loadout.waitFor();
      await assertDialogFits(page, 'LOADOUT');
      assert.equal(await loadout.locator('.loadout-slot').count(), 8);
      // Every mode keeps its own bar.
      for (const mode of ['Quick', 'Championship', 'Story', 'Online']) {
        await loadout.getByRole('button', { name: mode, exact: true }).click();
        assert.equal(await loadout.getByRole('button', { name: mode, exact: true }).getAttribute('aria-pressed'), 'true');
      }
      await loadout.getByRole('button', { name: 'Quick', exact: true }).click();
      // Clear slot Q, then fill it with a starter skill.
      await loadout.getByRole('button', { name: 'Clear slot Q', exact: true }).click();
      await loadout.getByRole('button', { name: /^Slot Q, empty/ }).waitFor();
      await loadout.getByRole('region', { name: 'Defence' }).getByRole("button", { name: /^Bubble Shield/ }).click();
      await loadout.getByRole('button', { name: /^Slot Q: Bubble Shield,/ }).waitFor();
      // A skill above the driver's level says why it cannot be slotted.
      await loadout.locator('.loadout-skill.is-locked').first().click({ force: true });
      assert.match(await loadout.getByRole('alert').textContent() ?? '', /unlocks at level \d+/);
      await page.screenshot({ path: `${artifacts}/loadout-${slug}.png` });
      await loadout.getByRole('button', { name: 'Done', exact: true }).click();
      await loadout.waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test(`Browser: Talents screen shows six trees and locks what the level cannot reach (${label})`, { timeout: 120000 }, async () => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await ready(page);
      await openTab(page, 'Quick race');
      await page.getByRole('region', { name: 'Quick race garage' }).getByRole('button', { name: /^Talents/ }).click();
      const talents = page.getByRole('dialog', { name: 'TALENTS' });
      await talents.waitFor();
      await assertDialogFits(page, 'TALENTS');
      assert.equal(await talents.getByRole('tablist', { name: 'Talent trees' }).getByRole('tab').count(), 6);
      for (const tree of ['Engine', 'Chassis', 'Arsenal', 'Tactics', 'Fortune', 'Driver']) {
        await talents.getByRole('tab', { name: new RegExp(`^${tree}`) }).click();
        assert.equal(await talents.getByRole('tab', { name: new RegExp(`^${tree}`) }).getAttribute('aria-selected'), 'true');
        assert.equal(await talents.getByRole('region', { name: /^Tier \d$/ }).count(), 4);
      }
      // A fresh driver is level 1 with no points: nothing can be raised, and the respec has nothing to undo.
      assert.equal(await talents.locator('button.talent:not([disabled])').count(), 0, 'A level-1 driver should not be able to raise a talent.');
      assert.ok(await talents.getByRole('button', { name: /^Respec/ }).isDisabled());
      await page.screenshot({ path: `${artifacts}/talents-${slug}.png` });
      await talents.getByRole('button', { name: 'Done', exact: true }).click();
      await talents.waitFor({ state: 'detached' });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test(`Browser: Ball customizer changes the look and keeps it (${label})`, { timeout: 120000 }, async () => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const swatch = () => page.locator('[aria-label^="primary swatch 3 "]');
    const openBall = async () => {
      await openTab(page, 'Quick race');
      await page.getByRole('region', { name: 'Quick race garage' }).getByRole('tab', { name: 'Ball', exact: true }).click();
      const ball = page.getByRole('tabpanel', { name: 'Ball customisation' });
      await ball.waitFor();
      await ball.getByRole('tab', { name: 'Colors', exact: true }).click();
      return ball;
    };
    try {
      await ready(page);
      const ball = await openBall();
      assert.ok(await ball.getByRole('img', { name: 'Live spinning ball preview' }).isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The ball panel makes the page scroll sideways.');
      await swatch().click();
      assert.equal(await swatch().getAttribute('aria-pressed'), 'true');
      // The other categories list their options and say which are locked.
      const categories = ball.getByRole('tablist', { name: 'Ball categories' }).getByRole('tab');
      assert.ok(await categories.count() >= 3);
      await categories.nth(2).click();
      assert.ok(await ball.getByRole('tabpanel').locator('button').count() > 0, 'A cosmetic category lists no options.');
      await page.screenshot({ path: `${artifacts}/ball-${slug}.png` });
      // The look is saved with the cosmetics and survives a reload.
      await page.waitForFunction(() => Object.entries(localStorage).some(([k, v]) => k.endsWith('heavy-metal-gp:cosmetics:v1') && v.includes('primary')));
      await page.reload({ waitUntil: 'networkidle' });
      await dismissGate(page);
      await openBall();
      assert.equal(await swatch().getAttribute('aria-pressed'), 'true');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

// P2-23: Infinity (P2-24) and the platformer Workshop (P2-22), at phone portrait and on the desktop.
for (const { label, options } of SCREEN_VIEWPORTS) {
  const slug = label.replace(' ', '-');

  test(`Browser: Infinity rolls a canvas with a km readout; Hide UI and Pause work (${label})`, { timeout: 120000 }, async () => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await ready(page);
      await openTab(page, 'Infinity');
      await page.locator('.home-actions').getByRole('button', { name: 'Roll', exact: true }).click();
      await dismissGate(page, 8000);
      const canvas = page.locator('canvas.infinity-canvas');
      await canvas.waitFor();
      await page.locator('.infinity-km').waitFor();
      assert.match(await page.locator('.infinity-km').textContent() ?? '', /km/);
      // Hide UI: the buttons go, a tap brings them back.
      await page.getByRole('button', { name: 'Hide the buttons' }).click();
      assert.equal(await page.getByRole('button', { name: 'Pause' }).count(), 0, 'the buttons are hidden');
      await page.getByRole('button', { name: 'Show the buttons' }).click();
      await page.getByRole('button', { name: 'Pause' }).waitFor();
      // Pause: Resume / New seed / Leave.
      await page.getByRole('button', { name: 'Pause' }).click();
      for (const name of ['Resume', 'New seed', 'Leave']) assert.ok(await page.getByRole('button', { name, exact: true }).isVisible(), name);
      await page.screenshot({ path: `${artifacts}/infinity-${slug}.png` });
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.getByRole('button', { name: 'Pause' }).click();
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
      await page.getByRole('main', { name: 'Main menu' }).or(page.getByRole('button', { name: 'Back to the main menu' })).first().waitFor();
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test(`Browser: the platformer Workshop places a floor, test-drives it and comes back with it (${label})`, { timeout: 180000 }, async () => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await ready(page);
      await openTab(page, 'Workshop');
      // New track opens straight on the platformer starts (the drop tracks are retired).
      await page.locator('.home-actions').getByRole('button', { name: /New track/ }).click();
      await page.getByTestId('new-platformer').click();
      const lanes = page.getByRole('group', { name: 'Lane being edited' });
      await lanes.waitFor({ timeout: 60000 });
      // The Workshop's first-visit coach marks open over the canvas: dismiss them.
      await page.getByRole('button', { name: 'Dismiss tutorial' }).click({ timeout: 4000 }).catch(() => { /* not shown */ });
      for (const name of ['Back', 'Middle', 'Front']) assert.ok(await lanes.getByRole('button', { name, exact: true }).isVisible(), name);
      assert.ok(await page.getByRole('button', { name: 'Longer course' }).count() === 1);
      assert.ok(await page.getByRole('button', { name: 'Shorter course' }).count() === 1);
      const pieces = async () => Number((await page.locator('.editor-status').textContent() ?? '').match(/(\d+) PIECES/)?.[1] ?? NaN);
      const before = await pieces();
      // On a phone the palette lives in a drawer.
      const drawer = page.getByRole('button', { name: /^Pieces$/ });
      if (await drawer.isVisible().catch(() => false)) await drawer.click();
      await page.locator('[data-tile="ramp"]').first().click();
      if (await page.locator('.editor-drawer-close').isVisible().catch(() => false)) await page.locator('.editor-drawer-close').click();
      const canvas = page.locator('.editor-canvas');
      const box = await canvas.boundingBox();
      assert.ok(box);
      await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
      await page.waitForFunction((n) => (document.querySelector('.editor-status')?.textContent ?? '').includes(`${n + 1} PIECES`), before);
      await page.screenshot({ path: `${artifacts}/platformer-workshop-${slug}.png` });
      await page.getByRole('button', { name: /^Test drive$/ }).click();
      await dismissGate(page, 20000);
      await page.waitForSelector('.race-canvas', { timeout: 60000 });
      await page.getByRole('button', { name: /^Exit/ }).click();
      const leave = page.getByRole('button', { name: /Leave heat|Back to the editor|Leave/ });
      if (await leave.first().isVisible({ timeout: 3000 }).catch(() => false)) await leave.first().click();
      await page.getByRole('group', { name: 'Lane being edited' }).waitFor({ timeout: 60000 });
      assert.equal(await pieces(), before + 1, 'the floor is still there');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

// Crossing tracks: the Workshop's Track loop kit lays six joined pieces, and a course with a loop in it test-drives.
// (The tests have no way to read piece order, so the crossing marker swap is covered by the node tests; here: the
// piece count and no page error.)
for (const { label, options } of SCREEN_VIEWPORTS) {
  test(`Browser: the platformer Workshop places a Track loop (six pieces) and test-drives it (${label})`, { timeout: 180000 }, async () => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await ready(page);
      await openTab(page, 'Workshop');
      await page.locator('.home-actions').getByRole('button', { name: /New track/ }).click();
      await page.getByTestId('new-platformer').click();
      await page.getByRole('group', { name: 'Lane being edited' }).waitFor({ timeout: 60000 });
      await page.getByRole('button', { name: 'Dismiss tutorial' }).click({ timeout: 4000 }).catch(() => { /* not shown */ });
      const pieces = async () => Number((await page.locator('.editor-status').textContent() ?? '').match(/(\d+) PIECES/)?.[1] ?? NaN);
      const before = await pieces();
      const drawer = page.getByRole('button', { name: /^Pieces$/ });
      if (await drawer.isVisible().catch(() => false)) await drawer.click();
      await page.locator('[data-tile="track-loop"]').first().click();
      if (await page.locator('.editor-drawer-close').isVisible().catch(() => false)) await page.locator('.editor-drawer-close').click();
      const canvas = page.locator('.editor-canvas');
      const box = await canvas.boundingBox();
      assert.ok(box);
      await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.5 } });
      await page.waitForFunction((n) => (document.querySelector('.editor-status')?.textContent ?? '').includes(`${n + 6} PIECES`), before);
      await page.getByRole('button', { name: /^Test drive$/ }).click();
      await dismissGate(page, 20000);
      await page.waitForSelector('.race-canvas', { timeout: 60000 });
      await page.getByRole('button', { name: /^Exit/ }).click();
      const leave = page.getByRole('button', { name: /Leave heat|Back to the editor|Leave/ });
      if (await leave.first().isVisible({ timeout: 3000 }).catch(() => false)) await leave.first().click();
      await page.getByRole('group', { name: 'Lane being edited' }).waitFor({ timeout: 60000 });
      assert.equal(await pieces(), before + 6, 'the loop is still there');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

// Story (2026-10-04): starting Act 1 showed a blank screen (a hook after an early return in StoryMode threw the moment
// the first scene began), and every chapter had to be picked twice (the home Story tab, then story mode's own chapter
// list). One pick now starts the chapter, and its scenes, the loading screen and the race all render.
for (const { label, options } of SCREEN_VIEWPORTS) {
  const slug = label.replace(/\s+/g, '-');

  test(`Browser: Story starts the picked chapter in one click and Act 1 plays through to the race (${label})`, { timeout: 240000 }, async () => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const notBlank = async (where: string) => assert.ok((await page.locator('#root').innerHTML()).length > 200, `the page went blank at ${where}: ${errors.join(' | ')}`);
    const card = page.getByRole('button', { name: /^Chapter 1, / });
    const lights = page.getByRole('button', { name: /Lights out/ });
    try {
      await ready(page);
      await openTab(page, 'Story');
      // A fresh save: the big button, the tutorial offer (the only screen in between), then chapter 1's title card.
      await page.locator('.home-actions').getByRole('button', { name: /Start the story/ }).click();
      await page.getByRole('button', { name: 'Skip tutorial' }).click();
      await card.waitFor();
      assert.equal(await page.locator('.story-tile').count(), 0, 'story mode must not show a second chapter list');
      await card.click();
      // The first scene: this is where the page used to go blank.
      await page.locator('.story-scene').waitFor();
      await notBlank('the first scene');
      // Skip stays on screen, on a phone too (a long heading used to push it off the right edge).
      const skip = await page.locator('.story-top-actions .story-toggle').last().boundingBox();
      assert.ok(skip && skip.x >= 0 && skip.x + skip.width <= (page.viewportSize()?.width ?? 0), 'the Skip button is on screen');
      await page.screenshot({ path: `${artifacts}/story-act1-scene-${slug}.png` });
      // Skip the scenes (Escape) to the loading screen (keeping the bar when the loadout asks), then lights out.
      for (let i = 0; i < 40 && !(await lights.isVisible().catch(() => false)); i++) {
        if (await page.getByRole('button', { name: 'Same as last time' }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Same as last time' }).click();
        else if (await page.locator('.story-scene').isVisible().catch(() => false)) await page.keyboard.press('Escape');
        await page.waitForTimeout(250);
      }
      await lights.click();
      await page.waitForSelector('.race-canvas');
      await notBlank('the race');
      // Leave the heat: back on the home Story tab, the one chapter list.
      await page.getByRole('button', { name: /^Exit/ }).click();
      await page.getByRole('button', { name: 'Leave heat' }).click();
      await page.getByRole('main', { name: 'Story mode' }).waitFor();
      // One pick on a chapter card goes straight to that chapter (the tutorial is behind us now).
      const chapters = page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Chapters' });
      if (await chapters.isVisible().catch(() => false)) await chapters.click();
      await page.locator('.story-tile').first().click();
      await card.waitFor();
      assert.equal(await page.locator('.story-tile').count(), 0, 'still no second chapter list');
      await card.click();
      await page.locator('.story-scene').or(lights).first().waitFor();
      await notBlank('the second start');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}
