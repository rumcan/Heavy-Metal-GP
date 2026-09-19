// ══════════════════════════════════════════════════════════════════════════
// MP-05 — the GUEST: renders what the host says, never simulates.
//
// The counterpart to `src/net/host.ts`. Where the host steps the Matter.js
// world, the guest only ever MOVES bodies to the positions the host published:
//
//   snapshot → the world, whole (join, resync)
//   state    → ten marbles, 20 times a second, interpolated over a 100 ms buffer
//   events   → everything else a guest must SHOW (a popped peg, a broken wall,
//              an oil slick, a freeze, a finish) or PLAY (the cues)
//
// `render.ts` needs no multiplayer knowledge: it reads a `Game`, and this is
// what keeps that `Game` looking like one. The bodies are the same bodies, the
// track is the same track (both ends build it from the seed), and the only
// thing missing is `Engine.update` — which is the point.
//
// No SDK here either: `send` is a callback, so a test can hand it a network of
// its own making.
// ══════════════════════════════════════════════════════════════════════════
import Matter from 'matter-js';
import { Game, LIGHTS_OUT_STAGE } from '../game/engine';
import type { Marble } from '../game/engine';
import type { Track } from '../game/track';
import { meta } from '../game/track';
import { elementBodies } from '../game/elements';
import type { MarbleInfo } from '../game/types';
import type { SoundEvent } from '../game/cues';
import {
  MARBLE_COUNT,
  SnapshotAssembler,
  SEQ_START,
  unpackState,
} from './protocol';
import type {
  EventsMsg,
  MarbleState,
  RaceEvent,
  RaceProtocol,
  RaceSnapshot,
  ResultsMsg,
  Seat,
  SnapshotMsg,
  StartMsg,
  StateMsg,
} from './protocol';

const { Body } = Matter;

/**
 * How far behind the newest frame the guest renders. One frame is 50 ms at
 * 20 Hz; a buffer of two means a late or lost frame has somewhere to land
 * before the picture needs it — which is what makes 2 % loss invisible.
 */
export const INTERP_DELAY_MS = 100;
/** Frames kept, ~1.6 s at 20 Hz. Older ones can never be interpolated into. */
export const MAX_BUFFER_FRAMES = 32;
/**
 * Frames that may go missing before the guest asks for the world again.
 *
 * NOT zero, and that is the difference from HexMatch: its frames were DELTAS,
 * so one lost frame corrupted every later one and a gap meant resync. Ours are
 * absolute — every frame carries every marble — so a one- or two-frame hole is
 * something the interpolation buffer steps over, and a full snapshot (several
 * kilobytes) is not worth spending on it.
 */
export const GAP_TOLERANCE = 2;
/** Wait this long for a frame that may simply be late before calling it lost. */
export const GAP_GRACE_MS = 60;
/** And ask again this often until the world lands. */
export const RESYNC_RETRY_MS = 500;
/** The optimistic tilt a held nudge adds to the local marble, in radians. */
export const MAX_LOCAL_TILT = 0.4;
/**
 * How much faster than real time the picture may run to catch up after a
 * stall. 1.25 = a quarter faster: a 200 ms hole is absorbed in ~0.8 s, and the
 * motion on screen never looks like a fast-forward.
 */
export const MAX_CATCHUP_RATE = 1.25;
/** The most extra playout delay bursty delivery may add. */
export const MAX_JITTER_MS = 400;

export interface RaceGuestOptions {
  seed: number;
  /** The whole grid; position in the array is the seat slot. */
  seats: readonly Seat[];
  /** The circuit, built from the seed exactly as the host built it. */
  track: Track;
  /** Which marble is mine — the one that gets the optimistic tilt. */
  localSeat: number;
  send: (msg: RaceProtocol) => void;
  now?: () => number;
  interpDelayMs?: number;
  /** AI seats not racing (see `benchedSlots`). */
  benched?: number[];
}

interface Frame {
  seq: number;
  /** Host simulation clock. */
  t: number;
  /** When it arrived, on the guest's own clock — this is what it interpolates on. */
  at: number;
  marbles: MarbleState[];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * One guest's view of a race.
 *
 * Feed it the host's frames as they arrive (`acceptState`, `acceptEvents`,
 * `acceptChunk`) and call `update()` once per rendered frame; it writes the
 * answers into `game`, which is an ordinary `Game` as far as `render.ts` knows.
 */
