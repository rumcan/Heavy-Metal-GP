// ══════════════════════════════════════════════════════════════════════════
// RK-02 — the storage policy around a rating, and the ladder behind it.
//
// `rating.ts` is pinned in `tests/rating.test.ts` (pure arithmetic). This file
// pins the policy that only exists because a rating has to SURVIVE a race:
// where the file is read from and written to, the once-only guard that stops a
// reload from filing one race twice, what a fresh or corrupt file means, who is
// allowed to be rated at all, and the single call site that writes to the
// public ladder.
//
// HOW THIS IS TESTED, AND WHY IT IS NOT MOCKED
//
//   `tests/multiplayer.test.ts` already established the pattern: stub the two
//   browser globals the RUN SDK reads on import, then load `transport.ts` for
//   real. This file goes one step further and gives the SDK's own in-memory
//   backends a `localStorage` to sit on, because that is what `appStorage` is
//   built out of when there is no host. So `rankstore.ts` → `transport.ts` →
//   SDK is the REAL chain under test: no module mocking, and the wrappers'
//   never-throw promises are exercised rather than assumed.
//
//   The two states a test cannot reach that way are simulated by patching the
//   SDK singleton's own properties — a signed-out player (`accessGate`), an
//   unreachable ladder (`leaderboard.submitScore`), and a page with no usable
//   storage (dropping the `localStorage` stub). Those are the seams the
//   transport duck-types against; patching them is testing the seam, not
//   avoiding it.
// ══════════════════════════════════════════════════════════════════════════
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  RANK_SEASON,
  START_RATING,
  rankKeyOf,
  type RaceEntry,
  type RankState,
  type RatedPlayer,
} from '../src/net/rating';

// ── the browser globals, and the bucket `appStorage` is built on ───────────
const globals = globalThis as unknown as {
  window?: unknown;
  document?: unknown;
  localStorage?: unknown;
};
globals.window ??= {
  location: { href: 'http://localhost:5173/', origin: 'http://localhost:5173' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};
globals.document ??= {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} }, body: { appendChild() {} },
  querySelector: () => null, addEventListener() {},
};

/** The device bucket the SDK's `appStorage` writes through. */
const bucket = new Map<string, string>();
function installLocalStorage(): void {
  globals.localStorage = {
    getItem: (key: string) => bucket.get(key) ?? null,
    setItem: (key: string, value: string) => void bucket.set(key, value),
    removeItem: (key: string) => void bucket.delete(key),
  };
}
installLocalStorage();

const transport = await import('../src/net/transport');
const store = await import('../src/net/rankstore');
const sdk = (await import('@series-inc/rundot-game-sdk/api')).default as unknown as Record<string, unknown>;

/** The real `accessGate`/'leaderboard' handles, so a patch can be undone. */
const realAccessGate = sdk.accessGate;
const realLeaderboard = sdk.leaderboard as { submitScore: unknown; getPagedScores: unknown };
const realSubmitScore = realLeaderboard.submitScore;

/** Pretend this page's player is signed out (or back in). */
function setAnonymous(anon: boolean): void {
  sdk.accessGate = { isAnonymous: () => anon, promptLogin: async () => ({ success: false }) };
}

/**
 * What the ladder was told, and how it answered.
 *
 * The SDK's own board is a faithful little mock (`MockLeaderboardApi`) — it is
 * even keep-best, with one mock player, so a second lower submission comes back
 * refused. That makes it a poor instrument for asserting WHAT was submitted
 * while remaining the right one for proving the seam resolves at all. So: every
 * test drives a recording responder by default and asserts the exact payload,
 * and one test restores the real board to prove the chain works end to end.
 */
const submissions: { score: number; duration: number; mode?: string; metadata?: Record<string, unknown> }[] = [];
let ladderAnswer: () => Promise<unknown> = async () => ({ accepted: true, rank: 7, reason: null });

function recordSubmission(): void {
  realLeaderboard.submitScore = async (params: unknown) => {
    submissions.push(params as (typeof submissions)[number]);
    return ladderAnswer();
  };
}

beforeEach(() => {
  bucket.clear();
  installLocalStorage();
  delete (sdk as { accessGate?: unknown }).accessGate;
  submissions.length = 0;
  ladderAnswer = async () => ({ accepted: true, rank: 7, reason: null });
  recordSubmission();
});

after(() => {
  sdk.accessGate = realAccessGate;
  realLeaderboard.submitScore = realSubmitScore;
});

