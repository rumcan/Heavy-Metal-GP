import Matter from 'matter-js';
import { generateTrack, meta, Track, CAT_MARBLE, CAT_WALL, CAT_SENSOR, CAT_LOOP_UP, CAT_LOOP_CLOSE, CAT_FRAGILE, W } from './track';
import { elementBodies, updateElements, hingeTimerState } from './elements';
import { TrackDefError, buildTrackFromDef } from './trackdef';
import { ItemType, MarbleInfo, MARBLE_RADIUS, statsToPhysics, mulberry32, TrackProfile, normalizeInventory, ITEM_TYPES, ITEM_INFO, MAX_ITEM_STACK } from './types';
import type { Inventory } from './types';
import { gridSlots } from './grid';
import { assistRolling, BASE_TICK, createMarble, downhill } from './physics';
import type { RampSurface } from './physics';
import type { SoundEvent, SoundType } from './audio';
// STORY HOOKS (ST-07). Type-only import: `src/game/story/types.ts` pulls in no art and no SDK, and the
// hooks themselves live in `src/game/story/modifiers.ts`, which the race screen supplies. Nothing in the
// story folder is imported at runtime by the engine, so a race without story mode is byte-for-byte today's.
import type { RaceCounter, StoryHooks } from './story/types';
import type { ItemBoxState, MarbleState, RaceEvent } from '../net/protocol';

export interface GameOptions {
  profile?: TrackProfile;
  gridOrder?: number[]; // marble ids, P1 first
  track?: Track;
  /**
   * MB-01. A `TrackDef` (a saved, shared or editor-made circuit) to race on instead of the procedural track.
   * Validated on the way in: a malformed def never throws in here — the race falls back to `generateTrack` and
   * the readable reason lands on `Game.trackDefError`. `undefined`/`null` mean "no def at all".
   */
  def?: unknown;
  recovery?: boolean;
  effects?: boolean;
  aiItems?: boolean;
  inventory?: Partial<Inventory>;
  /** Online house rules: these items never run out for anyone (the count shown stays full). */
  unlimitedItems?: ItemType[];
  /** Online: seats the host took off the grid. They sit off-track and never race or rank. */
  benched?: number[];
  /** STORY HOOKS (ST-07), additive and optional. Unset: the engine behaves exactly as before. */
  story?: StoryHooks;
  /**
   * MP-04: marble ids (seat slots) driven by a human on ANOTHER machine. The
   * host seats them and drives them from their intents; the AI never touches
   * them. The local seat is not listed — it uses `nudge`.
   */
  humanSeats?: number[];
  /**
   * MP-04: collect wire events for a host to publish (`drainRaceEvents`). Off
   * by default, so a single-player race pays nothing for a wire it never uses.
   */
  wireEvents?: boolean;
  /** MB-05: called each time the recovery marshal fires — lets the validator collect stuck spots off-screen. */
  onRecover?: (marbleId: number, pos: { x: number; y: number }) => void;
}

/**
 * MP-04: the `loop` value of every marble once the gate is open. The three
 * spare bits in a state frame's flag byte hold the start-light stage (0..5),
 * so a guest can draw the lights from the frames it is already applying; 6 is
 * "the gate is open". `MAX_LOOP_STAGE` is 7, so this stays in range.
 */
export const LIGHTS_OUT_STAGE = 6;

/**
 * MP-04: how many wire events may wait for a host that has stopped publishing.
 * A drained queue is the normal case (20 Hz); this only bounds the burst.
 */
export const EVENT_QUEUE_CAP = 256;

/**
 * MP-04: how long a lit peg glows before it pops away. Exported because the
 * guest hides it on the same clock: the `peg` event fires when the marble hits
 * it, and both ends retire the peg this many milliseconds later.
 */
export const PEG_POP_MS = 150;

const { Engine, Bodies, Body, Composite, Events, Query } = Matter;

const ITEM_POOL = ITEM_TYPES;
const TICK = 1000 / 60;

export interface Marble {
  info: MarbleInfo;
  body: Matter.Body;
  baseDensity: number;
  restitution: number;
  frictionAir: number;
  maxSpeed: number;
  inventory: Inventory;
  itemCooldownUntil: number;
  aeroUntil: number;
  jumpUntil: number;
  aiUseAt: number;
  frozenUntil: number;
  ghostUntil: number;
  /** 0 = entering a loop (rising quarter solid), 1 = past the top (closing quarter solid). */
  loopStage: 0 | 1;
  anvilUntil: number;
  rocketUntil: number;
  padCooldownUntil: number;
  frozen: boolean;
  inOil: boolean;
  finishedAt: number | null;
  stuckTime: number;
  lastPickupAt: number;
  trail: { x: number; y: number }[];
  pegs: number;
  gridSlot: number;
  grounded: number; // ticks since last floor contact
  motionAnchor: Matter.Vector;
  motionAt: number;
  depthAt: number;
  deepestY: number;
  lastRecoveryAt: number;
  recoveryUntil: number;
  recoveries: number;
  nudges: number;
  /** MB-10: the element currently holding this marble (hidden in a tunnel), or null. */
  hold: Hold | null;
  /** MB-10: brief invulnerability after a tunnel exit so the marble isn't instantly re-caught. */
  tunnelSafeUntil: number;
}

export interface OilSlick {
  x: number;
  y: number;
  r: number;
  ownerId: number;
  expiresAt: number;
}

/**
 * MB-10. A marble captured by an element (a cliff tunnel so far): the body is a sensor gliding
 * — hidden inside the rock — from the capture point to the exit over the transit, so the wire
 * positions stay continuous for whoever watches (a teleport is never drawn). At `until` it pops
 * out with its set direction and speed. Guests learn the ride from a `hold` event; the extra
 * fields are host-side only.
 */
export interface Hold {
  kind: 'tunnel';
  until: number;
  /** Clocked at `until - transit`; the glide runs from then on. Host-only on the wire. */
  transit?: number;
  from?: { x: number; y: number };
  body?: Matter.Body;
  exit?: { x: number; y: number; dir: { x: number; y: number }; speed: number };
}

export interface Effect {
  type: 'ring' | 'beam' | 'debris' | 'text' | 'flash' | 'snow';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  ttl: number;
  maxTtl: number;
  color: string;
  text?: string;
  particles?: { x: number; y: number; vx: number; vy: number; s: number }[];
}

export interface RankEntry {
  marble: Marble;
  rank: number;
  finished: boolean;
  time: number | null;
}

export class Game {
  engine: Matter.Engine;
  world: Matter.World;
  track: Track;
  marbles: Marble[] = [];
  player: Marble;
  oils: OilSlick[] = [];
  effects: Effect[] = [];
  /** Sound cues for the race screen to play and clear each frame. */
  sounds: SoundEvent[] = [];
  time = 0;
  started = false;
  gateOpen = false;
  /** MP-04: start-light stage — 0..5 on the grid, LIGHTS_OUT_STAGE once racing. */
  stage = 0;
  /**
   * MP-04: marbles driven by a human who is NOT this machine, keyed by marble
   * id (= seat slot). The local player keeps using `nudge` — it never crosses a
   * wire — and every entry here is a guest the HOST is driving on their behalf.
   * An entry means "a person is in this seat", so the AI keeps its hands off
   * even before the guest's first intent arrives.
   */
  humanInput = new Map<number, { nudge: number }>();
  finishOrder: Marble[] = [];
  nudge = 0;
  rng: () => number;
  shake = 0;
  raceStartTime = 0;
  private byId = new Map<number, Marble>();
  private supports = new Map<number, RampSurface>();
  private recoveryEnabled: boolean;
  private effectsEnabled: boolean;
  private aiItemsEnabled: boolean;
  private onRecover?: (marbleId: number, pos: { x: number; y: number }) => void;
  /** STORY HOOKS (ST-07). Undefined in every non-story race. */
  private story?: StoryHooks;
  private storySectors = new Map<number, number>();
  private storyOrder: number[] = [];
  private pendingLaunches = new Map<number, Matter.Vector>();
  private lastWallToast = -9999;
  private pendingBreaks: { body: Matter.Body; marble: Marble; v: { x: number; y: number } }[] = [];
  onEvent?: (msg: string, color?: string) => void;
  onInventoryChange?: (inventory: Inventory) => void;
  /** MP-04: wire events queued since the last `drainRaceEvents`. */
  private raceEvents: RaceEvent[] = [];
  /** Body → its index in `track.bodies`: the stable reference the wire speaks. */
  private bodyIndex = new Map<Matter.Body, number>();
  /** Indices of destroyed track bodies, for the join/resync snapshot. */
  private destroyed = new Set<number>();
  private wireEvents: boolean;
  /** Why `GameOptions.def` was refused, in the player's words, or null when there was nothing to refuse. */
  trackDefError: string | null = null;
  private poppingPegs = new Set<Matter.Body>();
  /** MB-10A: per-marble tunnel-entry counts, so up-exits can't make an infinite loop (cap per hole). */
  private tunnelVisits = new Map<number, Map<number, number>>();
  private staticBins = new Map<number, Matter.Body[]>();
  private globalBodies: Matter.Body[] = [];
  private loadedBodies = new Map<number, Matter.Body>();
  private loadedCells = '';
  private streaming = false;

