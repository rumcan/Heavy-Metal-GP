// P2-00 (#124): drawing a platformer course in three depth lanes.
// The camera stands on the player's lane (focus); only lanes behind it are drawn, smaller, higher, hazed and
// blurred (src/game/lanes.ts). Blur is cheap on phones: a lane behind is drawn into a half-size canvas and
// scaled back up. Art is a skin only: the physics bodies are the plain quads from build.ts.
import type Matter from 'matter-js';
import type { Game, Marble } from '../engine';
import { drawImg } from '../mip';
import { meta } from '../track';
import { laneFocus, laneView, visibleLanes, LANE_SWITCH_MS, LANE_MIDDLE } from '../lanes';
import { drawBodies, drawBridgeChain, drawEffects, drawMarble } from '../render';
import { drawSkillWorld } from '../skills/draw';
import { GATE_RAMP_H, SPRING_W, floorAt } from './course';
import { ISLANDS, islandPick, islandPicture } from './islands';
import { ISLAND_CHANCE, busyStretches, forestLine, islandSpots, quietTest } from './forest';
import { artImage, artReady } from '../art';
import { afterArt } from '../preload';
import type { CoursePlan, Floor, Lane, LaneGate } from './course';
import { coasterReady, drawBeamPath, drawCoasterLane, drawGateRamp, groundedTrackAt } from './coaster';
import { drawCloudLedge, drawKicker } from './sky-art';
import { drawRoutes, setBridgeArt } from './routes';
import { LEDGE_H } from './build';
import earthUrl from '../../assets/game/platformer/earth.webp';
import grassUrl from '../../assets/game/platformer/grass.webp';
import crateUrl from '../../assets/game/platformer/crate.webp';
import doorUrl from '../../assets/game/platformer/door.webp';
import farUrl from '../../assets/game/platformer/far.webp';
import treesUrl from '../../assets/game/platformer/trees.webp';
import skyIslandsUrl from '../../assets/game/platformer/sky-islands.webp';
import cannonUrl from '../../assets/game/cannon.webp';
import treesFrontUrl from '../../assets/game/platformer/trees-front.webp';
import treesFront2Url from '../../assets/game/platformer/trees-front-2.webp';
import { CANNON_LEN, CANNON_SPEED, muzzle } from '../engine/platformer';
import skyCloudsUrl from '../../assets/game/platformer/sky-clouds.webp';
import airshipUrl from '../../assets/game/airship.webp';
import smashCrateUrl from '../../assets/game/smash-crate.webp';
import smashTopUrl from '../../assets/game/smash-crate-top.webp';
import smashBottomUrl from '../../assets/game/smash-crate-bottom.webp';
import { sprite } from '../sprites';

// rope bridges on flow courses and in Infinity: the Workshop's rope bridge art
setBridgeArt(drawBridgeChain);

// Generated art (P2-00): a skin over the vector bodies. Every draw falls back to flat shapes until it loads.
// Every picture goes through art.ts, so the warm-up (preload.ts) decodes it before a race draws it.
const load = (src: string, first = false) => artImage(src, first ? 0 : 1);
const ART = { earth: load(earthUrl), grass: load(grassUrl), crate: load(crateUrl), door: load(doorUrl), far: load(farUrl), trees: load(treesUrl), skyIslands: load(skyIslandsUrl, true), cannon: load(cannonUrl), treesFront: load(treesFrontUrl, true), treesFront2: load(treesFront2Url, true), skyClouds: load(skyCloudsUrl, true), airship: load(airshipUrl), smash: load(smashCrateUrl), smashTop: load(smashTopUrl), smashBottom: load(smashBottomUrl) };
const ready = artReady;
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
  /**
   * The zoom the foreground pines are sized by, when it differs from `scale` (Infinity: only your own zoom, not the
   * automatic speed zoom, so the trees hold still while the camera breathes; the owner).
   */
  fgScale?: number;
  /** Camera depth: the lane it stands on (fractional during a lane change). */
  focus: number;
  /** The floating islands in the foreground (on unless false: the Workshop leaves them out, they would cover the build). */
  islands?: boolean;
  /**
   * Infinity mode shifts its whole world back toward zero now and then (a floating origin). These are the world's
   * offset, so the backdrop keeps scrolling from where it was instead of jumping. Absent = 0.
   */
  originX?: number;
  originY?: number;
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

/**
 * Hot air balloons (the owner's art, the same goblin balloon the classic races fly): now and then one drifts across the
 * sky, at three distances (smaller, slower and hazier further off), bobbing gently. Placed by hash in each layer's own
 * scroll space, so a balloon stays where it is as you roll (and across Infinity's world shifts); at most a few at once.
 */
