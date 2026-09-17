// ══════════════════════════════════════════════════════════════════════════
// MP-07 — QUICK RACE: keep looking until somebody else is looking too.
//
// The SDK's `matchmakeRoom` is a BOUNDED request: it waits one window, and when
// the window closes it rejects and drops the ticket from the pool. "Keep
// looking until found or cancelled" is therefore the caller's loop, and this is
// it — written against a injected `request` and an injected `isExpired`, so it
// can be tested without a socket, and so the SDK's BETA surface stays behind
// `src/net/transport.ts` where it belongs.
//
// One honest wrinkle, and it is the platform's: there is no public cancel for a
// request that is already in flight, so a cancelled search can still be paired
// when its window closes. Bounding the window (`MATCHMAKE_WINDOW_MS`) bounds how
// long that can last, and a room that lands after a cancel is handed straight to
// `abandon` rather than left holding a seat.
// ══════════════════════════════════════════════════════════════════════════

/** How long to wait between one closed window and the next request. */
export const RETRY_PAUSE_MS = 400;

export interface MatchmakerOptions<T> {
  /** One bounded matchmake request. Rejects when its window closes, or for real. */
  request: () => Promise<T>;
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

  constructor(private readonly opts: MatchmakerOptions<T>) {}

  /** True while a search is under way. */
  get active(): boolean {
    return this.running && !this.cancelled;
  }

  /** Windows that have closed without finding anybody (0 = the first try). */
  get windows(): number {
    return this.closed;
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
        const room = await this.opts.request();
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

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
