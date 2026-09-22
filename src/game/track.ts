import Matter from 'matter-js';
import { buildCourse } from './course-builder'; import { buildExperimentalCourse } from './course-builder-experimental';
import { massForWeight, mulberry32, TrackProfile, TrackTheme, ITEM_TYPES, CIRCUIT_LENGTH_MULTIPLIER, TRACK_THEMES } from './types';
import type { ItemType } from './types';
import { rampSurface } from './physics';
import type { RampSurface } from './physics';

const { Bodies, Body } = Matter;

export const W = 900; // track width
export const T = 26; // pipe thickness

export const CAT_WALL = 0x0001;
export const CAT_MARBLE = 0x0002;
export const CAT_SENSOR = 0x0004;
/** Loop pieces marbles collide with on the way in (rising quarter). */
export const CAT_LOOP_UP = 0x0008;
/** Loop pieces marbles collide with once past the top (closing quarter back down to the bottom). */
export const CAT_LOOP_CLOSE = 0x0010;
/**
 * MB-10A. Fragile barricades (NO ENTRY signs, crumbling walls). Solid to marbles, but a Ghost
 * marble drops this category from its mask and phases straight through without opening them.
 */
export const CAT_FRAGILE = 0x0020;
/**
 * MB-10B. Danger machinery (blades, saws, crushers, boulders, maces). Solid to marbles, but a
 * Ghost marble phases through danger as well as rivals — the item is the timing cheat.
 */
export const CAT_DANGER = 0x0040;

export type Kind =
  | 'wall'
  | 'ramp'
  | 'peg'
  | 'boost'
  | 'itembox'
  | 'breakable'
  | 'pad'
  | 'finish'
  | 'gate'
  | 'spinner'
  | 'ice'
  | 'block'
  | 'ppeg'
  | 'bucket'
  | 'loop'
  | 'loopTop'
  | 'loopExit'
  | 'loopBail'
  | 'hoop'
  | 'wrecker'
  // MB-10A: shortcuts and secrets
  | 'barricade'
  | 'tunnel'
  | 'crumble'
  | 'trapdoor'
  // MB-10B: blades and crushers
  | 'blade'
  | 'saw'
  | 'crusher'
  | 'boulder'
  | 'mace'
  // MB-10C: mechanical movers
  | 'wheel'
  | 'screw'
  | 'conveyor'
  | 'seesaw'
  | 'bridge'
  // MB-10D: launchers and pinball
  | 'cannon'
  | 'catapult'
  | 'flipper'
  | 'sling'
  // MB-10E: fields and surfaces
  | 'wind'
  | 'magnet'
  | 'mud'
  | 'geyser'
  | 'trampoline'
  | 'turnstile'
  | 'target'
  | 'vortex'
  | 'platform';

/**
 * MB-10 element framework. A kinematic driver for the moving pieces: a body's pose is a pure
 * function of the race clock (`Game.time`), exactly like the wrecking ball, so multiplayer
 * guests compute the same motion from the frames they already receive. Stateful pieces (a
 * weight trapdoor, a switch plate) instead ease toward a state that host events carry.
 */
export type Motion =
  /** A door hinged at one end, swinging between shut (0) and openAngle on a timer program. */
  | {
    mode: 'hinge';
    pivot: Matter.Vector;
    /** Direction from hinge to free end when shut: +1 = door extends right, -1 = left. */
    dirX: 1 | -1;
    len: number;
    openAngle: number;
    openMs: number;
    closedMs: number;
    phase: number;
  }
  /** MB-10B blade: an arm on a pivot swinging about vertical, angle = amp·sin. */
  | {
    mode: 'pendulum';
    pivot: Matter.Vector;
    /** Arm length (pivot to blade tip). The body is a thin rect from pivot to tip. */
    arm: number;
    amp: number;
    periodMs: number;
    phaseMs: number;
    /** Half-thickness of the blade blade. */
    thin: number;
  }
  /** MB-10B saw: a spinning disc sliding back and forth along a slot (a == b: set into the track). */
  | {
    mode: 'slide';
    a: Matter.Vector;
    b: Matter.Vector;
    periodMs: number;
    phaseMs: number;
    /** Self-spin for the tangential throw and the skin, in rad/ms. */
    spinW: number;
    r: number;
  }
  /** MB-10F platform: a flat slab shuttling a<->b at steady speed with a pause at each end. */
  | {
    mode: 'platform';
    a: Matter.Vector;
    b: Matter.Vector;
    /** One-way travel time between the two end pauses. */
    travelMs: number;
    /** Rest time at each end of the run. */
    pauseMs: number;
    phaseMs: number;
  }
  /** MB-10B crusher: a vertical stamper: top rest, fast eased slam, floor hold, slow rise. */
  | {
    mode: 'piston';
    top: Matter.Vector;
    travel: number;
    /** Total cycle time; the rise takes whatever the slam and holds leave. */
    periodMs: number;
    /** Time spent sitting at floor level each cycle (< periodMs, and the rise stays positive). */
    floorMs: number;
    phaseMs: number;
  }
  /** MB-10B mace: an arm sweeping ±arc with a pause at each end; eases so a shock can stall it. */
  | {
    mode: 'sweep';
    pivot: Matter.Vector;
    arm: number;
    arc: number;
    /** One-way travel time between the two end pauses. */
    sweepMs: number;
    /** Rest time at each end of the arc. */
    pauseMs: number;
    phaseMs: number;
  }
  /** MB-10C water wheel: the hub (and its paddle art) spins about its pivot at omega. */
  | {
    mode: 'spin';
    pivot: Matter.Vector;
    /** rad/ms, sign included (dir mirrored into it). */
    omega: number;
    phaseMs: number;
    radius: number;
  }
  /** MB-10B boulder: rolled along a polyline, then respawns at the start of the path. */
  | {
    mode: 'roll';
    path: Matter.Vector[];
    /** Cumulative length at each path point. */
    stepLens: number[];
    spanLen: number;
    /** How fast the boulder rolls (px/ms coefficient roughly). */
    speed: number;
    /** Wait time after proximity trigger before rolling. */
    delay: number;
    r: number;
  }
  /** MB-10D cannon: the barrel angle oscillates between minA and maxA (canvas rad from +x). */
  | {
    mode: 'aim';
    pivot: Matter.Vector;
    minA: number;
    maxA: number;
    periodMs: number;
    phaseMs: number;
  };

export type PegColor = 'blue' | 'orange' | 'green';

export interface Meta {
  kind: Kind;
  dir?: { x: number; y: number };
  hp?: number;
  maxHp?: number;
  req?: number;
  active?: boolean;
  respawnAt?: number;
  spin?: number;
  radius?: number;
  flip?: boolean;
  pegColor?: PegColor;
  hit?: boolean;
  hitAt?: number;
  baseY?: number;
  phase?: number;
  cooldownUntil?: number;
  surface?: RampSurface;
  itemDrop?: ItemType;
  destroyed?: boolean;
  crumbleTile?: { row: number; col: number; rows: number; cols: number };
  /** Rail ends that get an iron cap in the skin; curves only cap their outer ends. */
  caps?: Matter.Vector[];
  /** Wrecking ball swing: pivot, chain length, amplitude (rad), angular speed and phase. */
  pivot?: Matter.Vector;
  chain?: number;
  amp?: number;
  // ---- MB-10 elements ----
  /** Kinematic driver (race-clock pose) for the moving MB-10 pieces, if any. */
  motion?: Motion;
  /** Where a tunnel spits the marble out: point, launch direction and speed. */
  exit?: { x: number; y: number; dir: { x: number; y: number }; speed: number };
  /** Hidden transit time (ms) for tunnel-like captures. */
  transit?: number;
  /** Two-way tunnels: the far hole is an entrance too (a second sensor is built). */
  twoWay?: boolean;
  /** Editor toughness 1..10 for fragile walls (hp is derived from it). */
  tough?: number;
  /** Trapdoor: which end the hinge sits at (-1 left, +1 right) and its mode. */
  hinge?: -1 | 1;
  mode?: 'timer' | 'weight';
  weightKg?: number;
  holdMs?: number;
  openMs?: number;
  closedMs?: number;
  /** Stateful trapdoor (weight mode): open state decided by the host; guests mirror events. */
  openNow?: boolean;
  openedAt?: number;
  /** Accumulated rest time of the pack sitting on a weight trapdoor. */
  restSince?: number;
  /** Switch lever: the chosen route (0 = left, 1 = right) and plate geometry. */
  side?: 0 | 1;
  swingAngle?: number;
  plateLen?: number;
  /** Time the route last flipped (the skin flashes the lantern / arc briefly). */
  flippedAt?: number;
  /** Eased 0..1 progress of a stateful element's swing (visual + collision). */
  eased?: number;
  /** Body index of the switch plate this paddle flips (indices are stable — bodies are append-only). */
  paired?: number;
  // ---- MB-10B: blades and crushers ----
  /** Mace sweeper: a Shockwave in range stalls the arm until this clock time (guests mirror the shock event). */
  stunUntil?: number;
  /** Crusher: time the rumble warning last fired (host-side debounce for the cue). */
  rumbledAt?: number;
  /** Boulder: the distance it has already rolled this cycle (drives the rolling skin's spin). */
  rolled?: number;
  /** Boulder: the clock time when it starts rolling, triggered by proximity. */
  triggeredAt?: number;
  // ---- MB-10C: mechanical movers ----
  /** Water wheel: bucket count, tip-out angle (rad, canvas y-down from +x), bucket occupancy. */
  wheel?: { buckets: number; release: number; rideMs?: number; slots: number[] };
  /** Screw lift: tube endpoints, per-marble transit, capacity queue (clock-times it is busy to). */
  screw?: { a: Matter.Vector; b: Matter.Vector; ms: number; cap: number; seats: { seat: number; until: number }[] };
  /** Conveyor belt: push per step (px), base direction, optional clock flip period. */
  belt?: { v: number; dir0: 1 | -1; flipMs?: number };
  /** Seesaw: dynamic plank state (rad), angular velocity, limits, damping per 16.7ms. */
  seesaw?: { len: number; min: number; max: number; angle: number; angVel: number; damp: number; remote?: { angle: number; angVel: number; at: number } | null; emittedAt?: number };
  /** Rope bridge plank: chain geometry shared by the chain (anchors, gap, slack) + this plank's index. */
  bridge?: { anchor: Matter.Vector[]; plankLen: number; slack: number; idx: number; n: number };
  /** Bridge plank current sag offset / spring velocity (host integrates; guests blend from events). */
  sag?: number;
  sagVel?: number;
  /** Low-rate dynamic sync: last clock a state event went out for this body. */
  syncAt?: number;
  /** MB-10C guest-side bridge chain target (head plank): plank sags from the last bridge event. */
  sagTarget?: number[];
  // ---- MB-10D: launchers and pinball ----
  /** Cannon: barrel length, muzzle speed, auto-fire delay, and the loaded marble's seat + clocks. */
  cannon?: { len: number; power: number; autoMs: number; loaded: { seat: number; at: number; fireAt: number } | null; lastFiredAt?: number };
  /** Catapult: arm program + static pivot; loadedAt/firedAt are host-set on capture, mirrored by the hold event. */
  catapult?: { px: number; py: number; len: number; restA: number; releaseA: number; swingMs: number; reloadMs: number; dropMs: number; loadedAt: number | null; firedAt: number | null; lastFiredAt?: number };
  /** Flipper: bat geometry (rest/swing angles from the static pivot, canvas rad), strength, timer mode, trigger clock. */
  flipper?: { px: number; py: number; side: 1 | -1; len: number; strength: number; restA: number; swingA: number; swingMs: number; dropMs: number; periodMs: number; phaseMs: number; firedAt: number; lastAuto: number };
  /** Slingshot kicker: unit facing, impulse strength (px/step), skin flash clock. */
  sling?: { facing: Matter.Vector; strength: number; flashAt: number; size: number };
  // ---- MB-10E: fields and surfaces ----
  /** Wind field: push direction (unit), base push px/step, pulse program (0 = steady). Deterministic from the clock. */
  wind?: { ux: number; uy: number; push: number; pulseMs: number; phaseMs: number; box: { x: number; y: number; w: number; h: number } };
  /** Magnet field: centre, radius, pull scale, on/off cycle (0 = always on). */
  magnet?: { cx: number; cy: number; r: number; pull: number; periodMs: number; phaseMs: number };
  /** Mud strip: drag fraction per step and the along-slope tangent (unit). */
  mud?: { drag: number; tanx: number; tany: number; box: { x: number; y: number; w: number; h: number } };
  /** Geyser: column geometry + timed eruption program off the race clock (kinematic). */
  geyser?: { cx: number; topY: number; h: number; periodMs: number; phaseMs: number; burstMs: number };
  /** MB-10F trampoline: restitution override zone. `half` is the half-width; tension scales the spring. */
  trampoline?: { half: number; tension: number };
  /** MB-10F trampoline skin state: 0..1 sag depth of the last spring, and its race-clock time — render only. */
  tramp?: { depth: number; at?: number };
  /** MB-10F turnstile hub: kinematic ratchet steps or free spin; angleOf body. */
  turnstile?: { arms: number; r: number; mode: 0 | 1; periodMs: number; phaseMs: number; stepIndex: number; stepAt: number };
  /** MB-10F drop target: thin pin that vanishes on hit and resets after `resetMs`; `gate` links to the lane gate body. */
  target?: { dropAt: number; resetAt: number; bank: number; slot: number };
  /** MB-10F drop-target bank gate + bank bookkeeping (bank id → down count). */
  targetBank?: { bank: number; count: number; resetMs: number; downAt: number[]; openedAt: number; gate: Matter.Body };
  /** MB-10F vortex funnel: orbital field torus; drop below `holeR` to exit. */
  vortex?: { cx: number; cy: number; r: number; spin: number; holeR: number };