function balloons(ctx: CanvasRenderingContext2D, cam: PlatformCamera, cw: number, ch: number, t: number) {
  const img = ART.airship;
  if (!ready(img)) return;
  const aspect = img.naturalWidth / img.naturalHeight;
  const layers = [{ p: 0.05, size: 0.09, alpha: 0.6 }, { p: 0.09, size: 0.13, alpha: 0.78 }, { p: 0.14, size: 0.18, alpha: 0.92 }];
  layers.forEach((layer, li) => {
    const slot = cw * 0.9;
    // the layer's scroll: the camera at its parallax, plus a slow drift of its own
    const u = (cam.x + (cam.originX ?? 0)) * layer.p + t * 0.004 * (li + 1);
    for (let n = Math.floor(u / slot) - 1; n <= Math.floor((u + cw) / slot) + 1; n++) {
      if (balloonHash(n, li * 7 + 1) > 0.42) continue;
      const h = ch * layer.size * (0.85 + balloonHash(n, li * 7 + 2) * 0.3);
      const w = aspect * h;
      const x = n * slot + balloonHash(n, li * 7 + 3) * (slot - w) - u;
      const y = ch * (0.06 + balloonHash(n, li * 7 + 4) * 0.3) + Math.sin(t / 1600 + n * 1.7) * h * 0.04;
      if (x + w < 0 || x > cw) continue;
      ctx.globalAlpha = layer.alpha;
      drawImg(ctx, img, x, y, w, h);
    }
  });
  ctx.globalAlpha = 1;
}
function balloonHash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function sky(ctx: CanvasRenderingContext2D, cam: PlatformCamera, cw: number, ch: number, startY: number, t = 0) {
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
    const top = -Math.max(0, cam.y + (cam.originY ?? 0) - startY) * BACKDROP_DESCENT;
    const first = Math.max(0, Math.floor(-top / h));
    for (let row = first; top + row * h < ch; row++) {
      const img = row === 0 ? ART.skyIslands : ART.skyClouds;
      const y = top + row * h;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      let x = -((((cam.x + (cam.originX ?? 0)) * 0.03) + row * w * 0.37) % w);
      if (x > 0) x -= w;
      for (; x < cw; x += w) drawImg(ctx, img, x, y, w + 1, h + 1);
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
    balloons(ctx, cam, cw, ch, t);
    return;
  }
  // Far mountains and the tree line: scenery, not a lane. They scroll very slowly and never change with depth.
  if (ready(ART.far) && ready(ART.trees)) {
    const strip = (img: HTMLImageElement, parallax: number, h: number, bottom: number) => {
      const w = (img.naturalWidth / img.naturalHeight) * h;
      let x = -(((cam.x + (cam.originX ?? 0)) * parallax) % w);
      if (x > 0) x -= w;
      for (; x < cw; x += w) drawImg(ctx, img, x, bottom - h, w + 1, h);
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
    const off = -(((cam.x + (cam.originX ?? 0)) * b.p) % (b.step * 8));
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
    for (let u = -6 - ((x0 % tw) + tw) % tw; u < len + 6; u += tw) drawImg(ctx, img, u, -GRASS_UP, tw + 0.5, GRASS_H);
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
    for (let i = 0; i < n; i++) drawImg(ctx, ART.crate, x + i * cw, y, cw, h + 4);
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

/** A small, stable hash in 0..1 (the same shard flies the same way every frame). */
function toyHash(s: string, k: number): number {
  let h = k * 2654435761;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2246822519);
  h = Math.imul(h ^ (h >>> 15), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The lane an effect belongs to: that of the ball nearest it (within 200 px), else the camera's. */
function effectLane(game: Game, depths: { m: Marble; z: number }[], e: Game['effects'][number], focus: number): number {
  let best = 200 * 200, lane = Math.round(focus);
  for (const { m, z } of depths) {
    const dx = m.body.position.x - e.x, dy = m.body.position.y - e.y, d = dx * dx + dy * dy;
    if (d < best) { best = d; lane = Math.round(z); }
  }
  void game;
  return lane;
}

/**
 * Infinity's toys (the owner): vents (an iron grate; an updraft's rising streaks, a geyser's column when it erupts),
 * fire rings (the classic fire-hoop art, flickering), smash crates (the owner's stacked SMASH crates) and the ones
 * bursting: the two crates fly apart and tumble, planks and splinters scatter, a puff of dust, all fading in ~1 s.
 */
/** A death pit's warning: a wooden post with a yellow diamond and a black skull mark, which swings a little. */
function drawPitSign(ctx: CanvasRenderingContext2D, x: number, ground: number | null, t: number) {
  if (ground === null) return;
  ctx.save();
  ctx.translate(x, ground);
  ctx.fillStyle = '#5b3a1e';
  ctx.fillRect(-4, -92, 8, 92);
  ctx.translate(0, -92);
  ctx.rotate(Math.sin(t / 700 + x) * 0.04);
  ctx.beginPath();
  ctx.moveTo(0, -30); ctx.lineTo(30, 0); ctx.lineTo(0, 30); ctx.lineTo(-30, 0); ctx.closePath();
  ctx.fillStyle = '#facc15';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1c1917';
  ctx.stroke();
  // the skull: a round head, two eyes, teeth
  ctx.fillStyle = '#1c1917';
  ctx.beginPath(); ctx.arc(0, -4, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-6, 3, 12, 8);
  ctx.fillStyle = '#facc15';
  ctx.beginPath(); ctx.arc(-4, -5, 3, 0, Math.PI * 2); ctx.arc(4, -5, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-2, 6, 1.5, 5); ctx.fillRect(1, 6, 1.5, 5);
  ctx.restore();
}

/** A red-and-white hazard post at a pit's edge. */
function drawPitPost(ctx: CanvasRenderingContext2D, x: number, ground: number | null) {
  if (ground === null) return;
  ctx.save();
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = i % 2 ? '#f8fafc' : '#dc2626';
    ctx.fillRect(x - 5, ground - 50 + i * 10, 10, 10);
  }
  ctx.fillStyle = '#facc15';
  ctx.beginPath(); ctx.arc(x, ground - 54, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawToys(ctx: CanvasRenderingContext2D, game: Game, plan: CoursePlan, lane: number, left: number, right: number, t: number) {
  // Infinity's death pits: a warning sign before the run-up, and red-and-white posts at both edges of the hole.
  for (const pit of plan.pits ?? []) {
    if (pit.x1 + 100 < left || pit.x0 - 800 > right) continue;
    drawPitSign(ctx, pit.x0 - 640, floorAt(plan, lane as Lane, pit.x0 - 640), t);
    drawPitPost(ctx, pit.x0 - 6, floorAt(plan, lane as Lane, pit.x0 - 6));
    drawPitPost(ctx, pit.x1 + 6, floorAt(plan, lane as Lane, pit.x1 + 6));
  }
  for (const v of plan.vents ?? []) {
    if (v.lane !== lane || v.x + v.w < left || v.x - v.w > right) continue;
    ctx.save();
    if (v.kind === 'updraft') {
      // a soft column of rising air, and streaks drifting up it
      const col = ctx.createLinearGradient(0, v.y - v.h, 0, v.y);
      col.addColorStop(0, 'rgba(200,235,255,0)');
      col.addColorStop(1, 'rgba(200,235,255,0.28)');
      ctx.fillStyle = col;
      ctx.fillRect(v.x - v.w / 2, v.y - v.h, v.w, v.h);
      ctx.strokeStyle = 'rgba(235,248,255,0.85)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 10; i++) {
        const k = ((t / 800 + i / 10) % 1);
        const x = v.x - v.w / 2 + 8 + ((i * 37) % (v.w - 16));
        const y = v.y - k * v.h;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
        ctx.beginPath();
        ctx.moveTo(x, y + 40);
        ctx.quadraticCurveTo(x + Math.sin(t / 300 + i) * 10, y + 20, x, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else {
      const phase = game.time % 3200;
      if (phase < 900) {
        // the eruption: a column of water and steam, highest mid-burst
        const k = Math.sin((phase / 900) * Math.PI);
        const top = v.y - v.h * k;
        const g = ctx.createLinearGradient(0, top, 0, v.y);
        g.addColorStop(0, 'rgba(235,248,255,0)');
        g.addColorStop(0.25, 'rgba(225,244,255,0.75)');
        g.addColorStop(1, 'rgba(170,215,240,0.9)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(v.x - v.w * 0.3, v.y);
        ctx.quadraticCurveTo(v.x - v.w * 0.45, (v.y + top) / 2, v.x - v.w * 0.15, top);
        ctx.lineTo(v.x + v.w * 0.15, top);
        ctx.quadraticCurveTo(v.x + v.w * 0.45, (v.y + top) / 2, v.x + v.w * 0.3, v.y);
        ctx.closePath();
        ctx.fill();
      } else {
        // a wisp of steam between eruptions
        ctx.fillStyle = 'rgba(230,240,248,0.35)';
        const k = (t / 1400) % 1;
        ctx.beginPath();
        ctx.arc(v.x, v.y - 20 - k * 50, 8 + k * 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // the grate (the classic geyser vent art where it has loaded)
    const vent = sprite('geyser');
    if (vent) drawImg(ctx, vent, v.x - 30, v.y - 30, 60, 38);
    else { ctx.fillStyle = '#2b2f36'; ctx.fillRect(v.x - v.w / 2, v.y - 10, v.w, 12); }
    ctx.restore();
  }
  const hoop = sprite('fire-hoop');
  for (const o of plan.hoops ?? []) {
    if (o.lane !== lane || o.x + o.r * 3 < left || o.x - o.r * 3 > right) continue;
    if (!hoop) continue;
    // the art's hole: 251 px across, centred at (200, 269); the ring only (the stand is cut off at row 418)
    const s = ((o.r * 2) / 251) * (1 + Math.sin(t / 140 + o.x) * 0.02);
    drawImg(ctx, hoop, 0, 0, 400, 418, o.x - 200 * s, o.y - 269 * s, 400 * s, 418 * s);
  }
  const crate = ART.smash;
  for (const c of plan.smashes ?? []) {
    if (c.lane !== lane || c.x + 40 < left || c.x - 40 > right || !ready(crate)) continue;
    drawImg(ctx, crate, c.x - 26, c.y - 59 + 4, 52, 59);
  }
  for (const f of plan.smashFx ?? []) {
    if (f.lane !== lane || f.x + 400 < left || f.x - 400 > right) continue;
    const ms = game.time - f.at, k = ms / 16.67, fade = Math.max(0, 1 - ms / 1300);
    if (fade <= 0) continue;
    ctx.save();
    ctx.globalAlpha = fade;
    // dust puff
    ctx.fillStyle = 'rgba(190,160,120,0.5)';
    ctx.beginPath();
    ctx.arc(f.x, f.y - 26, 14 + Math.min(60, k * 3), 0, Math.PI * 2);
    ctx.fill();
    // the two crates fly apart and tumble
    const halves: [HTMLImageElement | null, number, number, number, number][] = [
      [ART.smashTop, f.vx * 0.7 + 2.5, -8, 0.09, 30],
      [ART.smashBottom, f.vx * 0.45 + 1, -4.5, -0.06, 0],
    ];
    for (const [img, vx, vy, spin, lift] of halves) {
      if (!ready(img)) continue;
      const x = f.x + vx * k, y = f.y - 15 - lift + vy * k + 0.28 * k * k;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spin * k);
      drawImg(ctx, img, -26, -15, 52, 30);
      ctx.restore();
    }
    // planks and splinters
    for (let i = 0; i < 12; i++) {
      const a = toyHash(f.id, i), b = toyHash(f.id, i + 50);
      const vx = f.vx * 0.5 + (a - 0.5) * 12, vy = -3 - b * 9;
      const x = f.x + vx * k, y = f.y - 30 + vy * k + 0.3 * k * k;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((a - 0.5) * k * 0.6);
      ctx.fillStyle = i % 3 === 0 ? '#5a3a1e' : '#9a6a3a';
      ctx.fillRect(-(4 + a * 10), -2, 8 + a * 20, 3 + b * 2);
      ctx.restore();
    }
    ctx.restore();
  }
}

/**
 * Gold rings (Infinity): each spins about its upright axis (its width breathes with the cosine of the turn), bobs a
 * little, and glows. A gold gradient band with a bright inner edge, so it reads as a polished ring at any zoom.
 */
function drawRings(ctx: CanvasRenderingContext2D, plan: CoursePlan, lane: number, left: number, right: number, t: number) {
  const rings = plan.rings;
  if (!rings?.length) return;
  const R = 17;
  ctx.save();
  for (const r of rings) {
    if (r.lane !== lane || r.x < left - R || r.x > right + R) continue;
    const spin = t / 380 + r.x / 97;
    const rx = Math.max(2.5, R * Math.abs(Math.cos(spin)));
    const y = r.y + Math.sin(t / 520 + r.x / 60) * 3;
    const glow = ctx.createRadialGradient(r.x, y, 2, r.x, y, R * 2.1);
    glow.addColorStop(0, 'rgba(255,214,90,0.38)');
    glow.addColorStop(1, 'rgba(255,214,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(r.x - R * 2.1, y - R * 2.1, R * 4.2, R * 4.2);
    const band = ctx.createLinearGradient(r.x - rx, y - R, r.x + rx, y + R);
    band.addColorStop(0, '#fff4b0');
    band.addColorStop(0.45, '#ffc93a');
    band.addColorStop(1, '#a8650c');
    ctx.lineWidth = 6;
    ctx.strokeStyle = band;
    ctx.beginPath();
    ctx.ellipse(r.x, y, rx, R, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255,255,240,0.85)';
    ctx.beginPath();
    ctx.ellipse(r.x, y, Math.max(1, rx - 2.5), R - 2.5, 0, Math.PI * 1.05, Math.PI * 1.75);
    ctx.stroke();
  }
  ctx.restore();
}

function drawGate(ctx: CanvasRenderingContext2D, plan: CoursePlan, g: LaneGate, t: number, near: boolean) {
  const pulse = 0.55 + 0.45 * Math.sin(t / 220);
  const back = g.to < g.lane;
  if (g.kind === 'door' && ready(ART.door)) {
    const cx = g.x + g.w / 2;
    const h = 150;
    const w = (ART.door.naturalWidth / ART.door.naturalHeight) * h;
    drawImg(ctx, ART.door, cx - w / 2, g.y - h + 6, w, h);
    // the glow that says "press ↑ here"
    const glow = ctx.createRadialGradient(cx, g.y - h * 0.45, 4, cx, g.y - h * 0.45, h * 0.7);
    glow.addColorStop(0, `rgba(255,190,90,${(near ? 0.35 : 0.15) * pulse})`);
    glow.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - h, g.y - h * 1.2, h * 2, h * 1.3);
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
  } else {
    // A ramp is a jump ramp (the owner): the wedge in the kicker's art and chevrons up its slope pointing into (or out
    // of) the screen. No signboards (the owner).
    drawGateRamp(ctx, plan, g);
    const y0 = floorAt(plan, g.lane as Lane, g.x) ?? g.y, y1 = floorAt(plan, g.lane as Lane, g.x + g.w) ?? y0;
    const slope = (x: number) => y0 + ((y1 - GATE_RAMP_H - y0) * (x - g.x)) / g.w;
    // Big, outlined chevrons standing on the track (green = up to the back lane, amber = down to the front), sweeping
    // in the direction they point. They used to be faint blue and half hidden by the beam.
    ctx.save();
    ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const x = g.x + 26 + i * ((g.w - 52) / 2);
      const a = ((t / 140 + i) % 3) / 3;
      const base = slope(x) - 10, tip = base - 32;
      ctx.beginPath();
      if (back) { ctx.moveTo(x - 22, base); ctx.lineTo(x, tip); ctx.lineTo(x + 22, base); ctx.lineTo(x, base - 12); }
      else { ctx.moveTo(x - 22, tip); ctx.lineTo(x, base); ctx.lineTo(x + 22, tip); ctx.lineTo(x, tip + 12); }
      ctx.closePath();
      ctx.shadowColor = back ? 'rgba(74,222,128,0.9)' : 'rgba(251,191,36,0.9)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = back ? `rgba(74,222,128,${0.6 + 0.4 * a})` : `rgba(251,191,36,${0.6 + 0.4 * a})`;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,20,12,0.85)';
      ctx.stroke();
    }
    ctx.restore();
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
/** Perf: a lane's bodies by what draws them, sorted once per track instead of scanning every body every frame. */
type LaneLists = { pieces: Matter.Body[]; floors: Matter.Body[]; classic: Matter.Body[]; classicStill: Matter.Body[]; classicLive: Matter.Body[] };

/**
 * Perf: classic pieces that never move, change or break are painted once into the lane's cached scenery, not every
 * frame (a Block fills a big texture pattern: twenty of them in view took the menu preview from 130 fps to 20).
 */
const CLASSIC_STILL = new Set(['block', 'ice', 'ramp', 'wall', 'loop', 'sign']);
// keyed by the body array (and its length): Infinity mode replaces the array as it adds land
const laneListCache = new WeakMap<object, { n: number; per: LaneLists[] }>();
function laneLists(game: Game, lane: number) {
  const hit = laneListCache.get(game.track.bodies);
  let per = hit && hit.n === game.track.bodies.length ? hit.per : null; // Infinity swaps the array as it builds land
  if (!per) {
    per = [0, 1, 2].map((l) => {
      const mine = game.track.bodies.filter((b) => meta(b).lane === l);
      // A Workshop piece built by the classic Builder (md.classic) is drawn only by the classic drawer, with its own art.
      const own = mine.filter((b) => !(meta(b) as { classic?: boolean }).classic);
      return {
        pieces: own.filter((b) => { const k = meta(b).kind; return k === 'wrecker' || k === 'itembox' || k === 'boost' || k === 'bridge'; }),
        floors: own.filter((b) => meta(b).kind === 'floor'),
        classic: mine.filter((b) => (meta(b) as { classic?: boolean }).classic),
        classicStill: mine.filter((b) => (meta(b) as { classic?: boolean }).classic && CLASSIC_STILL.has(meta(b).kind) && b.isStatic),
        classicLive: mine.filter((b) => (meta(b) as { classic?: boolean }).classic && !(CLASSIC_STILL.has(meta(b).kind) && b.isStatic)),
      };
    });
    laneListCache.set(game.track.bodies, { n: game.track.bodies.length, per });
  }
  return per[lane] ?? per[1];
}

/** Perf: a lane's unchanging scenery is cached ('static'); what moves is drawn every frame ('dynamic'). */
type LanePart = 'all' | 'static' | 'dynamic';

function drawLaneWorld(ctx: CanvasRenderingContext2D, game: Game, lane: number, left: number, right: number, bottom: number, t: number, part: LanePart = 'all') {
  const info = game.track.platformer!;
  const flow = info.plan.style === 'flow';
  if (part === 'static') {
    // only ever asked for once the coaster art is loaded (see laneCache)
    drawCoasterLane(ctx, info.plan, lane as Lane, left, right, bottom, t, () => false, [], 'static');
    const still = laneLists(game, lane).classicStill;
    if (still.length) drawBodies(ctx, game, still, { viewTop: -1e9, viewBottom: 1e9, viewLeft: left, viewRight: right }, t, { withStatic: true, piecesOnly: true });
    if (info.plan.finishX > left && info.plan.finishX < right) drawFinish(ctx, info.plan.finishX, info.plan.finishY);
    return;
  }
  // Flow courses: the coaster skin (track on trestles over cliffs) once its art is loaded; until then the
  // slope as whole runs of earth and grass. Either way never thousands of little blocks.
  const fired = (sx: number) => game.marbles.some((m) => m.springAt !== undefined && game.time - m.springAt < 220 && (m.lane ?? 1) === lane && Math.abs(m.body.position.x - sx - SPRING_W / 2) < 80);
  const lists = laneLists(game, lane);
  const pieces = flow ? lists.pieces : [];
  const coaster = flow && drawCoasterLane(ctx, info.plan, lane as Lane, left, right, bottom, t, fired, pieces, part === 'dynamic' ? 'dynamic' : 'all');
  if (flow && !coaster) { drawFlowGround(ctx, info.plan, lane, left, right, bottom); drawRoutes(ctx, info.plan.loops, pieces, lane, left, right); }
  for (const body of lists.floors) {
    const md = meta(body);
    if (flow && md.depth !== undefined && (md.depth > 100 || md.depth < 0)) continue; // earth runs / loop rings are drawn whole elsewhere
    if (coaster) continue; // the coaster skin drew the crates
    if (body.bounds.max.x < left || body.bounds.min.x > right) continue;
    const v = body.vertices;
    if (v.length === 4 && md.depth !== undefined && md.depth > 100) drawFloor(ctx, v[0].x, v[0].y, v[1].x, v[1].y, md.depth, lane, bottom);
    else drawBump(ctx, body.bounds.min.x, body.bounds.min.y, body.bounds.max.x - body.bounds.min.x, md.depth ?? body.bounds.max.y - body.bounds.min.y);
  }
  if (!coaster) {
    for (const k of info.plan.kickers ?? []) if (k.lane === lane && k.x + k.w > left && k.x < right) drawKicker(ctx, info.plan, k);
    for (const l of info.plan.ledges ?? []) if (l.lane === lane && l.x + l.w > left && l.x < right) { if (l.cloud !== undefined) drawCloudLedge(ctx, l); else drawLedge(ctx, l.x, l.y, l.w, (px) => floorAt(info.plan, l.lane, px)); }
    for (const s of info.plan.springs ?? []) if (s.lane === lane && s.x + SPRING_W > left && s.x < right) drawSpring(ctx, s.x, s.y, fired(s.x));
  }
  // P2-26: the classic pieces in this lane, with their drop-track art.
  // (in the 'dynamic' part the still ones are already in the cached scenery)
  const classic = part === 'dynamic' ? lists.classicLive : lists.classic;
  if (classic.length) drawBodies(ctx, game, classic, { viewTop: -1e9, viewBottom: 1e9, viewLeft: left, viewRight: right }, t, { withStatic: true, piecesOnly: true });
  drawCannons(ctx, game, lane, t);
  drawSkillWorld(ctx, game, lane, t); // P2-08
  drawRings(ctx, info.plan, lane, left, right, t);
  drawToys(ctx, game, info.plan, lane, left, right, t);
  const player = game.player;
  for (const g of info.plan.gates) {
    if (g.lane !== lane || g.x + g.w < left || g.x > right) continue;
    drawGate(ctx, info.plan, g, t, Math.abs(player.body.position.x - (g.x + g.w / 2)) < 260);
  }
  if (part === 'all' && info.plan.finishX > left && info.plan.finishX < right) drawFinish(ctx, info.plan.finishX, info.plan.finishY);
}

/**
 * Perf: each lane's static scenery (cliffs, towers, trestles, the beam, crates, ledges, the finish) rendered once into
 * an off-screen canvas a little larger than the view, at the lane's current zoom, and copied to the screen every
 * frame. It is redrawn only when the camera nears its edge, the zoom drifts more than a few per cent, or the course
 * changes. Redrawing all of it every frame cost ~7 ms per lane (up to three lanes).
 */
interface LaneCache { cv: HTMLCanvasElement; spare: HTMLCanvasElement; plan: CoursePlan; ox: number; oy: number; wx: number; wy: number; px: number; want: number; w: number; h: number }
const laneCaches = new WeakMap<CanvasRenderingContext2D, Map<number, LaneCache>>();
/** One early refresh per frame at most, so lanes never all rebuild on the same frame (that was a 30 ms hitch). */
const refreshedAt = new WeakMap<CanvasRenderingContext2D, number>();
let frameNo = 0;
const CACHE_MAX_PX = 3072;

function sized(cv: HTMLCanvasElement, w: number, h: number) {
  // Keep a canvas's size whenever it is big enough (and not wastefully big): resizing throws its GPU texture away.
  if (cv.width < w || cv.height < h || cv.width > w * 1.5 || cv.height > h * 1.5) {
    cv.width = Math.min(CACHE_MAX_PX, Math.ceil(w / 256) * 256);
    cv.height = Math.min(CACHE_MAX_PX, Math.ceil(h / 256) * 256);
  }
}

/** Draw the lane's static scenery into `cc` (origin ox, oy at `px` device px per unit), clipped to a world strip. */
function paintStatic(cc: CanvasRenderingContext2D, game: Game, lane: number, c: { ox: number; oy: number; wy: number; px: number }, x0: number, x1: number, t: number) {
  cc.save();
  cc.setTransform(c.px, 0, 0, c.px, -c.ox * c.px, -c.oy * c.px);
  cc.beginPath();
  cc.rect(x0, c.oy, x1 - x0, c.wy);
  cc.clip();
  cc.imageSmoothingQuality = 'high';
  drawLaneWorld(cc, game, lane, x0 - 200, x1 + 200, c.oy + c.wy + 40, t, 'static');
  cc.restore();
}

/**
 * The lane's static scenery, cached. When the view nears the cache's edge the picture is SHIFTED (copied over by a whole
 * number of device pixels, so nothing blurs) and only the newly revealed strip is drawn: about a third of a full
 * redraw, done early and at most one lane per frame, so a fast screen (8 ms a frame) never hitches on it.
 */
function cachedLane(ctx: CanvasRenderingContext2D, game: Game, lane: number, view: { x0: number; x1: number; y0: number; y1: number }, pxWanted: number, t: number): LaneCache | null {
  if (typeof document === 'undefined') return null;
  const plan = game.track.platformer!.plan;
  let byLane = laneCaches.get(ctx);
  if (!byLane) { byLane = new Map(); laneCaches.set(ctx, byLane); }
  const c = byLane.get(lane);
  // Compare with the resolution asked for when it was drawn (a big screen caps the cache below it: that is fine).
  const ratio = c ? pxWanted / c.want : 0;
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
  const inside = (padX: number, padY: number) => !!c && view.x0 - vw * padX >= c.ox && view.x1 + vw * padX <= c.ox + c.wx
    && view.y0 - vh * padY >= c.oy && view.y1 + vh * padY <= c.oy + c.wy;
  const sameZoom = !!c && c.plan === plan && ratio > 0.9 && ratio < 1.1;
  const usable = sameZoom && inside(0, 0);
  if (usable && (inside(0.12, 0.08) && ratio > 0.96 && ratio < 1.04 || refreshedAt.get(ctx) === frameNo)) return c!;
  refreshedAt.set(ctx, frameNo);

  // Where the cache should sit now: a little behind, plenty ahead (the race runs to the right), roomy above and below.
  let ox = view.x0 - vw * 0.15, oy = view.y0 - vh * 0.3;
  const wx = vw * 1.7, wy = vh * 1.6;
  const px = Math.min(pxWanted, CACHE_MAX_PX / wx, CACHE_MAX_PX / wy);
  const w = Math.ceil(wx * px), h = Math.ceil(wy * px);

  // Shift: same zoom, same size, only moved sideways (vertical drift is small: the margins absorb it).
  if (c && sameZoom && Math.abs(px - c.px) < 1e-9 && w === c.w && h === c.h && Math.abs(oy - c.oy) < vh * 0.2) {
    const dxPx = Math.round((ox - c.ox) * px);
    if (dxPx !== 0 && Math.abs(dxPx) < w * 0.8) {
      ox = c.ox + dxPx / px;
      oy = c.oy; // keep the vertical placement (no resample)
      const next: LaneCache = { ...c, cv: c.spare, spare: c.cv, ox, oy };
      const cc = next.cv.getContext('2d');
      if (cc) {
        sized(next.cv, w, h);
        cc.setTransform(1, 0, 0, 1, 0, 0);
        cc.clearRect(0, 0, next.cv.width, next.cv.height);
        cc.drawImage(c.cv, 0, 0, w, h, -dxPx, 0, w, h);
        // the revealed strip (with a little overlap so its seam is drawn whole)
        const pad = 2 / px;
        if (dxPx > 0) paintStatic(cc, game, lane, next, c.ox + c.wx - pad, ox + wx, t);
        else paintStatic(cc, game, lane, next, ox, c.ox + pad, t);
        byLane.set(lane, next);
        return next;
      }
    }
  }

  // Full redraw: first time, a zoom change, or a big jump.
  const cv = c?.cv ?? document.createElement('canvas');
  const spare = c?.spare ?? document.createElement('canvas');
  sized(cv, w, h);
  const cc = cv.getContext('2d');
  if (!cc) return null;
  cc.setTransform(1, 0, 0, 1, 0, 0);
  cc.clearRect(0, 0, cv.width, cv.height);
  const next: LaneCache = { cv, spare, plan, ox, oy, wx, wy, px, want: pxWanted, w, h };
  paintStatic(cc, game, lane, next, ox, ox + wx, t);
  byLane.set(lane, next);
  return next;
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
      drawImg(ctx, img, sx, 0, sw, img.naturalHeight, -16, -16, CANNON_LEN + 22, 32);
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
    const floors = plan.floors.filter((f) => f.lane === lane && !f.hidden).sort((a, b) => a.x0 - b.x0);
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
          drawImg(ctx, img, at * srcPerPx, 0, Math.max(1, piece * srcPerPx), img.naturalHeight, done - 0.5, -GRASS_UP, piece + 1, GRASS_H);
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

/**
 * Crossing tracks: where a ball rides a track that passes behind another, the zone is painted again back to front:
 * each passage's beam, then the balls riding it. So a ball on the back track passes behind the front one.
 */
function drawOverpasses(ctx: CanvasRenderingContext2D, game: Game, lane: number, left: number, right: number, depths: { m: Marble; z: number }[], t: number) {
  const plan = game.track.platformer!.plan;
  if (!plan.crossings?.length || !coasterReady()) return;
  plan.crossings.forEach((zone, zi) => {
    if (zone.lane !== lane || zone.x1 < left || zone.x0 > right) return;
    const balls = depths.filter(({ m, z }) => z === lane && m.passage?.zone === zi).map(({ m }) => m);
    if (!balls.length) return;
    const depthOf = (id: number) => zone.passages.find((P) => P.id === id)?.depth ?? -1;
    const front = Math.max(...zone.passages.map((P) => P.depth));
    if (balls.every((m) => depthOf(m.passage!.id) === front)) return; // nobody is behind another track
    ctx.save();
    ctx.beginPath();
    ctx.rect(zone.x0, zone.y0 - 40, zone.x1 - zone.x0, zone.y1 - zone.y0 + 80);
    ctx.clip();
    for (const P of [...zone.passages].sort((a, b) => a.depth - b.depth)) {
      const sources = new Set(P.runs.map(([li]) => plan.tracks![li].source));
      for (const beam of plan.beams ?? []) if (beam.source !== undefined && sources.has(beam.source)) drawBeamPath(ctx, beam);
      for (const m of balls) if (m.passage!.id === P.id) drawBall(ctx, game, m, t);
    }
    ctx.restore();
  });
}

/** Render the race. `followed` is the marble the camera is on (never hidden behind a layer). */
export function renderPlatformer(ctx: CanvasRenderingContext2D, game: Game, cam: PlatformCamera, cw: number, ch: number, t: number, followed: Marble = game.player) {
  frameNo++;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // backgrounds are stretched on big screens: the best filter is least grainy
  ctx.setTransform(ctx.getTransform().a, 0, 0, ctx.getTransform().d, 0, 0);
  const dpr = ctx.getTransform().a;
  sky(ctx, cam, cw, ch, game.track.platformer!.plan.startY, t);
  // only the lanes this course has (a Workshop course may have 1 or 2)
  const lanes = courseLanes(game.track.platformer!.plan, cam.focus);
  const depths = game.marbles.filter((m) => !m.hold || m.hold.kind === 'cart').map((m) => ({ m, z: marbleDepth(game, m) }));

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
    const flowArt = game.track.platformer!.plan.style === 'flow' && coasterReady();
    const lift = v.lift * cam.scale;
    const cache = flowArt && target === ctx
      ? cachedLane(ctx, game, lane, { x0: cam.x - cw / 2 / s, x1: cam.x + cw / 2 / s, y0: cam.y + (-ch / 2 - lift) / s, y1: cam.y + (ch / 2 - lift) / s }, s * dpr, t)
      : null;
    if (cache) {
      target.imageSmoothingQuality = 'high';
      target.drawImage(cache.cv, 0, 0, cache.w, cache.h, cache.ox, cache.oy, cache.wx, cache.wy);
      drawLaneWorld(target, game, lane, left, right, bottom, t, 'dynamic');
    } else drawLaneWorld(target, game, lane, left, right, bottom, t);
    // Marbles settled on this layer (a ball mid-change is drawn between layers, below).
    for (const { m, z } of depths) if (z === lane) drawBall(target, game, m, t);
    drawOverpasses(target, game, lane, left, right, depths, t);
    // the game's effects (hits, pickups, hoop flashes, debris) that belong to this lane: the lane of the ball nearest
    // each one (effects carry no lane), so a hit in another lane is not drawn on yours
    drawEffects(target, game, (e) => effectLane(game, depths, e, cam.focus) === lane);
    target.restore();
    ctx.save();
    ctx.globalAlpha = v.alpha;
    if (k < 1 && offscreen) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      drawImg(ctx, offscreen, 0, 0, cw * dpr, ch * dpr);
    }
    ctx.restore();
    if (v.fog > 0.01) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgba(${HAZE},${(v.fog * 0.72).toFixed(3)})`;
      ctx.fillRect(0, 0, cw, ch);
      ctx.restore();
    }
    // Between this track and the next one in front: a layer of the same pines (the owner: trees between the tracks too,
    // every layer moving at its own speed).
    const nearer = lanes[lanes.indexOf(lane) + 1];
    if (nearer !== undefined) betweenTrees(ctx, game, cam, cw, ch, dpr, lane, nearer);
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
  foreground(ctx, cam, cw, ch, game.track.platformer?.plan);
}

/**
 * The owner's blurred foreground pines: in front of everything along the bottom of the screen, scrolling faster
 * than the track (they are nearer than it). Kept low: their tops stop well below the middle, where your ball is.
 */
/**
 * A layer of pines between two tracks: at a depth between them (it slides sideways faster than the far track and
 * slower than the near one), standing just under the far track as it lies on screen (glued to it column by column, so
 * it never moves against it), its rows reaching down behind the near track's cliff. It fades with the near track (a
 * track in front of the camera fades out mid lane change).
 */
function betweenTrees(ctx: CanvasRenderingContext2D, game: Game, cam: PlatformCamera, cw: number, ch: number, dpr: number, far: number, near: number) {
  const img = ART.treesFront;
  const plan = game.track.platformer?.plan;
  if (!ready(img) || !plan) return;
  const vf = laneView(far, cam.focus), vn = laneView(near, cam.focus);
  if (vn.alpha <= 0.01) return;
  const p = Math.sqrt(vf.scale * vn.scale);
  const sf = cam.scale * vf.scale, sp = cam.scale * p;
  // sideways: its own scroll, at its depth
  let st = BETWEEN.get(cam);
  if (!st) { st = { camX: cam.x, scrolls: [0, 0] }; BETWEEN.set(cam, st); }
  const dx = cam.x - st.camX;
  if (Math.abs(dx) < 400 && far === Math.min(far, 1)) st.scrolls[far] += dx * sp;
  if (far === lastBetweenLane(cam, plan)) st.camX = cam.x;
  // up and down: glued to the far track on screen
  const COL = 24, cols = Math.ceil(cw / COL) + 2;
  const line = new Float32Array(cols);
  let held = ch / 2 + vf.lift * cam.scale;
  let first = -1;
  for (let c = 0; c < cols; c++) {
    const y = floorAt(plan, far as Lane, cam.x + (c * COL - cw / 2) / sf) ?? groundUnder(plan, far as Lane, cam.x + (c * COL - cw / 2) / sf);
    if (y !== null) { held = ch / 2 + vf.lift * cam.scale + (y - cam.y) * sf; if (first < 0) first = c; }
    line[c] = held;
  }
  if (first > 0) for (let c = 0; c < first; c++) line[c] = line[first]; // left of the first ground: its height, not the screen's
  const lineAt = (sx: number) => { const f = Math.max(0, Math.min(cols - 1.001, sx / COL)); const c = Math.floor(f); return line[c] + (line[c + 1] - line[c]) * (f - c); };
  const aspect = img.naturalWidth / img.naturalHeight;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = vn.alpha;
  BETWEEN_ROWS.forEach((r, i) => {
    // distance: hazed like the track behind them (a little less for each nearer row) and softly out of focus
    const look = betweenLook(vf, i);
    const height = r.h * sp, rw = aspect * height;
    const pines = hazePines(img, look.haze, (i + far) % 2 === 0, look.blur, 0, height * dpr);
    const scroll = st!.scrolls[far] * (1 + i * 0.04);
    ctx.fillStyle = pines.floor;
    const start = tileStart(cam, `b${far}:${i}`, scroll, rw, cw);
    for (let rx = start.x, id = start.id; rx < cw; rx += rw, id++) {
      const tile = pineTile(id, `b${far}:${i}`, (i + far) % 2 === 0);
      const art = hazePines(tile.img, look.haze, tile.flip, look.blur, 0, height * dpr);
      drawStrip(ctx, art.c, rx, rw, height, cw, ch, (sx) => lineAt(sx) + r.drop * sf, i === BETWEEN_ROWS.length - 1);
    }
  });
  ctx.restore();
}
/**
 * Where a row's first tile starts on screen. The row's scroll is kept in whole tiles (a scroll step divided by the
 * tile width at that moment), and the tiles are laid out from the screen's centre: a zoom (which changes the tile
 * width) grows the row about the centre and never slides it sideways (the owner); rolling slides it at its speed.
 */
const PHASES = new WeakMap<PlatformCamera, Map<string, { last: number; phase: number }>>();
function tileStart(cam: PlatformCamera, key: string, scroll: number, rw: number, cw: number): { x: number; id: number } {
  let rows = PHASES.get(cam);
  if (!rows) { rows = new Map(); PHASES.set(cam, rows); }
  let st = rows.get(key);
  if (!st) { st = { last: scroll, phase: 0 }; rows.set(key, st); }
  st.phase += (scroll - st.last) / rw;
  st.last = scroll;
  let x = cw / 2 - (((st.phase % 1) + 1) % 1) * rw;
  let id = Math.floor(st.phase); // the tile starting at x: the same tile keeps its id as the row scrolls
  while (x > 0) { x -= rw; id--; }
  return { x, id };
}

/**
 * Which of the owner's pine strips a tile shows, and mirrored or not (the owner: break up the uniformity): picked by a
 * hash of the tile's own id and its row, so a tile keeps its look as it scrolls. Falls back to the first strip until
 * the second has loaded.
 */
function pineTile(id: number, row: string, flipRow: boolean): { img: HTMLImageElement; flip: boolean } {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  for (let i = 0; i < row.length; i++) h = Math.imul(h ^ row.charCodeAt(i), 0xc2b2ae35);
  h ^= h >>> 15;
  const second = ready(ART.treesFront2) && (h & 1) === 1;
  return { img: (second ? ART.treesFront2 : ART.treesFront)!, flip: ((h >>> 1) & 1) === 1 ? !flipRow : flipRow };
}

/** The lanes to draw this frame: those behind the camera (visibleLanes) that this course has. */
function courseLanes(plan: CoursePlan, focus: number): number[] {
  return visibleLanes(focus).filter((l) => !plan.lanes || plan.lanes.includes(l));
}

/** The rows of a layer of pines between two tracks: their drop below the far track and their height (world px). */
const BETWEEN_ROWS: readonly { drop: number; h: number }[] = [{ drop: 70, h: 170 }, { drop: 120, h: 185 }, { drop: 170, h: 200 }];
/** A between-tracks row's look: hazed like the track behind it (a little less for each nearer row) and a little soft. */
function betweenLook(vf: { fog: number; blur: number }, i: number): { haze: number; blur: number } {
  return { haze: (0.12 + vf.fog * 0.75) * (1 - i * 0.18), blur: 1 + vf.blur * 1.2 - i * 0.4 };
}
/** Per camera: how far each between-tracks layer has scrolled (screen px), by its far lane. */
const BETWEEN = new WeakMap<PlatformCamera, { camX: number; scrolls: number[] }>();
/** The nearest-to-the-camera far lane that has a between layer this frame (its call moves the shared camera memory on). */
function lastBetweenLane(cam: PlatformCamera, plan: CoursePlan): number {
  const lanes = courseLanes(plan, cam.focus);
  return lanes.length >= 2 ? lanes[lanes.length - 2] : -1;
}

/** Per camera: how far each row of pines has scrolled (screen px) and where they sit vertically. */
const FG = new WeakMap<PlatformCamera, { camX: number; camY: number; scrolls: number[]; lagY: number }>();

/**
 * The foreground forest (the owner: many rows, bigger and lower as you zoom in): rows of the owner's pines, back to
 * front. Each row is at parallax depth p and measured in world px (its height, and its drop below your track), so on
 * screen it is p times the zoom: zoom in and every row grows and moves down, the near ones most, like real depth.
 * The back row starts about 100 px below the track (the owner: the track, its supports and the cliff tops show).
 */
const PINE_ROWS: readonly { p: number; h: number; drop: number }[] = [
  { p: 1.03, h: 170, drop: 102 },
  { p: 1.07, h: 185, drop: 112 },
  { p: 1.12, h: 200, drop: 123 },
  { p: 1.17, h: 215, drop: 134 },
  { p: 1.23, h: 235, drop: 145 },
  { p: 1.29, h: 260, drop: 156 },
  { p: 1.35, h: 290, drop: 168 },
];
export const FG_PARALLAX = PINE_ROWS[PINE_ROWS.length - 1].p;
/**
 * Zoomed out, the forest goes on toward you: past the front row, nearer and bigger rows still, as many as it takes to
 * reach the bottom of the screen (no black band under the trees). Row i of them all.
 */
const PINE_EXTRA = 12;
function pineRow(i: number): { p: number; h: number; drop: number } {
  if (i < PINE_ROWS.length) return PINE_ROWS[i];
  const k = i - PINE_ROWS.length + 1, front = PINE_ROWS[PINE_ROWS.length - 1];
  return { p: front.p + 0.08 * k, h: front.h + 35 * k, drop: front.drop + 18 * k };
}
const PINE_ALL = PINE_ROWS.length + PINE_EXTRA;
/**
 * How out of focus a foreground row at depth p is (px at the art's size), and how much darker: sharp and bright near the
 * track, the front rows nearest the lens clearly soft and a little in shade (the owner: blur the front row for the
 * perspective and make it slightly darker).
 */
const pineBlur = (p: number) => Math.max(0, (p - 1.18) * 22);
const pineDark = (p: number) => Math.max(0, Math.min(0.42, (p - 1.2) * 1.3));

/**
 * Where the foreground pines are this frame. They used to sit at cam.x * cam.scale * 1.35 (mod their width): the
 * camera zooms out at speed, and a tiny zoom change times a world x in the tens of thousands threw them hundreds of
 * pixels at once. Now each frame scrolls each row by that frame's camera movement only (at the current zoom and its
 * depth), so a zoom never slides them, and a respawn or restart (a big jump) does not spin them.
 */
export function foregroundScroll(cam: PlatformCamera): { x: number; y: number; rows: number[] } {
  let st = FG.get(cam);
  if (!st) { st = { camX: cam.x, camY: cam.y, scrolls: Array.from({ length: PINE_ALL }, () => 0), lagY: cam.y }; FG.set(cam, st); }
  const dx = cam.x - st.camX;
  if (Math.abs(dx) < 400) for (let i = 0; i < PINE_ALL; i++) st.scrolls[i] += dx * cam.scale * pineRow(i).p; // a bigger jump is a teleport: do not spin
  st.camX = cam.x;
  st.camY = cam.y;
  st.lagY += (cam.y - st.lagY) * 0.08;
  if (Math.abs(cam.y - st.lagY) > 600) st.lagY = cam.y;
  const y = Math.max(-24, Math.min(24, (st.lagY - cam.y) * cam.scale * 0.35));
  return { x: st.scrolls[PINE_ROWS.length - 1], y, rows: st.scrolls };
}

/**
 * Where the pines stand: below the main (middle) track under the camera, so they stay at the same height relative to
 * the track (a jump lifts the ball and the camera, not the trees). The track height is eased so the line of trees
 * follows the course's slopes smoothly instead of every bump, and it holds over a chasm.
 */
/** The world moved by (dx, dy) under this camera (Infinity's floating origin): carry the foreground's memory along. */
export function shiftForeground(cam: PlatformCamera, dx: number, dy: number): void {
  const st = FG.get(cam);
  if (!st) return;
  st.camX += dx; st.camY += dy; st.lagY += dy;
}

/**
 * The ground of `lane` at `x`, smoothed over a few hundred px (the hill, not every bump or a chasm): what the
 * Infinity camera frames and the foreground pines stand on. null where there is no ground near.
 */
export function groundUnder(plan: CoursePlan, lane: Lane, x: number): number | null {
  let sum = 0, n = 0;
  for (let d = -240; d <= 240; d += 120) { const y = floorAt(plan, lane, x + d); if (y !== null) { sum += y; n++; } }
  return n ? sum / n : null;
}

/**
 * The track the camera stands on, at world `x`: the focused lane's floor (mid lane change, the two lanes' floors
 * blended by the camera's depth), the smoothed ground over a chasm. The Infinity camera locks to it and the
 * foreground pines are glued to it on screen, so the two can never drift apart (the owner: trees must not move
 * against the track, on any lane). null with no ground near.
 */
export function trackLineY(plan: CoursePlan, focus: number, x: number): number | null {
  const f = Math.max(0, Math.min(2, focus));
  const l0 = Math.floor(f) as Lane, l1 = Math.min(2, l0 + 1) as Lane, t = f - l0;
  const at = (l: Lane) => floorAt(plan, l, x) ?? groundUnder(plan, l, x);
  const y0 = at(l0);
  if (t < 1e-3) return y0;
  const y1 = at(l1);
  if (y0 === null) return y1;
  if (y1 === null) return y0;
  return y0 + (y1 - y0) * t;
}

/** The rows' drops are measured below the forest's line less this (world px). */
const CLIFF_RISE = 130;
/**
 * How far below the track the forest's line lies, in your own zoom (world px at fgScale): the back row's tips about a
 * hundred px under the track. It used to be the cliff under the track (150 to 280 px lower, varying along the course),
 * measured in the camera's speed zoom: the tree line rose and fell as you sped up and slowed down (the owner).
 */
const FOREST_DEPTH = 130;

/** The track the pines follow: the focused lane's, standing on the ground (two lanes blended through a lane change). */
function groundLineY(plan: CoursePlan, focus: number, x: number): number | null {
  const f = Math.max(0, Math.min(2, focus));
  const l0 = Math.floor(f) as Lane, l1 = Math.min(2, l0 + 1) as Lane, t = f - l0;
  const y0 = groundedTrackAt(plan, l0, x);
  if (t < 1e-3) return y0;
  const y1 = groundedTrackAt(plan, l1, x);
  if (y0 === null) return y1;
  if (y1 === null) return y0;
  return y0 + (y1 - y0) * t;
}

/** Where nothing is going on on a course (forest.ts busyStretches), worked out once per plan (Infinity makes a fresh one as its land streams in). */
const quietCache = new WeakMap<CoursePlan, (x0: number, x1: number) => boolean>();
function quietOf(plan: CoursePlan): (x0: number, x1: number) => boolean {
  let q = quietCache.get(plan);
  if (!q) { q = quietTest(busyStretches(plan)); quietCache.set(plan, q); }
  return q;
}

/** Where the track sits below the screen's centre while the ball rolls (the camera frames the ball 10 px above it). */
const FG_TRACK_BELOW = 15;

/**
 * The owner's pines (bright and sharp as painted), mirrored for every other row so the rows never line up, washed with
 * distance haze (0..0.8, the sky's colour), softened by `blur` (px at the art's size) and shaded by `dark` for their
 * depth: the layers between the tracks are hazed and a little soft, the foreground rows nearest the lens out of focus
 * and a little darker. Each look is drawn once (the values are rounded, so there are few) and kept; `floor` is the
 * colour of their feet, for the band under them.
 *
 * Perf: the cache is per picture (a WeakMap), never keyed by the picture's src (in the published single-file game
 * that is a data URL hundreds of KB long: building and hashing it for every tile of every row each frame was a real
 * cost). The looks are ordinary canvases (the GPU draws them; a canvas made for reading pixels back is drawn slowly),
 * and their foot colour is worked out from the picture's own, read once, rather than read back from every look.
 */
interface PineLook { c: HTMLCanvasElement; floor: string; used: number; haze: number; blur: number; dark: number; h: number; flip: boolean }
const pineLooks = new WeakMap<HTMLImageElement, Map<string, PineLook>>();
let pineLookCount = 0, pineLookClock = 0;
/** Looks kept at most (a lane change sweeps the haze through a few; zoomed out, the extra rows each have their own). */
const PINE_LOOKS_KEEP = 96;
const footColour = new WeakMap<HTMLImageElement, [number, number, number]>();
/** The average colour of a picture's solid pixels along its bottom (read once per picture, on a small copy). */
function footOf(img: HTMLImageElement): [number, number, number] {
  let rgb = footColour.get(img);
  if (rgb) return rgb;
  rgb = [21, 35, 38];
  try {
    const w = 96, h = 6;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, Math.floor(img.naturalHeight * 0.9), img.naturalWidth, Math.max(1, Math.floor(img.naturalHeight * 0.08)), 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let r = 0, gr = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; gr += d[i + 1]; bl += d[i + 2]; n++; }
    if (n) rgb = [r / n, gr / n, bl / n];
  } catch { /* a tainted canvas: the default */ }
  footColour.set(img, rgb);
  return rgb;
}
const HAZE_RGB = HAZE.split(',').map(Number) as [number, number, number];
const SHADE_RGB: [number, number, number] = [6, 14, 10];

/**
 * How tall (px) a look is kept: the size it is drawn at (device px) times its softness, rounded UP to the next half
 * octave (so a sharp row is never stretched, and a zoom or a new screen size needs a new look only now and then), and
 * never more than the picture itself. A row drawn small is kept small: less memory, and shrunk once with the best
 * filter instead of every frame with the fast one. Blur is in screen px, so it looks the same on every screen.
 */
function lookHeight(img: HTMLImageElement, blur: number, drawnH: number): number {
  const want = Math.max(16, drawnH / (1 + blur * 0.5));
  return Math.round(Math.min(img.naturalHeight, Math.pow(2, Math.ceil(Math.log2(want) * 2) / 2)));
}

function buildLook(img: HTMLImageElement, haze: number, flip: boolean, blur: number, dark: number, h: number): PineLook {
  const c = document.createElement('canvas');
  c.height = h; c.width = Math.max(1, Math.round((img.naturalWidth * h) / img.naturalHeight));
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  if (!flip) { g.translate(c.width, 0); g.scale(-1, 1); }
  g.drawImage(img, 0, 0, c.width, c.height);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (haze > 0 || dark > 0) {
    g.globalCompositeOperation = 'source-atop';
    if (haze > 0) { g.fillStyle = `rgba(${HAZE},${haze})`; g.fillRect(0, 0, c.width, c.height); }
    // the rows nearest the lens are in shade (the owner: slightly darker, for the perspective)
    if (dark > 0) { g.fillStyle = `rgba(${SHADE_RGB.join(',')},${dark})`; g.fillRect(0, 0, c.width, c.height); }
    g.globalCompositeOperation = 'source-over';
  }
  const foot = footOf(img).map((v, i) => { const hz = v + (HAZE_RGB[i] - v) * haze; return Math.round(hz + (SHADE_RGB[i] - hz) * dark); });
  return { c, floor: `rgb(${foot.join(',')})`, used: ++pineLookClock, haze, blur, dark, h, flip };
}

/**
 * The look of a pine strip for a row: `drawnH` is how tall the row is drawn (device px). Built once and kept. A look
 * that is not ready yet is never built in the middle of a frame when another can stand in: the nearest one is drawn
 * this frame and the right one is built in an idle moment (the first ever look of a picture is built at once).
 */
function hazePines(img: HTMLImageElement, hazeIn: number, flip: boolean, blurIn = 0, darkIn = 0, drawnH = img.naturalHeight): { c: HTMLCanvasElement; floor: string } {
  const haze = Math.round(Math.max(0, Math.min(0.8, hazeIn)) * 10) / 10, blur = Math.round(Math.max(0, Math.min(10, blurIn)));
  const dark = Math.round(Math.max(0, Math.min(0.6, darkIn)) * 20) / 20;
  const h = lookHeight(img, blur, drawnH);
  const key = `${haze}:${blur}:${dark}:${h}${flip ? 'f' : ''}`;
  let looks = pineLooks.get(img);
  if (!looks) { looks = new Map(); pineLooks.set(img, looks); }
  const hit = looks.get(key);
  if (hit) { hit.used = ++pineLookClock; return hit; }
  // the nearest look of this picture (the same way round) stands in while the right one is built
  let near: PineLook | null = null, nearD = Infinity;
  for (const l of looks.values()) {
    if (l.flip !== flip) continue;
    const d = Math.abs(l.haze - haze) * 10 + Math.abs(l.blur - blur) + Math.abs(l.dark - dark) * 10 + Math.abs(Math.log2(l.h / h));
    if (d < nearD) { near = l; nearD = d; }
  }
  const make = () => {
    const now = pineLooks.get(img);
    if (!now || now.has(key)) return;
    now.set(key, buildLook(img, haze, flip, blur, dark, h));
    if (++pineLookCount > PINE_LOOKS_KEEP) dropOldestLook();
  };
  if (near) { queueLook(`${lookId(img)}:${key}`, make); near.used = ++pineLookClock; return near; }
  make();
  return looks.get(key)!;
}
/** The least recently drawn look goes (the pictures are few: both strips, every look of each). */
function dropOldestLook(): void {
  let oldest: { looks: Map<string, PineLook>; key: string; used: number } | null = null;
  for (const img of [ART.treesFront, ART.treesFront2]) {
    const looks = img ? pineLooks.get(img) : undefined;
    if (!looks) continue;
    for (const [key, look] of looks) if (!oldest || look.used < oldest.used) oldest = { looks, key, used: look.used };
  }
  if (oldest) { oldest.looks.delete(oldest.key); pineLookCount--; }
}
const lookIds = new WeakMap<HTMLImageElement, number>();
let nextLookId = 0;
const lookId = (img: HTMLImageElement) => { let n = lookIds.get(img); if (n === undefined) { n = nextLookId++; lookIds.set(img, n); } return n; };

/** Looks waiting to be built, one per idle moment (each takes a millisecond or two). */
const lookQueue = new Map<string, () => void>();
let lookQueueRunning = false;
function queueLook(id: string, build: () => void): void {
  if (lookQueue.has(id)) return;
  lookQueue.set(id, build);
  if (lookQueueRunning) return;
  lookQueueRunning = true;
  onIdle(buildNextLook);
}
function buildNextLook(): void {
  const first = lookQueue.entries().next();
  if (first.done) { lookQueueRunning = false; return; }
  lookQueue.delete(first.value[0]);
  first.value[1]();
  onIdle(buildNextLook);
}
/** Soon, in a gap between frames (within a tenth of a second even while a race keeps every frame busy). */
function onIdle(fn: () => void): void {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 100 });
  else setTimeout(fn, 16);
}

/**
 * The warm-up (preload.ts runs it once the pictures are decoded): the looks the forest will use, built one per idle
 * moment before any race, for this screen: every foreground row (sharp to soft, both ways round, both strips), and
 * the layers between the tracks one and two tracks back (at the camera's usual zooms).
 */
afterArt((() => {
  let todo: (() => void)[] | null = null;
  return () => {
    if (!todo) {
      const imgs = [ART.treesFront, ART.treesFront2].filter(ready);
      if (!imgs.length || typeof window === 'undefined') return true;
      const fit = Math.max(0.42, Math.min(1.25, Math.min(window.innerWidth / 1000, window.innerHeight / 520)));
      const dpr = window.devicePixelRatio || 1;
      todo = [];
      const add = (haze: number, blur: number, dark: number, drawnH: number) => { for (const img of imgs) for (const flip of [true, false]) todo!.push(() => { hazePines(img, haze, flip, blur, dark, drawnH); }); };
      for (let i = 0; i < PINE_ALL; i++) { const r = pineRow(i); add(0, pineBlur(r.p), pineDark(r.p), r.h * fit * r.p * dpr); }
      for (const zoom of [1, 0.6]) {
        for (const [far, focus] of [[0, 1], [0, 2]]) {
          const vf = laneView(far, focus), vn = laneView(far + 1, focus), sp = fit * zoom * Math.sqrt(vf.scale * vn.scale);
          BETWEEN_ROWS.forEach((r, i) => { const look = betweenLook(vf, i); add(look.haze, look.blur, 0, r.h * sp * dpr); });
        }
      }
    }
    const next = todo.shift();
    if (next) next();
    // the queued ones (stand-ins asked for) are built by their own idle loop
    return todo.length === 0;
  };
})());

/**
 * The owner's islands: big rock formations standing in the foreground forest, half under the trees (they only work very
 * large in the foreground; standing still like a rock formation; solid, they block the view of the track as they pass:
 * the owner). Each is pinned to one point of the land (forest.ts islandSpots) and drawn behind every row of pines, so
 * it moves exactly as the hill it stands on does and never sinks into the trees or rises out of them.
 */
function drawIslands(ctx: CanvasRenderingContext2D, cam: PlatformCamera, cw: number, ch: number, plan: CoursePlan, fs: number, treeDrop: number) {
  const focus = cam.focus ?? LANE_MIDDLE;
  const spots = islandSpots(cam, cw, ch, {
    groundAt: (x) => groundLineY(plan, focus, x),
    treeDrop,
    quiet: quietOf(plan),
    fs,
    pick: (slot) => islandPick(slot, ISLAND_CHANCE),
    widthOf: (art) => ISLANDS[art].w,
    aspect: (art) => { const img = islandPicture(ISLANDS[art].n); return img ? img.naturalHeight / img.naturalWidth : null; },
  });
  for (const sp of spots) {
    const img = islandPicture(ISLANDS[sp.art].n);
    if (img) drawImg(ctx, img, sp.x - sp.w / 2, sp.top, sp.w, sp.h);
  }
}

function foreground(ctx: CanvasRenderingContext2D, cam: PlatformCamera, cw: number, ch: number, plan?: CoursePlan) {
  const img = ART.treesFront;
  if (!ready(img)) return;
  const { rows: scrolls } = foregroundScroll(cam);
  const aspect = img.naturalWidth / img.naturalHeight;
  // The pines are near the lens (the owner): they slide sideways faster than the track, each row at its own parallax
  // speed (foregroundScroll), which is the depth. Up and down, every row stands a fixed depth below the track you are
  // on as it lies on the screen, column by column (forest.ts forestLine): the forest is angled with every hill and never
  // moves against the track, on any lane, mid lane change. The depth and the drops are in your own zoom only (fgScale),
  // so the tree line holds still when the camera zooms itself in and out with your speed.
  const fs = cam.fgScale ?? cam.scale;
  const dpr = ctx.getTransform().a || 1;
  const focus = cam.focus ?? LANE_MIDDLE;
  const lineAt = forestLine((x) => (plan ? groundLineY(plan, focus, x) : null), cam, cw, ch, FOREST_DEPTH * fs, ch / 2 + (FG_TRACK_BELOW + FOREST_DEPTH) * fs);
  const islands = cam.islands !== false && !!plan;
  const FRONT = PINE_ROWS.length - 1;
  // Back to front. The nearer rows past the front one (zoomed out) fade in as the ground under the row behind them
  // comes into view, and out again as it leaves (the owner: no snapping in and out).
  const rows: { i: number; r: { p: number; h: number; drop: number }; top: number; height: number; alpha: number }[] = [];
  for (let i = 0, prev: { top: number; height: number } | null = null; i < PINE_ALL; i++) {
    const r = pineRow(i);
    const top = lineAt(cw / 2) + (r.drop - CLIFF_RISE) * fs * r.p, height = r.h * fs * r.p;
    let alpha = 1;
    if (i >= PINE_ROWS.length && prev) alpha = Math.max(0, Math.min(1, (ch - (prev.top + prev.height * 0.75)) / (ch * 0.12)));
    if (alpha <= 0) break;
    prev = { top, height };
    rows.push({ i, r, top, height, alpha });
  }
  for (let j = 0; j < rows.length; j++) {
    const { i, r, top, height, alpha } = rows[j];
    // the islands stand right behind the front row of pines, which (with the rows past it) hides their lower half
    if (i === FRONT && islands) drawIslands(ctx, cam, cw, ch, plan!, fs, (FOREST_DEPTH + (r.drop - CLIFF_RISE) * r.p) * fs);
    if (top >= ch) continue;
    // every other row mirrored, so neighbouring rows never line up (the front row is the art as painted)
    // in front of the track: no haze; the rows nearest the lens are out of focus
    const soft = pineBlur(r.p), shade = pineDark(r.p);
    const pines = hazePines(img, 0, (PINE_ROWS.length - 1 - i) % 2 === 0, soft, shade, height * dpr);
    const rw = aspect * height;
    ctx.globalAlpha = alpha;
    // under the row, a band in its own darkest colour to the screen's bottom (the rows in front cover the rest), so no
    // land shows between the rows
    ctx.fillStyle = i < PINE_ROWS.length - 1 ? pines.floor : '#080e0d';
    const start = tileStart(cam, `f${i}`, scrolls[i], rw, cw);
    const drop = (r.drop - CLIFF_RISE) * fs * r.p;
    // Perf: the band under a row only reaches the solid part of the row in front of it (that row covers the rest; the
    // lower half of the pine art is solid). Only the front-most row (or one still fading in) fills to the screen's
    // bottom. It used to fill to the bottom under every row: about half the CPU of a frame went on painting the same
    // pixels over and over.
    const next = rows[j + 1];
    const nextSolid = next && next.alpha >= 1 ? (next.r.drop - CLIFF_RISE) * fs * next.r.p + next.height * 0.6 : null;
    const band = nextSolid === null ? true : (sx: number) => lineAt(sx) + nextSolid;
    for (let rx = start.x, id = start.id; rx < cw; rx += rw, id++) {
      const tile = pineTile(id, `f${i}`, (PINE_ROWS.length - 1 - i) % 2 === 0);
      const art = hazePines(tile.img, 0, tile.flip, soft, shade, height * dpr);
      drawStrip(ctx, art.c, rx, rw, height, cw, ch, (sx) => lineAt(sx) + drop, band);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * One tile of a pine row standing on a line (`yAt`: screen y at a screen x), so the row follows every hill. The tile
 * is drawn in runs along which the line is straight (to within half a pixel), each in ONE draw under a vertical shear:
 * every column of the picture moves down by the line's slope, so the trunks stay upright and the row lies exactly
 * along the slope, with no steps. Perf: it used to be one draw per 24 px slice, about a thousand draws a frame for the
 * whole forest and nearly half of all drawing time; on rolling hills a tile is now one or two.
 * `band`: also fill under the row in the current fill colour (no land shows between rows): to the screen's bottom
 * (true), down to a line parallel to the row's (a function of screen x), or not at all (false).
 */
function drawStrip(ctx: CanvasRenderingContext2D, art: HTMLCanvasElement, rx: number, rw: number, height: number, cw: number, ch: number, yAt: (sx: number) => number, band: boolean | ((sx: number) => number)) {
  const x0 = Math.max(rx, -2), x1 = Math.min(rx + rw, cw + 2);
  if (x1 <= x0) return;
  const STEP = 24, TOL = 0.5, fx = art.width / rw;
  let a = x0;
  while (a < x1) {
    const ya = yAt(a);
    // the longest run from a whose line stays within TOL of the straight chord across it
    let b = Math.min(x1, a + STEP);
    while (b < x1) {
      const nb = Math.min(x1, b + STEP), yb = yAt(nb);
      let straight = true;
      for (let x = a + STEP; x < nb && straight; x += STEP) straight = Math.abs(yAt(x) - (ya + ((yb - ya) * (x - a)) / (nb - a))) <= TOL;
      if (!straight) break;
      b = nb;
    }
    const w = b - a, slope = (yAt(b) - ya) / w;
    if (Math.min(ya, ya + slope * w) < ch) {
      ctx.save();
      // the look is already the size it is drawn at: plain bilinear filtering (the best quality filter has no fast path for a sheared picture)
      ctx.imageSmoothingQuality = 'low';
      ctx.transform(1, slope, 0, 1, 0, -slope * a); // (x, y) -> (x, y + slope * (x - a))
      if (band) {
        const from = ya + height * 0.8;
        const to = band === true ? ch + Math.abs(slope) * w : band(a);
        if (to > from) ctx.fillRect(a, from, w + 0.6, to - from);
      }
      const sx0 = Math.max(0, (a - rx) * fx);
      ctx.drawImage(art, sx0, 0, Math.min(w * fx, art.width - sx0), art.height, a, ya, w + 0.6, height);
      ctx.restore();
    }
    a = b;
  }
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
