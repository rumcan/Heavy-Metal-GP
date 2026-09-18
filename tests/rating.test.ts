// ══════════════════════════════════════════════════════════════════════════
// RK-01 — the rating arithmetic, the tiers, and the files a race writes.
//
// `src/net/rating.ts` is pure on purpose: every claim the epic makes ("rises
// when they win, falls when they lose, weighted by the opponent's rating",
// "K-factor higher for new players", "a badge per tier") is a number that can
// be checked here without a room, a socket or a browser.
//
// The suite has three halves:
//
//   1. HexMatch's own RANK-01 tests, ported and adapted to a race (the number,
//      the K split, the tiers, the stored file, the wire);
//   2. the things a RACE adds — the pair as the unit of a result, the
//      `(humans − 1)` division, order monotonicity, the DNF and leaver rules,
//      AI seats staying off the board;
//   3. the two claims the epic's acceptance names outright: a two-human race
//      equals a HexMatch duel EXACTLY, and a six-driver race's deltas sum to
//      about zero.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  K_ESTABLISHED,
  K_PROVISIONAL,
  MIN_RATED_FIELD,
  PROVISIONAL_MATCHES,
  RANK_SEASON,
  RANK_TIERS,
  RATING_FLOOR,
  START_RATING,
  UNRANKED_KEY,
  advanceRating,
  applyRaceResult,
  clampRating,
  expectedScore,
  fmtRating,
  fmtRatingDelta,
  freshRankState,
  kFactor,
  ladderScoreFor,
  parseRankState,
  parseRankWire,
  rankBoardFrom,
  rankKeyOf,
  rankLabelOf,
  rankOf,
  rankSummary,
  rateDuel,
  rateRace,
  rateRaceOutcome,
  ratedPlayerFor,
  ratedPlayersFrom,
  searchBucket,
  serializeRankState,
  tierProgress,
  winRate,
  type RaceEntry,
  type RankState,
  type RatedPlayer,
} from '../src/net/rating';

/** A rated seat on the board. */
const seat = (playerId: string, rating = START_RATING, games = 0): RatedPlayer =>
  ({ playerId, rating, games });
/** A finisher's row in the room's classification. */
const fin = (playerId: string): RaceEntry => ({ playerId, finished: true });
/** A non-finisher, or a leaver — the two read the same to the arithmetic. */
const dnf = (playerId: string, left = false): RaceEntry =>
  ({ playerId, finished: false, ...(left ? { left: true } : {}) });

const changeOf = (changes: ReturnType<typeof rateRace>, playerId: string) => {
  const found = changes.find((c) => c.playerId === playerId);
  assert.ok(found, `no change for ${playerId}`);
  return found;
};

// ══════════════════════════════════════════════════════════════════════════
// 1. The Elo number
// ══════════════════════════════════════════════════════════════════════════

test('RK-01 starts everyone at 1000, in Scrap, with no badge until the first rated race', () => {
  const fresh = freshRankState();
  assert.equal(fresh.rating, START_RATING);
  assert.equal(fresh.matches, 0);
  // 1000 is inside Scrap's band: the ladder starts at the bottom of the yard,
  // and the first few wins are the promotion.
  assert.equal(rankOf(START_RATING).key, 'scrap');
  // …but the BADGE is unranked until a race has actually been filed: a driver
  // who has never raced should not be shown a rank they earned nothing for.
  assert.equal(rankKeyOf(fresh), UNRANKED_KEY);
  assert.equal(rankLabelOf(fresh), 'Unranked');
});

test('RK-01 gives the lower-rated driver more for a win than the higher-rated one', () => {
  const even = rateRace([seat('a'), seat('b')], [fin('a'), fin('b')]);
  assert.ok(changeOf(even, 'a').delta > 0);
  assert.ok(changeOf(even, 'b').delta < 0);
  // Zero-sum in magnitude when both are provisional: one K, one expectation.
  assert.equal(changeOf(even, 'a').delta, -changeOf(even, 'b').delta);

  // `upset` is the 900 beating the 1300 (`loser` is therefore the FAVOURITE),
  // `routine` is the favourite winning (`loser` is the underdog).
  const upset = rateDuel(seat('a', 900, 10), seat('b', 1300, 10));
  const routine = rateDuel(seat('a', 1300, 10), seat('b', 900, 10));
  assert.ok(upset.winner.delta > routine.winner.delta);
  // …and the favourite who loses pays far more than an underdog who loses.
  assert.ok(upset.loser.delta < routine.loser.delta);
});

