// ══════════════════════════════════════════════════════════════════════════
// MP-04 — the HOST: the one machine that simulates.
//
// Host authority (epic #11). The host browser runs the Matter.js `Game` with
// all ten marbles; guests never step physics, they render what the host tells
// them and send back intents. So this module is the seam between the two:
//
//   in   — guest intents (`applyIntent`), applied at the next physics step
//   out  — `state` at 20 Hz, `events` whenever something happened, a chunked
//          `snapshot` on join/resync, and `results` once
//
// It owns nothing about sockets and imports no SDK — `send` is a callback and
// the room (`src/rooms/RaceRoom.ts`) is what actually relays. That is what
// makes it testable: a test hands it a fake clock and a fake `send` and gets
// the whole race as a list of frames.
//
// Two things it deliberately does NOT import:
//   - the SDK: `transport.ts` is the only module allowed to touch it.
//   - `season.ts`: the calendar boots the SDK through `storage.ts`, and a node
//     test that imports it dies on `window is not defined`. The circuit is
//     therefore RESOLVED BY THE CALLER and handed in — the lobby owns the
//     calendar, and only it needs to.
//
// Determinism: nothing here invents randomness. The seed comes from the room,
// the circuit from the seed, and the start lights from a wall clock every tab
// was told about in advance.
// ══════════════════════════════════════════════════════════════════════════
import { Game } from '../game/engine';
import type { Marble } from '../game/engine';
import { HEAT_TIME_LIMIT, PHYSICS_STEP } from '../game/physics';
import type { MarbleInfo, TrackProfile } from '../game/types';
import type { Track } from '../game/track';
import { generateTrack } from '../game/track';
import {
  MARBLE_COUNT,
  MAX_EVENTS_PER_FRAME,
  chunkSnapshot,
  nextSeq,
  packState,
  SEQ_START,
} from './protocol';
import type {
  IntentMsg,
  RaceEvent,
  RaceProtocol,
  RaceSettings,
  RaceSnapshot,
  ResultsMsg,
  Seat,
} from './protocol';

/** State frames per second. Twenty is what a marble race needs and what the wire can carry. */
export const STATE_HZ = 20;
/** Milliseconds between publishes (50). */
export const STATE_INTERVAL_MS = 1000 / STATE_HZ;

/**
 * Nudges a guest may send per second. A nudge is analog touch, so 60 Hz of
 * key-repeat is 30/s of messages — this is the number that keeps a stuck key,
 * a runaway script or a modified client from driving the host's step loop.
 */
export const NUDGE_RATE_PER_SECOND = 30;
/** A seat may spend a whole second's worth of nudges at once, then it is pacing-limited. */
export const NUDGE_BURST = NUDGE_RATE_PER_SECOND;

/** One more light every 650 ms, the same beat the single-player grid uses. */
export const LIGHT_INTERVAL_MS = 650;
/**
 * Wall-clock milliseconds from `countdownAt` to the gate: five lights (3.25 s)
 * and then a beat. Fixed, not randomised like the offline grid — every tab is
 * counting down to the same instant and has to agree when it arrives.
 */
export const COUNTDOWN_MS = 4200;
/** Hold the chequered flag this long before the results, as the offline race does. */
export const FINISH_HOLD_MS = 750;
/** Events one publish may carry (four frames' worth; the queue holds 256). */
export const EVENT_FRAMES_PER_STATE = 4;
/** Steps one `advance` may run. At 120 Hz this is ~135 ms of sim: a stalled tab does not chase ten seconds of it. */
export const MAX_STEPS_PER_FRAME = 16;

export interface RaceHostOptions {
  /** The seed both sides rebuild the circuit from. Minted by the room. */
  seed: number;
  /** The whole grid, ten seats. Position in this array IS the seat slot. */
  seats: readonly Seat[];
  /** Where frames go. The relay, in production; a list, in a test. */
  send: (msg: RaceProtocol) => void;
  /** The circuit, already resolved from `settings.circuit` by the caller. */
  track?: Track;
  /** Built from `settings.circuit` when no track is handed in. */
  profile?: TrackProfile;
  /** What the host is racing (carried into snapshots for the HUD). */
  settings?: RaceSettings;
  /** Wall clock in ms. `Date.now()` in production; the test's own clock. */
  now?: () => number;
  /** Start-line order as marble ids, P1 first. Defaults to seat order. */
  gridOrder?: number[];
  /** The seat the host's own hands are on — it drives `game.nudge`, not an intent. */
  localSeat?: number;
  /** Let the AI deploy items (default true). */
  aiItems?: boolean;
}

/**
 * A token bucket: `rate` a second, `burst` at once. Used for one thing only —
 * how many nudges a guest seat may land on the host per second.
 */
export class NudgeBudget {
  private tokens = NUDGE_BURST;
  private at: number | null = null;