  sagAt?: number;
}

/** Anchors for the art skin. Physics never reads these; sprites are drawn over the vector bodies. */
export type Decor =
  | { type: 'loop'; x: number; y: number; r: number; flip: boolean }
  | { type: 'curve'; points: Matter.Vector[] };

export interface SegmentInfo {
  name: string;
  y: number;
  h: number;
}

export interface Track {
  seed: number;
  bodies: Matter.Body[];
  height: number;
  segments: SegmentInfo[];
  spinners: Matter.Body[];
  turnstiles: Matter.Body[];
  itemBoxes: Matter.Body[];
  ramps: Matter.Body[];
  buckets: Matter.Body[];
  pegCount: { orange: number; total: number };
  gate: Matter.Body;
  startY: number;
  finishY: number;
  theme: TrackTheme;
  decor: Decor[];
  wreckers: Matter.Body[];
  /** MB-10F drop-target banks: per-bank pin/down bookkeeping and the gate plank they open. */
  targetBanks: TargetBank[];
}

export function meta(b: Matter.Body): Meta {
  return b.plugin as Meta;
}

const STATIC_OPTS = {
  isStatic: true,
  friction: 0.002,
  frictionStatic: 0,
  restitution: 0,
  collisionFilter: { category: CAT_WALL, mask: 0xffff, group: 0 },
};

const SENSOR_OPTS = {
  isStatic: true,
  isSensor: true,
  collisionFilter: { category: CAT_SENSOR, mask: CAT_MARBLE, group: 0 },
};

/** MB-10F drop-target bank state (builder-produced, engine-updated): pins, per-pin down clocks and the lane gate. */
export interface TargetBank {
  kind: 'targets';
  pins: Matter.Body[];
  count: number;
  resetMs: number;
  /** race-time each pin went down, -1 = standing. */
  downAt: number[];
  /** race-time the gate first opened, -1 = still shut. */
  openedAt: number;
  gate: Matter.Body;
  /** local easing state for the gate plough (derivable from the pin clocks; not on the wire). */
  gateK?: number;
  prevOpen?: boolean;
  closedAt?: number;
  cheeredAt?: number;
}

export class Builder {
  bodies: Matter.Body[] = [];
  spinners: Matter.Body[] = [];
  turnstiles: Matter.Body[] = [];
  itemBoxes: Matter.Body[] = [];
  buckets: Matter.Body[] = [];
  decor: Decor[] = [];
  wreckers: Matter.Body[] = [];
  targetBanks: TargetBank[] = [];
  pegCount = { orange: 0, total: 0 };
  flip = false;
  rng: () => number;

  /**
   * Track-def recording seam (MB-01, `src/game/trackdef.ts`). The start grid, the gate and the finish stub are
   * never part of a `TrackDef` — `buildTrackFromDef` synthesises them for every track — so the generator opens
   * the window around the middle sectors only. A plain `Builder` ignores both calls; a recording subclass uses
   * them to capture exactly the pieces a def has to describe.
   */
  beginDefinition() {}
  endDefinition() {}

  /** The icon a glowing peg drops. A method so a def recorder can capture the rolled value and replay it. */
  rollItem(): ItemType {
    return ITEM_TYPES[Math.floor(this.rng() * ITEM_TYPES.length)];
  }

  /** Start angle of a swing for a wrecking ball; captured by defs for the same reason as `rollItem`. */
  rollPhase(): number {
    return this.rng() * Math.PI * 2;
  }

  /** Peggle-style peg: lights up when hit and pops away shortly after. */
  ppeg(x: number, y: number, color: PegColor, r = 10, item?: ItemType) {
    if (color === 'green') r = Math.max(r, 13);
    const b = Bodies.circle(this.X(x), y, r, { ...STATIC_OPTS, label: 'ppeg', restitution: 0.4 });
    b.restitution = 0.42;
    b.friction = 0;
    b.plugin = { kind: 'ppeg', radius: r, pegColor: color, hit: false, hitAt: 0, itemDrop: color === 'green' ? (item ?? this.rollItem()) : undefined } as Meta;
    this.bodies.push(b);
    this.pegCount.total++;
    if (color === 'orange') this.pegCount.orange++;
    return b;
  }

  scatterPegs(y: number, h: number) {
    const probe = Bodies.circle(0, 0, 42);
    for (let i = 0; i < 7; i++) {
      const x = 70 + i * 125 + (this.rng() - 0.5) * 14;
      const py = y + h - 37 - (i % 2) * 26;
      Body.setPosition(probe, { x: this.X(x), y: py });
      if (Matter.Query.collides(probe, this.bodies.filter((body) => !body.isSensor)).length) continue;
      const roll = this.rng();
      this.ppeg(x, py, roll < 0.12 ? 'green' : roll < 0.4 ? 'orange' : 'blue', 9);
    }
  }

  /** Moving Peggle bucket: catching it fires you down the track. */
  bucket(y: number, phase: number) {
    const b = Bodies.rectangle(W / 2, y, 110, 34, { ...SENSOR_OPTS, label: 'bucket' });
    b.plugin = { kind: 'bucket', baseY: y, phase, cooldownUntil: 0 } as Meta;
    this.bodies.push(b);
    this.buckets.push(b);
    return b;
  }

  block(x: number, y: number, w: number, h: number) {
    const b = Bodies.rectangle(this.X(x), y, w, h, { ...STATIC_OPTS, label: 'block', chamfer: { radius: 2 } });
    b.plugin = { kind: 'block' } as Meta;
    this.bodies.push(b);
    return b;
  }

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  X(x: number) {
    return this.flip ? W - x : x;
  }

  wall(cx: number, cy: number, w: number, h: number, kind: Kind = 'wall') {
    const b = Bodies.rectangle(this.X(cx), cy, w, h, { ...STATIC_OPTS, label: kind });
    b.plugin = { kind } as Meta;
    this.bodies.push(b);
    return b;
  }

  /** Ramp defined by its top-surface endpoints. */
  ramp(x1: number, y1: number, x2: number, y2: number, thickness = T, kind: Kind = 'ramp') {
    const ax = this.X(x1);
    const bx = this.X(x2);
    const surface = rampSurface({ x: ax, y: y1 }, { x: bx, y: y2 });
    const angle = Math.atan2(surface.tangent.y, surface.tangent.x);
    const cx = (ax + bx) / 2 - surface.normal.x * thickness / 2;
    const cy = (y1 + y2) / 2 - surface.normal.y * thickness / 2;
    const b = Bodies.rectangle(cx, cy, surface.length + 4, thickness, { ...STATIC_OPTS, angle, label: kind, chamfer: { radius: 3 } });
    // Matter makes static bodies friction=1 during creation, so restore the polished surface.
    b.friction = 0.002;
    b.frictionStatic = 0;
    b.plugin = { kind, surface } as Meta;
    this.bodies.push(b);
    return b;
  }

  peg(x: number, y: number, r = 11) {
    const b = Bodies.circle(this.X(x), y, r, { ...STATIC_OPTS, label: 'peg', restitution: 0.2 });
    b.plugin = { kind: 'peg', radius: r } as Meta;
    this.bodies.push(b);
    return b;
  }

