// P2-00 (#124): the coaster skin for rolling-slope (flow) courses — the owner's reference look: a red-and-white
// wooden beam track, carried on the owner's scaffold supports over mossy rock cliffs, with goblin towers,
// torches, banners and the sheep spring. Built from the game's existing painted art; a skin only (physics is the
// plain floor pieces from build.ts). Returns false until the art has loaded, and the caller draws a fallback.
import type { CoursePlan, Floor, Lane } from './course';
import { drawImg } from '../mip';
import { SPRING_W, floorAt } from './course';
import type { Kicker, LaneGate, StandSpot } from './course';
import { GATE_RAMP_H } from './course';
import type Matter from 'matter-js';
import { LEDGE_H } from './build';
import { drawRoutes, setLoopRingSource } from './routes';
import { sprite } from '../sprites';
import wreckingBallUrl from '../../assets/game/wrecking-ball.webp';
import railWoodUrl from '../../assets/game/rail-wood.webp';
import rockFillUrl from '../../assets/game/rock-fill.webp';
import mossUrl from '../../assets/game/strip-moss.webp';
import sheepUrl from '../../assets/game/sheep-spring.webp';
import crateUrl from '../../assets/game/crate.webp';
import tower1Url from '../../assets/game/tower-1.webp';
import tower2Url from '../../assets/game/tower-2.webp';
import tower3Url from '../../assets/game/tower-3.webp';
import torchUrl from '../../assets/game/torch.webp';
import treesGroup1Url from '../../assets/game/trees-group-1.webp';
import treesGroup2Url from '../../assets/game/trees-group-2.webp';
import treesGroup3Url from '../../assets/game/trees-group-3.webp';
import crowd1Url from '../../assets/game/crowd-1.webp';
import crowd2Url from '../../assets/game/crowd-2.webp';
import { drawCloudLedge, drawKicker } from './sky-art';
import { LANE_BACK } from '../lanes';

// decoded up front (off the main thread), so a big sprite seen for the first time mid-race never stalls a frame
const load = (src: string) => {
  if (typeof Image === 'undefined') return null;
  const img = Object.assign(new Image(), { src });
  img.decode?.().catch(() => {});
  return img;
};
const ART = {
  wood: load(railWoodUrl), rock: load(rockFillUrl), moss: load(mossUrl), sheep: load(sheepUrl),
  crate: load(crateUrl), ball: load(wreckingBallUrl), towers: [load(tower1Url), load(tower2Url), load(tower3Url)], torch: load(torchUrl),
  treeGroups: [load(treesGroup1Url), load(treesGroup2Url), load(treesGroup3Url)], crowds: [load(crowd1Url), load(crowd2Url)],
};
// loops are drawn in the pinball tracks' loop-ring art (routes.ts)
setLoopRingSource(() => sprite('loop-ring'));
const ready = (img: HTMLImageElement | null): img is HTMLImageElement => !!img && img.complete && img.naturalWidth > 0;
const allReady = () => ready(ART.wood) && ready(ART.rock) && ready(ART.moss);

/** Rail images have iron end caps: the plank between them is what tiles along a curve. */
const RAIL_CAP = 0.125;
const middles = new Map<HTMLImageElement, HTMLCanvasElement>();
function middle(img: HTMLImageElement): HTMLCanvasElement {
  let c = middles.get(img);
  if (!c) {
    const cap = Math.round(img.naturalWidth * RAIL_CAP);
    c = document.createElement('canvas');
    c.width = img.naturalWidth - cap * 2;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, cap, 0, c.width, c.height, 0, 0, c.width, c.height);
    middles.set(img, c);
  }
  return c;
}

const rockPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
function rockPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  let p = rockPatterns.get(ctx);
  if (!p && ready(ART.rock)) { p = ctx.createPattern(ART.rock, 'repeat') ?? undefined; if (p) rockPatterns.set(ctx, p); }
  return p ?? null;
}

