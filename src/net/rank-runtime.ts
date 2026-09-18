// ══════════════════════════════════════════════════════════════════════════
// RK-03 (#57) — the race-time half of the ranking system.
//
// `rating.ts` is the arithmetic, `rankstore.ts` is where a rating is kept, and
// THIS is the glue a running race needs: hold the driver's file, publish it to
// the room, claim the classification when the flag falls, and turn the room's
// `result` into a verdict the ending screen can print.
//
// Why it is a class and not four functions in the online screen: a whole race
// has to stay drivable from a node test, with no SDK and no storage (the
// headless host+guest test in `tests/room.test.ts` is where "every client
// computes the same deltas" is proven). So the STORE arrives by injection and
// the screen only ever sees the small interfaces below. In the browser the
// store is `rankStore()` from `rankstore.ts`; in a test it is three stubs.
//
// Ported from HexMatch's `src/net/rank-runtime.ts` (`RankRuntime`), which rated
// a DUEL. The class, its injection seams and its `filed` once-only guard are
// that file's; three things are a race's instead:
//
//   (1) a CLAIM is a classification — `claimFinish` builds the rows from the
//       host's `results` frame plus the seat roster, where HexMatch's
//       `claimWin` named a winner and a loser;
//   (2) the filing FIELD is derived from the result itself: the room's board is
//       read together with the order it arrived with, so every seat computes
//       `rateRace` from one identical `(board, order)` pair. HexMatch read the
//       opponent off a board the session had been assembling;
//   (3) a leaver's own write is a DNF, not a loss to one named opponent — see
//       `fileOwnForfeit`.
// ══════════════════════════════════════════════════════════════════════════
import type { RankedRow, ResultMsg } from './protocol';
import {
  freshRankState,
  rankBoardFrom,
  ratedPlayerFor,
  type RankBoard,
  type RankState,
  type RatedPlayer,
  type RaceVerdict,
} from './rating';
// Type-only: `rankstore.ts` reaches the SDK, and this module must not.
import type { FiledOutcome, RankLadder, RankStore } from './rankstore';
import type { RaceLink } from './session';

/**
 * A grid seat, as the classification builder needs it — structurally a `Seat`
 * (`src/net/protocol.ts`), kept minimal so a test can pass three fields.
 */
export interface RankSeat {
  /** Grid slot — the index every packed frame and every `results` row uses. */
  slot: number;
  /** The driver, or `''` on an AI seat. */
  playerId: string;
  isAI: boolean;
}

/**
 * Where a rating goes. Implemented by the online screen over its room link
 * (`raceRankSession` below is the whole adapter); faked in tests. Deliberately
 * narrow — the runtime only ever does these two things with a room.
 */
export interface RankSession {
  readonly playerId: string;
  /** Tell the room this seat's number. False when there was no room to tell. */
  publishRating(state: RankState, joinToken: string): boolean;
  /** HOST only: file this race's classification. False when it could not be sent. */
  claimResult(order: readonly RankedRow[], durationSec: number, rated: boolean): boolean;
}

export interface RankRuntimeOptions {
  session: RankSession;
  store: RankStore;
  /** The grid, so a claim can turn `results`' seat indices into driver ids. */
  roster?: readonly RankSeat[];
  /** The room's rating board at the moment the race screen was built (welcome copy). */
  board?: RankBoard;
  /**
   * The room's rated rules as this seat knows them: true only when the driver
   * entered by matchmaking and the lobby raced without house-rule power-ups.
   * Read by `claimFinish` and `fileOwnForfeit`; the ROOM has the last word (see
   * `ResultMsg.rated`), which is why a stray `true` here cannot rate a race the
   * room refused.
   */
  ratedRoom?: boolean;
  /** Fired once the room's verdict has been folded into the local file. */
  onVerdict?: (verdict: RaceVerdict) => void;
}

/**
 * A per-room nonce, minted by each client when it joins (RK-03's join token).
 *
 * Not a secret and not a security boundary: it exists so that a driver who
 * joins LATER — or a stale tab left open in the back room — cannot overwrite a
 * rating mid-room. Unpredictable enough for that is all it has to be, and it is
 * never persisted: a rejoin mints a new one, which is exactly right, because a
 * rejoining client is the owner speaking again.
 */