  boost(cx: number, cy: number, len: number, thick: number, dirX: number, dirY: number) {
    const dx = this.flip ? -dirX : dirX;
    const m = Math.hypot(dx, dirY) || 1;
    const angle = Math.atan2(dirY, dx);
    const b = Bodies.rectangle(this.X(cx), cy, len, thick, { ...SENSOR_OPTS, angle, label: 'boost' });
    b.plugin = { kind: 'boost', dir: { x: dx / m, y: dirY / m } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /** Boost zone hovering just above a ramp surface at fraction t along the ramp. */
  boostOnRamp(x1: number, y1: number, x2: number, y2: number, t: number, len = 120) {
    const px = x1 + (x2 - x1) * t;
    const py = y1 + (y2 - y1) * t;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const m = Math.hypot(dx, dy);
    const ux = dx / m;
    const uy = dy / m;
    const side = ux >= 0 ? 1 : -1;
    const nx = uy * side;
    const ny = -ux * side;
    return this.boost(px + nx * 18, py + ny * 18, len, 40, ux, uy);
  }

  itemBox(x: number, y: number) {
    const b = Bodies.circle(this.X(x), y, 17, { ...SENSOR_OPTS, label: 'itembox' });
    b.plugin = { kind: 'itembox', active: true, respawnAt: 0 } as Meta;
    this.bodies.push(b);
    this.itemBoxes.push(b);
    return b;
  }

  breakable(cx: number, cy: number, w: number, h: number, reqWeight: number) {
    const hp = massForWeight(reqWeight) * 6;
    const b = Bodies.rectangle(this.X(cx), cy, w, h, { ...STATIC_OPTS, label: 'breakable' });
    b.plugin = { kind: 'breakable', hp, maxHp: hp, req: reqWeight } as Meta;
    this.bodies.push(b);
    return b;
  }

  pad(cx: number, topY: number, w: number, launchDirX: number) {
    const b = Bodies.rectangle(this.X(cx), topY + T / 2, w, T, { ...STATIC_OPTS, label: 'pad' });
    b.plugin = { kind: 'pad', dir: { x: this.flip ? -launchDirX : launchDirX, y: -1 } } as Meta;
    this.bodies.push(b);
    return b;
  }

  spinner(cx: number, cy: number, len: number, speed: number, angle?: number) {
    const blade = Bodies.rectangle(this.X(cx), cy, len, 14, { ...STATIC_OPTS, label: 'spinner', chamfer: { radius: 6 } });
    if (angle !== undefined) Body.setAngle(blade, angle);
    blade.plugin = { kind: 'spinner', spin: speed, radius: len / 2 } as Meta;
    this.bodies.push(blade);
    this.spinners.push(blade);
    return blade;
  }

  /** Start angle of every spinner. One place, drawn from this builder's RNG, so defs can record the result. */
  randomiseSpinners() {
    this.spinners.forEach((s) => Body.setAngle(s, this.rng() * Math.PI));
  }

  /** Curved ramp: a quadratic bezier (p0 -> control -> p1) laid as short ramp pieces. Keep it monotonic in y to avoid valleys. */
  curve(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, pieces = 12) {
    const pts: Matter.Vector[] = [];
    for (let i = 0; i <= pieces; i++) {
      const t = i / pieces, u = 1 - t;
      pts.push({ x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1 });
    }
    const caps = [{ x: this.X(pts[0].x), y: pts[0].y }, { x: this.X(pts[pieces].x), y: pts[pieces].y }];
    for (let i = 0; i < pieces; i++) meta(this.ramp(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y)).caps = caps;
    this.decor.push({ type: 'curve', points: pts.map((q) => ({ x: this.X(q.x), y: q.y })) });
    return pts;
  }

  /** Arc from angle a0 to a1 (radians, screen space: 0 = right, PI/2 = bottom) with its inner surface at radius r. */
  private arc(cx: number, cy: number, r: number, a0: number, a1: number, category: number) {
    const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 14)));
    const ccx = this.X(cx);
    for (let i = 0; i < steps; i++) {
      const pa = a0 + (a1 - a0) * i / steps, pb = a0 + (a1 - a0) * (i + 1) / steps;
      const ax = this.X(cx + r * Math.cos(pa)), ay = cy + r * Math.sin(pa);
      const bx = this.X(cx + r * Math.cos(pb)), by = cy + r * Math.sin(pb);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const ol = Math.hypot(mx - ccx, my - cy) || 1;
      const ox = (mx - ccx) / ol, oy = (my - cy) / ol;
      const len = Math.hypot(bx - ax, by - ay) + 4;
      const b = Bodies.rectangle(mx + ox * T / 2, my + oy * T / 2, len, T, {
        ...STATIC_OPTS, angle: Math.atan2(by - ay, bx - ax), label: 'loop',
        collisionFilter: { category, mask: 0xffff, group: 0 },
      });
      b.friction = 0.002;
      b.frictionStatic = 0;
      b.plugin = { kind: 'loop' } as Meta;
      this.bodies.push(b);
    }
  }

  /**
   * Loop-the-loop with its bottom at (cx, bottomY); marbles enter travelling right (mirrored when flipped).
   * A 2D loop crosses its own entry, so the two lower quarters are collision-filtered per marble:
   * the rising quarter is solid until the marble passes the top sensor, then the closing quarter is.
   */
  loop(cx: number, bottomY: number, r: number) {
    const cy = bottomY - r;
    this.arc(cx, cy, r, 0, Math.PI / 2, CAT_LOOP_UP);
    this.arc(cx, cy, r, Math.PI / 2, Math.PI, CAT_LOOP_CLOSE);
    this.arc(cx, cy, r, Math.PI, Math.PI * 1.5, CAT_LOOP_CLOSE);
    this.arc(cx, cy, r, Math.PI * 1.5, Math.PI * 2, CAT_LOOP_UP);
    const sensor = (x: number, yy: number, w: number, h: number, kind: Kind) => {
      const b = Bodies.rectangle(this.X(x), yy, w, h, { ...SENSOR_OPTS, label: kind });
      b.plugin = { kind } as Meta;
      this.bodies.push(b);
    };
    sensor(cx, cy - r + 22, 40, 44, 'loopTop');
    sensor(cx, bottomY - 20, 120, 40, 'loopBail');
    sensor(cx + r + 70, cy, 30, r * 2 + 160, 'loopExit');
    this.decor.push({ type: 'loop', x: this.X(cx), y: cy, r, flip: this.flip });
  }

  /** Flaming hoop: flying through it throws the marble forward. */
  hoop(x: number, y: number, dirX: number, dirY: number) {
    const dx = this.flip ? -dirX : dirX;
    const m = Math.hypot(dx, dirY) || 1;
    const b = Bodies.circle(this.X(x), y, 34, { ...SENSOR_OPTS, label: 'hoop' });
    b.plugin = { kind: 'hoop', dir: { x: dx / m, y: dirY / m } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /** Wrecking ball on a chain, swinging about a pivot. Moved kinematically by the engine each step. */
  wrecker(px: number, py: number, chain: number, amp: number, speed: number, phase = this.rollPhase()) {
    const pivot = { x: this.X(px), y: py };
    const angle = amp * Math.sin(phase);
    const b = Bodies.circle(pivot.x + Math.sin(angle) * chain, pivot.y + Math.cos(angle) * chain, 24, { ...STATIC_OPTS, label: 'wrecker', restitution: 0.6 });
    b.plugin = { kind: 'wrecker', pivot, chain, amp, spin: speed, phase, radius: 24 } as Meta;
    this.bodies.push(b);
    this.wreckers.push(b);
    return b;
  }

  ice(x1: number, y1: number, x2: number, y2: number) {
    const b = this.ramp(x1, y1, x2, y2, T, 'ice');
    b.friction = 0;
    b.frictionStatic = 0;
    return b;
  }

  // ---------- MB-10A: shortcuts and secrets ----------

  /**
   * A NO ENTRY barricade: a wooden plank barrier nailed over a cliff-tunnel entrance. Damage is
   * weight × speed like a SMASH crate; Heavy metal smashes it in one hit; Ghost phases through
   * (CAT_FRAGILE leaves its mask) without opening it.
   */
  barricade(cx: number, cy: number, w: number, h: number, tough = 5) {
    const hp = tough * massForWeight(10) * 2.1;
    const b = Bodies.rectangle(this.X(cx), cy, w, h, {
      ...STATIC_OPTS, label: 'barricade',
      collisionFilter: { category: CAT_FRAGILE, mask: 0xffff, group: 0 },
    });
    b.plugin = { kind: 'barricade', hp, maxHp: hp, tough } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * A cliff tunnel: the entrance hole (a sensor in the wall notch) swallows a marble, which rides
   * hidden through the rock for `transit` ms and pops out of the exit hole with a set speed.
   * `twoWay` builds a second sensor at the far hole pointing back. The exit is meta, not a body:
   * it never blocks anything. Several entrances can share one exit point (a hub).
   */
  tunnel(x: number, y: number, exitX: number, exitY: number, dirX: number, dirY: number, transit = 900, speed = 7, twoWay = false) {
    const inX = this.X(x);
    const outX = this.X(exitX);
    const dx = this.flip ? -dirX : dirX;
    const m = Math.hypot(dx, dirY) || 1;
    const b = Bodies.rectangle(inX, y, 44, 100, { ...SENSOR_OPTS, label: 'tunnel' });
    b.plugin = { kind: 'tunnel', exit: { x: outX, y: exitY, dir: { x: dx / m, y: dirY / m }, speed }, transit, twoWay } as Meta;
    this.bodies.push(b);
    if (twoWay) {
      const side = inX < W / 2 ? 1 : -1;
      const rdir = { x: side * 0.7, y: -0.7 };
      const rm = Math.hypot(rdir.x, rdir.y);
      const back = Bodies.rectangle(outX, exitY, 44, 100, { ...SENSOR_OPTS, label: 'tunnel' });
      back.plugin = { kind: 'tunnel', exit: { x: inX, y, dir: { x: rdir.x / rm, y: rdir.y / rm }, speed }, transit } as Meta;
      this.bodies.push(back);
    }
    return b;
  }

  /**
   * A crumbling wall: a cracked rock slab guarding a shortcut. Every hit by ANY marble wears it
   * down a little (cumulative, permanent for the race); weight scales each hit and Heavy metal
   * counts triple. Ghost phases through without opening it.
   */
  crumble(cx: number, cy: number, w: number, h: number, tough = 6) {
    const rows = Math.max(2, Math.round(h / 22));
    const cols = Math.max(1, Math.round(w / 30));
    const bw = w / cols, bh = h / rows;
    const hp = tough * massForWeight(10) * 3.2 / Math.sqrt(rows * cols);
    let first: Matter.Body | undefined;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const b = Bodies.rectangle(this.X(cx - w / 2 + (col + 0.5) * bw), cy - h / 2 + (row + 0.5) * bh, bw, bh, {
        ...STATIC_OPTS, label: 'crumble',
        collisionFilter: { category: CAT_FRAGILE, mask: 0xffff, group: 0 },
      });
      b.plugin = { kind: 'crumble', hp, maxHp: hp, tough, crumbleTile: { row, col: this.flip ? cols - 1 - col : col, rows, cols } } as Meta;
      this.bodies.push(b);
      first ??= b;
    }
    return first!;
  }

  /**
   * A trapdoor floor: a hinged iron hatch that drops open, either on a timer program (kinematic,
   * guests read it off the race clock) or when enough pack weight rests on it (stateful: the
   * `open` state crosses the wire as an event). Marbles on it when it opens fall to a lower route.
   */
  trapdoor(cx: number, y: number, w: number, hinge: -1 | 1 = -1, mode: 'timer' | 'weight' = 'timer', openMs = 1400, closedMs = 2800, phase = 0, kg = 2.4, holdMs = 300) {
    const h2 = this.flip ? ((-hinge) as -1 | 1) : hinge;
    const px = this.X(cx);
    const pivot = { x: px + h2 * w / 2, y };
    const b = Bodies.rectangle(px, y, w, 12, { ...STATIC_OPTS, label: 'trapdoor', chamfer: { radius: 2 } });
    b.plugin = {
      kind: 'trapdoor', hinge: h2, mode, weightKg: kg, holdMs, openMs, closedMs, openNow: false, restSince: 0, eased: 0,
      motion: { mode: 'hinge', pivot, dirX: -h2 as -1 | 1, len: w, openAngle: -h2 * 1.82, openMs, closedMs, phase },
    } as Meta;
    this.bodies.push(b);
    return b;
  }

  // ---------- MB-10B: blades and crushers ----------

  /**
   * A swinging blade: a huge axe head on an iron arm, pendulum-swinging across the track off the
   * race clock. Marbles that meet it get knocked backwards with a shriek; Ghosts phase through it
   * (CAT_DANGER leaves their mask). The body is the thin arm/blade rect from pivot to tip.
   */
  blade(px: number, py: number, len: number, amp = 0.9, periodMs = 2600, phaseMs = 0, thin = 8) {
    const pivot = { x: this.X(px), y: py };
    const a0 = amp * Math.sin((2 * Math.PI * phaseMs) / periodMs);
    const b = Bodies.rectangle(pivot.x + Math.sin(a0) * len / 2, pivot.y + Math.cos(a0) * len / 2, thin * 2, len, {
      ...STATIC_OPTS, label: 'blade', angle: a0, restitution: 0.55, friction: 0.001,
      collisionFilter: { category: CAT_DANGER, mask: 0xffff, group: 0 },
    });
    b.plugin = { kind: 'blade', motion: { mode: 'pendulum', pivot, arm: len, amp, periodMs, phaseMs, thin } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * A saw blade: a spinning disc with red teeth, either set into the track in place or sliding
   * back and forth along a wood-and-iron slot. `to` names the far end of the slot (`[x, y] ===
   * [x, y]` pins it in place). The disc's self-spin is the skin's cue and the engine's throw.
   */
  saw(x: number, y: number, r = 26, to?: [number, number], periodMs = 3600, spinW = 0.5, phaseMs = 0) {
    const a = { x: this.X(x), y };
    const bb = to ? { x: this.X(to[0]), y: to[1] } : { ...a };
    const tt = ((phaseMs / periodMs) % 1 + 1) % 1;
    const k = 0.5 - 0.5 * Math.cos(2 * Math.PI * tt);
    const b = Bodies.circle(a.x + (bb.x - a.x) * k, a.y + (bb.y - a.y) * k, r, {
      ...STATIC_OPTS, label: 'saw', restitution: 0.5, friction: 0.9,
      collisionFilter: { category: CAT_DANGER, mask: 0xffff, group: 0 },
    });
    b.plugin = { kind: 'saw', motion: { mode: 'slide', a, b: bb, periodMs, phaseMs, spinW, r } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * A crusher piston: a heavy iron stamper hanging above the lane that slams down on a timer,
   * squashing whatever is under it for a moment before slowly rising. All clock; the shadow and
   * the rumble tell the rhythm. `floorMs` is how long it sits at floor level each cycle.
   */
  crusher(cx: number, topY: number, w = 130, travel = 120, periodMs = 4200, floorMs = 700, phaseMs = 0) {
    const top = { x: this.X(cx), y: topY };
    const plateH = 44;
    const b = Bodies.rectangle(top.x, top.y + plateH / 2, w, plateH, {
      ...STATIC_OPTS, label: 'crusher', restitution: 0.05, friction: 0.6, chamfer: { radius: 3 },
      collisionFilter: { category: CAT_DANGER, mask: 0xffff, group: 0 },
    });
    b.plugin = { kind: 'crusher', motion: { mode: 'piston', top, travel, periodMs, floorMs, phaseMs } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * A rolling boulder: a round rock with a goblin face released down a path on a timer. Rolling
   * speed falls out of the path length and the run window (`intervalMs - restMs`), so the def can
   * store exactly three numbers and every client computes the same pose. Marbles bowl over unless
   * they hop it with Jump; the heavier the marble, the smaller the shove.
   */
  boulder(pts: ReadonlyArray<readonly [number, number]>, r = 27, speed = 5, delay = 0) {
    const path = pts.map(([x, y]) => ({ x: this.X(x), y }));
    const stepLens = [0];
    let spanLen = 0;
    for (let i = 1; i < path.length; i++) {
      spanLen += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      stepLens.push(spanLen);
    }
    const b = Bodies.circle(path[0].x, path[0].y, r, {
      ...STATIC_OPTS, label: 'boulder', restitution: 0.6, friction: 0.35,
      collisionFilter: { category: CAT_DANGER, mask: 0xffff, group: 0 },
    });
    b.plugin = { kind: 'boulder', motion: { mode: 'roll', path, stepLens, spanLen, speed, delay, r }, radius: r } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * A mace sweeper: a spiked ball on a hinged arm sweeping horizontally across a chute, with a
   * little rest at each end of the arc. Arm-length and arc make the reach; a Shockwave blast in
   * range stalls it for two seconds (the fun interaction — guests mirror it from the shock event).
   */
  mace(px: number, py: number, arm = 130, arc = 1.05, sweepMs = 950, pauseMs = 750, phaseMs = 0, r = 24) {
    const pivot = { x: this.X(px), y: py };
    // start pose from the phase so the stored eased progress and the body agree at t=0
    const half = sweepMs + pauseMs, cycle = 2 * half;
    const tt = phaseMs % cycle;
    const es = (f: number) => { const c = Math.max(0, Math.min(1, f)); return c * c * (3 - 2 * c); };
    let side: number;
    if (tt < sweepMs) side = -1 + 2 * es(tt / sweepMs);
    else if (tt < half) side = 1;
    else if (tt < half + sweepMs) side = 1 - 2 * es((tt - half) / sweepMs);
    else side = -1;
    const a0 = side * (arc / 2);
    const b = Bodies.circle(pivot.x + Math.sin(a0) * arm, pivot.y + Math.cos(a0) * arm, r, {
      ...STATIC_OPTS, label: 'mace', restitution: 0.75, friction: 0.01,
      collisionFilter: { category: CAT_DANGER, mask: 0xffff, group: 0 },
    });
    b.plugin = {
      kind: 'mace',
      motion: { mode: 'sweep', pivot, arm, arc, sweepMs, pauseMs, phaseMs },
      radius: r,
      eased: tt / cycle,
      stunUntil: 0,
    } as Meta;
    this.bodies.push(b);
    return b;
  }

  // ---------- MB-10C: mechanical movers ----------

  /**
   * A water wheel: a big wooden wheel with bucket paddles. The hub body carries the shared meta
   * (and spins for the skin); a thin rim-band sensor circle catches marbles that fall into a
   * bucket — both share ONE meta object so bucket occupancy is single-source. Kinematic: bucket
   * angles are pure functions of the race clock, host and guest alike.
   */
  waterWheel(px: number, py: number, r = 110, buckets = 8, rpm = 3, dir: 0 | 1 = 0, releaseDeg = 105, phaseMs = 0, rideMs?: number) {
    const pivot = { x: this.X(px), y: py };
    // mirror flips the spin sense so the ride direction survives the course mirror
    const sense = (this.flip ? (dir === 0 ? -1 : 1) : (dir === 0 ? 1 : -1)) as 1 | -1;
    const omega = (sense * rpm * 2 * Math.PI) / 60000;
    const release = (releaseDeg * Math.PI) / 180;
    const shared: Meta = {
      kind: 'wheel',
      motion: { mode: 'spin', pivot, omega, phaseMs, radius: r },
      wheel: { buckets, release, rideMs, slots: new Array(buckets).fill(0) },
    };
    const hub = Bodies.circle(pivot.x, pivot.y, 12, { ...STATIC_OPTS, angle: omega * phaseMs, label: 'wheel', restitution: 0.3, friction: 0.01 });
    hub.plugin = shared;
    this.bodies.push(hub);
    const ring = Bodies.circle(pivot.x, pivot.y, r + 18, { ...SENSOR_OPTS, label: 'wheel' });
    ring.plugin = shared;
    this.bodies.push(ring);
    return hub;
  }

  /**
   * An Archimedes screw lift: a turning screw inside a tube, modelled as a timed transit from
   * `a` to `b` (the marble rides visible through the tube windows — no real screw physics). The
   * entry sensor queues marbles up to `cap`; tube cheeks are two parallel walls so the ride
   * cannot be interrupted from the outside.
   */
  screwLift(ax: number, ay: number, bx: number, by: number, ms = 3200, cap = 2) {
    const a = { x: this.X(ax), y: ay };
    const b = { x: this.X(bx), y: by };
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const shared: Meta = { kind: 'screw', dir: { x: dx / len, y: dy / len }, screw: { a, b, ms, cap, seats: [] } };
    const sensor = Bodies.circle(a.x, a.y, 34, { ...SENSOR_OPTS, label: 'screw' });
    sensor.plugin = shared;
    this.bodies.push(sensor);
    // tube cheeks: two thin walls running the span, mirrored about the path
    for (const side of [-1, 1] as const) {
      const cheek = Bodies.rectangle((a.x + b.x) / 2 + nx * 15 * side, (a.y + b.y) / 2 + ny * 15 * side, len, 5, {
        ...STATIC_OPTS, label: 'wall', angle: Math.atan2(dy, dx), friction: 0.001,
      });
      cheek.plugin = { kind: 'wall' } as Meta;
      this.bodies.push(cheek);
    }
    return sensor;
  }

  /**
   * A conveyor belt: a rail that pushes marbles along its surface. `speed` is px/step; `flipMs`
   * (optional) has the belt reverse on the race clock. The belt direction rides the surface
   * tangent, so a mirrored course mirrors the belt for free; `dir` says which end is "forward".
   */
  conveyor(x1: number, y1: number, x2: number, y2: number, speed = 0.16, flipMs: number | undefined = undefined, dir: 0 | 1 = 0) {
    const b = this.ramp(x1, y1, x2, y2, T * 1.6, 'conveyor');
    b.friction = 0.02;
    const md = meta(b);
    md.belt = { v: speed, dir0: (this.flip ? (dir === 0 ? -1 : 1) : dir === 0 ? 1 : -1) as 1 | -1 };
    if (flipMs && flipMs > 0) md.belt.flipMs = flipMs;
    return b;
  }

  /**
   * A seesaw: a long plank on a stone pivot that tips under weight, catapulting the light end.
   * DYNAMIC unlike the MB-10B machines: the angle comes from a weighted ODE, so the host
   * streams `{ angle, angVel }` at a low rate and guests spring their plank toward it.
   */
  seesaw(px: number, py: number, len = 300, limDeg = 22, damp = 0.9) {
    const pivot = { x: this.X(px), y: py };
    const lim = (limDeg * Math.PI) / 180;
    const b = Bodies.rectangle(pivot.x, pivot.y, len, 12, {
      ...STATIC_OPTS, label: 'seesaw', restitution: 0.35, friction: 0.005, chamfer: { radius: 3 },
    });
    b.plugin = { kind: 'seesaw', seesaw: { len, min: -lim, max: lim, angle: 0, angVel: 0, damp } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * A rope bridge: a chain of planks on ropes between two anchors, sagging and swaying under
   * the pack. Each plank is a static body re-posed every step from the host's spring chain;
   * guests get the chain state as a low-rate event. Planks are contiguous in `bodies`.
   */
  ropeBridge(ax: number, ay: number, bx: number, by: number, planks = 8, slack = 34) {
    const a = { x: this.X(ax), y: ay };
    const b2 = { x: this.X(bx), y: by };
    const span = Math.hypot(b2.x - a.x, b2.y - a.y);
    const plankLen = (span / planks) * 1.35;
    const out: Matter.Body[] = [];
    for (let i = 0; i < planks; i++) {
      const t = (i + 0.5) / planks;
      const x = a.x + (b2.x - a.x) * t;
      const y = a.y + (b2.y - a.y) * t + slack * 4 * t * (1 - t);
      const p = Bodies.rectangle(x, y, plankLen, 9, {
        ...STATIC_OPTS, label: 'bridge', angle: Math.atan2(b2.y - a.y, b2.x - a.x), restitution: 0.15, friction: 0.01, chamfer: { radius: 2 },
      });
      p.plugin = {
        kind: 'bridge',
        bridge: { anchor: [a, b2], plankLen, slack, idx: i, n: planks },
        baseY: y,
        sag: 0,
        sagVel: 0,
      } as Meta;
      this.bodies.push(p);
      out.push(p);
    }
    return out;
  }

  // ---------- MB-10D: launchers and pinball ----------

  /**
   * A goblin cannon: a collar the pack rolls into; the barrel keeps swinging its aim (pure clock),
   * and after a seeded beat it fires the rider across the course. Heavy marbles fly shorter —
   * the shot speed scales down with weight.
   */
  cannon(cx: number, cy: number, aimMinDeg = 292, aimMaxDeg = 330, power = 9, autoMs = 1700, phaseMs = 0) {
    const pivot = { x: this.X(cx), y: cy };
    // mirror the course: the whole aim fan maps θ → 180−θ, swapping the range ends
    const mirror = (deg: number) => ((180 - deg) % 360 + 360) % 360;
    const lo = this.flip ? mirror(aimMaxDeg) : aimMinDeg;
    let hi = this.flip ? mirror(aimMinDeg) : aimMaxDeg;
    // A rotated fan may straddle 0 degrees; retain its clockwise span.
    if (hi < lo) hi += 360;
    const md: Meta = {
      kind: 'cannon',
      motion: { mode: 'aim', pivot, minA: (lo * Math.PI) / 180, maxA: (hi * Math.PI) / 180, periodMs: 2600, phaseMs },
      cannon: { len: 74, power, autoMs, loaded: null },
    };
    const collar = Bodies.circle(pivot.x, pivot.y + 6, 16, { ...STATIC_OPTS, label: 'cannon', restitution: 0.2, friction: 0.01 });
    collar.plugin = md;
    this.bodies.push(collar);
    const mouth = Bodies.circle(pivot.x, pivot.y, 38, { ...SENSOR_OPTS, label: 'cannon' });
    mouth.plugin = md;
    this.bodies.push(mouth);
    return collar;
  }

  /**
   * A catapult: land in the spoon and after `reloadMs` the arm whips through to the release angle,
   * throwing the rider to the high ledge. `dir` 0 throws right (mirrored on a flipped course).
   */
  catapult(px: number, py: number, len = 230, reloadMs = 1400, dir: 0 | 1 = 0) {
    const pivot = { x: this.X(px), y: py };
    const right = this.flip ? dir === 1 : dir === 0;
    const restA = ((right ? 135 : 45) * Math.PI) / 180;
    const releaseA = ((right ? 300 : 240) * Math.PI) / 180;
    const md: Meta = {
      kind: 'catapult',
      catapult: { px: pivot.x, py: pivot.y, len, restA, releaseA, swingMs: 240, reloadMs, dropMs: 700, loadedAt: null, firedAt: null },
    };
    const P = { x: pivot.x + Math.cos(restA) * len * 0.5, y: pivot.y + Math.sin(restA) * len * 0.5 };
    const arm = Bodies.rectangle(P.x, P.y, len, 10, { ...STATIC_OPTS, label: 'catapult', angle: restA, restitution: 0.15, friction: 0.001, chamfer: { radius: 3 } });
    arm.plugin = md;
    this.bodies.push(arm);
    // the spoon: a catch cup at the resting tip
    const tip = { x: pivot.x + Math.cos(restA) * len, y: pivot.y + Math.sin(restA) * len };
    const spoon = Bodies.circle(tip.x, tip.y, 28, { ...SENSOR_OPTS, label: 'catapult' });
    spoon.plugin = md;
    this.bodies.push(spoon);
    return arm;
  }

  /**
   * A pinball flipper: `side` 0 = pivot on the left (bat points right, swats up-right),
   * 1 = pivot right. Fires when a marble rolls onto the bat, or every `periodMs` if set (timer mode).
   */
  flipper(x: number, y: number, side: 0 | 1 = 0, angleDeg = 0, len = 120, strength = 1.4, periodMs = 0, phaseMs = 0) {
    const pivot = { x: this.X(x), y };
    const left = this.flip ? side === 1 : side === 0;
    const sd = (left ? 1 : -1) as 1 | -1;
    // left flipper: bat runs right at rest (8°), snaps up to -46°. Right flipper mirrors.
    const baseRestA = (left ? 8 : 172);
    const baseSwingA = (left ? -46 : 226);
    
    // Apply rotation angle
    const mirroredAng = this.flip ? -angleDeg : angleDeg;
    const restA = (baseRestA + mirroredAng) * Math.PI / 180;
    const swingA = (baseSwingA + mirroredAng) * Math.PI / 180;
    
    const P = { x: pivot.x + Math.cos(restA) * len * 0.5, y: pivot.y + Math.sin(restA) * len * 0.5 };
    const bat = Bodies.rectangle(P.x, P.y, len, 12, { ...STATIC_OPTS, label: 'flipper', angle: restA, restitution: 0.25, friction: 0.001, chamfer: { radius: 4 } });
    bat.plugin = {
      kind: 'flipper',
      flipper: { px: pivot.x, py: pivot.y, side: sd, len, strength, restA, swingA, swingMs: 110, dropMs: 550, periodMs, phaseMs, firedAt: -1e9, lastAuto: 0 },
    } as Meta;
    this.bodies.push(bat);
    return bat;
  }

  /**
   * A slingshot kicker: a rubber-banded triangle on the chute wall; face contact fires the marble
   * along `facingDeg` scaled by its bounce stat. Solid body with a sensor flash face.
   */
  sling(x: number, y: number, size = 90, facingDeg = 245, strength = 4) {
    const cx = this.X(x);
    const mirrored = this.flip ? ((180 - facingDeg) % 360 + 360) % 360 : facingDeg;
    const fa = (mirrored * Math.PI) / 180;
    const facing = { x: Math.cos(fa), y: Math.sin(fa) };
    // right triangle: the hypotenuse is the rubber face, normal along `facing`
    const nx = -facing.y, ny = facing.x;
    const bx = cx - facing.x * size * 0.36, by = y - facing.y * size * 0.36;
    const tri = Bodies.fromVertices(bx, by, [[
      { x: bx - nx * size * 0.55 - facing.x * size * 0.18, y: by - ny * size * 0.55 - facing.y * size * 0.18 },
      { x: bx + nx * size * 0.55 - facing.x * size * 0.18, y: by + ny * size * 0.55 - facing.y * size * 0.18 },
      { x: bx + facing.x * size * 0.32, y: by + facing.y * size * 0.32 },
    // #99: war drums bounce — the rubber face now returns most of the impact energy
    ]], { ...STATIC_OPTS, label: 'sling', restitution: 0.9, friction: 0.001 });
    tri.plugin = { kind: 'sling', sling: { facing, strength, flashAt: -1e9, size } } as Meta;
    this.bodies.push(tri);
    return tri;
  }

  // ---------- MB-10E: fields and surfaces ----------

  /**
   * A wind field: a box that pushes marbles along `dirDeg`. Light marbles ride it further, Heavy
   * metal shrugs it off, Slipstream catches twice the gust. `pulseMs` > 0 makes the fan breathe on
   * a timer — kinematic, everyone reads the same race clock.
   */
  wind(x1: number, y1: number, x2: number, y2: number, dirDeg = 270, strength = 0.28, pulseMs = 0, phaseMs = 0) {
    const px1 = this.X(x1), px2 = this.X(x2);
    const lx = Math.min(px1, px2), hx = Math.max(px1, px2);
    const ly = Math.min(y1, y2), hy = Math.max(y1, y2);
    const mirrored = this.flip ? ((180 - dirDeg) % 360 + 360) % 360 : dirDeg;
    const fa = (mirrored * Math.PI) / 180;
    const w = Math.max(10, hx - lx), h = Math.max(10, hy - ly);
    const b = Bodies.rectangle(lx + w / 2, ly + h / 2, w, h, { ...SENSOR_OPTS, label: 'wind' });
    b.plugin = {
      kind: 'wind',
      wind: { ux: Math.cos(fa), uy: Math.sin(fa), push: strength, pulseMs, phaseMs, box: { x: lx, y: ly, w, h } },
    } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * A horseshoe magnet: a circle field dragging iron marbles to the centre — the heavier they are,
   * the harder it grips (a Heavy-metal marble briefly sticks). Ghost glides through untouched.
   * `periodMs` > 0 makes it thrum on and off on the race clock.
   */
  magnet(x: number, y: number, r = 180, strength = 3, periodMs = 0, phaseMs = 0) {
    const cx = this.X(x);
    const b = Bodies.circle(cx, y, r, { ...SENSOR_OPTS, label: 'magnet' });
    b.plugin = { kind: 'magnet', magnet: { cx, cy: y, r, pull: strength, periodMs, phaseMs } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * A mud / tar strip: a thin sticky band on the surface it lies along. Rollers trudge; hoppers and
   * bounce builds skip right over the top; the speed stat digs in against the drag and Slipstream
   * sails by untouched.
   */
  mud(x1: number, y1: number, x2: number, y2: number, drag = 0.22) {
    const px1 = this.X(x1), px2 = this.X(x2);
    const len = Math.hypot(px2 - px1, y2 - y1);
    const bx = (px1 + px2) / 2, by = (y1 + y2) / 2;
    const ang = Math.atan2(y2 - y1, px2 - px1);
    // thin band: airborne marbles legitimately hop it
    const b2 = Bodies.rectangle(bx, by - 9, len, 18, { ...SENSOR_OPTS, label: 'mud', angle: ang });
    const inv = len || 1;
    b2.plugin = {
      kind: 'mud',
      mud: { drag, tanx: (px2 - px1) / inv, tany: (y2 - y1) / inv, box: { x: Math.min(px1, px2) - 6, y: Math.min(y1, y2) - 26, w: len + 12, h: 42 } },
    } as Meta;
    this.bodies.push(b2);
    return b2;
  }

  /**
   * A geyser / steam vent: a rock mound that erupts on a timer — a warning bubble, then a blast
   * column that hurls riders skyward (light marbles highest). All timing rides the race clock, so
   * the pose is kinematic and nothing crosses the wire.
   */
  geyser(x: number, y: number, h = 300, periodMs = 4200, phaseMs = 0) {
    const cx = this.X(x);
    const mound = Bodies.rectangle(cx, y + 32, 224, 72, { ...STATIC_OPTS, label: 'geyser', friction: 0.02, chamfer: { radius: 16 } });
    this.bodies.push(mound);
    const column = Bodies.rectangle(cx, y - h / 2, 176, h, { ...SENSOR_OPTS, label: 'geyser' });
    column.plugin = {
      kind: 'geyser',
      geyser: { cx, topY: y, h, periodMs, phaseMs, burstMs: 1100 },
    } as Meta;
    this.bodies.push(column);
    return column;
  }

  // ---------------- MB-10F: big set pieces ----------------

  /**
   * Trampoline net: a thin static plank whose contact restitution is overridden in the engine
   * (the harder you land, the higher you fly; tension scales the spring). Drawn sagging when hit.
   */
  trampoline(x: number, y: number, w = 180, tension = 1) {
    const cx = this.X(x);
    const half = w / 2;
    const b = Bodies.rectangle(cx, y, w, 12, { ...STATIC_OPTS, label: 'trampoline', chamfer: { radius: 4 }, restitution: 0.05 });
    b.plugin = { kind: 'trampoline', trampoline: { half, tension } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * Turnstile diverter: N thin arms radiating from a hub. A ratchet step eases 90° per hit
   * (event-synced), or a free spin follows a period on the race clock. Either way the body
   * angle is purely kinematic, so guests replay the exact pose.
   */
  turnstile(x: number, y: number, arms = 4, r = 70, mode: 0 | 1 = 0, periodMs = 0, phaseMs = 0) {
    const cx = this.X(x);
    // one long bar spanning the arms; art draws the extra blades
    const b = Bodies.rectangle(cx, y, r * 2, 12, { ...STATIC_OPTS, label: 'turnstile', chamfer: { radius: 5 }, friction: 0.02 });
    b.plugin = {
      kind: 'turnstile',
      turnstile: { arms, r, mode, periodMs: mode === 1 ? Math.max(2400, periodMs || 6000) : 0, phaseMs, stepIndex: 0, stepAt: -1e9 },
    } as Meta;
    this.bodies.push(b);
    this.turnstiles.push(b);
    return b;
  }

  /**
   * Drop-target bank: `count` thin pins standing shoulder to shoulder, each resetting some time
   * after it drops; when every pin is down the lane gate lifts. All state is per-pin clocks, so
   * guests replay it from the same events the host sees.
   */
  targets(x: number, y: number, count = 4, resetMs = 6000) {
    const cx = this.X(x);
    const pins: Matter.Body[] = [];
    const downAt: number[] = [];
    for (let k = 0; k < count; k++) {
      const slotX = cx + (k - (count - 1) / 2) * 26;
      // shallow hurdle: 14px tall on an 18-wide pin — a rolling marble can crown it, a rolling
      // contact above a crawl knocks it over. The pack leaks through one lean at a time.
      const b = Bodies.rectangle(slotX, y - 7, 18, 14, { ...STATIC_OPTS, label: 'target', chamfer: { radius: 2 }, restitution: 0.4, friction: 0.05 });
      b.plugin = { kind: 'target', target: { dropAt: -1, resetAt: 0, bank: this.targetBanks.length, slot: k } } as Meta;
      this.bodies.push(b);
      pins.push(b);
      downAt.push(-1);
    }
    this.targetBanks.push({ kind: 'targets', pins, count, resetMs, downAt, openedAt: -1, gate: pins[0] });
    return pins[0];
  }

  /**
   * Vortex funnel: an orbital field torus around (x,y) of radius r. Marbles entering the ring
   * circle faster the faster they fly, sink sooner the heavier they are, and drop out of a hole
   * in the floor once they cross the `holeR` ring. Field-only; deterministic.
   */
  vortex(x: number, y: number, r = 140, spin = 1.5, holeR = 34) {
    const cx = this.X(x);
    const b = Bodies.circle(cx, y, r, { ...SENSOR_OPTS, label: 'vortex' });
    b.plugin = { kind: 'vortex', vortex: { cx, cy: y, r, spin, holeR } } as Meta;
    this.bodies.push(b);
    return b;
  }

  /**
   * Moving platform: a wooden slab shuttling between two points with a pause at each end —
   * the drawbridge that timing beats. Kinematic slide; guests compute the pose from the clock.
   */
  platform(ax: number, ay: number, bx: number, by: number, w = 120, travelMs = 2600, pauseMs = 1800, phaseMs = 0) {
    const pax = this.X(ax), pbx = this.X(bx);
    const b = Bodies.rectangle((pax + pbx) / 2, (ay + by) / 2, w, 16, { ...STATIC_OPTS, label: 'platform', chamfer: { radius: 5 }, friction: 0.04 });
    b.plugin = {
      kind: 'platform',
      motion: { mode: 'platform', a: { x: pax, y: ay }, b: { x: pbx, y: by }, travelMs, pauseMs, phaseMs },
    } as Meta;
    this.bodies.push(b);
    return b;
  }

}

// ---------------- MB-10C pose helpers (shared host / guest / skin) ----------------

/** Rest height of a bridge plank: the anchor line plus the authored sag profile. */
export function bridgeRestY(anchor: Matter.Vector[], slack: number, idx: number, n: number): number {
  const t = (idx + 0.5) / n;
  return anchor[0].y + (anchor[1].y - anchor[0].y) * t + slack * 4 * t * (1 - t);
}

/** Rest x position of a bridge plank on the anchor line. */
export function bridgeRestX(anchor: Matter.Vector[], idx: number, n: number): number {
  const t = (idx + 0.5) / n;
  return anchor[0].x + (anchor[1].x - anchor[0].x) * t;
}

// ---------------- MB-10D pose helpers (shared host / guest / skin) ----------------

/** Cannon barrel aim at clock `t`: oscillates between minA and maxA on a sine. */
export function cannonAim(motion: Extract<Motion, { mode: 'aim' }>, t: number): number {
  const mid = (motion.minA + motion.maxA) / 2;
  const half = (motion.maxA - motion.minA) / 2;
  return mid + half * Math.sin((2 * Math.PI * ((t + motion.phaseMs) % motion.periodMs)) / motion.periodMs);
}

/** Catapult arm angle at clock `t`: parked at rest unless a load has set the swing going. */
export function catapultAngle(ct: NonNullable<Meta['catapult']>, t: number): number {
  if (ct.loadedAt === null) return ct.restA;
  const swingStart = ct.loadedAt + ct.reloadMs;
  if (t < swingStart) return ct.restA;
  const firedAt = ct.firedAt ?? swingStart + ct.swingMs;
  if (t <= firedAt) {
    const k = Math.min(1, (t - swingStart) / ct.swingMs);
    // whip: mostly late — the arm accelerates into the release
    const e = k * k * (3 - 2 * k);
    return ct.restA + (ct.releaseA - ct.restA) * e;
  }
  // throw done: the empty arm drops back to rest
  const k = Math.min(1, (t - firedAt) / ct.dropMs);
  if (k >= 1) { return ct.restA; }
  const e = k * k * (3 - 2 * k);
  return ct.releaseA + (ct.restA - ct.releaseA) * e;
}

/** Flipper bat angle at clock `t`: ease up on the snap, ease back down. */
export function flipperAngle(fl: NonNullable<Meta['flipper']>, t: number): number {
  const dt = t - fl.firedAt;
  if (dt < 0 || dt > fl.swingMs + fl.dropMs) return fl.restA;
  if (dt <= fl.swingMs) {
    const k = dt / fl.swingMs;
    return fl.restA + (fl.swingA - fl.restA) * (k * k);
  }
  const k = (dt - fl.swingMs) / fl.dropMs;
  const e = k * k * (3 - 2 * k);
  return fl.swingA + (fl.restA - fl.swingA) * e;
}

/** Pose (position + angle) of one bridge plank, given every plank's current sag offset. */
export function bridgePlankPose(anchor: Matter.Vector[], slack: number, idx: number, n: number, sag: number[]): { x: number; y: number; angle: number } {
  const x = bridgeRestX(anchor, idx, n);
  const y = bridgeRestY(anchor, slack, idx, n) + (sag[idx] ?? 0);
  const prevX = idx > 0 ? bridgeRestX(anchor, idx - 1, n) : anchor[0].x;
  const nextX = idx < n - 1 ? bridgeRestX(anchor, idx + 1, n) : anchor[1].x;
  const prevY = idx > 0 ? bridgeRestY(anchor, slack, idx - 1, n) + (sag[idx - 1] ?? 0) : anchor[0].y;
  const nextY = idx < n - 1 ? bridgeRestY(anchor, slack, idx + 1, n) + (sag[idx + 1] ?? 0) : anchor[1].y;
  return { x, y, angle: Math.atan2(nextY - prevY, nextX - prevX) };
}

// ---------------- Segments ----------------
type Seg = (b: Builder, y: number) => number;

export const GATE_TOP = 130;
export const GRID_N = 10;
/** Vertical space the start grid, gate and funnel occupy (`segStart`'s height). */
export const START_H = 440;
/** Vertical space the finish line and catch pit occupy (`segFinish`'s height). */
export const FINISH_H = 300;

export const segStart: Seg = (b, y) => {
  // gate floor (the "lights out" trapdoor) — the only essential start infrastructure
  const gate = b.wall(W / 2, y + GATE_TOP + 10, W, 20, 'gate');
  gate.plugin = { kind: 'gate' };
  return START_H;
};

const segPeggle: Seg = (b, y) => {
  b.flip = false;
  const rows = 7;
  const cols = 13;
  const dx = (W - 120) / (cols - 1);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (dx / 2) + 60;
    for (let c = 0; c < cols; c++) {
      const x = off + c * dx;
      if (x > W - 40) continue;
      if (b.rng() < 0.05) continue;
      const roll = b.rng();
      const color: PegColor = (r === 2 && c === 4) || (r === 4 && c === 8) ? 'green' : roll < 0.3 ? 'orange' : roll < 0.4 ? 'green' : 'blue';
      b.ppeg(x, y + 60 + r * 62, color);
    }
  }
  const bottom = y + 60 + rows * 62 + 30;
  b.bucket(bottom, b.rng() * Math.PI * 2);
  // gentle catch ramps either side of the bucket lane
  b.ramp(0, bottom + 40, 120, bottom + 70);
  b.ramp(W, bottom + 40, W - 120, bottom + 70);
  return bottom + 110 - y;
};

const segZigzag: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  const drop1 = 90 + b.rng() * 50;
  const end1 = W - 160 - b.rng() * 40;
  b.ramp(0, y + 20, end1, y + 20 + drop1);
  if (b.rng() < 0.7) b.boostOnRamp(0, y + 20, end1, y + 20 + drop1, 0.55);
  const y2 = y + 20 + drop1 + 80;
  const end2 = 150 + b.rng() * 40;
  b.ramp(W, y2, end2, y2 + 110);
  if (b.rng() < 0.5) b.itemBox(300 + b.rng() * 400, y2 - 40);
  if (b.rng() < 0.4) b.peg(end1 - 40 - b.rng() * 200, y2 + 60 - 70);
  else if (b.rng() < 0.6) b.wrecker(end1 + 90, y + 10, 95, 0.5, 0.0019 + b.rng() * 0.0008);
  return y2 + 110 + 60 - y;
};

const segFunnel: Seg = (b, y) => {
  b.flip = false;
  const cx = 260 + b.rng() * (W - 520);
  const gap = 58;
  b.ramp(0, y + 20, cx - gap, y + 200);
  b.ramp(W, y + 20, cx + gap, y + 200);
  b.wall(cx - gap - 6, y + 225, 12, 50);
  b.wall(cx + gap + 6, y + 225, 12, 50);
  b.peg(cx + (b.rng() - 0.5) * 30, y + 320, 13);
  if (b.rng() < 0.5) b.itemBox(cx + (b.rng() < 0.5 ? -1 : 1) * 130, y + 90);
  return 380;
};

const segPegs: Seg = (b, y) => {
  b.flip = false;
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * 39 + 55;
    for (let x = off; x < W - 40; x += 78) {
      if (b.rng() < 0.06) continue;
      const roll = b.rng();
      b.ppeg(x + (b.rng() - 0.5) * 8, y + 48 + r * 58, roll < 0.11 ? 'green' : roll < 0.42 ? 'orange' : 'blue', 9);
    }
  }
  b.itemBox(100 + b.rng() * (W - 200), y + 405);
  return 430;
};

const segBreakWall: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  const req = [4, 5, 6, 7][Math.floor(b.rng() * 4)];
  // main ramp to the right, ends at a gap
  const rampEndX = W - 260;
  b.ramp(0, y + 20, rampEndX, y + 140);
  if (b.rng() < 0.5) b.boostOnRamp(0, y + 20, rampEndX, y + 140, 0.45);
  // landing floor (slightly sloped back toward the gap)
  b.ramp(W - 60, y + 142, W - 190, y + 160);
  // cap above the chute so you can't drop straight in
  b.ramp(W, y + 0, W - 100, y + 50);
  // breakable wall standing on the landing floor
  b.breakable(W - 75, y + 100, 30, 92, req);
  // chute left wall
  b.wall(W - 66, y + 195, 12, 90);
  // boost in chute
  b.boost(W - 30, y + 330, 120, 50, 0, 1);
  // main route ramp B (sloping back left)
  b.ramp(W - 72, y + 238, 150, y + 360);
  if (b.rng() < 0.6) b.itemBox(300 + b.rng() * 300, y + 230);
  return 480;
};

const segBouncePad: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  // ramp A comes from right side down-left onto pad
  b.ramp(W, y + 10, 450, y + 150);
  b.pad(400, y + 150, 100, -1);
  // lip wall on the left of gap
  b.wall(274, y + 90, 12, 120);
  // ledge (shortcut) sloping left into chute
  b.ramp(268, y + 30, 76, y + 66);
  // chute wall separating shortcut chute from main route
  b.wall(100, y + 285, 12, 310);
  // main route ramp B
  b.ramp(106, y + 250, W - 120, y + 340);
  if (b.rng() < 0.5) b.boostOnRamp(106, y + 250, W - 120, y + 340, 0.6);
  b.boost(50, y + 380, 120, 60, 0, 1);
  if (b.rng() < 0.6) b.itemBox(500 + b.rng() * 250, y + 200);
  return 460;
};

const segChicane: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  const n = 4;
  const lens: number[] = [];
  for (let i = 0; i < n; i++) {
    const yy = y + 30 + i * 108;
    const len = W * (0.5 + b.rng() * 0.15);
    lens.push(len);
    if (i % 2 === 0) b.ramp(0, yy, len, yy + 46);
    else b.ramp(W, yy, W - len, yy + 46);
  }
  // wrecking balls swing across the first and third drop-offs
  b.wrecker(lens[0] + 100, y + 20, 80, 0.6, 0.0021 + b.rng() * 0.0008);
  if (b.rng() < 0.6) b.wrecker(lens[2] + 100, y + 236, 80, 0.6, 0.0021 + b.rng() * 0.0008);
  if (b.rng() < 0.6) b.itemBox(W / 2 + (b.rng() - 0.5) * 300, y + 30 + n * 108 + 10);
  return 30 + n * 108 + 70;
};

const segSplitter: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  // splitter wedge
  b.peg(W / 2, y + 40, 22);
  b.wall(W / 2, y + 210, 16, 300);
  // left lane: boosts (fast lane), with ice
  b.boost(W / 4, y + 130, 60, 120, 0, 1);
  b.boost(W / 4, y + 290, 60, 120, 0, 1);
  // right lane: pegs + item
  for (let r = 0; r < 4; r++) {
    const off = W / 2 + 60 + (r % 2) * 50;
    for (let x = off; x < W - 30; x += 78) b.ppeg(x, y + 90 + r * 75, b.rng() < 0.15 ? 'green' : b.rng() < 0.4 ? 'orange' : 'blue', 9);
  }
  b.itemBox(W * 0.75, y + 200);
  // merge lips
  b.ramp(0, y + 380, 140, y + 410);
  b.ramp(W, y + 380, W - 140, y + 410);
  return 440;
};

const segSpinner: Seg = (b, y) => {
  b.flip = false;
  const x1 = 200 + b.rng() * 200;
  const x2 = W - 200 - b.rng() * 200;
  b.spinner(x1, y + 130, 190, 0.03 + b.rng() * 0.02);
  b.spinner(x2, y + 270, 190, -(0.03 + b.rng() * 0.02));
  b.itemBox(W / 2, y + 200);
  // side ramps to nudge marbles toward spinners
  b.ramp(0, y + 20, 90, y + 60);
  b.ramp(W, y + 20, W - 90, y + 60);
  return 380;
};

const segIceSlide: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ice(0, y + 20, W - 150, y + 90);
  b.ramp(W, y + 170, 150, y + 260);
  b.boostOnRamp(W, y + 170, 150, y + 260, 0.35);
  b.peg(W / 2 + (b.rng() - 0.5) * 200, y + 130, 14);
  if (b.rng() < 0.5) b.hoop(W - 90, y + 110, 0, 1);
  return 330;
};

const segLoop: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  const r = 90 + b.rng() * 15;
  const cx = 470;
  const bottom = y + 480;
  // catch ramp funnels the field to the entry side
  b.ramp(W, y + 20, 70, y + 110);
  b.curve(0, y + 150, cx - 260, bottom, cx, bottom, 14);
  b.boost(cx - 150, bottom - 26, 110, 40, 1, 0);
  b.loop(cx, bottom, r);
  // ends short of the side wall so marbles drop through instead of wedging in the corner
  b.curve(cx, bottom, cx + 200, bottom, W - 80, bottom + 80, 10);
  return bottom + 150 - y;
};

const segCurveDrop: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  // swooping drop that flattens out and launches onto a second curve
  b.curve(0, y + 30, 150, y + 280, 620, y + 300, 14);
  b.hoop(700, y + 296, 1, 0);
  b.curve(W, y + 340, W - 140, y + 540, 250, y + 570, 14);
  if (b.rng() < 0.5) b.itemBox(560, y + 200);
  return 660;
};

// ---------------- MB-10B sectors: blades and crushers ----------------

/**
 * Two giant axe blades swing across one long ramp run. They never shut the route — they just
 * swat marbles back up the lane when the timing is wrong, so this reads as a gauntlet, not a gate.
 */
const segBladeGauntlet: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 20, 430, y + 150);
  const mid = y + 150 + 70;
  // landing floor under the upper blade, sloping gently onward — a fall from the blade is short
  const blade1X = 430 + (W - 500) / 2;
  b.ramp(430, mid, W - 60, mid + 70);
  // pivot low enough that the blade tip actually scythes the lane (tip dips to the marble band)
  b.blade(blade1X, y + 90, 155, 0.9, 2400 + b.rng() * 900, b.rng() * 2400);
  // low scoop under the first blade so a brushed marble rolls on instead of dropping out
  b.ramp(blade1X - 150, mid + 44, Math.min(W - 40, blade1X + 170), mid + 74);
  // seam continuity: the second ramp's lip tucks under the floor's end — the marble bridges the
  // 18px slot instead of wedging between two slab faces below the walkable line (both flips)
  b.ramp(858, y + 292, 298, y + 412);
  const blade2X = 300 + (W - 360) / 2;
  b.blade(blade2X, y + 225, 145, 0.85, 2100 + b.rng() * 900, b.rng() * 2100);
  b.wall(blade2X + 10, y + 150 + 252, 240, 14);
  if (b.rng() < 0.6) b.itemBox(500 + b.rng() * 260, y + 90);
  return 500;
};

/**
 * A wood-and-iron slot across the track with a spinning saw sliding along it. Marbles hop the
 * slot where they find it — or catch the blade and get tossed up and away. Bounce raises the toss.
 */
const segSawSlot: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 20, 500, y + 160);
  // the slot bed: a flat floor with the saw set into it, a notch for the blade to rise from
  const slotY = y + 260;
  b.ramp(500, y + 160, W - 120, slotY);
  b.wall(W - 130, slotY + 10, 120, 16);
  const railA: [number, number] = [W - 150, slotY + 30];
  const drift = 120 + b.rng() * 140;
  b.saw(railA[0], railA[1], 24 + b.rng() * 8, b.rng() < 0.45 ? [railA[0] - drift, railA[1]] : undefined, 3000 + b.rng() * 2200, 0.5 + b.rng() * 0.35, b.rng() * 3000);
  // small drop off the bed, then the chute on
  b.ramp(W - 250, slotY + 40, 200, slotY + 190);
  if (b.rng() < 0.5) b.itemBox(380 + b.rng() * 240, y + 210);
  return 540;
};

/**
 * A straight alley with a heavy stamper slamming down on a timer. The rumble and the shadow call
 * the rhythm; get caught and you're squashed in place for a beat while the pack streams past.
 */
const segCrusherAlley: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 20, 340, y + 140);
  // the alley floor
  b.wall(W - 260, y + 260, 420, 20);
  b.crusher(W - 260 - 110, y + 150, 150, 96, 3800 + b.rng() * 1400, 650 + b.rng() * 350, b.rng() * 3800);
  if (b.rng() < 0.55) b.crusher(W - 260 + 130, y + 150, 130, 96, 4600 + b.rng() * 1400, 600 + b.rng() * 350, b.rng() * 4600);
  // off the alley's left end
  b.ramp(140, y + 290, W / 2 + 120, y + 430);
  if (b.rng() < 0.5) b.itemBox(420 + b.rng() * 240, y + 130);
  return 520;
};

