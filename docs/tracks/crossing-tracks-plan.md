# Crossing tracks and curve loops: implementation guide

Owner ask (2026-10-07): track pieces get depth, so curves can make complex loops where tracks overlap, and a ball only
meets the track it last touched.

Owner decisions (2026-10-07):
- Loops are built from **joined curves** (plus Workshop kits that place a ready-made loop).
- A ball arriving at a crossing with no track of its own there is caught by the **front** track (the one drawn on top;
  front/back is the existing piece order: Bring to front / Send to back).
- **Steering stays on inside loops.** No lock, no magnet: a ball that loses momentum simply falls.

This guide is written so it can be implemented step by step without design decisions. Do the four PRs **in order**,
merge each before starting the next. Every step says which file, which function, and what code. When a step says
"exactly", copy it. When the existing code differs a little from what is quoted here (line numbers drift), find the
quoted lines by searching for them.

---------------------------------------------------------------------------------------------------------------------

## 0. Read this first

### 0.1 Scope
Side-scrolling (platformer) Workshop courses only (`def.mode === 'platformer'`). Classic drop tracks, Infinity, the
official courses and the existing Loop piece are **not** changed.

### 0.2 The golden rule: courses without rails or crossings build exactly as today
A course whose ramps and curves are all left-to-right and never cross gets **no** `plan.tracks`, **no**
`plan.crossings`, and exactly the same bodies as before. Every new code path starts with "if there are no
tracks/crossings, do what we did before". Test 1.8 checks this on every official course.

### 0.3 Words used in this guide
- **Track piece**: a `ramp` or `curve` piece on a platformer course. (Ice is not a track piece here: it stays a classic piece.)
- **Ride order**: the order a ball rides a track piece's points. For a rail it is the stored order `a → b`. For a plain
  floor it is left to right (as `def.ts slab()` does today).
- **Rail**: a track piece that turns upright or back on itself (see `isRail`). It is solid on the **right-hand side of
  its direction of travel** (screen coordinates, y down): below when going right, to the right when climbing,
  **above** when going left (upside down at the top of a loop). Its body is the segment pushed out along that normal.
- **Plain floor**: every other track piece: solid straight below, as today.
- **Track line**: a track piece turned into a polyline in ride order, with one collision category per segment. Only
  rails and pieces that take part in a crossing become track lines (`plan.tracks`).
- **Crossing zone**: a box (per lane) where two tracks come close enough to touch each other's ball, but are not
  neighbours along the same track. The two halves of a loop's bottom are the standard example.
- **Passage**: one way through a zone (one track, or several joined pieces of one track). Each passage of a zone has
  its own **ply bit** (a Matter collision category). Inside a zone a ball collides only with its own passage.
- **Depth of a passage**: the highest piece index among its pieces. Higher = drawn later = in front.

### 0.4 How it works in one paragraph
`planFromTrackDef` builds track lines from the def, finds crossing zones, and gives the segments inside each zone their
passage's ply bit as collision category (outside zones: the normal `CAT_WALL`). `planBodies` builds a body per
track-line segment. Every step `applyLaneMask` adds ply bits to the ball's mask: outside zones **all** ply bits (every
track solid), inside a zone only the bit of the passage the ball is on. The passage comes from the track segment the
ball last touched (`m.track`, written from collision events). If it has none: rolling, the nearest passage; in the air,
the front one. The renderer paints a zone's passages back to front with their balls in between, so a ball on the back
track passes behind the front one.

### 0.5 Workflow (every PR)
1. Work in a git worktree, never in the main checkout:
   ```bash
   git -C "C:/Work Admin/PERSONAL/Repos/Heavy-Metal-GP" fetch origin
   git -C "C:/Work Admin/PERSONAL/Repos/Heavy-Metal-GP" worktree add .wt/crossings-1 -b crossings-1 origin/main
   ```
   Link `node_modules` with a junction (`cmd /c mklink /J node_modules ..\..\node_modules` inside the worktree).
   **Never** `git worktree remove --force` while the junction exists: remove the junction first (`cmd /c rmdir node_modules`).
2. Open a draft PR early and push after every commit.
3. Type check: `node node_modules/typescript/bin/tsc --noEmit` (must be clean).
4. Tests: `node --import tsx --test tests/<file>.test.ts` for each file the PR lists.
5. Merge the PR yourself when tsc and the listed tests pass, then update the main checkout (`git pull --ff-only` there).
6. Do not deploy. Deploying happens only when the owner says "push and publish".
7. Do not use `localStorage`. Physics stays vector shapes; art is only a skin.

---------------------------------------------------------------------------------------------------------------------

## PR 1: physics (model, bodies, engine)

Branch `crossings-1`. Files owned by this PR:
- `src/game/lanes.ts` (add constants at the end)
- `src/game/platformer/course.ts` (types only)
- `src/game/platformer/crossings.ts` (**new**)
- `src/game/platformer/track-kits.ts` (**new**)
- `src/game/platformer/def.ts`
- `src/game/platformer/build.ts`
- `src/game/track.ts` (Meta fields only)
- `src/game/engine.ts` (Marble fields only)
- `src/game/engine/platformer.ts`
- `src/game/engine/input.ts`
- `src/game/engine/hits.ts`
- `tests/crossings.test.ts` (**new**), `tests/crossing-ride.test.ts` (**new**)

### 1.1 `src/game/lanes.ts`: ply bits
Append at the end of the file:

```ts
/**
 * Crossing tracks: each way through a crossing (a passage) collides in its own category, one of these eight bits. A ball
 * inside a crossing keeps only its own passage's bit in its mask; outside crossings it keeps all of them (every track is
 * solid). The bits sit above the lane bits (0x1000..0x4000) and every other category in track.ts.
 */
export const PLY_COUNT = 8;
export const CAT_PLY0 = 0x10000;
export const ALL_PLY = 0xff0000;
export const plyBit = (k: number): number => CAT_PLY0 << Math.max(0, Math.min(PLY_COUNT - 1, k));
```

### 1.2 `src/game/platformer/course.ts`: types
1. Change the `Floor` interface (search `export interface Floor`) by adding one optional field at the end:
   ```ts
   /** Crossing tracks: a plain floor that is also a track line (plan.tracks builds its body; draw it, do not build it here) */
   noBody?: boolean;
   ```
2. Change `BeamPath` to:
   ```ts
   /** A Workshop curve's beam, painted whole along its own shape (it may turn vertical or bend back on itself). */
   export interface BeamPath {
     lane: Lane;
     pts: { x: number; y: number }[];
     /** A rail: the points are in ride order and the beam sits on the solid side of travel (else it is painted left to right). */
     oriented?: boolean;
     /** The piece's index in the def (beams are drawn in this order: higher is in front). */
     source?: number;
   }
   ```
3. Add these types right after `BeamPath`:
   ```ts
   /**
    * Crossing tracks: a Workshop track piece built as its own line of segments (a rail, or a floor that takes part in a
    * crossing). Points are in ride order. A rail is solid on the right-hand side of travel; a plain floor straight below.
    */
   export interface TrackLine {
     lane: Lane;
     /** The piece's index in the def (its depth: a higher index is drawn in front). */
     source: number;
     pts: { x: number; y: number }[];
     rail: boolean;
     /** Collision category of each segment (pts.length - 1 entries): 0 = the ordinary CAT_WALL, else a ply bit. */
     cats: number[];
     /** Indices (in plan.tracks) of the lines whose ends meet this line's ends. */
     joins: number[];
     /** Bounding box of the points. */
     box: { x0: number; y0: number; x1: number; y1: number };
   }
   /** One way through a crossing zone: runs of segments `[line, firstSeg, lastSeg]` (inclusive), one ply bit. */
   export interface CrossPassage { id: number; bit: number; depth: number; runs: [number, number, number][] }
   /** A box where tracks cross; inside it a ball collides only with its own passage. */
   export interface CrossZone { lane: Lane; x0: number; y0: number; x1: number; y1: number; passages: CrossPassage[] }
   ```
4. In `interface CoursePlan`, after `beams?: BeamPath[];` add:
   ```ts
   /** Crossing tracks: Workshop rails and crossing floors, built as lines (absent = none: every floor is in `floors`). */
   tracks?: TrackLine[];
   /** Crossing tracks: where tracks cross (absent = none). */
   crossings?: CrossZone[];
   ```

### 1.3 `src/game/platformer/crossings.ts` (new file)
Create it with exactly this content. It is pure: no Matter, no DOM, no imports that could form a cycle.

```ts
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
```

Notes for the implementer:
- `lanes.ts` has no imports and `types.ts` has none either, so this file adds no import cycle. Do **not** import from
  `build.ts` or `track.ts` here.
