// P2-21: platformer routes: loops and rope bridges. A loop is a vertical ring a fast ball rides over the top of
// (a slow ball runs out of speed on the way up and rolls back out); a rope bridge is a sagging plank deck over a
// chasm that sways a little and gives under weight. Plain vector Matter bodies, like every floor in build.ts:
// the coaster skin only draws them (coaster.ts / render.ts call drawLoop and drawBridge below).
import Matter from 'matter-js';
import { CAT_LOOP_CLOSE, CAT_LOOP_UP, CAT_WALL } from '../track';
import type { Meta } from '../track';
import { laneCategory } from '../lanes';
import type { Lane } from './course';

/**
 * A loop ring in one lane. `x` is where the ride starts (the floor climbs away from here) and `y` the floor line
 * there. The ring is a helix, not a circle: it climbs the right side, crosses the top going left, comes down the left
 * side and leaves `pitch` further along the floor than it began, so entry and exit are side by side. Where the
 * climb and the return cross near the bottom, the two halves are on separate collision bits (CAT_LOOP_UP, then
 * CAT_LOOP_CLOSE): the marble's mask switches from the first to the second as it passes the top (see loopStep in
 * engine/platformer.ts), so it never meets the half it is not riding.
 */
export interface LoopSpot { lane: Lane; x: number; y: number; r: number; pitch: number }
export const LOOP_R = 90;
export const LOOP_PITCH = 140;
/** How thick the ribbon is, on the outside of the ride line. */
export const LOOP_THICK = 24;
/** Quads per full turn. */
const LOOP_STEPS = 48;
/** Flat floor the planner lays under a loop, and the run-up it wants before it. */
export const LOOP_RUN_UP = 300;
export const LOOP_RUN_OUT = 300;

/** A point on the ride line at turn angle `theta` (0 = the entry, 2π = the exit), with its outward normal. */
export function loopPoint(loop: LoopSpot, theta: number): { x: number; y: number; nx: number; ny: number } {
  return {
    x: loop.x + loop.r * Math.sin(theta) + (loop.pitch * theta) / (Math.PI * 2),
    y: loop.y - loop.r * (1 - Math.cos(theta)),
    nx: Math.sin(theta),
    ny: Math.cos(theta),
  };
}

/** The x range a loop's bodies and ride occupy. */
export function loopSpan(loop: LoopSpot): [number, number] {
  return [loop.x - loop.r - 40, loop.x + loop.pitch + loop.r + 40];
}

/** The box around a loop where its rules apply (generous: a ball flung over the top is still riding). */
export function inLoopBox(loop: LoopSpot, p: Matter.Vector): boolean {
  const [x0, x1] = loopSpan(loop);
  return p.x > x0 && p.x < x1 && p.y > loop.y - loop.r * 2 - 70 && p.y < loop.y + 60;
}

/** The ring's quads: the climb on CAT_LOOP_UP, the way back down on CAT_LOOP_CLOSE; both meet only their own lane. */
export function buildLoopBodies(loop: LoopSpot): Matter.Body[] {
  const out: Matter.Body[] = [];
  for (let k = 0; k < LOOP_STEPS; k++) {
    const a = loopPoint(loop, (k / LOOP_STEPS) * Math.PI * 2), b = loopPoint(loop, ((k + 1) / LOOP_STEPS) * Math.PI * 2);
    const points = [
      { x: a.x, y: a.y }, { x: b.x, y: b.y },
      { x: b.x + b.nx * LOOP_THICK, y: b.y + b.ny * LOOP_THICK }, { x: a.x + a.nx * LOOP_THICK, y: a.y + a.ny * LOOP_THICK },
    ];
    const centre = Matter.Vertices.centre(points);
    const body = Matter.Bodies.fromVertices(centre.x, centre.y, [points], {
      isStatic: true,
      friction: 0.002,
      frictionStatic: 0,
      restitution: 0,
      collisionFilter: { category: k < LOOP_STEPS / 2 ? CAT_LOOP_UP : CAT_LOOP_CLOSE, mask: laneCategory(loop.lane), group: 0 },
    });
    const now = Matter.Vertices.centre(body.vertices);
    Matter.Body.setPosition(body, { x: body.position.x + centre.x - now.x, y: body.position.y + centre.y - now.y });
    // depth -1 marks a loop quad: it is a floor to the engine (grounded, steering) but the skins draw the ring whole.
    body.plugin = { kind: 'floor', lane: loop.lane, depth: -1 } as Meta;
    out.push(body);
  }
  return out;
}

/** A rope bridge over a chasm: its deck runs from (x0, y0) to (x1, y1), both just above the floor at each end. */
export interface BridgeSpot { lane: Lane; x0: number; y0: number; x1: number; y1: number; planks: number; slack: number }
/** Plank thickness. */
export const PLANK_H = 9;