/**
 * A boulder run: a carved rock rolls out of a shed at the top of the lane on a timer, bowing
 * down the same ramp the marbles race, then looping back for the next release. Jump hops it.
 */
const segBoulderRun: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  // upper ramp right-to-left, then lower ramp left-to-right; the boulder follows both
  b.ramp(W, y + 20, 260, y + 170);
  b.ramp(250, y + 190, W - 140, y + 330);
  b.ramp(W, y + 360, 180, y + 500);
  b.boulder(
    [
      [W - 40, y + 40],
      [290, y + 165],
      [330, y + 195],
      [W - 170, y + 325],
      [W - 150, y + 365],
      [220, y + 495],
    ],
    26 + b.rng() * 6,
    5 + b.rng() * 10, // speed
    0 // delay
  );
  if (b.rng() < 0.5) b.itemBox(430 + b.rng() * 240, y + 250);
  return 580;
};

/**
 * A mace sweeper over a fast chute: the spiked ball scythes across the lane and rests a heartbeat
 * at each end. Time the gap or eat the ball; a Shockwave in range jams it for two seconds.
 */
const segMaceSweep: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 20, W - 220, y + 170);
  // chute down the right side, then the mace's long runway to the left
  const laneY = y + 330;
  b.ramp(W - 210, y + 200, W - 90, laneY);
  b.wall(W / 2 - 20, laneY + 10, W / 2 - 40, 16);
  b.mace(W / 2 - 20, laneY - 190, 165, 1.1, 900 + b.rng() * 500, 650 + b.rng() * 500, b.rng() * 900);
  b.ramp(60, laneY + 40, W / 2 + 60, laneY + 190);
  if (b.rng() < 0.5) b.itemBox(360 + b.rng() * 220, y + 200);
  return 600;
};

