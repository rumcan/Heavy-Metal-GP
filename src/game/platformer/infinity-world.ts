// P2-24: the engine side of Infinity mode. One `Game` with one marble on a land that is built a chunk at a time ahead of
// the ball and thrown away behind it, so the bodies alive stay in a small window however far it rolls. The world is
// shifted back toward zero every ORIGIN_STEP px (Matter loses precision far out), and a running distance counter does
// not care. The Game is an ordinary platformer Game: this module only feeds its track.
import Matter from 'matter-js';
import { Game } from '../engine';
import { PHYSICS_STEP } from '../physics';
import { TRACK_THEMES, MARBLE_RADIUS } from '../types';
import type { MarbleInfo, TrackTheme } from '../types';
import { makePath } from '../course-path';
import type { Track } from '../track';
import { CAT_WALL } from '../track';
import { planBodies, ALL_LANES, FLOOR_DEPTH } from './build';
import { floorAt } from './course';
import { applyLaneMask } from '../engine/platformer';
import type { CoursePlan, Lane, PitSpot, SmashBreak } from './course';
import { CHUNK_W, INF_START_Y, ORIGIN_STEP, PX_PER_KM, infinityChunk, shiftChunk, terrainY } from './infinity';
import type { InfinityChunk } from './infinity';

/** Chunks kept behind the ball's chunk (about three screens) and built ahead of it. */
export const CHUNKS_BEHIND = 2;
export const CHUNKS_AHEAD = 3;
/** How close the ball's centre must come to a ring's centre to collect it. */
const RING_REACH = 34;
/** How far under the last solid ground the ball may fall before it is lifted back. */
const FALL_DEPTH = 650;
/** Lives a run starts with (the owner: "Maybe you have 3 lives"). A death pit takes one; the last one ends the run. */
export const INFINITY_LIVES = 3;
/** How far below a pit's lip the ball must drop to be lost in it. */
const PIT_DEPTH = 240;

export interface InfinityOptions {
  /** Start with the Game's own recovery and effects off: this module does the gentle recovery. */
  effects?: boolean;
  theme?: TrackTheme;
  /** Lives to start with (INFINITY_LIVES; the tests that drive a long way give the ball as many as it needs). */
  lives?: number;
}

interface Live { chunk: InfinityChunk; bodies: Matter.Body[] }

/** The start meadow's wall, far enough behind the ball that it is never seen. */
function wall(x: number, y: number, h: number): Matter.Body {
  const body = Matter.Bodies.rectangle(x, y - h / 2, 40, h, { isStatic: true, friction: 0.002, restitution: 0, collisionFilter: { category: CAT_WALL, mask: ALL_LANES, group: 0 } });
  body.plugin = { kind: 'wall', depth: 0 };
  return body;
}

export class InfinityRun {
  readonly seed: number;
  readonly game: Game;
  /** The absolute coordinates of the local origin: local = absolute - origin. */
  origin = { x: 0, y: 0 };
  /** Distance rolled in px (never shifted). */
  distance = 0;
  best = 0;
  /** How many times the ball was lifted back (a calm 0 to 1 fade value for the screen, decaying). */
  fade = 0;
  falls = 0;
  /** Lives left. A death pit takes one; at 0 the run is over (`over`) and stepping does nothing. */
  lives = INFINITY_LIVES;
  over = false;
  /** Bumped each time a life is lost (the screen flashes and shakes its hearts). */
  livesLost = 0;
  /** Counters for tests. */
  chunksBuilt = 0;
  originShifts = 0;
  /**
   * Half the width of the land on screen, in world px (the screen sets it every frame from its zoom, for the furthest
   * lane drawn). The built window always covers it, plus the road ahead at the ball's speed, so land is never built or
   * dropped where you can see it (it used to be a fixed 3 chunks ahead and 2 behind: zoomed out at speed, you saw the
   * seam). 0 (tests, no screen) keeps the minimum window.
   */
  viewHalfWidth = 0;
  /** How the world moved at the last origin shift (add it to anything that holds world positions, like a camera). */
  lastShift = { dx: 0, dy: 0 };
  /** Gold rings collected this run, and the ids taken (a rebuilt chunk does not bring them back). */
  rings = 0;
  private taken = new Set<string>();
  /** Smash crates bursting right now (drawn by the renderer from the plan; cleared once their pieces have fallen). */
  smashFx: SmashBreak[] = [];
  /** When each fire ring last fired (one burst per pass). */
  private hoopAt = new Map<string, number>();
  private live = new Map<number, Live>();
  private cache = new Map<number, InfinityChunk>();
  private wallBody: Matter.Body | null = null;
  /** The last ground the ball stood on, with its lane (local coordinates). */
  private solid: { lane: Lane; x: number; y: number } | null = null;
  private theme: TrackTheme;
  private startAbsX = 0;

