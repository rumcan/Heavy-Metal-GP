import Matter from 'matter-js';
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
  | 'switch'
  | 'switchPad'
  // MB-10B: blades and crushers
  | 'blade'
  | 'saw'
  | 'crusher'
  | 'boulder'
  | 'mace';

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
  /** MB-10B boulder: rolled along a polyline, then respawns at the start of the path. */
  | {
    mode: 'roll';
    path: Matter.Vector[];
    /** Cumulative length at each path point. */
    stepLens: number[];
    spanLen: number;
    /** Full cycle: rest at the top, then the run. Rolling speed derives from both. */
    intervalMs: number;
    /** Time the boulder sits at the first point before rolling. */
    restMs: number;
    phaseMs: number;
    r: number;
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
  /** Rail ends that get an iron cap in the skin; curves only cap their outer ends. */
  caps?: Matter.Vector[];
  /** Wrecking ball swing: pivot, chain length, amplitude (rad), angular speed and phase. */
  pivot?: Matter.Vector;
  chain?: number;
  amp?: number;
  // ---- MB-10 elements ----
  /** Kinematic driver (race-clock pose) for the moving MB-10 pieces, if any. */
  motion?: Motion;
  /** Where a tunnel/scoop spits the marble out: point, launch direction and speed. */
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

export class Builder {
  bodies: Matter.Body[] = [];
  spinners: Matter.Body[] = [];
  itemBoxes: Matter.Body[] = [];
  buckets: Matter.Body[] = [];
  decor: Decor[] = [];
  wreckers: Matter.Body[] = [];
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
    this.arc(cx, cy, r, Math.PI, Math.PI * 2, CAT_WALL);
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
    const hp = tough * massForWeight(10) * 3.2;
    const b = Bodies.rectangle(this.X(cx), cy, w, h, {
      ...STATIC_OPTS, label: 'crumble',
      collisionFilter: { category: CAT_FRAGILE, mask: 0xffff, group: 0 },
    });
    b.plugin = { kind: 'crumble', hp, maxHp: hp, tough } as Meta;
    this.bodies.push(b);
    return b;
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

  /**
   * A track switch lever: a deflector plate at a Y-junction that leans left or right, and a small
   * sensor paddle above it. Every marble that trips the paddle flips the plate for the NEXT marble
   * (stateful: the side crosses the wire as an event).
   */
  switchLever(x: number, y: number, len = 120, angle = 0.65, side: 0 | 1 = 0) {
    const px = this.X(x);
    const s2 = (this.flip ? 1 - side : side) as 0 | 1;
    const a = (s2 === 1 ? 1 : -1) * angle;
    const plate = Bodies.rectangle(px + Math.sin(a) * len / 2, y - Math.cos(a) * len / 2, len, 12, { ...STATIC_OPTS, angle: a, label: 'switch', chamfer: { radius: 4 } });
    plate.friction = 0.002;
    plate.frictionStatic = 0;
    plate.plugin = { kind: 'switch', pivot: { x: px, y }, plateLen: len, swingAngle: angle, side: s2, eased: undefined } as Meta;
    this.bodies.push(plate);
    const pad = Bodies.rectangle(px, y - len - 16, 30, 20, { ...SENSOR_OPTS, label: 'switchPad' });
    pad.plugin = { kind: 'switchPad', paired: this.bodies.length - 1 } as Meta;
    this.bodies.push(pad);
    return plate;
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
  boulder(pts: ReadonlyArray<readonly [number, number]>, r = 27, intervalMs = 6500, restMs = 1400, phaseMs = 0) {
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
    b.plugin = { kind: 'boulder', motion: { mode: 'roll', path, stepLens, spanLen, intervalMs, restMs, phaseMs, r }, radius: r } as Meta;
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
  // starting blocks: individual pockets so every marble sits still on one horizontal line
  const spacing = (W - 120) / (GRID_N - 1);
  for (let i = 0; i < GRID_N - 1; i++) {
    const x = 60 + (i + 0.5) * spacing;
    b.block(x, y + GATE_TOP - 16, 8, 32);
  }
  b.block(14, y + GATE_TOP - 16, 8, 32);
  b.block(W - 14, y + GATE_TOP - 16, 8, 32);
  // gate floor (the "lights out" trapdoor)
  const gate = b.wall(W / 2, y + GATE_TOP + 10, W, 20, 'gate');
  gate.plugin = { kind: 'gate' };
  // funnel below
  b.ramp(0, y + 200, W / 2 - 70, y + 320);
  b.ramp(W, y + 200, W / 2 + 70, y + 320);
  b.ppeg(W / 2, y + 400, 'green', 14);
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
    7000 + b.rng() * 2600,
    1300 + b.rng() * 800,
    b.rng() * 7000,
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
  // funnel walls feeding the junction point
  b.ramp(0, y + 20, W / 2 - 60, y + 200);
  b.ramp(W, y + 20, W / 2 + 60, y + 200);
  b.switchLever(W / 2, y + 210, 110, 0.62, b.rng() < 0.5 ? 0 : 1);
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
    itemBoxes: b.itemBoxes,
    ramps: b.bodies.filter((body) => !!meta(body).surface),
    buckets: b.buckets,
    pegCount: b.pegCount,
    gate,
    startY,
    finishY,
    theme: profile.theme,
    decor: b.decor,
    wreckers: b.wreckers,
  };
}