/** The track beam's thickness and how far it rises above the floor's top edge (the ball rolls on its top). */
const TRACK_T = 30;
const RAIL_UP = 5;

/** How far the cliffs sit below the track: a slow swell, 150..280 px, the same on every machine. */
function clearance(x: number): number {
  return 150 + 130 * (0.5 + 0.5 * Math.sin(x / 700 + 1.3) * Math.cos(x / 1900));
}

function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Pt = { x: number; y: number };

/** Each lane's floors joined into runs between chasms. */
const runCache = new WeakMap<CoursePlan, Pt[][][]>();
function runsOf(plan: CoursePlan): Pt[][][] {
  let runs = runCache.get(plan);
  if (runs) return runs;
  runs = [0, 1, 2].map((lane) => {
    const floors = plan.floors.filter((f) => f.lane === lane && !f.hidden).sort((a, b) => a.x0 - b.x0);
    const out: Pt[][] = [];
    let run: Pt[] = [];
    let last: Floor | null = null;
    for (const f of floors) {
      // a new run after a chasm, and also at a STEP (the floor jumps up or down): joining across a step drew it as a
      // long gentle slope, so the painted track sat far above or below where the ball actually rolls
      if (!last || Math.abs(f.x0 - last.x1) > 0.5 || Math.abs(f.y0 - last.y1) > 1) {
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

function yOn(run: Pt[], x: number): number {
  let lo = 0, hi = run.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (run[mid].x <= x) lo = mid; else hi = mid; }
  const a = run[lo], b = run[hi];
  return a.y + ((x - a.x) / Math.max(1e-6, b.x - a.x)) * (b.y - a.y);
}

/** Lay a strip image along a polyline, `up` px above it and `thick` tall, continuing the texture piece to piece. */
/**
 * `u0`: where the texture starts, as a distance along the track. Taken from the run (not from wherever this drawing
 * happens to begin), so two drawings of neighbouring stretches meet without a seam (the scenery cache draws strips).
 */
function stripAlong(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, pts: Pt[], up: number, thick: number, u0?: number) {
  const tw = (img.width / img.height) * thick;
  const srcPerPx = img.width / tw;
  let u = u0 === undefined ? (((pts[0].x % tw) + tw) % tw) : (((u0 % tw) + tw) % tw);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    let done = 0;
    while (done < len - 0.01) {
      let at = (u + done) % tw;
      if (tw - at < 0.5) at = 0;
      const piece = Math.max(0.5, Math.min(len - done, tw - at));
      drawImg(ctx, img, at * srcPerPx, 0, Math.max(1, piece * srcPerPx), img.height, done - 0.6, -up, piece + 1.2, thick);
      done += piece;
    }
    ctx.restore();
    u = (u + len) % tw;
  }
}

/** Distance along a run to each of its points (cached per run). */
const arcCache = new WeakMap<Pt[], number[]>();
function arcOf(run: Pt[]): number[] {
  let arc = arcCache.get(run);
  if (!arc) {
    arc = [0];
    for (let i = 1; i < run.length; i++) arc.push(arc[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y));
    arcCache.set(run, arc);
  }
  return arc;
}
/** Index in its run of the first point `clip` keeps. */
function clipStart(run: Pt[], left: number): number {
  let i0 = 0;
  while (i0 < run.length - 1 && run[i0 + 1].x < left) i0++;
  return i0;
}

function clip(run: Pt[], left: number, right: number): Pt[] {
  let i0 = 0;
  while (i0 < run.length - 1 && run[i0 + 1].x < left) i0++;
  let i1 = run.length - 1;
  while (i1 > 0 && run[i1 - 1].x > right) i1--;
  return run.slice(i0, i1 + 1);
}

/** The owner's support sprites (src/assets/game/platformer/supports): two-post bents and single posts. */
const supportUrls = import.meta.glob<string>('../../assets/game/platformer/supports/*.webp', { eager: true, import: 'default' });
const byName = (prefix: string) => Object.entries(supportUrls)
  .filter(([path]) => path.includes(`/${prefix}-`))
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, url]) => load(url));
const BENTS = byName('bent');
const POSTS = byName('post');

