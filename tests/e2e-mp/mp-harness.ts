// ══════════════════════════════════════════════════════════════════════════
// MP-10 — two browsers, one race.
//
// Everything in `tests/` up to here runs one process with TWO ENDS OF THE WIRE
// WIRED TOGETHER IN IT: a host session and a guest session joined by a fake
// queue. That proves the protocol and the sessions. It cannot prove the thing a
// player actually does, which is open two tabs, type a code, and watch a race
// start on both — because a room, a socket, a rejoin and a dropped connection
// are all the platform's, and only a real browser in front of the real sidecar
// exercises them.
//
// So this harness is deliberately dumb about the game and exact about the
// browser: it drives the screens the way a player does (click the words a player
// reads), and it knows nothing about the wire. When a spec says "the guest is
// back in control of its marble", it reads it off the page — a DEV-only data
// attribute in `RaceScreen`, which is the one honest way to read a canvas.
//
// Requirements, and they are not optional:
//   - a Playwright browser: `npx playwright install chromium`
//     (`playwright-core` is already a dependency; the browser binary is not)
//   - `npm run dev`'s room sidecar, which `scripts/e2e-mp.mjs` starts for you
//     with `rundot/realtime.e2e.config.json` (a SHORT reconnect window, so the
//     reconnect spec does not sit for thirty seconds waiting to be evicted)
//
// When the browser is missing the specs skip with a reason, so `check.mjs` and
// CI stay green on a machine that has no Chromium — and say so out loud rather
// than passing silently.
// ══════════════════════════════════════════════════════════════════════════
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