  /** Items that never run out this race (online house rules). */
  private readonly unlimitedItems: Set<ItemType>;
  /** Seats that are not racing (online, taken off the grid by the host). */
  readonly benched = new Set<number>();

  private byIdOrNull(id: number): Marble | null {
    return this.marbles.find((m) => m.info.id === id) ?? null;
  }

  constructor(seed: number, roster: MarbleInfo[], opts: GameOptions = {}) {
    this.unlimitedItems = new Set(opts.unlimitedItems ?? []);
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.engine = Engine.create({
      enableSleeping: false,
      positionIterations: 10,
      velocityIterations: 8,
    });
    this.engine.gravity.y = 1;
    this.world = this.engine.world;
    // STORY HOOKS (ST-07): a chapter can add hazards through TrackProfile.weights only — no new pieces, and
    // only when a profile was supplied. Merging is an override, so it is safe if the caller already merged.
    this.story = opts.story;
    const storyWeights = opts.story?.weights;
    const profile = opts.profile && storyWeights ? { ...opts.profile, weights: { ...opts.profile.weights, ...storyWeights } } : opts.profile;
    // A custom `TrackDef` wins over the seed; the seed is what a multiplayer
    // race agrees on, and either way the circuit is built once, here.
    this.track = opts.track ?? this.trackFor(seed, profile, opts.def);
    this.wireEvents = opts.wireEvents === true;
    // The wire names track bodies by their index in `track.bodies`. Both sides
    // build the identical circuit from the seed, so an index IS the body — and
    // an index either end can check against `track.bodies.length`.
    this.bodyIndex = new Map(this.track.bodies.map((body, i) => [body, i]));
    this.recoveryEnabled = opts.recovery !== false;
    this.effectsEnabled = opts.effects !== false;
    this.aiItemsEnabled = opts.aiItems !== false;
    this.onRecover = opts.onRecover;
    Composite.add(this.world, this.track.bodies);

    const order = opts.gridOrder && opts.gridOrder.length === roster.length ? opts.gridOrder : roster.map((r) => r.id);
    const slots = gridSlots(order);
    roster.forEach((info) => {
      const ph = statsToPhysics(info.stats);
      const slot = slots.find((s) => s.id === info.id)!;
      const body = createMarble(info, { x: slot.x, y: this.track.startY });
      const m: Marble = {
        info,
        body,
        baseDensity: body.density,
        restitution: ph.restitution,
        frictionAir: ph.frictionAir,
        maxSpeed: ph.maxSpeed,
        // MP-09: the local player's kit, or the kit this seat came to the grid
        // with online — every human seat spends its own items.
        inventory: info.isPlayer ? normalizeInventory(opts.inventory) : normalizeInventory(info.inventory),
        itemCooldownUntil: 0,
        aeroUntil: 0,
        jumpUntil: 0,
        aiUseAt: 0,
        frozenUntil: 0,
        ghostUntil: 0,
        anvilUntil: 0,
        rocketUntil: 0,
        padCooldownUntil: 0,
        frozen: false,
        inOil: false,
        finishedAt: null,
        stuckTime: 0,
        loopStage: 0,
        lastPickupAt: 0,
        trail: [],
        pegs: 0,
        gridSlot: slot.slot,
        grounded: 99,
        motionAnchor: { ...body.position },
        motionAt: 0,
        depthAt: 0,
        deepestY: this.track.startY,
        lastRecoveryAt: -10000,
        recoveryUntil: 0,
        recoveries: 0,
        nudges: 0,
        hold: null,
        tunnelSafeUntil: 0,
      };
      this.marbles.push(m);
      this.byId.set(info.id, m);
    });
    this.marbles.sort((a, b) => a.info.id - b.info.id);
    // Guest seats are human from the moment they are seated, not from their
    // first intent: an idle guest must not be driven by the AI.
    for (const id of opts.humanSeats ?? []) if (!this.humanInput.has(id)) this.humanInput.set(id, { nudge: 0 });
    Composite.add(
      this.world,
      this.marbles.map((m) => m.body),
    );
    this.player = this.marbles.find((m) => m.info.isPlayer) ?? this.marbles[0];
    for (const id of opts.benched ?? []) {
      const m = this.byIdOrNull(id);
      if (!m || m === this.player) continue;
      this.benched.add(id);
      // "Finished" without a place: every loop that skips a finished marble skips it,
      // and it is never in finishOrder, so it never ranks.
      m.finishedAt = 0;
      this.park(m);
      Body.setPosition(m.body, { x: -5000, y: -5000 });
    }
    if (!this.player) throw new Error('A race needs at least one marble.');
    this.streaming = this.track.bodies.length > 350;
    if (this.streaming) {
      for (const body of this.track.bodies) {
        this.loadedBodies.set(body.id, body);
        if (body.bounds.max.y - body.bounds.min.y > 1800) this.globalBodies.push(body);
        else {
          const from = Math.floor(body.bounds.min.y / 400);
          const to = Math.floor(body.bounds.max.y / 400);
          for (let cell = from; cell <= to; cell++) this.staticBins.set(cell, [...(this.staticBins.get(cell) ?? []), body]);
        }
      }
      this.syncTrack();
    }

    Events.on(this.engine, 'collisionStart', (e) => this.onCollisionStart(e));
    Events.on(this.engine, 'collisionActive', (e) => this.onCollisionActive(e));
  }

  /**
   * MB-01. The circuit this race runs on: an explicit track wins, then a validated `TrackDef`, then the
   * procedural generator. A def is untrusted input (share codes, saved tracks, the network), so it is validated
   * here and a rejection is reported rather than thrown: a bad circuit must never take a race down with it.
   */
  private trackFor(seed: number, profile: TrackProfile | undefined, def: unknown): Track {
    if (def === undefined || def === null) return generateTrack(seed, profile);
    try {
      return buildTrackFromDef(def);
    } catch (error) {
      this.trackDefError = error instanceof TrackDefError ? error.message : `Track definition rejected: ${String(error)}`;
      return generateTrack(seed, profile);
    }
  }

  marbleOf(body: Matter.Body): Marble | undefined {
    if (body.label !== 'marble') return undefined;
    const id = (body.plugin as { id: number }).id;
    return this.byId.get(id);
  }

  start() {
    this.started = true;
  }

  /** MP-04: true when a person — local or remote — is driving this marble. */
  isHuman(m: Marble): boolean {
    return m.info.isPlayer || this.humanInput.has(m.info.id);
  }

  /** MP-04: this body's index in `track.bodies`, or -1 when it is not the track. */
  indexOf(body: Matter.Body): number {
    return this.bodyIndex.get(body) ?? -1;
  }

  /**
   * MP-04: queue one wire event for the host to publish.
   *
   * Only the things a guest cannot re-derive travel: a crate, a peg, a box, an
   * item, a finish. Everything with its own event carries NO sound cue — the
   * guest makes the noise from the event it is already drawing. Cues are for
   * the rest: the gate, the countdown, a bounce pad, a bucket.
   */
  emit(event: RaceEvent): void {
    if (!this.wireEvents) return;
    if (this.raceEvents.length >= EVENT_QUEUE_CAP) this.raceEvents.shift();
    this.raceEvents.push(event);
  }

  /** MP-04: hand the host everything that happened since the last drain. */
  drainRaceEvents(): RaceEvent[] {
    if (!this.raceEvents.length) return [];
    const out = this.raceEvents;
    this.raceEvents = [];
    return out;
  }

  /**
   * MP-04: every marble as the wire wants it, in seat order.
   *
   * `marbles` is sorted by `info.id`, and the roster is ten marbles with ids
   * 0..9 — one seat, one id, one offset in every packed frame.
   */
  marbleStates(): MarbleState[] {
    return this.marbles.map((m) => ({
      x: m.body.position.x,
      y: m.body.position.y,
      vx: m.body.velocity.x,
      vy: m.body.velocity.y,
      a: m.body.angle,
      finished: m.finishedAt !== null,
      frozen: m.frozen,
      oil: m.inOil,
      ghost: this.time < m.ghostUntil,
      anvil: this.time < m.anvilUntil,
      loop: this.stage,
    }));
  }

  /** MP-04: indices of the track bodies this race has destroyed, ascending. */
  destroyedIndices(): number[] {
    return [...this.destroyed].sort((a, b) => a - b);
  }