// ── the fixtures ───────────────────────────────────────────────────────────

const file = (rating: number, matches = 12): RankState =>
  ({ rating, matches, wins: matches - 4, losses: 4, season: RANK_SEASON });

const board: RatedPlayer[] = [
  { playerId: 'me', rating: 1180, games: 12, known: true },
  { playerId: 'them', rating: 1180, games: 12, known: true },
];
const order: RaceEntry[] = [{ playerId: 'me', finished: true }, { playerId: 'them', finished: true }];
const RESULT = { at: 1_760_000_000_000, order, durationSec: 420, reason: 'finish' as const };

/** The raw rating file as RUN storage holds it, parsed. */
const storedFile = (): RankState | null => {
  const raw = [...bucket.entries()].find(([key]) => key.endsWith(transport.RANK_STORAGE_KEY))?.[1];
  return raw ? (JSON.parse(raw) as RankState) : null;
};
const storedFiledKey = (): string | null =>
  [...bucket.entries()].find(([key]) => key.endsWith(transport.RANK_FILED_KEY))?.[1] ?? null;

// ══════════════════════════════════════════════════════════════════════════
// 1. The rating file
// ══════════════════════════════════════════════════════════════════════════

test('RK-02 a driver who has never raced reads as a fresh 1000, unranked, with nothing filed', async () => {
  const state = await store.loadRankState();
  assert.equal(state.rating, START_RATING);
  assert.equal(state.matches, 0);
  assert.equal(state.season, RANK_SEASON);
  assert.equal(await store.loadFiledKey(), null);
  // The file was not conjured into storage by READING it: a driver who never
  // raced has nothing stored, which is what "placement" means.
  assert.equal(storedFile(), null);
});

test('RK-02 a stored file round-trips through RUN player storage', async () => {
  const held = file(1310);
  assert.equal(await store.saveRankState(held), true, 'RUN storage took the write');
  assert.deepEqual(await store.loadRankState(), held);
  assert.deepEqual(storedFile(), held);
});

test('RK-02 a corrupt file falls back to a fresh one instead of throwing', async () => {
  // The half-written, hostile and simply-not-ours shapes all have to land on a
  // bootable screen: a rating is not worth a crash on the way in.
  for (const junk of ['{ not json', '[]', '{"someone": "else"}', '']) {
    bucket.set(keyEnding(transport.RANK_STORAGE_KEY), junk);
    const state = await store.loadRankState();
    assert.equal(state.rating, START_RATING, `junk ${JSON.stringify(junk)} did not fall back`);
    assert.equal(state.matches, 0);
  }
  // …and a file that carries SOME of our fields is clamped, not discarded.
  bucket.set(keyEnding(transport.RANK_STORAGE_KEY), JSON.stringify({ rating: 99999, matches: -3 }));
  const clamped = await store.loadRankState();
  assert.equal(clamped.rating, START_RATING, 'a hostile rating string falls back rather than inventing a number');
  assert.equal(clamped.matches, 0);
});