export class RaceGuest {
  readonly game: Game;
  readonly localSeat: number;
  private readonly send: (msg: RaceProtocol) => void;
  private readonly clock: () => number;
  private readonly interpDelay: number;
  private readonly assembler = new SnapshotAssembler();
  private frames: Frame[] = [];
  private pendingEvents = new Map<number, RaceEvent[]>();
  private cues: SoundEvent[] = [];
  /** Event sequences already drawn — the host says everything twice on purpose. */
  private drawnEvents = new Set<number>();
  private appliedSeq = SEQ_START - 1;
  private snapPending = false;
  private gapAt = 0;
  private resyncAt = 0;
  private resyncCount = 0;
  private lastUpdate = 0;
  private tilt = 0;
  /**
   * Host clock → local clock. The smallest (arrival − host time) seen, relaxed
   * upward slowly. Frames are placed at `t + offset`, NOT at their arrival
   * time: a browser busy with input (a held key) delivers socket messages late
   * and in bursts, and interpolating on arrival turned that into a frozen
   * marble followed by a fast-forward.
   */
  private offset: number | null = null;
  /** How late frames have recently been beyond the offset. The playout delay grows to cover it, then shrinks back. */
  private jitter = 0;
  /** The guest's playout clock (see `update`). */
  private playout = 0;
  private classified: ResultsMsg | null = null;
  private countdownAt: number | null = null;

  constructor(opts: RaceGuestOptions) {
    this.send = opts.send;
    this.clock = opts.now ?? (() => Date.now());
    this.interpDelay = opts.interpDelayMs ?? INTERP_DELAY_MS;
    this.localSeat = opts.localSeat;
    const seats = [...opts.seats].sort((a, b) => a.slot - b.slot);
    const roster: MarbleInfo[] = seats.map((seat) => ({
      id: seat.slot,
      name: seat.name,
      color: seat.color,
      stats: seat.stats,
      isPlayer: seat.slot === opts.localSeat,
      isHuman: !seat.isAI,
      character: seat.portrait,
    }));
    // A real `Game`, built from the same seed — but it is never stepped. The
    // marbles are bodies to be moved, the track is geometry to be drawn, and
    // `Engine.update` is the one thing that never happens.
    this.game = new Game(opts.seed, roster, { track: opts.track, effects: true, wireEvents: false, benched: opts.benched });
  }

  /** The marble I am, for the camera and the HUD. */
  get me(): Marble {
    return this.game.marbles.find((m) => m.info.id === this.localSeat) ?? this.game.player;
  }

  /** The classification the host sent, or null while the race runs. */
  get results(): ResultsMsg | null {
    return this.classified;
  }

  /** The wall-clock instant the lights go out, once the host has said. */
  get countdown(): number | null {
    return this.countdownAt;
  }

  /** True while a snapshot is in flight: the picture is being held, not drawn. */
  get pending(): boolean {
    return this.snapPending;
  }

  /** Resyncs this guest has had to ask for. A healthy race asks for none. */
  get resyncs(): number {
    return this.resyncCount;
  }

  /** True once there is something to draw. */
  get ready(): boolean {
    return this.frames.length > 0;
  }

  /** Milliseconds since the newest frame arrived — the guest's own lag, for a HUD. */
  get lagMs(): number {
    const last = this.frames.at(-1);
    return last ? this.clock() - last.at : Infinity;
  }

  /** The state sequence last drawn. */
  get sequence(): number {
    return this.appliedSeq;
  }

  // ---------- the wire ----------

