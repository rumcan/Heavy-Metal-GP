// P2-00 (#124): drawing a platformer course in three depth lanes.
// The camera stands on the player's lane (focus); only lanes behind it are drawn, smaller, higher, hazed and
// blurred (src/game/lanes.ts). Blur is cheap on phones: a lane behind is drawn into a half-size canvas and
// scaled back up. Art is a skin only: the physics bodies are the plain quads from build.ts.
import type { Game, Marble } from '../engine';
import { meta } from '../track';
import { laneFocus, laneView, visibleLanes, LANE_SWITCH_MS, LANE_MIDDLE } from '../lanes';
import { drawMarble } from '../render';
import type { LaneGate } from './course';

export interface PlatformCamera {
  x: number;
  y: number;
  scale: number;
  /** Camera depth: the lane it stands on (fractional during a lane change). */
  focus: number;
}

/** A marble's depth right now (fractional while its lane change runs). */
export function marbleDepth(game: Game, m: Marble): number {
  const lane = m.lane ?? LANE_MIDDLE;
  if (m.laneAt === undefined) return lane;
  return laneFocus(m.laneFrom ?? lane, lane, (game.time - m.laneAt) / LANE_SWITCH_MS);
}

/** Lane look: per-lane palette for the block art (top, face, dark underside). */
const PALETTE = [
  { top: '#8fb26a', grass: '#6f9a45', face: '#6b5a44', dark: '#3f3428', line: 'rgba(0,0,0,0.22)' },
  { top: '#7cc142', grass: '#5b9e2c', face: '#7a5c3c', dark: '#3d2c1c', line: 'rgba(0,0,0,0.25)' },
  { top: '#86cf3c', grass: '#62a92a', face: '#80613f', dark: '#3a2a1a', line: 'rgba(0,0,0,0.28)' },
];
const HAZE = '180,196,204';
const TILE = 32;

let offscreen: HTMLCanvasElement | null = null;
function scratch(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!offscreen) offscreen = document.createElement('canvas');
  if (offscreen.width !== w || offscreen.height !== h) { offscreen.width = w; offscreen.height = h; }
  const c = offscreen.getContext('2d');
  c?.setTransform(1, 0, 0, 1, 0, 0);
  c?.clearRect(0, 0, w, h);
  return c;
}

function sky(ctx: CanvasRenderingContext2D, cam: PlatformCamera, cw: number, ch: number) {
  const g = ctx.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, '#5d8fb8');
  g.addColorStop(0.55, '#a9c3cf');
  g.addColorStop(1, '#c9d6d2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  // Far hills and tree line: two silhouette bands that scroll slowly (they are scenery, not a lane).
  const bands = [
    { p: 0.06, y: 0.52, h: 0.22, c: 'rgba(120,148,160,0.75)', step: 260, amp: 0.55 },
    { p: 0.12, y: 0.62, h: 0.2, c: 'rgba(98,128,128,0.8)', step: 120, amp: 0.4 },
  ];
  for (const b of bands) {
    const off = -((cam.x * b.p) % (b.step * 8));
    ctx.beginPath();
    ctx.moveTo(0, ch);
    for (let x = off - b.step; x < cw + b.step; x += b.step / 4) {
      const k = (x - off) / b.step;
      const bump = Math.abs(Math.sin(k * 1.7) * Math.cos(k * 0.6));
      ctx.lineTo(x, ch * b.y - bump * ch * b.h * b.amp - Math.max(0, Math.sin(k * 7.3)) * ch * b.h * 0.25);
    }
    ctx.lineTo(cw, ch);
    ctx.closePath();
    ctx.fillStyle = b.c;
    ctx.fill();
  }
}