import { chromium as playwright, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
// The same browser `tests/browser.test.ts` drives: this repo does not depend on
// a machine-wide Chromium (the Playwright CDN is not always reachable, and a CI
// image is not a dev machine), it ships one inside the Linux package. Not declared
// in `package.json` — it arrives with the SDK, exactly as the existing browser
// suite already relies on.
import sparticuz from '@sparticuz/chromium';

const ROOT = join(new URL('..', import.meta.url).pathname, '..');

/** How long a page has to show something before a spec calls it missing. */
export const DEFAULT_TIMEOUT = 20_000;

/** The dev server the specs drive. Set by `scripts/e2e-mp.mjs`, or booted here. */
export function baseUrl(): string {
  return process.env.MP_BASE_URL ?? 'http://127.0.0.1:5173/';
}

// ── the browser ───────────────────────────────────────────────────────────

interface Launched {
  browser: Browser;
  cleanup: () => Promise<void>;
}

/**
 * One headless Chromium, the same way the existing browser suite gets one.
 *
 * Linux: the binary bundled in `@sparticuz/chromium`, with its shared libraries
 * unpacked next to it (a minimal CI image has none of them). Anywhere else: a
 * locally installed Chrome or Edge, because the bundled one is a Linux build —
 * `BROWSER_PATH` overrides either.
 */
export async function launchBrowser(): Promise<Launched> {
  if (process.platform !== 'linux') {
    const candidates = [
      process.env.BROWSER_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ].filter(Boolean) as string[];
    const executablePath = candidates.find((path) => existsSync(path));
    if (!executablePath) throw new Error('No local Chrome or Edge found; set BROWSER_PATH.');
    return { browser: await playwright.launch({ executablePath, headless: true, args: ['--disable-gpu'] }), cleanup: async () => {} };
  }

  const libraryDir = await mkdtemp(join(tmpdir(), 'hmgp-mp-libs-'));
  const archive = await readFile(join(ROOT, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br'));
  const extraction = spawnSync('tar', ['-xf', '-', '-C', libraryDir], { input: brotliDecompressSync(archive) });
  if (extraction.status !== 0) {
    await rm(libraryDir, { recursive: true, force: true });
    throw new Error('Could not unpack the bundled browser libraries.');
  }
  sparticuz.setGraphicsMode = false;
  try {
    const browser = await playwright.launch({
      args: [...sparticuz.args.filter((arg) => !['--single-process', '--in-process-gpu'].includes(arg)), '--disable-gpu'],
      executablePath: await sparticuz.executablePath(),
      headless: true,
      env: { ...process.env, LD_LIBRARY_PATH: `${libraryDir}/lib:${libraryDir}/al2023/lib:${process.env.LD_LIBRARY_PATH ?? ''}`, FONTCONFIG_PATH: join(tmpdir(), 'fonts') },
    });
    return { browser, cleanup: () => rm(libraryDir, { recursive: true, force: true }) };
  } catch (err) {
    await rm(libraryDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Can this machine run the suite at all?
 *
 * A missing browser is not a failure of the game — it is a machine without
 * Chromium. Specs pass `skip` so the run says what it did NOT test, and CI stays
 * green while saying so out loud.
 */
export async function unavailable(): Promise<string | false> {
  if (process.env.MP_SKIP) return String(process.env.MP_SKIP);
  let launched: Launched | null = null;
  try {
    launched = await launchBrowser();
    return false;
  } catch (err) {
    return `no browser for the multiplayer suite (${(err as Error).message.split('\n')[0]})`;
  } finally {
    await launched?.browser.close();
    await launched?.cleanup();
  }
}

// ── one player ────────────────────────────────────────────────────────────

/**
 * One player: their own browser context, their own dev identity, their own
 * socket. Two contexts in one browser is two players as far as the SDK is
 * concerned (`dev-tab-XXXX` profiles are minted per context), which is exactly
 * what the "two tabs" walkthrough in the README does by hand.
 */
export class Player {
  constructor(readonly name: string, readonly context: BrowserContext, readonly page: Page) {}

  /**
   * Dismiss the boot card and land in the garage.
   *
   * Every name below is matched case-insensitively on purpose: most of this
   * UI's labels are uppercased by CSS (`text-transform`), and a browser's
   * accessible name follows the transform — so `Online` is `ONLINE` to
   * Playwright and `/^Online$/` would find nothing at all.
   */
  async enterGarage(): Promise<void> {
    const cta = this.page.getByRole('button', { name: /enter the paddock/i });
    await cta.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
    // Wait for the click to be worth making: a button that React has not wired
    // up yet takes the click and does nothing with it.
    await cta.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT });
    await cta.click();
    await this.onlineTab().waitFor({ timeout: DEFAULT_TIMEOUT });
  }

  /** The garage's Online mode tab. */
  onlineTab() {
    return this.page.getByRole('button', { name: /^online$/i });
  }

  async openOnline(): Promise<void> {
    await this.onlineTab().click();
    await this.page.getByRole('button', { name: /host game/i }).waitFor({ timeout: DEFAULT_TIMEOUT });
  }

  /**
   * The online panel: Host / Join / Quick live here, and nowhere else —
   * "Quick race" is ALSO a race-mode toggle on the garage tab, so matching it
   * unscoped is a strict-mode violation waiting for a browser to find it.
   */
  private get online(): Locator {
    return this.page.locator('.online-panel');
  }

  async hostGame(): Promise<void> {
    await this.openOnline();
    await this.online.getByRole('button', { name: /host game/i }).click();
    await this.lobby();
  }

  async joinGame(code: string): Promise<void> {
    await this.openOnline();
    await this.page.getByLabel('Room code').fill(code);
    await this.online.getByRole('button', { name: /join with code/i }).click();
    await this.lobby();
  }

  async quickRace(): Promise<void> {
    await this.openOnline();
    await this.online.getByRole('button', { name: /quick race/i }).click();
    await this.lobby();
  }

  /** The lobby, once the room has said hello. */
  async lobby(): Promise<void> {
    await this.page.locator('.lobby-code b').waitFor({ timeout: DEFAULT_TIMEOUT });
    await this.page.locator('.driver-grid li').first().waitFor({ timeout: DEFAULT_TIMEOUT });
  }

  /** The six-character code the host is showing. */
  async roomCode(): Promise<string> {
    const code = (await this.page.locator('.lobby-code b').innerText()).trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error(`the lobby is not showing a code: "${code}"`);
    return code;
  }

  /** Humans on the grid, as the lobby counts them (`… / 2 DRIVERS`). */
  async drivers(): Promise<number> {
    const text = await this.page.locator('.header-tools .eyebrow').innerText();
    return Number(text.match(/\/ (\d+) DRIVERS/)?.[1] ?? 0);
  }

  async setReady(): Promise<void> {
    await this.page.getByRole('button', { name: /^ready$/i }).click();
  }

  async startRace(): Promise<void> {
    await this.page.getByRole('button', { name: /start the race/i }).click();
    await this.race();
  }

  /** The race screen, once it has a world. */
  /**
   * The race screen. `timeoutMs` is the caller's to raise: a quick race lights
   * itself twenty seconds after the second driver arrives, plus the countdown,
   * so the default is only right for a lobby whose host is holding the button.
   */
  async race(timeoutMs = DEFAULT_TIMEOUT): Promise<void> {
    await this.page.locator('.race-shell').waitFor({ timeout: timeoutMs });
  }

  /**
   * The race clock, in ms. Zero until the gate drops.
   *
   * The HUD writes `M:SS.cc` (centiseconds — a tenth of a second is as fine as a
   * marble race needs), and that is read rather than assumed: a suite that
   * guessed the format would call a stopped clock a running one.
   */
  async raceTime(): Promise<number> {
    const text = (await this.page.locator('.race-clock strong').innerText()).trim();
    const [minutes, rest] = text.split(':');
    const [seconds, fraction] = (rest ?? '0').split('.');
    const millis = (fraction ?? '0').padEnd(3, '0').slice(0, 3);
    return Number(minutes) * 60_000 + Number(seconds) * 1000 + Number(millis);
  }

  /** Wait for the lights to go out: the lobby arms them six seconds out. */
  async waitForGate(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await this.raceTime()) > 0) return;
      await this.page.waitForTimeout(400);
    }
    throw new Error(`the lights never went out on ${this.name}`);
  }

  /** Where this screen's own marble is (DEV-only probe; see `RaceScreen`). */
  async marble(): Promise<{ seat: number; x: number; y: number }> {
    const shell = this.page.locator('.race-shell');
    return {
      seat: Number(await shell.getAttribute('data-mp-seat')),
      x: Number(await shell.getAttribute('data-mp-x')),
      y: Number(await shell.getAttribute('data-mp-y')),
    };
  }

  /** The race-ending shortcut the dev build ships (P1, P3, P8 or DNF). */
  async devFinish(place: 'P1' | 'P3' | 'P8' | 'DNF'): Promise<void> {
    await this.page.locator('.dev-skip-race').getByText(place, { exact: true }).click();
  }

  async visible(text: RegExp): Promise<boolean> {
    return this.page.getByText(text).first().isVisible().catch(() => false);
  }

  /** Cut (or heal) this player's whole connection. */
  async offline(down: boolean): Promise<void> {
    await this.context.setOffline(down);
  }

  /** A refresh: the whole app boots again, paddock and all. */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.enterGarage();
  }
}