test('RK-02 a bucket that refuses the write loses the number, and says so — without wedging the session', async () => {
  // A page whose storage is broken (no host, a sandbox that blocks the
  // underlying store). There is deliberately no localStorage mirror to fall
  // back on (departure 1 in the store's header), so the honest answer is: the
  // race still settles, the verdict still prints, and the number is not kept.
  delete (globals as { localStorage?: unknown }).localStorage;
  assert.equal((await store.loadRankState()).rating, START_RATING);
  assert.equal(await store.saveRankState(file(1300)), false, 'a write with no bucket did not happen');

  const outcome = await store.fileRoomResult({ result: RESULT, selfId: 'me', board, state: file(1180) });
  assert.equal(outcome.applied, true);
  assert.equal(outcome.stored, false, 'the results screen must be able to say the number was not kept');
  assert.ok(outcome.state.rating > 1180, 'the verdict is still computed from the room’s race');

  // …and it is NOT sticky: rating is gated on whether a bucket exists at all
  // (and on being signed in), not on the last write's luck. A session that
  // cached this failure could never recover.
  installLocalStorage();
  assert.equal(store.ratedRacingAllowed(), true, 'a working bucket brings rating back');
  assert.equal(await store.saveRankState(file(1300)), true);
  assert.equal((await store.loadRankState()).rating, 1300);
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Anonymous players
// ══════════════════════════════════════════════════════════════════════════

test('RK-02 an anonymous player is not rated, and is told to sign in', async () => {
  assert.equal(store.ratedRacingAllowed(), true, 'signed in, with a bucket: rated');
  setAnonymous(true);
  assert.equal(store.ratedRacingAllowed(), false);
  // The one line every rating surface shows for that state, kept in the store
  // so the lobby, the results screen and the ladder panel cannot each invent
  // their own wording.
  assert.match(store.SIGN_IN_TO_BE_RANKED, /sign in to be ranked/i);
  setAnonymous(false);
  assert.equal(store.ratedRacingAllowed(), true, 'signing in turns rating back on');
});

// ══════════════════════════════════════════════════════════════════════════
// 3. Filing a race
// ══════════════════════════════════════════════════════════════════════════

test('RK-02 files a win: rating up, file written, ladder told, verdict printable', async () => {
  const before = file(1180);
  const outcome = await store.fileRoomResult({ result: RESULT, selfId: 'me', board, state: before });

  assert.equal(outcome.applied, true);
  assert.equal(outcome.rated, true);
  assert.equal(outcome.verdict.won, true);
  assert.ok(outcome.verdict.change.delta > 0, 'the winner moved up');
  assert.equal(outcome.state.rating, before.rating + outcome.verdict.change.delta);
  assert.equal(outcome.state.matches, before.matches + 1);
  assert.equal(outcome.state.wins, before.wins + 1);
  assert.deepEqual(storedFile(), outcome.state, 'the new file is the one a reload reads');
  assert.equal(storedFiledKey(), store.raceKeyOf(RESULT), 'the guard key was written');

  // The ladder submission is the new rating, with the race's story on it.
  assert.deepEqual(outcome.ladder, { accepted: true, rank: 7 });
  assert.equal(submissions.length, 1, 'the board was told exactly once');
  assert.equal(submissions[0].score, outcome.state.rating, 'the number sent is the number kept');
  assert.equal(submissions[0].duration, 420, 'the board bounds a race by its real length');
  assert.equal(submissions[0].mode, transport.LADDER_MODE, 'submitted to the board config’s mode');
  assert.equal(submissions[0].metadata?.season, RANK_SEASON);
  assert.equal(submissions[0].metadata?.matches, outcome.state.matches);
  assert.equal(submissions[0].metadata?.result, 'win');
  assert.equal(submissions[0].metadata?.position, 1);
  assert.equal(submissions[0].metadata?.field, 2);
  assert.equal(submissions[0].metadata?.tier, rankKeyOf(outcome.state), 'the board is told which badge to draw');
});

test('RK-02 files a loss from the ROOM’s classification, never from local opinion', async () => {
  // This seat finished LAST: the verdict comes from the room's order, and the
  // number goes down.
  const before = file(1300, 20);
  const outcome = await store.fileRoomResult({
    result: { ...RESULT, order: [{ playerId: 'them', finished: true }, { playerId: 'me', finished: true }] },
    selfId: 'me',
    board,
    state: before,
  });
  assert.equal(outcome.applied, true);
  assert.equal(outcome.verdict.won, false);
  assert.equal(outcome.verdict.position, 2);
  assert.ok(outcome.state.rating < 1300);
  assert.equal(outcome.state.losses, before.losses + 1);
  assert.deepEqual(storedFile(), outcome.state);
});

test('RK-02 counts one race ONCE, however many times the result arrives', async () => {
  const first = await store.fileRoomResult({ result: RESULT, selfId: 'me', board, state: file(1180) });
  const again = await store.fileRoomResult({ result: RESULT, selfId: 'me', board, state: first.state });

  assert.equal(first.applied, true);
  assert.equal(again.applied, false, 'the second arrival is a no-op');
  assert.deepEqual(again.state, first.state, 'and it does not move the rating again');
  assert.equal(again.ladder, null, 'nor does it re-publish to the ladder');
  assert.equal(submissions.length, 1, 'the board heard about this race once');
  assert.equal(storedFiledKey(), store.raceKeyOf(RESULT));
});

test('RK-02 still files a REMATCH: a new race is a new key', async () => {
  const first = await store.fileRoomResult({ result: RESULT, selfId: 'me', board, state: file(1180) });
  const rematch = { ...RESULT, at: RESULT.at + 600_000, order: [order[1], order[0]] };
  const second = await store.fileRoomResult({ result: rematch, selfId: 'me', board, state: first.state });

  assert.equal(second.applied, true);
  assert.equal(second.state.matches, first.state.matches + 1);
  assert.equal(storedFiledKey(), store.raceKeyOf(rematch));
});

test('RK-02 a race that was not rated is a no-op, not an error', async () => {
  // A field of one (a solo lobby, an AI-only grid): the room still settled a
  // classification, but there is nobody to rate against — nothing moves, and
  // nothing is written, including the provisional counter.
  const solo = await store.fileRoomResult({
    result: { ...RESULT, order: [{ playerId: 'me', finished: true }] },
    selfId: 'me',
    board: [{ playerId: 'me', rating: 1180, games: 12, known: true }],
    state: file(1180),
  });
  assert.equal(solo.rated, false);
  assert.equal(solo.applied, false);
  assert.equal(solo.ladder, null);
  assert.deepEqual(solo.state, file(1180));
  assert.equal(storedFile(), null, 'an unrated race writes nothing at all');
});

test('RK-02 the LEAVER’s own seat files locally: no ladder write, no guard key', async () => {
  // The room files the race without the driver who walked out, so that seat
  // applies its own loss on the way through the door — but it does not get to
  // publish it to the ladder, and it does not take the once-only key either
  // (the room's own filing of this race must still be able to land).
  const walkedOut = await store.fileRoomResult({
    result: {
      ...RESULT,
      order: [{ playerId: 'them', finished: true }, { playerId: 'me', finished: false, left: true }],
      durationSec: 0,
      reason: 'forfeit',
    },
    selfId: 'me',
    board,
    state: file(1180),
    localOnly: true,
  });

  assert.equal(walkedOut.applied, true);
  assert.equal(walkedOut.rated, true);
  assert.equal(walkedOut.verdict.forfeit, true);
  assert.equal(walkedOut.verdict.finished, false);
  assert.ok(walkedOut.state.rating < 1180, 'leaving is a loss, not a free exit');
  assert.equal(walkedOut.ladder, null, 'a leaver does not publish its own number');
  assert.equal(storedFiledKey(), null, 'and it does not consume the race key');
  assert.deepEqual(storedFile(), walkedOut.state, 'the local loss is still kept');
});

test('RK-02 an unreachable ladder does not break the race end', async () => {
  ladderAnswer = async () => { throw new Error('ladder down'); };
  const outcome = await store.fileRoomResult({ result: RESULT, selfId: 'me', board, state: file(1180) });

  assert.equal(outcome.applied, true, 'the race still filed');
  assert.ok(outcome.state.rating > 1180, 'and the rating still moved');
  assert.deepEqual(storedFile(), outcome.state, 'and the file is still the one a reload reads');
  assert.deepEqual(outcome.ladder, { accepted: false, rank: null });
});

test('RK-02 a refused submission (keep-best) is reported, not treated as an error', async () => {
  // The board keeps the best a driver has been, so a lower number comes back
  // accepted:false — the ordinary shape of a rating that must also fall.
  ladderAnswer = async () => ({ accepted: false, rank: 12, reason: 'lower than your best' });
  const outcome = await store.fileRoomResult({
    result: { ...RESULT, order: [{ playerId: 'them', finished: true }, { playerId: 'me', finished: true }] },
    selfId: 'me',
    board,
    state: file(1300, 20),
  });
  assert.equal(outcome.applied, true);
  assert.deepEqual(outcome.ladder, { accepted: false, rank: 12 });
  assert.deepEqual(storedFile(), outcome.state, 'the private file still holds where the driver actually is');
});

// ══════════════════════════════════════════════════════════════════════════
// 4. The ladder, and the store the game is handed
// ══════════════════════════════════════════════════════════════════════════

test('RK-02 reads the ladder through the SDK seam, and degrades to null when the board fails', async () => {
  const ladder = await store.rankStore().loadLadder(20);
  assert.ok(ladder, 'the SDK answers a page');
  assert.ok(Array.isArray(ladder!.entries));
  assert.equal(typeof ladder!.total, 'number');
  assert.equal(transport.isLadderAvailable(), true);

  const realGetPaged = realLeaderboard.getPagedScores;
  realLeaderboard.getPagedScores = async () => { throw new Error('board unreachable'); };
  assert.equal(await store.rankStore().loadLadder(20), null, 'an unreachable board is null, not a thrown error');
  realLeaderboard.getPagedScores = realGetPaged;
});

test('RK-02 the REAL board behind the seam accepts a submitted rating', async () => {
  // The recording responder above is a test instrument; this is the SDK's own
  // board, driven through the real chain, to prove `submitLadderScore` speaks
  // the platform's dialect (a wrong mode, a bad duration or a malformed payload
  // is refused by the board, not by us).
  realLeaderboard.submitScore = realSubmitScore;
  // This is the session's only REAL submission (every other test drives the
  // recording responder), so the little keep-best board has nothing to compare
  // against and a fixed number is deterministic here.
  const accepted = await transport.submitLadderScore({ rating: 1042, durationSec: 300 });
  assert.equal(accepted.accepted, true, `the board refused 1042: ${accepted.reason ?? 'no reason'}`);
  assert.equal(accepted.rank, 1);
});

test('RK-02 the store the game is handed exposes the three things a race needs', async () => {
  const shared = store.rankStore();
  assert.equal(typeof shared.loadState, 'function');
  assert.equal(typeof shared.fileResult, 'function');
  assert.equal(typeof shared.loadLadder, 'function');
  // A singleton, so the lobby and the race share ONE filed key — a rematch in
  // the same page cannot race two stores over one file.
  assert.strictEqual(store.rankStore(), shared);
  assert.notStrictEqual(store.createRankStore(), shared);
});

test('RK-02 derives one race key for one race, from the room’s own stamp and field', async () => {
  const key = store.raceKeyOf(RESULT);
  assert.equal(key, `${RESULT.at}:me,them`);
  // The same race reaches both seats: the key must not depend on WHO is
  // asking, or one client would file a race the other is still guarding.
  assert.equal(store.raceKeyOf({ at: RESULT.at, order }), key);
  // A rematch, a different field, and a DNF/leaver difference are all
  // different races.
  assert.notEqual(store.raceKeyOf({ at: RESULT.at + 1, order }), key);
  assert.notEqual(store.raceKeyOf({ at: RESULT.at, order: [order[1], order[0]] }), key);
  assert.notEqual(
    store.raceKeyOf({ at: RESULT.at, order: [{ playerId: 'me', finished: false, left: true }, order[1]] }),
    key,
  );
});

// ══════════════════════════════════════════════════════════════════════════
// 5. The leaderboard board's own config — a typo in it fails at deploy
// ══════════════════════════════════════════════════════════════════════════

test('RK-02 rundot/leaderboard.config.json declares the ladder mode the transport submits to', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(root, 'rundot/leaderboard.config.json'), 'utf8')) as {
    modes?: Record<string, { displayName?: string; minScore?: number; maxScore?: number }>;
    periods?: Record<string, { type?: string }>;
    minScore?: number; maxScore?: number; minDurationSec?: number; maxDurationSec?: number;
    requiresToken?: boolean; enableScoreSealing?: boolean;
    antiCheat?: { enableRateLimit?: boolean; minTimeBetweenSubmissionsSec?: number };
    displaySettings?: { maxEntriesPerPage?: number };
  };

  // The mode the transport submits to has to exist on the board, or every
  // submission is refused by a server the game cannot see.
  assert.ok(config.modes?.[transport.LADDER_MODE], `no "${transport.LADDER_MODE}" mode in the board config`);
  assert.ok(config.periods?.alltime, 'the ladder needs a period to rank in');

  // The bands have to ACCEPT a rating: the floor is rating.ts's 100 and the
  // ceiling is above any honest number, so a legitimate submission is never
  // refused for being out of bounds.
  assert.ok(config.minScore !== undefined && config.minScore <= 100, 'a floor rating must be a legal submission');
  assert.equal(config.modes[transport.LADDER_MODE].minScore, config.minScore);
  assert.equal(config.modes[transport.LADDER_MODE].maxScore, config.maxScore);
  assert.ok((config.maxScore ?? 0) >= 4000);
  assert.ok((config.minDurationSec ?? 0) >= 1, 'a zero-second race must not be submittable');

  // Every field the SDK's `LeaderboardConfig` requires, present — a missing one
  // fails at deploy, in production, silently.
  for (const field of ['requiresToken', 'enableScoreSealing', 'antiCheat', 'displaySettings']) {
    assert.ok(field in config, `the board config has no ${field}`);
  }
  assert.ok(config.displaySettings?.maxEntriesPerPage);
  // Keep-best is what makes the board a PEAK rating; the ordering is the
  // board's default, and the rate limit is what stops a client hammering it.
  assert.equal(config.antiCheat?.enableRateLimit, true);
});

/** The storage key the SDK's appStorage wraps, as it appears in the bucket. */
function keyEnding(key: string): string {
  const found = [...bucket.keys()].find((k) => k.endsWith(key));
  return found ?? `rundotGame:appStorage:test:${key}`;
}
