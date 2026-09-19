// ══════════════════════════════════════════════════════════════════════════
// RK-03 (#57) — the rated wire: the room's rating board, the one result a race
// may file, and the race-time runtime that turns that result into a verdict.
//
// The acceptance this file exists for:
//
//   (a) a forged rating for another player is DROPPED; a second claim is
//       IGNORED; a leaver mid-race is rated as a DNF;
//   (b) every client shows the SAME deltas for the same race — proven here
//       headlessly, with the real room in the middle and three real stores.
//
// HOW THIS IS TESTED, AND WHY IT IS NOT MOCKED
//
//   The room half drives the REAL `RaceRoom` through the SDK's own dispatch
//   (`tests/room-harness.ts`, the harness MP-03's tests use). The client half
//   runs the REAL `RankRuntime` + `createRankStore(io)` — the filing policy
//   from `rankstore.ts`, not a stand-in — with a `RankIO` per seat, because a
//   page has one player bucket and a race has up to six drivers. The wire
//   between them is the room's own broadcast, validated by the client's own
//   `validateMessage`: nothing here is a private convention between two fakes.
// ══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

// ── the browser globals the SDK reads on import ────────────────────────────
// `rankstore.ts` re-exports what the runtime needs, but `createRankStore` is
// the real chain (rankstore → transport → SDK), so the page it would run in has
// to exist. Same stub as `tests/rankstore.test.ts`.
const globals = globalThis as unknown as { window?: unknown; document?: unknown; localStorage?: unknown };
globals.window ??= {
  location: { href: 'http://localhost:5173/', origin: 'http://localhost:5173' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};
globals.document ??= {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} }, body: { appendChild() {} },
  querySelector: () => null, addEventListener() {},
};
const bucketValues = new Map<string, string>();
globals.localStorage ??= {
  getItem: (key: string) => bucketValues.get(key) ?? null,
  setItem: (key: string, value: string) => void bucketValues.set(key, value),
  removeItem: (key: string) => void bucketValues.delete(key),
};

const { RANK_STORAGE_KEY } = await import('../src/net/transport');
const { createRankStore } = await import('../src/net/rankstore');
// Type-only: the interface, not the module.
import type { RankIO } from '../src/net/rankstore';

import {
  RANK_SEASON,
  START_RATING,
  serializeRankState,
  type RankState,
  type RaceVerdict,
} from '../src/net/rating';
import { RankRuntime, mintJoinToken, raceRankSession, type RankSeat } from '../src/net/rank-runtime';
import {
  validateMessage,
  type RankedRow,
  type ResultClaimMsg,
  type ResultMsg,
  type Seat,
} from '../src/net/protocol';
import { MARBLE_COUNT } from '../src/net/protocol';
import {
  broadcasts,
  join,
  leave,
  messageOf,
  ofType,
  send,
  setup,
  welcomeOf,
  type Harness,
} from './room-harness';

const gameSettings = { type: 'start', countdownAt: 1_700_000_000_000 } as const;

/** The room's filed result, or null when it never filed one. */
function filedResult(h: Harness): ResultMsg | null {
  const results = broadcasts(h.frames).filter((m): m is ResultMsg => m.type === 'result');
  return results.length > 0 ? results[results.length - 1] : null;
}

/** A grid of humans and AI, in the shape the host's own `lobby` would carry. */
function gridOf(ids: readonly string[]): Seat[] {
  return Array.from({ length: MARBLE_COUNT }, (_, slot) => ({
    slot,
    playerId: slot < ids.length ? ids[slot] : '',
    name: slot < ids.length ? ids[slot].toUpperCase() : `Rival ${slot}`,
    color: '#67e8f9',
    stats: { weight: 5, speed: 5, bounce: 5 },
    portrait: slot,
    isAI: slot >= ids.length,
    ready: true,
  }));
}

/** The usual test grid: p1 (host), p2 and p3 driving, AI for the rest. */
const threeHumans = (): Seat[] => gridOf(['p1', 'p2', 'p3']);

const ratedRow = (playerId: string, finished: boolean, left = false): RankedRow =>
  left ? { playerId, finished, left: true } : { playerId, finished };

// ══════════════════════════════════════════════════════════════════════════
// The room: the rating board
// ══════════════════════════════════════════════════════════════════════════