// ── the suite ─────────────────────────────────────────────────────────────

/**
 * The suite's own world: one browser, one dev server, players on demand.
 *
 * `scripts/e2e-mp.mjs` boots the server and hands it over in `MP_BASE_URL`; a
 * spec run on its own (or an IDE's test runner) boots one here instead, so the
 * specs never depend on somebody having started `npm run dev` first.
 */
export class MpSuite {
  private readonly players: Player[] = [];
  private server: (() => void) | null = null;
  private libs: (() => Promise<void>) | null = null;

  private constructor(readonly browser: Browser, readonly url: string) {}

  static async open(): Promise<MpSuite> {
    const url = baseUrl();
    const launched = await launchBrowser();
    const suite = new MpSuite(launched.browser, url);
    suite.libs = launched.cleanup;
    if (!(await healthy(url))) {
      suite.server = await devServer();
      await waitFor(url);
    }
    return suite;
  }

  /** Another player: a fresh context, so a fresh dev identity and a fresh seat. */
  async player(name = `player-${this.players.length + 1}`): Promise<Player> {
    const context = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    // Generous, on purpose: the first page of a run also pays for Vite to
    // transform the whole app, and a suite that fails on a cold cache is a
    // suite nobody runs.
    page.setDefaultTimeout(60_000);
    page.on('pageerror', (error) => process.stdout.write(`[${name}] page error: ${error.message}\n`));
    const player = new Player(name, context, page);
    this.players.push(player);
    await page.goto(this.url, { waitUntil: 'domcontentloaded' });
    await player.enterGarage();
    return player;
  }