test('RK-01 moves a provisional driver faster than an established one', () => {
  assert.equal(kFactor(0), K_PROVISIONAL);
  assert.equal(kFactor(PROVISIONAL_MATCHES - 1), K_PROVISIONAL);
  assert.equal(kFactor(PROVISIONAL_MATCHES), K_ESTABLISHED);
  assert.ok(K_PROVISIONAL > K_ESTABLISHED);

  const newcomer = applyRaceResult(
    { playerId: 'a', state: freshRankState() },
    [seat('a'), seat('b', 1000, 40)],
    [fin('a'), fin('b')],
  );
  const veteran = applyRaceResult(
    { playerId: 'a', state: { ...freshRankState(), rating: 1000, matches: 40 } },
    [seat('a', 1000, 40), seat('b', 1000, 40)],
    [fin('a'), fin('b')],
  );
  assert.ok(newcomer.change.delta > veteran.change.delta);
});

test('RK-01 never lets a rating below the floor, however long the losing run', () => {
  // Losing to somebody at your own level, which is what actually drains a
  // rating: Elo has the underdog losing to a giant pay almost nothing, so a
  // floor test that fed the driver to a 2000-rated opponent would never reach
  // it (and would be testing the wrong belief).
  let state: RankState = { ...freshRankState(), rating: RATING_FLOOR + 2, matches: 0 };
  for (let i = 0; i < 40; i++) {
    state = applyRaceResult(
      { playerId: 'a', state },
      [seat('a', state.rating, state.matches), seat('b', state.rating, 50)],
      [fin('b'), fin('a')],
    ).state;
  }
  assert.equal(state.rating, RATING_FLOOR);
  assert.equal(clampRating(-500), RATING_FLOOR);
  assert.equal(clampRating(Number.NaN), START_RATING);
  assert.equal(ladderScoreFor(Number.POSITIVE_INFINITY), START_RATING);
});

test('RK-01 keeps the two seats’ numbers consistent with one another', () => {
  // The classic Elo bug is updating the winner first and then reading the new
  // number as the loser's opponent. `rateRace` computes every half from the
  // SAME pre-race board, so a rating is never compared with itself.
  const a = seat('a', 1180, 3);
  const b = seat('b', 1420, 25);
  const expectation = expectedScore(a.rating, b.rating);
  const duel = rateDuel(a, b);
  assert.equal(duel.winner.after, clampRating(a.rating + K_PROVISIONAL * (1 - expectation)));
  assert.equal(duel.loser.after, clampRating(b.rating - K_ESTABLISHED * (1 - expectation)));

  const race = rateRace([a, b], [fin('a'), fin('b')]);
  assert.deepEqual(changeOf(race, 'a'), duel.winner);
  assert.deepEqual(changeOf(race, 'b'), duel.loser);
});

test('RK-01 counts races, wins and losses the way the file says it does', () => {
  let state = freshRankState();
  const filed = (opponentId: string, order: RaceEntry[]) =>
    applyRaceResult(
      { playerId: 'a', state },
      [seat('a', state.rating, state.matches), seat(opponentId, 1000, 0)],
      order,
    );

  state = filed('b', [fin('a'), fin('b')]).state;
  state = filed('c', [fin('c'), fin('a')]).state;
  assert.equal(state.matches, 2);
  assert.equal(state.wins, 1);
  assert.equal(state.losses, 1);
  assert.equal(state.season, RANK_SEASON);
  // In a race "not the winner" is every other position, and the file counts
  // flags rather than places.
  assert.equal(state.wins + state.losses, state.matches);
  assert.equal(winRate(state), '50%');
  assert.equal(winRate(freshRankState()), '—');
});