test('RK-03 board: a rating is only ever published for its OWN sender', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  h.frames.length = 0;

  // p2 tries to write p1's number. Dropped: a rating is the one number a player
  // is allowed to be wrong about, but never somebody else's.
  await send(h, 'p2', { type: 'playerRating', playerId: 'p1', rating: 2400, games: 99, joinToken: 'forged' });
  assert.deepEqual(ofType(h.frames, 'ratingUpdate'), [], 'a rating for another seat never reaches the room');

  // p2's own rating is relayed to everyone, whole.
  await send(h, 'p2', { type: 'playerRating', playerId: 'p2', rating: 1184, games: 7, joinToken: 'tok-2' });
  const updates = ofType(h.frames, 'ratingUpdate');
  assert.equal(updates.length, 1, 'one publish, one board');
  const board = (messageOf(updates[0]) as { ratings: unknown[] }).ratings;
  assert.deepEqual(board, [{ playerId: 'p2', rating: 1184, games: 7 }]);
  // The join token is the room's business, not the wire's: it must not travel.
  assert.deepEqual(Object.keys(board[0] as object).sort(), ['games', 'playerId', 'rating']);

  // ...and a joiner is greeted with the board, so the lobby shows numbers at once.
  h.frames.length = 0;
  await join(h, 'p3');
  assert.deepEqual(welcomeOf(h.frames, 'p3').ratings, [{ playerId: 'p2', rating: 1184, games: 7 }]);
});

test('RK-03 board: a re-publish must carry the seat’s own join token', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await send(h, 'p2', { type: 'playerRating', playerId: 'p2', rating: 1000, games: 0, joinToken: 'tok-2' });
  h.frames.length = 0;

  // A later joiner (or a stale tab) with a different token cannot overwrite it.
  await send(h, 'p2', { type: 'playerRating', playerId: 'p2', rating: 1400, games: 20, joinToken: 'other-tab' });
  assert.deepEqual(ofType(h.frames, 'ratingUpdate'), [], 'the wrong token is not a publish');
  // The board is unchanged — ask the room for it and it says so.
  await join(h, 'p3');
  assert.deepEqual(welcomeOf(h.frames, 'p3').ratings, [{ playerId: 'p2', rating: 1000, games: 0 }]);
  h.frames.length = 0;

  // The owner publishing again — after filing a race, say — is idempotent, and
  // the newer number is the truer one.
  await send(h, 'p2', { type: 'playerRating', playerId: 'p2', rating: 1021, games: 1, joinToken: 'tok-2' });
  const board = (messageOf(ofType(h.frames, 'ratingUpdate')[0]) as { ratings: unknown[] }).ratings;
  assert.deepEqual(board, [{ playerId: 'p2', rating: 1021, games: 1 }]);
});

// ══════════════════════════════════════════════════════════════════════════
// The room: one result per room
// ══════════════════════════════════════════════════════════════════════════

test('RK-03 result: the host’s claim becomes the room’s result — once', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await send(h, 'p1', { type: 'playerRating', playerId: 'p1', rating: 1200, games: 12, joinToken: 'tok-1' });
  await send(h, 'p2', { type: 'playerRating', playerId: 'p2', rating: 1000, games: 4, joinToken: 'tok-2' });
  await send(h, 'p1', gameSettings);
  h.frames.length = 0;

  await send(h, 'p1', {
    type: 'resultClaim',
    order: [ratedRow('p2', true), ratedRow('p1', true)],
    durationSec: 41.6,
    rated: true,
  });
  const result = filedResult(h);
  assert.ok(result, 'the room filed the race');
  assert.deepEqual(result.order, [{ playerId: 'p2', finished: true }, { playerId: 'p1', finished: true }]);
  assert.equal(result.reason, 'finish');
  assert.equal(result.durationSec, 42, 'the room rounds the host’s clock');
  assert.equal(result.rated, true);
  assert.equal(typeof result.at, 'number', 'the ROOM stamps the race, not the host');
  assert.deepEqual(result.ratings, [
    { playerId: 'p1', rating: 1200, games: 12 },
    { playerId: 'p2', rating: 1000, games: 4 },
  ], 'the result carries the board it was filed against');
  // The frame the room broadcasts is a frame the client's own door accepts.
  assert.equal(validateMessage(result), null);

  // A second claim — even a different one — is ignored: one race, one file.
  await send(h, 'p1', {
    type: 'resultClaim',
    order: [ratedRow('p1', true), ratedRow('p2', false)],
    durationSec: 12,
    rated: true,
  });
  assert.equal(ofType(h.frames, 'result').length, 1, 'a second result is never filed');
  assert.deepEqual(filedResult(h)!.order, result.order, 'and the first one stands');
});

