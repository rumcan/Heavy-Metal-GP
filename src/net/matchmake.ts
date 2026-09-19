// ══════════════════════════════════════════════════════════════════════════
// MP-07 — QUICK RACE: keep looking until somebody else is looking too.
//
// The SDK's `matchmakeRoom` is a BOUNDED request: it waits one window, and when
// the window closes it rejects and drops the ticket from the pool. "Keep
// looking until found or cancelled" is therefore the caller's loop, and this is
// it — written against a injected `request` and an injected `isExpired`, so it
// can be tested without a socket, and so the SDK's BETA surface stays behind
// `src/net/transport.ts` where it belongs. (`rankRungs` reads `searchBucket`
// from `rating.ts`, which is pure for exactly the same reason.)
//
// One honest wrinkle, and it is the platform's: there is no public cancel for a
// request that is already in flight, so a cancelled search can still be paired
// when its window closes. Bounding the window (`MATCHMAKE_WINDOW_MS`) bounds how
// long that can last, and a room that lands after a cancel is handed straight to
// `abandon` rather than left holding a seat.
//
// RK-04 (#58) gives the loop a LADDER: a search can be told to walk a list of
// steps, each one a wider rank window than the last, and the loop hands the
// current step to `request`. The loop itself needed no new idea for that — a
// closed window was already "ask again", and this is only "ask again, wider".
//
// Ported from HexMatch's `RANK_SEARCH_STEPS` / `beginMatch` (`src/ui/
// StartScreen.tsx`, RANK-01 #147), which is where the ladder's design is
// explained: flat equality criteria, one window per rung, the last rung asks
// for nothing in particular, and the ladder is walked ONCE — after it, the
// search stays at Any rank for as long as it takes. A window closing means
// widen and look again, never "no rival found".
// ══════════════════════════════════════════════════════════════════════════

import { searchBucket } from './rating';

/** How long to wait between one closed window and the next request. */
export const RETRY_PAUSE_MS = 400;

/**
 * One rung of a widening search: how wide its rank window is, and how long that
 * window is held open before the search moves on.
 */
export interface MatchStep {
  /** The rating span this rung searches, in points; 0 = any rank. */
  span: number;
  /** This rung's window budget in ms; absent = the caller's own default. */
  budgetMs?: number;
}

/**
 * The rank windows a similar-rank search widens through (HexMatch RANK-01).
 *
 * Why a ladder at all: `matchmakeRoom` takes flat equality criteria — the pool
 * has no "within N points" operator — so a window is a bucket index
 * (`searchBucket`) and a wider window is a DIFFERENT bucket. The search runs one
 * attempt per rung, on its own budget, and the last rung asks for nothing in
 * particular: a player is never left waiting on a window too narrow to contain
 * anybody.
 *
 * The ladder is walked ONCE. After the last rung the search keeps going at Any
 * rank — it never times out (#146) — because a window closing means widen and
 * look again, never "no rival found". `span: 0` is that last, never-narrower
 * rung.
 *
 * The pause between rungs is MP-07's `RETRY_PAUSE_MS` (HexMatch breathes a
 * second); the rungs themselves are HexMatch's, unsqueezed, so a driver is
 * never dropped into a bucket the platform would not have chosen.
 */
export const RANK_SEARCH_STEPS: readonly MatchStep[] = [
  { span: 75, budgetMs: 6_000 },   // same neighbourhood, tightest pair
  { span: 200, budgetMs: 8_000 },  // a tier or so apart
  { span: 400, budgetMs: 8_000 },  // a couple of tiers
  { span: 0, budgetMs: 8_000 },    // any rank — the escape hatch, repeated
];

/** The one flat rung a search without a ladder runs on. */
const FLAT_STEP: MatchStep = { span: 0 };

/**
 * A rung as `request` receives it: the step, where it sits on the ladder, and
 * whether it is the last one (the UI's "widening" line, and the `span: 0`
 * escape hatch at the end of it).
 */
export interface MatchRung extends MatchStep {
  /** 0-based rung; it stops at the last step however many windows close. */
  index: number;
  last: boolean;
}