test('RK-01 reports promotions and demotions only when the BAND changes', () => {
  const board = (self: number, games: number): RatedPlayer[] =>
    [seat('a', self, games), seat('b', 1000, 0)];
  // A win that crosses 1100 is a promotion; one that does not is just a win.
  const promotion = applyRaceResult(
    { playerId: 'a', state: { ...freshRankState(), rating: 1095, matches: 4, wins: 3, losses: 1 } },
    board(1095, 4),
    [fin('a'), fin('b')],
  );
  assert.equal(promotion.promoted, true);
  assert.equal(promotion.tierAfter.key, 'bronze-bolt');
  assert.equal(promotion.tierBefore.key, 'scrap');

  const stays = applyRaceResult(
    { playerId: 'a', state: { ...freshRankState(), rating: 1010, matches: 4, wins: 3, losses: 1 } },
    board(1010, 4),
    [fin('a'), fin('b')],
  );
  assert.equal(stays.promoted, false);

  // An even race at the very bottom of a band: the loss that relegates.
  const drops = applyRaceResult(
    { playerId: 'a', state: { ...freshRankState(), rating: 1102, matches: 30, wins: 20, losses: 10 } },
    [seat('a', 1102, 30), seat('b', 1102, 30)],
    [fin('b'), fin('a')],
  );
  assert.equal(drops.demoted, true);
  assert.equal(drops.tierAfter.key, 'scrap');
});

test('RK-01 prints the rating and the delta the way the HUD does', () => {
  assert.equal(fmtRating(1042.6), '1043');
  assert.equal(fmtRatingDelta(18), '+18');
  // The typographic minus, matching the rest of the HUD.
  assert.equal(fmtRatingDelta(-14), '−14');
  assert.equal(fmtRatingDelta(0), '+0');
  assert.equal(rankSummary(freshRankState()), 'Unranked · placement');
  // 1240 is still Bronze Bolt: Iron starts at 1250, and the bands are the table's.
  assert.equal(rankSummary({ ...freshRankState(), rating: 1240, matches: 12 }), '1240 · Bronze Bolt');
  assert.equal(rankSummary({ ...freshRankState(), rating: 1030, matches: 4 }), '1030 · Scrap · 6 to go');
});

test('RK-01 buckets a similar-rank search window, and treats zero as any rank', () => {
  // The pool matches criteria by equality, so a window is a bucket index.
  // Two drivers inside one bucket meet; a wider span moves both into a
  // coarser bucket, which is what "the window widens" means on the wire.
  assert.equal(searchBucket(1000, 75), 13);
  assert.equal(searchBucket(1010, 75), 13);      // same neighbourhood
  assert.equal(searchBucket(1180, 400), 3);
  assert.equal(searchBucket(1240, 400), 3);      // a wider window catches both
  assert.equal(searchBucket(1000, 400), 3);
  // …and the same pair does NOT share the tightest window.
  assert.notEqual(searchBucket(1180, 75), searchBucket(1240, 75));
  // Any rank: no criterion at all.
  assert.equal(searchBucket(1000, 0), null);
  assert.equal(searchBucket(1000, -5), null);
  // Bucket keys stay integers (the pool accepts numbers, and this is one).
  assert.ok(Number.isInteger(searchBucket(1234, 100)!));
});

test('RK-01 walks the tiers upward, with the top band open-ended', () => {
  assert.deepEqual(
    RANK_TIERS.map((t) => t.key),
    ['scrap', 'bronze-bolt', 'iron', 'steel', 'gold-gear', 'heavy-metal'],
  );
  // The bands are HexMatch's, unadjusted, and the names are this game's.
  assert.deepEqual(RANK_TIERS.map((t) => t.min), [0, 1100, 1250, 1400, 1550, 1750]);
  assert.deepEqual(
    RANK_TIERS.map((t) => t.label),
    ['Scrap', 'Bronze Bolt', 'Iron', 'Steel', 'Gold Gear', 'Heavy Metal'],
  );
  // Bands are contiguous and ascending: no rating belongs to no tier.
  for (let i = 1; i < RANK_TIERS.length; i++) {
    assert.ok(RANK_TIERS[i].min > RANK_TIERS[i - 1].min);
    assert.equal(rankOf(RANK_TIERS[i].min).key, RANK_TIERS[i].key);
    assert.equal(rankOf(RANK_TIERS[i].min - 1).key, RANK_TIERS[i - 1].key);
  }
  // The top band has no ceiling — 4000 is still Heavy Metal, not a missing tier.
  assert.equal(rankOf(4000).key, 'heavy-metal');

  const early = tierProgress(1125);
  assert.equal(early.tier.key, 'bronze-bolt');
  assert.equal(early.next?.key, 'iron');
  assert.equal(early.toNext, 125);
  assert.ok(Math.abs(early.fraction - (1125 - 1100) / 150) < 1e-5);
  const top = tierProgress(2400);
  assert.equal(top.next, null);
  assert.equal(top.fraction, 1);
  assert.equal(top.toNext, 0);
});

