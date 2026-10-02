// P2-00 (#124): the coaster skin for rolling-slope (flow) courses — the owner's reference look: a red-and-white
// chevron rail on a wooden beam, carried on braced timber trestles over mossy rock cliffs, with goblin towers,
// torches, banners and the sheep spring. Built from the game's existing painted art; a skin only (physics is the
// plain floor pieces from build.ts). Returns false until the art has loaded, and the caller draws a fallback.
import type { CoursePlan, Floor, Lane } from './course';
import { SPRING_W } from './course';
import { LEDGE_H } from './build';
import railChevronUrl from '../../assets/game/rail-chevron.webp';
import railWoodUrl from '../../assets/game/rail-wood.webp';
import rockFillUrl from '../../assets/game/rock-fill.webp';
import mossUrl from '../../assets/game/strip-moss.webp';
import sheepUrl from '../../assets/game/sheep-spring.webp';
import crateUrl from '../../assets/game/crate.webp';
import tower1Url from '../../assets/game/tower-1.webp';
import tower2Url from '../../assets/game/tower-2.webp';
import tower3Url from '../../assets/game/tower-3.webp';
import torchUrl from '../../assets/game/torch.webp';
import bannerUrl from '../../assets/game/banner.webp';

const load = (src: string) => (typeof Image !== 'undefined' ? Object.assign(new Image(), { src }) : null);
const ART = {
  chevron: load(railChevronUrl), wood: load(railWoodUrl), rock: load(rockFillUrl), moss: load(mossUrl), sheep: load(sheepUrl),
  crate: load(crateUrl), towers: [load(tower1Url), load(tower2Url), load(tower3Url)], torch: load(torchUrl), banner: load(bannerUrl),
};
const ready = (img: HTMLImageElement | null): img is HTMLImageElement => !!img && img.complete && img.naturalWidth > 0;
const allReady = () => ready(ART.chevron) && ready(ART.wood) && ready(ART.rock) && ready(ART.moss);

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

/** The chevron rail's thickness and where it sits on the floor's top edge (the ball rolls on the rail's top). */
const RAIL_T = 26;
const RAIL_UP = 5;
const BEAM_T = 24;
const POST_EVERY = 150;
const WOOD = '#7a5230';
const WOOD_DARK = '#3b2614';
const IRON = '#4a4d55';

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
    const floors = plan.floors.filter((f) => f.lane === lane).sort((a, b) => a.x0 - b.x0);
    const out: Pt[][] = [];
    let run: Pt[] = [];
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

function yOn(run: Pt[], x: number): number {
  let lo = 0, hi = run.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (run[mid].x <= x) lo = mid; else hi = mid; }
  const a = run[lo], b = run[hi];
  return a.y + ((x - a.x) / Math.max(1e-6, b.x - a.x)) * (b.y - a.y);
}

/** Lay a strip image along a polyline, `up` px above it and `thick` tall, continuing the texture piece to piece. */
function stripAlong(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, pts: Pt[], up: number, thick: number) {
  const tw = (img.width / img.height) * thick;
  const srcPerPx = img.width / tw;
  let u = (((pts[0].x % tw) + tw) % tw);
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
      ctx.drawImage(img, at * srcPerPx, 0, Math.max(1, piece * srcPerPx), img.height, done - 0.6, -up, piece + 1.2, thick);
      done += piece;
    }
    ctx.restore();
    u = (u + len) % tw;
  }
}

function clip(run: Pt[], left: number, right: number): Pt[] {
  let i0 = 0;
  while (i0 < run.length - 1 && run[i0 + 1].x < left) i0++;
  let i1 = run.length - 1;
  while (i1 > 0 && run[i1 - 1].x > right) i1--;
  return run.slice(i0, i1 + 1);
}

/** A timber trestle between the track and the cliff: posts every POST_EVERY px, X braces, iron plates. */
function trestle(ctx: CanvasRenderingContext2D, run: Pt[], x0: number, x1: number, ground: (x: number) => number) {
  const posts: { x: number; top: number; foot: number }[] = [];
  for (let x = Math.ceil(x0 / POST_EVERY) * POST_EVERY; x <= x1; x += POST_EVERY) {
    if (x < run[0].x + 12 || x > run[run.length - 1].x - 12) continue;
    posts.push({ x, top: yOn(run, x) + RAIL_T - RAIL_UP + BEAM_T - 8, foot: ground(x) + 10 });
  }
  ctx.lineCap = 'round';
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1];
    const mid = Math.min(a.foot, b.foot);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(a.x, a.top + 6); ctx.lineTo(b.x, mid - 8);
    ctx.moveTo(b.x, b.top + 6); ctx.lineTo(a.x, mid - 8);
    ctx.stroke();
    ctx.strokeStyle = '#6a4628';
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  for (const p of posts) {
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(p.x - 8, p.top, 16, p.foot - p.top);
    ctx.fillStyle = WOOD;
    ctx.fillRect(p.x - 6, p.top, 12, p.foot - p.top);
    ctx.fillStyle = IRON;
    ctx.fillRect(p.x - 9, p.top + 2, 18, 12);
    ctx.fillStyle = '#8a8f98';
    ctx.fillRect(p.x - 5, p.top + 6, 3, 3);
    ctx.fillRect(p.x + 2, p.top + 6, 3, 3);
  }
}

/**
 * Draw one lane of a flow course in the coaster look. Returns false (draws nothing) until the art is loaded.
 * Order: cliffs, towers, trestles, the beam and rail, then props on the track.
 */
