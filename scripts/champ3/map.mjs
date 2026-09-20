/**
 * CHAMP-04 authoring helper — Spa-Francoroll as the Emerald Oxbow.
 *
 * The championship map is hand-authored, not procedurally generated: this module is the
 * source of truth for the geometry (a plain `TrackDef` is written out by `emit.mjs`).
 *
 * World convention: x = 0..900 (0 = the start grid's left edge), y grows DOWN. A `ramp`'s
 * `a -> b` line is the slab's TOP surface, so a marble rolls ~14u above it; rails are built
 * the same way and their slab hangs on the -normal side of their own a->b line, which is why
 * `rail()` reverses the right-hand rail (both then sit outside the corridor).
 *
 * Two corridors must never cross: this is a side-on 2D course, so a "crossover" would be two
 * slabs fighting for the same pixels. Lanes therefore fork from a shared mouth, run nested
 * (one always west/east of the other), and merge again — `floorChain` + `rail` build exactly
 * that. Where two exposed lanes run near each other, keep their centrelines further apart than
 * `w1/2 + w2/2 + 2*T`, and where one passes over another leave at least ~120u of clearance.
 */
import { W, T } from '../../src/game/track.ts';

/** Role of every piece built through `makeBuilder` — floors, rails, machinery. Auditing only. */
export const ROLES = new WeakMap();
/** Which authored lane/chain a piece belongs to — pieces of one lane are meant to touch. */
export const CHAINS = new WeakMap();
let chainId = 0;

function push(pieces, piece, role) {
  pieces.push(piece);
  ROLES.set(piece, role);
  CHAINS.set(piece, chainId);
  return piece;
}

/**
 * A tiny builder that records TrackDef pieces. Every method mirrors the `Builder` call of the
 * same name in `src/game/track.ts` (x/y mean exactly what they mean there).
 */
export function makeBuilder() {
  const pieces = [];
  const api = {
    pieces,
    ramp: (a, b, thickness = T) => push(pieces, { t: 'ramp', a, b, ...(thickness === T ? {} : { thickness }) }, 'floor'),
    ice: (a, b) => push(pieces, { t: 'ice', a, b }, 'ice'),
    wall: (x, y, w, h) => push(pieces, { t: 'wall', x, y, w, h }, 'wall'),
    block: (x, y, w, h) => push(pieces, { t: 'block', x, y, w, h }, 'wall'),
    boost: (x, y, len, thick, dir) => push(pieces, { t: 'boost', x, y, len, thick, dir }, 'machinery'),
    pad: (x, y, w, dir) => push(pieces, { t: 'pad', x, y, w, dir }, 'machinery'),
    peg: (x, y, r = 11) => push(pieces, { t: 'peg', x, y, r }, 'peg'),
    ppeg: (x, y, color, r = 10, item) =>
      push(pieces, { t: 'ppeg', x, y, color, r, ...(item ? { item } : {}) }, 'peg'),
    itembox: (x, y) => push(pieces, { t: 'itembox', x, y }, 'machinery'),
    tunnel: (x, y, exit, edir, ms, speed, two) =>
      push(pieces, { t: 'tunnel', x, y, exit, edir, ms, speed, ...(two ? { two: true } : {}) }, 'machinery'),
    crumble: (x, y, w, h, tough) => push(pieces, { t: 'crumble', x, y, w, h, tough }, 'machinery'),
    trampoline: (x, y, w, tension) => push(pieces, { t: 'trampoline', x, y, w, tension }, 'machinery'),
    bridge: (a, b, planks, slack) => push(pieces, { t: 'bridge', a, b, planks, slack }, 'floor'),
    pool: (a, b, depth, skip) => push(pieces, { t: 'pool', a, b, depth, skip }, 'machinery'),
    conveyor: (a, b, v, dir, flipMs = 0) => push(pieces, { t: 'conveyor', a, b, v, dir, flipMs }, 'machinery'),
    mud: (a, b, drag) => push(pieces, { t: 'mud', a, b, drag }, 'machinery'),
    fan: (a, b, dir, str, pulse, phase) => push(pieces, { t: 'wind', a, b, dir, str, pulse, phase }, 'machinery'),
    geyser: (x, y, h, period, phase) => push(pieces, { t: 'geyser', x, y, h, period, phase }, 'machinery'),
    turntable: (x, y, arms, r, mode, period, phase) =>
      push(pieces, { t: 'turnstile', x, y, arms, r, mode, period, phase }, 'machinery'),
    targets: (x, y, count, reset) => push(pieces, { t: 'targets', x, y, count, reset }, 'machinery'),
  };
  return api;
}

