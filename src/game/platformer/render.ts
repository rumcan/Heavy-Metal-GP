// P2-00 (#124): drawing a platformer course in three depth lanes.
// The camera stands on the player's lane (focus); only lanes behind it are drawn, smaller, higher, hazed and
// blurred (src/game/lanes.ts). Blur is cheap on phones: a lane behind is drawn into a half-size canvas and
// scaled back up. Art is a skin only: the physics bodies are the plain quads from build.ts.
import type { Game, Marble } from '../engine';
import { meta } from '../track';
import { laneFocus, laneView, visibleLanes, LANE_SWITCH_MS, LANE_MIDDLE } from '../lanes';
import { drawMarble } from '../render';
import { drawSkillWorld } from '../skills/draw';
import { SPRING_W, floorAt } from './course';
import type { CoursePlan, Floor, Lane, LaneGate } from './course';
import { drawCoasterLane } from './coaster';
import { drawRoutes } from './routes';
import { LEDGE_H } from './build';
import earthUrl from '../../assets/game/platformer/earth.webp';
import grassUrl from '../../assets/game/platformer/grass.webp';
import crateUrl from '../../assets/game/platformer/crate.webp';
import doorUrl from '../../assets/game/platformer/door.webp';
import farUrl from '../../assets/game/platformer/far.webp';
import treesUrl from '../../assets/game/platformer/trees.webp';
import signUrl from '../../assets/game/platformer/sign.webp';
import skyIslandsUrl from '../../assets/game/platformer/sky-islands.webp';
import cannonUrl from '../../assets/game/cannon.png';
import treesFrontUrl from '../../assets/game/platformer/trees-front.webp';
import { CANNON_LEN, CANNON_SPEED, muzzle } from '../engine/platformer';
import skyCloudsUrl from '../../assets/game/platformer/sky-clouds.webp';

// Generated art (P2-00): a skin over the vector bodies. Every draw falls back to flat shapes until it loads.
const load = (src: string) => (typeof Image !== 'undefined' ? Object.assign(new Image(), { src }) : null);
const ART = { earth: load(earthUrl), grass: load(grassUrl), crate: load(crateUrl), door: load(doorUrl), far: load(farUrl), trees: load(treesUrl), sign: load(signUrl), skyIslands: load(skyIslandsUrl), cannon: load(cannonUrl), treesFront: load(treesFrontUrl), skyClouds: load(skyCloudsUrl) };
const ready = (img: HTMLImageElement | null): img is HTMLImageElement => !!img && img.complete && img.naturalWidth > 0;
const patterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
function earthPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!ready(ART.earth)) return null;
  let p = patterns.get(ctx);
  if (!p) { p = ctx.createPattern(ART.earth, 'repeat') ?? undefined; if (p) patterns.set(ctx, p); }
  return p ?? null;
}
/** The grass strip is drawn this tall (world px), from GRASS_UP above the floor's top edge. */
const GRASS_H = 46;
const GRASS_UP = 18;

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
/** Lanes behind you fade into this: the backdrop's own mist. */
const HAZE = '150,188,238';
/** Screen px the backdrop rises per world px the course descends. */
const BACKDROP_DESCENT = 0.12;
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