test('RK-03 result: only the host may claim, and only a race that started may be filed', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');

  // A guest does not run the simulation, so it has no standing to say who
  // crossed the line.
  await send(h, 'p2', { type: 'resultClaim', order: [ratedRow('p2', true), ratedRow('p1', false)], durationSec: 3, rated: true });
  assert.equal(filedResult(h), null, 'a guest claim is dropped');

  // A claim BEFORE the lights is not a race: nothing may be rated from it.
  await send(h, 'p1', { type: 'resultClaim', order: [ratedRow('p1', true), ratedRow('p2', false)], durationSec: 3, rated: true });
  assert.equal(filedResult(h), null, 'a race that never started files nothing');

  // After `start` the same claim files.
  await send(h, 'p1', gameSettings);
  await send(h, 'p1', { type: 'resultClaim', order: [ratedRow('p1', true), ratedRow('p2', false)], durationSec: 3, rated: true });
  assert.ok(filedResult(h), 'a started race files');
});

test('RK-03 result: a classification cannot invent a driver the room never seated', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await send(h, 'p1', gameSettings);

  await send(h, 'p1', {
    type: 'resultClaim',
    order: [ratedRow('p1', true), ratedRow('ghost', true)],
    durationSec: 9,
    rated: true,
  });
  assert.equal(filedResult(h), null, 'a half-believed classification is worse than none — the whole claim is refused');
});

test('RK-03 result: a driver who walked out is a DNF, whatever the marble went on to do', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await join(h, 'p3');
  await send(h, 'p1', gameSettings);
  h.frames.length = 0;

  // p2's socket goes mid-race. MP-08 hands the marble to the AI, which rolls
  // home — so the host's summary is entitled to say it FINISHED. The room saw
  // the seat empty, and that is the fact the rating reads.
  await leave(h, 'p2', 'disconnect');
  await send(h, 'p1', {
    type: 'resultClaim',
    order: [ratedRow('p1', true), ratedRow('p2', true), ratedRow('p3', true)],
    durationSec: 55,
    rated: true,
  });
  const result = filedResult(h);
  assert.ok(result);
  assert.deepEqual(result.order, [
    { playerId: 'p1', finished: true },
    { playerId: 'p2', finished: false, left: true },
    { playerId: 'p3', finished: true },
  ], 'the leaver is demoted to a DNF, and the rest of the field is untouched');
  assert.deepEqual(result.departedIds, ['p2'], 'the room names who it watched leave');
  assert.equal(validateMessage(result), null);

  // A leaver the claim FORGOT is still a rated seat of this race: dropping them
  // would quietly shrink everybody else's field.
  const other = setup();
  await other.protocol.handleCreate();
  await join(other, 'p1');
  await join(other, 'p2');
  await send(other, 'p1', gameSettings);
  await leave(other, 'p2', 'leave');
  await send(other, 'p1', { type: 'resultClaim', order: [ratedRow('p1', true)], durationSec: 20, rated: true });
  assert.deepEqual(filedResult(other)!.order, [
    { playerId: 'p1', finished: true },
    { playerId: 'p2', finished: false, left: true },
  ], 'the room’s own leaver mark survives a claim that forgot it');
});

test('RK-03 rules: house-rule power-ups make a race nobody’s to rate', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  // The host files the lobby it is showing: every driver starts with two oils.
  await send(h, 'p1', { type: 'lobby', seats: threeHumans(), settings: { circuit: 0, items: { oil: 2 } } });
  await send(h, 'p1', gameSettings);
  await send(h, 'p1', { type: 'resultClaim', order: [ratedRow('p1', true), ratedRow('p2', true)], durationSec: 30, rated: true });

  const result = filedResult(h);
  assert.ok(result, 'the race is still classified and shown');
  assert.equal(result.rated, false, '...but house rules are not a ladder race');

  // The host’s own word still counts: a claim that says unrated is unrated.
  const clean = setup();
  await clean.protocol.handleCreate();
  await join(clean, 'p1');
  await join(clean, 'p2');
  await send(clean, 'p1', gameSettings);
  await send(clean, 'p1', { type: 'resultClaim', order: [ratedRow('p1', true), ratedRow('p2', true)], durationSec: 30, rated: false });
  assert.equal(filedResult(clean)!.rated, false, 'a friends’ room is not rated because the host says so');
});

test('RK-03 token: a join token is minted per join, never persisted', () => {
  const a = mintJoinToken();
  const b = mintJoinToken();
  assert.notEqual(a, b);
  assert.equal(typeof a, 'string');
  assert.ok(a.length > 0 && a.length <= 128, 'the wire’s own cap');
});

// ══════════════════════════════════════════════════════════════════════════
// The client: the runtime, the store, and the same race on every seat
// ══════════════════════════════════════════════════════════════════════════