  /**
   * One frame from the host, whichever kind it is. The session hands the whole
   * stream to this and it sorts out what to do with each.
   */
  accept(msg: RaceProtocol): void {
    switch (msg.type) {
      // MP-08: a welcome mid-race means this tab is a page that came back — a
      // refresh, a reconnect — and it has never seen the world. Ask for it
      // rather than waiting for a gap to notice.
      case 'welcome':
        this.requestResync();
        return;
      case 'start':
        return this.acceptStart(msg);
      case 'state':
        return this.acceptState(msg);
      case 'events':
        return this.acceptEvents(msg);
      case 'snapshot':
        this.acceptChunk(msg);
        return;
      case 'results':
        return this.acceptResults(msg);
      case 'kit':
        for (const kit of msg.kits) {
          const m = this.game.marbles.find((marble) => marble.info.id === kit.slot);
          if (m) m.inventory = { ...kit.inventory };
        }
        return;
      default:
        return; // lobby, ready, intent, peerStatus and reject are not for the renderer
    }
  }

  /** host → everyone: the lights go out at this wall-clock instant. */
  acceptStart(msg: StartMsg): void {
    this.countdownAt = msg.countdownAt;
  }

  /**
   * host → everyone, 20 Hz. Unpacked, stamped with the arrival time, and queued.
   * A duplicate or a frame the guest has already drawn is ignored; a frame that
   * arrived while a snapshot was in flight is kept, because it may be newer
   * than the world that is on its way.
   */
  acceptState(msg: StateMsg, at: number = this.clock()): void {
    const marbles = unpackState(msg.marbles);
    if (!marbles) return; // not a frame this version can read
    if (msg.seq <= this.appliedSeq && !this.snapPending) return; // duplicate, or late
    const raw = at - msg.t;
    if (this.offset === null || raw < this.offset) this.offset = raw;
    this.jitter = Math.min(MAX_JITTER_MS, Math.max(this.jitter, raw - this.offset));
    this.frames.push({ seq: msg.seq, t: msg.t, at: msg.t + this.offset, marbles });
    if (this.frames.length > MAX_BUFFER_FRAMES) this.frames.shift();
    // Ordered by seq even when the network is not: interpolation on arrival
    // time is the point, but a frame that arrives out of order must not sit
    // behind an older one.
    this.frames.sort((a, b) => a.seq - b.seq);
  }

  /**
   * host → everyone: what happened, against the state frame it belongs to.
   *
   * The host sends every batch twice on purpose (see `RaceHost.publish`), so a
   * sequence this guest has already drawn is a repeat, not news.
   */
  acceptEvents(msg: EventsMsg): void {
    if (this.drawnEvents.has(msg.seq)) return; // the host's second copy
    if (msg.seq <= this.appliedSeq && !this.snapPending) return; // already drawn
    const list = this.pendingEvents.get(msg.seq);
    if (list) list.push(...msg.list);
    else this.pendingEvents.set(msg.seq, [...msg.list]);
  }

  /**
   * host → everyone, chunked. Returns true when this frame completed a
   * transfer and the world was applied (see `SnapshotAssembler`).
   */
  acceptChunk(msg: SnapshotMsg | unknown): boolean {
    const done = this.assembler.accept(msg);
    if (!done) return false;
    this.applySnapshot(done.snap, done.seq);
    return true;
  }

  /**
   * host → everyone, once: the classification.
   *
   * It is also the end of the stream, so everything still pending is applied
   * here: events are held until the picture reaches the frame they belong to,
   * and the frames after the last one the host published before classifying
   * would otherwise never be drawn — a guest that counted two fewer pegs than
   * the host on the results screen.
   */
  acceptResults(msg: ResultsMsg): void {
    this.classified = msg;
    this.flushEvents(Number.POSITIVE_INFINITY);
  }

  /** Ask the host for the world. Sent when a gap is too big to interpolate over. */
  requestResync(): void {
    const now = this.clock();
    if (this.snapPending && now - this.resyncAt < RESYNC_RETRY_MS) return;
    this.resyncAt = now;
    this.snapPending = true;
    this.resyncCount++;
    this.send({ type: 'resync' });
  }

  // ---------- the picture ----------

  /**
   * The guest's own input, for the optimistic tilt: the local marble leans the
   * moment the key goes down instead of a network round trip later. It is a
   * RENDER-ONLY lie — the next frame from the host overwrites it, and the
   * simulation never sees it.
   */
  setLocalNudge(v: number): void {
    this.tilt = Math.max(-MAX_LOCAL_TILT, Math.min(MAX_LOCAL_TILT, this.tilt + v * 0.06));
  }

