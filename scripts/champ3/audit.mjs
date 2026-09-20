/**
 * Geometry audit for the authored circuit — the layout law, machine-checked.
 *
 *   node --import tsx scripts/champ3/audit.mjs
 *
 * Everything is a slab in a 2D world: a marble is 28 across, a slab is T=26 thick, and the slab
 * hangs on the -normal side of its own a->b line (so a floor supports from below a line, and a
 * rail's bulk sits on the far side of its line from the corridor it bounds).
 *
 * The rules that matter, in that world:
 *   - stacked: two surfaces with a mostly *vertical* offset closer than 56 leave no headroom for a
 *     marble to pass and a slot it can wedge in — an error (unless they meet at a designed joint).
 *   - side by side: two surfaces offset mostly *across* the travel (a fork, a merge, two nested
 *     lanes) simply converge; below 30 they overlap (error), below 56 they are a tight pair (note).
 *   - a rail whose line passes within 30 of another lane's floor has lost its own corridor.
 *   - machinery that no marble can reach or that blocks a machine it is meant to serve is a defect
 *     (a floor plank across a trampoline's bounce column, a plank inside a pool's water box).
 */
import { buildDef } from './def.mjs';
import { ROLES, CHAINS } from './map.mjs';
import { T, W } from '../../src/game/track.ts';
import { validateTrackDef } from '../../src/game/trackdef.ts';

const MARBLE = 28;
const PASS = MARBLE + T + 2;   // 56: enough daylight for a marble to pass a slab
const TOUCH = T + 4;           // 30: slabs this close are one body
const LOOK = 150;              // report anything closer than this

function segOf(p) {
  if (p.t === 'ramp' || p.t === 'ice' || p.t === 'bridge') return [p.a, p.b];
  if (p.t === 'mud' || p.t === 'conveyor' || p.t === 'wind') return [p.a, p.b];
  return null;
}

function segDist(p1, p2, q1, q2) {
  let best = { d: Infinity, a: null, b: null };
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const ta = i / N;
    const ax = p1[0] + (p2[0] - p1[0]) * ta, ay = p1[1] + (p2[1] - p1[1]) * ta;
    for (let j = 0; j <= N; j++) {
      const tb = j / N;
      const bx = q1[0] + (q2[0] - q1[0]) * tb, by = q1[1] + (q2[1] - q1[1]) * tb;
      const d = Math.hypot(ax - bx, ay - by);
      if (d < best.d) best = { d, a: [ax, ay], b: [bx, by], ta, tb };
    }
  }
  return best;
}

const def = buildDef();
const check = validateTrackDef(def);
const errors = [];
const notes = [];
if (!check.ok) errors.push(`validateTrackDef: ${check.errors.join('; ')}`);

const atEnd = (t) => t < 0.1 || t > 0.9;

for (const [i, p] of def.pieces.entries()) {
  const s = segOf(p);
  if (!s) continue;
  const min = Math.min(s[0][0], s[1][0]);
  const max = Math.max(s[0][0], s[1][0]);
  if (max > W || min < 0) errors.push(`piece ${i} (${p.t}) leaves the track: x ${min.toFixed(0)}..${max.toFixed(0)}`);
  else if (max > 874 || min < 26) notes.push(`piece ${i} (${p.t}) rides the outer wall: x ${min.toFixed(0)}..${max.toFixed(0)}`);
}

const segs = def.pieces
  .map((p, i) => ({ p, i, s: segOf(p), role: ROLES.get(p) ?? 'wall', chain: CHAINS.get(p) ?? -1 }))
  .filter((e) => e.s);

// ── Pool water boxes: nothing solid may sit inside the water the marble wades through.
for (const [i, p] of def.pieces.entries()) {
  if (p.t !== 'pool') continue;
  const x1 = Math.min(p.a[0], p.b[0]);
  const x2 = Math.max(p.a[0], p.b[0]);
  const y1 = p.y;
  const y2 = p.y + p.depth;
  for (const e of segs) {
    if (e.chain === (CHAINS.get(p) ?? -2)) continue;
    const xs = [e.s[0][0], e.s[1][0]];
    if (Math.min(...xs) > x2 + 20 || Math.max(...xs) < x1 - 20) continue;
    // sample the seg inside the box's x range and see how deep it goes
    const ys = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const x = e.s[0][0] + (e.s[1][0] - e.s[0][0]) * t;
      const y = e.s[0][1] + (e.s[1][1] - e.s[0][1]) * t;
      if (x >= x1 + 4 && x <= x2 - 4) ys.push(y);
    }
    if (!ys.length) continue;
    const deep = ys.filter((y) => y > y1 + T).length;
    if (deep >= 3) errors.push(`piece ${e.i} (${e.role}) runs ${deep} samples through pool ${i}'s water (y${y1}-${y2})`);
  }
}