- If `tsc` complains that `Lane` is not exported from `course.ts`, check its name there (`export type Lane`) and use it.

### 1.4 `src/game/platformer/track-kits.ts` (new file)
These are the Workshop kits (PR 3 puts them in the palette) and the shapes the tests ride.

```ts
// Workshop track kits for side-scrolling courses: ready-made shapes built from ordinary ramps and curves, joined end to
// end in ride order, so they stay editable piece by piece. Every kit is placed around (x, y): y is the floor line.
import type { Piece } from '../trackdef';

/** The loop's radius. The Loop piece rides at 90; keep the kit close to it (it must be ridable at a normal run-up speed). */
export const KIT_R = 100;
/** Half the gap between the way into a loop and the way out (the two cross at the bottom). */
export const KIT_HALF_PITCH = 60;
/** Run-up and run-out length. */
export const KIT_RUN = 500;

type V = [number, number];
const ramp = (a: V, b: V): Piece => ({ t: 'ramp', a, b, cliff: false });
const curve = (a: V, c: V, b: V): Piece => ({ t: 'curve', a, c, b, n: 12, cliff: false });

/** The four quarter curves of a loop standing on the floor line y at x (entry at x - H, exit at x + H). */
export function loopCurves(x: number, y: number, R = KIT_R, H = KIT_HALF_PITCH): Piece[] {
  return [
    curve([x - H, y], [x + R, y], [x + R, y - R]),            // along the floor and up the far side
    curve([x + R, y - R], [x + R, y - 2 * R], [x, y - 2 * R]), // over the top (upside down)
    curve([x, y - 2 * R], [x - R, y - 2 * R], [x - R, y - R]), // down the near side
    curve([x - R, y - R], [x - R, y], [x + H, y]),             // back to the floor, crossing the way in
  ];
}

/** A loop with its run-up and run-out: 6 pieces, joined end to end. */
export function loopKit(x: number, y: number): Piece[] {
  const H = KIT_HALF_PITCH;
  return [ramp([x - KIT_RUN, y], [x - H, y]), ...loopCurves(x, y), ramp([x + H, y], [x + KIT_RUN, y])].map((p) => ({ ...p, grp: 1 }));
}

/** Two loops one after the other, joined by a straight. */
export function doubleLoopKit(x: number, y: number): Piece[] {
  const H = KIT_HALF_PITCH, gap = 2 * KIT_R + 2 * H + 200;
  const x1 = x - gap / 2, x2 = x + gap / 2;
  return [
    ramp([x1 - KIT_RUN, y], [x1 - H, y]), ...loopCurves(x1, y), ramp([x1 + H, y], [x2 - H, y]), ...loopCurves(x2, y), ramp([x2 + H, y], [x2 + KIT_RUN, y]),
  ].map((p) => ({ ...p, grp: 1 }));
}

/** An overpass: a flat track and a steep one diving across it. The one placed later (the dive) is in front. */
export function overpassKit(x: number, y: number): Piece[] {
  return [ramp([x - 500, y], [x + 500, y]), ramp([x - 400, y - 200], [x + 400, y + 200])].map((p) => ({ ...p, grp: 1 }));
}
```