  /** Sound cues, since the last drain. The mixer (when it lands) reads these. */
  drainCues(): SoundEvent[] {
    if (!this.cues.length) return [];
    const out = this.cues;
    this.cues = [];
    return out;
  }

  /**
   * Draw: pick the two frames either side of `now - delay`, interpolate between
   * them, apply whatever events belong to the newer one, and age the effects.
   */
  update(nowMs: number = this.clock()): void {
    const dt = this.lastUpdate === 0 ? 0 : Math.max(0, nowMs - this.lastUpdate);
    this.lastUpdate = nowMs;
    // Let the offset drift up (5 %) so a lasting rise in latency is absorbed; the next on-time frame pulls it back down.
    if (this.offset !== null) this.offset += dt * 0.05;
    this.jitter = Math.max(0, this.jitter - dt * 0.02);
    if (!this.frames.length || this.snapPending) return; // nothing to draw yet, or the world is being replaced

    // The guest keeps its OWN playout clock rather than rendering at
    // `now - delay` directly: after a stall the picture catches up at 25 % over
    // real time instead of snapping the whole buffer in one frame. Never faster
    // than the data, never slower than a quarter behind it.
    const target = nowMs - this.interpDelay - this.jitter;
    if (this.playout === 0) this.playout = target;
    this.playout = Math.min(target, this.playout + dt * MAX_CATCHUP_RATE);
    this.checkGap(nowMs);
    const renderAt = this.playout;
    const newest = this.frames.at(-1)!;
    let a = newest;
    let b = newest;
    if (renderAt <= this.frames[0].at) {
      // The buffer is deeper than the delay: hold the oldest frame until the
      // playout clock reaches it. (Interpolating "from" it here would prune it
      // a frame later and leave the picture with nothing to interpolate from.)
      a = b = this.frames[0];
    } else if (renderAt >= newest.at) {
      a = b = newest; // starved: hold the last known pose
    } else {
      for (let i = 0; i < this.frames.length - 1; i++) {
        if (this.frames[i].at <= renderAt && this.frames[i + 1].at >= renderAt) {
          a = this.frames[i];
          b = this.frames[i + 1];
          break;
        }
      }
    }

    const alpha = a === b ? 0 : clamp01((renderAt - a.at) / (b.at - a.at));
    this.flushEvents(b.seq);
    this.renderFrame(a, b, alpha);
    // Held marbles (MB-10 tunnel rides) reappear when the host clock says the ride is over.
    for (const m of this.game.marbles) {
      if (m.hold && this.game.time >= m.hold.until) {
        m.hold = null;
        m.trail = [];
      }
    }
    this.game.ageEffects(dt);

    // Retire the frames the picture has drawn PAST, but keep `a`: it is still
    // the base of the next interpolation until the playout clock reaches `b`.
    // (Dropping it here is what leaves a guest with nothing to interpolate
    // from — a 50 ms buffer instead of the 100 ms it asked for, and a picture
    // that holds still and then jumps.)
    const upTo = this.frames.indexOf(a);
    if (upTo > 0) this.frames.splice(0, upTo);
    this.appliedSeq = Math.max(this.appliedSeq, b.seq);
  }

  // ---------- internals ----------

/**
 * Look for a hole in what the guest has: frames missing between the picture and
 * the newest arrival. A frame or two is stepped over (see `GAP_TOLERANCE`);
 * more than that, held for `GAP_GRACE_MS` in case the network is merely
 * reordering, is worth a whole world.
 */
  private checkGap(now: number): void {
    if (this.frames.length < 2) {
      this.gapAt = 0;
      return;
    }
    const oldest = this.frames[0].seq;
    const newest = this.frames.at(-1)!.seq;
    const missing = newest - oldest + 1 - this.frames.length;
    if (missing <= GAP_TOLERANCE) {
      this.gapAt = 0;
      return;
    }
    if (this.gapAt === 0) {
      this.gapAt = now;
      return;
    }
    if (now - this.gapAt < GAP_GRACE_MS) return;
    this.requestResync();
  }