/** The deck's planks, built exactly like the classic map's rope bridge (the engine sags and sways them), in one lane. */
export function buildBridgeBodies(bridge: BridgeSpot): Matter.Body[] {
  const a = { x: bridge.x0, y: bridge.y0 }, b = { x: bridge.x1, y: bridge.y1 };
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const plankLen = (span / bridge.planks) * 1.35;
  const out: Matter.Body[] = [];
  for (let i = 0; i < bridge.planks; i++) {
    const t = (i + 0.5) / bridge.planks;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t + bridge.slack * 4 * t * (1 - t);
    const p = Matter.Bodies.rectangle(x, y, plankLen, PLANK_H, {
      isStatic: true, label: 'bridge', angle: Math.atan2(b.y - a.y, b.x - a.x), restitution: 0.15, friction: 0.01, chamfer: { radius: 2 },
      collisionFilter: { category: CAT_WALL, mask: laneCategory(bridge.lane), group: 0 },
    });
    p.plugin = { kind: 'bridge', lane: bridge.lane, bridge: { anchor: [a, b], plankLen, slack: bridge.slack, idx: i, n: bridge.planks }, baseY: y, sag: 0, sagVel: 0 } as Meta;
    out.push(p);
  }
  return out;
}

/** The deck height under `x` (the top of the planks as built, before any sag), or null off the bridge. */
export function bridgeDeckAt(bridge: BridgeSpot, x: number): number | null {
  if (x < bridge.x0 || x > bridge.x1) return null;
  const t = (x - bridge.x0) / (bridge.x1 - bridge.x0);
  return bridge.y0 + (bridge.y1 - bridge.y0) * t + bridge.slack * 4 * t * (1 - t) - PLANK_H / 2;
}

// ------------------------------------------------------------------ drawing (vector only, shared by both skins)

const WOOD = '#9a6a35', WOOD_DARK = '#4b2f15', WOOD_LIGHT = '#c99a5b';

/** The loop ring as a wooden coaster ribbon with cross-ties, on a pair of posts. */
export function drawLoop(ctx: CanvasRenderingContext2D, loop: LoopSpot): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const N = LOOP_STEPS * 2;
  // posts under the ring's feet
  ctx.fillStyle = WOOD_DARK;
  for (const px of [loop.x - loop.r * 0.5, loop.x + loop.pitch + loop.r * 0.6]) ctx.fillRect(px - 5, loop.y + 4, 10, 120);
  // the ribbon: a dark under-stroke, the plank colour over it, a light edge on the ride side
  const trace = (off: number) => {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = loopPoint(loop, (i / N) * Math.PI * 2);
      const x = p.x + p.nx * off, y = p.y + p.ny * off;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  };
  ctx.strokeStyle = WOOD_DARK; ctx.lineWidth = LOOP_THICK + 5; trace(LOOP_THICK / 2); ctx.stroke();
  ctx.strokeStyle = WOOD; ctx.lineWidth = LOOP_THICK - 3; trace(LOOP_THICK / 2); ctx.stroke();
  ctx.strokeStyle = WOOD_LIGHT; ctx.lineWidth = 3; trace(1.5); ctx.stroke();
  // cross-ties
  ctx.strokeStyle = 'rgba(40,22,8,0.7)';
  ctx.lineWidth = 2;
  for (let i = 0; i < N; i += 2) {
    const p = loopPoint(loop, ((i + 0.5) / N) * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(p.x + p.nx * 2, p.y + p.ny * 2);
    ctx.lineTo(p.x + p.nx * (LOOP_THICK - 2), p.y + p.ny * (LOOP_THICK - 2));
    ctx.stroke();
  }
  ctx.restore();
}

/** The deck of a rope bridge from its (moving) planks: ropes at the plank ends, then the planks, then the anchor posts. */
export function drawBridge(ctx: CanvasRenderingContext2D, planks: Matter.Body[]): void {
  if (!planks.length) return;
  const sorted = [...planks].sort((p, q) => p.position.x - q.position.x);
  ctx.save();
  ctx.lineCap = 'round';
  // handrail ropes: a little above the deck, following it
  for (const lift of [30, 12]) {
    ctx.strokeStyle = lift > 20 ? '#5b4426' : '#6f5530';
    ctx.lineWidth = lift > 20 ? 2.5 : 2;
    ctx.beginPath();
    sorted.forEach((p, i) => (i === 0 ? ctx.moveTo(p.position.x, p.position.y - lift) : ctx.lineTo(p.position.x, p.position.y - lift)));
    ctx.stroke();
  }
  // hangers between rope and deck
  ctx.strokeStyle = '#4b3a20';
  ctx.lineWidth = 1.5;
  for (const p of sorted) { ctx.beginPath(); ctx.moveTo(p.position.x, p.position.y - 30); ctx.lineTo(p.position.x, p.position.y - 4); ctx.stroke(); }
  for (const p of sorted) {
    const len = Math.hypot(p.vertices[1].x - p.vertices[0].x, p.vertices[1].y - p.vertices[0].y);
    ctx.save();
    ctx.translate(p.position.x, p.position.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(-len / 2, -PLANK_H / 2 - 1, len, PLANK_H + 2);
    ctx.fillStyle = WOOD;
    ctx.fillRect(-len / 2 + 1, -PLANK_H / 2, len - 2, PLANK_H - 1);
    ctx.fillStyle = 'rgba(255,230,170,0.3)';
    ctx.fillRect(-len / 2 + 1, -PLANK_H / 2, len - 2, 1.5);
    ctx.restore();
  }
  // anchor posts at both ends
  const first = sorted[0], last = sorted[sorted.length - 1];
  ctx.fillStyle = WOOD_DARK;
  for (const [p, side] of [[first, -1], [last, 1]] as const) ctx.fillRect(p.position.x + side * 6 - 4, p.position.y - 40, 8, 46);
  ctx.restore();
}
