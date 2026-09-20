// CHAMP-05 authoring helpers (dev only — nothing in src/ imports this file).
//
// The ticket describes the circuit as marble-travel centrelines with a clear
// corridor width. These helpers turn a centred polyline into the two exposed
// boundary rails the corridor needs, offset half the width either side, with
// rounded inside corners, so the authored JSON is plain `ramp`/`curve`/`wall`
// geometry and the game keeps its existing runtime.
//
// Conventions
//   - world pixels, x = 0..900, y grows DOWN (the game's own frame);
//   - `ramp` endpoints are the TOP surface of the rail (see Builder.ramp), so a
//     boundary polyline is exactly the collision face a marble rolls on;
//   - travelling down a polyline, `left`/`right` name the two sides, which is
//     how a zigzag chute's floor swaps sides leg by leg.
import { T } from '../../src/game/track.ts';

export const THICK = T;
export const MARBLE_R = 14;

export const v = (x, y) => [x, y];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Unit normal on the `side` ('left' | 'right') of the direction a→b. */
export function sideNormal(a, b, side) {
  const d = norm(sub(b, a));
  return side === 'left' ? [-d[1], d[0]] : [d[1], -d[0]];
}

/**
 * Offset every vertex of a polyline by `d` to `side`, joining the offset legs at
 * their mitre point (clamped, so a tight turn cannot spike a rail across the
 * corridor). Legs shorter than an epsilon are dropped.
 */
export function offsetPoly(pts, side, d) {
  const legs = [];
  for (let i = 1; i < pts.length; i++) {
    if (dist(pts[i - 1], pts[i]) < 1e-6) continue;
    legs.push({ a: pts[i - 1], b: pts[i], n: mul(sideNormal(pts[i - 1], pts[i], side), d) });
  }
  if (!legs.length) return [];
  const out = [add(legs[0].a, legs[0].n)];
  for (let i = 1; i < legs.length; i++) {
    const prev = legs[i - 1], next = legs[i];
    const p0 = add(prev.b, prev.n), d0 = norm(sub(prev.b, prev.a));
    const p1 = add(next.a, next.n), d1 = norm(sub(next.b, next.a));
    const cross = d0[0] * d1[1] - d0[1] * d1[0];
    let pt = mul(add(p0, p1), 0.5);
    if (Math.abs(cross) > 1e-4) {
      // intersect p0 + t·d0 with p1 + u·d1
      const t = ((p1[0] - p0[0]) * d1[1] - (p1[1] - p0[1]) * d1[0]) / cross;
      const cand = add(p0, mul(d0, t));
      if (dist(cand, prev.b) < Math.abs(d) * 2.6) pt = cand;
    }
    out.push(pt);
  }
  out.push(add(legs[legs.length - 1].b, legs[legs.length - 1].n));
  return out;
}

/** Point at fraction `t` along leg `i` of a polyline. */
export function atLeg(pts, i, t = 1) {
  return lerp(pts[i], pts[i + 1], t);
}

/** Point on the `side` boundary of leg `i` at fraction `t`, offset `d`. */
export function sideAt(pts, i, side, d, t = 1) {
  const p = atLeg(pts, i, t);
  return add(p, mul(sideNormal(pts[i], pts[i + 1], side), d));
}

/**
 * Both boundary polylines of a corridor: `{ left, right }`. `left`/`right` are
 * as seen travelling down.
 *
 * A `ramp` body always hangs T/2 to one side of the face its endpoints name —
 * into the rock for the boundary a marble rolls on, into the corridor for the
 * boundary over its head. Offsetting both sides by a quarter of the rail
 * thickness splits that 13px between them, so the clear space between the two
 * collision faces comes out at exactly the width the ticket asks for, whichever
 * way a leg happens to slope.
 */
export function corridorSides(pts, width) {
  const half = width / 2 + THICK / 4;
  return { left: offsetPoly(pts, 'left', half), right: offsetPoly(pts, 'right', half) };
}

/**
 * Trim the ends of a polyline: `from`/`to` are distances measured along it (a
 * negative `to` counts back from the end). Used where one corridor's rail must
 * stop at another's mouth instead of crossing it.
 */
export function trimPoly(pts, from = 0, to = Infinity) {
  const total = pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
  const end = to < 0 ? total + to : Math.min(to, total);
  const out = [];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = dist(a, b);
    const s0 = acc, s1 = acc + seg;
    if (s1 <= from) { acc = s1; continue; }
    if (s0 >= end) break;
    if (s0 < from) out.push(lerp(a, b, (from - s0) / seg));
    else if (!out.length) out.push(a);
    if (s1 > end) { out.push(lerp(a, b, (end - s0) / seg)); break; }
    out.push(b);
    acc = s1;
  }
  return out.length > 1 ? out : pts.slice();
}