export const segFinish: Seg = (b, y) => {
  b.flip = false;
  const fin = Bodies.rectangle(W / 2, y + 40, W, 14, { ...SENSOR_OPTS, label: 'finish' });
  fin.plugin = { kind: 'finish' } as Meta;
  b.bodies.push(fin);
  // catch pit
  b.ramp(0, y + 200, W / 2 - 40, y + 250);
  b.ramp(W, y + 200, W / 2 + 40, y + 250);
  b.wall(W / 2, y + 262, 120, 24);
  return FINISH_H;
};

// ---------------- MB-10A sectors: shortcuts and secrets ----------------

/**
 * A NO ENTRY barricade nailed over a hole in the side wall. Smash it, drop into the cliff tunnel
 * and pop out partway down the main route below. The main route always works; the tunnel just
 * skips the zigzag. Low POOL weight — secrets should be found, not everywhere.
 */
const segTunnelShortcut: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  // main route: ramp across, catch landing under the end, then the long way down
  b.ramp(0, y + 20, W - 220, y + 150);
  if (b.rng() < 0.5) b.boostOnRamp(0, y + 20, W - 220, y + 150, 0.5);
  b.ramp(W, y + 160, W - 170, y + 180);
  // the secret: barricade against the right wall over the tunnel entrance notch
  const tough = 3 + Math.floor(b.rng() * 4);
  b.barricade(W - 42, y + 132, 26, 96, tough);
  b.tunnel(W - 22, y + 120, W - 40, y + 330, -0.25, 1, 900 + b.rng() * 500, 6.5);
  // main route continues down-left
  b.ramp(W - 72, y + 262, 150, y + 380);
  if (b.rng() < 0.6) b.itemBox(330 + b.rng() * 240, y + 250);
  return 450;
};