// ══════════════════════════════════════════════════════════════════════════
// 2. What a RACE adds: the pair is the unit, and the field is the divisor
// ══════════════════════════════════════════════════════════════════════════

test('RK-01 a two-human race equals a HexMatch duel exactly (the epic’s acceptance)', () => {
  const pairs: [number, number, number][] = [
    // [a's rating, b's rating, a's games] — a wins all of them.
    [1000, 1000, 0],
    [1000, 1000, 40],
    [1180, 1420, 3],
    [900, 1300, 10],
    [1050, 990, 12],
    [RATING_FLOOR, 1900, 2],
  ];
  for (const [ra, rb, games] of pairs) {
    const a = seat('a', ra, games);
    const b = seat('b', rb, 25);
    const duel = rateDuel(a, b);
    const race = rateRace([a, b], [fin('a'), fin('b')]);
    assert.deepEqual(changeOf(race, 'a'), duel.winner, `winner ${ra} vs ${rb} @${games}`);
    assert.deepEqual(changeOf(race, 'b'), duel.loser, `loser ${ra} vs ${rb} @${games}`);
  }
});

test('RK-01 divides each driver’s K by (humans − 1), so a full grid moves one duel’s worth', () => {
  const grid = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => seat(id, 1000, 20));
  const order = grid.map((p) => fin(p.playerId));
  const changes = rateRace(grid, order);
  // Every pair is a head-to-head: a 5-division on a 5-opponent sum.
  assert.equal(changeOf(changes, 'a').k, K_ESTABLISHED / 5);
  assert.equal(changeOf(changes, 'a').opponents, 5);
  // An even six-marble race pays its winner exactly what an even duel pays —
  // K/2 — because the divisions cancel against the count of pairs.
  assert.equal(changeOf(changes, 'a').delta, K_ESTABLISHED / 2);
  assert.equal(rateDuel(seat('a', 1000, 20), seat('b', 1000, 20)).winner.delta, K_ESTABLISHED / 2);
  // …and the marble at the back pays exactly what a duel's loser pays.
  assert.equal(changeOf(changes, 'f').delta, -K_ESTABLISHED / 2);
  // A provisional driver on the same grid moves at the provisional rate.
  const rookies = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => seat(id, 1000, 0));
  assert.equal(changeOf(rateRace(rookies, order), 'a').delta, K_PROVISIONAL / 2);
});

test('RK-01 a six-driver race’s deltas sum to about zero (the epic’s acceptance)', () => {
  // The pairwise contributions cancel exactly while every K matches, so the
  // only residue is the rounding to whole points. This is what "the ladder is
  // not inflating" means as arithmetic.
  const ratings = [1013, 997, 1024, 968, 1105, 1042];
  const grid = ratings.map((rating, i) => seat(String.fromCharCode(97 + i), rating, 20));
  const order = grid.map((p) => fin(p.playerId));
  const changes = rateRace(grid, order);
  const total = changes.reduce((acc, c) => acc + c.delta, 0);
  assert.ok(Math.abs(total) <= changes.length / 2, `rounding residue of ${total}`);

  // The same board with a provisional driver in it: the pairs no longer
  // cancel, because a newcomer takes more off a veteran than the veteran takes
  // off them. That is the K split doing its job, not a bug — the ladder's
  // total still only drifts by the difference in K.
  const mixed = grid.map((p, i) => (i === 0 ? { ...p, games: 0 } : p));
  const mixedTotal = rateRace(mixed, order).reduce((acc, c) => acc + c.delta, 0);
  assert.ok(mixedTotal > 0, 'a provisional winner takes more than the field pays back');
  assert.ok(mixedTotal < K_PROVISIONAL, 'and nowhere near a whole match');
});