/** One floor block: grass top, earth face, tile seams, darker toward the bottom. */
function drawFloor(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, depth: number, lane: number, bottom: number) {
  const pal = PALETTE[lane];
  const yb = Math.min(Math.max(y0, y1) + depth, bottom);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1, yb);
  ctx.lineTo(x0, yb);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, Math.min(y0, y1), 0, yb);
  g.addColorStop(0, pal.face);
  g.addColorStop(Math.min(1, 220 / Math.max(1, yb - Math.min(y0, y1))), pal.dark);
  g.addColorStop(1, pal.dark);
  ctx.fillStyle = g;
  ctx.fill();
  // tile seams (vertical every TILE, horizontal rows following the top edge)
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = Math.ceil(x0 / TILE) * TILE; x < x1; x += TILE) { const t = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); ctx.moveTo(x, t); ctx.lineTo(x, Math.min(yb, t + 180)); }
  for (let r = 1; r * TILE < 180; r++) { ctx.moveTo(x0, y0 + r * TILE); ctx.lineTo(x1, y1 + r * TILE); }
  ctx.stroke();
  ctx.restore();
  // grass cap with a lighter lip
  ctx.beginPath();
  ctx.moveTo(x0 - 2, y0 - 3);
  ctx.lineTo(x1 + 2, y1 - 3);
  ctx.lineTo(x1 + 2, y1 + 9);
  ctx.lineTo(x0 - 2, y0 + 9);
  ctx.closePath();
  ctx.fillStyle = pal.grass;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x0 - 2, y0 - 3);
  ctx.lineTo(x1 + 2, y1 - 3);
  ctx.strokeStyle = pal.top;
  ctx.lineWidth = 4;
  ctx.stroke();
}

function drawBump(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#8a6a3e';
  ctx.fillRect(x, y, w, h + 6);
  ctx.strokeStyle = '#4a3820';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h + 3);
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4);
  ctx.lineTo(x + w - 4, y + h);
  ctx.moveTo(x + w - 4, y + 4);
  ctx.lineTo(x + 4, y + h);
  ctx.stroke();
}

