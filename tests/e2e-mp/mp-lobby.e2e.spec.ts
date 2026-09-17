// ══════════════════════════════════════════════════════════════════════════
// MP-10 — HOSTING AND JOINING, in two real browsers.
//
// This is the acceptance MP-06 could only be hand-played: the host shows a code,
// the guest types it, both screens end up in one lobby, and Start drops the
// lights on BOTH. Nothing here knows what a frame looks like — it clicks the
// words a player reads and waits for the screen to say what it said.
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

test('MP-10 lobby: a host is given a code, and a guest who types it lands in the same room', { skip: skip || false, timeout: 180_000 }, async () => {
  const mp = await open();
  const host = await mp.player('host');
  await host.hostGame();
  const code = await host.roomCode();
  assert.match(code, /^[A-Z0-9]{6}$/, 'the lobby shows a six-character code');
  assert.equal(await host.drivers(), 1, 'one driver: the host');

  const guest = await mp.player('guest');
  await guest.joinGame(code);
  assert.equal(await guest.roomCode(), code, 'the guest is in the same room, not a lookalike');
  assert.equal(await guest.drivers(), 2, 'and the grid now has two of them');
  // The room tells EVERYBODY when the seat table changes — the host's screen has
  // to hear about the guest without being told twice.
  await host.page.locator('.header-tools .eyebrow').getByText(/\/ 2 DRIVERS/).waitFor({ timeout: 20_000 });
  assert.equal(await host.drivers(), 2);
});

test('MP-10 lobby: Start waits for both drivers, and only the host has one', { skip: skip || false, timeout: 180_000 }, async () => {
  const mp = await open();
  const host = await mp.player('host');
  await host.hostGame();
  const start = host.page.getByRole('button', { name: /start the race/i });
  assert.equal(await start.isDisabled(), true, 'one driver is the offline game, not a lobby');

  const guest = await mp.player('guest');
  await guest.joinGame(await host.roomCode());
  await guest.page.getByRole('button', { name: /^ready$/i }).waitFor({ timeout: 20_000 });
  await host.page.locator('.header-tools .eyebrow').getByText(/\/ 2 DRIVERS/).waitFor({ timeout: 20_000 });
  assert.equal(await start.isDisabled(), true, 'two drivers who have not said they are ready');

  await guest.setReady();
  await host.setReady();
  // The host's own ready flag is local; the guest's arrives as a frame and comes
  // back as a grid — so this is a wait, not a step.
  await host.page.locator('.fit-actions p').getByText(/drop the lights/i).waitFor({ timeout: 20_000 });
  assert.equal(await start.isDisabled(), false, 'both ready: the lights may go out');
  assert.equal(await guest.page.getByRole('button', { name: /start the race/i }).count(), 0, 'and there is still only one Start, on the host');
});

test('MP-10 lobby: Start drops the lights on both screens', { skip: skip || false, timeout: 240_000 }, async () => {
  const mp = await open();
  const host = await mp.player('host');
  await host.hostGame();
  const guest = await mp.player('guest');
  await guest.joinGame(await host.roomCode());

  await guest.setReady();
  await host.setReady();
  await host.page.locator('.fit-actions p').getByText(/drop the lights/i).waitFor({ timeout: 20_000 });
  await host.startRace();

  // The guest is not told to start — it is told WHEN. Both screens build a world
  // from the seed and open the gate on the instant the lobby published.
  await guest.race();
  await guest.waitForGate();
  await host.waitForGate();
  assert.ok((await host.raceTime()) > 0, 'the host is racing');
  assert.ok((await guest.raceTime()) > 0, 'and so is the guest — on the same instant the lobby published');
});