test('RK-01 finishing higher never pays less (monotonicity)', () => {
  const grid = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => seat(id, [1000, 1200, 900, 1100, 1050, 980][i], 20));
  const others = ['a', 'b', 'd', 'e', 'f'];
  let previous = Number.NEGATIVE_INFINITY;
  // 'c' walks from last to first; the board never changes, so the only thing
  // moving is the classification.
  for (let position = 5; position >= 0; position--) {
    const order = [...others.slice(0, position), 'c', ...others.slice(position)].map(fin);
    const delta = changeOf(rateRace(grid, order), 'c').delta;
    assert.ok(delta >= previous, `P${position + 1} paid ${delta}, worse than the place behind it`);
    previous = delta;
  }
  // …and the extremes really are ordered, so the test is not vacuous.
  const first = changeOf(rateRace(grid, ['c', ...others].map(fin)), 'c').delta;
  const last = changeOf(rateRace(grid, [...others, 'c'].map(fin)), 'c').delta;
  assert.ok(first > last, `${first} should beat ${last}`);
});

test('RK-01 ignores AI seats, and never rates a field of one', () => {
  const board = [seat('a', 1000, 20), seat('b', 1000, 20)];
  // Ids 0..5 are AI marbles in the room's classification: they are not on the
  // board, so they are not opponents and they get no verdict of their own.
  const order: RaceEntry[] = [fin('a'), fin('0'), fin('1'), fin('b')];
  const changes = rateRace(board, order);
  assert.equal(changes.length, board.length, 'one change per rated human, and no more');
  // Two humans, so this is a duel whatever the AI marbles did between them.
  assert.deepEqual(changes, rateRace(board, [fin('a'), fin('b')]));

  // A solo race is not rated at all: nothing moves, and nothing is filed —
  // the provisional counter must not tick down without an opponent.
  const solo = applyRaceResult(
    { playerId: 'a', state: freshRankState() },
    [seat('a')],
    [fin('a'), fin('0'), fin('1')],
  );
  assert.equal(solo.rated, false);
  assert.equal(solo.change.delta, 0);
  assert.equal(solo.change.k, 0);
  assert.equal(solo.change.position, 0);
  assert.deepEqual(solo.state, freshRankState(), 'an unrated race leaves the file untouched');
  assert.equal(MIN_RATED_FIELD, 2);
});

// ══════════════════════════════════════════════════════════════════════════
// 3. DNFs and leavers
// ══════════════════════════════════════════════════════════════════════════

test('RK-01 ranks a DNF below every finisher, and ties two DNFs', () => {
  const board = [seat('a', 1000, 20), seat('b', 1000, 20), seat('c', 1000, 20), seat('d', 1000, 20)];
  // An even field, so the places are the only thing that can move a number.
  const changes = rateRace(board, [fin('a'), fin('b'), fin('c'), dnf('d')]);
  assert.equal(changeOf(changes, 'a').delta, 8);
  assert.equal(changeOf(changes, 'd').delta, -8, 'the DNF loses to all three finishers');
  assert.equal(changes.reduce((acc, c) => acc + c.delta, 0), 0);
  assert.equal(changeOf(changes, 'a').position, 1);
  assert.equal(changeOf(changes, 'd').position, 4);
  assert.equal(changeOf(changes, 'd').finished, false);

  // Two DNFs TIE: neither got home, and their array positions must not invent
  // a result the scoreboard does not have.
  const tied = rateRace(board, [fin('a'), fin('b'), dnf('c'), dnf('d')]);
  assert.equal(changeOf(tied, 'c').delta, changeOf(tied, 'd').delta);
  assert.equal(changeOf(tied, 'c').delta, -5);

  // A DNF listed ABOVE a finisher (a malformed classification) is put back
  // below it rather than believed.
  const malformed = rateRace(board, [dnf('d'), fin('a'), fin('b'), fin('c')]);
  assert.equal(changeOf(malformed, 'd').delta, changeOf(changes, 'd').delta);
  assert.equal(changeOf(malformed, 'd').position, 4);
});

