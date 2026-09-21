#!/usr/bin/env node
/**
 * Connected generator visual regression driver: serves the repo through vite, races
 * a seeded generated course headlessly in a real browser page and captures the acceptance views
 * into tests/artifacts/. Usage: node --import tsx scripts/course-shots.mjs
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { brotliDecompressSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium as playwright } from 'playwright-core';
import chromium from '@sparticuz/chromium';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tests', 'artifacts');
await mkdir(out, { recursive: true });

const server = await createServer({
  configFile: false, root, plugins: [react(), tailwindcss()], logLevel: 'error',
  css: { postcss: { plugins: [] } },
  server: { port: 0, host: '127.0.0.1' },
});
await server.listen();
const address = server.httpServer.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

const libraryDir = await mkdtemp(join(tmpdir(), 'marble-browser-libs-'));
const archive = await readFile(join(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
spawnSync('tar', ['-xf', '-', '-C', libraryDir], { input: brotliDecompressSync(archive) });
// Unpack inside our own temporary directory; shared /tmp/chromium may be an empty placeholder.
const executable = join(libraryDir, 'chromium');
await writeFile(executable, brotliDecompressSync(await readFile(join(root, 'node_modules/@sparticuz/chromium/bin/chromium.br'))), { mode: 0o755 });
const fontArchive = await readFile(join(root, 'node_modules/@sparticuz/chromium/bin/fonts.tar.br'));
spawnSync('tar', ['--no-same-owner', '-xf', '-', '-C', libraryDir], { input: brotliDecompressSync(fontArchive) });
chromium.setGraphicsMode = false;
const browser = await playwright.launch({
  args: [...chromium.args.filter((a) => !['--single-process', '--in-process-gpu'].includes(a)), '--disable-gpu'],
  executablePath: executable, headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: `${libraryDir}/lib:${libraryDir}/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}`, FONTCONFIG_PATH: join(libraryDir, 'fonts') },
});

const context = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.error(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') console.error(`console: ${m.text()}`); });
await page.goto(`${baseUrl}/scripts/course-shots/index.html`);
await page.waitForFunction(() => window.__READY__ === true || !!window.__ERROR__, undefined, { timeout: 60000 });
const err = await page.evaluate(() => window.__ERROR__);
if (err) throw new Error(err);

for (const view of ['overview', 'fork', 'ferry', 'shortcut', 'battle', 'phone']) {
  const file = join(out, `course-${view}.png`);
  await page.locator(`canvas[data-view="${view}"]`).screenshot({ path: file });
  console.log(`wrote tests/artifacts/course-${view}.png`);
}

await browser.close();
await server.close();
await rm(libraryDir, { recursive: true, force: true });
console.log('done');
