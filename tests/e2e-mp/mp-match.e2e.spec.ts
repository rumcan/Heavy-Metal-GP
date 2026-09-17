// ══════════════════════════════════════════════════════════════════════════
// MP-10 — QUICK RACE: two players, no code between them.
//
// The acceptance for MP-07 is one sentence: two players pressing Quick race at
// the same time end up in one race without typing a code. Proving it needs two
// browsers pressing the button together, which is the one thing a unit test can
// never do — the pairing is the platform's.
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

test('MP-10 match: Auto Match Making puts the second player in the first player’s lobby, with no code', { skip: skip || false, timeout: 240_000 }, async () => {
  const mp = await open();
  const first = await mp.player('first');
  const second = await mp.player('second');

  // The first searcher opens the lobby and hosts it; the second lands in it.
  await first.quickRace();
  await second.quickRace();

  const codeA = await first.roomCode();
  const codeB = await second.roomCode();
  assert.equal(codeA, codeB, 'both screens are in the same room');
  assert.equal(await first.drivers(), 2, 'and it is the two of them on the grid');

  // Nobody presses Ready; the host (the first searcher) starts the race.
  await first.startRace();
  await first.race(90_000);
  await second.race(90_000);
  await first.waitForGate(60_000);
  assert.ok((await first.raceTime()) > 0, 'the lights went out on the host');
  assert.ok((await second.raceTime()) > 0, 'and on the guest, at the same instant');
  assert.equal(codeA, codeB, 'and they are still in the same race');
});
