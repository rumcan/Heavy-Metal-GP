import Matter from 'matter-js';
import { generateTrack, meta, Track, CAT_MARBLE, CAT_WALL, CAT_SENSOR, CAT_LOOP_UP, CAT_LOOP_CLOSE, CAT_FRAGILE, CAT_DANGER, W, bridgePlankPose, cannonAim, catapultAngle } from './track';
import { elementBodies, updateElements, hingeTimerState } from './elements';
import { TrackDefError, buildTrackFromDef } from './trackdef';
import { ItemType, MarbleInfo, MARBLE_RADIUS, statsToPhysics, mulberry32, TrackProfile, normalizeInventory, ITEM_TYPES, MAX_ITEM_STACK } from './types';
import type { Inventory } from './types';
import { gridSlots } from './grid';
import { assistRolling, createMarble } from './physics';
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
  /** P2-10: the skills an item box may drop for this race (the local driver's loadout). Unset: the old pools. */
  dropPool?: ItemType[];
  /** P2-17: the local driver's talent build, and their eight slots (for the extra first-offence charge). */
  talents?: Record<string, number>;
  slots?: (ItemType | null)[];
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

export const { Engine, Bodies, Body, Composite, Events, Query } = Matter;

export const ITEM_POOL = ITEM_TYPES;
export const TICK = 1000 / 60;

/**
 * MB-10B: how long a kinematic machine may hold the stuck watchdog for one marble, in ms.
 *
 * A marble resting on a moving platform, waiting out a trapdoor or riding a belt is not
 * stuck, so contact with a machine holds the watchdog — but a marble a crusher has pinned
 * against the deck is stalling, not travelling, and a hold with no end is a marble that
 * never finishes. One beat of the slowest machine (a crusher's default period is 4.2 s) is
 * the longest a machine legitimately needs; after that the normal watchdog owns the marble
 * and the marshal frees it.
 */
export const MACHINE_HOLD_MS = 5000;

/** P2-01: one human seat's hands, as the host sees them. */
export interface HumanInput { nudge: number; engine?: boolean; jump?: boolean }

export interface Marble {
  /** P2-01: Magic Engine heat and core-jump timing (humans only). */
  engine?: EngineState;
  jumpState?: JumpState;
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
  /** MB-10E: last clock a magnet latched this marble, for the zap cue and a grab cooldown. */
  magnetGrabAt?: number;
  /** MB-10E: last clock the mud squelched for this marble (cue debounce). */
  mudSquelchAt?: number;
  /** MB-10F: per-marble trampoline cooldown so the spring fires once per landing. */
  trampAt?: number;
  /** MB-10F: last clock the vortex funnel whooshed this marble through the centre hole. */
  vortexDropAt?: number;
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
  /** MB-10B: pinned under a crusher plate until this clock time (velocity squashed while pinned). */
  crushedUntil: number;
  /** Debounce so one crusher docking registers one pin per marble. */
  crushMarkAt: number;
  /** Number of times this marble has been crushed. */
  crushCount: number;
  /**
   * MB-10B: how much "the machine is dealing with it" credit this marble has left, in ms.
   * Resting against a kinematic machine holds the stuck watchdog; the credit is what stops
   * that hold from becoming a permanent amnesty for a marble a crusher has pinned. Only new
   * depth refills it: the race is a descent, and a machine that carries a marble down and
   * back up again has got it nowhere.
   */
  machineHeld: number;
  /** MB-10D: per-marble slingshot cooldown so a resting marble isn't machine-gunned. */
  slingAt?: number;
  /** MB-10D: last flipper kick clock, so one swing delivers one swat per marble. */
  flipperKickAt?: number;
  /** P2-00 platformer: depth lane (0 back, 1 middle, 2 front), the lane it came from and when it switched. */
  lane?: number;
  laneFrom?: number;
  laneAt?: number;
  /** P2-00 platformer: distance along the course path, and the best so far (the stall watchdog). */
  progress?: number;
  bestProgress?: number;
  /** P2-00 platformer AI: the last door it decided about, and its jump cooldown. */
  doorSeen?: number;
  aiJumpAt?: number;
  /** P2-00 platformer: the last spring launch (one launch per landing). */
  springAt?: number;
  /** P2-00 platformer: the start cannon this marble is loaded in (fired = out on the course). */
  cannon?: platformer.Cannon;
  /** P2-17: this driver's talent effects (stat -> total), and max HP. Computers have none. */
  tfx?: Record<string, number>;
  maxHp?: number;
  /** P2-16: when a computer driver last used a skill (the brain's pause between skills). */
  aiSkillAt?: number;
  /** P2-08: skill timers and state (shield, ram, hover, charm, EMP...), and two debounce clocks. */
  fx?: SkillFx;
  spikedAt?: number;
  ramHitAt?: number;
  /** P2-07: health (platformer races, offline for now), knocked out of the race, and KOs scored. */
  health?: Health;
  dnf?: boolean;
  kos?: number;
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
  kind: 'tunnel' | 'wheel' | 'screw' | 'cannon' | 'catapult' | 'loop';
  until: number;
  /** Clocked at `until - transit`; the glide runs from then on. Host-only on the wire. */
  transit?: number;
  from?: { x: number; y: number };
  body?: Matter.Body;
  exit?: { x: number; y: number; dir: { x: number; y: number }; speed: number };
  /** MB-10C wheel ride: capture clock and the arc the bucket glides along (centre, radius, start angle, omega, release angle). */
  at?: number;
  arc?: { x: number; y: number; r: number; fromA: number; omega: number; release: number };
  /** MB-10C screw lift: a light marble slips back mid-ride — the glide wobbles (host-side seeded). */
  slip?: number;
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
  /** P2-07: knocked out (0 HP). */
  dnf: boolean;
}