test('RK-01 treats a leaver as a DNF however the classification read', () => {
  const board = [seat('a', 1000, 20), seat('b', 1000, 20), seat('c', 1000, 20)];
  // The AI took their marble over (MP-08) and it rolled home — but they were
  // not there to see it, so on the scoreboard they abandoned.
  const left = rateRace(board, [fin('a'), fin('b'), { playerId: 'c', finished: true, left: true }]);
  const gone = rateRace(board, [fin('a'), fin('b'), dnf('c')]);
  assert.deepEqual(left, gone);
  assert.equal(changeOf(left, 'c').delta, -8);
  assert.equal(changeOf(left, 'c').finished, false);

  // A driver the room never classified at all is a DNF too: no evidence of
  // finishing is a non-finish.
  const unlisted = rateRace(board, [fin('a'), fin('b'), { playerId: 'c', finished: false }]);
  assert.deepEqual(unlisted, gone);
});

// ══════════════════════════════════════════════════════════════════════════
// 4. The verdict the ending screen reads
// ══════════════════════════════════════════════════════════════════════════

test('RK-01 produces the verdict a race’s ending screen reads', () => {
  const state: RankState = { rating: 1200, matches: 8, wins: 5, losses: 3, season: RANK_SEASON };
  const board = [seat('me', 1200, 8), seat('rival-1', 1250, 20), seat('rival-2', 1150, 20)];
  const verdict = rateRaceOutcome({
    self: { playerId: 'me', state },
    board,
    order: [fin('rival-1'), fin('me'), fin('rival-2')],
  });

  assert.equal(verdict.playerId, 'me');
  assert.equal(verdict.rated, true);
  assert.equal(verdict.won, false);
  assert.equal(verdict.position, 2);
  assert.equal(verdict.field, 3);
  assert.equal(verdict.finished, true);
  assert.equal(verdict.forfeit, false);
  assert.equal(verdict.change.before, 1200);
  assert.equal(verdict.state.rating, verdict.change.after);
  assert.equal(verdict.state.matches, 9);
  assert.equal(verdict.state.losses, 4);
  // Every rival's new number, in finishing order — the results screen prints
  // the field, not one opponent.
  assert.deepEqual(verdict.rivals.map((r) => r.playerId), ['rival-1', 'rival-2']);
  assert.equal(verdict.rivals[0].position, 1);
  assert.ok(verdict.rivals[0].delta > 0);
  assert.ok(verdict.rivals[1].delta < 0);
  assert.equal(verdict.fieldKnown, true);

  // A winner's verdict, and the leaver's own file: a forfeit is a loss.
  const win = rateRaceOutcome({
    self: { playerId: 'me', state },
    board,
    order: [fin('me'), fin('rival-1'), fin('rival-2')],
  });
  assert.equal(win.won, true);
  assert.equal(win.state.wins, 6);
  assert.ok(win.change.delta > 0);

  const quit = rateRaceOutcome({
    self: { playerId: 'me', state },
    board,
    order: [fin('rival-1'), fin('rival-2'), { playerId: 'me', finished: true, left: true }],
  });
  assert.equal(quit.forfeit, true);
  assert.equal(quit.finished, false);
  assert.equal(quit.position, 3);
  assert.equal(quit.won, false);
  assert.ok(quit.change.delta < 0);
});

