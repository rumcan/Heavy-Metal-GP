// ══════════════════════════════════════════════════════════════════════════
// RK-06 (#60) — A RATED RACE, START TO FINISH, ACROSS TWO BROWSERS.
//
// The ranked specs up to here prove the pieces: RK-04's two seeded ratings land
// in one lobby, RK-05's lobby badges each seat, and the results panel's three
// states are pinned without a browser. What none of them does is RACE — a flag,
// a classification, a room-stamped result and two rating files moving — because
// a race takes minutes and the dev sidecar's rooms outlive the run.
//
// This spec pays that price once, on purpose. It is the only place the epic's
// central claim is checked end to end: ONE race, ONE result, the SAME numbers on
// both screens, and a race that counts exactly once however many times the page
// is reloaded afterwards.
//
// The two things it asserts, in the ticket's words:
//
//   1. both players see rating deltas that MATCH — read off the two screens by
//      driver name, seat for seat, after both have raced the same heat;
//   2. a refresh after the race does NOT double-file — the rating file (number
//      and race count) is read raw before and after a reload, and it is the
//      same file: same rating, same matches, same win/loss counters.
//
// Why the raw file and not just the badge: the badge prints a NUMBER, and a file
// that had somehow been charged the same race twice with opposite signs could
// still print a plausible one. `matches` is the counter the once-only guard
// protects (`raceKeyOf` → one key per room result), so it is what the second
// assertion is about.
//
// TIME, AND WHY THE BUDGETS ARE GENEROUS. A heat ends when the last marble is
// home or the race clock runs out (`HEAT_TIME_LIMIT`, nine minutes), and a
// headless tab driving two canvas pages does not always roll a clean field —
// so the flag normally falls around two minutes and MAY take the full nine.
// These specs therefore wait up to ten minutes for a classification rather than
// failing a race that was still honestly running.
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

/** Ten points apart: both round into the span-75 bucket (17), so the first rung matches. */
const A = { rating: 1300, matches: 12 };
const B = { rating: 1310, matches: 12 };

/** How long a heat may take, plus room to fold the result in (see the header). */
const FLAG_TIMEOUT_MS = 600_000;
/** The whole spec: the flag budget, the setup, and the reload that follows it. */
const SPEC_TIMEOUT_MS = 780_000;

test('RK-06 ranked race: both drivers see the same deltas, and a reload does not file the race twice', { skip: skip || false, timeout: SPEC_TIMEOUT_MS }, async () => {
  const mp = await open();
  const first = await mp.player('ranked-race-a');
  const second = await mp.player('ranked-race-b');

  // Seeded before the app mounts, then reloaded, so both drivers enter the queue
  // with a history: twelve races in, past placement, in the same bucket.
  await first.seedRating(A.rating, A.matches);
  await second.seedRating(B.rating, B.matches);
  await first.reload();
  await second.reload();
  for (const [player, seed] of [[first, A], [second, B]] as const) {
    const file = await player.rankFile();
    assert.equal(file?.rating, seed.rating, `${player.name} starts from the seeded number`);
    assert.equal(file?.matches, seed.matches);
  }

  // Quick race is the rated door (RK-05): both press it, both land in one room.
  await first.quickRace();
  await second.quickRace();
  assert.equal(await first.roomCode(), await second.roomCode(), 'the rank queue paired them');
  assert.equal(await first.drivers(), 2);

  // The host drops the lights; the race takes as long as it takes.
  await first.startRace();
  await second.race(90_000);
  await first.waitForGate(60_000);

  // ── the flag ────────────────────────────────────────────────────────────
  // Both screens stop on the results panel once the room has filed the race.
  await first.page.locator('.results-panel').waitFor({ timeout: FLAG_TIMEOUT_MS });
  await second.page.locator('.results-panel').waitFor({ timeout: FLAG_TIMEOUT_MS });

  const bandA = await first.ratingBand();
  const bandB = await second.ratingBand();
  assert.equal(bandA?.state, 'settled', 'the host’s race was rated and filed');
  assert.equal(bandB?.state, 'settled', 'and so was the guest’s');

  // 1. The deltas MATCH, seat for seat, read by name off the two screens.
  const rowsA = await first.resultsDeltas();
  const rowsB = await second.resultsDeltas();
  assert.equal(rowsA.length, 2, 'two rated humans, two rows');
  assert.equal(rowsB.length, 2);
  const byNameA = new Map(rowsA.map((row) => [row.name, row]));
  const byNameB = new Map(rowsB.map((row) => [row.name, row]));
  for (const name of byNameA.keys()) {
    const mine = byNameA.get(name)!;
    const theirs = byNameB.get(name);
    assert.ok(theirs, `${first.name} sees a row for ${name}, and so does ${second.name}`);
    assert.equal(mine.delta, theirs!.delta, `both screens show ${name} the same delta`);
    assert.equal(mine.tier, theirs!.tier, 'and the same badge after it');
  }
  // One race, two directions: the winner gains what the loser pays, and nobody
  // is left at zero — a rated race that moved nothing is the bug this catches.
  const deltas = [...byNameA.values()].map((row) => row.delta);
  assert.equal(deltas.filter((d) => d > 0).length, 1, 'exactly one driver gained');
  assert.equal(deltas.filter((d) => d < 0).length, 1, 'and the other paid for it');

  // Each driver's own file is the number their own band printed.
  const afterA = await first.rankFile();
  const afterB = await second.rankFile();
  assert.equal(String(afterA?.rating), bandA!.rating, 'the host’s file is the number their screen says');
  assert.equal(String(afterB?.rating), bandB!.rating, 'and the guest’s is theirs');
  assert.equal(afterA?.matches, A.matches + 1, 'the race counted once for the host');
  assert.equal(afterB?.matches, B.matches + 1, 'and once for the guest');

  // ── the reload ──────────────────────────────────────────────────────────
  // Back to the garage, then a full page load: the app re-reads the rating file
  // from storage, and the room's result — the one thing that could file this
  // race again — is not something a fresh page has in hand.
  await first.backToGarage();
  await first.reload();
  await second.reload();
  // Give a wrong implementation its chance to move the number: a double filing
  // driven by a boot-time read would land long before this.
  await first.page.waitForTimeout(2_000);
  const reloadedA = await first.rankFile();
  const reloadedB = await second.rankFile();
  assert.deepEqual(reloadedA, afterA, `the host’s file is unchanged by a reload (${JSON.stringify(reloadedA)})`);
  assert.deepEqual(reloadedB, afterB, 'and so is the guest’s');

  // The badge on the garage header agrees with the file, which is what a player
  // would see: one race, one move.
  const header = await first.headerRank();
  assert.equal(header.rating, String(afterA!.rating), 'the garage shows the number the race left behind');
});

