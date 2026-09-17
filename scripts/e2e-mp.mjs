// ══════════════════════════════════════════════════════════════════════════
// MP-10 — the two-browser suite, in one command.
//
// `npx tsx --test tests/e2e-mp/*.e2e.spec.ts` would boot a dev server per file
// and fight over port 5173. So this boots ONE — with the E2E rooms config, whose
// reconnect window is short enough for the reconnect spec to test the WINDOW
// rather than wait out the shipped one — and hands the URL to every spec in a
// single node:test run.
//
//   node scripts/e2e-mp.mjs           # start a dev server, run every spec
//   MP_BASE_URL=http://127.0.0.1:5173/ node scripts/e2e-mp.mjs   # reuse one
//
// Exit code is the test run's. A machine with no Chromium installed skips every
// spec with a reason and exits 0 — a suite that passes by testing nothing is a
// lie, but a suite that fails for want of a browser is noise.
// ══════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `.pathname`: on Windows the pathname is `/C:/…` with %20s, which is no working directory.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
// `npx` is `npx.cmd` on Windows and cannot be spawned without a shell.
const SHELL = process.platform === 'win32';
const SPECS = 'tests/e2e-mp';
const PORT = Number(process.env.MP_PORT ?? 5173);
const BASE = process.env.MP_BASE_URL ?? `http://127.0.0.1:${PORT}/`;

async function healthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when the room sidecar answered too — a page without it cannot host. */
async function sidecarUp() {
  try {
    const res = await fetch(`http://127.0.0.1:9001/health`, { signal: AbortSignal.timeout(1_500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

let vite = null;
if (!(await healthy(BASE))) {
  process.stdout.write(`e2e-mp: starting a dev server on ${PORT} with rundot/realtime.e2e.config.json\n`);
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, RUNDOT_DEV_ROOMS_CONFIG: 'rundot/realtime.e2e.config.json' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: SHELL,
  });
  vite.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  vite.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await healthy(BASE)) break;
    await sleep(250);
  }
  if (!(await healthy(BASE))) {
    vite.kill('SIGTERM');
    console.error('e2e-mp: the dev server never came up');
    process.exit(1);
  }
}

if (!(await sidecarUp())) {
  process.stdout.write('e2e-mp: warning — nothing answered on 9001; the room sidecar may not be running\n');
}

const files = (await readdir(new URL(`../${SPECS}`, import.meta.url)))
  .filter((name) => name.endsWith('.e2e.spec.ts'))
  .sort()
  .map((name) => `${SPECS}/${name}`);
if (!files.length) {
  console.error(`e2e-mp: no specs in ${SPECS}`);
  process.exit(1);
}

const run = spawn('npx', ['tsx', '--test', '--test-concurrency=1', ...files], {
  cwd: ROOT,
  env: { ...process.env, MP_BASE_URL: BASE },
  stdio: 'inherit',
  shell: SHELL,
});
const code = await new Promise((resolve) => run.on('exit', (c) => resolve(c ?? 1)));
vite?.kill('SIGTERM');
process.exit(code);