`PieceBase` has `grp?: number` (used by the Workshop's groups); if `tsc` rejects `cliff` on a ramp, check
`RampPiece` in `trackdef.ts` (it has `cliff?: false`).

### 1.5 `src/game/platformer/def.ts`
1. Imports: add
   ```ts
   import { curvePoints, ridePoints, trackPlanOf } from './crossings';
   ```
   and **delete** the local `curvePoints` function (the one documented "The points along a curve"). Keep it
   exported for anyone who imports it from here: add `export { curvePoints } from './crossings';` next to the imports.
   (Nothing outside `def.ts` imports it today, but keep the re-export.)
2. Replace `pieceFloors` with:
   ```ts
   /** The floors the def's own pieces make (not the start platform or the run-out). */
   export function pieceFloors(def: TrackDef): Floor[] {
     const tp = trackPlanOf(def, lanesOf(def.lanes));
     const out: Floor[] = [];
     def.pieces.forEach((p, i) => {
       if (p.t !== 'ramp' && p.t !== 'ice' && p.t !== 'curve') return;
       if (p.t !== 'ice' && tp.rails.has(i)) {
         // A rail: only its stretches that run to the right like ground are floor (for springs, the drivers, the safety
         // net). They are hidden: the rail's own line builds its body and its beam paints it.
         const r = ridePoints(p)!;
         for (let k = 1; k < r.pts.length; k++) {
           const a = r.pts[k - 1], b = r.pts[k];
           const len = Math.hypot(b.x - a.x, b.y - a.y);
           if (len > 0.5 && (b.x - a.x) / len >= 0.5) out.push({ lane: laneOf(p), x0: a.x, y0: a.y, x1: b.x, y1: b.y, hidden: true, noCliff: true });
         }
         return;
       }
       const float = (floors: Floor[]) => ((p.t === 'ramp' || p.t === 'curve') && p.cliff === false ? floors.map((f) => ({ ...f, noCliff: true })) : floors);
       // A floor in a crossing: drawn and measured as before, but its body is built from its line and it never has a cliff.
       const crossing = (floors: Floor[]) => (p.t !== 'ice' && tp.crossing.has(i) ? floors.map((f) => ({ ...f, noBody: true, noBeam: true, noCliff: true })) : floors);
       if (p.t === 'ramp' || p.t === 'ice') out.push(...crossing(float(slab(laneOf(p), p.a[0], p.a[1], p.b[0], p.b[1]))));
       else out.push(...crossing(float(curveFloors(laneOf(p), p.a, p.c, p.b, p.n ?? 12))));
     });
     return out;
   }
   ```
   **Careful**: the old `pieceFloors` handled `ice` too (`p.t === 'ramp' || p.t === 'ice'`). Keep ice exactly as before:
   ice is never in `tp.rails` or `tp.crossing` because `buildLines` only takes ramps and curves. The `p.t !== 'ice'`
   checks above make that explicit.
3. Add this function right after `floorYAt`:
   ```ts
   /**
    * The floor at x nearest to height y (where tracks cross, a spring or crate stays on the track it was put on), or
    * null over a gap. Ties go to the higher surface, so where floors do not overlap it is exactly floorYAt.
    */
   export function floorYNear(floors: readonly Floor[], lane: Lane, x: number, y: number): number | null {
     let best: number | null = null;
     for (const f of floors) {
       if (f.lane !== lane || x < f.x0 || x > f.x1) continue;
       const fy = f.y0 + ((x - f.x0) / (f.x1 - f.x0)) * (f.y1 - f.y0);
       if (best === null) { best = fy; continue; }
       const d = Math.abs(fy - y), bd = Math.abs(best - y);
       if (d < bd - 0.5 || (Math.abs(d - bd) <= 0.5 && fy < best)) best = fy;
     }
     return best;
   }
   ```
4. In `settle`, change the `snap` helper from `floorYAt(floors, lane, x) ?? y` to `floorYNear(floors, lane, x, y) ?? y`.
   Nothing else in `settle` changes.
5. In `planFromTrackDef`, replace the two lines that build `beams` (the comment
   `// each Workshop curve's beam, painted whole along its shape (coaster.ts)` and the `for` under it) with:
   ```ts
   // Each Workshop curve's beam, painted whole along its shape (coaster.ts); a rail's or a crossing piece's beam follows
   // its track line (in ride order, on its solid side). Beams are drawn in piece order: a later piece is in front.
   const tp = trackPlanOf(def, active);
   const lineOf = new Map(tp.tracks.map((l) => [l.source, l]));
   const beams: NonNullable<CoursePlan['beams']> = [];
   def.pieces.forEach((p, source) => {
     if ((p.t !== 'curve' && p.t !== 'ramp') || !active.includes(laneOf(p))) return;
     const line = lineOf.get(source);
     if (line) beams.push({ lane: line.lane, pts: line.pts, oriented: line.rail, source });
     else if (p.t === 'curve') beams.push({ lane: laneOf(p), pts: curvePoints(p.a, p.c, p.b, p.n ?? 12), source });
   });
   ```
   and in the returned object, after `...(beams.length ? { beams } : {}),` add:
   ```ts
   ...(tp.tracks.length ? { tracks: tp.tracks } : {}),
   ...(tp.crossings.length ? { crossings: tp.crossings } : {}),
   ```
   Note: `trackPlanOf(def, active)` here and `trackPlanOf(def, lanesOf(def.lanes))` in `pieceFloors` use the same
   lanes (`active = lanesOf(def.lanes)`), so the cache returns one result for both.

### 1.6 `src/game/platformer/build.ts`: bodies
1. Imports: none to add (`CAT_WALL`, `quad` and `FLOOR_DEPTH` are already in this file).
2. In `planBodies`, change the first loop's skip line from `if (f.hidden) continue;` to
   `if (f.hidden || f.noBody) continue;`.
3. Right after that `for (const f of plan.floors)` loop, add:
   ```ts
   // Crossing tracks: rails and crossing floors, one body per segment. A rail's body lies on the right-hand side of
   // travel (it can run upright or upside down); a floor's hangs straight down as above. Segments inside a crossing
   // collide in their passage's ply bit (engine/platformer.ts plyMask), all others as ordinary walls.
   (plan.tracks ?? []).forEach((line, li) => {
     for (let i = 0; i < line.pts.length - 1; i++) {
       const a = line.pts[i], b = line.pts[i + 1];
       const len = Math.hypot(b.x - a.x, b.y - a.y);
       if (len < 0.5) continue;
       const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
       const n = line.rail ? { x: -ty, y: tx } : { x: 0, y: 1 };
       const depth = line.rail ? -1 : Math.max(240, plan.height - Math.max(a.y, b.y));
       const body = quad([a, b, { x: b.x + n.x * FLOOR_DEPTH, y: b.y + n.y * FLOOR_DEPTH }, { x: a.x + n.x * FLOOR_DEPTH, y: a.y + n.y * FLOOR_DEPTH }], line.lane, 'floor', depth);
       body.collisionFilter.category = line.cats[i] || CAT_WALL;
       body.plugin = { kind: 'floor', lane: line.lane, depth, line: li, seg: i, rail: line.rail, tx, ty, source: line.source };
       bodies.push(body);
     }
   });
   ```

### 1.7 `src/game/track.ts`: Meta fields
In `interface Meta` (search `export interface Meta`), next to the existing `lane?: number;` / `depth?: number;`, add:
```ts
/** Crossing tracks: the body is segment `seg` of plan.tracks[line] (piece `source`); a rail's direction of travel (tx, ty). */
line?: number;
seg?: number;
rail?: boolean;
tx?: number;
ty?: number;
source?: number;
```
If `source` already exists there, do not add it twice.

### 1.8 `tests/crossings.test.ts` (new): the model
Create it (pattern: `tests/floating-floors.test.ts`). Header: `// Run with: node --import tsx --test tests/crossings.test.ts`.
Write these tests (use `node:test` and `node:assert/strict`):

1. **isRail**:
   `isRail` of `piecePoints({ t: 'curve', a: [0, 0], c: [300, 120], b: [600, 0] })` is false (a valley);
   of `{ t: 'curve', a: [0, 0], c: [400, 0], b: [100, -300] }` is true (it turns back);
   of `{ t: 'ramp', a: [100, 0], b: [100, -200] }` is true (upright);
   of `{ t: 'curve', a: [600, 0], c: [300, 120], b: [0, 0] }` is false (right to left but never turns).
2. **ridePoints**: a plain floor stored right-to-left comes back left-to-right; a rail keeps a→b; no segment is longer
   than `SEG_MAX + 0.01`.
3. **Loop kit plan**: `const def = { ...newPlatformerDef('Loop', 4000), pieces: loopKit(1600, 800) }`,
   `const plan = planFromTrackDef(def)`. Assert:
   - `plan.tracks.length === 6` (all six pieces are lines: 4 rails + 2 crossing ramps);
   - `plan.tracks.filter((l) => l.rail).length === 4`;
   - `plan.crossings.length === 1`, and that zone has exactly 2 passages with different `bit`s;
   - the passage containing the run-up (source 0) also contains the first curve (source 1); the passage containing the
     last curve (source 4) also contains the run-out (source 5). (Map runs through `plan.tracks[li].source`.)
   - the zone box contains the point (1600, 790).
   - no floor in `plan.floors` with `x0 >= 1500 && x1 <= 1700 && y0 < 700` (the loop's top is not ground).
4. **Overpass kit**: `overpassKit(1600, 800)` → 1 zone, 2 passages, the dive (source 1) has the higher `depth`.
5. **Parallel decks are not a crossing**: two ramps `[1000,800]→[2000,800]` and `[1000,740]→[2000,740]` →
   `plan.crossings === undefined` and `plan.tracks === undefined`.
6. **Sloppy joint is not a crossing**: ramp `[1000,800]→[1500,800]` and curve `a [1490,802] c [1700,900] b [1900,850]`
   → no crossings, no tracks.
7. **Golden rule on every official course**: for each `c` of `PLATFORMER_COURSES` (from `course.ts`):
   `const def = defFromPlan(planOfficial(c), c.id)`; `const plan = planFromTrackDef(def)`;
   assert `plan.tracks === undefined && plan.crossings === undefined`, and that no body in
   `planBodies(plan).bodies` has `meta(b).line !== undefined`.
   (Check the exact export names `planOfficial`, `platformerCourse`, `PLATFORMER_COURSES` in `course.ts`;
   `tests/platformer-routes.test.ts` imports them.)
   **If this test fails** because a Workshop copy of an official course turns out to have a rail (a curve steeper than
   about 84 degrees) or a crossing: do not change the thresholds and do not weaken the test. Print which course, piece
   and x, stop, and ask the owner.
8. **settle keeps a spring on its own track**: overpass kit + a spring `{ t: 'pad', x: 1700, y: 800, w: 60, dir: 1 }`
   (on the flat track, right of the crossing where the dive is lower): after `settle`, the pad's `y` is 800 (not the
   dive's height).

Run: `node --import tsx --test tests/crossings.test.ts tests/floating-floors.test.ts tests/platformer-def.test.ts tests/platformer-editor.test.ts`.

### 1.9 `src/game/engine.ts`: Marble fields
In `interface Marble`, after `loopStuckSince?: number;` add:
```ts
/** Crossing tracks: the Workshop track segment this marble last touched (plan.tracks index, segment) and when. */
track?: { line: number; seg: number; at: number };
/** Crossing tracks: the last rail it touched, its direction of travel there (tx, ty) and when (steering along it). */
rail?: { tx: number; ty: number; at: number };
/** Crossing tracks: the passage it rides in the crossing it is in (set every step; the renderer layers by it). */
passage?: { zone: number; id: number };
```

### 1.10 `src/game/engine/platformer.ts`: the rules
1. Imports: add `ALL_PLY` to the `../lanes` import; add `import type { CrossPassage, CrossZone } from '../platformer/course';`.
   `CONTROL_TUNING`, `steerVelocity`, `meta`, `MARBLE_RADIUS` are already imported.
2. In `applyLaneMask`, change the final mask line to add `| plyMask(game, m)` at the end:
   ```ts
   m.body.collisionFilter.mask = CAT_WALL | CAT_SENSOR | (ghost ? 0 : laneCategory(lane) | CAT_FRAGILE | CAT_DANGER) | loopBit | (onLedgeSide(game, m) ? CAT_ONEWAY : 0) | plyMask(game, m);
   ```
   (Ghost balls keep the ply bits: tracks stay solid to a ghost, just like `CAT_WALL`.)
3. Add this block right after `applyLaneMask`:
   ```ts
   // ---- Crossing tracks (Workshop): a ball rides the track it last touched; where tracks cross, the others are not there
   // for it. Outside crossings every track is solid (all ply bits); inside one, only its own passage's bit.

   /** How close (px, ball centre to track) a passage must be for a ball with no track of its own to be caught by it. */
   const PASS_REACH = 80;

   function segDist(p: Matter.Vector, a: Matter.Vector, b: Matter.Vector): number {
     const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
     const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
     return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
   }

   function passageDistance(game: Game, P: CrossPassage, p: Matter.Vector): number {
     const tracks = game.track.platformer!.plan.tracks!;
     let best = Infinity;
     for (const [li, s0, s1] of P.runs) { const pts = tracks[li].pts; for (let i = s0; i <= s1; i++) best = Math.min(best, segDist(p, pts[i], pts[i + 1])); }
     return best;
   }

   /** The passage of zone `z` this marble rides: its last touched track, else (rolling) the nearest, (in the air) the front one. */
   function choosePassage(game: Game, m: Marble, z: CrossZone): CrossPassage | null {
     const tracks = game.track.platformer!.plan.tracks!;
     const t = m.track;
     if (t && tracks[t.line]) {
       // the passage holding the segment it touched, else the nearest run of that track, else of a track joined to it
       for (const lines of [[t.line], tracks[t.line].joins]) {
         let best: CrossPassage | null = null, bestGap = Infinity;
         for (const P of z.passages) {
           for (const [li, s0, s1] of P.runs) {
             if (!lines.includes(li)) continue;
             const gap = li === t.line ? (t.seg < s0 ? s0 - t.seg : t.seg > s1 ? t.seg - s1 : 0) : 0;
             if (gap < bestGap) { bestGap = gap; best = P; }
           }
         }
         if (best) return best;
       }
     }
     const p = m.body.position;
     const near = z.passages.map((P) => ({ P, d: passageDistance(game, P, p) })).filter((x) => x.d <= PASS_REACH);
     if (!near.length) return null;
     if (m.grounded < 5) return near.reduce((a, b) => (b.d < a.d - 4 || (Math.abs(b.d - a.d) <= 4 && b.P.depth > a.P.depth) ? b : a)).P;
     return near.reduce((a, b) => (b.P.depth > a.P.depth ? b : a)).P;
   }

   /** The ply bits of this marble's mask (and its `passage`, for the renderer). */
   export function plyMask(game: Game, m: Marble): number {
     m.passage = undefined;
     const zones = game.track.platformer?.plan.crossings;
     if (!zones?.length) return ALL_PLY;
     const lane = m.lane ?? LANE_MIDDLE, p = m.body.position, pad = MARBLE_RADIUS;
     for (let zi = 0; zi < zones.length; zi++) {
       const z = zones[zi];
       if (z.lane !== lane || p.x < z.x0 - pad || p.x > z.x1 + pad || p.y < z.y0 - pad || p.y > z.y1 + pad) continue;
       const P = choosePassage(game, m, z);
       if (!P) return ALL_PLY; // nothing of its own and nothing near: every track solid, the first touch decides
       m.passage = { zone: zi, id: P.id };
       const zoneBits = z.passages.reduce((bits, q) => bits | q.bit, 0);
       return (ALL_PLY & ~zoneBits) | P.bit;
     }
     return ALL_PLY;
   }

   /** Called for every marble-floor contact: remember the Workshop track it touched (any other floor forgets it). */
   export function noteTrackContact(game: Game, m: Marble, other: Matter.Body): void {
     const md = meta(other);
     if (!md || (md.kind !== 'floor' && md.kind !== 'ledge')) return;
     if (md.line === undefined || md.seg === undefined) { m.track = undefined; return; }
     m.track = { line: md.line, seg: md.seg, at: game.time };
     if (md.rail) {
       m.rail = { tx: md.tx ?? 1, ty: md.ty ?? 0, at: game.time };
       m.grounded = 0; // on a rail at any angle a ball can steer and jump (off the track's face)
     }
   }

   /** The rail this marble is on right now, if it runs steep or upside down there (else null: ordinary steering). */
   export function onSteepRail(game: Game, m: Marble): { tx: number; ty: number } | null {
     const r = m.rail;
     if (!r || game.time - r.at > 40) return null;
     return r.tx < 0.5 ? r : null;
   }

   /**
    * Steering. On a steep or upside-down rail it pushes along the track (right = forward, the rail's direction of travel;
    * left = back); there is no grip: a ball that runs out of speed falls. Anywhere else it is the usual sideways push.
    */
   export function railSteer(game: Game, m: Marble, v: Matter.Vector, nudge: number, grounded: boolean, s: number): Matter.Vector {
     const r = onSteepRail(game, m);
     if (!r) return { x: steerVelocity(v.x, nudge, grounded, s), y: v.y };
     const along = v.x * r.tx + v.y * r.ty;
     if ((nudge > 0 && along >= CONTROL_TUNING.maxSteerVx) || (nudge < 0 && along <= -CONTROL_TUNING.maxSteerVx)) return v;
     const push = CONTROL_TUNING.steerGround * nudge * s;
     return { x: v.x + r.tx * push, y: v.y + r.ty * push };
   }

   /** A jump. On a steep or upside-down rail it pushes off the track's running face; anywhere else straight up as always. */
   export function railJump(game: Game, m: Marble, v: Matter.Vector): Matter.Vector {
     const r = onSteepRail(game, m);
     if (!r) return { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) };
     return { x: v.x + r.ty * CONTROL_TUNING.jumpSpeed, y: v.y - r.tx * CONTROL_TUNING.jumpSpeed };
   }

   const inBox = (b: { x0: number; y0: number; x1: number; y1: number }, p: Matter.Vector, pad: number) =>
     p.x >= b.x0 - pad && p.x <= b.x1 + pad && p.y >= b.y0 - pad && p.y <= b.y1 + pad;

   /** Is this marble in or near a rail (pad px) of its lane? */
   export function inRailBox(game: Game, m: Marble, pad = 40): boolean {
     const plan = game.track.platformer?.plan;
     const lane = m.lane ?? LANE_MIDDLE, p = m.body.position;
     return !!plan?.tracks?.some((l) => l.rail && l.lane === lane && inBox(l.box, p, pad));
   }

   /** Is this marble in or near a crossing (pad px) of its lane? */
   function inCrossing(game: Game, m: Marble, pad = 40): boolean {
     const plan = game.track.platformer?.plan;
     const lane = m.lane ?? LANE_MIDDLE, p = m.body.position;
     return !!plan?.crossings?.some((z) => z.lane === lane && inBox(z, p, pad));
   }

   /** A rail of this marble's lane up to `reach` px ahead (the computer driver commits: full push, no hop). */
   export function railAhead(game: Game, m: Marble, reach = 420): boolean {
     const plan = game.track.platformer?.plan;
     if (!plan?.tracks?.length) return false;
     const lane = m.lane ?? LANE_MIDDLE, p = m.body.position;
     return plan.tracks.some((l) => l.rail && l.lane === lane && p.x > l.box.x0 - reach && p.x < l.box.x1 + 20 && p.y > l.box.y0 - 200 && p.y < l.box.y1 + 200);
   }
   ```
   If `meta(other)` is typed so that `md.line` etc. do not exist, step 1.7 was missed.
4. `keepAboveFloor`: after the line that returns early for loops (`if (plan.loops?.some(...)) return;`) add:
   ```ts
   // crossing tracks: under an overpass or inside a loop the floor below is not this ball's floor
   if (inCrossing(game, m) || inRailBox(game, m)) return;
   ```
5. `switchLane`: right after `m.lane = to;` add `m.track = undefined; m.rail = undefined;`.
6. `platformRecovery`: right after `m.laneAt = undefined;` add `m.track = undefined; m.rail = undefined;`.
7. `loopRescue`: right after `m.loopPhase = 0;` add `m.track = undefined; m.rail = undefined;`.
8. `updateProgress`: replace its body with:
   ```ts
   const info = game.track.platformer!;
   const next = progressAlong(info.path, m.body.position, m.progress);
   // a loop runs backwards for a while: never lose race position riding one
   m.progress = m.progress !== undefined && inRailBox(game, m, 0) ? Math.max(m.progress, next) : next;
   ```
9. `aiDrive`: replace the first lines
   ```ts
   const loop = loopAhead(game, m);
   const brain = decide(sense(game, m, v.x, grounded));
   const d = loop ? { ...brain, nudge: 1, jump: false, takeDoor: false } : brain;
   if (d.nudge !== 0) v = { x: steerVelocity(v.x, d.nudge, grounded, s), y: v.y };
   ```
   with
   ```ts
   // P2-21 / crossing tracks: with a loop or a rail just ahead the driver commits: full push, no hop, no door.
   const commit = !!loopAhead(game, m) || railAhead(game, m);
   const brain = decide(sense(game, m, v.x, grounded));
   const d = commit ? { ...brain, nudge: 1, jump: false, takeDoor: false } : brain;
   if (d.nudge !== 0) v = railSteer(game, m, v, d.nudge, grounded, s);
   ```
   and in the same function change `const blocked = !loop && ...` to `const blocked = !commit && ...`.
   Keep the AI jump as it is (`v = { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) }`): the AI never jumps
   while committed, so `railJump` is not needed there.

### 1.11 `src/game/engine/input.ts`: steering and jumping on rails
1. Change the import `import { tryDoor } from './platformer';` to `import { railJump, railSteer, tryDoor } from './platformer';`.
2. Replace
   ```ts
   if (hands.nudge !== 0) v = { x: steerVelocity(v.x, hands.nudge, grounded, s), y: v.y };
   ```
   with
   ```ts
   // crossing tracks: on a steep or upside-down Workshop rail, steering pushes along the track
   if (hands.nudge !== 0) v = game.track.platformer ? railSteer(game, m, v, hands.nudge, grounded, s) : { x: steerVelocity(v.x, hands.nudge, grounded, s), y: v.y };
   ```
3. Replace
   ```ts
   if (jump.jump) v = { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) };
   ```
   with
   ```ts
   if (jump.jump) v = game.track.platformer ? railJump(game, m, v) : { x: v.x, y: Math.min(v.y, -CONTROL_TUNING.jumpSpeed) };
   ```
Off rails both helpers return exactly what the old lines computed, so nothing else changes.

### 1.12 `src/game/engine/hits.ts`: remember the track touched
1. Add the import: `import { noteTrackContact } from './platformer';`.
2. In `onCollisionStart`, in the two single-marble branches, add one line each:
   ```ts
   if (ma && !mb) {
     if (game.track.platformer) noteTrackContact(game, ma, b);
     game.contactSurface(ma, b, pair, true);
     ...
   } else if (mb && !ma) {
     if (game.track.platformer) noteTrackContact(game, mb, a);
     ...
   ```
3. In `onCollisionActive`, right after `if (!md) continue;` add:
   ```ts
   if (game.track.platformer) noteTrackContact(game, m, other);
   ```
If importing `./platformer` from `hits.ts` causes a runtime import-order error in the tests, move the three
functions it needs (`noteTrackContact` only) into a small new file `src/game/engine/tracks.ts` and import from there.

### 1.13 `tests/crossing-ride.test.ts` (new): headless rides
Copy the harness from `tests/platformer-routes.test.ts` (the `driver` constant and the `roll` function), but build the
track from a Workshop def:

```ts
// Run with: node --import tsx --test tests/crossing-ride.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { TRACK_THEMES } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { trackFromPlan } from '../src/game/platformer/build';
import { newPlatformerDef, planFromTrackDef } from '../src/game/platformer/def';
import { KIT_HALF_PITCH, KIT_R, loopKit, overpassKit } from '../src/game/platformer/track-kits';
import type { Piece } from '../src/game/trackdef';

const Y = 800, X = 2000;
const driver: MarbleInfo = { id: 0, name: 'Tester', color: '#ff0000', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;

/** A course of just `pieces` (plus the start platform and the run-out every course has, far from X). */
function course(pieces: Piece[]) {
  const def = { ...newPlatformerDef('Ride', 6000), pieces };
  return trackFromPlan(planFromTrackDef(def), 1, TRACK_THEMES.forest);
}

/** Put the player at (x, y) moving at (vx, vy) and step `steps`; no steering. Returns the trace. */
function ride(pieces: Piece[], x: number, y: number, vx: number, vy: number, steps: number, before?: (game: Game) => void) {
  const game = new Game(1, [driver], { track: course(pieces), recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.player;
  m.lane = 1;
  m.cannon = undefined;
  before?.(game);
  Matter.Body.setPosition(m.body, { x, y });
  Matter.Body.setVelocity(m.body, { x: vx, y: vy });
  const trace: { x: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) { game.step(PHYSICS_STEP); trace.push({ x: m.body.position.x, y: m.body.position.y }); }
  game.destroy?.();
  return trace;
}
```
(If `game.start()` does not exist, copy exactly what `roll` in `tests/platformer-routes.test.ts` calls.)

The kits' run-up and run-out are short (500 px) and nothing is under them, so a ball that rolls off their ends falls
into the void. The assertions below look at the trace while the ball is still on the track, not at the last point.

Tests:
1. **A fast ball rides the loop**: `ride(loopKit(X, Y), X - 400, Y - 15, 14, 0, 900)`. Assert the highest point
   `Math.min(...trace.map(p => p.y)) < Y - 2 * KIT_R + 40` (over the top), and that **after** the highest point the
   trace has a point with `x > X + KIT_HALF_PITCH + 150 && Math.abs(y - (Y - 14)) < 8` (out along the run-out, on it).
2. **A slow ball falls back**: `ride(loopKit(X, Y), X - 400, Y - 15, 6, 0, 900)`: no point above `Y - 2 * KIT_R + 40`,
   and after its highest point the trace has a point with `x < X - 150 && Math.abs(y - (Y - 14)) < 8` (it came back
   down the way in, onto the run-up).
3. **Under the overpass**: `overpassKit(X, Y)`. A ball on the flat track at `(X - 450, Y - 15)` with `vx = 8`: every
   trace point with `x` between `X - 300` and `X + 300` has `Math.abs(y - (Y - 14)) < 6` (it never touched the dive).
4. **Down the dive through the flat track**: start at `(X - 380, Y - 200 + (20 * 200) / 400 - 15)` (on the dive, near
   its top) with `vx = 4`: after 600 steps `y > Y + 100` (it went through the flat track at the crossing).
5. **A jump under the overpass lands back on its own track**: like test 3, but at the step when `x` first passes
   `X - 40` set the velocity `y` to `-7` (do it inside the loop: keep a flag). After the jump the ball comes back to
   `Math.abs(y - (Y - 14)) < 6` and never had `y < Y - 14 - 120` (it did not land on the dive).
6. **Front catches a ball from the air**: drop a ball (no velocity, `m.track` unset) at `(X + 60, Y - 20)`. At x =
   X + 60 the dive is at `Y + 30` (below the flat track); both tracks are within `PASS_REACH` (80 px) of the ball, and
   it is in the air (`m.grounded` starts at 99). The dive is the later piece, so it is in front: within the first 120
   steps the ball goes below the flat track (some point has `y > Y + 5`). Then repeat with the pieces in the other
   order (`overpassKit(X, Y).reverse()`): now the flat track is in front, and every point of the first 120 steps has
   `y < Y - 5` (the flat track caught it).
7. **A course without crossings is untouched**: `ride([{ t: 'ramp', a: [900, 800], b: [3000, 900] }], ...)`: after a
   few steps `game.player.passage === undefined` and the marble's mask includes `ALL_PLY`
   (`(m.body.collisionFilter.mask & ALL_PLY) === ALL_PLY`).

If test 1 fails because the ball does not reach the top at 14, first check the run is really on the run-up (y of the
start). If it still fails, change `KIT_R` in `track-kits.ts` to `90` (the Loop piece's proven size). **Do not** change
engine rules to make a test pass.

### 1.14 PR 1 done when
- `tsc` clean.
- These pass: `tests/crossings.test.ts`, `tests/crossing-ride.test.ts`, `tests/platformer.test.ts`,
  `tests/platformer-routes.test.ts`, `tests/platformer-def.test.ts`, `tests/platformer-editor.test.ts`,
  `tests/platformer-track.test.ts`, `tests/platformer-all-pieces.test.ts`, `tests/floating-floors.test.ts`,
  `tests/jump-ramps.test.ts`, `tests/lanes.test.ts`, `tests/engine-checksum.test.ts`, `tests/loop-ride.test.ts`,
  `tests/infinity.test.ts`.
- PR title: "Crossing tracks: curves that turn past upright are rails; where tracks cross a ball keeps to the one it last touched".

---------------------------------------------------------------------------------------------------------------------

## PR 2: drawing (oriented beams, the ball passes behind the front track)

Branch `crossings-2`. Files owned: `src/game/platformer/coaster.ts`, `src/game/platformer/render.ts`.

### 2.1 `coaster.ts`: one beam drawer
1. `stripBeam`: add a last parameter `keepOrder = false` and change the swap line to
   `if (!keepOrder && b.x < a.x) [a, b] = [b, a];`. (A rail's beam must stay in ride order so it lands on its solid side.)
2. Add `BeamPath` to the type import from `./course` (if it is not imported yet).
3. Add these two functions next to `stripBeam`:
   ```ts
   /** Where a beam's dark backing stroke runs at point i: on the solid side of the running line. */
   function beamCentre(beam: BeamPath, i: number): Pt {
     const p = beam.pts[i];
     const off = TRACK_T / 2 - RAIL_UP;
     if (!beam.oriented) return { x: p.x, y: p.y + off };
     const a = beam.pts[Math.max(0, i - 1)], b = beam.pts[Math.min(beam.pts.length - 1, i + 1)];
     const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
     return { x: p.x - ((b.y - a.y) / len) * off, y: p.y + ((b.x - a.x) / len) * off };
   }

   /**
    * One Workshop track's beam, painted whole along its shape, with a dark wood stroke behind it so no seam or gap shows
    * where it bends hard, turns upright or doubles back. A rail's beam lies on its solid side, whichever way it runs.
    */
   export function drawBeamPath(ctx: CanvasRenderingContext2D, beam: BeamPath): void {
     ctx.save();
     ctx.lineJoin = 'round';
     ctx.lineCap = 'round';
     ctx.strokeStyle = '#6a3f1c';
     ctx.lineWidth = TRACK_T * 0.9;
     ctx.beginPath();
     beam.pts.forEach((_, i) => { const q = beamCentre(beam, i); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
     ctx.stroke();
     ctx.restore();
     stripBeam(ctx, middle(ART.wood!), beam.pts, RAIL_UP, TRACK_T, beam.pts[0].x + OX, !!beam.oriented);
   }
   ```
   (For a beam that is not oriented, `beamCentre` gives `p.y - RAIL_UP + TRACK_T / 2`: exactly the old stroke.)
4. In `drawCoasterLane`, in the block `if (statics) for (const beam of plan.beams ?? []) {`, keep the lane check and the
   `lo/hi` in-view check, and replace everything after them (from `ctx.save();` to the `stripBeam(...)` line) with
   `drawBeamPath(ctx, beam);`.

### 2.2 `render.ts`: layering at crossings
1. Imports: add `drawBeamPath` to the import from `./coaster`; import `type { Marble }` if it is not imported.
2. Add this function above `renderPlatformer`:
   ```ts
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
   ```
3. In `renderPlatformer`, right after
   `for (const { m, z } of depths) if (z === lane) drawBall(target, game, m, t);`
   add `drawOverpasses(target, game, lane, left, right, depths, t);`.

### 2.3 Check it by eye
Start the 5180 preview on this worktree (see `docs/HANDOVER-3.md`, "How we work"). In the Workshop, make a new
side-scrolling course, add pieces by hand from the PR 1 kit coordinates (or wait for PR 3's palette), test drive:
the beam of the loop's top is on the outside of the ring, and on the way in the ball passes behind the way out
(which is the later piece). Take a screenshot for the PR description.

### 2.4 PR 2 done when
- `tsc` clean; `tests/crossings.test.ts`, `tests/crossing-ride.test.ts`, `tests/platformer-track.test.ts`,
  `tests/infinity-look.test.ts` pass.
- The screenshot shows the loop beam whole and the ball behind the front track.

---------------------------------------------------------------------------------------------------------------------

## PR 3: the Workshop

Branch `crossings-3`. Files owned:
- `src/components/editor/joins.ts` (**new**), `src/components/editor/order.ts` (**new**)
- `src/components/editor/palette.ts`, `src/components/editor/ghost.ts`
- `src/components/editor/PropertiesPanel.tsx`
- `src/components/editor/EditorCanvas.tsx`, `src/components/editor/build-side.ts`
- `src/components/TrackEditor.tsx`
- `tests/editor-joins.test.ts` (**new**)

### 3.1 `joins.ts` (new): snapping ends, reversing, smoothing
```ts
// Crossing tracks (Workshop): joining track pieces end to end. Dragging a ramp's or curve's end near another track end
// snaps onto it; a curve's bend can be lined up with the track it joins (no kink to bounce off); a track can be reversed
// (a rail is ridden from its start dot to its end dot, solid on the right of travel).
import type { Piece } from '../../game/trackdef';

/** Ends this close (world px) snap together. */
export const JOIN_SNAP = 16;

type Track = Extract<Piece, { t: 'ramp' } | { t: 'curve' }>;
const isTrack = (p: Piece | undefined): p is Track => p?.t === 'ramp' || p?.t === 'curve';
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Snap end `handle` of piece `index` onto the nearest other track end of its lane within JOIN_SNAP (else unchanged). */
export function snapEnd(pieces: readonly Piece[], index: number, handle: 'a' | 'b'): Piece {
  const p = pieces[index];
  if (!isTrack(p)) return p;
  const end = p[handle], lane = p.lane ?? 1;
  let best: { d: number; at: [number, number] } | null = null;
  pieces.forEach((q, j) => {
    if (j === index || !isTrack(q) || (q.lane ?? 1) !== lane) return;
    for (const at of [q.a, q.b]) {
      const d = dist(end, at);
      if (d <= JOIN_SNAP && (!best || d < best.d)) best = { d, at: [at[0], at[1]] };
    }
  });
  return best ? ({ ...p, [handle]: (best as { at: [number, number] }).at } as Piece) : p;
}

/** The same track ridden the other way. */
export function reverseTrack(p: Piece): Piece {
  return isTrack(p) ? ({ ...p, a: p.b, b: p.a } as Piece) : p;
}

/**
 * Line a curve's bend up with the track joined to its start (else to its end): its control point moves onto the line
 * the other track arrives along, keeping its distance, so the two meet without a kink.
 */
export function smoothJoins(pieces: readonly Piece[], index: number): Piece {
  const p = pieces[index];
  if (p?.t !== 'curve') return p;
  const lane = p.lane ?? 1;
  const others = pieces.filter((q, j) => j !== index && isTrack(q) && (q.lane ?? 1) === lane) as Track[];
  const unit = (from: readonly number[], to: readonly number[]) => { const l = dist(from, to) || 1; return [(to[0] - from[0]) / l, (to[1] - from[1]) / l]; };
  const r = (v: number) => Math.round(v);
  const prev = others.find((q) => dist(q.b, p.a) <= 1);
  if (prev) {
    const dir = prev.t === 'ramp' ? unit(prev.a, prev.b) : unit(prev.c, prev.b); // the way it arrives
    const len = dist(p.a, p.c);
    return { ...p, c: [r(p.a[0] + dir[0] * len), r(p.a[1] + dir[1] * len)] };
  }
  const next = others.find((q) => dist(q.a, p.b) <= 1);
  if (next) {
    const dir = next.t === 'ramp' ? unit(next.a, next.b) : unit(next.a, next.c); // the way it leaves
    const len = dist(p.b, p.c);
    return { ...p, c: [r(p.b[0] - dir[0] * len), r(p.b[1] - dir[1] * len)] };
  }
  return p;
}
```

### 3.2 `order.ts` (new): reordering pieces (depth)
```ts
// Piece order is depth: pieces draw in list order (a later one covers the earlier ones), and where tracks cross the
// later one is in front. These helpers reorder a def's pieces and say where every old index went.
import type { Piece } from '../../game/trackdef';

/** Move the pieces at `indices` to the end (in their current order): they come to the front. */
export function toFront(pieces: readonly Piece[], indices: readonly number[]): { pieces: Piece[]; newIndex: Map<number, number> } {
  const moving = new Set(indices);
  const order = [...pieces.keys()].filter((i) => !moving.has(i)).concat([...moving].sort((a, b) => a - b));
  return { pieces: order.map((i) => pieces[i]), newIndex: new Map(order.map((old, i) => [old, i])) };
}

/** Move piece `from` to sit just above (dir 1) or just below (dir -1) piece `past`. */
export function movePast(pieces: readonly Piece[], from: number, past: number, dir: 1 | -1): { pieces: Piece[]; newIndex: Map<number, number> } {
  const order = [...pieces.keys()].filter((i) => i !== from);
  const at = order.indexOf(past);
  order.splice(dir === 1 ? at + 1 : at, 0, from);
  return { pieces: order.map((i) => pieces[i]), newIndex: new Map(order.map((old, i) => [old, i])) };
}
```

### 3.3 `tests/editor-joins.test.ts` (new)
Pure tests:
- `snapEnd`: ramp 0 `[0,0]→[100,0]`, curve 1 `a [110, 6] c [200, 50] b [300, 0]`: `snapEnd(pieces, 1, 'a').a` is `[100, 0]`;
  with `a [130, 0]` (30 px away) it is unchanged; a piece in another lane (`lane: 0`) is never a snap target.
- `reverseTrack` swaps `a` and `b` and keeps `c`.
- `smoothJoins`: ramp `[0,0]→[100,0]` then curve `a [100,0] c [150,-80] b [250,-100]`: the result's `c[1]` is `0`
  (the bend now leaves horizontally) and `c[0] > 100`.
- `toFront([p0,p1,p2,p3], [1])` gives order `p0,p2,p3,p1` and `newIndex.get(1) === 3`.
- `movePast(pieces, 0, 2, 1)` puts p0 right after p2.

### 3.4 Palette and placement (kits)
1. `palette.ts`, in `PLATFORMER_PALETTE`, group `pf-floors`, add after the `curve` tile:
   ```ts
   { id: 'track-loop', t: 'curve', label: 'Track loop', sprite: 'loop-ring', hint: 'A loop built from four curves with a run-up and a run-out. Every piece stays editable: drag the dots to reshape it. A ball needs speed to ride over the top; a slow one falls.' },
   { id: 'track-double-loop', t: 'curve', label: 'Double loop', sprite: 'loop-ring', hint: 'Two track loops one after the other.' },
   { id: 'track-overpass', t: 'ramp', label: 'Overpass', sprite: 'rail-wood', hint: 'Two tracks crossing: each ball keeps to the track it is on. Tap the crossing marker to swap which one passes in front.' },
   ```
2. `ghost.ts`, in `placementPieces`, after the `scaffold` block and before the final `return`, add:
   ```ts
   if (tile.id === 'track-loop' || tile.id === 'track-double-loop' || tile.id === 'track-overpass') {
     // Crossing tracks: a ready-made track shape from ordinary ramps and curves, placed as one group around the pointer.
     const cx = snap ? Math.round(at.x / SNAP) * SNAP : at.x, cy = snap ? Math.round(at.y / SNAP) * SNAP : at.y;
     return tile.id === 'track-loop' ? loopKit(cx, cy) : tile.id === 'track-double-loop' ? doubleLoopKit(cx, cy) : overpassKit(cx, cy);
   }
   ```
   with `import { doubleLoopKit, loopKit, overpassKit } from '../../game/platformer/track-kits';`.
   `TrackEditor.handlePlace` already handles several pieces (it groups them with `regroup` and adds the lane).
   These tiles are only in the side-scrolling palette, so drop-track courses never see them.

### 3.5 Snapping ends while dragging (`TrackEditor.tsx`)
In `applyHandleChange`, change the body of the `transact` callback to:
```ts
const p = initialPiece || def.pieces[pieceIndex];
if (!p) return def;
def.pieces[pieceIndex] = applyHandle(p, handleId, to, grid, resizeAnchor);
// crossing tracks: a track end dragged near another track end snaps onto it (joined pieces ride as one track)
if (isPlatformerDef(def) && (handleId === 'a' || handleId === 'b')) def.pieces[pieceIndex] = snapEnd(def.pieces, pieceIndex, handleId);
return def;
```
Import `snapEnd` from `./editor/joins`.

### 3.6 Properties panel buttons (`PropertiesPanel.tsx`)
1. Add an optional prop to `interface Props`:
   ```ts
   /** Side-scrolling courses: move the selected piece one step in front of / behind the next piece it overlaps. */
   onLayer?: (dir: 1 | -1) => void;
   ```
   and add it to the destructuring: `export default function PropertiesPanel({ selected, pieces, onChange, onLayer }: Props)`.
   The component already has `const index = selected[0];` and `const piece = pieces[index];` (single selection only).
2. In the block `{(piece.t === 'curve' || piece.t === 'ramp') && (` (the "Cliff below" one), add after its
   `prop-hint` div, still inside the fragment:
   ```tsx
   {isSideWorld() && (
     <>
       <div className="prop-field">
         <button type="button" className="button-secondary" onClick={() => onChange(index, reverseTrack(piece))}>Reverse direction</button>
         {piece.t === 'curve' && <button type="button" className="button-secondary" onClick={() => onChange(index, smoothJoins(pieces, index))}>Smooth joins</button>}
       </div>
       <div className="prop-hint">{isRailPiece(piece)
         ? 'This track turns past upright: a ball rides it from its start dot to its end dot, with the solid side on the right of travel. Reverse it if the ball should ride the other face.'
         : 'Drag an end onto another track end to join them. Smooth joins lines the bend up with the track it joins.'}</div>
     </>
   )}
   ```
   Imports: `isSideWorld` from `./world`, `reverseTrack, smoothJoins` from `./joins`, `isRailPiece` from
   `../../game/platformer/crossings`. (The panel has no hooks and early returns; keep it hook-free:
   `tests/hooks-order.test.ts` checks this.)
3. At the end of the single-piece panel (after all the per-type blocks), add:
   ```tsx
   {onLayer && (
     <div className="prop-field">
       <button type="button" className="button-secondary" onClick={() => onLayer(1)}>Forward one</button>
       <button type="button" className="button-secondary" onClick={() => onLayer(-1)}>Back one</button>
     </div>
   )}
   ```

### 3.7 `TrackEditor.tsx` handlers
1. Imports: `toFront, movePast` from `./editor/order`.
2. Add (next to `handleGroup`):
   ```ts
   /** Side-scrolling courses: move the one selected piece in front of (dir 1) or behind (-1) the next piece it overlaps. */
   const handleLayer = useCallback((dir: 1 | -1) => {
     if (selected.length !== 1) return;
     const i = selected[0], bounds = built.pieceBounds, me = bounds[i];
     if (!me) return;
     const overlaps = (k: number) => { const o = bounds[k]; return !!o && o.min.x <= me.max.x && me.min.x <= o.max.x && o.min.y <= me.max.y && me.min.y <= o.max.y; };
     let j = i + dir;
     while (j >= 0 && j < circuit.def.pieces.length && !overlaps(j)) j += dir;
     if (j < 0 || j >= circuit.def.pieces.length) return;
     const { newIndex } = movePast(circuit.def.pieces, i, j, dir);
     commit((def) => ({ ...def, pieces: movePast(def.pieces, i, j, dir).pieces }), { select: [newIndex.get(i)!] });
     setLocked((prev) => new Set([...prev].map((k) => newIndex.get(k) ?? k)));
   }, [selected, built.pieceBounds, circuit.def.pieces, commit]);

   /** Tap on a crossing marker: the next track down at that crossing comes to the front. */
   const handleSwapCrossing = useCallback((zone: number) => {
     const plan = built.track?.platformer?.plan;
     const z = plan?.crossings?.[zone];
     if (!plan?.tracks || !z || z.passages.length < 2) return;
     const next = [...z.passages].sort((a, b) => b.depth - a.depth)[1];
     const sources = [...new Set(next.runs.map(([li]) => plan.tracks![li].source))];
     const { newIndex } = toFront(circuit.def.pieces, sources);
     commit((def) => ({ ...def, pieces: toFront(def.pieces, sources).pieces }), { select: [] });
     setLocked((prev) => new Set([...prev].map((k) => newIndex.get(k) ?? k)));
   }, [built.track, circuit.def.pieces, commit]);
   ```
   Check `commit`'s exact signature where `onReorder` uses it (`commit((def) => (...), { select: [to] })`) and do the same.
3. Pass `onLayer={side ? handleLayer : undefined}` to **both** `<PropertiesPanel ... />` elements.
4. Pass `onSwapCrossing={handleSwapCrossing}` to `<EditorCanvas ... />` (next to `onReorder`).

### 3.8 `EditorCanvas.tsx`: crossing markers, direction arrows, picking through
1. Props: add
   ```ts
   /** Crossing tracks: tap a crossing marker to swap which track passes in front. */
   onSwapCrossing?: (zone: number) => void;
   ```
   and a ref like the others: `const onSwapRef = useRef(props.onSwapCrossing); onSwapRef.current = props.onSwapCrossing;`
   (follow how `onOrderRef` is declared and kept current).
2. A helper inside the main effect, next to `drawSelection`:
   ```ts
   /** Crossing markers (side-scrolling courses): one per crossing in the lane being edited, at the crossing's middle. */
   const crossingMarks = (overlay: OverlayView): { zone: number; x: number; y: number }[] => {
     const plan = gameRef.current?.track.platformer?.plan;
     if (!sideRef.current || !plan?.crossings) return [];
     const cam = overlay.camera, lane = Math.round(focusRef.current);
     return plan.crossings.flatMap((z, zone) => (z.lane !== lane ? [] : [{ zone, x: ((z.x0 + z.x1) / 2 - cam.x) * cam.scale + overlay.width / 2, y: ((z.y0 + z.y1) / 2 - cam.y) * cam.scale + overlay.height / 2 }]));
   };
   const drawCrossings = (ctx: CanvasRenderingContext2D, overlay: OverlayView) => {
     for (const m of crossingMarks(overlay)) {
       ctx.save();
       ctx.fillStyle = '#0b1220';
       ctx.strokeStyle = '#facc15';
       ctx.lineWidth = 2;
       ctx.beginPath();
       ctx.arc(m.x, m.y, 11, 0, Math.PI * 2);
       ctx.fill();
       ctx.stroke();
       ctx.fillStyle = '#facc15';
       ctx.font = 'bold 13px sans-serif';
       ctx.textAlign = 'center';
       ctx.textBaseline = 'middle';
       ctx.fillText('⇅', m.x, m.y + 1);
       ctx.restore();
     }
   };
   ```
   `focusRef` is the ref that holds `props.focus` (search `focusRef`); the overlay needs the camera of the frame being
   drawn, which `overlayView` has.
3. Draw it: in the render `loop`, after `drawSelection(ctx, overlayView);` add `drawCrossings(ctx, overlayView);`.
4. Tap it: find how a click on the order icons works (`pendingOrderClick`: set on pointer down when the pointer is on
   an order icon, fired on pointer up when it is a click). Do the same for markers:
   - declare `let pendingCrossingClick: number | null = null;` next to `pendingOrderClick`;
   - in `pointerDown`, **before** the code that picks a piece, add: if a marker from `crossingMarks(currentOverlay)` is
     within 14 screen px of the pointer, set `pendingCrossingClick = marker.zone` and return (do not start a drag). Build
     the overlay the same way the order-icon hit test does (it needs camera, width, height);
   - in `pointerUp`, read and clear it next to `wasPendingOrderClick`, and add a branch next to the order one:
     `else if (wasPendingCrossingClick !== null && isClick) { onSwapRef.current?.(wasPendingCrossingClick); }`.
5. Direction arrows on a selected rail: in `drawSelection`, inside `for (const idx of sel) {`, at the end of the loop
   body, add:
   ```ts
   // crossing tracks: a rail shows which way it is ridden (chevrons) and its solid side (a short tick)
   const piece = pieces[idx];
   if (sideRef.current && piece && (piece.t === 'curve' || piece.t === 'ramp') && isRailPiece(piece)) {
     const pts = ridePoints(piece)!.pts;
     ctx.save();
     ctx.strokeStyle = '#facc15';
     ctx.lineWidth = 2;
     for (const f of [0.25, 0.5, 0.75]) {
       const k = Math.min(pts.length - 2, Math.floor(f * (pts.length - 1)));
       const a = toScreen(pts[k]), b = toScreen(pts[k + 1]);
       const ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
       ctx.beginPath();
       ctx.moveTo(mx + Math.cos(ang + 2.5) * 9, my + Math.sin(ang + 2.5) * 9);
       ctx.lineTo(mx, my);
       ctx.lineTo(mx + Math.cos(ang - 2.5) * 9, my + Math.sin(ang - 2.5) * 9);
       ctx.stroke();
       if (f === 0.5) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - Math.sin(ang) * 16, my + Math.cos(ang) * 16); ctx.stroke(); ctx.setLineDash([]); }
     }
     ctx.restore();
   }
   ```
   Imports: `isRailPiece, ridePoints` from `../../game/platformer/crossings`. (`(-sin, cos)` of the travel angle is the
   right-hand normal on screen: the solid side.)
6. Picking through overlapping pieces: a click (no drag) on the piece that is already the only one selected selects the
   next piece under the pointer, further back (wrapping to the top).
   - In `build-side.ts` add:
     ```ts
     /** The next piece under a point below `below` (further back), wrapping round to the top; null when there is no other. */
     export function hitSidePieceBelow(point: { x: number; y: number }, pieceBounds: Bounds[], below: number, blocked?: ReadonlySet<number>): number | null {
       const n = pieceBounds.length;
       for (let k = 1; k < n; k++) {
         const i = (below - k + n) % n;
         if (blocked?.has(i)) continue;
         const { min, max } = pieceBounds[i] ?? {};
         if (!min || !max) continue;
         if (point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y) return i;
       }
       return null;
     }
     ```
   - In `EditorCanvas.tsx`, declare `let cycleFrom: number | null = null;`. In `pointerDown`, where `hit` is found and
     `isSelected` computed (search `const isSelected = sel.includes(hit);`), set
     `cycleFrom = sideRef.current && isSelected && sel.length === 1 ? hit : null;` (and `cycleFrom = null` when nothing
     was hit).
   - In `pointerUp`, after the `if (wasPiece) { ... }` block that ends the transaction, add:
     ```ts
     if (wasPiece && isClick && cycleFrom !== null && sideRef.current) {
       const next = hitSidePieceBelow(worldRaw, pbRef.current, cycleFrom, blockedSet());
       if (next !== null) onSelectRef.current([next], false);
     }
     cycleFrom = null;
     ```
     Check that a plain click on a selected piece reaches `pointerUp` with `wasPiece` set (it starts a piece drag on
     pointer down). If it does not, use the variable that marks "pointer went down on a piece" instead.

### 3.9 PR 3 done when
- `tsc` clean; `tests/editor-joins.test.ts`, `tests/platformer-editor.test.ts`, `tests/editor-ui.test.ts`,
  `tests/editor-base.test.ts`, `tests/hooks-order.test.ts` pass.
- By hand on 5180 (desktop and 375 px wide): place a Track loop; test drive it (the ball goes round with a good
  run-up); tap the crossing marker and see the other track come in front; Reverse direction on a curve of the loop
  makes the chevrons flip; drag a curve end near another end and it snaps; click twice on the overlapping pieces at
  the crossing and the selection steps to the piece behind.

---------------------------------------------------------------------------------------------------------------------

## PR 4: validation, suite list, full test run

Branch `crossings-4`. Files owned: `src/game/platformer/def.ts` (`platformerIssues` only), `scripts/check.mjs`,
`tests/crossings.test.ts`, `tests/browser.test.ts`.

### 4.1 Course problems (`platformerIssues` in `def.ts`)
At the end of `platformerIssues`, before `return out;`, add:
```ts
// Crossing tracks
const tp = trackPlanOf(def, lanesOf(def.lanes));
for (const z of tp.crossings) {
  if (z.passages.length > PLY_COUNT) out.push({ message: `More than ${PLY_COUNT} tracks cross near x ${at((z.x0 + z.x1) / 2)}: spread them out.`, x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2 });
}
for (const [i, l] of tp.tracks.entries()) {
  // a rail joined start to start (or end to end) with another track: one of them runs the wrong way
  for (const j of l.joins) {
    if (j <= i) continue;
    const o = tp.tracks[j];
    if (!l.rail && !o.rail) continue;
    const s = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) <= 24;
    const A0 = l.pts[0], A1 = l.pts[l.pts.length - 1], B0 = o.pts[0], B1 = o.pts[o.pts.length - 1];
    if ((s(A0, B0) || s(A1, B1)) && !(s(A1, B0) || s(A0, B1))) out.push({ message: `${def.pieces[l.source].t} #${l.source + 1} and ${def.pieces[o.source].t} #${o.source + 1} meet start to start (or end to end): press Reverse direction on one of them.`, x: A0.x, y: A0.y, piece: l.source });
  }
  // a rail bending tighter than a ball can follow
  if (l.rail) {
    for (let k = 1; k < l.pts.length - 1; k++) {
      const a = l.pts[k - 1], b = l.pts[k], c = l.pts[k + 1];
      const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ca = Math.hypot(a.x - c.x, a.y - c.y);
      const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (area2 > 1e-6 && (ab * bc * ca) / (2 * area2) < 50) { out.push({ message: `${def.pieces[l.source].t} #${l.source + 1} bends too tightly near x ${at(b.x)} for a ball to follow: open the bend.`, x: b.x, y: b.y, piece: l.source }); break; }
    }
  }
}
```
Imports in `def.ts`: `PLY_COUNT` from `../lanes`.
Add tests to `tests/crossings.test.ts`: a loop kit with one middle curve reversed (`reverseTrack` logic inline:
swap its `a` and `b`) reports the "start to start" message; a curve `a [0,0] c [60,-60] b [0,-30]` (a hairpin) reports
"bends too tightly"; `loopKit` alone reports neither.

### 4.2 `scripts/check.mjs`
Add `'tests/crossings.test.ts', 'tests/crossing-ride.test.ts', 'tests/editor-joins.test.ts'` to the test list (next to
the other platformer/editor entries).

### 4.3 Browser regression test (`tests/browser.test.ts`)
Find the existing test that opens the Workshop on a side-scrolling course. Add one that: arms the "Track loop" tile,
clicks the canvas to place it, checks the piece count went up by 6, clicks the crossing marker (its screen position:
read it from the page with the same maths as `crossingMarks`, or click the centre of the placed loop's bottom), and
checks that the piece order changed (e.g. through the My Tracks draft or a `data-` attribute the test already reads).
If the existing tests have no way to read piece order, assert the piece count and that no error was logged.

### 4.4 Full run
`npm run check` (tsc + the node suites) and the browser suite (`node --import tsx --test tests/browser.test.ts`).
Everything must pass. Then merge.

---------------------------------------------------------------------------------------------------------------------

## Behaviour changes to tell the owner about (put them in the last PR description)
- A curve that turns past upright or back on itself is now a rail: ridden start dot → end dot, solid on the right of
  travel, no cliff under it. Before, its upright parts had no physics at all.
- An upright ramp (a wall) now has a body (before: none).
- Two plain floors that cross in an X: a ball on one now passes through the other.
- Springs, crates and gates settle onto the floor nearest to where they stand (was: the highest floor at that x).
  This is the same as before wherever floors do not overlap.

## Not in scope (ask the owner before doing any of it)
- Steering on the existing Loop piece (it still locks steering while on the ring).
- Crossings on drop-track (classic) courses.
- A many-point track piece (instead of joined curves).