/** Unit vector helpers (screen space: +y is down). */
export const norm = (x, y) => {
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m };
};
/** Left/top normal of a segment: for (0,1) (straight down) this is +x (the west side). */
export const normal = (p, q) => {
  const d = norm(q[0] - p[0], q[1] - p[1]);
  return { x: d.y, y: -d.x };
};
/** Downhill unit direction of the a->b surface (a ramp's own convention). */
export const downhill = (p, q) => {
  const d = norm(q[0] - p[0], q[1] - p[1]);
  return d.y >= 0 ? d : { x: -d.x, y: -d.y };
};

/** Point on a segment at fraction t (0..1). */
export const along = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** Resample a polyline so no segment is longer than `step` — keeps slab corners shallow. */
export function smooth(pts, step = 150) {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}

/**
 * Marble-travel corridor: a chain of `ramp` floors through the vertices. `cuts` marks vertex
 * indices where the floor is deliberately absent (a room or machine deck replaces it).
 */
export function floorChain(b, pts, cuts = [], chain = ++chainId, thick = T) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (cuts.includes(i) || cuts.includes(`i${i}`)) continue;
    chainId = chain;
    b.ramp(pts[i], pts[i + 1], thick);
  }
}

/**
 * Offset polyline parallel to `pts` on `side` (+1 = the east/right of travel, -1 = west/left),
 * sitting `w/2 + T/2` away from the centreline. Vertices are miter-joined so consecutive rail
 * slabs share their endpoint exactly (a lane's boundary is one continuous bar).
 */
export function offsetChain(pts, w, side) {
  const off = (w / 2 + T / 2) * side;
  const d = [];
  for (let i = 0; i < pts.length - 1; i++) d.push(norm(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
  const n = d.map((v) => ({ x: v.y, y: -v.x }));
  const lineAt = (i) => ({ x: pts[i][0] + n[i].x * off, y: pts[i][1] + n[i].y * off, dx: d[i].x, dy: d[i].y });
  const out = [];
  for (let i = 0; i <= pts.length - 1; i++) {
    if (i === 0) {
      const L = lineAt(0);
      out.push([L.x, L.y]);
    } else if (i === pts.length - 1) {
      const L = lineAt(i - 1);
      const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      out.push([L.x + L.dx * len, L.y + L.dy * len]);
    } else {
      const A = lineAt(i - 1), B = lineAt(i);
      const det = A.dx * B.dy - A.dy * B.dx;
      if (Math.abs(det) < 1e-6) out.push([B.x, B.y]);
      else {
        const t = ((B.x - A.x) * B.dy - (B.y - A.y) * B.dx) / det;
        out.push([A.x + A.dx * t, A.y + A.dy * t]);
      }
    }
  }
  return out;
}

/**
 * One exposed corridor boundary: a bar `w/2` from the `p -> q` centreline, `side` +1 = the
 * east/right of travel (thickness T). `kind` 'ice' builds a frictionless bank instead.
 */
export function rail(b, p, q, w, side, kind = 'rail') {
  const [px, py, qx, qy] = side > 0 ? [q[0], q[1], p[0], p[1]] : [p[0], p[1], q[0], q[1]];
  // A ramp's slab hangs on the -normal side of its a->b line, so the west-hand rail runs with
  // the travel and the east-hand rail runs against it: both end up outside the corridor.
  if (kind === 'ice') b.ice([px, py], [qx, qy]);
  else b.ramp([px, py], [qx, qy]);
  ROLES.set(b.pieces[b.pieces.length - 1], kind === 'ice' ? 'ice' : 'rail');
  return b.pieces[b.pieces.length - 1];
}

/** Both boundaries of a corridor segment. */
export function rails(b, p, q, w, sides = [-1, 1], kind = 'rail') {
  if (sides.includes(-1)) rail(b, p, q, w, -1, kind);
  if (sides.includes(1)) rail(b, p, q, w, 1, kind);
}

/**
 * A complete travel lane: floor chain through `pts` plus the requested rails, each rail trimmed
 * to `[t0, t1]` of the whole lane so fork/rejoin mouths stay open. `sides` entries are `-1`
 * (west of travel) / `1` (east of travel); `kind` may be a string or a per-segment array.
 */
/** A rail-only lane: one boundary of a corridor, arc-length trimmed at both lips. */
export function railChain(b, pts, w, side, kind = 'rail', t0 = 0, t1 = 1) {
  return lane(b, pts, w, { floors: false, sides: [side], kind, t0, t1 });
}

export function lane(b, pts, w, opts = {}) {
  const { sides = [-1, 1], t0 = 0, t1 = 1, kind = 'rail', floors = true } = opts;
  const chain = ++chainId;
  if (floors) floorChain(b, pts, [], chain);
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push({ i, len, from: total });
    total += len;
  }
  for (const side of sides) {
    const k = Array.isArray(kind) ? kind : segs.map(() => kind);
    const off = offsetChain(pts, w, side);
    chainId = chain;
    for (const s of segs) {
      const a = Math.max(0, (t0 * total - s.from) / s.len);
      const e = Math.min(1, (t1 * total - s.from) / s.len);
      if (e - a <= 0.03) continue;
      const px = off[s.i][0] + (off[s.i + 1][0] - off[s.i][0]) * a;
      const py = off[s.i][1] + (off[s.i + 1][1] - off[s.i][1]) * a;
      const qx = off[s.i][0] + (off[s.i + 1][0] - off[s.i][0]) * e;
      const qy = off[s.i][1] + (off[s.i + 1][1] - off[s.i][1]) * e;
      rail(b, [px, py], [qx, qy], undefined, side, k[s.i]);
    }
  }
  return total;
}

/** Total length of a polyline. */
export function length(pts) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return total;
}

