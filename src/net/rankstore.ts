// ══════════════════════════════════════════════════════════════════════════
// RK-02 — where a rating lives between races.
//
// The arithmetic is in `rating.ts` (pure, RK-01) and the race-time glue will be
// `rank-runtime.ts` (RK-03, SDK-free). THIS is the policy around both: the
// storage keys, the once-only guard that stops a reload from filing one race
// twice, the fresh-file fallback, and the single call site that writes a rating
// to the public ladder.
//
// Ported from HexMatch (`src/net/rankstore.ts`, RANK-01 #147) and adapted to a
// race. Two of HexMatch's decisions are REVERSED here, deliberately, and the
// reasoning is below — read those two before changing anything.
//
// WHAT IS AUTHORITATIVE, AND WHAT IS NOT
//
//   the ROOM       — the only witness to every seat, and the only party that
//                    may declare a race over or a driver forfeited. A rating
//                    only ever moves from the room's filed classification
//                    (RK-03); nothing client-side invents a verdict.
//
//   player storage — the rating file: RUN `appStorage` where the host provides
//                    it (per-player, cloud-backed, not readable or writable by
//                    any other seat). A driver owns that bucket, so a
//                    determined cheat can rewrite their own number — which is
//                    why a rating GATES NOTHING: it is a badge and a ladder
//                    position. The seam to revisit if the platform grows
//                    server-writable per-player storage is THIS FILE plus the
//                    `readPlayerValue` / `writePlayerValue` wrappers.
//
//   the LADDER     — a leaderboard board, keep-best, so it shows a driver's
//                    PEAK rating. The private file holds where they are NOW.
//                    The two are supposed to differ.
//
// TWO DEPARTURES FROM HEXMATCH, AND WHY
//
//   1. NO `localStorage` MIRROR. HexMatch keeps a `localStorage` copy of the
//      file so a dev room (no RUN host) behaves like a hosted one. This
//      repository's rule is the stricter one — RUN.world blocks `localStorage`,
//      and everything persistent already goes through `src/game/storage.ts`'s
//      device cache — so there is no second store here: no RUN storage means a
//      FRESH FILE, every boot, and a race in a dev room is simply unrated. The
//      alternative would be a rating kept in a browser bucket that the shipped
//      game cannot read, which is a worse lie than starting at 1000 again.
//
//   2. AN ANONYMOUS DRIVER IS NOT RATED. HexMatch files a rating for anyone;
//      here an unsigned player has no per-player bucket and no ladder row to
//      publish to, so `ratedRacingAllowed()` is false for them and the rating
//      surfaces say "sign in to be ranked" instead of showing a number that
//      would evaporate. A signed-out player still races — unrated.
// ══════════════════════════════════════════════════════════════════════════
import {
  RANK_FILED_KEY,
  RANK_STORAGE_KEY,
  hasPlayerStorage,
  isAnonymous,
  isLadderAvailable,
  readLadder,
  readPlayerValue,
  submitLadderScore,
  writePlayerValue,
  type LadderResult,
  type LadderSubmitResult,
} from './transport';
import {
  advanceRating,
  freshRankState,
  ladderScoreFor,
  parseRankState,
  rankKeyOf,
  rateRaceOutcome,
  serializeRankState,
  type RaceEntry,
  type RaceVerdict,
  type RankState,
  type RatedPlayer,
} from './rating';

/**
 * The ladder, as the panel prints it. `LadderResult` is the transport's own
 * shape (the SDK's page, narrowed); re-exported here so the UI imports the
 * store and never the transport.
 */
export type RankLadder = LadderResult;

