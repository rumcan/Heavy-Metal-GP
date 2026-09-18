// ══════════════════════════════════════════════════════════════════════════
// RK-04 — RANK-MATCHED QUICK RACE: two seeded ratings, two browsers.
//
// RK-04's acceptance has two halves, and they are proven in two places.
//
// The WIDENING half — "nobody nearby, the search widens and still matches
// anyone" — lives in `tests/matchmake.test.ts`, against a pool that models RUN's
// criteria rule. It cannot be a browser spec here: the dev sidecar is not a
// queue. Its `matchmake` action falls through to `joinOrCreate`, so it answers
// every request immediately with a room, which means a lone searcher never sits
// in a window for one to close. (That also makes the dev behaviour identical to
// what the ladder does at its LAST rung, which is the behaviour the two tests
// below depend on.)
//
// The other half is what only a browser can show, and it is what this spec is
// for: a seeded rank FILE reaches the matchmaking call, the bucket rides the
// wire, and two drivers whose ratings round into the same bucket end up in one
// lobby with no code between them — while two a tier apart are NOT pooled into
// each other's race at the tight window. Without the bucket on the wire, the
// second case would share a room too.
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

test('RK-04 ranked match: two ratings in one bucket land in the same lobby, with no code', { skip: skip || false, timeout: 240_000 }, async () => {
  const mp = await open();
  const first = await mp.player('ranked-near-first');
  const second = await mp.player('ranked-near-second');

  // 12 points apart: the tight window (span 75) rounds them into bucket 16, so
  // the first rung of the ladder is what pairs them. (Deliberately away from
  // the 1000 a fresh file starts at — a room another spec left standing is a
  // room this pair must not be pooled into.)
  await first.seedRating(1200);
  await second.seedRating(1212);

  await first.quickRace();
  await second.quickRace();

  const codeA = await first.roomCode();
  const codeB = await second.roomCode();
  assert.equal(codeA, codeB, 'both screens are in the same room');
  assert.equal(await first.drivers(), 2, 'and it is the two of them on the grid');
  assert.equal(await second.drivers(), 2);
});

test('RK-04 ranked match: ratings a tier apart are not pooled at the tight window', { skip: skip || false, timeout: 240_000 }, async () => {
  const mp = await open();
  const first = await mp.player('ranked-far-first');
  const second = await mp.player('ranked-far-second');

  // 1000 points apart: no window on the ladder holds both until Any rank. On a
  // real queue each of them would be widening right now; against the dev
  // sidecar each request is answered with its own room instead, so the two are
  // in DIFFERENT lobbies — which is the point of this control: the bucket is
  // on the wire, and this pair was never asked for a shared one.
  await first.seedRating(2000);
  await second.seedRating(3000);

  await first.quickRace();
  await second.quickRace();

  const codeA = await first.roomCode();
  const codeB = await second.roomCode();
  assert.notEqual(codeA, codeB, 'different rank buckets are different lobbies at the tight window');
  assert.equal(await first.drivers(), 1, 'each driver opened their own lobby');
  assert.equal(await second.drivers(), 1);
});