interface Bucket {
  io: RankIO;
  ladder: { rating: number; durationSec: number; metadata?: Record<string, unknown> }[];
  writes: number;
}

/** One seat's rating storage: two of these are two drivers of one race. */
function bucket(): Bucket {
  const values = new Map<string, string>();
  const out: Bucket = {
    writes: 0,
    ladder: [],
    io: {
      readStorage: async (key) => values.get(key) ?? null,
      writeStorage: async (key, value) => {
        out.writes++;
        values.set(key, value);
        return true;
      },
      submitLadder: async (params) => {
        out.ladder.push(params);
        return { accepted: true, rank: 1, reason: undefined };
      },
    },
  };
  return out;
}

/** Seed a bucket with a stored file, the way a driver arrives with history. */
async function seed(b: Bucket, state: RankState): Promise<void> {
  await b.io.writeStorage(RANK_STORAGE_KEY, serializeRankState(state));
}

/** Let the room's async dispatch finish — `handleMessage` is a promise. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test('RK-03 claim: the host builds the human seats’ classification from its own `results` frame', async () => {
  const claims: { order: RankedRow[]; durationSec: number; rated: boolean }[] = [];
  const runtime = new RankRuntime({
    session: {
      playerId: 'p1',
      publishRating: () => true,
      claimResult: (order, durationSec, rated) => {
        claims.push({ order: [...order], durationSec, rated });
        return true;
      },
    },
    store: createRankStore(bucket().io),
    roster: threeHumans(),
    ratedRoom: true,
  });

  // What the host's `classify()` produces: every seat best-first, `times` per
  // slot, null for a non-finisher.
  const order = [1, 0, 2, 9, 3, 4, 5, 6, 7, 8];
  const times: (number | null)[] = new Array(MARBLE_COUNT).fill(null);
  times[1] = 10_000;
  times[0] = 11_240;
  times[9] = 11_900; // an AI seat, finishing between the humans
  times[2] = null; // p3 never got home

  assert.equal(runtime.claimFinish({ order, times }, 12.4), true);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].order, [
    { playerId: 'p2', finished: true },
    { playerId: 'p1', finished: true },
    { playerId: 'p3', finished: false },
  ], 'human seats only, in the simulation’s order, the DNF below them');
  assert.equal(claims[0].durationSec, 12, 'whole seconds');
  assert.equal(claims[0].rated, true);

  // Once the room's result has been folded in, this seat claims nothing more.
  await runtime.handleResult({
    type: 'result',
    order: claims[0].order,
    ratings: [],
    reason: 'finish',
    durationSec: 12,
    rated: true,
    at: 7,
  });
  assert.equal(runtime.claimFinish({ order, times }, 12.4), false, 'a settled race is not claimed again');
  assert.equal(claims.length, 1);
});

test('RK-03 acceptance: every seat computes the same deltas from the room’s result', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  const p1 = await join(h, 'p1'); // host, slot 0
  await join(h, 'p2'); // slot 1
  await join(h, 'p3'); // slot 2

  // Three drivers with three different histories, each in their own bucket.
  const buckets = { p1: bucket(), p2: bucket(), p3: bucket() };
  await seed(buckets.p1, { rating: 1200, matches: 12, wins: 6, losses: 6, season: RANK_SEASON });
  await seed(buckets.p2, { rating: 1042, matches: 3, wins: 1, losses: 2, season: RANK_SEASON });
  await seed(buckets.p3, { rating: 880, matches: 41, wins: 12, losses: 29, season: RANK_SEASON });

  const roster: RankSeat[] = threeHumans();
  /** One seat's runtime, wired to the REAL room through the shipping adapter. */
  const seat = (id: 'p1' | 'p2' | 'p3', board: Record<string, { rating: number; games: number }> = {}) =>
    new RankRuntime({
      session: raceRankSession(
        {
          send: (msg) => {
            void send(h, id, msg);
          },
          onMessage: null,
          onPlayerLeft: null,
        },
        id,
      ),
      store: createRankStore(buckets[id].io),
      roster,
      board,
      ratedRoom: true,
    });

  const hostRuntime = seat('p1');
  // The guest arrives knowing NOTHING: it never saw a `ratingUpdate`. If the
  // numbers still agree, it is because the result carried the board — which is
  // the whole reason no rating numbers travel as opinions.
  const guestRuntime = seat('p2', {});
  const thirdRuntime = seat('p3');

  await Promise.all([hostRuntime.start(), guestRuntime.start(), thirdRuntime.start()]);
  for (const b of Object.values(buckets)) assert.deepEqual(b.ladder, [], 'nobody is on the ladder before the race');
  await settle();

  // The board the room holds now: all three drivers, each as its owner filed it.
  const updates = ofType(h.frames, 'ratingUpdate').map((f) => (messageOf(f) as { ratings: { playerId: string; rating: number }[] }).ratings);
  const board = updates[updates.length - 1];
  assert.deepEqual(
    board.map((row) => `${row.playerId}:${row.rating}`).sort(),
    ['p1:1200', 'p2:1042', 'p3:880'],
    'the room’s board is every driver’s own number, before the lights',
  );

  await send(h, 'p1', gameSettings);
  h.frames.length = 0;

  // The host classifies: p2 won, p3 second, the host last of the humans.
  const order = [1, 2, 0, 3, 4, 5, 6, 7, 8, 9];
  const times: (number | null)[] = new Array(MARBLE_COUNT).fill(null);
  times[1] = 40_000;
  times[2] = 41_200;
  times[0] = 42_900;
  assert.equal(hostRuntime.claimFinish({ order, times }, 43), true, 'the host claims');
  await settle();

  // The room filed it: the claim went out over the real relay, was validated,
  // stamped, and broadcast to everyone (host included).
  const result = filedResult(h);
  assert.ok(result, 'the room filed the race');
  assert.equal(result.rated, true);
  assert.equal(validateMessage(result), null);
  assert.deepEqual(result.order.map((row) => row.playerId), ['p2', 'p3', 'p1']);

  // Every seat folds in the ROOM’s message — not its own claim.
  const hostVerdict = await hostRuntime.handleResult(result);
  const guestVerdict = await guestRuntime.handleResult(result);
  const thirdVerdict = await thirdRuntime.handleResult(result);
  assert.ok(hostVerdict && guestVerdict && thirdVerdict, 'all three seats settled');

  // THE ACCEPTANCE, seat for seat: every driver's own row is the SAME row the
  // other two seats show for them. That is what "every client shows the same
  // deltas" means — not that three drivers' deltas are equal (they are not:
  // each is rated from their own level), but that nobody's screen disagrees
  // about what the race did to anybody.
  const verdicts = [hostVerdict, guestVerdict, thirdVerdict];
  const own = (v: RaceVerdict) => ({
    before: v.change.before,
    after: v.change.after,
    delta: v.change.delta,
    position: v.change.position,
    finished: v.change.finished,
  });
  for (const a of verdicts) {
    for (const b of verdicts) {
      if (a === b) continue;
      const seen = a.rivals.find((r) => r.playerId === b.playerId);
      assert.ok(seen, `${a.playerId} shows a row for ${b.playerId}`);
      assert.deepEqual(
        { before: seen.before, after: seen.after, delta: seen.delta, position: seen.position, finished: seen.finished },
        own(b),
        `${b.playerId}’s own row is what ${a.playerId} was shown`,
      );
    }
    assert.equal(a.fieldKnown, true, `${a.playerId} was rated against real numbers, not guesses`);
    for (const r of a.rivals) assert.equal(r.known, true);
  }

  // The race counted, and the ladder heard about it — once per driver.
  assert.equal(hostVerdict.rated, true);
  assert.equal(hostVerdict.change.position, 3, 'the host is last of the humans');
  assert.ok(hostVerdict.change.delta < 0, 'and pays for it');
  assert.equal(guestVerdict.won, true);
  assert.ok(guestVerdict.change.delta > 0);
  assert.ok(thirdVerdict.change.after !== thirdVerdict.change.before, 'the field moved every seat');
  for (const [id, b] of Object.entries(buckets)) {
    assert.equal(b.ladder.length, 1, `one ladder line for ${id}`);
    assert.equal(b.ladder[0].metadata?.result, id === 'p2' ? 'win' : 'loss');
  }
  // ...and the file each seat kept is the number its own verdict printed.
  assert.equal(hostRuntime.state!.rating, hostVerdict.change.after);
  assert.equal(guestRuntime.state!.rating, guestVerdict.change.after);
  assert.equal(thirdRuntime.state!.rating, thirdVerdict.change.after);

  // A re-delivered result does not move the number a second time — neither at
  // the runtime nor at the store, whose once-only key is the room’s own stamp.
  const before = hostRuntime.state!.rating;
  assert.equal(await hostRuntime.handleResult({ ...result, at: result.at + 1 }), null, 'the runtime files one race once');
  const replay = await createRankStore(buckets.p1.io).fileResult({
    result: { at: result.at, order: result.order, durationSec: result.durationSec, reason: result.reason, rated: result.rated },
    selfId: 'p1',
    board: result.order.map((row) => ({ playerId: row.playerId, rating: 1000, games: 0 })),
    state: hostRuntime.state!,
  });
  assert.equal(replay.applied, false, 'the room’s own stamp is the once-only key');
  assert.equal(hostRuntime.state!.rating, before, 'and nothing moved');
  assert.equal(p1.id, 'p1');
});