/**
 * A crumbling rock slab over the classic side-chute shortcut: the pack chips it open together
 * (damage is cumulative and permanent), then everyone pours down the chute into the next sector.
 */
const segCrumbleWall: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 20, W - 240, y + 160);
  if (b.rng() < 0.5) b.boostOnRamp(0, y + 20, W - 240, y + 160, 0.45);
  // landing floor sloping back toward the crack, and a cap so you can't drop straight in
  b.ramp(W, y + 172, W - 180, y + 192);
  b.ramp(W, y + 0, W - 120, y + 60);
  const tough = 5 + Math.floor(b.rng() * 4);
  b.crumble(W - 74, y + 122, 36, 110, tough);
  // chute left wall + the shove that carries you down the slot
  b.wall(W - 62, y + 222, 12, 100);
  b.boost(W - 28, y + 330, 120, 50, 0, 1);
  // main route remains open below — the shortcut is a bonus, never the only way
  b.ramp(W - 76, y + 262, 160, y + 380);
  if (b.rng() < 0.6) b.itemBox(320 + b.rng() * 260, y + 240);
  return 500;
};

/**
 * A floor hatch on a timer: cross while it is shut, or drop through the open door to the lower
 * route for a small shortcut. Both routes merge below, so the sector always finishes.
 */