  constructor(seed: number, driver: MarbleInfo, opts: InfinityOptions = {}) {
    this.seed = seed >>> 0;
    this.theme = opts.theme ?? TRACK_THEMES.forest;
    this.lives = opts.lives ?? INFINITY_LIVES;
    const first = this.local(this.abs(0));
    const track = this.trackOf([first]);
    // Chunk 0 only at first: a Game with more than 350 bodies would start streaming its track by height.
    this.game = new Game(this.seed, [driver], { track, effects: opts.effects ?? true, aiItems: false, recovery: false, collectRings: false });
    this.live.set(0, { chunk: first, bodies: [...track.bodies] });
    this.chunksBuilt++;
    this.wallBody = wall(-320, INF_START_Y + 40, 2400);
    Matter.Composite.add(this.game.world, this.wallBody);
    const g = this.game;
    g.start();
    g.openGate();
    const m = g.player;
    m.cannon = undefined;
    m.lane = 1;
    Matter.Body.setPosition(m.body, { x: 320, y: INF_START_Y - MARBLE_RADIUS - 4 });
    Matter.Body.setVelocity(m.body, { x: 0, y: 0 });
    this.startAbsX = 320;
    this.refreshWindow();
  }

  // ---------------------------------------------------------------- coordinates
  private abs(n: number): InfinityChunk {
    let c = this.cache.get(n);
    if (!c) {
      c = infinityChunk(this.seed, n);
      this.cache.set(n, c);
      if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value as number);
    }
    return c;
  }
  private local(c: InfinityChunk): InfinityChunk { return shiftChunk(c, -this.origin.x, -this.origin.y); }

  /** The chunk index under local x (absolute x is local x plus the origin). */
  chunkAt(localX: number): number { return Math.max(0, Math.floor((localX + this.origin.x) / CHUNK_W)); }

  // ---------------------------------------------------------------- the track
  private planOf(chunks: InfinityChunk[]): CoursePlan {
    const floors = chunks.flatMap((c) => c.floors);
    let maxY = 0;
    for (const f of floors) maxY = Math.max(maxY, f.y0, f.y1);
    const left = chunks[0]?.x0 ?? 0, right = chunks[chunks.length - 1]?.x1 ?? CHUNK_W;
    return {
      seed: this.seed, originX: this.origin.x, originY: this.origin.y, style: 'flow', width: right, height: Math.round(maxY + 900), floors,
      bumps: chunks.flatMap((c) => c.bumps), gates: chunks.flatMap((c) => c.gates), ledges: chunks.flatMap((c) => c.ledges), springs: chunks.flatMap((c) => c.springs),
      loops: chunks.flatMap((c) => c.loops), bridges: chunks.flatMap((c) => c.bridges), boosts: chunks.flatMap((c) => c.boosts), kickers: chunks.flatMap((c) => c.kickers), rings: chunks.flatMap((c) => c.rings).filter((r) => !this.taken.has(r.id)),
      stands: [...new Map(chunks.flatMap((c) => c.stands).map((s) => [s.id, s])).values()],
      hoops: chunks.flatMap((c) => c.hoops), vents: chunks.flatMap((c) => c.vents), pits: chunks.flatMap((c) => c.pits),
      smashes: chunks.flatMap((c) => c.smashes).filter((s) => !this.taken.has(s.id)), smashFx: this.smashFx, itemBoxes: [], wreckers: [],
      path: [{ x: left, y: INF_START_Y - 30 }, { x: right, y: INF_START_Y - 30 }],
      startX: 520, startY: INF_START_Y, finishX: 1e12, finishY: 1e12,
    };
  }

  private trackOf(chunks: InfinityChunk[]): Track {
    const plan = this.planOf(chunks);
    const dummy = { bodies: [] as Matter.Body[], itemBoxes: [] as Matter.Body[], wreckers: [] as Matter.Body[] };
    void dummy;
    const gate = Matter.Bodies.rectangle(-2000, INF_START_Y - 200, 24, 400, { isStatic: true, collisionFilter: { category: CAT_WALL, mask: 0, group: 0 } });
    gate.plugin = { kind: 'gate', depth: 0 };
    const bodies = chunks.length ? chunks.flatMap((c) => planBodies(this.planOfOne(c)).bodies) : [];
    return {
      seed: this.seed, bodies, height: plan.height, segments: [{ name: 'Infinity', y: 0, h: plan.height }],
      spinners: [], turnstiles: [], itemBoxes: [], ramps: [], buckets: [], targetBanks: [], pegCount: { orange: 0, total: 0 },
      gate, startY: plan.startY - 30, finishY: plan.finishY, theme: this.theme, decor: [], wreckers: [],
      platformer: { plan, path: makePath(plan.path) },
    };
  }

  /** One chunk as a plan of its own (what `planBodies` builds from). */
  private planOfOne(c: InfinityChunk): CoursePlan { return { ...this.planOf([c]) }; }

  /** How many chunks to keep built ahead of and behind the ball's chunk: the screen's width, and the road at speed. */
  private windowSize(): { ahead: number; behind: number } {
    const vx = Math.abs(this.game.player.body.velocity.x);
    const ahead = Math.ceil((this.viewHalfWidth + vx * 90 + 600) / CHUNK_W);
    const behind = Math.ceil((this.viewHalfWidth + 400) / CHUNK_W);
    return { ahead: Math.max(CHUNKS_AHEAD, Math.min(12, ahead)), behind: Math.max(CHUNKS_BEHIND, Math.min(10, behind)) };
  }
  private lastWindow = '';

  /** Builds the chunks the ball needs, drops the ones behind it, and gives the Game a fresh Track and plan. */
  private refreshWindow(): void {
    const g = this.game;
    const here = this.chunkAt(g.player.body.position.x);
    const { ahead, behind } = this.windowSize();
    const want = new Set<number>();
    for (let n = Math.max(0, here - behind); n <= here + ahead; n++) want.add(n);
    let changed = false;
    for (const [n, live] of this.live) {
      if (want.has(n)) continue;
      Matter.Composite.remove(g.world, live.bodies);
      this.live.delete(n);
      changed = true;
    }
    for (const n of want) {
      if (this.live.has(n)) continue;
      const chunk = this.local(this.abs(n));
      const { bodies } = planBodies(this.planOfOne(chunk));
      Matter.Composite.add(g.world, bodies);
      this.live.set(n, { chunk, bodies });
      this.chunksBuilt++;
      changed = true;
    }
    if (!changed) return;
    const ordered = [...this.live.keys()].sort((a, b) => a - b).map((n) => this.live.get(n)!);
    const plan = this.planOf(ordered.map((l) => l.chunk));
    const track = g.track;
    track.bodies = ordered.flatMap((l) => l.bodies);
    track.height = plan.height;
    track.segments = [{ name: 'Infinity', y: 0, h: plan.height }];
    // A fresh Track object, so every cache keyed by it (element lists, bridge chains) rebuilds for the new window.
    g.track = { ...track, platformer: { plan, path: makePath(plan.path) } };
    g.bridgeCache = undefined;
  }

  // ---------------------------------------------------------------- stepping
  /** Steers, jumps and the Magic Engine are the Game's own inputs: `game.nudge`, `game.jumpPressed`, `game.engineHeld`. */
  step(dt: number = PHYSICS_STEP): void {
    // out of lives: the world stands still under the end screen (the fade clears, so the land shows behind it)
    if (this.over) { this.fade = Math.max(0, this.fade - dt / 900); return; }
    const g = this.game;
    g.step(dt);
    const m = g.player;
    const p = m.body.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { this.recover(true); return; }
    // The ground under the ball, in its lane: remembered while it is on it.
    const lane = (m.lane ?? 1) as Lane;
    const plan = g.track.platformer!.plan;
    const floorY = floorAt(plan, lane, p.x);
    if (floorY !== null && Math.abs(p.y + MARBLE_RADIUS - floorY) < 8) this.solid = { lane, x: p.x, y: floorY };
    const last = this.solid;
    // Dropped into a death pit: a life lost (and the run over at none).
    const pit = (plan.pits ?? []).find((o) => p.x > o.x0 - MARBLE_RADIUS && p.x < o.x1 + MARBLE_RADIUS);
    if (pit && p.y > this.pitLip(plan, lane, pit) + PIT_DEPTH) { this.loseLife(plan, lane, pit); return; }
    // Fallen: below the land under the ball (a chasm, or through the floor), judged against the ground at the ball's
    // own x. (It used to be the last ground touched: a fast ball flying a long way down the descending land counted as
    // a fall and was lifted back thousands of px: the owner's "reset when I go fast or far".)
    if (last && this.belowLand(plan, lane, p)) this.recover(false);
    // Wedged on a loop's ring (a slow ball that stopped on it): lifted back like a fall, after a few calm seconds.
    const slow = Math.hypot(m.body.velocity.x, m.body.velocity.y) < 0.6;
    this.wedged = (m.loopPhase ?? 0) === 1 && slow ? this.wedged + dt : 0;
    if (this.wedged > 2500) { this.wedged = 0; this.recover(false); }
    // Pushing on and going nowhere (wedged against something): lifted back after a few calm seconds. Standing still is fine.
    this.pinned = Math.abs(g.nudge) > 0.2 && slow ? this.pinned + dt : 0;
    if (this.pinned > 3000) { this.pinned = 0; this.recover(false); }
    // Gold rings: rolled or flown through in the ball's lane.
    const rings = plan.rings;
    if (rings?.length) {
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        if (r.lane !== lane || Math.abs(r.x - p.x) > RING_REACH || Math.abs(r.y - p.y) > RING_REACH) continue;
        if (Math.hypot(r.x - p.x, r.y - p.y) > RING_REACH) continue;
        rings.splice(i, 1);
        this.taken.add(r.id);
        this.rings++;
        g.sfx('pickup', m, r.x, r.y);
        g.effects.push({ type: 'ring', x: r.x, y: r.y, ttl: 18, maxTtl: 18, color: '#ffd34a' });
      }
    }
    this.toys(plan, lane);
    // Distance never goes backwards.
    this.distance = Math.max(this.distance, this.origin.x + p.x - this.startAbsX);
    if (this.distance > this.best) this.best = this.distance;
    this.fade = Math.max(0, this.fade - dt / 900);
    const size = this.windowSize();
    const key = `${this.chunkAt(p.x)}:${size.ahead}:${size.behind}`;
    if (key !== this.lastWindow) { this.lastWindow = key; this.refreshWindow(); }
    if (p.x > ORIGIN_STEP + CHUNK_W) this.shiftOrigin();
  }
  private wedged = 0;
  private pinned = 0;

  /** The lip of a pit in a lane: the higher of the ground at its two edges. */
  private pitLip(plan: CoursePlan, lane: Lane, pit: PitSpot): number {
    const a = floorAt(plan, lane, pit.x0 - 4), b = floorAt(plan, lane, pit.x1 + 4);
    return Math.min(a ?? b ?? pit.y, b ?? a ?? pit.y);
  }

  /**
   * A life lost in a pit. With lives left, the ball is set back down at the start of the pit's level run-up, rolling, so
   * it gets another go at the boost pad and the jump; with none, the run is over (it stays where it fell, the screen shows the end).
   */
  private loseLife(plan: CoursePlan, lane: Lane, pit: PitSpot): void {
    const g = this.game, m = g.player;
    this.lives = Math.max(0, this.lives - 1);
    this.livesLost++;
    this.fade = 1;
    g.sfx('ko', m, m.body.position.x, m.body.position.y);
    if (this.lives === 0) {
      this.over = true;
      Matter.Body.setVelocity(m.body, { x: 0, y: 0 });
      return;
    }
    let x = pit.x0 - 580;
    for (let i = 0; i < 40 && floorAt(plan, lane, x) === null; i++) x -= 40;
    const y = floorAt(plan, lane, x) ?? pit.y;
    m.lane = lane;
    m.laneFrom = lane;
    m.laneAt = undefined;
    applyLaneMask(g, m);
    Matter.Body.setPosition(m.body, { x, y: y - MARBLE_RADIUS - 6 });
    Matter.Body.setVelocity(m.body, { x: 9, y: -2 });
    Matter.Body.setAngularVelocity(m.body, 0);
    m.trail = [];
    // a jump pressed over the pit is not carried into the new life (it would hop the ball onto the ramp's face)
    m.jumpState = undefined;
    g.jumpPressed = false;
    this.solid = { lane, x, y };
  }

  /** Is the ball FALL_DEPTH below the land at its x (over a chasm: below the higher of the ground on either side)? */
  private belowLand(plan: CoursePlan, lane: Lane, p: { x: number; y: number }): boolean {
    let ground = floorAt(plan, lane, p.x);
    for (let d = 40; ground === null && d <= 800; d += 40) ground = floorAt(plan, lane, p.x - d) ?? floorAt(plan, lane, p.x + d);
    return ground !== null && p.y > ground + FALL_DEPTH;
  }

  /**
   * The owner's toys, for the ball in its lane: a smash crate bursts (no resistance: the ball keeps its speed), a fire
   * ring gives a burst of speed once per pass, an updraft lifts the ball up its column, a geyser throws it up while it
   * erupts (the first 0.9 s of every 3.2 s).
   */
  private toys(plan: CoursePlan, lane: Lane): void {
    const g = this.game, m = g.player, p = m.body.position, v = m.body.velocity;
    const smashes = plan.smashes;
    if (smashes?.length) {
      for (let i = smashes.length - 1; i >= 0; i--) {
        const s = smashes[i];
        if (s.lane !== lane || Math.abs(s.x - p.x) > 26 + MARBLE_RADIUS || p.y < s.y - 59 - MARBLE_RADIUS || p.y > s.y + 10) continue;
        smashes.splice(i, 1);
        this.taken.add(s.id);
        this.smashFx.push({ id: s.id, lane: s.lane, x: s.x, y: s.y, at: g.time, vx: v.x });
        g.sfx('smash', m, s.x, s.y - 30);
      }
    }
    this.smashFx = this.smashFx.filter((f) => g.time - f.at < 1400);
    plan.smashFx = this.smashFx;
    for (const o of plan.hoops ?? []) {
      if (o.lane !== lane || Math.hypot(o.x - p.x, o.y - p.y) > o.r) continue;
      if (g.time - (this.hoopAt.get(o.id) ?? -Infinity) < 700) continue;
      this.hoopAt.set(o.id, g.time);
      const speed = Math.hypot(v.x, v.y);
      const boosted = Math.min(20, Math.max(speed * 1.35, speed + 5));
      const ux = speed > 1 ? v.x / speed : 1, uy = speed > 1 ? v.y / speed : 0;
      Matter.Body.setVelocity(m.body, { x: ux * boosted, y: uy * boosted });
      g.sfx('hoop', m, o.x, o.y);
      g.effects.push({ type: 'ring', x: o.x, y: o.y, ttl: 22, maxTtl: 22, color: '#fb923c' });
    }
    for (const vent of plan.vents ?? []) {
      if (vent.lane !== lane || Math.abs(p.x - vent.x) > vent.w / 2 || p.y > vent.y || p.y < vent.y - vent.h) continue;
      if (vent.kind === 'updraft') Matter.Body.setVelocity(m.body, { x: v.x * 0.99, y: Math.max(-11, v.y - 0.55) });
      else if ((g.time % 3200) < 900) Matter.Body.setVelocity(m.body, { x: v.x * 0.9, y: Math.min(v.y, -15) });
    }
  }

  /** The distance in km, as the HUD shows it. */
  get km(): number { return this.distance / PX_PER_KM; }

  /** Lifts the ball gently back onto the last solid ground, a little behind where it fell: no penalty. */
  private recover(lost: boolean): void {
    const g = this.game, m = g.player;
    const spot = this.solid ?? { lane: 1 as Lane, x: 320, y: INF_START_Y };
    const lane = spot.lane;
    // A run-up behind the spot it fell from, on floor, so the ball has room to roll up to the same jump again.
    const plan = g.track.platformer!.plan;
    let x = lost ? spot.x : spot.x - 420;
    for (let i = 0; i < 40 && floorAt(plan, lane, x) === null; i++) x -= 40;
    const y = floorAt(plan, lane, x) ?? spot.y;
    m.lane = lane;
    m.laneFrom = lane;
    m.laneAt = undefined;
    applyLaneMask(g, m);
    Matter.Body.setPosition(m.body, { x, y: y - MARBLE_RADIUS - 6 });
    Matter.Body.setVelocity(m.body, { x: 8, y: -3 });
    Matter.Body.setAngularVelocity(m.body, 0);
    m.trail = [];
    this.fade = 1;
    this.falls++;
  }

  /** Shifts the world back by ORIGIN_STEP in x (and the land's own drift in y): everything near zero again. */
  private shiftOrigin(): void {
    const g = this.game, m = g.player;
    const dx = ORIGIN_STEP;
    const nx = this.origin.x + dx;
    const ny = Math.round(terrainY(this.seed, 1, nx)) - INF_START_Y;
    const dy = ny - this.origin.y;
    // The ball, its lane memory and the loops' state move with the world; the land is rebuilt around it.
    Matter.Body.translate(m.body, { x: -dx, y: -dy });
    for (const t of m.trail ?? []) { t.x -= dx; t.y -= dy; }
    if (this.solid) this.solid = { ...this.solid, x: this.solid.x - dx, y: this.solid.y - dy };
    for (const [, live] of this.live) Matter.Composite.remove(g.world, live.bodies);
    this.live.clear();
    this.origin = { x: nx, y: ny };
    this.lastWindow = '';
    this.originShifts++;
    this.lastShift = { dx: -dx, dy: -dy };
    for (const f of this.smashFx) { f.x -= dx; f.y -= dy; }
    this.refreshWindow();
  }

  /** The number of track bodies alive right now. */
  get bodyCount(): number { return this.game.track.bodies.length; }

  /** Everything that holds absolute positions: local plus origin. */
  absoluteX(): number { return this.origin.x + this.game.player.body.position.x; }

  destroy(): void { this.game.destroy(); }
}

void FLOOR_DEPTH;