test('RK-03 acceptance: the survivor’s numbers show the leaver as the DNF they are', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  const b1 = bucket();
  await seed(b1, { rating: 1000, matches: 20, wins: 10, losses: 10, season: RANK_SEASON });
  const b2 = bucket();
  await seed(b2, { rating: 1000, matches: 20, wins: 10, losses: 10, season: RANK_SEASON });

  const roster = gridOf(['p1', 'p2']);
  const runtime = new RankRuntime({
    session: raceRankSession({ send: (msg) => void send(h, 'p1', msg), onMessage: null, onPlayerLeft: null }, 'p1'),
    store: createRankStore(b1.io),
    roster,
    ratedRoom: true,
  });
  // The other seat's rating reaches the room the same way any client's does.
  await runtime.start();
  await send(h, 'p2', { type: 'playerRating', playerId: 'p2', rating: 1000, games: 20, joinToken: 'tok-2' });
  await settle();
  // p1 learns p2’s number from the room’s own relay.
  runtime.applyBoard({ p2: { rating: 1000, games: 20 } });
  await send(h, 'p1', gameSettings);
  h.frames.length = 0;

  // p2 walks out mid-race. The AI takes the marble home, so the host's own
  // summary says p2 FINISHED — the room is what says otherwise.
  await leave(h, 'p2', 'leave');
  assert.equal(runtime.claimFinish({ order: [1, 0], times: [12_000, 13_400] }, 13), true);
  await settle();

  const result = filedResult(h);
  assert.ok(result);
  const verdict = await runtime.handleResult(result);
  assert.ok(verdict);
  assert.equal(verdict.change.position, 1, 'the survivor inherits the win');
  assert.ok(verdict.change.delta > 0, 'and is paid for it');
  const leaver = verdict.rivals.find((r) => r.playerId === 'p2');
  assert.ok(leaver, 'the survivor is shown a row for the driver who left');
  assert.equal(leaver.finished, false, 'the leaver is classified as a DNF, not as the finisher the marble was');
  assert.equal(leaver.position, 2);
  assert.ok(leaver.delta < 0, 'and pays the price of walking out');
  assert.deepEqual(b2.ladder, [], 'the leaver’s own seat never files this race — the room witnessed it, not them');
});