const segTrapdoorDrop: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  const openMs = 1100 + b.rng() * 700;
  const closedMs = 2400 + b.rng() * 900;
  b.ramp(0, y + 20, 380, y + 130);
  // flat floor with the trapdoor in its middle; door top flush with the floor tops
  b.wall(500, y + 170, 240, 16);
  b.trapdoor(700, y + 168, 120, 1, 'timer', openMs, closedMs, b.rng() * (openMs + closedMs));
  b.wall(820, y + 170, 120, 16);
  // crossing route: off the floor's right end and down a long ramp
  b.ramp(880, y + 188, 300, y + 400);
  // drop route: fall through the door onto the same ramp higher up
  if (b.rng() < 0.6) b.itemBox(500 + b.rng() * 200, y + 260);
  return 480;
};

/**
 * A Y-junction with a flippable switch plate. Every marble that trips the paddle swings the
 * plate for the next one: left lane is pegs and an item, right lane is a boost. Crowd chaos by
 * design — nobody knows which lane they get.
 */
const segSwitchLanes: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  // funnel walls feeding the junction point; #99 retired the lever that used to gate the split,
  // so the pack now routes itself by pure line choice
  b.ramp(0, y + 20, W / 2 - 60, y + 200);
  b.ramp(W, y + 20, W / 2 + 60, y + 200);
  // divider splitting the two lanes below the plate
  b.wall(W / 2, y + 332, 14, 220);
  // left lane: pegs and an item box
  for (let r = 0; r < 2; r++) {
    for (let x = 140 + (r % 2) * 60; x < W / 2 - 60; x += 120) {
      b.ppeg(x, y + 260 + r * 90, b.rng() < 0.15 ? 'green' : b.rng() < 0.4 ? 'orange' : 'blue', 9);
    }
  }
  b.itemBox(W / 4, y + 240);
  // right lane: straight boost down
  b.boost(W / 2 + 130, y + 300, 130, 200, 0, 1);
  b.boost(W / 2 + 130, y + 420, 130, 90, 0, 1);
  // merge lips
  b.ramp(0, y + 450, W / 2 - 80, y + 510);
  b.ramp(W, y + 450, W / 2 + 80, y + 510);
  return 600;
};

// ---------------- MB-10C sectors: movers ----------------

/**
 * Wheel Lift: marbles drop onto the left rim of a water wheel, ride a bucket up and over,
 * and tip out upper-right onto the exit lane. A shallow trough under the wheel catches
 * through-swingers and bounce-outs and filters them to the same bottom-right exit — no trap.
 */
const segWheelLift: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 200, y + 200);
  b.waterWheel(300, y + 260, 130, 6, 3.2 + b.rng() * 1.0, 0, 300);
  // exit lane: catches the tip-out at (365, y+147) moving right+down
  b.ramp(370, y + 170, W - 20, y + 470);
  // trough under the wheel for misses — converges beside the exit lane
  b.ramp(60, y + 420, W - 20, y + 492);
  if (b.rng() < 0.4) b.itemBox(520 + b.rng() * 160, y + 360);
  return 540;
};

/**
 * Screw Tower: a ramp feeds the mouth of an Archimedes screw which turns marbles up to a high
 * exit lane. Overshoots land on the floor beneath the tube and roll out bottom-right.
 */
const segScrewTower: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 330, 430, y + 440);
  b.screwLift(440, y + 440, 760, y + 120, 2400 + b.rng() * 800, 4);
  b.ramp(740, y + 140, W - 10, y + 300);
  b.ramp(420, y + 480, W - 10, y + 530);
  return 560;
};

/**
 * Beltway: the main descent is a conveyor that alternates shoving the pack uphill and downhill
 * on the race clock. Same start/finish geometry as a plain ramp, so mirroring is free.
 */
const segBeltway: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 60, y + 70);
  b.conveyor(60, y + 70, 500, y + 285, 0.2 + b.rng() * 0.1, 6000 + b.rng() * 3000, 1);
  b.ramp(500, y + 285, W - 10, y + 420);
  if (b.rng() < 0.5) b.itemBox(620 + b.rng() * 200, y + 330);
  return 460;
};

/**
 * Teeter Crossing: a seesaw plank bridges a dip. Cross the pivot smartly and the tip flings
 * you onto the upper exit; get dumped off either end and the safety trough carries you down
 * to the same bottom-right out — slower, never stuck.
 */
const segTeeterCrossing: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 330, y + 190);
  b.seesaw(360, y + 215, 380, 16, 0.88);
  b.ramp(500, y + 250, W - 10, y + 430);
  b.ramp(150, y + 330, W - 10, y + 450);
  return 500;
};

/**
 * Rope Crossing: a sagging plank bridge spans a pocket. Marbles that punch through between
 * planks drop onto the pocket floor and rejoin at the bottom-right beside the main lane.
 */
const segRopeCrossing: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 60, 320, y + 180);
  b.ropeBridge(330, y + 205, 590, y + 215, 8, 34 + b.rng() * 14);
  b.ramp(590, y + 215, W - 10, y + 430);
  b.ramp(330, y + 340, W - 10, y + 442);
  return 480;
};

// ================= MB-10D: launchers and pinball =================

/**
 * Cannon Run: the pack rolls down into a goblin cannon pit. Whoever rolls in gets aimed up-right
 * and fired onto the high shelf; anyone just passing behind the collar drops to the catch ramp
 * and rejoins at the same bottom-right. The shelf and the catch lane both flute to the exit —
 * a trap it is not.
 */
const segCannonRun: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 150, y + 80);
  // collar trench + catch floor for marbles that simply walk past the mouth
  b.ramp(150, y + 130, 360, y + 200);
  b.cannon(220, y + 136, 288, 306, 11.5 + b.rng() * 1.5, 1400 + b.rng() * 500, b.rng() * 2000);
  // the high shelf the shot lands on
  b.ramp(350, y + 120, 560, y + 180);
  b.ramp(560, y + 180, W - 20, y + 440);
  // the catch lane underneath — walk-throughs and short shots land here, fluting to the out
  b.ramp(360, y + 200, 480, y + 260);
  b.ramp(480, y + 260, W - 10, y + 470);
  return 520;
};

/**
 * Catapult Ledge: a bowl drops the pack into the spoon; after a beat the arm whips and throws its
 * rider up-right onto the shelf. Marbles that never owned the spoon roll through the bowl and
 * take the low lane; both flutes meet at the bottom-right out.
 */
const segCatapultLedge: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 150, y + 240);
  b.ramp(150, y + 240, 330, y + 340);
  // spoon rest tip sits near (260, y + 320), right above the bowl floor
  b.catapult(430, y + 150, 240, 1100 + b.rng() * 500, 0);
  // the shelf the fling lands on — staged into the throw's wing (see mb10d-sanity), then on to the out
  b.ramp(310, y + 280, 520, y + 350);
  b.ramp(520, y + 350, W - 20, y + 450);
  // the bowl's through lane — rises to graze the resting spoon so every passer earns a fling
  b.ramp(160, y + 330, 470, y + 420);
  b.ramp(470, y + 420, W - 10, y + 530);
  return 550;
};

/**
 * Flipper Alley: a resting flipper grows out of the chute lip. Roll onto the bat and the sensor
 * swats you across the gap; a bouncy marble rebounds high, a heavy one barely hops — and the gap
 * floor itself slides down-right, so nothing dogs the bat. A pinball machine, never a trap.
 */
const segFlipperAlley: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 260, y + 120);
  b.ramp(260, y + 120, 440, y + 205);
  b.flipper(560, y + 228, 0, 0, 116 + b.rng() * 16, 1.3 + b.rng() * 0.3, 0, 0);
  // the gap floor slides across regardless
  b.ramp(440, y + 250, 720, y + 340);
  b.ramp(720, y + 340, W - 10, y + 500);
  if (b.rng() < 0.5) b.flipper(740, y + 356, 1, 0, 108 + b.rng() * 14, 2.2 + b.rng() * 0.6, 1400 + b.rng() * 600, b.rng() * 1000);
  return 540;
};

/**
 * Sling Chute: a narrow falling chute rubber-banded on both walls. Each face kick punches the
 * marble across and DOWN the fall — a bouncy marble pachinks between bands and leaves fast,
 * everyone else just funnels through the middle.
 */
const segSlingChute: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 300, y + 118);
  // chute rails (centre-anchored walls)
  b.wall(276, y + 250, 12, 280);
  b.wall(560, y + 250, 12, 280);
  // the slide-in funnel feeds the first band's face, and each band bounces you onto the next
  b.ramp(300, y + 310, 420, y + 380);
  b.sling(470, y + 365, 125, 225, 3.6 + b.rng() * 0.8);
  b.sling(380, y + 485, 125, 305, 3.6 + b.rng() * 0.8);
  // funnel out
  b.ramp(340, y + 540, W - 10, y + 615);
  return 660;
};

// ---------------- MB-10E sectors: fields and surfaces ----------------

/**
 * Fan Garden: a pulsed updraft column bridges a gully in the main slope. Light marbles sail the
 * gust across; heavier ones sink into the trough below and take the low road — and every fall is
 * onto the trough ramp, never into a void.
 */
const segFanGarden: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 300, y + 150);
  b.ramp(300, y + 150, 360, y + 180); // the lip
  // the fan: up-and-following, breathing on the race clock
  b.wind(360, y - 200, 560, y + 320, 300, 0.34 + b.rng() * 0.08, 2600 + b.rng() * 1600, b.rng() * 2600);
  b.ramp(560, y + 160, W - 20, y + 330); // the far shore
  // under-trough: anything that sinks lands here — the low road still takes you out
  b.ramp(60, y + 320, W - 10, y + 440);
  return 480;
};

/**
 * Lodestone Way: an S-chute past two horseshoes. The right-hand magnet is always on and drags
 * runners into the backboard (Heavy metal sticks for a beat); the left-hand one thrums on and off
 * off the race clock. Tin can overtones, iron soreness, nobody stuck.
 */
const segLodestoneWay: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 470, y + 220);
  // right backboard the first magnet pins you to
  b.wall(845, y + 290, 14, 250);
  b.magnet(700, y + 250, 175, 4.8 + b.rng() * 0.8, 0, 0);
  b.ramp(470, y + 220, 120, y + 360);
  // left backboard for the timer magnet
  b.wall(30, y + 430, 14, 210);
  b.magnet(190, y + 430, 175, 4.8 + b.rng() * 0.8, 4600 + b.rng() * 1200, b.rng() * 4600);
  b.ramp(120, y + 360, 660, y + 520);
  b.ramp(660, y + 520, W - 20, y + 630);
  return 670;
};

/**
 * Tar Flats: strips of sticky tar on the fast slope. Two bands, a steeper second: rollers trudge,
 * bounce builds hop the top, the speed stat digs in, Slipstream sails.
 */
const segTarFlats: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 260, y + 140);
  b.mud(120, y + 107, 380, y + 205, 0.24 + b.rng() * 0.08);
  b.ramp(260, y + 140, 560, y + 300);
  b.mud(430, y + 246, 700, y + 364, 0.26 + b.rng() * 0.08);
  b.ramp(560, y + 300, W - 10, y + 470);
  return 510;
};

/**
 * Vent Field: three timed geysers erupt through plinths on the bowl run. The bubble beat warns
 * you; park on the vent at the wrong (right) moment and you get chucked up the course. All timing
 * is the race clock: no wire traffic at all.
 */