export function mintJoinToken(now: () => number = Date.now): string {
  return `${now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

export class RankRuntime {
  private readonly session: RankSession;
  private readonly store: RankStore;
  private readonly onVerdict: (verdict: RaceVerdict) => void;
  private readonly roster: Map<number, RankSeat>;
  private readonly joinToken: string;
  private readonly ratedRoom: boolean;
  private stateValue: RankState | null = null;
  private verdictValue: RaceVerdict | null = null;
  private outcomeValue: FiledOutcome | null = null;
  private boardValue: RankBoard;
  private filed = false;
  private started = false;

  constructor(opts: RankRuntimeOptions) {
    this.session = opts.session;
    this.store = opts.store;
    this.roster = new Map((opts.roster ?? []).map((seat) => [seat.slot, seat]));
    this.boardValue = opts.board ? { ...opts.board } : {};
    this.ratedRoom = opts.ratedRoom === true;
    this.joinToken = mintJoinToken();
    this.onVerdict = opts.onVerdict ?? (() => {});
  }

  /** The driver's rating file; null until the store has answered. */
  get state(): RankState | null {
    return this.stateValue;
  }

  /** The race's verdict, once the room has filed one. */
  get verdict(): RaceVerdict | null {
    return this.verdictValue;
  }

  /** True once a result has been folded in (so the UI can stop saying "pending"). */
  get settled(): boolean {
    return this.verdictValue !== null;
  }

  /**
   * Everything the filing produced, for the results screen: whether the race
   * counted at all (`rated` — false for a race the room's rules did not rate),
   * whether the write landed (`stored`), and what the ladder said.
   *
   * Separate from `verdict` on purpose. The verdict is the arithmetic's answer
   * to "where did I finish and what would that be worth"; the outcome is the
   * policy's answer to "was any of it kept". A house-rules race has a verdict
   * and no numbers moved, and only the caller that reads both can say so.
   */
  get outcome(): FiledOutcome | null {
    return this.outcomeValue;
  }

  /** Whether this seat believes the room rates races at all. */
  get rated(): boolean {
    return this.ratedRoom;
  }

  /**
   * Load the file and publish it to the room. Idempotent: a screen may already
   * have published the same rating under the same join token, and the room
   * treats a re-publish as an update rather than a second entry.
   */
  async start(): Promise<RankState> {
    if (this.started && this.stateValue) return this.stateValue;
    this.started = true;
    // A store that throws must not take the race down with it: a driver whose
    // storage is unreachable plays an unrated-looking race, not a broken one.
    let state: RankState;
    try {
      state = await this.store.loadState();
    } catch {
      state = freshRankState();
    }
    this.stateValue = state;
    this.session.publishRating(state, this.joinToken);
    return state;
  }

  /**
   * Fold a board update from the session into the runtime's copy.
   *
   * Never let a board LOSE an entry: ratings only arrive, and a stale empty
   * update (a welcome with no ratings, an old relay) must not erase another
   * driver's number and turn a rated race into an unrated one.
   */
  applyBoard(board: RankBoard): void {
    for (const [id, entry] of Object.entries(board)) this.boardValue[id] = entry;
  }

  /** The room's board, for the lobby UI. */
  get board(): RankBoard {
    return { ...this.boardValue };
  }

  /**
   * HOST: the flag has fallen. Turn the room's own `results` frame into the
   * claim and send it — the host does NOT rate the race itself here, so every
   * seat's arithmetic runs on one identical, room-stamped result.
   *
   * `results.order` is every seat best-first (AI included) and `times[slot]` is
   * null for a non-finisher, so this is where a race's classification is born:
   * the human seats, in the order the simulation classified them, with anyone
   * the frame could not place appended as a DNF — a rated seat that vanishes
   * from the order would shrink everybody else's field.
   */
  claimFinish(results: { order: readonly number[]; times: readonly (number | null)[] }, durationSec: number): boolean {
    if (this.filed) return false;
    const order: RankedRow[] = [];
    const seen = new Set<number>();
    for (const slot of results.order) {
      if (seen.has(slot)) continue;
      seen.add(slot);
      const row = this.humanRow(slot);
      if (!row) continue;
      order.push({ playerId: row.playerId, finished: results.times[slot] !== null && results.times[slot] !== undefined });
    }
    for (const slot of this.roster.keys()) {
      if (seen.has(slot)) continue;
      const row = this.humanRow(slot);
      if (row) order.push({ playerId: row.playerId, finished: false });
    }
    if (order.length === 0) return false;
    return this.session.claimResult(order, Math.max(0, Math.round(durationSec)), this.ratedRoom);
  }

  /**
   * Either seat: the room filed the result. Rate the race, keep the rating, and
   * hand the verdict to the UI.
   *
   * The board that arrives WITH the result is used in preference to the one
   * held locally: it is the board the result was filed against, so a seat that
   * missed an update still computes the same numbers as its neighbours. The
   * FIELD is this seat's row set — the rated humans of `msg.order` — so the
   * inputs are `(the room's board, the room's classification)` and nothing
   * else.
   *
   * A result that does not name this seat at all is not this seat's race: an
   * unrated spectator in a lobby, or a driver who never appeared in the
   * classification, has nothing to fold in.
   */
  async handleResult(msg: ResultMsg, selfId = this.session.playerId): Promise<RaceVerdict | null> {
    if (!msg.order.some((row) => row.playerId === selfId)) return null;
    if (this.filed) return null;
    this.filed = true;
    this.applyBoard(rankBoardFrom(msg.ratings));
    const state = this.stateValue ?? (await this.start());
    let outcome: FiledOutcome;
    try {
      outcome = await this.store.fileResult({
        result: {
          at: msg.at,
          order: msg.order,
          durationSec: msg.durationSec,
          reason: msg.reason,
          rated: msg.rated,
        },
        selfId,
        board: this.fieldOf(msg.order, selfId),
        state,
      });
    } catch {
      // Storage refused the write. The driver still gets the verdict on screen —
      // the number they keep is the one already stored.
      return null;
    }
    this.stateValue = outcome.state;
    this.verdictValue = outcome.verdict;
    this.outcomeValue = outcome;
    // Tell the room the new number, so a rematch in this room rates correctly.
    this.session.publishRating(outcome.state, this.joinToken);
    this.onVerdict(outcome.verdict);
    return outcome.verdict;
  }

  /**
   * THIS driver walked out of a live rated race.
   *
   * The room will file the same race without them — their row a DNF, which is
   * what `RaceEntry.left` is for — but this seat will never see that message
   * (it is leaving). So the leaver applies their own DNF locally, from the same
   * board, so both sides of the same abandonment land on the same number.
   *
   * `rivals` are the other rated drivers the seat knew about; each is filed as
   * a finisher, which is the race policy a duel states as "the leaver loses":
   * a driver who walks out is behind everyone who is still in it. The truth for
   * the SURVIVORS' numbers is the room's own filed result, not this estimate.
   *
   * `localOnly` on purpose: no ladder write. The ladder is written from a
   * result the room witnessed, and a client that writes its own loss on the way
   * out is a client that could have written anything on the way out. (A loss
   * cannot raise a keep-best ladder number anyway, so nothing is lost by it.)
   */
  async fileOwnForfeit(rivals: readonly string[] = [], opts: { rated?: boolean } = {}): Promise<RaceVerdict | null> {
    if (this.filed) return null;
    this.filed = true;
    const state = this.stateValue ?? (await this.start());
    const order: RankedRow[] = [];
    for (const playerId of rivals) {
      if (playerId !== this.session.playerId && !order.some((row) => row.playerId === playerId)) {
        order.push({ playerId, finished: true });
      }
    }
    order.push({ playerId: this.session.playerId, finished: false, left: true });
    try {
      const outcome = await this.store.fileResult({
        result: {
          // A local-only write consumes no once-only key (see `fileRoomResult`),
          // so this stamp is this seat's own; `filed` is what stops a second
          // application if the room's result somehow arrives anyway.
          at: Date.now(),
          order,
          durationSec: 0,
          reason: 'forfeit',
          rated: opts.rated ?? this.ratedRoom,
        },
        selfId: this.session.playerId,
        board: this.fieldOf(order, this.session.playerId),
        state,
        localOnly: true,
      });
      this.stateValue = outcome.state;
      this.verdictValue = outcome.verdict;
      this.outcomeValue = outcome;
      return outcome.verdict;
    } catch {
      return null;
    }
  }

  /**
   * The rated field of this race, as the room's board has it — minus this seat.
   *
   * Rivals' numbers come from the ROOM (`msg.ratings`), never from this
   * client's opinion, which is what makes every seat's view of the rest of the
   * field identical. This driver's own numbers come from their own file
   * instead: `rateRaceOutcome` adds the seat back from `state` (HexMatch's
   * rule, and the right one — a driver whose publish never landed would
   * otherwise be rated from a stranger's guess at them). Whenever the publish
   * DID land, the two are the same number, and the whole field agrees.
   */
  private fieldOf(order: readonly RankedRow[], selfId: string): RatedPlayer[] {
    return order
      .filter((row) => row.playerId !== selfId)
      .map((row) => ratedPlayerFor(this.boardValue, row.playerId));
  }

  /** The public ladder, for the lobby's panel. */
  ladder(limit = 20): Promise<RankLadder | null> {
    return this.store.loadLadder(limit);
  }

  /** One roster slot as a rated row, or null when it is not a human seat. */
  private humanRow(slot: number): { playerId: string } | null {
    const seat = this.roster.get(slot);
    if (!seat || seat.isAI || seat.playerId === '') return null;
    return { playerId: seat.playerId };
  }
}

/**
 * The whole adapter an online screen needs: the runtime's two messages, sent
 * down the room's link. Pure — no SDK, no DOM — so a headless test drives the
 * same code the screen does, and the SDK stays behind `src/net/transport.ts`.
 */
export function raceRankSession(link: RaceLink, playerId: string): RankSession {
  return {
    playerId,
    publishRating(state, joinToken) {
      return send(link, {
        type: 'playerRating',
        playerId,
        rating: state.rating,
        games: state.matches,
        joinToken,
      });
    },
    claimResult(order, durationSec, rated) {
      return send(link, { type: 'resultClaim', order: [...order], durationSec, rated });
    },
  };
}

/** Send one frame; false when the socket was already gone. */
function send(link: RaceLink, msg: Parameters<RaceLink['send']>[0]): boolean {
  try {
    link.send(msg);
    return true;
  } catch {
    return false;
  }
}