/** Supports every SUPPORT_EVERY px along the track, alternating a braced bent and a single post. */
const SUPPORT_EVERY = 230;

/**
 * The supports between the track and the cliff: the owner's sprites, scaled to the gap (each picked by hash, so
 * every machine draws the same one). No strut between them (the owner: one wood line, the beam, only).
 */
function trestle(ctx: CanvasRenderingContext2D, run: Pt[], x0: number, x1: number, ground: (x: number) => number) {
  const supports: { x: number; top: number; foot: number; img: HTMLImageElement }[] = [];
  for (let x = Math.ceil(x0 / SUPPORT_EVERY) * SUPPORT_EVERY; x <= x1; x += SUPPORT_EVERY) {
    if (x < run[0].x + 30 || x > run[run.length - 1].x - 30) continue;
    const k = Math.round(x / SUPPORT_EVERY);
    const set = k % 2 === 0 ? BENTS : POSTS;
    const img = set[Math.floor(hash(k, 17) * set.length)];
    if (!ready(img)) continue;
    supports.push({ x, top: yOn(run, x) + TRACK_T - RAIL_UP - 8, foot: ground(x) + 14, img });
  }
  for (const sp of supports) stackSupport(ctx, sp.img, sp.x, sp.top, sp.foot, SUPPORT_MODULE, 105);
}

/** One support piece in this many world px of height: half the old single stretched piece. */
const SUPPORT_MODULE = 105;

/** A support drawn as a stack of modules (like real scaffolding) from `top` down to `foot`. */
function stackSupport(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, top: number, foot: number, module: number, maxW: number) {
  const h = foot - top;
  if (h < 20) return;
  const n = Math.max(1, Math.round(h / module));
  const mh = h / n;
  const w = Math.min((img.naturalWidth / img.naturalHeight) * mh, maxW);
  for (let k = 0; k < n; k++) drawImg(ctx, img, x - w / 2, top + k * mh, w, mh + 1);
}

/**
 * Draw one lane of a flow course in the coaster look. Returns false (draws nothing) until the art is loaded.
 * Order: cliffs, towers, trestles, the beam and rail, then props on the track.
 */
/** True once the coaster art has loaded (until then a course is drawn with plain earth and grass). */
export const coasterReady = (): boolean => allReady();

/**
 * `part` (perf): 'static' draws only the scenery that never changes (cliffs, towers, trestles, the beam, crates,
 * ledges) so the race can cache it; 'dynamic' draws only what moves or flickers (torches, springs, map pieces, loops
 * and bridges); 'all' draws both, as before.
 */
