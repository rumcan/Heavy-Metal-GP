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
  | 'wrecker';

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