  private flushEvents(upToSeq: number): void {
    const keys = [...this.pendingEvents.keys()].filter((seq) => seq <= upToSeq).sort((a, b) => a - b);
    for (const seq of keys) {
      for (const event of this.pendingEvents.get(seq)!) this.applyEvent(event);
      this.pendingEvents.delete(seq);
      this.drawnEvents.add(seq);
    }
    // Old sequences are history: the set only has to be deep enough to catch a
    // repeat, which is one publish behind.
    if (this.drawnEvents.size > 512) {
      const cutoff = upToSeq - 256;
      for (const seq of this.drawnEvents) if (seq < cutoff) this.drawnEvents.delete(seq);
    }
  }

  private renderFrame(a: Frame, b: Frame, alpha: number): void {
    const marbles = this.game.marbles;
    for (let i = 0; i < marbles.length; i++) {
      const m = marbles[i];
      const ma = a.marbles[i];
      const mb = b.marbles[i];
      if (!ma || !mb || m.finishedAt !== null) continue; // parked at the finish
      Body.setPosition(m.body, { x: lerp(ma.x, mb.x, alpha), y: lerp(ma.y, mb.y, alpha) });
      Body.setAngle(m.body, lerp(ma.a, mb.a, alpha));
      Body.setVelocity(m.body, { x: lerp(ma.vx, mb.vx, alpha), y: lerp(ma.vy, mb.vy, alpha) });
      Body.setAngularVelocity(m.body, 0);
      if (mb.frozen !== m.frozen) this.game.setFrozen(m, mb.frozen);
      m.inOil = mb.oil;
      // The renderer asks "is it ghosting / heavy?" — the host's timers are in
      // the flag byte, not on the wire, so the guest keeps them alive locally.
      m.ghostUntil = mb.ghost ? this.game.time + 1000 : 0;
      m.anvilUntil = mb.anvil ? this.game.time + 1000 : 0;
      if (m.info.id === this.localSeat || m.info.isPlayer) {
        m.trail.push({ x: m.body.position.x, y: m.body.position.y });
        if (m.trail.length > 14) m.trail.shift();
      }
    }
    if (b.marbles[0]) this.setStage(b.marbles[0].loop);
    this.game.time = lerp(a.t, b.t, alpha);
    if (this.tilt !== 0) {
      const mine = this.me;
      Body.setAngle(mine.body, mine.body.angle + this.tilt);
      this.tilt *= 0.85; // corrected by the next frame
      if (Math.abs(this.tilt) < 0.001) this.tilt = 0;
    }
  }

  /**
   * The start-light stage, and the gate that follows it.
   *
   * The stage rides in the spare bits of every state frame, but the GATE does
   * not: a guest that only ever receives state frames would watch the lights
   * reach five and then nothing — its own `gateOpen` would stay false and the
   * marbles would stand still while the host's were already away. So the
   * lights-out stage in the frame is what opens it, exactly once, through the
   * engine's own `openGate()` (which drops the trapdoor body and sounds the
   * cue, the same as it does on the host).
   */
  private setStage(stage: number): void {
    this.game.stage = stage;
    if (stage >= LIGHTS_OUT_STAGE && !this.game.gateOpen) this.game.openGate();
  }