export function drawCoasterLane(ctx: CanvasRenderingContext2D, plan: CoursePlan, lane: Lane, left: number, right: number, bottom: number, time: number, springFired: (x: number) => boolean, pieces: Matter.Body[] = [], part: 'all' | 'static' | 'dynamic' = 'all'): boolean {
  if (!allReady()) return false;
  const runs = runsOf(plan)[lane];
  const statics = part !== 'dynamic', dynamics = part !== 'static';
  const rock = statics ? rockPattern(ctx) : null;
  const drawnStands = new Set<number>(); // a stand spanning two runs is drawn once
  for (const run of runs) {
    if (run[run.length - 1].x < left || run[0].x > right) continue;
    const pts = clip(run, left, right);
    const u0 = arcOf(run)[clipStart(run, left)];
    if (!statics) { torches(ctx, run, pts, lane, time); continue; }
    // the goblin stands first: behind this lane's cliff and beam (and every nearer lane)
    const stands = plan.stands ? standsAt(ctx, plan.stands, run, pts, lane, drawnStands) : crowds(ctx, run, pts, lane);
    const cliff = pts.map((p) => ({ x: p.x, y: p.y + clearance(p.x) }));
    // the cliff under this stretch of track: rock, darker lower down, moss on top
    ctx.beginPath();
    ctx.moveTo(cliff[0].x, cliff[0].y);
    for (const p of cliff) ctx.lineTo(p.x, p.y);
    ctx.lineTo(cliff[cliff.length - 1].x, bottom);
    ctx.lineTo(cliff[0].x, bottom);
    ctx.closePath();
    ctx.fillStyle = rock ?? '#6b6258';
    ctx.fill();
    // from the whole run (not this stretch), so strips drawn separately shade the same
    const top = runTop(run);
    const g = ctx.createLinearGradient(0, top, 0, top + 500);
    g.addColorStop(0, 'rgba(30,24,20,0)');
    g.addColorStop(1, 'rgba(18,14,12,0.6)');
    ctx.fillStyle = g;
    ctx.fill();
    if (pts[0] === run[0]) { ctx.fillStyle = 'rgba(20,14,10,0.55)'; ctx.fillRect(cliff[0].x, cliff[0].y, 10, bottom - cliff[0].y); }
    if (pts[pts.length - 1] === run[run.length - 1]) { const e = cliff[cliff.length - 1]; ctx.fillStyle = 'rgba(20,14,10,0.55)'; ctx.fillRect(e.x - 10, e.y, 10, bottom - e.y); }
    stripAlong(ctx, ART.moss!, cliff, 14, 30, u0);
    // (no single goblin watchtowers: the owner)
    trestle(ctx, run, pts[0].x - SUPPORT_EVERY, pts[pts.length - 1].x + SUPPORT_EVERY, (x) => yOn(run, x) + clearance(x));
    treeGroups(ctx, run, pts, lane);
    crowdGapTrees(ctx, run, stands, lane);
    // the track: a plain wooden beam (no chevron rail, per the owner)
    stripAlong(ctx, middle(ART.wood!), pts, RAIL_UP, TRACK_T, u0);
    if (dynamics) torches(ctx, run, pts, lane, time);
  }
  if (statics) staticProps(ctx, plan, runs, lane, left, right);
  if (!dynamics) return true;
  // springs: the sheep on its coil
  for (const s of plan.springs ?? []) {
    if (s.lane !== lane || s.x + SPRING_W < left || s.x > right || !ready(ART.sheep)) continue;
    const squash = springFired(s.x) ? 0.82 : 1;
    const w = SPRING_W + 18;
    const h = (ART.sheep.naturalHeight / ART.sheep.naturalWidth) * w * squash;
    drawImg(ctx, ART.sheep, s.x - 9, s.y - h + 4, w, h);
  }
  drawMapPieces(ctx, pieces, lane, left, right, time);
  drawRoutes(ctx, plan.loops, pieces, lane, left, right); // P2-21: loop rings and rope bridges
  return true;
}

/**
 * Infinity's goblin stands, from the plan's spots (absolute km ids, the level stretch's height): as many stands as fit
 * on the stretch, centred on it, each drawn once per lane draw (the first run that overlaps it). Nothing here depends
 * on which chunks are built or on the world origin, so a stand never flashes out or moves (the owner).
 */
function standsAt(ctx: CanvasRenderingContext2D, spots: StandSpot[], run: Pt[], pts: Pt[], lane: Lane, drawn: Set<number>): { x: number; w: number; base: number }[] {
  const placed: { x: number; w: number; base: number }[] = [];
  const a = pts[0].x, b = pts[pts.length - 1].x;
  for (const s of spots) {
    if (s.lane !== lane || drawn.has(s.id) || s.x + s.w < a || s.x > b) continue;
    const img0 = ART.crowds[s.id % 2];
    if (!ready(img0) || !ready(ART.crowds[(s.id + 1) % 2])) continue;
    drawn.add(s.id);
    const r = hash(s.id, lane + 31);
    const want = r < 0.4 ? 1 : r < 0.8 ? 2 : 3;
    const h = 300 + hash(s.id, lane + 32) * 60;
    const one = (img0.naturalWidth / img0.naturalHeight) * h - 8;
    const count = Math.max(1, Math.min(want, Math.floor(s.w / one)));
    let x = s.x + (s.w - count * one) / 2;
    const base = s.y + TRACK_T - RAIL_UP;
    for (let i = 0; i < count; i++) {
      const img = ART.crowds[(s.id + i) % 2]!;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      drawImg(ctx, img, x, base - h, w, h);
      placed.push({ x, w, base });
      x += w - 8;
    }
  }
  void run;
  return placed;
}

