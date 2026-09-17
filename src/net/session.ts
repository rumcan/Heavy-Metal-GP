// ══════════════════════════════════════════════════════════════════════════
// MP-06 — ONE RACE, from the screen's point of view.
//
// `RaceHost` simulates and publishes; `RaceGuest` renders and interpolates.
// They are different objects with different clocks, and nothing above this
// file should be able to tell which one it is holding: the race screen drives
// a session, and a session is the same seven calls either way.
//
//   accept(msg)      one frame off the wire, whatever kind it is
//   update(dtMs)     once per rendered frame
//   setNudge(v)      the local driver's hands, -1..1
//   useItem(item)    the local driver's item button
//   drainCues()      sounds to play, in the mixer's shape
//   results          the classification, in the shape the HUD shows
//   dispose()        drop the world
//
// No SDK here (transport.ts is the only module that touches it), no React, no
// `season.ts` (the calendar boots the SDK through storage.ts) — the circuit
// arrives as a resolved `TrackProfile`. That is what lets a whole online race
// be driven from a node test, which is the only place two ends can be wired
// together here.
// ══════════════════════════════════════════════════════════════════════════
import { Game, LIGHTS_OUT_STAGE } from '../game/engine';
import { generateTrack } from '../game/track';
import type { Track } from '../game/track';
import type { SoundEvent as CueName } from '../game/cues';
import type { SoundEvent, SoundType } from '../game/audio';
import { emptyInventory } from '../game/types';
import type { Inventory, ItemType, MarbleInfo, TrackProfile } from '../game/types';
import { RaceHost } from './host';
import type { RaceHostOptions } from './host';
import { RaceGuest } from './guest';
import type { RaceGuestOptions } from './guest';
import type { RaceProtocol, RaceSettings, ResultsMsg, Seat } from './protocol';
import { MARBLE_COUNT } from './protocol';
import { benchedSlots, gridOrderOf, inSlotOrder, rosterOf } from './lobby';
import type { PeerPresence } from './presence';

/**
 * How far ahead of the lights the host puts `countdownAt` when the lobby drops
 * them.
 *
 * Building a ten-marble world from a seed is not free — a long circuit is a
 * thousand bodies — and both ends have to be standing before the gate opens,
 * because the gate opens on a wall-clock instant the wire already promised.
 * Six seconds is the five lights (4.2 s) plus a beat for the build: long enough
 * that a slow tab still hears the first light, short enough that nobody thinks
 * the button did nothing.
 */
export const START_ARM_MS = 6000;

/**
 * Cue name → the noise the mixer makes for it.
 *
 * The wire carries NAMES (`src/game/cues.ts`) because a peg that pops
 * off-screen still has to be heard on a guest that never simulates; the mixer
 * (`src/game/audio.ts`) turns a name into sound. The two lists were written for
 * different jobs, so this table is the only place that knows both — and it
 * lives HERE, not in `cues.ts`, because `cues.ts` is imported by the room
 * bundle and an AudioContext does not belong in a room worker.
 */
const CUE_SOUND: Record<CueName, SoundType> = {
  gate: 'go',
  countdown: 'light',
  peg: 'peg',
  crate: 'crack',
  box: 'pickup',
  item: 'item',
  oil: 'thud',
  freeze: 'clang',
  shock: 'smash',
  pad: 'spring',
  bucket: 'bucket',
  boost: 'hoop',
  finish: 'finish',
};

/** One line of the classification, in the shape the results screen already reads. */
export interface SessionResult {
  /** Seat slot — the marble's id, and its offset in every packed frame. */
  id: number;
  rank: number;
  time: number | null;
  pegs: number;
}

/**
 * The room, as the race screen sees it.
 *
 * One object, handed to the screen by whoever owns the socket (App): intents go
 * out through `send`, and frames come in through `onMessage`. The screen sets
 * `onMessage` while it has a session to feed and clears it when it does not, so
 * a room subscribed once can serve a lobby, then a race, then the next race.
 */
export interface RaceLink {
  send(msg: RaceProtocol): void;
  onMessage: ((msg: RaceProtocol) => void) | null;
  /** Set by the screen that cares who walked out (the lobby); null otherwise. */
  onPlayerLeft: ((playerId: string) => void) | null;
}

export interface SessionOptions {
  /** The seed both ends rebuild the circuit from. Minted by the room. */
  seed: number;
  /** The whole grid; position in the array IS the seat slot. */
  seats: readonly Seat[];
  /** Which circuit — already resolved by the caller (the lobby owns the calendar). */
  profile: TrackProfile;
  /** What the race is (carried into snapshots, and shown on the loading card). */
  settings?: RaceSettings;
  /** The slot this screen's hands are on. */
  localSeat: number;
  /** True when this screen is the one that simulates. */
  isHost: boolean;
  /** Where intents and resyncs go: the room, in production. */
  send: (msg: RaceProtocol) => void;
  /** The instant the gate opens, when the lobby has already published it. */
  countdownAt?: number;
  /** Wall clock in ms. `Date.now()` in production; a test's own clock. */
  now?: () => number;
  /** The local player's items (host only — a guest's inventory is the host's book). */
  inventory?: Inventory;
}