/**
 * Straight-line point at fraction t along the polyline `pts` (arc-length measured).
 */
export function lerpPath(pts, t) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    segs.push(len);
    total += len;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const k = segs[i] ? d / segs[i] : 0;
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k,
      ];
    }
    d -= segs[i];
  }
  return pts[pts.length - 1];
}

export { W, T };

/** Round the interior vertex `v` of `a -> v -> b` with a tangent arc of radius r. */
export function roundCorner(a, v, b, r) {
  const d1 = norm(v[0] - a[0], v[1] - a[1]);
  const d2 = norm(b[0] - v[0], b[1] - v[1]);
  const cosT = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y));
  const turn = Math.acos(cosT);
  if (turn < 0.05) return [v];
  const back = r / Math.tan(turn / 2);
  const p1 = [v[0] - d1.x * back, v[1] - d1.y * back];
  const p2 = [v[0] + d2.x * back, v[1] + d2.y * back];
  const n1 = { x: d1.y, y: -d1.x };
  const side = Math.sign(n1.x * d2.x + n1.y * d2.y) || 1;
  const c = [p1[0] + n1.x * r * side, p1[1] + n1.y * r * side];
  const a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const a1 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const n = Math.max(3, Math.ceil(Math.abs(da) / (Math.PI / 12)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + (da * i) / n;
    out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return out;
}

/** A travel polyline with interior corners of `min` rad or more rounded at radius `r` (capped
 * so a shallow corner never produces a tangent point beyond the next vertex). */
export function path(pts, r = 60, min = 0.44) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], v = pts[i], c = pts[i + 1];
    const d1 = norm(v[0] - a[0], v[1] - a[1]);
    const d2 = norm(c[0] - v[0], c[1] - v[1]);
    const turn = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
    if (turn < min) {
      out.push(v);
      continue;
    }
    const cap = Math.min(Math.hypot(v[0] - a[0], v[1] - a[1]), Math.hypot(c[0] - v[0], c[1] - v[1])) * 0.45;
    const rr = Math.max(12, Math.min(r, cap * Math.tan(turn / 2)));
    for (const p of roundCorner(a, v, c, rr)) out.push(p);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