  /** Apply the whole world: join, resync, or the answer to a gap. */
  private applySnapshot(snap: RaceSnapshot, seq: number): void {
    const marbles = this.game.marbles;
    snap.marbles.forEach((state, i) => {
      const m = marbles[i];
      if (!m || this.game.benched.has(m.info.id)) return;
      Body.setPosition(m.body, { x: state.x, y: state.y });
      Body.setAngle(m.body, state.a);
      Body.setVelocity(m.body, { x: state.vx, y: state.vy });
      m.frozen = false;
      this.game.setFrozen(m, state.frozen);
      m.inOil = state.oil;
      m.ghostUntil = state.ghost ? snap.t + 1000 : 0;
      m.anvilUntil = state.anvil ? snap.t + 1000 : 0;
      m.finishedAt = snap.times[i] ?? null;
      m.pegs = snap.pegs[i] ?? 0;
      if (snap.inventories[i]) m.inventory = { ...snap.inventories[i] };
      if (m.finishedAt !== null) this.game.park(m);
    });

    // Track geometry: everything the host has destroyed is gone here too.
    for (const index of snap.destroyed) this.removeBody(index);
    for (const box of snap.boxes) {
      const body = this.bodyAt(box.i);
      if (body) meta(body).active = box.active;
    }
    this.game.oils = snap.oils.map((o) => ({ x: o.x, y: o.y, r: o.r, ownerId: o.owner, expiresAt: o.expiresAt }));
    this.game.finishOrder = snap.order.map((seat) => marbles[seat]).filter((m): m is Marble => Boolean(m));
    this.game.gateOpen = snap.started;
    this.game.stage = snap.started ? LIGHTS_OUT_STAGE : 0;
    this.game.time = snap.t;
    this.game.raceStartTime = snap.t - snap.clock;
    this.game.started = true;

    // Frames that arrived while the world was in flight: the ones newer than it
    // are still good, the ones older are history.
    this.frames = this.frames.filter((f) => f.seq > seq);
    this.pendingEvents = new Map([...this.pendingEvents].filter(([s]) => s > seq));
    this.appliedSeq = seq;
    this.snapPending = false;
    this.gapAt = 0;
    this.resyncAt = 0;
    this.playout = 0; // the world jumped; the next update re-anchors the picture
    this.assembler.reset();
  }