function drawGate(ctx: CanvasRenderingContext2D, g: LaneGate, t: number, near: boolean) {
  const pulse = 0.55 + 0.45 * Math.sin(t / 220);
  const back = g.to < g.lane;
  if (g.kind === 'door') {
    const cx = g.x + g.w / 2;
    const top = g.y - 120;
    ctx.fillStyle = back ? '#1c1410' : '#2a1d12';
    ctx.beginPath();
    ctx.moveTo(cx - 44, g.y);
    ctx.lineTo(cx - 44, top + 40);
    ctx.arc(cx, top + 40, 44, Math.PI, 0);
    ctx.lineTo(cx + 44, g.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(255,214,102,${(near ? 0.9 : 0.5) * pulse})`;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = `rgba(255,214,102,${0.8 * pulse})`;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(back ? '↑ IN' : '↑ OUT', cx, top + 54);
  } else {
    // A ramp: chevrons on the ground pointing into (or out of) the screen.
    for (let i = 0; i < 3; i++) {
      const x = g.x + 24 + i * ((g.w - 48) / 2);
      const a = ((t / 140 + i) % 3) / 3;
      ctx.fillStyle = back ? `rgba(120,200,255,${0.35 + 0.5 * a})` : `rgba(255,170,90,${0.35 + 0.5 * a})`;
      ctx.beginPath();
      if (back) { ctx.moveTo(x - 18, g.y - 2); ctx.lineTo(x, g.y - 22); ctx.lineTo(x + 18, g.y - 2); }
      else { ctx.moveTo(x - 18, g.y - 22); ctx.lineTo(x, g.y - 2); ctx.lineTo(x + 18, g.y - 22); }
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawFinish(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const sq = 12;
  for (let r = 0; r < 18; r++) for (let c = 0; c < 2; c++) {
    ctx.fillStyle = (r + c) % 2 ? '#111' : '#f5f5f5';
    ctx.fillRect(x + c * sq, y - 220 + r * sq, sq, sq);
  }
  ctx.fillStyle = '#c33';
  ctx.fillRect(x - 6, y - 240, 4, 240);
}

/** Draw one lane's world (floors, bumps, gates, the finish) in world coordinates. */
function drawLaneWorld(ctx: CanvasRenderingContext2D, game: Game, lane: number, left: number, right: number, bottom: number, t: number) {
  const info = game.track.platformer!;
  for (const body of game.track.bodies) {
    const md = meta(body);
    if (md.kind !== 'floor' || md.lane !== lane) continue;
    if (body.bounds.max.x < left || body.bounds.min.x > right) continue;
    const v = body.vertices;
    if (v.length === 4 && md.depth !== undefined && md.depth > 100) drawFloor(ctx, v[0].x, v[0].y, v[1].x, v[1].y, md.depth, lane, bottom);
    else drawBump(ctx, body.bounds.min.x, body.bounds.min.y, body.bounds.max.x - body.bounds.min.x, md.depth ?? body.bounds.max.y - body.bounds.min.y);
  }
  const player = game.player;
  for (const g of info.plan.gates) {
    if (g.lane !== lane || g.x + g.w < left || g.x > right) continue;
    drawGate(ctx, g, t, Math.abs(player.body.position.x - (g.x + g.w / 2)) < 260);
  }
  if (info.plan.finishX > left && info.plan.finishX < right) drawFinish(ctx, info.plan.finishX, info.plan.finishY);
}

/** Render the race. `t` is the wall clock for animations. */
export function renderPlatformer(ctx: CanvasRenderingContext2D, game: Game, cam: PlatformCamera, cw: number, ch: number, t: number) {
  ctx.setTransform(ctx.getTransform().a, 0, 0, ctx.getTransform().d, 0, 0);
  const dpr = ctx.getTransform().a;
  sky(ctx, cam, cw, ch);
  const lanes = visibleLanes(cam.focus);
  const depths = game.marbles.filter((m) => !m.hold).map((m) => ({ m, z: marbleDepth(game, m) }));

  for (const lane of lanes) {
    const v = laneView(lane, cam.focus);
    const s = cam.scale * v.scale;
    const halfW = cw / 2 / s;
    const left = cam.x - halfW - 200;
    const right = cam.x + halfW + 200;
    const bottom = cam.y + (ch / 2 - v.lift * cam.scale) / s + 40;
    // Lanes behind are drawn at reduced resolution and scaled up: that is the blur.
    const k = v.blur > 0.4 ? Math.max(0.3, 1 / (1 + v.blur * 0.45)) : 1;
    const target = k < 1 ? scratch(Math.ceil(cw * dpr * k), Math.ceil(ch * dpr * k)) : ctx;
    if (!target) continue;
    const r = k < 1 ? dpr * k : dpr;
    target.save();
    target.setTransform(r, 0, 0, r, 0, 0);
    target.translate(cw / 2, ch / 2 + v.lift * cam.scale);
    target.scale(s, s);
    target.translate(-cam.x, -cam.y);
    drawLaneWorld(target, game, lane, left, right, bottom, t);
    // Marbles on this layer: depth in [lane, lane + 1) so a ball mid-change sits between the two layers.
    for (const { m, z } of depths) {
      if (z < lane || z >= lane + 1) continue;
      if (z !== lane) continue;
      drawBall(target, game, m, t);
    }
    target.restore();
    ctx.save();
    ctx.globalAlpha = v.alpha;
    if (k < 1 && offscreen) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(offscreen, 0, 0, cw * dpr, ch * dpr);
    }
    ctx.restore();
    if (v.fog > 0.01) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(${HAZE},${(v.fog * 0.6).toFixed(3)})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
    // Balls changing lane are drawn on top of the layer they are leaving or entering, at their own depth.
    for (const { m, z } of depths) {
      if (z <= lane || z >= lane + 1) continue;
      const mv = laneView(z, cam.focus);
      if (mv.alpha <= 0.01) continue;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = mv.alpha;
      ctx.translate(cw / 2, ch / 2 + mv.lift * cam.scale);
      ctx.scale(cam.scale * mv.scale, cam.scale * mv.scale);
      ctx.translate(-cam.x, -cam.y);
      drawBall(ctx, game, m, t);
      ctx.restore();
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawBall(ctx: CanvasRenderingContext2D, game: Game, m: Marble, t: number) {
  // contact shadow
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(m.body.position.x, m.body.position.y + 13, 12, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawMarble(ctx, game, m, t);
}

/** Where a marble is on screen (for name tags and chat bubbles). */
export function platformScreenPoint(game: Game, m: Marble, cam: PlatformCamera, cw: number, ch: number): { x: number; y: number; scale: number; visible: boolean } {
  const v = laneView(marbleDepth(game, m), cam.focus);
  const s = cam.scale * v.scale;
  return {
    x: cw / 2 + (m.body.position.x - cam.x) * s,
    y: ch / 2 + (m.body.position.y - cam.y) * s + v.lift * cam.scale,
    scale: s,
    visible: v.alpha > 0.5,
  };
}