test('RK-01 reads an unpublished driver as a fresh 1000, and says so', () => {
  const board = rankBoardFrom([
    { playerId: 'host', rating: 1240, games: 12 },
    { playerId: 'guest', rating: 1080, games: 3 },
  ]);
  assert.deepEqual(board.host, { rating: 1240, games: 12 });
  assert.deepEqual(ratedPlayerFor(board, 'host'), { playerId: 'host', rating: 1240, games: 12, known: true });
  assert.deepEqual(ratedPlayerFor(board, 'somebody-else'), {
    playerId: 'somebody-else', rating: START_RATING, games: 0, known: false,
  });

  // The field is the HUMANS the room seated, not the ratings that arrived: a
  // silent driver stays in the arithmetic at 1000/0 so nobody's race quietly
  // becomes a duel, and the verdict admits the number was a guess.
  const field = ratedPlayersFrom(board, ['host', 'guest', 'silent', 'host']);
  assert.deepEqual(field.map((p) => p.playerId), ['host', 'guest', 'silent']);
  const verdict = rateRaceOutcome({
    self: { playerId: 'host', state: { ...freshRankState(), rating: 1240, matches: 12 } },
    board: field,
    order: [fin('host'), fin('guest'), fin('silent')],
  });
  assert.equal(verdict.field, 3);
  assert.equal(verdict.fieldKnown, false);

  // A wire value is clamped and floored like a stored file — a peer cannot
  // publish a rating below the floor, and a negative count is zero.
  assert.deepEqual(parseRankWire({ playerId: 'x', rating: -50, games: -3 }), {
    playerId: 'x', rating: RATING_FLOOR, games: 0,
  });
  // …but there is no ceiling: the top of the ladder is open.
  assert.equal(parseRankWire({ playerId: 'x', rating: 20000, games: 1 })!.rating, 20000);
  assert.deepEqual(parseRankWire({ playerId: 'x', rating: 'high', games: 2.7 }), {
    playerId: 'x', rating: START_RATING, games: 2,
  });
  for (const bad of [null, undefined, 7, {}, { playerId: '' }]) {
    assert.equal(parseRankWire(bad), null);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 5. The stored file
// ══════════════════════════════════════════════════════════════════════════

test('RK-01 the file round-trips, and refuses anything that is not one of ours', () => {
  const state: RankState = { rating: 1234, matches: 9, wins: 6, losses: 3, season: RANK_SEASON };
  assert.deepEqual(parseRankState(serializeRankState(state)), state);
  for (const bad of [null, undefined, 7, '{}', 'not json', '[]', '""', '']) {
    assert.equal(parseRankState(bad), null);
  }
});

test('RK-01 clamps a hostile or half-written file instead of throwing', () => {
  // The dangerous shape: a file that claims a rating nobody earned. It is
  // clamped to a legal RATING, and every counter is floored at zero — a
  // corrupt file can land a driver at the bottom, never at the top of a band
  // they did not earn.
  const parsed = parseRankState(JSON.stringify({
    rating: '99999', matches: -3, wins: null, losses: 2.7, season: 12,
  }));
  assert.deepEqual(parsed, {
    rating: START_RATING, matches: 0, wins: 0, losses: 2, season: RANK_SEASON,
  });
  const nan = parseRankState(JSON.stringify({ rating: Number.NaN, matches: 1 }));
  assert.equal(nan!.rating, START_RATING);
  const season = parseRankState(JSON.stringify({ rating: 1200, matches: 4, season: 's9' }));
  assert.equal(season!.season, 's9');
});

test('RK-01 advanceRating takes the NEWER file — a loss lowers the rating', () => {
  const held: RankState = { rating: 1300, matches: 20, wins: 12, losses: 8, season: RANK_SEASON };
  // The race just filed: one more race, a lower number. That is a real loss,
  // and refusing to store it would be a rating that only ever rises.
  const lost = advanceRating(held, { rating: 1292, matches: 21, wins: 12, losses: 9, season: RANK_SEASON });
  assert.equal(lost.rating, 1292);
  assert.equal(lost.losses, 9);
  // A STALE file — fewer races — never overwrites the newer history, even
  // though this is the direction a forged result would come from.
  const stale = advanceRating(lost, { rating: 1400, matches: 19, wins: 12, losses: 7, season: RANK_SEASON });
  assert.deepEqual(stale, lost);
  assert.deepEqual(advanceRating(null, held), held);
  // A season reset REPLACES: the new season's file is the truth, lower or not.
  const nextSeason = { ...held, rating: 1000, matches: 0, season: 's2' };
  assert.deepEqual(advanceRating(held, nextSeason), nextSeason);
});