  async close(): Promise<void> {
    for (const player of this.players) await player.context.close();
    this.players.length = 0;
    await this.browser.close();
    this.server?.();
    this.server = null;
    await this.libs?.();
    this.libs = null;
  }
}

// ── the room server's own network ─────────────────────────────────────────

/**
 * A partition between the pages and the room: the tab stays online, the room
 * stops answering. `open()` heals it.
 *
 * The proxy listens on 9101 and points the SDK at it by overriding the dev
 * sidecar origin the vite plugin injects — which is why the spec passes a base
 * URL with the blackhole's port swapped in for the sidecar's.
 */
export class Blackhole {
  private constructor(private readonly control: number) {}

  /** Start one, on the ports the suite uses (9101 → sidecar 9001, control 9102). */
  static async start(targetPort = 9001): Promise<Blackhole> {
    const child = spawn(process.execPath, ['tests/e2e-mp/sidecar-blackhole.mjs', '--listen', '9101', '--target', String(targetPort), '--control', '9102'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise<void>((resolve, reject) => {
      child.stdout?.on('data', () => resolve());
      child.on('exit', (code) => reject(new Error(`the blackhole exited (${code})`)));
      setTimeout(() => reject(new Error('the blackhole never listened')), 10_000);
    });
    const hole = new Blackhole(9102);
    hole.child = child;
    return hole;
  }

  private child!: ReturnType<typeof spawn>;

  async set(open: boolean): Promise<void> {
    const res = await fetch(`http://127.0.0.1:${this.control}/${open ? 'open' : 'close'}`, { method: 'POST' });
    if (!res.ok) throw new Error(`the blackhole would not ${open ? 'open' : 'close'}`);
  }

  /** Cut the pages off from the room, wait, and heal. */
  async partition(ms: number): Promise<void> {
    await this.set(false);
    await sleep(ms);
    await this.set(true);
  }

  async stop(): Promise<void> {
    this.child.kill('SIGTERM');
  }
}

// ── booting a dev server ──────────────────────────────────────────────────

/** Is something already serving the app at `url`? */
export async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * `npm run dev`, with the E2E rooms config.
 *
 * The short reconnect window is the whole point of the second file: the specs
 * want to test the WINDOW (a driver who comes back inside it), not to sit
 * through the thirty seconds the shipped config takes to evict somebody.
 */
export async function devServer(): Promise<() => void> {
  const child = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
    env: { ...process.env, RUNDOT_DEV_ROOMS_CONFIG: 'rundot/realtime.e2e.config.json' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  return () => void child.kill('SIGTERM');
}

/** Wait for the dev server (and its sidecar) to answer. */
export async function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthy(url)) return;
    await sleep(250);
  }
  throw new Error(`nothing answered at ${url} — start \`npm run dev\` or let the harness boot one`);
}

/** Is the Playwright browser this repo pins actually installed? */
export function browserInstalled(): boolean {
  const probe = spawnSync(process.execPath, ['-e', "console.log(require('playwright-core/package.json').version)"], { encoding: 'utf8' });
  return probe.status === 0;
}