/** One stretch of the course per crowd: a km (the HUD's 10,000 px). */
const CROWD_EVERY = 10_000;
/**
 * The goblin crowd stands (the owner's art): once a km, on the back lane only, on a flat stretch of track (moved along
 * to the nearest one, or left out). Each stands level with the track (its base just under the beam); the drop from
 * the track to the cliff under it is filled with trees (crowdGapTrees), so no air shows under a stand. Drawn before
 * that lane's cliff and beam, so every track and cliff is in front of it. Sometimes one stand, sometimes two or three
 * side by side. Static: cached with the lane.
 */
function crowds(ctx: CanvasRenderingContext2D, run: Pt[], pts: Pt[], lane: Lane): { x: number; w: number; base: number }[] {
  const placed: { x: number; w: number; base: number }[] = [];
  if (lane !== LANE_BACK) return placed;
  const a = pts[0].x, b = pts[pts.length - 1].x;
  const flat = (x0: number, x1: number) => {
    if (x0 < run[0].x + 60 || x1 > run[run.length - 1].x - 60) return false;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 10; i++) { const y = yOn(run, x0 + ((x1 - x0) * i) / 10); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    return hi - lo <= 12;
  };
  for (let k = Math.floor((a - 6000) / CROWD_EVERY); k * CROWD_EVERY < b + 6000; k++) {
    if (k < 1) continue;
    const r = hash(k, lane + 31);
    const want = r < 0.4 ? 1 : r < 0.8 ? 2 : 3;
    const img0 = ART.crowds[k % 2];
    if (!ready(img0) || !ready(ART.crowds[(k + 1) % 2])) continue;
    const aspect = img0.naturalWidth / img0.naturalHeight;
    // how tall a stand is: all of it above the track
    const h = 300 + hash(k, lane + 32) * 60;
    const span = (count: number) => aspect * h * count;
    // the nearest flat stretch to the km mark, within 2,400 px either way, for as many of the stands as fit
    let start: number | null = null, count = want;
    for (; count >= 1 && start === null; count--) {
      for (let step = 0; step <= 12 && start === null; step++) {
        for (const sign of step ? [1, -1] : [1]) {
          const x = k * CROWD_EVERY + sign * step * 200;
          if (flat(x, x + span(count))) { start = x; break; }
        }
      }
    }
    count++;
    if (start === null || start > b || start + span(count) < a) continue;
    let x = start;
    for (let i = 0; i < count; i++) {
      const img = ART.crowds[(k + i) % 2];
      if (!ready(img)) continue;
      // the base on the track line, hidden behind the beam
      const base = yOn(run, x) + TRACK_T - RAIL_UP;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      drawImg(ctx, img, x, base - h, w, h);
      placed.push({ x, w, base });
      x += w - 8;
    }
  }
  return placed;
}

/**
 * Under a stand, the drop from the track down to the cliff is filled with trees (the owner): two staggered layers of
 * the tree groups standing on the cliff top, tall enough to reach up behind the beam, so no air shows under a stand.
 * Drawn after the trestles and before the beam.
 */
