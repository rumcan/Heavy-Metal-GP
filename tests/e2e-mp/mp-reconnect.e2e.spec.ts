// ══════════════════════════════════════════════════════════════════════════
// MP-10 — RECONNECT: the acceptance for the whole resilience half of the epic.
//
//   A guest goes offline for ten seconds and takes the same marble back.
//
// Three separate things have to be true, and a unit test can only prove one of
// them: the RACE survives (the host keeps simulating), the SEAT survives (the
// room holds it), and the DRIVER gets their hands back (the host hands the marble
// back after the AI has been holding it). The last one is a fact about a
// coordinate on a canvas, so it is read off the page.
//
// The offline window is ten seconds and the E2E room config holds a seat for
// twelve: the driver is meant to come back inside the window, which is the case
// the whole feature exists for.
// ══════════════════════════════════════════════════════════════════════════
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { MpSuite, unavailable } from './mp-harness';

const skip = await unavailable();
let suite: MpSuite | null = null;
async function open(): Promise<MpSuite> {
  suite ??= await MpSuite.open();
  return suite;
}
after(async () => void (await Promise.resolve(suite?.close())));

const OFFLINE_MS = 10_000;

/** Hold a key for a while, as a hand on a touch pad would. */
async function lean(page: import('playwright-core').Page, key: 'ArrowLeft' | 'ArrowRight', ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test('MP-10 reconnect: ten seconds offline and the driver takes the same marble back', { skip: skip || false, timeout: 300_000 }, async () => {
  const mp = await open();
  const host = await mp.player('host');
  await host.hostGame();
  const guest = await mp.player('guest');
  await guest.joinGame(await host.roomCode());

  await guest.setReady();
  await host.setReady();
  await host.page.locator('.fit-actions p').getByText(/drop the lights/i).waitFor({ timeout: 20_000 });
  await host.startRace();
  await guest.race();
  await guest.waitForGate();

  const seat = (await guest.marble()).seat;
  assert.ok(seat > 0, 'the guest is not driving the host’s marble');

  // ── the drop ────────────────────────────────────────────────────────────
  await guest.offline(true);
  const hostTime = await host.raceTime();
  await host.page.waitForTimeout(OFFLINE_MS);
  // The race does not stop because one socket did: the host keeps simulating and
  // the rest of the field keeps racing.
  assert.ok((await host.raceTime()) > hostTime, 'the race carried on without them');

  // ── the return ──────────────────────────────────────────────────────────
  await guest.offline(false);
  // Their seat is the room's to hold, and the room re-greets a returner — the
  // host answers with the grid, and their screen takes the race back mid-heat.
  await guest.waitForGate();
  const back = await guest.marble();
  assert.equal(back.seat, seat, 'the same seat — the same marble, not a spare');

  // ── and the hands ───────────────────────────────────────────────────────
  // The AI had it for those ten seconds (three seconds is the rule in
  // `src/net/presence.ts`). Being back must mean the marble answers again: lean
  // one way, then the other, and the marble goes both ways.
  await lean(guest.page, 'ArrowLeft', 2_500);
  const left = (await guest.marble()).x;
  await lean(guest.page, 'ArrowRight', 2_500);
  const right = (await guest.marble()).x;
  assert.ok(right - left > 8, `the marble answered both ways (${left.toFixed(1)} → ${right.toFixed(1)}) — the driver has it back`);
});
