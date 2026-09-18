// ══════════════════════════════════════════════════════════════════════════
// RK-05 (#59) — the rank surfaces' view models.
//
// `rank-view.ts` is the half of RK-05 that is not markup: which badge and which
// number a chip shows, and what the results screen is allowed to say about a
// race. Both are asserted here without a browser, because both are the kind of
// thing a player notices: a rival printed as "1000" when their number never
// arrived, a `+0` on a race that did not count, a promotion announced for a win
// that moved nothing.
//
// The painted half (the chip, the band, the ladder panel) is in
// `tests/lobby-ui.test.ts`, through vite's SSR pipeline.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_RATED_FIELD,
  RANK_TIERS,
  START_RATING,
  UNRANKED_KEY,
  applyRaceResult,
  freshRankState,
  rateRaceOutcome,
  ratedPlayerFor,
  type RaceEntry,
  type RatedPlayer,
  type RankState,
} from '../src/net/rating';
import {
  chipOf,
  chipOfBoard,
  chipOfWire,
  isProvisional,
  rankedViewFor,
} from '../src/game/rank-view';

/** A driver's board row, the way the room's board carries it. */
const player = (playerId: string, rating: number, games = 12): RatedPlayer =>
  ({ playerId, rating, games });

/** A one-race verdict, computed the way the runtime computes it. */
function verdictFor(self: RankState, board: RatedPlayer[], order: RaceEntry[]) {
  return rateRaceOutcome({ self: { playerId: 'me', state: self }, board, order });
}

test('RK-05 chips: the tier a rating names, the badge that goes with it', () => {
  const state = { rating: 1462, matches: 14 };
  const chip = chipOf(state);
  assert.equal(chip.rating, 1462);
  assert.equal(chip.key, 'steel', '1462 is in Steel’s band (1400–1550)');
  assert.equal(chip.label, 'Steel');
  assert.equal(chip.games, 14);

  // Every key a chip can return is one of the ladder's, in ladder order — the
  // badge table and the arithmetic are the same list (`RANK_BADGES` in
  // `src/game/rank-badge.ts` is built from `RANK_TIERS`).
  const keys = RANK_TIERS.map((tier) => tier.key);
  for (const tier of RANK_TIERS) {
    assert.equal(chipOf({ rating: tier.min + 1, matches: 5 }).key, tier.key);
  }
  assert.equal(chipOf({ rating: 2500, matches: 5 }).key, keys[keys.length - 1], 'the top band is open-ended');
});

test('RK-05 chips: a driver with no rated race is UNRANKED, not Scrap', () => {
  // The state, not a band: a fresh file at 1000 is inside Scrap's numbers, and
  // printing "Scrap" at a player who has never raced would be a rank they have
  // not earned.
  const chip = chipOf(freshRankState());
  assert.equal(chip.key, UNRANKED_KEY);
  assert.equal(chip.label, 'Unranked');
  assert.equal(chip.rating, START_RATING, 'the number is still printed — it is where they start');
  assert.ok(isProvisional(chip.games));
});

test('RK-05 chips: a seat the room has not heard from shows no number', () => {
  // Null is a real state, and it must not become a 1000: the player is about to
  // race this opponent, and a guessed number is worse than an honest blank.
  const chip = chipOfWire(null);
  assert.equal(chip.rating, null);
  assert.equal(chip.key, UNRANKED_KEY);
  assert.equal(chip.label, 'Unrated');

  const known = chipOfWire({ rating: 1731, games: 22 });
  assert.equal(known.rating, 1731);
  assert.equal(known.key, 'gold-gear', '1731 is gold, one band below the top');
  assert.equal(known.games, 22);
  assert.equal(chipOfWire({ rating: 1800, games: 22 }).key, 'heavy-metal');
});

test('RK-05 chips: a ladder row prints the board’s peak number', () => {
  const chip = chipOfBoard(1288);
  assert.equal(chip.rating, 1288);
  assert.equal(chip.key, 'iron');
  assert.equal(chip.games, 1, 'the board carries a number, not a history');
  assert.equal(isProvisional(chip.games), true, 'and it is honest that we know nothing else');
});

