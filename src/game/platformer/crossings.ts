// Crossing tracks (Workshop, side-scrolling courses). Turns the course's ramps and curves into track lines, finds where
// tracks cross (or a loop crosses itself) and splits every crossing into passages, each colliding in its own ply bit,
// so a ball only meets the passage it is riding (engine/platformer.ts plyMask). Pure and node-safe.
import type { Piece, TrackDef } from '../trackdef';
import type { CrossPassage, CrossZone, Lane, TrackLine } from './course';
import { MARBLE_RADIUS } from '../types';
import { PLY_COUNT, plyBit } from '../lanes';

type Pt = { x: number; y: number };

/** Segments longer than this are cut (a ramp in a crossing is cut up too, so only its crossing part changes). */
export const SEG_MAX = 48;
/** Ends this close count as joined (the Workshop snaps them exactly; a little slack forgives hand-made joints). */
export const JOIN_NEAR = 24;
/** How far a zone reaches past its crossing points. */
export const ZONE_PAD = 60;
/** Two segments of one track this close along it are neighbours, never a crossing. */
export const NEIGHBOUR_ARC = 120;
/** = build.ts FLOOR_DEPTH: how deep a floor's body reaches behind its running surface. */
export const BODY_DEPTH = 70;
/** Two plain floors only cross when their lines cross at least this steeply (cos of 15 degrees). */
const CROSS_COS = Math.cos((15 * Math.PI) / 180);

/**
 * The points along a curve: at least `n` segments, and never longer than about 40 px each, so a tight bend stays
 * round (the owner: a sharp bend broke into chunks with gaps).
 */
export function curvePoints(a: [number, number], c: [number, number], b: [number, number], n: number): Pt[] {
  const approx = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1]);
  const segs = Math.max(n, Math.min(200, Math.ceil(approx / 40)));
  const pts: Pt[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, u = 1 - t;
    pts.push({ x: u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], y: u * u * a[1] + 2 * u * t * c[1] + t * t * b[1] });
  }
  return pts;
}

/** A ramp's or curve's points in stored order a→b (null for any other piece). */
export function piecePoints(p: Piece): Pt[] | null {
  if (p.t === 'ramp') return [{ x: p.a[0], y: p.a[1] }, { x: p.b[0], y: p.b[1] }];
  if (p.t === 'curve') return curvePoints(p.a, p.c, p.b, p.n ?? 12);
  return null;
}

/** A rail turns upright (a segment steeper than about 84 degrees) or back on itself (it runs both left and right). */
export function isRail(pts: readonly Pt[]): boolean {
  let right = false, left = false;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    if (Math.abs(dx) / len < 0.1) return true;
    if (dx > 0) right = true; else left = true;
  }
  return right && left;
}

export const isRailPiece = (p: Piece): boolean => { const pts = piecePoints(p); return !!pts && isRail(pts); };

/** Cut every segment longer than SEG_MAX into equal parts. */
export function resample(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SEG_MAX));
    for (let j = 1; j <= k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  return out;
}

/** The points a ball rides, in ride order: a rail as stored (a→b), a plain floor left to right. */
export function ridePoints(p: Piece): { pts: Pt[]; rail: boolean } | null {
  const raw = piecePoints(p);
  if (!raw || raw.length < 2) return null;
  const rail = isRail(raw);
  const ordered = rail || raw[raw.length - 1].x >= raw[0].x ? raw : [...raw].reverse();
  return { pts: resample(ordered), rail };
}

/** The solid side of travel from a to b: the right-hand normal in screen coordinates (y down). */
export function solidNormal(a: Pt, b: Pt): Pt {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

/** The body of segment i: what build.ts makes (a rail pushed out along its solid normal, a floor straight down). */
export function segBody(line: Pick<TrackLine, 'pts' | 'rail'>, i: number): Pt[] {
  const a = line.pts[i], b = line.pts[i + 1];
  const n = line.rail ? solidNormal(a, b) : { x: 0, y: 1 };
  return [a, b, { x: b.x + n.x * BODY_DEPTH, y: b.y + n.y * BODY_DEPTH }, { x: a.x + n.x * BODY_DEPTH, y: a.y + n.y * BODY_DEPTH }];
}

/** The space a ball riding segment i rolls through: a ball's width (and a little) on its running side. */
export function segCorridor(line: Pick<TrackLine, 'pts' | 'rail'>, i: number): Pt[] {
  const a = line.pts[i], b = line.pts[i + 1];
  const n = line.rail ? solidNormal(a, b) : { x: 0, y: 1 };
  const h = MARBLE_RADIUS * 2 + 4;
  return [a, b, { x: b.x - n.x * h, y: b.y - n.y * h }, { x: a.x - n.x * h, y: a.y - n.y * h }];
}

/** Do two convex polygons overlap (touching counts)? Separating axis test. */
export function convexOverlap(A: readonly Pt[], B: readonly Pt[]): boolean {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ax = -(q.y - p.y), ay = q.x - p.x;
      if (ax === 0 && ay === 0) continue;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of A) { const d = v.x * ax + v.y * ay; minA = Math.min(minA, d); maxA = Math.max(maxA, d); }
      for (const v of B) { const d = v.x * ax + v.y * ay; minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
      if (maxA < minB - 0.01 || maxB < minA - 0.01) return false;
    }
  }
  return true;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const boxOf = (pts: readonly Pt[]): Box => {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) { b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y); b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y); }
  return b;
};
const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const hit = (a: Box, b: Box): boolean => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const near = (a: Pt, b: Pt): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_NEAR;
const segLen = (pts: readonly Pt[], i: number): number => Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);

