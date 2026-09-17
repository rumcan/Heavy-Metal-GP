// ══════════════════════════════════════════════════════════════════════════
// MP-10 — LEAVING: a seat is the room's to give back.
//
// Leave and kick are the two ways a driver comes off the grid, and both of them
// are the ROOM's business — the room owns the seat table, so a screen cannot
// free a seat by deciding to. These specs are about what the OTHER screen sees,
// which is where a seat that was not really freed shows up.
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

test('MP-10 leave: a guest walking out frees the seat on the host\'s grid', { skip: skip || false, timeout: 180_000 }, async () => {
  const mp = await open();
  const host = await mp.player('host');
  await host.hostGame();
  const guest = await mp.player('guest');
  await guest.joinGame(await host.roomCode());
  await host.page.locator('.header-tools .eyebrow').getByText(/\/ 2 DRIVERS/).waitFor({ timeout: 20_000 });

  await guest.page.getByRole('button', { name: /^leave$/i }).click();
  // The room re-greets everybody when the seat table changes, so the host's grid
  // shrinks without the guest having to say goodbye politely.
  await host.page.locator('.header-tools .eyebrow').getByText(/\/ 1 DRIVER/).waitFor({ timeout: 20_000 });
  assert.equal(await host.drivers(), 1);
  await host.page.locator('.fit-actions p').getByText(/Waiting for a rival/i).waitFor({ timeout: 20_000 });
  // And the guest is back in their own garage, with the room behind them: the
  // online panel is theirs to start again from, not a screen stuck in a lobby.
  await guest.openOnline();
});

test('MP-10 leave: the host may take a driver off the grid, and that driver is told why', { skip: skip || false, timeout: 180_000 }, async () => {
  const mp = await open();
  const host = await mp.player('host');
  await host.hostGame();
  const guest = await mp.player('guest');
  await guest.joinGame(await host.roomCode());
  await host.page.locator('.header-tools .eyebrow').getByText(/\/ 2 DRIVERS/).waitFor({ timeout: 20_000 });

  const name = (await guest.page.locator('.driver-grid .is-player strong').innerText()).trim();
  await host.page.getByRole('button', { name: new RegExp(`Take ${name} off the grid`) }).click();
  // A kick is the room's to carry out: the client asks, the room evicts and
  // re-greets, and the evicted screen lands back in the garage with a reason.
  await guest.openOnline();
  await guest.page.getByText(/took you off the grid/i).waitFor({ timeout: 20_000 });
  await host.page.locator('.header-tools .eyebrow').getByText(/\/ 1 DRIVER/).waitFor({ timeout: 20_000 });
});