function crowdGapTrees(ctx: CanvasRenderingContext2D, run: Pt[], stands: { x: number; w: number; base: number }[], lane: Lane) {
  for (const st of stands) {
    for (const layer of [0, 1]) {
      for (let x = st.x - 40 + layer * 45, n = 0; x < st.x + st.w + 40; x += 90, n++) {
        const img = ART.treeGroups[Math.floor(hash(n + Math.round(st.x) + layer * 7, lane + 47) * 3)];
        if (!ready(img)) continue;
        const foot = yOn(run, x) + clearance(x) + 22;
        // up to the stand's base (behind the beam); the back layer (drawn first) a little shorter
        const h = foot - st.base + 30 + hash(n, lane + 48 + layer) * 40 - (1 - layer) * 20;
        const w = (img.naturalWidth / img.naturalHeight) * h;
        drawImg(ctx, img, x - w / 2, foot - h, w, h);
      }
    }
  }
}

/** Tree groups along the cliff top: about 70% of it. */
const TREE_STEP = 230;
/**
 * The owner's tree groups, standing on the cliff top in front of the scaffold feet, so the place where the scaffolding
 * meets the rock is mostly hidden (gaps here and there). Static, cached with the lane; the beam is drawn over them.
 */
function treeGroups(ctx: CanvasRenderingContext2D, run: Pt[], pts: Pt[], lane: Lane) {
  const a = pts[0].x, b = pts[pts.length - 1].x;
  for (let k = Math.floor((a - 400) / TREE_STEP); k * TREE_STEP < b + 400; k++) {
    const r = hash(k, lane + 41);
    if (r > 0.72) continue;
    const img = ART.treeGroups[Math.floor(hash(k, lane + 42) * 3)];
    if (!ready(img)) continue;
    const x = k * TREE_STEP + (hash(k, lane + 43) - 0.5) * 80;
    if (x < run[0].x + 40 || x > run[run.length - 1].x - 40) continue;
    const clear = clearance(x);
    const h = Math.min(clear * 0.85, 150 + hash(k, lane + 44) * 90);
    const w = (img.naturalWidth / img.naturalHeight) * h;
    const foot = yOn(run, x) + clear + 22;
    drawImg(ctx, img, x - w / 2, foot - h, w, h);
  }
}

/**
 * A kicker in the track's own art (the owner: not a vector wedge): a stack of the track's crates under the slope,
 * cut to the wedge, and the wooden beam of the track as its deck. The vector one (sky-art.ts) until the art loads.
 */
function kickerArt(ctx: CanvasRenderingContext2D, plan: CoursePlan, k: Kicker) {
  if (!ready(ART.crate) || !ready(ART.wood)) { drawKicker(ctx, plan, k); return; }
  const y0 = floorAt(plan, k.lane, k.x) ?? 0, y1 = floorAt(plan, k.lane, k.x + k.w) ?? y0;
  const top = y1 - k.h;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(k.x, y0 + 2);
  ctx.lineTo(k.x + k.w, top);
  ctx.lineTo(k.x + k.w, y1 + 4);
  ctx.closePath();
  ctx.clip();
  // crates in rows from the track up, each row shifted half a crate like stacked boxes
  const c = Math.max(26, Math.min(44, k.h / 2));
  for (let row = 0, y = Math.max(y0, y1) + 4 - c; y + c > top; row++, y -= c) {
    for (let x = k.x - (row % 2 ? c / 2 : 0); x < k.x + k.w; x += c) drawImg(ctx, ART.crate, x, y, c, c);
  }
  ctx.restore();
  // the deck: the track's beam up the slope, ending flush with the lip
  stripAlong(ctx, middle(ART.wood), [{ x: k.x, y: y0 }, { x: k.x + k.w, y: top }], RAIL_UP, TRACK_T * 0.7);
}

/** A lane-change jump ramp: the kicker's art (crates under the slope, the track's beam as its deck). */
export function drawGateRamp(ctx: CanvasRenderingContext2D, plan: CoursePlan, g: LaneGate): void {
  kickerArt(ctx, plan, { lane: g.lane, x: g.x, w: g.w, h: GATE_RAMP_H });
}