function sky(ctx: CanvasRenderingContext2D, cam: PlatformCamera, cw: number, ch: number, startY: number) {
  const g = ctx.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, '#5d8fb8');
  g.addColorStop(0.55, '#a9c3cf');
  g.addColorStop(1, '#c9d6d2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  // The owner's painted backdrop: the sunny islands band on top, then the cloud-islands band repeating below it
  // for as far down as the course goes. It drifts slowly sideways and rises as you descend, so a race sinks from
  // the sky into the clouds. A band of mist covers each join between two bands.
  if (ready(ART.skyIslands) && ready(ART.skyClouds)) {
    const h = ch * 1.12;
    const top = -Math.max(0, cam.y - startY) * BACKDROP_DESCENT;
    const first = Math.max(0, Math.floor(-top / h));
    for (let row = first; top + row * h < ch; row++) {
      const img = row === 0 ? ART.skyIslands : ART.skyClouds;
      const y = top + row * h;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      let x = -(((cam.x * 0.03) + row * w * 0.37) % w);
      if (x > 0) x -= w;
      for (; x < cw; x += w) ctx.drawImage(img, x, y, w + 1, h + 1);
    }
    for (let row = Math.max(1, first); top + row * h - h * 0.1 < ch; row++) {
      const y = top + row * h;
      const mist = ctx.createLinearGradient(0, y - h * 0.1, 0, y + h * 0.1);
      mist.addColorStop(0, 'rgba(222,233,252,0)');
      mist.addColorStop(0.5, 'rgba(222,233,252,0.9)');
      mist.addColorStop(1, 'rgba(222,233,252,0)');
      ctx.fillStyle = mist;
      ctx.fillRect(0, y - h * 0.1, cw, h * 0.2);
    }
    return;
  }
  // Far mountains and the tree line: scenery, not a lane. They scroll very slowly and never change with depth.
  if (ready(ART.far) && ready(ART.trees)) {
    const strip = (img: HTMLImageElement, parallax: number, h: number, bottom: number) => {
      const w = (img.naturalWidth / img.naturalHeight) * h;
      let x = -((cam.x * parallax) % w);
      if (x > 0) x -= w;
      for (; x < cw; x += w) ctx.drawImage(img, x, bottom - h, w + 1, h);
    };
    strip(ART.far, 0.04, ch * 0.95, ch * 0.98);
    ctx.fillStyle = 'rgba(190,206,214,0.25)';
    ctx.fillRect(0, 0, cw, ch);
    strip(ART.trees, 0.12, ch * 0.55, ch * 1.02);
    ctx.fillStyle = `rgba(${HAZE},0.35)`;
    ctx.fillRect(0, 0, cw, ch);
    return;
  }
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
  const earth = earthPattern(ctx);
  if (earth && ready(ART.grass)) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, yb);
    ctx.lineTo(x0, yb);
    ctx.closePath();
    ctx.fillStyle = earth;
    ctx.fill();
    // darker the deeper it goes, and a shadow just under the grass
    const top = Math.min(y0, y1);
    const g = ctx.createLinearGradient(0, top, 0, Math.min(yb, top + 320));
    g.addColorStop(0, 'rgba(20,12,6,0.05)');
    g.addColorStop(0.12, 'rgba(20,12,6,0.25)');
    g.addColorStop(1, 'rgba(12,8,4,0.78)');
    ctx.fillStyle = g;
    ctx.fill();
    // block edges: a dark outline down both ends
    ctx.strokeStyle = 'rgba(25,15,8,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + 1.5, y0); ctx.lineTo(x0 + 1.5, yb);
    ctx.moveTo(x1 - 1.5, y1); ctx.lineTo(x1 - 1.5, yb);
    ctx.stroke();
    // grass along the top edge, tiled along its slope
    const len = Math.hypot(x1 - x0, y1 - y0);
    const img = ART.grass;
    const tw = (img.naturalWidth / img.naturalHeight) * GRASS_H;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
    ctx.beginPath();
    ctx.rect(-6, -GRASS_UP - 4, len + 12, GRASS_H + 8);
    ctx.clip();
    for (let u = -6 - ((x0 % tw) + tw) % tw; u < len + 6; u += tw) ctx.drawImage(img, u, -GRASS_UP, tw + 0.5, GRASS_H);
    ctx.restore();
    return;
  }
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
  if (ready(ART.crate)) {
    const n = Math.max(1, Math.round(w / h));
    const cw = w / n;
    for (let i = 0; i < n; i++) ctx.drawImage(ART.crate, x + i * cw, y, cw, h + 4);
    return;
  }
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
  if (g.kind === 'door' && ready(ART.door)) {
    const cx = g.x + g.w / 2;
    const h = 150;
    const w = (ART.door.naturalWidth / ART.door.naturalHeight) * h;
    ctx.drawImage(ART.door, cx - w / 2, g.y - h + 6, w, h);
    // the glow that says "press ↑ here"
    const glow = ctx.createRadialGradient(cx, g.y - h * 0.45, 4, cx, g.y - h * 0.45, h * 0.7);
    glow.addColorStop(0, `rgba(255,190,90,${(near ? 0.35 : 0.15) * pulse})`);
    glow.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - h, g.y - h * 1.2, h * 2, h * 1.3);
    if (near) {
      ctx.fillStyle = `rgba(255,224,150,${0.6 + 0.4 * pulse})`;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(back ? '↑ IN' : '↑ OUT', cx, g.y - h - 8);
    }
  } else if (g.kind === 'door') {
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
    // A ramp: a signpost before it saying where it goes, and chevrons on the ground pointing into (or out of) the screen.
    if (ready(ART.sign)) {
      const h = 104;
      const w = (ART.sign.naturalWidth / ART.sign.naturalHeight) * h;
      const sx = g.x - w * 0.55;
      const sy = g.y - h + 8;
      ctx.drawImage(ART.sign, sx, sy, w, h);
      ctx.fillStyle = back ? '#bfe6ff' : '#ffd2a1';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(back ? '↗ BACK' : '↘ FRONT', sx + w / 2, sy + h * 0.29);
      ctx.textBaseline = 'alphabetic';
    }
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

/** A one-way ledge: a plank walkway on two posts (art: `ledge.webp` when supplied, see docs/art). */
function drawLedge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, ground: (x: number) => number | null) {
  // posts down to the ground wherever there is ground under them (not over the chasm)
  ctx.fillStyle = '#4a3420';
  for (let px = x + 14; px < x + w - 14; px += 180) {
    const g = ground(px + 4);
    if (g !== null) ctx.fillRect(px, y + LEDGE_H, 8, g - y - LEDGE_H + 6);
  }
  ctx.fillStyle = '#8a6036';
  ctx.fillRect(x, y, w, LEDGE_H);
  ctx.fillStyle = '#a8784a';
  ctx.fillRect(x, y, w, 4);
  ctx.strokeStyle = '#3a2614';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, LEDGE_H - 2);
  ctx.beginPath();
  for (let px = x + 36; px < x + w - 10; px += 36) { ctx.moveTo(px, y + 2); ctx.lineTo(px, y + LEDGE_H - 2); }
  ctx.stroke();
}