/** Every track piece of the active lanes as a line (no crossings found yet: every category 0). */
export function buildLines(def: TrackDef, active: readonly number[]): TrackLine[] {
  const out: TrackLine[] = [];
  def.pieces.forEach((p, source) => {
    if (p.t !== 'ramp' && p.t !== 'curve') return;
    const lane = (p.lane ?? 1) as Lane;
    if (!active.includes(lane)) return;
    const r = ridePoints(p);
    if (!r) return;
    out.push({ lane, source, pts: r.pts, rail: r.rail, cats: r.pts.slice(1).map(() => 0), joins: [], box: boxOf(r.pts) });
  });
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (out[i].lane !== out[j].lane) continue;
      const A = out[i].pts, B = out[j].pts;
      const ends = [A[0], A[A.length - 1]], others = [B[0], B[B.length - 1]];
      if (ends.some((e) => others.some((o) => near(e, o)))) { out[i].joins.push(j); out[j].joins.push(i); }
    }
  }
  return out;
}

/** Shortest distance along the tracks between segment (la, i) and segment (lb, j), or Infinity past `limit`. */
export function arcGap(lines: readonly TrackLine[], la: number, i: number, lb: number, j: number, limit = NEIGHBOUR_ARC): number {
  const key = (l: number, k: number) => l * 100000 + k;
  const dist = new Map<number, number>();
  const queue: [number, number, number][] = [];
  const push = (d: number, l: number, k: number) => {
    if (d > limit || (dist.get(key(l, k)) ?? Infinity) <= d) return;
    dist.set(key(l, k), d);
    queue.push([d, l, k]);
  };
  push(0, la, i);
  push(0, la, i + 1);
  let best = Infinity;
  while (queue.length) {
    queue.sort((p, q) => p[0] - q[0]);
    const [d, l, k] = queue.shift()!;
    if (d > (dist.get(key(l, k)) ?? Infinity)) continue;
    if (l === lb && (k === j || k === j + 1)) best = Math.min(best, d);
    const pts = lines[l].pts;
    if (k > 0) push(d + segLen(pts, k - 1), l, k - 1);
    if (k < pts.length - 1) push(d + segLen(pts, k), l, k + 1);
    if (k === 0 || k === pts.length - 1) {
      for (const o of lines[l].joins) {
        const op = lines[o].pts;
        if (near(op[0], pts[k])) push(d, o, 0);
        if (near(op[op.length - 1], pts[k])) push(d, o, op.length - 1);
      }
    }
  }
  return best;
}

/** Do the running lines of two segments cross each other at a real angle (not just lie along each other)? */
function linesCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  if (o(a, b, c) === o(a, b, d) || o(c, d, a) === o(c, d, b)) return false;
  const la = Math.hypot(b.x - a.x, b.y - a.y) || 1, lc = Math.hypot(d.x - c.x, d.y - c.y) || 1;
  const cos = Math.abs(((b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y)) / (la * lc));
  return cos <= CROSS_COS;
}

/**
 * Finds the crossing zones and writes each zone segment's ply bit into `lines[..].cats`. Two segments touch when one's
 * body reaches into the other's ball corridor and they are not neighbours along one track. Two tracks cross when they
 * touch and one of them is a rail, or (two plain floors) their lines really cross somewhere. Then EVERY touching pair
 * of those two tracks goes into the zone: near an X the upper track's body reaches the lower track's ball before the
 * lines meet. Two plain floors that only lie along each other (a sloppy joint, a deck over a deck) stay as today.
 */