import * as hits from './engine/hits';
import * as machines from './engine/machines';
import * as holds from './engine/holds';
import * as recovery from './engine/recovery';
import * as items from './engine/items';
import * as story_hooks from './engine/story-hooks';
import * as input from './engine/input';
import type { EngineState, JumpState } from './controls';
import * as ai from './engine/ai';
import * as platformer from './engine/platformer';
import { applyDamage, newHealth, regen, koCredit, KO_BOUNTY, REGEN_PER_SEC, REGEN_DELAY_MS } from './health';
import { talentEffects } from './talents';
import { SKILLS } from './skills/catalog';
import type { DamageKind, Health } from './health';
import * as skillfx from './skills/effects';
import type { SkillFx, Projectile, Bomb, SpikePatch, Decoy } from './skills/effects';

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
  humanInput = new Map<number, HumanInput>();
  finishOrder: Marble[] = [];
  nudge = 0;
  /** P2-01: the local driver holds the Magic Engine key. */
  engineHeld = false;
  /** P2-01: the local driver pressed jump since the last step (consumed by the step). */
  jumpPressed = false;
  rng: () => number;
  shake = 0;
  raceStartTime = 0;
  byId = new Map<number, Marble>();
  supports = new Map<number, RampSurface>();
  recoveryEnabled: boolean;
  effectsEnabled: boolean;
  aiItemsEnabled: boolean;
  onRecover?: (marbleId: number, pos: { x: number; y: number }) => void;
  /** MB-10C: memoized rope-bridge plank chains (host integrates; guests blend). */
  bridgeCache?: Matter.Body[][];
  /** STORY HOOKS (ST-07). Undefined in every non-story race. */
  story?: StoryHooks;
  storySectors = new Map<number, number>();
  storyOrder: number[] = [];
  pendingLaunches = new Map<number, Matter.Vector>();
  lastWallToast = -9999;
  pendingBreaks: { body: Matter.Body; marble: Marble; v: { x: number; y: number } }[] = [];
  onEvent?: (msg: string, color?: string) => void;
  onInventoryChange?: (inventory: Inventory) => void;
  /** MP-04: wire events queued since the last `drainRaceEvents`. */
  raceEvents: RaceEvent[] = [];
  /** Body → its index in `track.bodies`: the stable reference the wire speaks. */
  bodyIndex = new Map<Matter.Body, number>();
  /** Indices of destroyed track bodies, for the join/resync snapshot. */
  destroyed = new Set<number>();
  wireEvents: boolean;
  /** Why `GameOptions.def` was refused, in the player's words, or null when there was nothing to refuse. */
  trackDefError: string | null = null;
  poppingPegs = new Set<Matter.Body>();
  /** MB-10A: per-marble tunnel-entry counts, so up-exits can't make an infinite loop (cap per hole). */
  tunnelVisits = new Map<number, Map<number, number>>();
  staticBins = new Map<number, Matter.Body[]>();
  /** MB-10B: every body the track moves itself (platforms, crushers, blades, belts …). */
  machines: Matter.Body[] = [];
  globalBodies: Matter.Body[] = [];
  loadedBodies = new Map<number, Matter.Body>();
  loadedCells = '';
  streaming = false;

  /**
   * P2-07: health, damage and DNF. On for platformer races played on this machine alone; classic drops keep their
   * old rules (and their determinism), and online races wait for health on the wire.
   */
  healthOn = false;
  /** P2-10: what an item box may drop (the loadout), or undefined for the original pools. */
  dropPool?: ItemType[];
  /** P2-08: homing bolts in flight, sticky bombs, spike patches and decoys (host-side state). */
  projectiles: Projectile[] = [];
  bombs: Bomb[] = [];
  spikes: SpikePatch[] = [];
  decoys: Decoy[] = [];
  nextProjectileId = 1;

  /** Items that never run out this race (online house rules). */
  readonly unlimitedItems: Set<ItemType>;
  /** Seats that are not racing (online, taken off the grid by the host). */
  readonly benched = new Set<number>();

  byIdOrNull(id: number): Marble | null {
    return this.marbles.find((m) => m.info.id === id) ?? null;
  }

  constructor(seed: number, roster: MarbleInfo[], opts: GameOptions = {}) {
    this.unlimitedItems = new Set(opts.unlimitedItems ?? []);
    this.dropPool = opts.dropPool && opts.dropPool.length ? [...opts.dropPool] : undefined;
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
    this.healthOn = !!this.track.platformer && !this.wireEvents;
    // The wire names track bodies by their index in `track.bodies`. Both sides
    // build the identical circuit from the seed, so an index IS the body — and
    // an index either end can check against `track.bodies.length`.
    this.bodyIndex = new Map(this.track.bodies.map((body, i) => [body, i]));
    // MB-10B: the bodies the race clock drives. Collected once — the watchdog asks about them
    // every frame for every marble, and a scan of all 1 000-odd track bodies per marble per
    // frame costs more than the whole of Matter.
    this.machines = this.track.bodies.filter((body) => !!meta(body).motion);
    this.recoveryEnabled = opts.recovery !== false;
    this.effectsEnabled = opts.effects !== false;
    this.aiItemsEnabled = opts.aiItems !== false;
    this.onRecover = opts.onRecover;
    Composite.add(this.world, this.track.bodies);

    const order = opts.gridOrder && opts.gridOrder.length === roster.length ? opts.gridOrder : roster.map((r) => r.id);
    const slots = gridSlots(order);
    const cannonSpots = new Map<Marble, { x: number; y: number }>();
    roster.forEach((info) => {
      const ph = statsToPhysics(info.stats);
      const slot = slots.find((s) => s.id === info.id)!;
      // P2-00: a platformer grid lines up along the start floor, spread over the three lanes.
      const spot = this.track.platformer ? platformer.gridSpot(this, slot.slot) : null;
      const body = createMarble(info, spot ?? { x: slot.x, y: this.track.startY });
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
        crushedUntil: 0,
        crushMarkAt: 0,
        crushCount: 0,
        machineHeld: MACHINE_HOLD_MS,
      };
      if (spot) {
        m.lane = m.laneFrom = spot.lane;
        m.progress = m.bestProgress = 0;
        platformer.applyLaneMask(this, m);
      }
      // P2-00: platformer races start from a cannon each (loaded once every seat is known as human or AI).
      if (spot) cannonSpots.set(m, spot);
      this.marbles.push(m);
      this.byId.set(info.id, m);
    });
    this.marbles.sort((a, b) => a.info.id - b.info.id);
    if (this.healthOn) for (const m of this.marbles) { m.health = newHealth(); m.kos = 0; }
    // Guest seats are human from the moment they are seated, not from their
    // first intent: an idle guest must not be driven by the AI.
    for (const id of opts.humanSeats ?? []) if (!this.humanInput.has(id)) this.humanInput.set(id, { nudge: 0 });
    for (const [m, spot] of cannonSpots) platformer.loadCannon(this, m, spot);
    Composite.add(
      this.world,
      this.marbles.map((m) => m.body),
    );
    this.player = this.marbles.find((m) => m.info.isPlayer) ?? this.marbles[0];
    if (opts.talents && Object.keys(opts.talents).length) this.applyTalents(this.player, opts.talents, opts.slots ?? []);
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
  trackFor(seed: number, profile: TrackProfile | undefined, def: unknown): Track {
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
      lane: m.lane ?? 1,
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

  syncTrack() {
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

  removeTrackBody(body: Matter.Body) {
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
    if (this.track.platformer) {
      platformer.armCannons(this);
      if (this.player.cannon && !this.player.cannon.fired) this.onEvent?.('FIRE! Space or ↑ (aim with ← →)', '#facc15');
    }
    this.marbles.forEach((m) => {
      if (!m.cannon || m.cannon.fired) Body.setVelocity(m.body, { x: 0, y: 0 });
      m.motionAt = m.depthAt = this.time;
      m.motionAnchor = { ...m.body.position };
      m.deepestY = m.body.position.y;
      m.machineHeld = MACHINE_HOLD_MS;
    });
  }

  onCollisionStart(e: Matter.IEventCollision<Matter.Engine>) {
    return hits.onCollisionStart(this, e);
  }

  sfx(type: SoundType, m: Marble | null, x: number, y: number, extra: Partial<SoundEvent> = {}) {
    if (this.sounds.length < 48) this.sounds.push({ type, x, y, player: !!m?.info.isPlayer, ...extra });
  }

  applyMask(m: Marble) {
    if (this.track.platformer) return platformer.applyLaneMask(this, m);
    const ghost = m.ghostUntil > this.time;
    // Ghost marbles phase through rivals (CAT_MARBLE), fragile barricades (CAT_FRAGILE, MB-10A) and
    m.body.collisionFilter.mask = CAT_WALL | CAT_SENSOR | (ghost ? 0 : CAT_MARBLE | CAT_FRAGILE | CAT_DANGER) | (m.loopStage === 1 ? CAT_LOOP_CLOSE : CAT_LOOP_UP);
  }

  setLoopStage(m: Marble, stage: 0 | 1) {
    if (m.loopStage === stage) return;
    m.loopStage = stage;
    this.applyMask(m);
  }

  marbleHits(m: Marble, other: Matter.Body) {
    return hits.marbleHits(this, m, other);
  }

  onCollisionActive(e: Matter.IEventCollision<Matter.Engine>) {
    return hits.onCollisionActive(this, e);
  }

  contactSurface(m: Marble, obstacle: Matter.Body, pair: Matter.Pair) {
    return hits.contactSurface(this, m, obstacle, pair);
  }

  /**
   * MB-10C. Seesaw and rope bridge: the two movers that aren't race-clock posed. Their state is
   * plain numbers in each body's meta — the host integrates here, streams it throttled, and a
   * guest that received a state event springs its copy toward it in `ageEffects` (it never runs
   * physics). The plank/chain bodies are static; posing them here keeps contacts deterministic.
   */
  moverDynamics(dt: number) {
    return machines.moverDynamics(this, dt);
  }

  /** MB-10C: the rope bridge chains of this track, each as contiguous plank bodies. */
  bridgeChains(): Matter.Body[][]  {
    return machines.bridgeChains(this);
  }

  finishMarble(m: Marble) {
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
    const plan = this.track.platformer?.plan;
    Body.setPosition(m.body, plan ? { x: plan.finishX + 200 + (m.info.id % 10) * 40, y: plan.finishY - MARBLE_RADIUS - 2 } : { x: 80 + (m.info.id % 10) * 80, y: this.track.finishY + 75 });
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
  elementState(dt: number) {
    return machines.elementState(this, dt);
  }

  /** MB-10D cannon loading, shared by the mouth sensor contact and the elementState catch-up scan. */
  tryLoadCannon(m: Marble, mouth: Matter.Body) {
    return holds.tryLoadCannon(this, m, mouth);
  }

  /** MB-10D catapult loading, shared by the spoon sensor and the catch-up scan. */
  tryLoadCatapult(m: Marble, spoon: Matter.Body) {
    return holds.tryLoadCatapult(this, m, spoon);
  }

  /** Let a held marble go: tunnels pop out of the exit hole, buckets tip at the release angle, screws hand off at the tube end. */
  releaseHold(m: Marble) {
    return holds.releaseHold(this, m);
  }

  /**
   * Age the effects (and the screen shake) by `dt` ms. `step` calls this; a
   * GUEST calls it from its own loop, because it never steps physics but still
   * has to retire the rings and sparks it drew from the host's `events`.
   */
  ageEffects(dt: number): void {
    const s = dt / TICK;
    // MB-10C guest-side mover blending: seats where the host streams dynamic state (seesaw
    // angle, bridge sags) converge toward it here. The host itself integrates in moverDynamics
    // inside step and never sets a remote target, so this is a no-op for it.
    for (const plank of elementBodies(this.track, 'seesaw')) {
      const ss = meta(plank).seesaw;
      if (!ss) continue;
      if (ss.remote) {
        const lead = Math.min(600, this.time - ss.remote.at);
        const targetA = ss.remote.angle + ss.remote.angVel * lead;
        ss.angle += (targetA - ss.angle) * Math.min(1, dt * 0.012);
        ss.angle = Math.max(ss.min, Math.min(ss.max, ss.angle));
        (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(plank, ss.angle, true);
      }
    }
    for (const chain of this.bridgeChains()) {
      const headMd = meta(chain[0]);
      if (!headMd.sagTarget || headMd.sagTarget.length !== chain.length) continue;
      const current = chain.map((b2) => meta(b2).sag ?? 0);
      const blended = current.map((v, i) => v + ((headMd.sagTarget![i] ?? 0) - v) * Math.min(1, dt * 0.008));
      chain.forEach((b2, i) => { meta(b2).sag = blended[i]; });
      for (let i = 0; i < chain.length; i++) {
        const plankB = chain[i];
        const mdp = meta(plankB);
        const br = mdp.bridge!;
        const pose = bridgePlankPose(br.anchor, br.slack, i, chain.length, blended);
        (Body.setPosition as unknown as (b: Matter.Body, p2: Matter.Vector, u: boolean) => void)(plankB, { x: pose.x, y: pose.y }, true);
        (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(plankB, pose.angle, true);
      }
    }
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

  updateRecovery(m: Marble, dt: number) {
    if (this.track.platformer) return platformer.platformRecovery(this, m, dt);
    return recovery.updateRecovery(this, m, dt);
  }

  /**
   * MB-10B: is this marble resting against (or boxed in by) a body the track moves itself?
   *
   * A bounds test over the machine list — the machines are the only bodies that can hold a
   * marble without it moving, and there are a few dozen of them against a thousand bodies.
   */
  machineUnder(m: Marble): boolean  {
    return recovery.machineUnder(this, m);
  }

  recoverMarble(m: Marble) {
    return recovery.recoverMarble(this, m);
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
  grantItem(m: Marble, item: ItemType): boolean  {
    return items.grantItem(this, m, item);
  }

  itemRemaining(m: Marble, item: ItemType): number  {
    return items.itemRemaining(this, m, item);
  }

  availableItem(m: Marble = this.player): ItemType | undefined  {
    return items.availableItem(this, m);
  }

  canUseItem(m: Marble, item: ItemType): boolean  {
    return items.canUseItem(this, m, item);
  }

  speedLimit(m: Marble): number  {
    return items.speedLimit(this, m);
  }

  usePlayerItem(item = this.availableItem()): boolean  {
    return items.usePlayerItem(this, item);
  }

  useItem(m: Marble, item = this.availableItem(m)): boolean  {
    return items.useItem(this, m, item);
  }

  // ---------- STORY HOOKS (ST-07) ----------
  // Additive only. Nothing here runs unless `GameOptions.story` was supplied, so a race without story hooks
  // simulates exactly as it did before: no RNG is consumed, no body is touched, no ordering changes.

  /** Which sector (track segment) a marble is in — the same lookup the race HUD uses. */
  sectorOf(m: Marble): number  {
    return story_hooks.sectorOf(this, m);
  }

  /** Report a counted event (crate, orange peg, hoop, loop, bucket, pad, item box, overtake) to the hooks. */
  storyCounter(counter: RaceCounter, m: Marble, rivalId?: number) {
    return story_hooks.storyCounter(this, counter, m, rivalId);
  }

  /** Per-step story pass: sector entry, then overtakes of the player. */
  storyStep() {
    return story_hooks.storyStep(this);
  }

  /** The marble a rival's items should prefer, if this chapter says so. */
  storyTarget(m: Marble): Marble | undefined  {
    return story_hooks.storyTarget(this, m);
  }

  // ---------- main step ----------
  /** Advance the simulation by one fixed sub-step (dt in ms). */
  step(dt: number) {
    const s = dt / TICK; // fraction of a 60fps tick
    this.time += dt;
    if (!this.gateOpen) {
      // P2-00: on the grid, the start cannons can already be aimed (they only fire once the lights are out).
      if (this.track.platformer) for (const m of this.marbles) if (m.cannon && !m.cannon.fired) platformer.cannonStep(this, m, s);
      return;
    }
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
    // turnstiles
    for (const ts of this.track.turnstiles) {
      const md = meta(ts).turnstile!;
      if (md.mode === 0) {
        // ratchet eases step by step
        const targetAngle = md.stepIndex * (Math.PI * 2 / md.arms);
        const diff = targetAngle - ts.angle;
        if (Math.abs(diff) > 0.001) {
          (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(ts, ts.angle + diff * 0.1 * s, true);
        }
      } else {
        // free spin
        const angle = ((this.time + md.phaseMs) / md.periodMs) * Math.PI * 2;
        (Body.setAngle as unknown as (b: Matter.Body, a: number, u: boolean) => void)(ts, angle, true);
      }
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
      if (m.finishedAt !== null || m.dnf) continue;
      if (m.health) m.health = this.regenOf(m, dt);

      // MB-10: a marble hidden inside an element glides from capture to exit — hidden from every
      // screen (draw + minimap skip it), but the wire positions stay continuous so nobody watches
      // a teleport. At the end of the ride it's released at the exit with the set velocity.
      if (m.hold) {
        // MB-10D: a human at the nudge pulls the cannon's hair trigger.
        if (m.hold.kind === 'cannon') {
          const input = this.humanInput.get(m.info.id)?.nudge ?? (m === this.player ? this.nudge : 0);
          if (input !== 0) m.hold.until = this.time;
        }
        if (this.time >= m.hold.until) {
          this.releaseHold(m);
        } else if ((m.hold.kind === 'wheel' || m.hold.kind === 'loop') && m.hold.arc) {
          // MB-10C bucket ride (and the loop ride): the marble follows the arc around
          const arc = m.hold.arc;
          const a = arc.omega * (this.time - (m.hold.at ?? this.time)) + arc.fromA;
          Body.setPosition(m.body, { x: arc.x + Math.cos(a) * arc.r, y: arc.y + Math.sin(a) * arc.r });
          continue;
        } else if (m.hold.kind === 'cannon' && m.hold.body) {
          // MB-10D: breathe in the breech — the barrel keeps drawing its aim fan; the marble rides inside.
          const md = meta(m.hold.body);
          const mo = md.motion, cn = md.cannon;
          if (mo?.mode === 'aim' && cn) {
            const a = cannonAim(mo, this.time);
            Body.setPosition(m.body, { x: mo.pivot.x + Math.cos(a) * cn.len * 0.55, y: mo.pivot.y + Math.sin(a) * cn.len * 0.55 });
          }
          continue;
        } else if (m.hold.kind === 'catapult' && m.hold.body) {
          // MB-10D: the marble rides the spoon along the arm's reposed swing.
          const md = meta(m.hold.body);
          const ct = md.catapult;
          if (ct) {
            const a = catapultAngle(ct, this.time);
            Body.setPosition(m.body, { x: ct.px + Math.cos(a) * ct.len, y: ct.py + Math.sin(a) * ct.len });
          }
          continue;
        } else {
          const transit = m.hold.transit ?? 900;
          const from = m.hold.from ?? m.body.position;
          const exit = m.hold.exit;
          if (exit) {
            const k = Math.max(0, Math.min(1, (this.time - (m.hold.until - transit)) / transit));
            // ease in-out so the ride reads as a dive-in, coast, pop-out
            let e = k * k * (3 - 2 * k);
            // MB-10C: a slipping screw rider wobbles backwards mid-tube (visible through the windows)
            if (m.hold.kind === 'screw' && m.hold.slip) e = Math.max(0, e - Math.sin(k * Math.PI * 2.5) * 0.06 * Math.sin(k * Math.PI));
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

      // P2-00: a marble still in its start cannon aims and waits to be fired; nothing else moves it.
      if (m.cannon && !m.cannon.fired) {
        platformer.cannonStep(this, m, s);
        continue;
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

      v = input.steer(this, m, v, s);
      // P2-00: computer drivers have to drive a platformer (on a classic drop gravity does it for them).
      if (this.track.platformer && !this.isHuman(m)) v = platformer.aiDrive(this, m, v, s);

      // speed cap
      const cap = this.speedLimit(m);
      const sp = Math.hypot(v.x, v.y);
      if (sp > cap) v = { x: (v.x / sp) * cap, y: (v.y / sp) * cap };
      Body.setVelocity(b, v);
      // P2-00: ramps, springs and the one-way mask act after this step's velocity is set, so a launch or a
      // lane-change hop is not overwritten by it.
      if (this.track.platformer) {
        platformer.laneGates(this, m);
        platformer.laneStep(this, m);
      }

      // trail
      if (m.info.isPlayer || this.time < m.rocketUntil) {
        m.trail.push({ x: b.position.x, y: b.position.y });
        if (m.trail.length > 14) m.trail.shift();
      } else if (m.trail.length) {
        // A rival's rocket ran out: drop its trail. Left behind, the renderer joined that stale trail to the
        // marble wherever it went next — a long "bungee cord" across the track.
        m.trail = [];
      }

      // AI item usage (P2-16 replaces this with a real driving brain)
      if (!this.track.platformer) ai.useItems(this, m); // platformer drivers use skills through the AI brain (engine/platformer.ts)
    }

    this.ageEffects(dt);
    skillfx.step(this, dt); // P2-08: bolts, bombs, spikes, decoys, grapple pull, hovering

    this.supports.clear();
    Engine.update(this.engine, dt);

    // MB-10C: the two DYNAMIC movers integrate after the solver — seesaw torque from whoever
    // is standing on the plank, bridge springs from the pack overhead. Host streams the state;
    // guests blend toward the streamed state and re-pose the same way.
    this.moverDynamics(dt);

    for (const m of this.marbles) {
      if (m.dnf) continue;
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
      if (this.track.platformer) {
        platformer.updateProgress(this, m);
        if (platformer.crossedFinish(this, m)) this.finishMarble(m);
      } else if (m.body.position.y >= this.track.finishY && m.body.position.x >= 0 && m.body.position.x <= W) this.finishMarble(m);
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
    // P2-00: on a platformer "lower" is not "ahead": rank by distance along the course path.
    const alive = this.marbles.filter((m) => m.finishedAt === null && !m.dnf);
    const rest = this.track.platformer
      ? alive.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0) || a.info.id - b.info.id)
      : alive.sort((a, b) => b.body.position.y - a.body.position.y);
    // P2-07: the knocked-out come last, the furthest-along first.
    const out = this.marbles.filter((m) => m.dnf && m.finishedAt === null).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0) || a.info.id - b.info.id);
    return [...finished, ...rest, ...out].map((m, i) => ({ marble: m, rank: i + 1, finished: m.finishedAt !== null, time: m.finishedAt, dnf: !!m.dnf }));
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
    return this.marbles.every((m) => m.finishedAt !== null || m.dnf);
  }

  /**
   * P2-07: hurt a marble. Returns true when that put it out of the race. A hit also gives a short grace period so one
   * touch of a wrecking ball is one hit, and credits the last attacker (or the rival who bumped it) with the KO.
   */
  damage(m: Marble, amount: number, by: number | null, kind: DamageKind): boolean {
    if (!this.healthOn || !m.health || m.dnf || m.finishedAt !== null) return false;
    const before = m.health.hp;
    const tfx = m.tfx;
    if (tfx) {
      // P2-17: Iron Belly: your first hazard hit each race does nothing; Chassis talents take a share off every hit
      if (by === null && tfx.ironBelly && !m.fx?.ironUsed) { (m.fx ??= {}).ironUsed = 1; this.effects.push({ type: 'text', x: m.body.position.x, y: m.body.position.y - 26, ttl: 40, maxTtl: 40, color: '#e5e7eb', text: 'IRON BELLY' }); return false; }
      amount = Math.round(amount * Math.max(0, 1 + (tfx.damageTakenPct ?? 0) / 100));
    }
    // P2-08: a Bubble Shield soaks damage first (up to what is left of its 40)
    const fx = m.fx;
    if (fx && (fx.shieldUntil ?? 0) > this.time && (fx.shieldHp ?? 0) > 0) {
      const soaked = Math.min(amount, fx.shieldHp ?? 0);
      fx.shieldHp = (fx.shieldHp ?? 0) - soaked;
      if (fx.shieldHp <= 0) fx.shieldUntil = 0;
      amount -= soaked;
      this.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 14, maxTtl: 14, color: '#60a5fa' });
      if (amount <= 0) return false;
    }
    // P2-08: the Shaman's Charm leaves a killing hit on 1 HP instead (once)
    const charmed = !!fx && (fx.charmUntil ?? 0) > this.time;
    const r = applyDamage(m.health, amount, this.time, by, { charm: charmed });
    if (r.saved && fx) { fx.charmUntil = 0; if (m.info.isPlayer) this.onEvent?.("Shaman's Charm saved you!", '#34d399'); }
    if (r.health === m.health) return false; // invulnerable
    m.health = { ...r.health, invulnUntil: Math.max(r.health.invulnUntil, this.time + 700) };
    this.shake = Math.max(this.shake, 4);
    this.effects.push({ type: 'text', x: m.body.position.x, y: m.body.position.y - 26, ttl: 40, maxTtl: 40, color: '#f87171', text: `-${Math.round(before - m.health.hp)}` });
    if (r.died) this.knockOut(m, kind);
    return r.died;
  }

  /** P2-17: give a marble its talent build. Only effects the engine reads from `m.tfx`. */
  applyTalents(m: Marble, build: Record<string, number>, slots: (ItemType | null)[]) {
    const fx = talentEffects(build);
    m.tfx = fx;
    if (this.healthOn && m.health && fx.maxHp) { m.maxHp = 100 + fx.maxHp; m.health = { ...m.health, hp: m.maxHp }; }
    if (fx.firstOffenceCharge) {
      const first = slots.find((s) => s && SKILLS[s]?.group === 'offence');
      if (first) m.inventory[first] = Math.min(MAX_ITEM_STACK, m.inventory[first] + fx.firstOffenceCharge);
    }
  }

  /** Regen with this marble's talents: a longer or shorter wait, a faster rate, a higher cap. */
  private regenOf(m: Marble, dt: number) {
    const h = m.health!;
    const fx = m.tfx;
    if (!fx || (!fx.regenPct && !fx.regenDelayMs && !fx.maxHp)) return regen(h, this.time, dt);
    if (h.dnf || this.time - h.lastHitAt < REGEN_DELAY_MS + (fx.regenDelayMs ?? 0)) return h;
    return { ...h, hp: Math.min(m.maxHp ?? 100, h.hp + REGEN_PER_SEC * (1 + (fx.regenPct ?? 0) / 100) * dt / 1000) };
  }

  private knockOut(m: Marble, kind: DamageKind) {
    m.dnf = true;
    const credit = m.health ? koCredit(m.health, this.time) : null;
    const killer = credit !== null ? this.byIdOrNull(credit) : null;
    if (killer && killer !== m) killer.kos = (killer.kos ?? 0) + 1;
    this.effects.push({ type: 'ring', x: m.body.position.x, y: m.body.position.y, ttl: 30, maxTtl: 30, color: '#ef4444' });
    this.effects.push({ type: 'debris', x: m.body.position.x, y: m.body.position.y, ttl: 40, maxTtl: 40, color: '#9ca3af', particles: this.makeParticles(m.body.position.x, m.body.position.y, 16, 5) });
    this.sfx('smash', m, m.body.position.x, m.body.position.y);
    Composite.remove(this.world, m.body);
    Body.setPosition(m.body, { x: -5000, y: -5000 });
    Body.setVelocity(m.body, { x: 0, y: 0 });
    m.trail = [];
    if (m.info.isPlayer) this.onEvent?.(`DID NOT FINISH: ${kind} took you out`, '#ef4444');
    else if (killer?.info.isPlayer) this.onEvent?.(`KO! ${m.info.name} is out (+${KO_BOUNTY} CR)`, '#facc15');
    else this.onEvent?.(`${m.info.name} is out of the race`, '#94a3b8');
  }

  /** MB-10A: a trapdoor's eased 0..1 pose for skins and previews. */
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
    return 0;
  }

  destroy() {
    Events.off(this.engine, 'collisionStart');
    Events.off(this.engine, 'collisionActive');
    Composite.clear(this.world, false);
    Engine.clear(this.engine);
  }
}