/**
 * A guest may send this many nudges a second. It is the client-side half of the
 * host's own token bucket (30/s per seat): a key held down is 60 Hz of key
 * repeat, and there is no reason to spend the wire on it.
 */
export const NUDGE_SEND_INTERVAL_MS = 100;

/**
 * One race, on one screen.
 *
 * The host half owns the simulation and the race clock; the guest half owns a
 * picture and a playout clock. Both hand back the same `Game`, which is all the
 * renderer, the HUD and the minimap have ever asked for.
 */
export class RaceSession {
  readonly game: Game;
  readonly localSeat: number;
  readonly isHost: boolean;
  /** The host half, or null on a guest. */
  readonly host: RaceHost | null;
  /** The guest half, or null on a host. */
  readonly guest: RaceGuest | null;

  private readonly send: (msg: RaceProtocol) => void;
  private readonly clock: () => number;
  /** The grid this session was built with — the host's grid, or the guest's copy of it. */
  readonly seats: readonly Seat[];
  private lastNudgeSent = 0;
  private lastNudgeAt = 0;

  constructor(opts: SessionOptions) {
    this.send = opts.send;
    this.clock = opts.now ?? (() => Date.now());
    this.localSeat = opts.localSeat;
    this.isHost = opts.isHost;
    this.seats = inSlotOrder(opts.seats);
    const track: Track = generateTrack(opts.seed, opts.profile);

    if (opts.isHost) {
      const hostOpts: RaceHostOptions = {
        seed: opts.seed,
        seats: opts.seats,
        track,
        settings: opts.settings,
        send: opts.send,
        now: opts.now,
        localSeat: opts.localSeat,
        gridOrder: gridOrderOf(opts.seats),
      };
      this.host = new RaceHost(hostOpts);
      this.guest = null;
      this.game = this.host.game;
      // The lobby published the countdown before this world existed; join it
      // rather than publishing a second `start`.
      if (opts.countdownAt !== undefined) this.host.armStart(opts.countdownAt);
    } else {
      const guestOpts: RaceGuestOptions = {
        seed: opts.seed,
        seats: opts.seats,
        track,
        localSeat: opts.localSeat,
        send: opts.send,
        now: opts.now,
        benched: benchedSlots(opts.seats, opts.settings),
      };
      this.guest = new RaceGuest(guestOpts);
      this.host = null;
      this.game = this.guest.game;
      if (opts.countdownAt !== undefined) {
        this.guest.acceptStart({ type: 'start', countdownAt: opts.countdownAt });
      }
    }
  }

  /** The roster the HUD names and the results screen reads. */
  get roster(): MarbleInfo[] {
    return rosterOf(this.seats, this.localSeat);
  }

  /** The grid, in starting order. */
  get gridOrder(): number[] {
    return gridOrderOf(this.seats);
  }

  /**
   * One frame off the wire.
   *
   * The host listens to guests (intents and resyncs — and the room has already
   * dropped a guest's state frames, so there is nothing else to hear) and to the
   * ROOM's own voice about them (`peerStatus`: who lost their socket, and who
   * came back for their marble). The guest only listens to the host. Anything
   * else is not a race message.
   */
  accept(msg: RaceProtocol): void {
    if (this.host) {
      if (
        msg.type === 'intent' ||
        msg.type === 'resync' ||
        msg.type === 'ready' ||
        msg.type === 'peerStatus' ||
        // MP-08: the room re-greets a driver who came back, and the host answers
        // that greeting with the real grid (see `RaceHost.accept`).
        msg.type === 'welcome'
      ) {
        this.host.accept(msg);
      }
      return;
    }
    this.guest?.accept(msg);
  }

  /**
   * MP-09: the kit in the local driver's hands.
   *
   * Offline that is the wallet's business; online it is the host's marble — the
   * one thing that must survive the round trip is "what am I holding", because
   * a spend that never reaches the toolbar is a spend the player cannot see.
   */
  get kit(): Inventory {
    return { ...(this.game.marbles.find((m) => m.info.id === this.localSeat)?.inventory ?? emptyInventory()) };
  }

  /** MP-08: seats the AI has taken from a driver who dropped — host's book. */
  get aiSeats(): readonly number[] {
    return this.host?.aiSeats ?? [];
  }

  /** MP-08: rivals whose socket is gone, and for how long (host's book). */
  get dropped(): readonly PeerPresence[] {
    return this.host?.dropped ?? [];
  }