test('RK-03 rules: a race the room did not rate writes NOTHING', async () => {
  const b = bucket();
  await seed(b, { rating: 1340, matches: 30, wins: 20, losses: 10, season: RANK_SEASON });
  const runtime = new RankRuntime({
    session: { playerId: 'p1', publishRating: () => true, claimResult: () => true },
    store: createRankStore(b.io),
    roster: threeHumans(),
    ratedRoom: true,
  });
  await runtime.start();

  // The room's own `rated:false` (house rules, a friends' room, a room created
  // by "Host game") — the classification is still shown, but nothing is filed.
  const verdict = await runtime.handleResult({
    type: 'result',
    order: [ratedRow('p2', true), ratedRow('p1', false)],
    ratings: [
      { playerId: 'p1', rating: 1340, games: 30 },
      { playerId: 'p2', rating: 1000, games: 0 },
    ],
    reason: 'finish',
    durationSec: 30,
    rated: false,
    at: 1,
  });

  assert.ok(verdict, 'the race still has a verdict to print');
  assert.equal(verdict.change.position, 2, 'the classification is still read');
  assert.equal(runtime.outcome!.rated, false, '...but the ROOM did not rate it, so nothing was filed');
  assert.equal(runtime.outcome!.stored, true, 'and nothing needed storing');
  assert.equal(runtime.state!.rating, 1340, 'the file is untouched — no delta happened');
  assert.equal(runtime.state!.matches, 30, 'including the provisional counter');
  assert.deepEqual(b.ladder, [], 'and the ladder never hears about it');
  assert.equal(b.writes, 1, 'one write in this test: the seed');
});