/** Torches on the beam now and then (they flicker, so they are never cached). */
function torches(ctx: CanvasRenderingContext2D, run: Pt[], pts: Pt[], lane: Lane, time: number) {
  // On the supports (the owner: a torch floating over the beam made no sense): now and then a support carries a wall
  // torch on its post, just under the beam. The same support spacing and run-end rule as trestle().
  if (!ready(ART.torch)) return;
  for (let x = Math.ceil(pts[0].x / SUPPORT_EVERY) * SUPPORT_EVERY; x <= pts[pts.length - 1].x; x += SUPPORT_EVERY) {
    if (x < run[0].x + 30 || x > run[run.length - 1].x - 30) continue;
    const k = Math.round(x / SUPPORT_EVERY);
    if (hash(k, lane + 3) > 0.25) continue;
    const y = yOn(run, x) + TRACK_T - RAIL_UP + 6;
    if (clearance(x) < 90) continue; // too little post under the beam to hang it on
    const flicker = 1 + Math.sin(time / 90 + x) * 0.03;
    drawImg(ctx, ART.torch, x + 6, y + 52 * (1 - flicker), 28, 52 * flicker);
  }
}

/** Crates and ledges: part of the cached scenery. */
function staticProps(ctx: CanvasRenderingContext2D, plan: CoursePlan, runs: Pt[][], lane: Lane, left: number, right: number) {
  // crates on the track
  for (const b of plan.bumps) {
    if (b.hidden || b.lane !== lane || b.x + b.w < left || b.x > right) continue;
    if (ready(ART.crate)) {
      const n = Math.max(1, Math.round(b.w / b.h));
      for (let i = 0; i < n; i++) drawImg(ctx, ART.crate, b.x + (i * b.w) / n, b.y, b.w / n, b.h + 6);
    }
  }
  // kickers: wooden ramps on the track
  for (const k of plan.kickers ?? []) if (k.lane === lane && k.x + k.w > left && k.x < right) kickerArt(ctx, plan, k);
  // ledges: spur tracks on posts (a cloud platform is a cloud instead)
  for (const l of plan.ledges ?? []) {
    if (l.lane !== lane || l.x + l.w < left || l.x > right) continue;
    if (l.cloud !== undefined) { drawCloudLedge(ctx, l); continue; }
    // posts stand on the track below wherever there is track (none over the chasm itself)
    for (let px = l.x + 40; px < l.x + l.w - 30; px += 220) {
      const under = runs.find((r) => px >= r[0].x && px <= r[r.length - 1].x);
      if (!under) continue;
      const img = POSTS[Math.floor(hash(Math.round(px), 29) * POSTS.length)];
      const top = l.y + LEDGE_H - 6, foot = yOn(under, px) - RAIL_UP + 4;
      if (!ready(img) || foot - top < 30) continue;
      stackSupport(ctx, img, px, top, foot, SUPPORT_MODULE, 60);
    }
    const flat = [{ x: l.x, y: l.y }, { x: l.x + l.w, y: l.y }];
    stripAlong(ctx, middle(ART.wood!), flat, 2, LEDGE_H + 8);
    drawImg(ctx, ART.wood!, 0, 0, ART.wood!.naturalWidth * RAIL_CAP, ART.wood!.naturalHeight, l.x - 10, l.y - 2, 22, LEDGE_H + 8);
    drawImg(ctx, ART.wood!, ART.wood!.naturalWidth * (1 - RAIL_CAP), 0, ART.wood!.naturalWidth * RAIL_CAP, ART.wood!.naturalHeight, l.x + l.w - 12, l.y - 2, 22, LEDGE_H + 8);
  }
}

/**
 * The classic map pieces on a coaster course, in this lane: boost pads on the track, wrecking balls swinging
 * from a gantry (one of the owner's posts plus a beam), and power-up boxes hovering over the line.
 */