export interface MatchmakerOptions<T> {
  /** One bounded matchmake request, for the rung the search is on. Rejects when its window closes, or for real. */
  request: (rung: MatchRung) => Promise<T>;
  /**
   * True when a rejection only means "that window closed — ask again". Anything
   * else (access denied, no room server, a connection failure) is a real
   * failure and must reach the player instead of looping for ever.
   */
  isExpired: (err: unknown) => boolean;
  /** Pause between one window closing and the next request. */
  pauseMs?: number;
  /** Called after each closed window, with how many have closed so far. */
  onWindowClosed?: (windows: number) => void;
  /** A room that landed AFTER `cancel()` — it is not wanted, so drop it. */
  abandon?: (room: T) => void;
  sleep?: (ms: number) => Promise<void>;
  /**
   * The rungs to walk, narrowest first. Absent = one flat rung (the MP-07
   * search, which is what a caller that cannot widen by rank wants); present =
   * the search widens one rung per closed window and stays on the LAST rung
   * for ever, so it never narrows again and never runs out of rungs.
   */
  steps?: readonly MatchStep[];
}

/**
 * One search for a race.
 *
 * `find()` resolves with the room, or `null` when the search was cancelled
 * before one landed; it throws when the platform failed for real.
 */
export class Matchmaker<T> {
  private cancelled = false;
  private running = false;
  private closed = 0;
  private readonly steps: readonly MatchStep[];

  constructor(private readonly opts: MatchmakerOptions<T>) {
    // A ladder of one is the flat search MP-07 shipped: same loop, same pause,
    // just no rung to widen to.
    this.steps = opts.steps && opts.steps.length > 0 ? opts.steps : [FLAT_STEP];
  }

  /** True while a search is under way. */
  get active(): boolean {
    return this.running && !this.cancelled;
  }

  /** Windows that have closed without finding anybody (0 = the first try). */
  get windows(): number {
    return this.closed;
  }

  /**
   * The rung the search is on NOW (the rung its next request will ask for). One
   * closed window widens it one step; the last step is where it stays.
   */
  get rung(): MatchRung {
    return this.rungFor(this.closed);
  }

  /** How many rungs this search has (1 for a search with no ladder). */
  get rungs(): number {
    return this.steps.length;
  }

  private rungFor(closed: number): MatchRung {
    const index = Math.min(closed, this.steps.length - 1);
    const step = this.steps[index];
    return { index, span: step.span, budgetMs: step.budgetMs, last: index === this.steps.length - 1 };
  }

  /** Stop looking. The search's `find()` resolves `null` when it notices. */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Keep asking until a room lands or the search is cancelled.
   *
   * The loop is the whole design: one request is one window, and a player
   * pressing Quick race is not a player who wants to be told "nobody else is
   * looking" thirty seconds later — they want to be in a race when somebody
   * else turns up.
   */
  async find(): Promise<T | null> {
    this.running = true;
    const sleep = this.opts.sleep ?? defaultSleep;
    while (!this.cancelled) {
      try {
        const room = await this.opts.request(this.rungFor(this.closed));
        if (this.cancelled) {
          // Paired on the way out: nobody is waiting in it, so it must not hold
          // a seat (or charge the room a player) while it sits there.
          this.opts.abandon?.(room);
          return null;
        }
        return room;
      } catch (err) {
        if (!this.opts.isExpired(err)) {
          this.running = false;
          throw err;
        }
        this.closed++;
        this.opts.onWindowClosed?.(this.closed);
        await sleep(this.opts.pauseMs ?? RETRY_PAUSE_MS);
      }
    }
    this.running = false;
    return null;
  }
}

/**
 * RANK-04: the ladder a driver's rating makes — every rung with the pool
 * criterion it asks for.
 *
 * The bucket is computed ONCE, when the search starts: it is the driver's own
 * rating that decides the windows (nothing moves a rating mid-search), and the
 * caller (the online screen) is the only party that knows the rating, so the
 * mapping lives here as a plain function rather than inside the loop.
 */
export function rankRungs(rating: number): readonly RankedRung[] {
  return RANK_SEARCH_STEPS.map((step, index) => ({
    ...step,
    index,
    last: index === RANK_SEARCH_STEPS.length - 1,
    bucket: searchBucket(rating, step.span),
  }));
}

/** One rung of a rated search: a pool criterion value, or null for Any rank. */
export interface RankedRung extends MatchRung {
  bucket: number | null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