/** What filing one race produced, for the results screen. */
export interface FiledOutcome {
  /** The rating file after the race — unchanged when the race was not rated. */
  state: RankState;
  verdict: RaceVerdict;
  /** False when this race had already been filed (the once-only guard). */
  applied: boolean;
  /**
   * True when this race COUNTED for this seat — it was rated by the room's
   * rules (`RoomRaceResult.rated`) AND the arithmetic had a field to rate
   * (`RankVerdict.rated`). False is the "no delta on this screen" flag: a
   * practice race, a friends' lobby with house rules, or a race against nobody.
   */
  rated: boolean;
  /**
   * Whether the rating file is in RUN storage after this call. False when a
   * write was NEEDED and the bucket refused it: the race still settled and the
   * verdict is still printable, but the number will not survive a reload — and
   * the results screen can say so rather than quietly losing it. A call that
   * wrote nothing (a race already filed, a race that was not rated) leaves the
   * file exactly as it was and reports it as stored.
   */
  stored: boolean;
  /** What the ladder said, or null when this file did not write to it. */
  ladder: { accepted: boolean; rank: number | null } | null;
}

/** One race to file, as the ROOM settled it. `at` and `order` are its identity. */
export interface RoomRaceResult {
  /**
   * The ROOM's own stamp for this race (ms). It is what the once-only key is
   * built from, so it must be identical on every seat — a client clock is not
   * a race's identity.
   */
  at: number;
  /**
   * The rated drivers in finishing order: `results.order` filtered to humans,
   * each with `finished`, and `left` on anyone the room saw abandon. These are
   * player ids, never marble seats — AI marbles are not rated.
   */
  order: RaceEntry[];
  /** The whole race lasted this long, for the ladder board's own bounds. */
  durationSec?: number;
  /** The room's verdict for one seat, when the room sent one. */
  reason?: 'finish' | 'forfeit';
  /**
   * RK-03: the ROOM's verdict on whether this race counts at all — its rules,
   * not the arithmetic. Absent reads as rated. False means the room did not
   * rate this race (it was not created by matchmaking, or the host set
   * house-rule power-ups): the classification is still shown, but NOTHING is
   * written — no rating file, no ladder line, no once-only key consumed. The
   * gate is here rather than in the runtime so that "an unrated race changes
   * nothing" is a property of the store, where the writes are.
   */
  rated?: boolean;
}

/**
 * Where a rating is kept, as RK-03's runtime needs it — deliberately narrow,
 * so the race glue can be tested with three stubs and never loads the SDK.
 */
export interface RankStore {
  /** The player's file: RUN storage, or a fresh one. Never throws. */
  loadState(): Promise<RankState>;
  /** File a room result for this seat. A once-only key guards a double filing. */
  fileResult(input: {
    result: RoomRaceResult;
    selfId: string;
    /** The whole rated field (this seat included) from the room's board. */
    board: RatedPlayer[];
    state: RankState;
    /**
     * A race THIS client abandoned: it applies its own loss (the room will file
     * the same race without it) but writes nothing to the ladder — a client
     * that publishes its own loss on the way out is a client that could have
     * published anything on the way out.
     */
    localOnly?: boolean;
  }): Promise<FiledOutcome>;
  /** The public ladder, or null when there is no board behind this page. */
  loadLadder(limit?: number): Promise<RankLadder | null>;
}

// ── the file ───────────────────────────────────────────────────────────────

/**
 * Where a rating is kept between races, as a seam.
 *
 * Production is `RUN_RANK_IO`: per-player storage plus the keep-best ladder,
 * both behind `src/net/transport.ts` — the SDK is never named here. It is a
 * parameter for one reason: a page has exactly ONE player bucket, and RK-03's
 * acceptance (“every client shows the same deltas for one race”) needs two
 * seats of one race filing for real, side by side, in a test. Two `RankIO`s,
 * two buckets, one `fileRoomResult`.
 */
export interface RankIO {
  readStorage: (key: string) => Promise<string | null>;
  writeStorage: (key: string, value: string) => Promise<boolean>;
  submitLadder: (params: {
    rating: number;
    durationSec: number;
    metadata?: Record<string, unknown>;
  }) => Promise<LadderSubmitResult>;
}