// ── the results screen ────────────────────────────────────────────────────

test('RK-05 results: a raced-but-unfiled race prints as PENDING, never as a zero', () => {
  for (const rated of [true, false]) {
    const view = rankedViewFor({ verdict: null, rated, current: chipOf({ rating: 1200, matches: 9 }) });
    assert.equal(view.state, rated ? 'pending' : 'unrated');
    assert.equal(view.self, null, 'no verdict, no numbers moved');
    assert.equal(view.rows.length, 0);
    assert.equal(view.current?.rating, 1200, 'and the card the driver already has is still printable');
  }
});

test('RK-05 results: a friendly race says nothing moved, and why', () => {
  const verdict = verdictFor(freshRankState(), [player('me', 1200), player('rival', 1180)], [
    { playerId: 'me', finished: true },
    { playerId: 'rival', finished: true },
  ]);
  const view = rankedViewFor({ verdict, rated: false });
  assert.equal(view.state, 'unrated');
  assert.equal(view.reason, 'room', 'the ROOM refused to rate it — the arithmetic would have');
  assert.equal(view.rows.length, 0);
  assert.equal(verdict.rated, true, 'the arithmetic had a field: the room’s rules are what stopped it');
});

test('RK-05 results: a rated lobby with nobody else in it says "alone"', () => {
  const solo = rateRaceOutcome({
    self: { playerId: 'me', state: freshRankState() },
    board: [player('me', 1200)],
    order: [{ playerId: 'me', finished: true }],
  });
  const view = rankedViewFor({ verdict: solo, rated: true });
  assert.equal(view.state, 'unrated');
  assert.equal(view.reason, 'alone');
  assert.ok(1 < MIN_RATED_FIELD, 'the field really is below the floor');
});

test('RK-05 results: a settled race prints a row per rated human, self included', () => {
  const board = [player('me', 1200), player('rival-a', 1300, 20), player('rival-b', 1100, 5)];
  const order: RaceEntry[] = [
    { playerId: 'rival-a', finished: true },
    { playerId: 'me', finished: true },
    { playerId: 'rival-b', finished: true },
  ];
  const verdict = verdictFor(freshRankState(1200), board, order);
  const view = rankedViewFor({
    verdict,
    rated: true,
    names: { 'rival-a': 'Sprocket', 'rival-b': 'Brakka' },
    seats: [{ slot: 0, playerId: 'me' }, { slot: 3, playerId: 'rival-a' }, { slot: 7, playerId: 'rival-b' }],
    current: chipOf({ rating: 1200, matches: 11 }),
  });

  assert.equal(view.state, 'settled');
  assert.equal(view.rows.length, 3, 'every rated human, in one list');
  assert.deepEqual(view.rows.map((row) => row.position), [1, 2, 3]);
  assert.deepEqual(view.rows.map((row) => row.name), ['Sprocket', 'You', 'Brakka']);
  assert.equal(view.self?.name, 'You');
  assert.equal(view.self?.rating, verdict.state.rating);
  assert.equal(view.self?.delta, verdict.change.delta);
  assert.equal(view.byId['rival-a']?.name, 'Sprocket');
  // The results table draws by SEAT, and a rating is filed by PLAYER: the view
  // is the one place the two numberings meet.
  assert.equal(view.bySeat[3]?.playerId, 'rival-a');
  assert.equal(view.bySeat[7]?.playerId, 'rival-b');
  assert.equal(view.bySeat[0]?.playerId, 'me');
  assert.equal(view.bySeat[1], undefined, 'an AI seat has no rating row');
  assert.equal(view.promoted, false);
  assert.equal(view.demoted, false);
  assert.equal(view.stored, true);
  assert.equal(view.forfeit, false);
});