  /** MP-04: every item box as the wire wants it. */
  boxStates(): ItemBoxState[] {
    return this.track.itemBoxes.map((box) => ({ i: this.indexOf(box), active: meta(box).active !== false }));
  }

  private syncTrack() {
    if (!this.streaming) return;
    const cells = new Set<number>();
    for (const marble of this.marbles) {
      if (marble.finishedAt !== null && !this.allFinished()) continue;
      const y = marble.body.position.y;
      if (!Number.isFinite(y)) continue;
      for (let cell = Math.floor((y - 380) / 400); cell <= Math.floor((y + 380) / 400); cell++) cells.add(cell);
    }
    const key = [...cells].sort((a, b) => a - b).join(',');
    if (key === this.loadedCells) return;
    this.loadedCells = key;
    const wanted = new Map<number, Matter.Body>();
    for (const body of this.globalBodies) if (!meta(body).destroyed) wanted.set(body.id, body);
    for (const cell of cells) for (const body of this.staticBins.get(cell) ?? []) if (!meta(body).destroyed) wanted.set(body.id, body);
    // Only nearby track geometry enters the solver; the renderer and map retain the full circuit.
    for (const [id, body] of this.loadedBodies) if (!wanted.has(id)) Composite.remove(this.world, body);
    const arriving = [...wanted.values()].filter((body) => !this.loadedBodies.has(body.id));
    if (arriving.length) Composite.add(this.world, arriving);
    this.loadedBodies = wanted;
  }

  /**
   * Destroy a track body BY INDEX — what a guest does with the host's
   * `destroyed` list (and with a `peg` or `crate` event). The guest has no
   * physics of its own, but it must keep the same bookkeeping as the host or
   * the two screens disagree about which pegs are still standing.
   */
  destroyBody(index: number): void {
    const body = this.track.bodies[index];
    if (body) this.removeTrackBody(body);
  }

  private removeTrackBody(body: Matter.Body) {
    meta(body).destroyed = true;
    Composite.remove(this.world, body);
    this.loadedBodies.delete(body.id);
    const index = this.indexOf(body);
    if (index >= 0) this.destroyed.add(index);
  }

  openGate() {
    if (this.gateOpen) return;
    this.gateOpen = true;
    this.raceStartTime = this.time;
    this.sfx('go', this.player, W / 2, 0);
    this.stage = LIGHTS_OUT_STAGE;
    this.emit({ kind: 'sound', cue: 'gate' });
    // trapdoor opens: marbles start from rest and let gravity do the work
    this.removeTrackBody(this.track.gate);
    this.marbles.forEach((m) => {
      Body.setVelocity(m.body, { x: 0, y: 0 });
      m.motionAt = m.depthAt = this.time;
      m.motionAnchor = { ...m.body.position };
      m.deepestY = m.body.position.y;
    });
  }

  // ---------- collisions ----------
  private onCollisionStart(e: Matter.IEventCollision<Matter.Engine>) {
    for (const pair of e.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ma = this.marbleOf(a);
      const mb = this.marbleOf(b);
      if (ma && !mb) {
        this.contactSurface(ma, b, pair);
        this.marbleHits(ma, b);
      } else if (mb && !ma) {
        this.contactSurface(mb, a, pair);
        this.marbleHits(mb, a);
      }
      else if (ma && mb) {
        if (ma.hold || mb.hold) continue; // a hidden marble clacks with nobody
        const sp = Math.hypot(ma.body.velocity.x - mb.body.velocity.x, ma.body.velocity.y - mb.body.velocity.y);
        if (sp > 4) {
          this.sfx('clack', ma.info.isPlayer ? ma : mb, a.position.x, a.position.y);
          this.effects.push({
            type: 'flash',
            x: (a.position.x + b.position.x) / 2,
            y: (a.position.y + b.position.y) / 2,
            ttl: 10,
            maxTtl: 10,
            color: '#ffffff',
          });
        }
      }
    }
  }

  private sfx(type: SoundType, m: Marble | null, x: number, y: number, extra: Partial<SoundEvent> = {}) {
    if (this.sounds.length < 48) this.sounds.push({ type, x, y, player: !!m?.info.isPlayer, ...extra });
  }

  private applyMask(m: Marble) {
    const ghost = m.ghostUntil > this.time;
    // Ghost marbles phase through rivals (CAT_MARBLE) and fragile barricades (CAT_FRAGILE,
    // MB-10A: a ghost slips through a NO ENTRY sign or a crumbling wall without opening it).
    m.body.collisionFilter.mask = CAT_WALL | CAT_SENSOR | (ghost ? 0 : CAT_MARBLE | CAT_FRAGILE) | (m.loopStage === 1 ? CAT_LOOP_CLOSE : CAT_LOOP_UP);
  }

  private setLoopStage(m: Marble, stage: 0 | 1) {
    if (m.loopStage === stage) return;
    m.loopStage = stage;
    this.applyMask(m);
  }