// ── Trampolines: a bounce column above the net has to stay clear.
for (const [i, p] of def.pieces.entries()) {
  if (p.t !== 'trampoline') continue;
  for (const e of segs) {
    if (e.chain === (CHAINS.get(p) ?? -2)) continue;
    const lo = p.x - p.w / 2, hi = p.x + p.w / 2;
    const clamped = e.s.map((q) => [Math.max(lo, Math.min(hi, q[0])), q[1]]);
    if (Math.max(e.s[0][0], e.s[1][0]) < lo + 10 || Math.min(e.s[0][0], e.s[1][0]) > hi - 10) continue;
    if (e.s.some((q, k) => k >= 0 && clamped[k][1] > p.y - 160 && clamped[k][1] < p.y - 20)) {
      notes.push(`piece ${e.i} (${e.role}) hangs in trampoline ${i}'s bounce column (x${lo.toFixed(0)}..${hi.toFixed(0)} y${p.y})`);
    }
  }
}

for (let i = 0; i < segs.length; i++) {
  for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B2 = segs[j];
    if (A.chain === B2.chain && A.chain !== -1) continue;
    const r = segDist(A.s[0], A.s[1], B2.s[0], B2.s[1]);
    if (r.d > LOOK) continue;
    const shareEnd = Math.min(
      Math.hypot(A.s[0][0] - B2.s[0][0], A.s[0][1] - B2.s[0][1]),
      Math.hypot(A.s[0][0] - B2.s[1][0], A.s[0][1] - B2.s[1][1]),
      Math.hypot(A.s[1][0] - B2.s[0][0], A.s[1][1] - B2.s[0][1]),
      Math.hypot(A.s[1][0] - B2.s[1][0], A.s[1][1] - B2.s[1][1]),
    ) < 30;
    if (shareEnd) continue;                                  // designed mouth / chain joint
    const tip = atEnd(r.ta) || atEnd(r.tb);
    const bothTip = atEnd(r.ta) && atEnd(r.tb);
    const dy = Math.abs(r.a[1] - r.b[1]);
    const vert = dy / Math.max(r.d, 1e-6);                   // 1 = stacked, 0 = side by side
    const bothFloor = A.role === 'floor' && B2.role === 'floor';
    const bothRail = A.role !== 'floor' && B2.role !== 'floor';
    const tag = `${A.i}(${A.role})/${B2.i}(${B2.role})`;
    const at = `${r.a.map(Math.round)} t=${r.ta.toFixed(2)}/${r.tb.toFixed(2)} d=${r.d.toFixed(0)} dy=${dy.toFixed(0)} vert=${vert.toFixed(2)}`;
    if (bothFloor) {
      if (r.d < TOUCH) errors.push(`floors ${tag} overlap: ${at}`);
      else if (r.d < PASS && vert > 0.55) {
        if (bothTip) notes.push(`floors ${tag} stacked at a shared nose: ${at}`);
        else errors.push(`floors ${tag} stacked with no headroom: ${at}`);
      } else if (r.d < PASS) notes.push(`floors ${tag} converge side by side: ${at}`);
      else if (r.d < 110) notes.push(`floors ${tag} near: ${at}`);
    } else if (bothRail) {
      if (r.d < TOUCH) notes.push(`rails ${tag} doubled up: ${at}`);
    } else {
      // a floor against something solid: the solid's bulk decides whether a marble can be there
      const solid = A.role === 'floor' ? B2 : A;
      const sLine = solid.s;
      const sN = { x: (sLine[1][1] - sLine[0][1]), y: -(sLine[1][0] - sLine[0][0]) };
      const m = Math.hypot(sN.x, sN.y) || 1;
      const which = { x: sN.x / m, y: sN.y / m };
      const floor = A.role === 'floor' ? A : B2;
      const fp = A.role === 'floor' ? r.a : r.b;             // closest point on the floor
      const side = (fp[0] - sLine[0][0]) * which.x + (fp[1] - sLine[0][1]) * which.y;
      const bulk = side < 0;                                  // floor sits on the slab's bulk side
      if (bulk && r.d < TOUCH && !tip) errors.push(`slab ${tag} intrudes into a lane: ${at}`);
      else if (bulk && r.d < PASS && !tip) notes.push(`slab ${tag} tight under a lane: ${at}`);
      else if (!bulk && r.d < MARBLE && !tip) notes.push(`slab ${tag} nearly touches a lane: ${at}`);
    }
  }
}

console.log(`pieces ${def.pieces.length}, floors ${segs.filter((e) => e.role === 'floor').length}, rails ${segs.filter((e) => e.role === 'rail' || e.role === 'ice').length}`);
for (const n of notes) console.log(`  note  ${n}`);
for (const e of errors) console.log(`  ERROR ${e}`);
console.log(errors.length ? `\n${errors.length} error(s)` : '\nlayout law: clean');
process.exit(errors.length ? 1 : 0);