test('RK-03 leaver: the driver who walks out files their own DNF, and no ladder line', async () => {
  const b = bucket();
  await seed(b, { rating: 1100, matches: 8, wins: 4, losses: 4, season: RANK_SEASON });
  const runtime = new RankRuntime({
    session: { playerId: 'p2', publishRating: () => true, claimResult: () => true },
    store: createRankStore(b.io),
    roster: threeHumans(),
    ratedRoom: true,
  });
  await runtime.start();

  const verdict = await runtime.fileOwnForfeit(['p1', 'p3']);
  assert.ok(verdict, 'the leaver settled their own race');
  assert.equal(verdict.forfeit, true, 'the room-visible flag this seat applies itself');
  assert.equal(verdict.finished, false, 'a leaver is never classified at the flag');
  assert.equal(verdict.change.position, 3, 'behind both drivers still in it');
  assert.ok(verdict.change.delta < 0, 'abandonment costs rating, or quitting would beat losing');
  assert.equal(verdict.change.before, 1100, 'the leaver is rated from their own file, not a stranger’s guess at them');
  assert.equal(runtime.state!.rating, 1100 + verdict.change.delta);
  assert.equal(runtime.state!.losses, 5);
  assert.deepEqual(b.ladder, [], 'a leaver does not write their own ladder line');

  // ...and it happens once. A late result for the same race cannot double-count.
  assert.equal(await runtime.fileOwnForfeit(['p1', 'p3']), null);
  assert.equal(await runtime.handleResult({
    type: 'result',
    order: [ratedRow('p1', true), ratedRow('p3', true), ratedRow('p2', false, true)],
    ratings: [], reason: 'forfeit', durationSec: 0, rated: true, at: 9,
  }), null);
  assert.equal(runtime.state!.rating, 1100 + verdict.change.delta, 'one race, one application');
});

test('RK-03 field: a seat the result does not name has nothing to fold in', async () => {
  const runtime = new RankRuntime({
    session: { playerId: 'p9', publishRating: () => true, claimResult: () => true },
    store: createRankStore(bucket().io),
    ratedRoom: true,
  });
  const verdict = await runtime.handleResult({
    type: 'result',
    order: [ratedRow('p1', true), ratedRow('p2', true)],
    ratings: [],
    reason: 'finish',
    durationSec: 5,
    rated: true,
    at: 3,
  });
  assert.equal(verdict, null);
  assert.equal(runtime.settled, false);
});

test('RK-03 arithmetic: a lone rated driver is not a rated race', async () => {
  const b = bucket();
  const runtime = new RankRuntime({
    session: { playerId: 'p1', publishRating: () => true, claimResult: () => true },
    store: createRankStore(b.io),
    roster: threeHumans(),
    ratedRoom: true,
  });
  const verdict = await runtime.handleResult({
    type: 'result',
    order: [ratedRow('p1', true)],
    ratings: [{ playerId: 'p1', rating: START_RATING, games: 0 }],
    reason: 'finish',
    durationSec: 5,
    rated: true,
    at: 4,
  });
  assert.ok(verdict);
  assert.equal(verdict.rated, false, 'a field of one has no pair to move a number across');
  assert.equal(runtime.state!.rating, START_RATING);
  assert.deepEqual(b.ladder, []);
});

// ══════════════════════════════════════════════════════════════════════════
// RK-06 (#60) — a mid-race leaver in a THREE-human race.
//
// RK-03's leaver test is a duel: one seat walks, the other inherits the win.
// A race is not a duel, and the interesting part of a three-human field is that
// the leaver's absence has to reach EVERY other seat identically — the room is
// the only party that sees the departure, and it is the room's own `left` mark
// that both survivors rate from. The host's summary is not trusted here on
// purpose: MP-08 hands a dropped marble to the AI, so a host's classification
// can honestly say the leaver FINISHED (that is the duel test's whole point,
// restated with a second rival in the field).
// ══════════════════════════════════════════════════════════════════════════