/**
 * Emit pieces along a polyline: straight `ramp`s, with a `curve` (quadratic,
 * `n` chords) rounding every corner that turns more than `bendDeg`. `pull` is
 * the tangent pullback of the rounding, so the inscribed corner radius is
 * roughly pull/2 — 90 gives the contract's 45px minimum.
 */
export function railPieces(pts, { bendDeg = 22, pull = 90, n = 12, kind = 'ramp', round = true } = {}) {
  const out = [];
  const ramp = (a, b) => { if (dist(a, b) > 1) out.push(kind === 'wall' ? wallBetween(a, b) : { t: 'ramp', a: [r(a[0]), r(a[1])], b: [r(b[0]), r(b[1])] }); };
  const curve = (a, c, b) => out.push({ t: 'curve', a: [r(a[0]), r(a[1])], c: [r(c[0]), r(c[1])], b: [r(b[0]), r(b[1])], n });
  if (pts.length < 2) return out;
  let cursor = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const target = pts[i];
    const next = pts[i + 1];
    if (!next || !round) { ramp(cursor, target); cursor = target; continue; }
    const dIn = norm(sub(target, cursor));
    const dOut = norm(sub(next, target));
    const turn = Math.abs(Math.atan2(dIn[0] * dOut[1] - dIn[1] * dOut[0], dIn[0] * dOut[0] + dIn[1] * dOut[1])) * 180 / Math.PI;
    const legIn = dist(cursor, target), legOut = dist(target, next);
    if (turn < bendDeg || legIn < pull + 8 || legOut < pull + 8) { ramp(cursor, target); cursor = target; continue; }
    const a = sub(target, mul(dIn, Math.min(pull, legIn - 8)));
    const b = add(target, mul(dOut, Math.min(pull, legOut - 8)));
    ramp(cursor, a);
    curve(a, target, b);
    cursor = b;
  }
  return out;
}

/** An axis-aligned `wall` piece covering a→b at the standard rail thickness. */
export function wallBetween(a, b, thick = THICK) {
  const horizontal = Math.abs(b[1] - a[1]) <= Math.abs(b[0] - a[0]);
  const w = horizontal ? Math.abs(b[0] - a[0]) + 4 : thick;
  const h = horizontal ? thick : Math.abs(b[1] - a[1]) + 4;
  return { t: 'wall', x: r((a[0] + b[0]) / 2), y: r((a[1] + b[1]) / 2), w: r(w), h: r(h) };
}

/** Vertical wall spanning y0..y1 centred on x. */
export function vwall(x, y0, y1, thick = THICK) {
  return { t: 'wall', x: r(x), y: r((y0 + y1) / 2), w: r(thick), h: r(Math.abs(y1 - y0)) };
}

/** Horizontal wall spanning x0..x1 centred on y. */
export function hwall(y, x0, x1, thick = THICK) {
  return { t: 'wall', x: r((x0 + x1) / 2), y: r(y), w: r(Math.abs(x1 - x0)), h: r(thick) };
}

export function r(x) { return Math.round(x * 100) / 100; }

/** Total length of a polyline. */
export function polyLen(pts) {
  return pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
}

/** Distance along a (descending) polyline to where it crosses `y`. */
export function distAtY(pts, y) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const seg = dist(a, b);
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) return acc + seg * (y - a[1]) / (b[1] - a[1]);
    acc += seg;
  }
  return acc;
}

/** Cut a descending polyline off where it reaches `y`. */
export function trimToY(pts, y) { return trimPoly(pts, 0, distAtY(pts, y)); }

/** Cut the head off a descending polyline from where it reaches `y`. */
export function trimFromY(pts, y) { return trimPoly(pts, distAtY(pts, y)); }

/** The point where a descending polyline crosses `y` (or its nearest end). */
export function pointAtY(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) return lerp(a, b, (y - a[1]) / (b[1] - a[1]));
  }
  return pts[y < pts[0][1] ? 0 : pts.length - 1];
}

/** y on the segment a→b at x, or null when x is outside it. */
export function yAtX(a, b, x) {
  if (Math.abs(b[0] - a[0]) < 1e-9) return null;
  const t = (x - a[0]) / (b[0] - a[0]);
  return t < -1e-9 || t > 1 + 1e-9 ? null : a[1] + (b[1] - a[1]) * t;
}

/** x on the segment a→b at y, or null when y is outside it. */
export function xAtY(a, b, y) {
  if (Math.abs(b[1] - a[1]) < 1e-9) return null;
  const t = (y - a[1]) / (b[1] - a[1]);
  return t < -1e-9 || t > 1 + 1e-9 ? null : a[0] + (b[0] - a[0]) * t;
}

/** Angle in degrees of a→b in screen space (0 = +x, 90 = straight down). */
export function bearing(a, b) { return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI; }