test('RK-05 results: a promotion is a BAND change, and the row prints it', () => {
  // 1096 → 1104 crosses into Bronze Bolt (1100) on a single win.
  const state: RankState = { rating: 1096, matches: 4, wins: 1, losses: 3, season: 's1' };
  const verdict = verdictFor(state, [player('me', 1096, 4), player('rival', 1090, 40)], [
    { playerId: 'me', finished: true },
    { playerId: 'rival', finished: false },
  ]);
  assert.ok(verdict.change.delta > 0);
  const view = rankedViewFor({ verdict, rated: true, names: { rival: 'Sprocket' } });
  assert.equal(view.promoted, true, '1096 → 1104 leaves Scrap');
  assert.equal(view.demoted, false);
  assert.equal(view.self?.key, 'bronze-bolt');
  assert.equal(view.self?.provisional, true, 'four races in, still placing');
  assert.deepEqual(view.rows.map((row) => row.finished), [true, false], 'the DNF rival keeps their row');
});

test('RK-05 results: a refused write is said out loud, not hidden', () => {
  const verdict = verdictFor(freshRankState(1200), [player('me', 1200), player('rival', 1250)], [
    { playerId: 'rival', finished: true },
    { playerId: 'me', finished: true },
  ]);
  const view = rankedViewFor({ verdict, rated: true, stored: false });
  assert.equal(view.state, 'settled');
  assert.equal(view.stored, false, 'the number moved on screen and may not survive a reload');
  assert.equal(view.self!.delta < 0, true, 'a loss to a stronger driver still lowers the rating');
});

test('RK-05 results: a race the room did not rate prints no delta at all', () => {
  // The room's `rated: false` is what every seat files from: the arithmetic may
  // well have had a field, and nothing moved.
  const verdict = verdictFor(freshRankState(1200), [player('me', 1200), player('rival', 1200)], [
    { playerId: 'me', finished: true },
    { playerId: 'rival', finished: false },
  ]);
  const unrated = { ...verdict, rated: false };
  const view = rankedViewFor({ verdict: unrated, rated: true });
  assert.equal(view.state, 'unrated');
  assert.equal(view.self, null);
  assert.equal(unrated.change.delta > 0, true, 'the arithmetic still says what it would have been worth');
});

test('RK-05 results: a leaver’s own final row is a forfeit, not a finish', () => {
  const verdict = verdictFor(freshRankState(1200), [player('me', 1200), player('rival', 1300)], [
    { playerId: 'rival', finished: true },
    { playerId: 'me', finished: false, left: true },
  ]);
  const view = rankedViewFor({ verdict, rated: true, names: { rival: 'Sprocket' } });
  assert.equal(view.forfeit, true);
  assert.equal(view.self?.finished, false);
  assert.equal(view.self?.position, 2);
  assert.equal(view.self!.delta < 0, true);
  // And the survivor's row is the same race mirrored: they finished first.
  assert.equal(view.byId.rival?.finished, true);
  assert.equal(view.byId.rival?.position, 1);
  assert.equal(applyRaceResult({ playerId: 'me', state: freshRankState(1200) }, [player('me', 1200), player('rival', 1300)], [
    { playerId: 'rival', finished: true },
    { playerId: 'me', finished: false, left: true },
  ]).rated, true);
});

test('RK-05 results: a rival the room never heard from is marked unknown', () => {
  // The runtime builds the field from the CLASSIFICATION read through the
  // room's board (`fieldOf`), so a rival the board never heard from is still a
  // rated seat — with a guessed 1000 and `known: false`, which is what lets the
  // results screen say part of this field was unrated.
  const board = [player('me', 1200), ratedPlayerFor({}, 'ghost')];
  const verdict = verdictFor(freshRankState(1200), board, [
    { playerId: 'me', finished: true },
    { playerId: 'ghost', finished: false },
  ]);
  const view = rankedViewFor({ verdict, rated: true, names: { ghost: 'Ghost' } });
  assert.equal(view.state, 'settled');
  assert.equal(view.self?.known, true, 'this driver was on the board');
  assert.equal(view.byId.ghost?.known, false, 'and the rival was not — the results say so');
  assert.equal(view.byId.ghost?.name, 'Ghost', 'a named seat still prints its name');
  // The row prints the number AFTER the race, and that number came off the
  // guess — a provisional swing of the fresh 1000, not a reading of anything.
  assert.ok(Math.abs((view.byId.ghost?.rating ?? 0) - 1000) < 40, 'a guess, and `known` is what marks it as one');
});