  private applyEvent(event: RaceEvent): void {
    const marbles = this.game.marbles;
    switch (event.kind) {
      case 'peg': {
        const body = this.bodyAt(event.i);
        if (!body || meta(body).destroyed) break;
        const color = meta(body).pegColor === 'orange' ? '#fb923c' : meta(body).pegColor === 'green' ? '#4ade80' : '#60a5fa';
        this.ring(body.position.x, body.position.y, 14, color);
        this.removeBody(event.i);
        // Only the orange ones score, and the guest knows which is which: it
        // built the same circuit from the same seed, so the body index says.
        if (meta(body).pegColor === 'orange') {
          const scorer = marbles[event.seat];
          if (scorer) scorer.pegs++;
        }
        break;
      }
      case 'crate': {
        const body = this.bodyAt(event.i);
        if (!body) break;
        if (event.broken) {
          this.removeBody(event.i);
          this.game.shake = 8;
        }
        this.debris(body.position.x, body.position.y, event.broken ? 22 : 6, event.broken ? 7 : 3, event.broken ? '#f59e0b' : '#fbbf24');
        break;
      }
      case 'box': {
        const body = this.bodyAt(event.i);
        if (!body) break;
        meta(body).active = !event.taken;
        if (event.taken) this.ring(body.position.x, body.position.y, 18, '#facc15');
        break;
      }
      case 'oil': {
        this.game.oils.push({ x: event.x, y: event.y, r: event.r, ownerId: event.seat, expiresAt: event.until });
        break;
      }
      case 'freeze': {
        const target = marbles[event.seat];
        if (!target) break;
        target.frozenUntil = event.until;
        this.game.setFrozen(target, true);
        const { x, y } = target.body.position;
        this.game.effects.push({ type: 'snow', x, y, ttl: 40, maxTtl: 40, color: '#bae6fd', particles: this.game.makeParticles(x, y, 12, 2) });
        break;
      }
      case 'shock': {
        this.game.shake = 8;
        this.ring(event.x, event.y, 30, '#facc15');
        // The shock shatters ice: the host unfroze everyone in range, so the
        // guest does too rather than leaving a marble in ice that has melted.
        for (const m of marbles) if (m.frozen) this.game.setFrozen(m, false);
        // MB-10B: a blast in range jams a mace sweeper for two seconds. The host made the same
        // distance check before it sent this event, so the arm freezes identically on this side.
        for (const arm of elementBodies(this.game.track, 'mace')) {
          const amd = meta(arm);
          const motion = amd.motion;
          if (!motion || motion.mode !== 'sweep') continue;
          if (Math.hypot(motion.pivot.x - event.x, motion.pivot.y - event.y) < 280 || Math.hypot(arm.position.x - event.x, arm.position.y - event.y) < 280) {
            amd.stunUntil = this.game.time + 2000;
          }
        }
        break;
      }
      case 'item': {
        const m = marbles[event.seat];
        if (m) this.ring(m.body.position.x, m.body.position.y, 22, m.info.color);
        break;
      }
      case 'finish': {
        const m = marbles[event.seat];
        if (!m || m.finishedAt !== null) break;
        m.finishedAt = event.time;
        this.ring(m.body.position.x, m.body.position.y, 30, m.info.color);
        this.game.finishOrder.push(m);
        this.game.park(m);
        break;
      }
      case 'sound':
        this.cues.push(event.cue);
        break;
      // MB-10A: stateful element flips — set the state the host decided; the shared easing in
      // `Game.ageEffects` swings the plate / door on this end exactly as it does on the host.
      case 'switch': {
        const body = this.bodyAt(event.i);
        if (body) {
          meta(body).side = event.side;
          meta(body).flippedAt = this.game.time;
        }
        break;
      }
      case 'trapdoor': {
        const body = this.bodyAt(event.i);
        if (body) {
          meta(body).openNow = event.open;
          if (event.open) meta(body).openedAt = this.game.time;
        }
        break;
      }
      case 'hold': {
        // A marble went into an element. The host glides it from now on; the `until` is on the
        // host clock, which we mirror. A tunnel ride is hidden start-to-end; a wheel bucket or
        // screw transit stays on screen — the position frames draw the ride. MB-10D launcher
        // holds (cannon/catapult/scoop) park the rider at the machine until the same clock says go.
        const m = marbles[event.seat];
        if (m) {
          m.hold = { kind: event.of ?? 'tunnel', until: event.until };
          // mirror the machine's own bookkeeping so its skin lights up for us too
          if ((event.of === 'cannon' || event.of === 'catapult' || event.of === 'scoop') && m.hold.kind !== 'tunnel') {
            m.hold.at = this.game.time;
          }
        }
        break;
      }
      // MB-10D: a flipper snapped — set the local copy's firedAt so it replays the same swing.
      case 'flipper': {
        const bat = this.bodyAt(event.i);
        const fl = bat ? meta(bat).flipper : undefined;
        if (fl) fl.firedAt = event.at;
        break;
      }
      // MB-10D: a slingshot face tossed someone — redraw the band flash on our copy.
      case 'sling': {
        const tri = this.bodyAt(event.i);
        const sl = tri ? meta(tri).sling : undefined;
        if (sl) sl.flashAt = this.game.time;
        break;
      }
      // MB-10C: dynamic mover state — set the truth, `Game.ageEffects` blends the pose in.
      case 'seesaw': {
        const body = this.bodyAt(event.i);
        const ss = body ? meta(body).seesaw : undefined;
        if (ss) ss.remote = { angle: event.angle, angVel: event.angVel, at: this.game.time };
        break;
      }
      case 'bridge': {
        const head = this.bodyAt(event.i);
        if (head) {
          const mdh = meta(head);
          mdh.sagTarget = event.sag;
          mdh.sagAt = this.game.time;
        }
        break;
      }
    }
  }

  // ---------- little helpers ----------

  private bodyAt(index: number): Matter.Body | undefined {
    // A body index is UNTRUSTED INPUT: a guest that built a different circuit
    // (or a forged frame) hands us numbers past the end of the array.
    if (!Number.isInteger(index) || index < 0 || index >= this.game.track.bodies.length) return undefined;
    return this.game.track.bodies[index];
  }

  private removeBody(index: number): void {
    // Through the engine, not straight at Matter: the engine keeps the list of
    // destroyed bodies that a snapshot is built from, and a guest that removed
    // a peg behind the engine's back would send a world without it.
    this.game.destroyBody(index);
  }

  private ring(x: number, y: number, ttl: number, color: string): void {
    this.game.effects.push({ type: 'ring', x, y, ttl, maxTtl: ttl, color });
  }

  private debris(x: number, y: number, n: number, sp: number, color: string): void {
    this.game.effects.push({ type: 'debris', x, y, ttl: 25, maxTtl: 25, color, particles: this.game.makeParticles(x, y, n, sp) });
  }
}

/** Ten seats is the grid; a guest that was handed a different number is mis-seated. */
export const GUEST_GRID_SIZE = MARBLE_COUNT;