test('RK-06 room: a mid-race leaver in a three-human race is a DNF for everyone, and one result is filed', async () => {
  const h = setup();
  await h.protocol.handleCreate();
  await join(h, 'p1');
  await join(h, 'p2');
  await join(h, 'p3');

  // The board: p1 is the strongest, p2 and p3 start level.
  await send(h, 'p1', { type: 'playerRating', playerId: 'p1', rating: 1180, games: 20, joinToken: 'tok-1' });
  await send(h, 'p2', { type: 'playerRating', playerId: 'p2', rating: 1000, games: 20, joinToken: 'tok-2' });
  await send(h, 'p3', { type: 'playerRating', playerId: 'p3', rating: 1000, games: 20, joinToken: 'tok-3' });
  await send(h, 'p1', { type: 'lobby', seats: threeHumans(), settings: { circuit: 0 } });
  await send(h, 'p1', gameSettings);
  h.frames.length = 0;

  // p3 walks out mid-race, and the host's own classification says p3 finished —
  // the AI drove the marble home. The room is what makes it a DNF.
  await leave(h, 'p3', 'disconnect');
  await send(h, 'p1', {
    type: 'resultClaim',
    order: [ratedRow('p1', true), ratedRow('p2', true), ratedRow('p3', true)],
    durationSec: 41,
    rated: true,
  });

  const results = broadcasts(h.frames).filter((m) => m.type === 'result');
  assert.equal(results.length, 1, 'one race, one result — never one per departure');
  const result = results[0] as ResultMsg;
  assert.deepEqual(result.departedIds, ['p3'], 'the room names the seat it saw leave');
  const p3Row = result.order.find((row) => row.playerId === 'p3');
  assert.deepEqual(p3Row, { playerId: 'p3', finished: false, left: true }, 'and files the leaver as the DNF they are');
  assert.equal(result.rated, true, 'a matchmade race with no house rules is rated');
  assert.equal(result.order.filter((row) => row.left === true).length, 1);
  assert.deepEqual(
    result.ratings.map((r) => r.playerId).sort(),
    ['p1', 'p2', 'p3'],
    'the board travels WITH the result, so a seat that missed an update still rates from the room’s copy',
  );

  // Both survivors file from that one result, and the numbers they see for each
  // other are the same numbers — the race's three rows, rated once each.
  const b1 = bucket();
  const b2 = bucket();
  await seed(b1, { rating: 1180, matches: 20, wins: 12, losses: 8, season: RANK_SEASON });
  await seed(b2, { rating: 1000, matches: 20, wins: 10, losses: 10, season: RANK_SEASON });
  const survivors: Record<string, RaceVerdict> = {};
  for (const [id, io] of [['p1', b1], ['p2', b2]] as const) {
    const runtime = new RankRuntime({
      session: { playerId: id, publishRating: () => true, claimResult: () => false },
      store: createRankStore(io.io),
      roster: threeHumans(),
      board: { p1: { rating: 1180, games: 20 }, p2: { rating: 1000, games: 20 }, p3: { rating: 1000, games: 20 } },
      ratedRoom: true,
    });
    const verdict = await runtime.handleResult(result, id);
    assert.ok(verdict, `${id} folds the room’s result in`);
    survivors[id] = verdict!;
  }

  // The survivors: both gain, and both see the leaver exactly the same way.
  for (const id of ['p1', 'p2'] as const) {
    const verdict = survivors[id];
    assert.ok(verdict.rated, `${id} raced a rated race`);
    assert.ok(verdict.change.delta > 0, `${id} gains — the field below them lost a rival and gained a DNF`);
    assert.equal(verdict.rivals.length, 2, 'and is shown a row for every other rated seat');
    const leaver = verdict.rivals.find((r) => r.playerId === 'p3')!;
    assert.equal(leaver.finished, false, `${id} sees the leaver as a DNF`);
    assert.equal(leaver.position, 3, 'and last, behind both finishers');
    assert.ok(leaver.delta < 0, 'paying for the walk-out');
    assert.equal(leaver.known, true);
  }
  // Seat-for-seat agreement: p1's row for p2 IS the row p2 computes for itself.
  const p2FromP1 = survivors.p1.rivals.find((r) => r.playerId === 'p2')!;
  assert.equal(p2FromP1.before, survivors.p2.change.before);
  assert.equal(p2FromP1.after, survivors.p2.change.after);
  assert.equal(p2FromP1.delta, survivors.p2.change.delta);
  assert.equal(p2FromP1.position, survivors.p2.change.position);
  // And the leaver: their own seat files its own DNF locally, off the same board.
  const b3 = bucket();
  await seed(b3, { rating: 1000, matches: 20, wins: 10, losses: 10, season: RANK_SEASON });
  const leaverRuntime = new RankRuntime({
    session: { playerId: 'p3', publishRating: () => true, claimResult: () => false },
    store: createRankStore(b3.io),
    roster: threeHumans(),
    board: { p1: { rating: 1180, games: 20 }, p2: { rating: 1000, games: 20 } },
    ratedRoom: true,
  });
  const own = await leaverRuntime.fileOwnForfeit(['p1', 'p2']);
  assert.ok(own);
  assert.equal(own.forfeit, true);
  assert.equal(own.change.position, 3, 'the leaver rates themselves last of three');
  assert.ok(own.change.delta < survivors.p2.change.delta, 'and worse than the survivor they were level with');
  assert.deepEqual(b3.ladder, [], 'a walk-out writes no ladder line of its own');
});