  allow(now: number): boolean {
    if (this.at === null) this.at = now;
    else this.tokens = Math.min(NUDGE_BURST, this.tokens + ((now - this.at) / 1000) * NUDGE_RATE_PER_SECOND);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The host's side of one race.
 *
 * Drive it with `advance(dtMs)` from a requestAnimationFrame loop (or from a
 * test's clock) and hand it guest intents as they arrive.
 */
export class RaceHost {
  readonly game: Game;
  private readonly send: (msg: RaceProtocol) => void;
  private readonly clock: () => number;
  private readonly budgets = new Map<number, NudgeBudget>();
  private seq = SEQ_START;
  private accumulator = 0;
  private lastPublishAt: number;
  private countdownAt: number | null = null;
  private lightsShown = -1;
  private snapshotId = 0;
  private finishHold = 0;
  private classified: ResultsMsg | null = null;

  constructor(opts: RaceHostOptions) {
    if (!opts.seats.length) throw new Error('A race needs a grid.');
    this.send = opts.send;
    this.clock = opts.now ?? (() => Date.now());
    const seats = [...opts.seats].sort((a, b) => a.slot - b.slot);
    const humanSeats = seats.filter((s) => !s.isAI).map((s) => s.slot);
    const roster: MarbleInfo[] = seats.map((seat) => ({
      // One numbering, three jobs: the seat's slot, the marble's id, and the
      // marble's offset in every packed `state` frame. No translation table,
      // no way to address the wrong marble.
      id: seat.slot,
      name: seat.name,
      color: seat.color,
      stats: seat.stats,
      isPlayer: seat.slot === opts.localSeat,
      character: seat.portrait,
    }));
    this.game = new Game(opts.seed, roster, {
      track: opts.track ?? generateTrack(opts.seed, opts.profile),
      humanSeats: humanSeats.filter((slot) => slot !== opts.localSeat),
      // Wire events cost a queue and a drain; nobody collects them unless a
      // host is publishing them.
      wireEvents: true,
      aiItems: opts.aiItems,
      gridOrder: opts.gridOrder ?? seats.map((s) => s.slot),
    });
    this.game.start();
    this.lastPublishAt = this.clock();
  }

  /** True once the gate has dropped. */
  get started(): boolean {
    return this.game.gateOpen;
  }

  /** The classified race, or null while it is still running (MP-09 pays from this). */
  get results(): ResultsMsg | null {
    return this.classified;
  }

  /** The state sequence the NEXT frame will carry — and the one a snapshot represents. */
  get sequence(): number {
    return this.seq;
  }

  /**
   * host → everyone: the lights go out at a wall-clock instant, so every tab
   * counts down to the same moment instead of to its own receipt of this frame.
   * `countdownAt` is that instant (not when the count begins) — the five lights
   * run backwards from it. Returns it, for callers that need to show it.
   */
  scheduleStart(countdownAt: number = this.clock() + COUNTDOWN_MS): number {
    this.countdownAt = countdownAt;
    this.send({ type: 'start', countdownAt: Math.round(countdownAt) });
    return countdownAt;
  }

  /** The instant the gate opens, or null when no start has been scheduled. */
  get countdown(): number | null {
    return this.countdownAt;
  }

  /**
   * A guest's intent, applied at the next step.
   *
   * Nudges are rate limited to 30/s per seat and items go through
   * `canUseItem` — the SAME rule the local player is held to. A guest cannot
   * deploy what it does not carry, mid-freeze, before the gate, or during the
   * item cooldown. There is no "host" exception: the host's own hands are just
   * another seat (`localSeat`), and it drives `game.nudge` directly instead.
   */
  applyIntent(seat: number, intent: IntentMsg): void {
    const marble = this.marble(seat);
    if (!marble || marble.finishedAt !== null) return; // not on the grid, or already home
    if (intent.kind === 'nudge') {
      if (!this.nudgeAllowed(seat, this.clock())) return;
      const input = this.game.humanInput.get(seat) ?? { nudge: 0 };
      input.nudge = intent.v;
      this.game.humanInput.set(seat, input);
      return;
    }
    if (this.game.canUseItem(marble, intent.item)) this.game.useItem(marble, intent.item);
  }

  /**
   * Advance by `dtMs` of wall time: run the fixed-step simulation, then publish
   * if a state frame is due.
   */
  advance(dtMs: number): void {
    const dt = Math.max(0, dtMs);
    const now = this.clock();
    if (!this.game.gateOpen) this.runCountdown(now);

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.game.step(PHYSICS_STEP);
      this.accumulator -= PHYSICS_STEP;
      steps++;
    }
    // A tab that stalled must not spend the next ten frames catching up on ten
    // seconds of sim — it would fall further behind every frame. Drop the debt.
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    if (now - this.lastPublishAt >= STATE_INTERVAL_MS) {
      this.lastPublishAt = now;
      this.publish();
    }
    this.checkFinish(dt);
  }

  /** The whole world, for a joiner or a resync. Chunked across as many frames as it needs. */
  sendSnapshot(): void {
    this.snapshotId = (this.snapshotId + 1) >>> 0;
    for (const frame of chunkSnapshot(this.snapshot(), this.seq, this.snapshotId)) this.send(frame);
  }

  /**
   * The host's world as the wire describes it.
   *
   * Coordinates are rounded to two decimals: it is JSON here, not the float32
   * of a state frame, and a tenth of a pixel is a third of the bytes for
   * precision no screen can show.
   */
  snapshot(): RaceSnapshot {
    return {
      t: Math.round(this.game.time),
      clock: Math.round(this.game.raceTime()),
      started: this.game.gateOpen,
      marbles: this.game.marbleStates().map((m) => ({
        x: r2(m.x), y: r2(m.y), vx: r2(m.vx), vy: r2(m.vy), a: r2(m.a),
        finished: m.finished, frozen: m.frozen, oil: m.oil, ghost: m.ghost, anvil: m.anvil, loop: m.loop,
      })),
      destroyed: this.game.destroyedIndices(),
      boxes: this.game.boxStates(),
      oils: this.game.oils.map((o) => ({ x: r2(o.x), y: r2(o.y), r: r2(o.r), owner: o.ownerId, expiresAt: Math.round(o.expiresAt) })),
      inventories: this.game.marbles.map((m) => ({ ...m.inventory })),
      pegs: this.game.marbles.map((m) => m.pegs),
      times: this.game.marbles.map((m) => (m.finishedAt === null ? null : Math.round(m.finishedAt))),
      order: this.game.finishOrder.map((m) => m.info.id),
    };
  }

  /** Stop simulating (the race is over, or the room closed). */
  dispose(): void {
    this.game.destroy();
  }

  // ---------- internals ----------

  private marble(seat: number): Marble | undefined {
    if (!Number.isInteger(seat) || seat < 0 || seat >= MARBLE_COUNT) return undefined;
    // `marbles` is sorted by id, and a marble's id IS its seat slot.
    return this.game.marbles.find((m) => m.info.id === seat);
  }

  private nudgeAllowed(seat: number, now: number): boolean {
    let budget = this.budgets.get(seat);
    if (!budget) {
      budget = new NudgeBudget();
      this.budgets.set(seat, budget);
    }
    return budget.allow(now);
  }

  /**
   * The five lights, and the gate. Driven by the HOST ONLY: a guest cannot
   * start the race by opening its own gate, because only the host's clock is
   * the race. (The lights ride out in every state frame's `loop` bits too, so
   * a guest that joined mid-countdown still sees them.)
   */
  private runCountdown(now: number): void {
    if (this.countdownAt === null) return;
    if (now >= this.countdownAt) {
      this.game.openGate();
      return;
    }
    // The five lights run backwards from the instant every tab was told about:
    // one more every 650 ms, the last of them 950 ms before the gate.
    const elapsed = now - (this.countdownAt - COUNTDOWN_MS);
    const lights = Math.min(5, Math.max(0, Math.floor(elapsed / LIGHT_INTERVAL_MS)));
    this.game.stage = lights;
    if (lights !== this.lightsShown) {
      this.lightsShown = lights;
      if (lights > 0) this.game.emit({ kind: 'sound', cue: 'countdown' });
    }
  }

  /** Publish one state frame and whatever events have happened since the last one. */
  private publish(): void {
    this.seq = nextSeq(this.seq);
    this.send({ type: 'state', seq: this.seq, t: Math.round(this.game.time), marbles: packState(this.game.marbleStates()) });
    const events = this.drainEvents();
    for (let i = 0; i < events.length; i += MAX_EVENTS_PER_FRAME) {
      this.send({ type: 'events', seq: this.seq, list: events.slice(i, i + MAX_EVENTS_PER_FRAME) });
    }
  }

  private drainEvents(): RaceEvent[] {
    const list = this.game.drainRaceEvents();
    const cap = MAX_EVENTS_PER_FRAME * EVENT_FRAMES_PER_STATE;
    // A burst bigger than four frames' worth is dropped, newest last: buffering
    // it would put the guest further behind with every frame it sent.
    return list.length > cap ? list.slice(0, cap) : list;
  }

  /** Publish the classification once, after the flag, and never again. */
  private checkFinish(dt: number): void {
    if (this.classified) return;
    // A race that never started pays nothing and publishes nothing (MP-09).
    if (!this.game.gateOpen) return;
    const over = this.game.allFinished() || this.game.raceTime() >= HEAT_TIME_LIMIT;
    if (!over) {
      this.finishHold = 0;
      return;
    }
    this.finishHold += dt;
    if (this.finishHold < FINISH_HOLD_MS) return;
    this.classified = this.classify();
    this.send(this.classified);
  }

  private classify(): ResultsMsg {
    const ranking = this.game.classify();
    const times: (number | null)[] = new Array(MARBLE_COUNT).fill(null);
    const pegs: number[] = new Array(MARBLE_COUNT).fill(0);
    for (const entry of ranking) {
      // Whole milliseconds: a race time is shown to a hundredth of a second,
      // and the float noise of 17 000 accumulated steps is not information.
      times[entry.marble.info.id] = entry.time === null ? null : Math.round(entry.time);
      pegs[entry.marble.info.id] = entry.marble.pegs;
    }
    return { type: 'results', order: ranking.map((entry) => entry.marble.info.id), times, pegs };
  }
}