/** A spring pad: a steel plate on a coil, squashed for a moment when it fires. */
function drawSpring(ctx: CanvasRenderingContext2D, x: number, y: number, firing: boolean) {
  const h = firing ? 26 : 14;
  ctx.strokeStyle = '#9aa4ad';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const yy = y - (h * i) / 4;
    ctx.lineTo(x + (i % 2 ? SPRING_W - 12 : 12), yy);
  }
  ctx.stroke();
  ctx.fillStyle = '#d63e2e';
  ctx.fillRect(x, y - h - 7, SPRING_W, 7);
  ctx.fillStyle = '#3a3f46';
  ctx.fillRect(x + 4, y - 3, SPRING_W - 8, 5);
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
  const flow = info.plan.style === 'flow';
  // Flow courses: the coaster skin (track on trestles over cliffs) once its art is loaded; until then the
  // slope as whole runs of earth and grass. Either way never thousands of little blocks.
  const fired = (sx: number) => game.marbles.some((m) => m.springAt !== undefined && game.time - m.springAt < 220 && (m.lane ?? 1) === lane && Math.abs(m.body.position.x - sx - SPRING_W / 2) < 80);
  const pieces = flow ? game.track.bodies.filter((b) => { const k = meta(b).kind; return (k === 'wrecker' || k === 'itembox' || k === 'boost' || k === 'bridge') && meta(b).lane === lane; }) : [];
  const coaster = flow && drawCoasterLane(ctx, info.plan, lane as Lane, left, right, bottom, t, fired, pieces);
  if (flow && !coaster) { drawFlowGround(ctx, info.plan, lane, left, right, bottom); drawRoutes(ctx, info.plan.loops, pieces, lane, left, right); }
  for (const body of game.track.bodies) {
    const md = meta(body);
    if (md.kind !== 'floor' || md.lane !== lane) continue;
    if (flow && md.depth !== undefined && (md.depth > 100 || md.depth < 0)) continue; // earth runs / loop rings are drawn whole elsewhere
    if (coaster) continue; // the coaster skin drew the crates
    if (body.bounds.max.x < left || body.bounds.min.x > right) continue;
    const v = body.vertices;
    if (v.length === 4 && md.depth !== undefined && md.depth > 100) drawFloor(ctx, v[0].x, v[0].y, v[1].x, v[1].y, md.depth, lane, bottom);
    else drawBump(ctx, body.bounds.min.x, body.bounds.min.y, body.bounds.max.x - body.bounds.min.x, md.depth ?? body.bounds.max.y - body.bounds.min.y);
  }
  if (!coaster) {
    for (const l of info.plan.ledges ?? []) if (l.lane === lane && l.x + l.w > left && l.x < right) drawLedge(ctx, l.x, l.y, l.w, (px) => floorAt(info.plan, l.lane, px));
    for (const s of info.plan.springs ?? []) if (s.lane === lane && s.x + SPRING_W > left && s.x < right) drawSpring(ctx, s.x, s.y, fired(s.x));
  }
  drawCannons(ctx, game, lane, t);
  drawSkillWorld(ctx, game, lane, t); // P2-08
  const player = game.player;
  for (const g of info.plan.gates) {
    if (g.lane !== lane || g.x + g.w < left || g.x > right) continue;
    drawGate(ctx, g, t, Math.abs(player.body.position.x - (g.x + g.w / 2)) < 260);
  }
  if (info.plan.finishX > left && info.plan.finishX < right) drawFinish(ctx, info.plan.finishX, info.plan.finishY);
}