/** The one store the shipped game has: RUN player storage and the ladder. */
export const RUN_RANK_IO: RankIO = {
  readStorage: readPlayerValue,
  writeStorage: writePlayerValue,
  submitLadder: submitLadderScore,
};

/**
 * The rating file, or a fresh one. Never throws — a boot path that can fail on
 * a storage read is worse than a rating that starts again at 1000.
 *
 * There is exactly one store: RUN player storage. A page without it (a dev
 * room, a preview, a signed-out player) gets a fresh file every time, and the
 * race it plays is unrated. See departure (1) in the header.
 */
export async function loadRankState(io: RankIO = RUN_RANK_IO): Promise<RankState> {
  try {
    return parseRankState(await io.readStorage(RANK_STORAGE_KEY)) ?? freshRankState();
  } catch {
    return freshRankState();
  }
}

/** Persist a rating file. Resolves whether RUN's storage took the write. */
export async function saveRankState(state: RankState, io: RankIO = RUN_RANK_IO): Promise<boolean> {
  try {
    return await io.writeStorage(RANK_STORAGE_KEY, serializeRankState(state));
  } catch {
    return false;
  }
}

/** The last room result this client filed, as its once-only key. */
export async function loadFiledKey(io: RankIO = RUN_RANK_IO): Promise<string | null> {
  try {
    return await io.readStorage(RANK_FILED_KEY);
  } catch {
    return null;
  }
}

export async function saveFiledKey(key: string, io: RankIO = RUN_RANK_IO): Promise<boolean> {
  try {
    return await io.writeStorage(RANK_FILED_KEY, key);
  } catch {
    return false;
  }
}

/**
 * Can this client be rated at all? Both halves have to be true:
 *
 *   - a SIGNED-IN player — per-player storage and a ladder row only exist
 *     behind the platform's access gate (HexMatch's login gating, applied to us
 *     as departure (2)); and
 *   - a page with a per-player bucket behind it at all (`hasPlayerStorage`).
 *
 * What this deliberately does NOT answer is whether the bucket TOOK the last
 * write. That is only knowable when a write happens, and it comes back
 * per-call: `saveRankState` returns it, and `FiledOutcome.stored` carries it to
 * the results screen. Caching a failed write here would be a screen that can
 * never recover — a driver who fixed their storage would still be told they are
 * unrated for the rest of the session.
 */
export function ratedRacingAllowed(): boolean {
  return !isAnonymous() && hasPlayerStorage();
}

/**
 * The one line the rating surfaces show a driver who cannot be ranked. Kept
 * here (not in the UI) so the lobby, the results screen and the ladder panel
 * cannot each invent their own wording for the same state.
 */
export const SIGN_IN_TO_BE_RANKED = 'Sign in to be ranked — races count once you have a RUN.world account.';

/**
 * A race's identity, as both seats derive it: the ROOM's stamp plus the field,
 * in finishing order.
 *
 * `at` alone would not do: a room outlives a race (a rematch in the same room
 * is a different race, and a season of rematches must not collide), and the
 * order alone would not either (two races can end in the same order). Together
 * they are stable across both seats, across a reload, and across the room's
 * broadcast — and two clients looking at one race always derive the same
 * string.
 *
 * Deliberately NOT the room code: a six-character code identifies a ROOM, and
 * every race in it would then share one key and one refiling would swallow the
 * next.
 *
 * The field marks how each driver ended: a finisher is bare, a driver the room
 * saw abandon gets `!`, and any other non-finisher gets `-`. They are part of
 * the key so that two races which differ only in who actually got home cannot
 * collide on one string.
 */
export function raceKeyOf(result: Pick<RoomRaceResult, 'at' | 'order'>): string {
  const field = result.order
    .map((entry) => `${entry.playerId}${entry.finished ? '' : entry.left ? '!' : '-'}`)
    .join(',');
  return `${result.at}:${field}`;
}