function drawMapPieces(ctx: CanvasRenderingContext2D, pieces: Matter.Body[], lane: Lane, left: number, right: number, time: number) {
  for (const b of pieces) {
    const md = b.plugin as { kind: string; lane?: number; dir?: Matter.Vector; pivot?: Matter.Vector; chain?: number; active?: boolean };
    if (md.lane !== lane || b.bounds.max.x < left - 300 || b.bounds.min.x > right + 300) continue;
    if (md.kind === 'boost') {
      // glowing arrows along the track
      const v = b.vertices;
      const len = Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y);
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      const glow = ctx.createLinearGradient(0, -18, 0, 18);
      glow.addColorStop(0, 'rgba(255,170,60,0)');
      glow.addColorStop(0.75, 'rgba(255,170,60,0.45)');
      glow.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-len / 2, -18, len, 36);
      for (let i = 0; i < 4; i++) {
        const x = -len / 2 + 22 + i * ((len - 44) / 3);
        const a = 0.45 + 0.55 * (((time / 120 + i) % 4) / 4);
        ctx.fillStyle = `rgba(255,${150 + i * 20},40,${a.toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(x - 10, 4); ctx.lineTo(x + 6, 12); ctx.lineTo(x - 10, 20); ctx.lineTo(x - 4, 12);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else if (md.kind === 'wrecker' && md.pivot) {
      const pv = md.pivot;
      // the gantry: a post standing on the track beside the pivot, and a beam out over it
      const postX = pv.x - 70;
      const postImg = POSTS[Math.floor(hash(Math.round(pv.x), 41) * POSTS.length)];
      const foot = pv.y + (md.chain ?? 140) + 44;
      if (ready(postImg)) {
        const h = foot - (pv.y - 26);
        const w = Math.min((postImg.naturalWidth / postImg.naturalHeight) * h, 110);
        drawImg(ctx, postImg, postX - w / 2, pv.y - 26, w, h);
      }
      if (ready(ART.wood)) stripAlong(ctx, middle(ART.wood), [{ x: postX - 10, y: pv.y - 14 }, { x: pv.x + 26, y: pv.y - 14 }], 2, 20);
      // chain
      const dx = b.position.x - pv.x, dy = b.position.y - pv.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pv.x, pv.y);
      ctx.lineTo(b.position.x, b.position.y);
      ctx.stroke();
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 2;
      for (let d = 6; d < len - 20; d += 11) {
        ctx.beginPath();
        ctx.ellipse(pv.x + (dx * d) / len, pv.y + (dy * d) / len, 2.6, 5, Math.atan2(dy, dx) + ((d / 11) % 2 < 1 ? Math.PI / 2 : 0), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (ready(ART.ball)) {
        // the art hangs from a chain stub; its ball centre sits ~62% down the image
        const bw = 24 * 3.1, bh = (bw * ART.ball.naturalHeight) / ART.ball.naturalWidth;
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(-Math.atan2(dx, dy));
        drawImg(ctx, ART.ball, -bw / 2, -bh * 0.62, bw, bh);
        ctx.restore();
      }
    } else if (md.kind === 'itembox' && md.active !== false) {
      const y = b.position.y + Math.sin(time / 300 + b.position.x) * 4;
      const halo = ctx.createRadialGradient(b.position.x, y, 4, b.position.x, y, 34);
      halo.addColorStop(0, 'rgba(255,214,90,0.55)');
      halo.addColorStop(1, 'rgba(255,214,90,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(b.position.x - 34, y - 34, 68, 68);
      ctx.save();
      ctx.translate(b.position.x, y);
      ctx.rotate(Math.sin(time / 500 + b.position.x) * 0.25);
      if (ready(ART.crate)) drawImg(ctx, ART.crate, -18, -16, 36, 32);
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#451a03';
      ctx.strokeText('?', 0, 1);
      ctx.fillStyle = '#fde047';
      ctx.fillText('?', 0, 1);
      ctx.restore();
    }
  }
}

/** The highest cliff edge along a whole run (cached): where its darkening gradient starts. */
const topCache = new WeakMap<Pt[], number>();
function runTop(run: Pt[]): number {
  let top = topCache.get(run);
  if (top === undefined) { top = Math.min(...run.map((p) => p.y + clearance(p.x))); topCache.set(run, top); }
  return top;
}