const segVentField: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 300, y + 180);
  b.ramp(300, y + 180, 400, y + 210);
  const p1 = 3300 + b.rng() * 1400, p2 = 3300 + b.rng() * 1400, p3 = 3300 + b.rng() * 1400;
  b.geyser(430, y + 208, 260, p1, b.rng() * p1);
  b.ramp(460, y + 224, 530, y + 250);
  b.geyser(560, y + 242, 260, p2, b.rng() * p2);
  b.ramp(590, y + 266, 660, y + 290);
  b.geyser(690, y + 280, 260, p3, b.rng() * p3);
  b.ramp(720, y + 298, W - 10, y + 420);
  return 460;
};


// ---------------- MB-10F sectors: the carnival big-toys ----------------

/**
 * Trampoline Alley: the inbound ramp drops onto a broad net stretched over a gully. Land hard and
 * the gully is a memory; land soft and the trough below picks you up — either road still reaches
 * the far shelf.
 */
const segBounceNet: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 300, y + 150);
  // the net sits in the dip
  b.trampoline(390, y + 250, 175, 1.1 + b.rng() * 0.5);
  // gully bottom: the low road for anyone under-sprung
  b.ramp(60, y + 330, W - 10, y + 440);
  // landing shelf back up at water level, reachable off a real bounce
  b.ramp(540, y + 160, W - 20, y + 290);
  return 480;
};

/**
 * Turnstile Square: two hubs across the S-chute — a free-spinning one above the mean line and a
 * ratcheted one at the kink. Push it round or get batted; either way you lever through the square.
 */
const segTurnstileSquare: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 470, y + 220);
  // hubs hoover just above the marble's rolling line so the blades sweep the lane
  b.turnstile(455, y + 196, 4, 78, 0, 0, 0);   // ratcheted: each shove eases it a step
  b.ramp(470, y + 220, 180, y + 380);
  b.turnstile(200, y + 356, 3, 88, 1, 4200, b.rng() * 4200); // free spin on the clock
  b.ramp(180, y + 380, W - 20, y + 560);
  return 600;
};

/**
 * Target Gate: a pinwall blocks the quick flat; drop all of them and the plough gate sinks out of
 * the lane. Pins re-arm on their own clocks — the gate is alive as long as the bank stays down.
 */
const segTargetGate: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 300, y + 170);
  b.ramp(300, y + 170, 520, y + 186);
  b.targets(370, y + 178, 3 + Math.floor(b.rng() * 3), 5200 + b.rng() * 2200);
  b.ramp(520, y + 196, W - 20, y + 330);
  return 380;
};

/**
 * Vortex Bowl: a funnel field straddled over the main descent — roll through its ring and it
 * slings you round; heavy marbles sink to the centre and drop through the hole onto the lane
 * below, quick ones keep circling. Ordering is rewritten at the bowl.
 */
const segVortexBowl: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, W - 20, y + 270);
  b.tunnel(W - 35, y + 270 - 15, W / 2, y + 360, 0, 1);
  b.vortex(560, y + 180, 175, 1.35 + b.rng() * 0.5, 34);
  b.ramp(0, y + 420, W - 20, y + 540);
  return 600;
};

/**
 * Drawbridge Gap: a lip-to-lip jump with a shuttling ferry pad between. Catch the pad's window or
 * take the trough below — timing decides who makes the jump.
 */
const segDrawbridgeGap: Seg = (b, y) => {
  b.flip = b.rng() < 0.5;
  b.ramp(0, y + 30, 380, y + 190);
  b.ramp(560, y + 190, W - 20, y + 340);
  b.platform(405, y + 226, 535, y + 226, 130, 2200 + b.rng() * 900, 1500, b.rng() * 1800);
  b.ramp(60, y + 420, W - 10, y + 520);
  return 560;
};

const POOL: { seg: Seg; name: string; weight: number }[] = [
  { seg: segZigzag, name: 'Zigzag Pipes', weight: 2 },
  { seg: segFunnel, name: 'Funnel', weight: 2 },
  { seg: segPegs, name: 'Peg Field', weight: 1.4 },
  { seg: segBreakWall, name: 'Crack Wall Shortcut', weight: 2 },
  { seg: segBouncePad, name: 'Bounce Ramp', weight: 2 },
  { seg: segChicane, name: 'Chicane', weight: 1.2 },
  { seg: segSplitter, name: 'Splitter', weight: 1.2 },
  { seg: segSpinner, name: 'Spinners', weight: 1.2 },
  { seg: segIceSlide, name: 'Ice Slide', weight: 1 },
  { seg: segPeggle, name: 'Peggle Board', weight: 2.2 },
  { seg: segLoop, name: 'Loop', weight: 1.8 },
  { seg: segCurveDrop, name: 'Curve Drop', weight: 2 },
  // MB-10A: shortcuts and secrets (low weights — found, not everywhere)
  { seg: segTunnelShortcut, name: 'Tunnel Shortcut', weight: 0.7 },
  { seg: segCrumbleWall, name: 'Crumbling Wall', weight: 0.6 },
  { seg: segTrapdoorDrop, name: 'Trapdoor Drop', weight: 0.6 },
  { seg: segSwitchLanes, name: 'Switchback Lanes', weight: 0.6 },
  // MB-10B: blades and crushers — danger is a spice, never the whole meal
  { seg: segBladeGauntlet, name: 'Blade Gauntlet', weight: 0.3 },
  { seg: segSawSlot, name: 'Saw Slot', weight: 0.55 },
  { seg: segCrusherAlley, name: 'Crusher Alley', weight: 0.55 },
  { seg: segBoulderRun, name: 'Boulder Run', weight: 0.6 },
  { seg: segMaceSweep, name: 'Mace Sweep', weight: 0.55 },
  { seg: segWheelLift, name: 'Wheel Lift', weight: 0.35 },
  { seg: segScrewTower, name: 'Screw Tower', weight: 0.4 },
  { seg: segBeltway, name: 'Beltway', weight: 0.5 },
  { seg: segTeeterCrossing, name: 'Teeter Crossing', weight: 0.45 },
  { seg: segRopeCrossing, name: 'Rope Crossing', weight: 0.5 },
  // MB-10D: launchers and pinball — cameos, like the movers
  { seg: segCannonRun, name: 'Cannon Run', weight: 0.4 },
  { seg: segCatapultLedge, name: 'Catapult Ledge', weight: 0.4 },
  { seg: segFlipperAlley, name: 'Flipper Alley', weight: 0.45 },
  { seg: segSlingChute, name: 'Sling Chute', weight: 0.45 },
  // MB-10E: fields and surfaces — same cameo treatment
  { seg: segFanGarden, name: 'Fan Garden', weight: 0.4 },
  { seg: segLodestoneWay, name: 'Lodestone Way', weight: 0.4 },
  { seg: segTarFlats, name: 'Tar Flats', weight: 0.4 },
  
  { seg: segVentField, name: 'Vent Field', weight: 0.4 },
  // MB-10F: the carnival big-toys — same cameo treatment
  { seg: segBounceNet, name: 'Trampoline Alley', weight: 0.4 },
  { seg: segTurnstileSquare, name: 'Turnstile Square', weight: 0.35 },
  { seg: segTargetGate, name: 'Target Gate', weight: 0.35 },
  { seg: segVortexBowl, name: 'Vortex Bowl', weight: 0.35 },
  { seg: segDrawbridgeGap, name: 'Drawbridge Gap', weight: 0.4 },
];

export const DEFAULT_PROFILE: TrackProfile = {
  segments: 11 * CIRCUIT_LENGTH_MULTIPLIER,
  weights: {},
  theme: TRACK_THEMES.default,
};

export function generateTrack(seed: number, profile: TrackProfile = DEFAULT_PROFILE): Track {
  return assembleTrack(new Builder(seed), seed, profile);
}

/**
 * Picks the sectors, builds every body into `b` and describes the circuit. Split out of `generateTrack` so the
 * track-def recorder (`src/game/trackdef.ts`, MB-01) can drive the same generator and capture the very calls
 * that made today's procedural circuits — that is what makes a generated circuit editable as a starting point.
 */
export function assembleTrack(b: Builder, seed: number, profile: TrackProfile): Track {
  const segments: SegmentInfo[] = [];
  const segmentCount = Math.max(3, Math.min(72, Math.floor(profile.segments)));
  let y = 0;

  const startY = y + GATE_TOP - 14;
  const hStart = segStart(b, y);
  const gate = b.bodies.find((bd) => meta(bd).kind === 'gate')!;
  segments.push({ name: 'Start', y, h: hStart });
  y += hStart;

  if (profile.generator !== 'legacy') {
    b.beginDefinition();
    const course = buildCourse(b, seed, profile, y);
    b.endDefinition();
    segments.push(...course);
    y = course.at(-1)!.y + course.at(-1)!.h;
  } else {
    // Story retains its authored sector-number events and signature objectives.
    // choose the sequence using profile-weighted pool; guarantee the signature features
    const pool = POOL.map((p) => ({ ...p, weight: p.weight * (profile.weights[p.name] ?? 1) }));
    const chosen: { seg: Seg; name: string }[] = [];
    const totalW = pool.reduce((s, p) => s + p.weight, 0);
    let lastName = '';
    let tries = 0;
    while (chosen.length < segmentCount && tries++ < 500) {
      let r = b.rng() * totalW;
      let pick = pool[0];
      for (const p of pool) {
        r -= p.weight;
        if (r <= 0) {
          pick = p;
          break;
        }
      }
      if (pick.name === lastName) continue;
      chosen.push(pick);
      lastName = pick.name;
    }
    const signatures = ['Crack Wall Shortcut', 'Bounce Ramp', 'Peggle Board', 'Loop'];
    const ensure = (name: string, minimum = 1) => {
      while (chosen.filter((c) => c.name === name).length < minimum) {
        const counts = chosen.reduce<Record<string, number>>((all, c) => ({ ...all, [c.name]: (all[c.name] ?? 0) + 1 }), {});
        const candidates = chosen.map((c, i) => ({ c, i })).filter(({ c }) => c.name !== name && (!signatures.includes(c.name) || counts[c.name] > 1));
        const replacement = candidates[Math.floor(b.rng() * candidates.length)];
        if (replacement) chosen[replacement.i] = POOL.find((p) => p.name === name)!;
        else break;
      }
    };
    ensure('Crack Wall Shortcut');
    ensure('Bounce Ramp');
    ensure('Peggle Board', Math.max(1, Math.floor(segmentCount / 5)));
    ensure('Loop', Math.max(1, Math.floor(segmentCount / 8)));

    // Everything between these two calls is a piece a TrackDef stores (see `Builder.beginDefinition`).
    b.beginDefinition();
    for (const c of chosen) {
      const h = c.seg(b, y);
      if (!['Peggle Board', 'Peg Field', 'Loop', 'Curve Drop'].includes(c.name)) b.scatterPegs(y, h);
      segments.push({ name: c.name, y, h });
      y += h;
    }
    b.endDefinition();
  }

  const finishY = y + 40;
  const hFin = segFinish(b, y);
  segments.push({ name: 'Finish', y, h: hFin });
  y += hFin;

  const height = y;
  // outer walls
  b.flip = false;
  b.wall(-20, height / 2, 40, height + 400);
  b.wall(W + 20, height / 2, 40, height + 400);
  // top cap
  b.wall(W / 2, -30, W, 20);

  // spinners start at a rolled angle so two heats on one seed do not run identically
  b.randomiseSpinners();

  return {
    seed,
    bodies: b.bodies,
    height,
    segments,
    spinners: b.spinners,
    turnstiles: b.turnstiles,
    itemBoxes: b.itemBoxes,
    ramps: b.bodies.filter((body) => !!meta(body).surface),
    buckets: b.buckets,
    targetBanks: b.targetBanks,
    pegCount: b.pegCount,
    gate,
    startY,
    finishY,
    theme: profile.theme,
    decor: b.decor,
    wreckers: b.wreckers,
  };
}


export function assembleExperimentalTrack(b: Builder, seed: number, profile: TrackProfile): Track {
  const segments: SegmentInfo[] = [];
  let y = 0;

  const startY = y + GATE_TOP - 14;
  const hStart = segStart(b, y);
  const gate = b.bodies.find((bd) => meta(bd).kind === 'gate')!;
  segments.push({ name: 'Start', y, h: hStart });
  y += hStart;

  b.beginDefinition();
  // We must import it dynamically or require it if we don't have it imported statically
  // Actually I will add the import at the top using another command!
  const course = buildExperimentalCourse(b, seed, profile, y);
  b.endDefinition();
  segments.push(...course);
  y = course.at(-1)!.y + course.at(-1)!.h;

  const finishTop = y;
  const finishY = finishTop + 40;
  segFinish(b, finishTop);

  b.flip = false;
  b.wall(-100, y / 2, 200, y + 400);
  b.wall(900 + 100, y / 2, 200, y + 400);
  b.wall(900 / 2, -30, 900, 20);

  segments.push({ name: 'Finish', y: finishTop, h: FINISH_H });

  return {
    seed,
    bodies: b.bodies,
    height: y,
    segments,
    spinners: b.spinners,
    turnstiles: b.turnstiles,
    itemBoxes: b.itemBoxes,
    ramps: b.bodies.filter((body) => !!meta(body).surface),
    buckets: b.buckets,
    targetBanks: b.targetBanks,
    pegCount: b.pegCount,
    gate,
    startY,
    finishY,
    theme: profile.theme,
    decor: b.decor,
    wreckers: b.wreckers,
  };
}

