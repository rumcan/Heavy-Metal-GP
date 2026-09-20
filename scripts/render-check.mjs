#!/usr/bin/env node
/**
 * Scratch screenshot harness for issue #73: renders the audited pieces with
 * sprite art and with the vector fallback, physics colliders overlaid in red.
 * Usage: node --import tsx scripts/render-check.mjs
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
chromium.setGraphicsMode = false;
const browser = await playwright.launch({
  args: [...chromium.args.filter((a) => !['--single-process', '--in-process-gpu'].includes(a)), '--disable-gpu'],
  executablePath: await chromium.executablePath(), headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: `${libraryDir}/lib:${libraryDir}/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}`, FONTCONFIG_PATH: join(tmpdir(), 'fonts') },
});

async function shoot(name, blockArt) {
  const context = await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error(`[${name}] pageerror:`, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[${name}] console:`, m.text()); });
  if (blockArt) await page.route('**/*.{png,webp}', (route) => route.abort());
  await page.goto(`${baseUrl}/scripts/render-check/index.html?art=${blockArt ? 0 : 1}`);
  await page.waitForFunction(() => window.__READY__ === true || !!window.__ERROR__, undefined, { timeout: 30000 });
  const err = await page.evaluate(() => window.__ERROR__);
  if (err) throw new Error(`[${name}] ${err}`);
  await page.screenshot({ path: join(out, name), fullPage: true });
  console.log(`wrote tests/artifacts/${name}`);
  await context.close();
}

await shoot('render-fallback.png', true);
await shoot('render-art.png', false);

await browser.close();
await server.close();
await rm(libraryDir, { recursive: true, force: true });
console.log('done');