/**
 * HexMatch's ranked rejoin spec ends on the survivor's side of an abandonment:
 * the win is filed and the rating row says the number moved. That is the flow
 * this test ports — the RACE continues without the driver who walked out, and
 * the seat that stayed is credited for it.
 *
 * The wall-clock price is the same as the spec above (a heat has to be raced to
 * the flag), which is why the two live in one file: one dev server, one browser,
 * and the slow half of the suite in one place.
 */
test('RK-06 ranked abandon: a guest who walks out mid-race still moves the host’s rating', { skip: skip || false, timeout: SPEC_TIMEOUT_MS }, async () => {
  const mp = await open();
  const host = await mp.player('ranked-leave-host');
  const guest = await mp.player('ranked-leave-guest');

  // A bracket of their own: a different bucket from the spec above (18, not 17)
  // and off every earlier run's values, because the sidecar's rooms outlive the
  // process that opened them.
  await host.seedRating(1340, 12);
  await guest.seedRating(1350, 12);
  await host.reload();
  await guest.reload();

  await host.quickRace();
  await guest.quickRace();
  assert.equal(await host.roomCode(), await guest.roomCode(), 'one ranked lobby');

  await host.startRace();
  await guest.race(90_000);
  await host.waitForGate(60_000);
  assert.ok((await host.raceTime()) > 0, 'the lights are out');

  // The guest walks out of a LIVE rated race. The room is the witness: it marks
  // the seat departed, and every seat files that mark, not the marble’s finish.
  const leaver = (await guest.page.locator('.driver-grid .is-player strong').count())
    ? (await guest.page.locator('.driver-grid .is-player strong').innerText()).trim()
    : 'the guest';
  await guest.page.getByRole('button', { name: /leave race/i }).click();

  // The host races it out alone; the room files the race when the flag falls.
  await host.page.locator('.results-panel').waitFor({ timeout: FLAG_TIMEOUT_MS });
  const band = await host.ratingBand();
  assert.equal(band?.state, 'settled', 'the abandoned race is still classified and filed');
  assert.match(band!.delta, /^\+/, `the survivor is credited with the win (${band!.delta})`);

  const rows = await host.resultsDeltas();
  assert.equal(rows.length, 2, 'the survivor keeps a row for the driver who left');
  const survivor = rows.find((row) => row.mine);
  const departed = rows.find((row) => !row.mine);
  assert.ok(survivor && survivor.delta > 0, 'the seat that stayed moves up');
  assert.ok(departed, `the leaver keeps their row (${leaver})`);
  assert.ok(departed!.delta < 0, 'and pays for walking out, exactly as the unit tests say');

  // And the file agrees with the screen: one race, one move, upwards.
  const file = await host.rankFile();
  assert.equal(file?.matches, 13, 'the abandoned race counted for the survivor, once');
  assert.equal(String(file?.rating), band!.rating);
});