export function drawCoasterLane(ctx: CanvasRenderingContext2D, plan: CoursePlan, lane: Lane, left: number, right: number, bottom: number, time: number, springFired: (x: number) => boolean): boolean {
  if (!allReady()) return false;
  const runs = runsOf(plan)[lane];
  const rock = rockPattern(ctx);
  for (const run of runs) {
    if (run[run.length - 1].x < left || run[0].x > right) continue;
    const pts = clip(run, left, right);
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
    const top = Math.min(...cliff.map((p) => p.y));
    const g = ctx.createLinearGradient(0, top, 0, top + 500);
    g.addColorStop(0, 'rgba(30,24,20,0)');
    g.addColorStop(1, 'rgba(18,14,12,0.6)');
    ctx.fillStyle = g;
    ctx.fill();
    if (pts[0] === run[0]) { ctx.fillStyle = 'rgba(20,14,10,0.55)'; ctx.fillRect(cliff[0].x, cliff[0].y, 10, bottom - cliff[0].y); }
    if (pts[pts.length - 1] === run[run.length - 1]) { const e = cliff[cliff.length - 1]; ctx.fillStyle = 'rgba(20,14,10,0.55)'; ctx.fillRect(e.x - 10, e.y, 10, bottom - e.y); }
    stripAlong(ctx, ART.moss!, cliff, 14, 30);
    // goblin watchtowers on the cliffs, now and then (behind the track)
    for (let x = Math.floor(pts[0].x / 1800) * 1800 + 900; x < pts[pts.length - 1].x; x += 1800) {
      const r = hash(Math.round(x), lane + 11);
      const img = ART.towers[Math.floor(r * 3)];
      if (r > 0.3 || !ready(img) || x < run[0].x + 120 || x > run[run.length - 1].x - 120) continue;
      const h = 360 + r * 200;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      const foot = yOn(run, x) + clearance(x) + 16;
      ctx.drawImage(img, x - w / 2, foot - h, w, h);
    }
    trestle(ctx, run, pts[0].x - POST_EVERY, pts[pts.length - 1].x + POST_EVERY, (x) => yOn(run, x) + clearance(x));
    // the track: a wooden beam, and the chevron rail on top of it
    stripAlong(ctx, middle(ART.wood!), pts, RAIL_UP - RAIL_T + 10, BEAM_T + 4);
    stripAlong(ctx, middle(ART.chevron!), pts, RAIL_UP, RAIL_T);
    // torches on some posts, banners under the beam
    for (let x = Math.ceil(pts[0].x / (POST_EVERY * 4)) * POST_EVERY * 4; x < pts[pts.length - 1].x; x += POST_EVERY * 4) {
      const r = hash(Math.round(x), lane + 3);
      const y = yOn(run, x);
      if (r < 0.35 && ready(ART.banner)) ctx.drawImage(ART.banner, x - 30, y + RAIL_T - RAIL_UP + 6, 60, 62);
      else if (r < 0.6 && ready(ART.torch)) {
        const flicker = 1 + Math.sin(time / 90 + x) * 0.03;
        ctx.drawImage(ART.torch, x - 14, y - 66 * flicker, 28, 52 * flicker);
      }
    }
  }
  // crates on the track
  for (const b of plan.bumps) {
    if (b.lane !== lane || b.x + b.w < left || b.x > right) continue;
    if (ready(ART.crate)) {
      const n = Math.max(1, Math.round(b.w / b.h));
      for (let i = 0; i < n; i++) ctx.drawImage(ART.crate, b.x + (i * b.w) / n, b.y, b.w / n, b.h + 6);
    }
  }
  // ledges: spur tracks on posts
  for (const l of plan.ledges ?? []) {
    if (l.lane !== lane || l.x + l.w < left || l.x > right) continue;
    for (let px = l.x + 20; px < l.x + l.w - 10; px += 160) {
      const under = runs.find((r) => px >= r[0].x && px <= r[r.length - 1].x);
      const foot = under ? yOn(under, px) - RAIL_UP : bottom;
      ctx.fillStyle = WOOD_DARK;
      ctx.fillRect(px - 7, l.y + LEDGE_H, 14, foot - l.y - LEDGE_H);
      ctx.fillStyle = WOOD;
      ctx.fillRect(px - 5, l.y + LEDGE_H, 10, foot - l.y - LEDGE_H);
    }
    const flat = [{ x: l.x, y: l.y }, { x: l.x + l.w, y: l.y }];
    stripAlong(ctx, middle(ART.wood!), flat, 2, LEDGE_H + 8);
    ctx.drawImage(ART.wood!, 0, 0, ART.wood!.naturalWidth * RAIL_CAP, ART.wood!.naturalHeight, l.x - 10, l.y - 2, 22, LEDGE_H + 8);
    ctx.drawImage(ART.wood!, ART.wood!.naturalWidth * (1 - RAIL_CAP), 0, ART.wood!.naturalWidth * RAIL_CAP, ART.wood!.naturalHeight, l.x + l.w - 12, l.y - 2, 22, LEDGE_H + 8);
  }
  // springs: the sheep on its coil
  for (const s of plan.springs ?? []) {
    if (s.lane !== lane || s.x + SPRING_W < left || s.x > right || !ready(ART.sheep)) continue;
    const squash = springFired(s.x) ? 0.82 : 1;
    const w = SPRING_W + 18;
    const h = (ART.sheep.naturalHeight / ART.sheep.naturalWidth) * w * squash;
    ctx.drawImage(ART.sheep, s.x - 9, s.y - h + 4, w, h);
  }
  return true;
}
