// ══════════════════════════════════════════════════════════════════════════
// RK-04 (#58) — the ranked quick race, wired.
//
// Two pure pieces already exist: `matchmake.ts` is the "keep looking" loop with
// a ladder of rank windows, and `rating.ts`'s `searchBucket` is what turns a
// rating into the one criterion value the pool understands. THIS is the two
// lines that matter to a running game — the ladder driven by `quickMatch`, the
// SDK call behind `src/net/transport.ts` — kept apart from the loop so the loop
// stays testable without a socket and from the screen so the screen stays
// readable.
//
// A ranked search is a QUEUE, not a lobby: `matchmakeRoom` waits in the pool
// until somebody else is waiting there too, so the widening is what stops a
// driver being marooned on a window too narrow to contain anybody. One request
// is one rung's window; when the window closes, the next request asks WIDER
// (see `RANK_SEARCH_STEPS`), and the last rung asks for nothing in particular
// and repeats for as long as the player leaves it running. Cancel is the only
// way out — a search that gave up would be telling a player "nobody else is
// racing" about a pool it cannot see.
//
// The room that lands is a matchmade room, which is the fact RK-03's rated
// wire hangs off: `findRace` in `App.tsx` is the one caller, and it tells the
// race screen it came from here.
// ══════════════════════════════════════════════════════════════════════════
import { Matchmaker, rankRungs } from './matchmake';
import { isMatchmakeWindowExpired, quickMatch, type RaceRoom } from './transport';

export interface RankedQueueOptions {
  /** Pause between one closed window and the next request (default `RETRY_PAUSE_MS`). */
  pauseMs?: number;
  /** Called after each closed window, so the screen can say "still looking, widening". */
  onWindowClosed?: (windows: number) => void;
  /** Test seam: the loop's clock. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One driver's ranked search, ready to `find()`.
 *
 * The rating is read ONCE, by the caller, and never re-read inside the search:
 * a rating only moves when a race is filed, and a search that re-read it mid-
 * queue would silently move a driver up and down the ladder for reasons the
 * pool cannot see.
 */
export function rankedQueue(rating: number, opts: RankedQueueOptions = {}): Matchmaker<RaceRoom> {
  const rungs = rankRungs(rating);
  return new Matchmaker<RaceRoom>({
    steps: rungs,
    request: (rung) =>
      quickMatch({
        // `rung.index` is clamped by the loop to the ladder's length, so this
        // is the current rung's bucket — null only on the last rung, where the
        // search asks for Any rank.
        rankBucket: rungs[rung.index]?.bucket ?? null,
        matchmakeTimeoutMs: rung.budgetMs,
      }),
    isExpired: isMatchmakeWindowExpired,
    pauseMs: opts.pauseMs,
    onWindowClosed: opts.onWindowClosed,
    sleep: opts.sleep,
    // The platform has no public cancel for a request in flight, so a pairing
    // can still land after the player gave up: it is not wanted, and it must
    // not sit in a room holding a seat.
    abandon: (room) => {
      try {
        room.leave();
      } catch {
        /* the socket is already going away */
      }
    },
  });
}