export function findCrossings(lines: TrackLine[]): CrossZone[] {
  const reach = BODY_DEPTH + MARBLE_RADIUS * 2 + 8;
  const segBox = (l: TrackLine, i: number) => boxOf([...segBody(l, i), ...segCorridor(l, i)]);
  const raw: { lane: Lane; box: Box }[] = [];
  for (let la = 0; la < lines.length; la++) {
    for (let lb = la; lb < lines.length; lb++) {
      const A = lines[la], B = lines[lb];
      if (A.lane !== B.lane || !hit(grow(A.box, reach), grow(B.box, reach))) continue;
      const pairs: [number, number][] = [];
      let crosses = A.rail || B.rail;
      for (let i = 0; i < A.pts.length - 1; i++) {
        const boxA = segBox(A, i);
        for (let j = la === lb ? i + 1 : 0; j < B.pts.length - 1; j++) {
          const boxB = segBox(B, j);
          if (!hit(boxA, boxB)) continue;
          const touch = convexOverlap(segBody(A, i), segCorridor(B, j)) || convexOverlap(segBody(B, j), segCorridor(A, i));
          if (!touch) continue;
          if (arcGap(lines, la, i, lb, j) <= NEIGHBOUR_ARC) continue;
          pairs.push([i, j]);
          if (!crosses && linesCross(A.pts[i], A.pts[i + 1], B.pts[j], B.pts[j + 1])) crosses = true;
        }
      }
      if (!crosses) continue;
      for (const [i, j] of pairs) raw.push({ lane: A.lane, box: grow(union(boxOf([A.pts[i], A.pts[i + 1]]), boxOf([B.pts[j], B.pts[j + 1]])), ZONE_PAD) });
    }
  }
  // Merge boxes of one lane that touch (or come within one segment of each other), until nothing merges.
  const boxes = raw.slice();
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i].lane !== boxes[j].lane || !hit(grow(boxes[i].box, SEG_MAX), boxes[j].box)) continue;
        boxes[i] = { lane: boxes[i].lane, box: union(boxes[i].box, boxes[j].box) };
        boxes.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  const zones: CrossZone[] = [];
  for (const { lane, box } of boxes) {
    // Runs: per line, the longest stretches of consecutive segments whose own box touches the zone box.
    const runs: [number, number, number][] = [];
    lines.forEach((l, li) => {
      if (l.lane !== lane || !hit(l.box, box)) return;
      let start = -1;
      for (let i = 0; i <= l.pts.length - 1; i++) {
        const inside = i < l.pts.length - 1 && hit(boxOf([l.pts[i], l.pts[i + 1]]), box);
        if (inside && start < 0) start = i;
        if (!inside && start >= 0) { runs.push([li, start, i - 1]); start = -1; }
      }
    });
    // Passages: runs joined end to end (one track through the zone) are one passage.
    const parent = runs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const endsOf = ([li, s0, s1]: [number, number, number]) => {
      const pts = lines[li].pts, out: Pt[] = [];
      if (s0 === 0) out.push(pts[0]);
      if (s1 === pts.length - 2) out.push(pts[pts.length - 1]);
      return out;
    };
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        if (runs[i][0] === runs[j][0]) continue;
        if (endsOf(runs[i]).some((e) => endsOf(runs[j]).some((o) => near(e, o)))) parent[find(i)] = find(j);
      }
    }
    const groups = new Map<number, [number, number, number][]>();
    runs.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), r]); });
    const passages: CrossPassage[] = [...groups.values()]
      .map((rs) => ({ id: 0, bit: 0, depth: Math.max(...rs.map(([li]) => lines[li].source)), runs: rs }))
      .sort((a, b) => a.depth - b.depth);
    if (passages.length < 2) continue; // one track alone in a box is no crossing
    passages.forEach((p, k) => { p.id = k; p.bit = plyBit(k); }); // more than PLY_COUNT: the extras share the last bit
    for (const p of passages) for (const [li, s0, s1] of p.runs) for (let i = s0; i <= s1; i++) lines[li].cats[i] = p.bit;
    zones.push({ lane, ...box, passages });
  }
  void PLY_COUNT;
  return zones;
}

/**
 * What a course's track pieces become: the track lines worth building as lines (every rail, and every piece in a
 * crossing), the crossing zones (line indices point into `tracks`), and the piece indices of each kind.
 */
export interface TrackPlan { tracks: TrackLine[]; crossings: CrossZone[]; rails: Set<number>; crossing: Set<number> }

const cache = new WeakMap<TrackDef, TrackPlan>();

/** The course's track plan, worked out once per def object (settle returns the same object when nothing moved). */
export function trackPlanOf(def: TrackDef, active: readonly number[]): TrackPlan {
  const hitCache = cache.get(def);
  if (hitCache) return hitCache;
  const lines = buildLines(def, active);
  const zones = findCrossings(lines);
  const crossing = new Set<number>();
  for (const z of zones) for (const p of z.passages) for (const [li] of p.runs) crossing.add(lines[li].source);
  const keep = lines.map((l, i) => (l.rail || crossing.has(l.source) ? i : -1)).filter((i) => i >= 0);
  const newIndex = new Map(keep.map((old, i) => [old, i]));
  const tracks = keep.map((old) => ({ ...lines[old], joins: lines[old].joins.filter((j) => newIndex.has(j)).map((j) => newIndex.get(j)!) }));
  const crossings = zones.map((z) => ({ ...z, passages: z.passages.map((p) => ({ ...p, runs: p.runs.map(([li, s0, s1]) => [newIndex.get(li)!, s0, s1] as [number, number, number]) })) }));
  const rails = new Set(tracks.filter((l) => l.rail).map((l) => l.source));
  const out = { tracks, crossings, rails, crossing };
  cache.set(def, out);
  return out;
}