// ── filing ─────────────────────────────────────────────────────────────────

/**
 * File a race into this driver's own rating.
 *
 * The once-only guard is why this is a function and not two lines at the call
 * site: a filed result can arrive twice (a broadcast plus a reconnect replay),
 * and one race must never move a rating twice. The key is written BEFORE the
 * rating, so a crash between the two loses a rating move rather than
 * duplicating one — the same order HexMatch chose, for the same reason.
 *
 * Every number comes from the room: `board` is the room's copy of who is what
 * and `order` is the room's classification, so the seat's half is computed from
 * the same inputs as every other seat's.
 */
export async function fileRoomResult(input: {
  result: RoomRaceResult;
  selfId: string;
  board: RatedPlayer[];
  state: RankState;
  localOnly?: boolean;
}, io: RankIO = RUN_RANK_IO): Promise<FiledOutcome> {
  const verdict = rateRaceOutcome({
    self: { playerId: input.selfId, state: input.state },
    board: input.board,
    order: input.result.order,
  });

  // The room's rules first: a race the room did not rate is not filed whatever
  // the arithmetic would have said about it, and it consumes no key — so a
  // rated rematch in the same room still files.
  if (input.result.rated === false) {
    return { state: input.state, verdict, applied: false, rated: false, stored: true, ladder: null };
  }

  // A race that was not rated (a field of one, a solo lobby) has nothing to
  // guard and nothing to publish: it is a no-op by definition, not an error.
  if (!verdict.rated) {
    return { state: input.state, verdict, applied: false, rated: false, stored: true, ladder: null };
  }

  const key = raceKeyOf(input.result);
  if (!input.localOnly && (await loadFiledKey(io)) === key) {
    // Same race, already counted: report the CURRENT file untouched. The
    // verdict is recomputed only for the screen's sake and deliberately not
    // adopted — a second arrival is a no-op, not a second rating.
    return { state: input.state, verdict, applied: false, rated: true, stored: true, ladder: null };
  }

  const next = advanceRating(input.state, verdict.state);
  if (!input.localOnly) await saveFiledKey(key, io);
  const stored = await saveRankState(next, io);
  if (input.localOnly) {
    return { state: next, verdict, applied: true, rated: true, stored, ladder: null };
  }

  // The ladder write is last and its failure is not the player's problem: the
  // rating is already in their own file, and a keep-best board would ignore a
  // lower number anyway.
  const ladder = await io.submitLadder({
    rating: ladderScoreFor(next.rating),
    durationSec: input.result.durationSec ?? 0,
    metadata: {
      season: next.season,
      matches: next.matches,
      wins: next.wins,
      losses: next.losses,
      field: verdict.field,
      position: verdict.position,
      result: verdict.won ? 'win' : 'loss',
      reason: input.result.reason ?? (verdict.forfeit ? 'forfeit' : 'finish'),
      tier: rankKeyOf(next),
    },
  });
  return {
    state: next,
    verdict,
    applied: true,
    rated: true,
    stored,
    ladder: { accepted: ladder.accepted, rank: ladder.rank },
  };
}

/**
 * The store the game is handed. A module-level singleton, so the lobby, the
 * race and the results screen share one instance — and therefore one once-only
 * key — and a rematch in the same page cannot race two stores over one file.
 */
export function createRankStore(io: RankIO = RUN_RANK_IO): RankStore {
  return {
    loadState: () => loadRankState(io),
    fileResult: (input) => fileRoomResult(input, io),
    loadLadder: (limit = 20) => readLadder(limit),
  };
}

let singleton: RankStore | null = null;

/** The shared store. Built lazily: importing this file must stay side-effect free. */
export function rankStore(): RankStore {
  singleton ??= createRankStore();
  return singleton;
}

/** True when there is a ladder board to read at all (the panel's first question). */
export { isLadderAvailable, isAnonymous };