  /** Once per rendered frame: `dtMs` of wall time since the last one. */
  update(dtMs: number): void {
    if (this.host) this.host.advance(dtMs);
    else this.guest?.update(this.clock());
  }

  /** Fast forward once only AI are left racing. Host only; a guest's picture follows the host's clock. */
  setSpeed(speed: number): void {
    this.host?.setSpeed(speed);
  }

  /** Online fast forward is available: this client hosts and every human driver has finished. */
  get canFastForward(): boolean {
    return !!this.host && this.host.allHumansFinished;
  }

  /** The local driver's hands. -1 (left) … 0 … +1 (right). */
  setNudge(v: number): void {
    if (this.host) {
      // The host's own hands are just another seat: no round trip, no intent,
      // no rate limit — `game.nudge` is the input the offline game uses.
      this.host.game.nudge = v;
      return;
    }
    // A guest leans its own marble the instant the key goes down (a render-only
    // lie the next frame corrects), and tells the host — but not 60 times a
    // second, and never dropping the release: a nudge the host never hears let
    // go would leave the marble leaning for the rest of the race.
    this.guest?.setLocalNudge(v);
    const now = this.clock();
    const changed = v !== this.lastNudgeSent;
    if (!changed && (v === 0 || now - this.lastNudgeAt < NUDGE_SEND_INTERVAL_MS)) return;
    this.lastNudgeAt = now;
    this.lastNudgeSent = v;
    this.send({ type: 'intent', kind: 'nudge', v });
  }

  /** Deploy one carried item. The host decides whether it is allowed. */
  useItem(item: ItemType): void {
    if (this.host) this.host.game.usePlayerItem(item);
    else this.send({ type: 'intent', kind: 'item', item });
  }

  /** Sounds since the last drain, in the shape the mixer takes. */
  drainCues(): SoundEvent[] {
    if (this.host) {
      const out = this.game.sounds.slice();
      this.game.sounds.length = 0;
      return out;
    }
    const names = this.guest?.drainCues() ?? [];
    if (!names.length) return [];
    const at = this.guest!.me.body.position;
    return names.map((cue) => ({ type: CUE_SOUND[cue], x: at.x, y: at.y, player: true }));
  }

  /** The classified race, once the host has published it. */
  get results(): SessionResult[] | null {
    const msg: ResultsMsg | null = this.host ? this.host.results : this.guest?.results ?? null;
    return msg ? resultsToRows(msg) : null;
  }

  /** The start-light stage: 0..5 on the grid, 6 once the gate is open. */
  get stage(): number {
    return this.game.stage;
  }

  /** True once the gate has dropped. */
  get gateOpen(): boolean {
    return this.game.gateOpen;
  }

  /**
   * The stage the HUD's light bank wants: 0..5 while the lights are counting,
   * and -1 the moment they are out (which is what turns the overlay into "GO").
   */
  get lightStage(): number {
    return this.game.stage >= LIGHTS_OUT_STAGE ? -1 : this.game.stage;
  }

  /** Milliseconds since the guest's newest frame arrived — zero on the host. */
  get lagMs(): number {
    return this.guest?.lagMs ?? 0;
  }

  /** Resyncs this guest has had to ask for — zero on the host. */
  get resyncs(): number {
    return this.guest?.resyncs ?? 0;
  }

  /** The whole world, for a joiner mid-race (host only — MP-08's reconnect). */
  sendSnapshot(): void {
    this.host?.sendSnapshot();
  }

  /** Ask the host for the world (guest only). */
  requestResync(): void {
    this.guest?.requestResync();
  }

  dispose(): void {
    this.game.destroy();
  }
}

/** A `results` frame, as the rows the results screen reads. */
export function resultsToRows(msg: ResultsMsg): SessionResult[] {
  return msg.order.map((id, index) => ({
    id,
    rank: index + 1,
    time: id >= 0 && id < msg.times.length ? msg.times[id] : null,
    pegs: id >= 0 && id < msg.pegs.length ? msg.pegs[id] : 0,
  }));
}

/** One seat's place in the classification, or null when it did not finish. */
export function placeOf(rows: readonly SessionResult[], seat: number): number | null {
  return rows.find((r) => r.id === seat)?.rank ?? null;
}

/** Every seat, classified — including the ones that never finished (MP-08 parks them last). */
export function allSeats(rows: readonly SessionResult[]): SessionResult[] {
  const seen = new Set(rows.map((r) => r.id));
  const rest: SessionResult[] = [];
  for (let id = 0; id < MARBLE_COUNT; id++) if (!seen.has(id)) rest.push({ id, rank: rows.length + rest.length + 1, time: null, pegs: 0 });
  return [...rows, ...rest];
}