  private marbleHits(m: Marble, other: Matter.Body) {
    if (m.finishedAt !== null || m.frozen || !this.gateOpen) return;
    const md = meta(other);
    if (!md) return;
    switch (md.kind) {
      case 'loopTop':
        if (m.loopStage === 0) this.sfx('loop', m, other.position.x, other.position.y);
        if (m.loopStage === 0) this.storyCounter('loops', m); // STORY HOOK (ST-07)
        this.setLoopStage(m, 1);
        break;
      case 'loopExit':
        this.setLoopStage(m, 0);
        break;
      case 'hoop': {
        const v = Body.getVelocity(m.body);
        const speed = Math.hypot(v.x, v.y);
        const dir = speed > 1.5 ? { x: v.x / speed, y: v.y / speed } : md.dir ?? { x: 0, y: 1 };
        const boosted = Math.min(20, Math.max(speed * 1.35, speed + 5));
        Body.setVelocity(m.body, { x: dir.x * boosted, y: dir.y * boosted });
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 22, maxTtl: 22, color: '#fb923c' });
        this.sfx('hoop', m, other.position.x, other.position.y);
        this.storyCounter('hoops', m); // STORY HOOK (ST-07)
        break;
      }
      case 'wrecker': {
        const dx = m.body.position.x - other.position.x, dy = m.body.position.y - other.position.y;
        const d = Math.hypot(dx, dy) || 1;
        const v = Body.getVelocity(m.body);
        const push = 7;
        Body.setVelocity(m.body, { x: v.x * 0.4 + dx / d * push, y: v.y * 0.4 + dy / d * push });
        this.shake = Math.max(this.shake, 5);
        this.sfx('clang', m, other.position.x, other.position.y);
        this.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 14, maxTtl: 14, color: '#e2e8f0' });
        break;
      }
      case 'breakable': {
        const speed = Body.getSpeed(m.body);
        const dmg = m.body.mass * speed;
        md.hp = (md.hp ?? 0) - dmg;
        if (md.hp > 0 && dmg > 0.5) this.sfx('crack', m, other.position.x, other.position.y);
        this.emit({ kind: 'crate', i: this.indexOf(other), hp: Math.max(0, md.hp), broken: md.hp <= 0 });
        this.effects.push({
          type: 'debris',
          x: other.position.x,
          y: other.position.y,
          ttl: 25,
          maxTtl: 25,
          color: '#fbbf24',
          particles: this.makeParticles(other.position.x, other.position.y, 6, 3),
        });
        if (md.hp <= 0) {
          md.hp = 0;
          // defer removal until after this physics step, and restore the marble's momentum so it plows through
          const v = Body.getVelocity(m.body);
          if (!this.pendingBreaks.some((p) => p.body === other)) {
            this.pendingBreaks.push({ body: other, marble: m, v: { x: v.x * 0.85, y: v.y } });
          }
          this.shake = 10;
          this.sfx('smash', m, other.position.x, other.position.y);
          this.storyCounter('crates', m); // STORY HOOK (ST-07)
          this.effects.push({
            type: 'debris',
            x: other.position.x,
            y: other.position.y,
            ttl: 50,
            maxTtl: 50,
            color: '#f59e0b',
            particles: this.makeParticles(other.position.x, other.position.y, 22, 7),
          });
          if (m.info.isPlayer) this.onEvent?.('SMASH! Shortcut opened', '#f59e0b');
        } else if (m.info.isPlayer && this.time - this.lastWallToast > 1200 && dmg > 0.5) {
          this.lastWallToast = this.time;
          this.onEvent?.(`Too light! Wall at ${Math.round((md.hp / (md.maxHp ?? 1)) * 100)}%`, '#94a3b8');
        }
        break;
      }
      // ---- MB-10A: shortcuts and secrets ----
      case 'barricade': {
        // A NO ENTRY barricade: damage is weight × speed like a SMASH crate; Heavy metal one-hits it.
        const anvil = this.time < m.anvilUntil;
        const speed = Body.getSpeed(m.body);
        const dmg = anvil ? (md.hp ?? 1) + 1 : m.body.mass * speed;
        md.hp = (md.hp ?? 0) - dmg;
        if (md.hp > 0 && dmg > 0.5) this.sfx('crack', m, other.position.x, other.position.y);
        this.emit({ kind: 'crate', i: this.indexOf(other), hp: Math.max(0, md.hp), broken: md.hp <= 0 });
        this.effects.push({
          type: 'debris', x: other.position.x, y: other.position.y, ttl: 25, maxTtl: 25, color: '#d6a04e',
          particles: this.makeParticles(other.position.x, other.position.y, 6, 3),
        });
        if (md.hp <= 0) {
          md.hp = 0;
          const v = Body.getVelocity(m.body);
          if (!this.pendingBreaks.some((p) => p.body === other)) {
            this.pendingBreaks.push({ body: other, marble: m, v: { x: v.x * 0.85, y: v.y } });
          }
          this.shake = 8;
          this.sfx('smash', m, other.position.x, other.position.y);
          this.sfx('cheer', m, other.position.x, other.position.y);
          this.emit({ kind: 'sound', cue: 'cheer' });
          this.effects.push({
            type: 'debris', x: other.position.x, y: other.position.y, ttl: 50, maxTtl: 50, color: '#d6a04e',
            particles: this.makeParticles(other.position.x, other.position.y, 22, 7),
          });
          this.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 30, ttl: 70, maxTtl: 70, color: '#fca5a5', text: 'NO ENTRY!' });
          if (m.info.isPlayer) this.onEvent?.('Barricade smashed! The tunnel is open', '#fca5a5');
        } else if (m.info.isPlayer && this.time - this.lastWallToast > 1200 && dmg > 0.5) {
          this.lastWallToast = this.time;
          this.onEvent?.(anvil ? 'HEAVY HIT!' : `Barricade at ${Math.round((md.hp / (md.maxHp ?? 1)) * 100)}%`, '#94a3b8');
        }
        break;
      }
      case 'crumble': {
        // A crumbling wall: cumulative pack damage, permanent for the race; Heavy metal counts triple.
        const anvil = this.time < m.anvilUntil;
        const speed = Body.getSpeed(m.body);
        const dmg = m.body.mass * speed * (anvil ? 3 : 1);
        md.hp = (md.hp ?? 0) - dmg;
        if (md.hp > 0 && dmg > 0.5) this.sfx('crack', m, other.position.x, other.position.y);
        this.emit({ kind: 'crate', i: this.indexOf(other), hp: Math.max(0, md.hp), broken: md.hp <= 0 });
        if (dmg > 0.5) this.shake = Math.max(this.shake, 3);
        if (md.hp <= 0) {
          md.hp = 0;
          const v = Body.getVelocity(m.body);
          if (!this.pendingBreaks.some((p) => p.body === other)) {
            this.pendingBreaks.push({ body: other, marble: m, v: { x: v.x * 0.9, y: v.y } });
          }
          this.shake = 12;
          this.sfx('smash', m, other.position.x, other.position.y);
          this.emit({ kind: 'sound', cue: 'rumble' });
          this.effects.push({
            type: 'debris', x: other.position.x, y: other.position.y, ttl: 60, maxTtl: 60, color: '#a8a29e',
            particles: this.makeParticles(other.position.x, other.position.y, 26, 7),
          });
          if (m.info.isPlayer) this.onEvent?.('The wall crumbled! Shortcut open', '#d6d3d1');
        }
        break;
      }
      case 'tunnel': {
        // A hole in the cliff: swallow the marble for a hidden transit, then pop it out the far hole.
        if (m.hold || this.time < m.tunnelSafeUntil || !md.exit) break;
        const visits = this.tunnelVisits.get(m.info.id) ?? new Map<number, number>();
        this.tunnelVisits.set(m.info.id, visits);
        const used = visits.get(other.id) ?? 0;
        if (used >= 3) break; // up-exits must never loop forever
        visits.set(other.id, used + 1);
        const transit = md.transit ?? 900;
        const until = this.time + transit;
        m.hold = { kind: 'tunnel', until, transit, from: { x: other.position.x, y: other.position.y }, body: other, exit: md.exit };
        m.body.isSensor = true;
        Body.setPosition(m.body, { x: other.position.x, y: other.position.y });
        Body.setVelocity(m.body, { x: 0, y: 0 });
        Body.setAngularVelocity(m.body, 0);
        m.trail = [];
        this.sfx('rumble', m, other.position.x, other.position.y);
        this.emit({ kind: 'sound', cue: 'rumble', seat: m.info.id });
        this.emit({ kind: 'hold', seat: m.info.id, until });
        this.effects.push({ type: 'snow', x: other.position.x, y: other.position.y, ttl: 30, maxTtl: 30, color: '#b8a88f', particles: this.makeParticles(other.position.x, other.position.y, 10, 2) });
        break;
      }
      case 'switchPad': {
        // Trip lever: flip the paired plate for the NEXT marble.
        const plate = md.paired !== undefined ? this.track.bodies[md.paired] : undefined;
        if (!plate || meta(plate).destroyed) break;
        const ps = meta(plate);
        ps.side = ps.side === 1 ? 0 : 1;
        ps.flippedAt = this.time;
        md.hitAt = this.time;
        this.sfx('click', m, other.position.x, other.position.y);
        this.emit({ kind: 'switch', i: this.indexOf(plate), side: ps.side! });
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 14, maxTtl: 14, color: '#fbbf24' });
        break;
      }
      case 'pad': {
        if (this.time < m.padCooldownUntil) break;
        m.padCooldownUntil = this.time + 600;
        const dir = md.dir ?? { x: -1, y: -1 };
        const vy = Math.min(12.2, 3.5 + 9.5 * m.restitution);
        this.pendingLaunches.set(m.info.id, { x: dir.x * 4.5, y: -vy });
        this.sfx('spring', m, other.position.x, other.position.y);
        this.storyCounter('pads', m); // STORY HOOK (ST-07)
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y - 10, ttl: 20, maxTtl: 20, color: '#34d399' });
        // Pad, bucket, gate and countdown have no event of their own, so they
        // cross as a cue. A booster does not: it fires every step, and a guest
        // can see a marble is on a booster from the track it already built.
        this.emit({ kind: 'sound', cue: 'pad', seat: m.info.id });
        if (m.info.isPlayer) this.onEvent?.(`Boing! Bounce power ${(m.restitution * 100).toFixed(0)}%`, '#34d399');
        break;
      }
      case 'itembox': {
        if (!md.active) break;
        const available = ITEM_POOL.filter((item) => m.inventory[item] < MAX_ITEM_STACK);
        if (!available.length) break;
        md.active = false;
        md.respawnAt = this.time + 7000;
        this.grantItem(m, available[Math.floor(this.rng() * available.length)]);
        this.sfx('pickup', m, other.position.x, other.position.y);
        this.storyCounter('itemBoxes', m); // STORY HOOK (ST-07)
        this.emit({ kind: 'box', i: this.indexOf(other), taken: true, seat: m.info.id });
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 18, maxTtl: 18, color: '#facc15' });
        break;
      }
      case 'ppeg': {
        if (md.hit) break;
        md.hit = true;
        md.hitAt = this.time;
        this.poppingPegs.add(other);
        this.emit({ kind: 'peg', i: this.indexOf(other), seat: m.info.id });
        const col = md.pegColor ?? 'blue';
        this.sfx('peg', m, other.position.x, other.position.y, { color: col });
        const pc = col === 'orange' ? '#fb923c' : col === 'green' ? '#4ade80' : '#60a5fa';
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 14, maxTtl: 14, color: pc });
        this.effects.push({ type: 'debris', x: other.position.x, y: other.position.y, ttl: 22, maxTtl: 22, color: pc, particles: this.makeParticles(other.position.x, other.position.y, 6, 2.5) });
        if (col === 'orange') {
          m.pegs++;
          this.storyCounter('orangePegs', m); // STORY HOOK (ST-07)
          // orange pegs give a little kick of speed
          const v = Body.getVelocity(m.body);
          const sp = Math.hypot(v.x, v.y) || 1;
          Body.setVelocity(m.body, { x: v.x + (v.x / sp) * 1.5, y: v.y + (v.y / sp) * 1.5 + 0.5 });
          this.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 20, ttl: 40, maxTtl: 40, color: '#fdba74', text: '+1 PEG' });
        } else if (col === 'green') {
          this.grantItem(m, md.itemDrop ?? ITEM_POOL[Math.floor(this.rng() * ITEM_POOL.length)]);
          this.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 20, ttl: 40, maxTtl: 40, color: '#86efac', text: 'POWER!' });
        }
        break;
      }
      case 'bucket': {
        if (this.time < (md.cooldownUntil ?? 0)) break;
        md.cooldownUntil = this.time + 250;
        Body.setPosition(m.body, { x: other.position.x, y: other.position.y + 30 });
        this.pendingLaunches.set(m.info.id, { x: 0, y: 17 });
        this.sfx('bucket', m, other.position.x, other.position.y);
        this.storyCounter('buckets', m); // STORY HOOK (ST-07)
        m.trail = [];
        this.shake = 6;
        this.effects.push({ type: 'ring', x: other.position.x, y: other.position.y, ttl: 24, maxTtl: 24, color: '#fbbf24' });
        this.effects.push({ type: 'text', x: other.position.x, y: other.position.y - 30, ttl: 60, maxTtl: 60, color: '#fbbf24', text: 'ALL ABOARD!' });
        if (m.info.isPlayer) this.onEvent?.('ALL ABOARD! Minecart express', '#fbbf24');
        this.emit({ kind: 'sound', cue: 'bucket', seat: m.info.id });
        break;
      }
      case 'finish': {
        this.finishMarble(m);
        break;
      }
      case 'peg': {
        if (Body.getSpeed(m.body) > 2) this.sfx('bump', m, other.position.x, other.position.y);
        break;
      }
      case 'ramp':
      case 'wall':
      case 'loop':
        if (m.info.isPlayer && Body.getSpeed(m.body) > 6) this.sfx('thud', m, m.body.position.x, m.body.position.y);
        break;
      default:
        break;
    }
  }

  private onCollisionActive(e: Matter.IEventCollision<Matter.Engine>) {
    for (const pair of e.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const ma = this.marbleOf(a);
      const mb = this.marbleOf(b);
      const m = ma ?? mb;
      const other = ma ? b : a;
      if (!m || (ma && mb) || m.frozen || m.finishedAt !== null || !this.gateOpen) continue;
      const md = meta(other);
      if (!md) continue;
      this.contactSurface(m, other, pair);
      // A marble too slow to make the loop settles at the bottom; let it roll out instead of rocking forever.
      if (md.kind === 'loopBail' && m.loopStage === 0 && Body.getSpeed(m.body) < 2.5) this.setLoopStage(m, 1);
      if (md.kind === 'boost' && md.dir) {
        const v = Body.getVelocity(m.body);
        const k = 0.45 * Math.sqrt(1 / m.body.mass) * this.engine.timing.lastDelta / BASE_TICK;
        Body.setVelocity(m.body, { x: v.x + md.dir.x * k, y: v.y + md.dir.y * k });
        if (this.rng() < 0.3) {
          this.effects.push({
            type: 'debris',
            x: m.body.position.x,
            y: m.body.position.y,
            ttl: 14,
            maxTtl: 14,
            color: '#fb923c',
            particles: this.makeParticles(m.body.position.x, m.body.position.y, 2, 1.5),
          });
        }
      }
    }
  }

  private contactSurface(m: Marble, obstacle: Matter.Body, pair: Matter.Pair) {
    const surface = meta(obstacle)?.surface;
    if (!surface || m.frozen || m.finishedAt !== null) return;
    const offset = { x: m.body.position.x - surface.start.x, y: m.body.position.y - surface.start.y };
    if (offset.x * surface.normal.x + offset.y * surface.normal.y < 0) return;
    this.supports.set(m.info.id, surface);
    pair.friction = this.time < m.aeroUntil ? 0 : 0.002;
    pair.frictionStatic = 0;
    const velocity = Body.getVelocity(m.body);
    const impact = Math.abs(velocity.x * surface.normal.x + velocity.y * surface.normal.y);
    if (impact < 1.3) pair.restitution = 0;
  }

  private finishMarble(m: Marble) {
    if (m.finishedAt !== null || !this.gateOpen || m.hold) return;
    m.finishedAt = this.raceTime();
    this.finishOrder.push(m);
    if (m.info.isPlayer) this.sfx('finish', m, m.body.position.x, m.body.position.y, { rank: this.finishOrder.length });
    this.emit({ kind: 'finish', seat: m.info.id, time: m.finishedAt, rank: this.finishOrder.length });
    m.body.frictionAir = 0.045;
    m.trail = [];
    this.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 30, maxTtl: 30, color: m.info.color });
  }

  /**
   * Move a finished marble off the track: a sensor parked by the finish line,
   * out of everyone's way. The host does this from `step`; a GUEST does it from
   * the `finish` event, because it never steps — and both ends must park in the
   * same place or the two screens disagree about where the finishers are.
   */
  park(m: Marble): void {
    if (m.body.isSensor) return;
    Composite.remove(this.world, m.body);
    m.body.isSensor = true;
    Body.setPosition(m.body, { x: 80 + (m.info.id % 10) * 80, y: this.track.finishY + 75 });
    Body.setVelocity(m.body, { x: 0, y: 0 });
    Body.setAngularVelocity(m.body, 0);
  }

  // ---------- MB-10 elements ----------

  /**
   * Host-authoritative element state. Weight-mode trapdoors watch the pack resting on them and
   * flip their open state; the state crosses the wire as a `trapdoor` event, and both ends ease
   * the door in `ageEffects`. Everything else about these elements is either clock-kinematic
   * (timer trapdoors, switch swing easing) or event-driven (a tunnel capture).
   */
  private elementState(dt: number) {
    for (const door of elementBodies(this.track, 'trapdoor')) {
      const md = meta(door);
      if (md.destroyed || !md.motion || md.motion.mode !== 'hinge') continue;
      if (md.mode === 'timer') {
        // The clock drives the pose; the creak rides the cable so every client hears the swing.
        const st = hingeTimerState(md.motion, this.time);
        const k = md.motion.openAngle !== 0 ? Math.min(1, Math.abs(st.angle / md.motion.openAngle)) : st.angle !== 0 ? 1 : 0;
        const prev = md.eased ?? 0;
        if ((prev < 0.5) !== (k < 0.5)) {
          this.sfx('creak', this.player, door.position.x, door.position.y);
          this.emit({ kind: 'sound', cue: 'creak' });
        }
        md.eased = k;
        continue;
      }
      if (md.openNow) {
        if (this.time - (md.openedAt ?? 0) >= (md.openMs ?? 1200)) {
          md.openNow = false;
          md.restSince = 0;
          this.sfx('creak', this.player, door.position.x, door.position.y);
          this.emit({ kind: 'trapdoor', i: this.indexOf(door), open: false });
          this.emit({ kind: 'sound', cue: 'creak' });
        }
        continue;
      }
      // the pack weight resting on the closed door: heavy marbles — or a whole pile — open it
      let mass = 0;
      let playerResting = false;
      const motion = md.motion;
      const top = motion.pivot.y;
      for (const m of this.marbles) {
        if (m.finishedAt !== null || m.frozen || m.hold) continue;
        const p = m.body.position;
        if (Math.abs(p.x - door.position.x) < motion.len / 2 + 10 && p.y > top - 34 && p.y < top + 12 && Math.abs(m.body.velocity.y) < 2.5) {
          mass += m.body.mass;
          if (m.info.isPlayer) playerResting = true;
        }
      }
      if (mass >= (md.weightKg ?? 2.4)) {
        md.restSince = (md.restSince ?? 0) + dt;
        if (md.restSince >= (md.holdMs ?? 300)) {
          md.openNow = true;
          md.openedAt = this.time;
          md.restSince = 0;
          this.sfx('creak', this.player, door.position.x, door.position.y);
          this.emit({ kind: 'trapdoor', i: this.indexOf(door), open: true });
          this.emit({ kind: 'sound', cue: 'creak' });
          if (playerResting) this.onEvent?.('The hatch gives way!', '#fbbf24');
        }
      } else md.restSince = 0;
    }
  }

  /** Let a held marble go: tunnels pop it out of the exit hole with the set speed. */
  private releaseHold(m: Marble) {
    const hold = m.hold;
    m.hold = null;
    if (!hold || hold.kind !== 'tunnel' || !hold.exit) return;
    const exit = hold.exit;
    m.body.isSensor = false;
    Body.setPosition(m.body, { x: exit.x, y: exit.y });
    Body.setVelocity(m.body, { x: exit.dir.x * exit.speed, y: exit.dir.y * exit.speed });
    Body.setAngularVelocity(m.body, 0);
    m.tunnelSafeUntil = this.time + 900;
    m.motionAnchor = { ...m.body.position };
    m.motionAt = m.depthAt = this.time;
    m.deepestY = m.body.position.y;
    this.sfx('rumble', m, exit.x, exit.y);
    this.effects.push({ type: 'snow', x: exit.x, y: exit.y, ttl: 26, maxTtl: 26, color: '#b8a88f', particles: this.makeParticles(exit.x, exit.y, 8, 2.5) });
  }

  /**
   * Age the effects (and the screen shake) by `dt` ms. `step` calls this; a
   * GUEST calls it from its own loop, because it never steps physics but still
   * has to retire the rings and sparks it drew from the host's `events`.
   */
  ageEffects(dt: number): void {
    const s = dt / TICK;
    // MB-10: kinematic movers read the race clock and stateful pieces ease toward their synced
    // state here — the one hook host (via step) and guest (via its own loop) both run, so every
    // screen draws identical element poses without any per-frame wire traffic.
    updateElements(this.track, this.time, dt);
    for (const e of this.effects) {
      e.ttl -= s;
      if (e.particles)
        for (const p of e.particles) {
          p.x += p.vx * s;
          p.y += p.vy * s;
          p.vy += 0.15 * s;
        }
    }
    this.effects = this.effects.filter((e) => e.ttl > 0);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - s);
  }

  private updateRecovery(m: Marble, dt: number) {
    if (!this.recoveryEnabled || m.finishedAt !== null) return;
    // Deliberate item penalties pause the watchdog; recovery must not cancel a freeze or oil hit.
    if (m.frozen || m.inOil) {
      m.motionAt += dt;
      m.depthAt += dt;
      return;
    }
    const p = m.body.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -MARBLE_RADIUS || p.x > W + MARBLE_RADIUS || p.y < -60) {
      this.recoverMarble(m);
      return;
    }
    if (Math.hypot(p.x - m.motionAnchor.x, p.y - m.motionAnchor.y) > 26) {
      m.motionAnchor = { ...p };
      m.motionAt = this.time;
    }
    if (p.y > m.deepestY + 16) {
      m.deepestY = p.y;
      m.depthAt = this.time;
    }
    const stalled = this.time - m.motionAt;
    const noDescent = this.time - m.depthAt;
    m.stuckTime = Math.max(stalled, noDescent);
    if (this.time - m.lastRecoveryAt < 1800) return;

    if (stalled > 4700 || noDescent > 8500) {
      this.recoverMarble(m);
    } else if (stalled > 1300) {
      const surface = this.supports.get(m.info.id);
      const direction = surface ? downhill(surface).x : p.x < W / 2 ? 1 : -1;
      const v = Body.getVelocity(m.body);
      Body.setVelocity(m.body, { x: direction * (3.2 + (m.info.id % 3) * 0.4), y: Math.min(v.y, -2.8) });
      m.lastRecoveryAt = this.time;
      m.nudges++;
    }
  }

  private recoverMarble(m: Marble) {
    const p = m.body.position;
    const origin = {
      x: Number.isFinite(p.x) ? Math.max(35, Math.min(W - 35, p.x)) : W / 2,
      y: Number.isFinite(p.y) ? Math.max(this.track.startY, p.y) : m.deepestY,
    };
    const blockers = [...this.track.bodies.filter((body) => !meta(body).destroyed), ...this.marbles.map((marble) => marble.body)].filter((body) => body !== m.body && !body.isSensor);
    const probe = Bodies.circle(0, 0, MARBLE_RADIUS + 4);
    const direction = origin.x < W / 2 ? 1 : -1;
    let destination: Matter.Vector | undefined;
    // Move just below the local obstruction, never to the next checkpoint or past the finish.
    for (const dy of [60, 100, 140, 190, 240, 290]) {
      for (const dx of [0, 42, -42, 84, -84, 140, -140, 220, -220, 320, -320]) {
        const point = {
          x: Math.max(32, Math.min(W - 32, origin.x + dx * direction)),
          y: Math.min(this.track.finishY - 45, origin.y + dy),
        };
        Body.setPosition(probe, point);
        if (!Query.collides(probe, blockers).length) {
          destination = point;
          break;
        }
      }
      if (destination) break;
    }
    if (!destination) {
      m.lastRecoveryAt = this.time;
      return;
    }
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || m.body.vertices.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y))) {
      Composite.remove(this.world, m.body);
      m.body = createMarble(m.info, destination);
      if (m.anvilUntil > this.time) Body.setDensity(m.body, m.baseDensity * 3);
      Composite.add(this.world, m.body);
    } else Body.setPosition(m.body, destination);
    m.loopStage = 0;
    this.applyMask(m);
    Body.setVelocity(m.body, { x: 0, y: 1 });
    Body.setAngularVelocity(m.body, 0);
    m.trail = [];
    m.motionAnchor = { ...destination };
    m.motionAt = m.depthAt = m.lastRecoveryAt = this.time;
    m.deepestY = destination.y;
    m.recoveryUntil = this.time + 1600;
    m.recoveries++;
    this.effects.push({ type: 'ring', ...destination, ttl: 30, maxTtl: 30, color: '#d63e2e' });
    if (m.info.isPlayer) this.onEvent?.('Race marshal: back on track', '#d63e2e');
    this.onRecover?.(m.info.id, { x: origin.x, y: origin.y });
  }

  makeParticles(x: number, y: number, n: number, sp: number) {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const s = sp * (0.4 + this.rng());
      arr.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, s: 2 + this.rng() * 3 });
    }
    return arr;
  }

  setFrozen(m: Marble, on: boolean) {
    if (m.frozen === on) return;
    m.frozen = on;
    if (on) {
      Body.setVelocity(m.body, { x: 0, y: 0 });
      Body.setAngularVelocity(m.body, 0);
      Body.setStatic(m.body, true);
    } else {
      Body.setStatic(m.body, false);
      // setStatic restores original mass; re-apply current density (anvil may be active)
      Body.setDensity(m.body, this.time < m.anvilUntil ? m.baseDensity * 3 : m.baseDensity);
      m.body.friction = this.time < m.aeroUntil ? 0 : 0.004;
      m.frozenUntil = 0;
    }
  }

  // ---------- items ----------
  grantItem(m: Marble, item: ItemType): boolean {
    if (m.inventory[item] >= MAX_ITEM_STACK) {
      if (m.info.isPlayer) this.onEvent?.(`${ITEM_INFO[item].name} storage full (${MAX_ITEM_STACK})`, '#a4b7c8');
      return false;
    }
    m.inventory[item]++;
    m.lastPickupAt = this.time;
    m.aiUseAt = this.time + 800 + this.rng() * 1800;
    if (m.info.isPlayer) {
      this.onInventoryChange?.({ ...m.inventory });
      this.onEvent?.(`+1 ${ITEM_INFO[item].name} / added to your loadout`, ITEM_INFO[item].color);
    }
    return true;
  }

  itemRemaining(m: Marble, item: ItemType): number {
    const end = { rocket: m.rocketUntil, jump: m.jumpUntil, aero: m.aeroUntil, anvil: m.anvilUntil, ghost: m.ghostUntil, oil: 0, shock: 0, freeze: 0 }[item];
    return Math.max(0, end - this.time);
  }

  availableItem(m: Marble = this.player): ItemType | undefined {
    return ITEM_TYPES.find((item) => m.inventory[item] > 0 && this.itemRemaining(m, item) === 0);
  }

  canUseItem(m: Marble, item: ItemType): boolean {
    return this.gateOpen && !m.frozen && m.finishedAt === null && m.inventory[item] > 0 && this.time >= m.itemCooldownUntil && this.itemRemaining(m, item) === 0;
  }

  speedLimit(m: Marble): number {
    return Math.min(32, m.maxSpeed + (this.time < m.rocketUntil ? 8 : 0) + (this.time < m.anvilUntil ? 4 : 0) + (this.time < m.aeroUntil ? 3 : 0));
  }

  usePlayerItem(item = this.availableItem()): boolean {
    return item ? this.useItem(this.player, item) : false;
  }

  useItem(m: Marble, item = this.availableItem(m)): boolean {
    if (!item || !this.canUseItem(m, item)) return false;
    const p = m.body.position;
    const freezeCandidates = item === 'freeze' ? this.marbles
      .filter((rival) => rival !== m && rival.finishedAt === null && !rival.frozen && rival.body.position.y > p.y - 20 && Math.hypot(rival.body.position.x - p.x, rival.body.position.y - p.y) < 900)
      : [];
    // STORY HOOK (ST-07): when a chapter gives this marble a target, its freeze goes for that rival first.
    const storyFreeze = this.story && item === 'freeze' ? this.storyTarget(m) : undefined;
    const freezeTarget = (storyFreeze && freezeCandidates.includes(storyFreeze) ? storyFreeze : undefined)
      ?? freezeCandidates
        .sort((a, b) => Math.hypot(a.body.position.x - p.x, a.body.position.y - p.y) - Math.hypot(b.body.position.x - p.x, b.body.position.y - p.y))[0];
    if (item === 'freeze' && !freezeTarget) {
      if (m.info.isPlayer) this.onEvent?.('No rival in range / freeze charge kept', '#7dd3fc');
      else m.aiUseAt = this.time + 1500;
      return false;
    }
    if (!this.unlimitedItems.has(item)) m.inventory[item]--;
    m.itemCooldownUntil = this.time + 450;
    this.sfx('item', m, p.x, p.y);
    this.emit({ kind: 'item', seat: m.info.id, item });
    switch (item) {
      case 'oil': {
        const slick = { x: p.x, y: p.y - 10, r: 48, ownerId: m.info.id, expiresAt: this.time + 9000 };
        this.oils.push(slick);
        this.emit({ kind: 'oil', x: slick.x, y: slick.y, r: slick.r, seat: m.info.id, until: slick.expiresAt });
        break;
      }
      case 'freeze': {
        const target = freezeTarget;
        if (target) {
          target.frozenUntil = this.time + 2500;
          this.setFrozen(target, true);
          this.effects.push({ type: 'beam', x: p.x, y: p.y, x2: target.body.position.x, y2: target.body.position.y, ttl: 20, maxTtl: 20, color: '#7dd3fc' });
          this.effects.push({ type: 'snow', x: target.body.position.x, y: target.body.position.y, ttl: 40, maxTtl: 40, color: '#bae6fd', particles: this.makeParticles(target.body.position.x, target.body.position.y, 12, 2) });
          this.emit({ kind: 'freeze', seat: target.info.id, by: m.info.id, until: target.frozenUntil });
          if (target.info.isPlayer) this.onEvent?.(`${m.info.name} froze you!`, '#7dd3fc');
          if (m.info.isPlayer) this.onEvent?.(`Froze ${target.info.name}!`, '#7dd3fc');
        }
        break;
      }
      case 'rocket': {
        m.rocketUntil = this.time + ITEM_INFO.rocket.duration;
        break;
      }
      case 'jump': {
        const v = Body.getVelocity(m.body);
        Body.setVelocity(m.body, { x: v.x, y: -11.5 - m.info.stats.bounce * 0.12 });
        m.jumpUntil = this.time + ITEM_INFO.jump.duration;
        this.effects.push({ type: 'ring', x: p.x, y: p.y + MARBLE_RADIUS, ttl: 22, maxTtl: 22, color: ITEM_INFO.jump.color });
        break;
      }
      case 'aero': {
        m.aeroUntil = this.time + ITEM_INFO.aero.duration;
        m.body.frictionAir = m.frictionAir * 0.05;
        m.body.friction = 0;
        this.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 24, maxTtl: 24, color: ITEM_INFO.aero.color });
        break;
      }
      case 'shock': {
        this.shake = 8;
        this.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 30, maxTtl: 30, color: '#facc15' });
        this.emit({ kind: 'shock', seat: m.info.id, x: p.x, y: p.y });
        for (const o of this.marbles) {
          if (o === m || o.finishedAt !== null) continue;
          const dx = o.body.position.x - p.x;
          const dy = o.body.position.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 240 && d > 0.01) {
            this.setFrozen(o, false);
            const k = 11 * (1 - d / 240) / Math.sqrt(o.body.mass / 0.8);
            const v = Body.getVelocity(o.body);
            Body.setVelocity(o.body, { x: v.x + (dx / d) * k, y: v.y + (dy / d) * k - 2 });
          }
        }
        break;
      }
      case 'anvil': {
        m.anvilUntil = this.time + ITEM_INFO.anvil.duration;
        if (!m.frozen) Body.setDensity(m.body, m.baseDensity * 3);
        this.effects.push({ type: 'ring', x: p.x, y: p.y, ttl: 20, maxTtl: 20, color: '#cbd5e1' });
        break;
      }
      case 'ghost': {
        m.ghostUntil = this.time + ITEM_INFO.ghost.duration;
        this.applyMask(m);
        break;
      }
    }
    if (m.info.isPlayer) {
      this.onInventoryChange?.({ ...m.inventory });
      if (item !== 'freeze') this.onEvent?.(`${ITEM_INFO[item].name} deployed`, ITEM_INFO[item].color);
    }
    return true;
  }

  // ---------- STORY HOOKS (ST-07) ----------
  // Additive only. Nothing here runs unless `GameOptions.story` was supplied, so a race without story hooks
  // simulates exactly as it did before: no RNG is consumed, no body is touched, no ordering changes.

  /** Which sector (track segment) a marble is in — the same lookup the race HUD uses. */
  private sectorOf(m: Marble): number {
    const y = m.body.position.y;
    const segments = this.track.segments;
    for (let i = 0; i < segments.length; i++) if (y >= segments[i].y && y < segments[i].y + segments[i].h) return i;
    return y < (segments[0]?.y ?? 0) ? 0 : Math.max(0, segments.length - 1);
  }

  /** Report a counted event (crate, orange peg, hoop, loop, bucket, pad, item box, overtake) to the hooks. */
  private storyCounter(counter: RaceCounter, m: Marble, rivalId?: number) {
    const hooks = this.story;
    if (!hooks?.onCounter) return;
    hooks.onCounter({
      counter, marbleId: m.info.id, player: m.info.isPlayer, sectorIndex: this.sectorOf(m),
      ...(rivalId === undefined ? {} : { rivalId }),
    });
  }

  /** Per-step story pass: sector entry, then overtakes of the player. */
  private storyStep() {
    const hooks = this.story!;
    for (const m of this.marbles) {
      if (m.finishedAt !== null) continue;
      const index = this.sectorOf(m);
      const previous = this.storySectors.get(m.info.id);
      this.storySectors.set(m.info.id, index);
      if (previous !== undefined && previous !== index) hooks.onSector?.(this, m, index);
    }
    if (!hooks.onCounter) return;
    const order = this.marbles.filter((m) => m.finishedAt === null)
      .map((m) => m.info.id)
      .sort((a, b) => this.byId.get(b)!.body.position.y - this.byId.get(a)!.body.position.y);
    const previousOrder = this.storyOrder;
    this.storyOrder = order;
    if (!previousOrder.length) return;
    const playerId = this.player.info.id;
    const now = order.indexOf(playerId);
    const before = previousOrder.indexOf(playerId);
    if (now < 0 || before < 0) return;
    for (const rivalId of order) {
      if (rivalId === playerId) continue;
      const wasAhead = previousOrder.indexOf(rivalId);
      const isBehind = order.indexOf(rivalId);
      if (wasAhead >= 0 && wasAhead < before && isBehind > now) this.storyCounter('overtakes', this.player, rivalId);
    }
  }

  /** The marble a rival's items should prefer, if this chapter says so. */
  private storyTarget(m: Marble): Marble | undefined {
    const id = this.story?.aiTarget?.(this, m);
    if (id === null || id === undefined) return undefined;
    const target = this.byId.get(id);
    return target && target !== m && target.finishedAt === null ? target : undefined;
  }

  // ---------- main step ----------
  /** Advance the simulation by one fixed sub-step (dt in ms). */
  step(dt: number) {
    const s = dt / TICK; // fraction of a 60fps tick
    this.time += dt;
    if (!this.gateOpen) return;
    this.syncTrack();
    this.elementState(dt); // MB-10: host-authoritative stateful elements

    // item boxes respawn
    for (const box of this.track.itemBoxes) {
      const md = meta(box);
      if (!md.active && this.time >= (md.respawnAt ?? 0)) {
        md.active = true;
        this.emit({ kind: 'box', i: this.indexOf(box), taken: false });
      }
    }
    // spinners
    for (const sp of this.track.spinners) {
      const md = meta(sp);
      (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(sp, sp.angle + (md.spin ?? 0) * s, true);
    }
    // wrecking balls swing on their chains (kinematic, so collisions see their velocity)
    for (const wb of this.track.wreckers) {
      const md = meta(wb);
      const angle = (md.amp ?? 0) * Math.sin(this.time * (md.spin ?? 0) + (md.phase ?? 0));
      (Body.setPosition as unknown as (b: Matter.Body, p: Matter.Vector, u: boolean) => void)(wb, { x: md.pivot!.x + Math.sin(angle) * md.chain!, y: md.pivot!.y + Math.cos(angle) * md.chain! }, true);
    }
    // oil expiry
    this.oils = this.oils.filter((o) => o.expiresAt > this.time);

    // Peggle buckets sweep side to side
    for (const bk of this.track.buckets) {
      const md = meta(bk);
      const x = W / 2 + Math.sin(this.time * 0.0011 + (md.phase ?? 0)) * (W / 2 - 90);
      Body.setPosition(bk, { x, y: md.baseY ?? bk.position.y });
    }
    // hit pegs pop away after a short glow
    for (const body of this.poppingPegs) {
      const md = meta(body);
      if (this.time > (md.hitAt ?? 0) + PEG_POP_MS) {
        this.removeTrackBody(body);
        this.poppingPegs.delete(body);
        this.effects.push({ type: 'ring', x: body.position.x, y: body.position.y, ttl: 10, maxTtl: 10, color: 'rgba(255,255,255,0.6)' });
      }
    }

    for (const m of this.marbles) {
      const b = m.body;
      m.grounded += s;
      if (m.finishedAt !== null) continue;

      // MB-10: a marble hidden inside an element glides from capture to exit — hidden from every
      // screen (draw + minimap skip it), but the wire positions stay continuous so nobody watches
      // a teleport. At the end of the ride it's released at the exit with the set velocity.
      if (m.hold) {
        if (this.time >= m.hold.until) {
          this.releaseHold(m);
        } else {
          const transit = m.hold.transit ?? 900;
          const from = m.hold.from ?? m.body.position;
          const exit = m.hold.exit;
          if (exit) {
            const k = Math.max(0, Math.min(1, (this.time - (m.hold.until - transit)) / transit));
            // ease in-out so the ride reads as a dive-in, coast, pop-out
            const e = k * k * (3 - 2 * k);
            Body.setPosition(m.body, { x: from.x + (exit.x - from.x) * e, y: from.y + (exit.y - from.y) * e });
          }
          continue;
        }
      }

      // timers
      if (m.aeroUntil && this.time >= m.aeroUntil) {
        m.aeroUntil = 0;
        b.frictionAir = m.frictionAir;
        if (!m.frozen) b.friction = 0.004;
      }
      if (m.anvilUntil && this.time > m.anvilUntil) {
        m.anvilUntil = 0;
        if (!m.frozen) Body.setDensity(b, m.baseDensity);
      }
      if (m.ghostUntil && this.time > m.ghostUntil) {
        m.ghostUntil = 0;
        this.applyMask(m);
      }

      if (m.frozen) {
        if (this.time >= m.frozenUntil) this.setFrozen(m, false);
        else {
          this.updateRecovery(m, dt);
          continue;
        }
      }

      if (!this.gateOpen) continue;

      let v = Body.getVelocity(b);

      // rocket
      if (this.time < m.rocketUntil) {
        const sp = Math.hypot(v.x, v.y);
        const dx = sp > 1 ? v.x / sp : 0;
        const dy = sp > 1 ? v.y / sp : 1;
        const k = 0.6 * s * Math.sqrt(0.8 / b.mass);
        v = { x: v.x + dx * k * 0.6, y: v.y + Math.max(dy, 0.3) * k };
        if (this.rng() < 0.5)
          this.effects.push({ type: 'debris', x: b.position.x, y: b.position.y, ttl: 16, maxTtl: 16, color: '#fb923c', particles: this.makeParticles(b.position.x, b.position.y, 2, 2) });
      }

      // oil
      m.inOil = false;
      for (const o of this.oils) {
        if (o.ownerId === m.info.id) continue;
        if (Math.hypot(o.x - b.position.x, o.y - b.position.y) < o.r + MARBLE_RADIUS) {
          m.inOil = true;
          v = { x: v.x * (1 - 0.07 * s) + (this.rng() - 0.5) * 0.4, y: v.y * (1 - 0.05 * s) };
          Body.setAngularVelocity(b, b.angularVelocity * 1.05 + (this.rng() - 0.5) * 0.1);
          break;
        }
      }

      // MP-04: input is per-seat now. The local player drives `nudge` (it never
      // crosses a wire); any other human seat is a guest whose intents the host
      // has already applied to `humanInput`.
      const input = this.humanInput.get(m.info.id)?.nudge ?? (m === this.player ? this.nudge : 0);
      if (input !== 0 && (Math.abs(v.x) < 9 || Math.sign(v.x) !== Math.sign(input))) v = { x: v.x + input * 0.16 * s, y: v.y };

      // speed cap
      const cap = this.speedLimit(m);
      const sp = Math.hypot(v.x, v.y);
      if (sp > cap) v = { x: (v.x / sp) * cap, y: (v.y / sp) * cap };
      Body.setVelocity(b, v);

      // trail
      if (m.info.isPlayer || this.time < m.rocketUntil) {
        m.trail.push({ x: b.position.x, y: b.position.y });
        if (m.trail.length > 14) m.trail.shift();
      }

      // AI item usage
      const item = this.availableItem(m);
      if (this.aiItemsEnabled && !this.isHuman(m) && item && this.time > m.aiUseAt) {
        // STORY HOOK (ST-07): a chapter may give this rival a preferred target. Unset: today's AI, unchanged.
        const hunted = this.story ? this.storyTarget(m) : undefined;
        const shockRange = hunted ? 260 : 200;
        // simple smarts: don't waste freeze if nobody ahead, save shock if nobody near
        if (item === 'freeze' && !this.marbles.some((o) => o !== m && o.finishedAt === null && o.body.position.y > b.position.y - 20 && Math.abs(o.body.position.y - b.position.y) < 900)) {
          m.aiUseAt = this.time + 1500;
        } else if (item === 'shock' && !this.marbles.some((o) => o !== m && Math.hypot(o.body.position.x - b.position.x, o.body.position.y - b.position.y) < shockRange)) {
          m.aiUseAt = this.time + 700;
        } else this.useItem(m);
      }
    }

    this.ageEffects(dt);

    this.supports.clear();
    Engine.update(this.engine, dt);

    for (const m of this.marbles) {
      if (m.finishedAt !== null) {
        this.park(m);
        continue;
      }
      if (m.frozen) continue;
      if (m.hold) continue; // MB-10: hidden in an element — no assist, no finish, no marshal
      const surface = this.supports.get(m.info.id);
      if (surface && !m.inOil && assistRolling(m.body, surface, m.info.stats.speed + (this.time < m.aeroUntil ? 3 : 0), dt)) m.grounded = 0;
      const launch = this.pendingLaunches.get(m.info.id);
      if (launch) Body.setVelocity(m.body, launch);
      const cap = this.speedLimit(m);
      if (Body.getSpeed(m.body) > cap) Body.setSpeed(m.body, cap);
      if (m.body.position.y >= this.track.finishY && m.body.position.x >= 0 && m.body.position.x <= W) this.finishMarble(m);
      this.updateRecovery(m, dt);
    }
    this.pendingLaunches.clear();
    if (this.story) this.storyStep(); // STORY HOOK (ST-07)
    if (!this.effectsEnabled) this.effects = [];

    // apply deferred wall breaks after the solver ran
    if (this.pendingBreaks.length) {
      for (const pb of this.pendingBreaks) {
        this.removeTrackBody(pb.body);
        Body.setVelocity(pb.marble.body, pb.v);
      }
      this.pendingBreaks = [];
    }
  }

  ranking(): RankEntry[] {
    const finished = [...this.finishOrder];
    const rest = this.marbles.filter((m) => m.finishedAt === null).sort((a, b) => b.body.position.y - a.body.position.y);
    return [...finished, ...rest].map((m, i) => ({ marble: m, rank: i + 1, finished: m.finishedAt !== null, time: m.finishedAt }));
  }

  /** Force-classify anyone still on track (used when the heat timer expires). */
  classify(): RankEntry[] {
    return this.ranking();
  }

  raceTime(): number {
    return this.gateOpen ? this.time - this.raceStartTime : 0;
  }

  playerRank(): number {
    return this.ranking().find((r) => r.marble === this.player)!.rank;
  }

  allFinished(): boolean {
    return this.marbles.every((m) => m.finishedAt !== null);
  }

  /** MB-10A: an element's eased 0..1 pose (trapdoor swing, switch plate) for skins and previews. */
  public ewma(b: Matter.Body): number {
    const md = meta(b);
    if (!md) return 0;
    if (md.kind === 'trapdoor') {
      if (md.mode === 'weight') return md.eased ?? 0;
      if (md.motion && md.motion.mode === 'hinge') {
        const st = hingeTimerState(md.motion, this.time);
        return md.motion.openAngle !== 0 ? Math.min(1, Math.abs(st.angle / md.motion.openAngle)) : (st.angle !== 0 ? 1 : 0);
      }
      return 0;
    }
    if (md.kind === 'switch') {
      const target = (md.side === 1 ? 1 : -1) * (md.swingAngle ?? 0.6);
      return target !== 0 ? Math.min(1, Math.abs(b.angle / target)) : 0;
    }
    return 0;
  }

  destroy() {
    Events.off(this.engine, 'collisionStart');
    Events.off(this.engine, 'collisionActive');
    Composite.clear(this.world, false);
    Engine.clear(this.engine);
  }
}