/**
 * The start cannons in this lane: every racer's own, barrel at its aim. Your own still-loaded cannon shows where
 * the shot will go (a dotted arc).
 */
function drawCannons(ctx: CanvasRenderingContext2D, game: Game, lane: number, t: number) {
  for (const m of game.marbles) {
    const c = m.cannon;
    if (!c || c.lane !== lane) continue;
    if (!c.fired && m === game.player && m.info.isPlayer) {
      // the aim: the first part of the flight, dot by dot (gravity per 60 Hz tick, as Matter applies it)
      let p = muzzle(c), vx = Math.cos(c.angle) * CANNON_SPEED, vy = -Math.sin(c.angle) * CANNON_SPEED;
      ctx.fillStyle = 'rgba(255,236,170,0.9)';
      for (let i = 0; i < 36; i++) {
        p = { x: p.x + vx, y: p.y + vy };
        vy += 0.278;
        if (i % 3 === 2) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.2 - i * 0.05, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    // the carriage stays on the ground; only the barrel art tilts with the aim
    ctx.fillStyle = '#3a2a1c';
    ctx.beginPath(); ctx.moveTo(-20, 22); ctx.lineTo(0, -4); ctx.lineTo(20, 22); ctx.closePath(); ctx.fill();
    ctx.rotate(-c.angle);
    if (ready(ART.cannon)) {
      // the painted barrel sits between x 43 and 150 of the 192 px image: land it from breech to muzzle
      const img = ART.cannon;
      const sx = img.naturalWidth * (43 / 192), sw = img.naturalWidth * (107 / 192);
      ctx.drawImage(img, sx, 0, sw, img.naturalHeight, -16, -16, CANNON_LEN + 22, 32);
    } else {
      ctx.fillStyle = '#4b4b52';
      ctx.fillRect(-12, -11, CANNON_LEN + 14, 22);
    }
    ctx.restore();
    if (!c.fired) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 140);
      ctx.fillStyle = `rgba(255,190,80,${(0.25 + 0.3 * pulse).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** Each lane's floors joined into runs (the stretches between chasms) — one polygon per run. */
const runCache = new WeakMap<CoursePlan, { x: number; y: number }[][][]>();
function runsOf(plan: CoursePlan): { x: number; y: number }[][][] {
  let runs = runCache.get(plan);
  if (runs) return runs;
  runs = [0, 1, 2].map((lane) => {
    const floors = plan.floors.filter((f) => f.lane === lane).sort((a, b) => a.x0 - b.x0);
    const out: { x: number; y: number }[][] = [];
    let run: { x: number; y: number }[] = [];
    let last: Floor | null = null;
    for (const f of floors) {
      if (!last || Math.abs(f.x0 - last.x1) > 0.5) {
        if (run.length) out.push(run);
        run = [{ x: f.x0, y: f.y0 }];
      }
      run.push({ x: f.x1, y: f.y1 });
      last = f;
    }
    if (run.length) out.push(run);
    return out;
  });
  runCache.set(plan, runs);
  return runs;
}

/** A flow course's ground in one lane: the earth texture under the curve, the grass laid along it. */
function drawFlowGround(ctx: CanvasRenderingContext2D, plan: CoursePlan, lane: number, left: number, right: number, bottom: number) {
  const earth = earthPattern(ctx);
  const pal = PALETTE[lane];
  for (const run of runsOf(plan)[lane]) {
    if (run[run.length - 1].x < left || run[0].x > right) continue;
    let i0 = 0;
    while (i0 < run.length - 1 && run[i0 + 1].x < left) i0++;
    let i1 = run.length - 1;
    while (i1 > 0 && run[i1 - 1].x > right) i1--;
    const pts = run.slice(i0, i1 + 1);
    const top = Math.min(...pts.map((p) => p.y));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    ctx.lineTo(pts[pts.length - 1].x, bottom);
    ctx.lineTo(pts[0].x, bottom);
    ctx.closePath();
    ctx.fillStyle = earth ?? pal.face;
    ctx.fill();
    const g = ctx.createLinearGradient(0, top, 0, top + 420);
    g.addColorStop(0, 'rgba(20,12,6,0.12)');
    g.addColorStop(1, 'rgba(12,8,4,0.8)');
    ctx.fillStyle = g;
    ctx.fill();
    // run ends (chasm walls) get the same dark edge as a block
    ctx.strokeStyle = 'rgba(25,15,8,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (i0 === 0) { ctx.moveTo(pts[0].x + 1.5, pts[0].y); ctx.lineTo(pts[0].x + 1.5, bottom); }
    if (i1 === run.length - 1) { const e = pts[pts.length - 1]; ctx.moveTo(e.x - 1.5, e.y); ctx.lineTo(e.x - 1.5, bottom); }
    ctx.stroke();
    // grass: the strip texture laid piece by piece along the curve, continuing where the last piece stopped
    if (ready(ART.grass)) {
      const img = ART.grass;
      const tw = (img.naturalWidth / img.naturalHeight) * GRASS_H;
      const srcPerPx = img.naturalWidth / tw;
      let u = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
        let done = 0;
        while (done < len - 0.01) {
          // Snap a sliver at the end of the texture to its start, so every pass moves at least half a pixel.
          let at = (u + done) % tw;
          if (tw - at < 0.5) at = 0;
          const piece = Math.max(0.5, Math.min(len - done, tw - at));
          ctx.drawImage(img, at * srcPerPx, 0, Math.max(1, piece * srcPerPx), img.naturalHeight, done - 0.5, -GRASS_UP, piece + 1, GRASS_H);
          done += piece;
        }
        ctx.restore();
        u = (u + len) % tw;
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = pal.grass;
      ctx.lineWidth = 10;
      ctx.stroke();
    }
  }
}

/** Render the race. `followed` is the marble the camera is on (never hidden behind a layer). */
export function renderPlatformer(ctx: CanvasRenderingContext2D, game: Game, cam: PlatformCamera, cw: number, ch: number, t: number, followed: Marble = game.player) {
  ctx.setTransform(ctx.getTransform().a, 0, 0, ctx.getTransform().d, 0, 0);
  const dpr = ctx.getTransform().a;
  sky(ctx, cam, cw, ch, game.track.platformer!.plan.startY);
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
    // Marbles settled on this layer (a ball mid-change is drawn between layers, below).
    for (const { m, z } of depths) if (z === lane) drawBall(target, game, m, t);
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
      ctx.fillStyle = `rgba(${HAZE},${(v.fog * 0.72).toFixed(3)})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
    // Balls changing lane are drawn on top of the layer they are leaving or entering, at their own depth.
    for (const { m, z } of depths) {
      if (z <= lane || z >= lane + 1 || m === followed) continue;
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
  // The ball the camera follows is never hidden behind a layer: mid-dive it is drawn last, on top of everything.
  const own = depths.find((d) => d.m === followed);
  if (own && own.z !== Math.round(own.z)) {
    const mv = laneView(own.z, cam.focus);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(cw / 2, ch / 2 + mv.lift * cam.scale);
    ctx.scale(cam.scale * mv.scale, cam.scale * mv.scale);
    ctx.translate(-cam.x, -cam.y);
    drawBall(ctx, game, own.m, t);
    ctx.restore();
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  foreground(ctx, cam, cw, ch);
}

/**
 * The owner's blurred foreground pines: in front of everything along the bottom of the screen, scrolling faster
 * than the track (they are nearer than it). Kept low: their tops stop well below the middle, where your ball is.
 */
/** Per camera: how far the pines have scrolled (screen px) and where they sit vertically. */
const FG = new WeakMap<PlatformCamera, { camX: number; camY: number; scroll: number; lagY: number }>();
export const FG_PARALLAX = 1.35;

/**
 * Where the foreground pines are this frame. They used to sit at cam.x * cam.scale * 1.35 (mod their width): the
 * camera zooms out at speed, and a tiny zoom change times a world x in the tens of thousands threw them hundreds of
 * pixels at once. Now each frame scrolls them by that frame's camera movement only (at the current zoom), so a zoom
 * never moves them, a respawn or restart (a big jump) does not spin them, and they sway a little against vertical
 * motion and settle back, like something close to the lens.
 */
export function foregroundScroll(cam: PlatformCamera): { x: number; y: number } {
  let st = FG.get(cam);
  if (!st) { st = { camX: cam.x, camY: cam.y, scroll: 0, lagY: cam.y }; FG.set(cam, st); }
  const dx = cam.x - st.camX;
  if (Math.abs(dx) < 400) st.scroll += dx * cam.scale * FG_PARALLAX; // a bigger jump is a teleport: do not spin
  st.camX = cam.x;
  st.camY = cam.y;
  st.lagY += (cam.y - st.lagY) * 0.08;
  if (Math.abs(cam.y - st.lagY) > 600) st.lagY = cam.y;
  const y = Math.max(-24, Math.min(24, (st.lagY - cam.y) * cam.scale * 0.35));
  return { x: st.scroll, y };
}

function foreground(ctx: CanvasRenderingContext2D, cam: PlatformCamera, cw: number, ch: number) {
  const img = ART.treesFront;
  if (!ready(img)) return;
  const h = ch * 0.46;
  const w = (img.naturalWidth / img.naturalHeight) * h;
  const { x: scroll, y: sway } = foregroundScroll(cam);
  let x = -(((scroll % w) + w) % w);
  const y = ch - h * 0.82 + sway;
  for (; x < cw; x += w) ctx.drawImage(img, x, y, w + 1, h);
}

function drawBall(ctx: CanvasRenderingContext2D, game: Game, m: Marble, t: number) {
  // drawMarble is the shared renderer: its cached P2-18 ball skin and trail scale with this lane transform.
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
