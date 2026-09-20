// CHAMP-05 geometry probes (dev only).
//
// The build contract measures corridors as *free space between collision
// faces*, so this tool walks every ticket centreline, snaps each sample up to
// marble-centre height (surface centrelines sit on the rail face), then marches
// a marble-sized probe sideways until it touches a rail and reports the
// narrowest true passage. Machines (slings, switches, crumbles, pegs…) are
// deliberately ignored: they are obstacles the route plan answers with items
// and timing, not with corridor width.
//
//   node --import tsx scripts/champ-05/check.mjs
import { buildTrackFromDef } from '../../src/game/trackdef.ts';
import { MARBLE_RADIUS } from '../../src/game/types.ts';
import { def, CORRIDORS } from './def.mjs';

const Matter = (await import('matter-js')).default;
const { Bodies, Query } = Matter;

const RAIL_LABELS = new Set(['ramp', 'curve', 'wall', 'block', 'loop', 'bridge', 'seesaw']);

const track = buildTrackFromDef(def);
const rails = track.bodies.filter((b) => !b.isSensor && RAIL_LABELS.has(b.label));

function hits(p, radius) {
  const probe = Bodies.circle(p[0], p[1], radius, { isSensor: true });
  return Query.collides(probe, rails).length > 0;
}

/** Free run from p along dir until a marble-radius probe touches a rail. */
function freeAlong(p, dir, maxD = 400) {
  for (let d = 0; d <= maxD; d += 1) {
    if (hits([p[0] + dir[0] * d, p[1] + dir[1] * d], MARBLE_RADIUS)) return d;
  }
  return maxD;
}

/** Lift a surface-level sample to marble-centre height; null if it is buried. */
function snap(p) {
  if (!hits(p, MARBLE_RADIUS)) return p;
  for (let up = 2; up <= 140; up += 2) {
    if (!hits([p[0], p[1] - up], MARBLE_RADIUS)) return [p[0], p[1] - up];
  }
  return null;
}

function samplePolyline(pts, step = 10) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] });
    }
  }
  return out;
}

let bad = 0;
for (const c of CORRIDORS) {
  const samples = samplePolyline(c.pts).slice(6, -6); // mouths/ends are shared rooms
  let minClear = Infinity, minAt = null, buried = [];
  for (const s of samples) {
    const q = snap(s.p);
    if (!q) { buried.push(s.p.map(Math.round)); continue; }
    const n = [-s.d[1], s.d[0]];
    const clear = freeAlong(q, n) + freeAlong(q, [-n[0], -n[1]]) + 2 * MARBLE_RADIUS;
    if (clear < minClear) { minClear = clear; minAt = q.map(Math.round); }
  }
  const need = c.open ? (c.need ?? 56) : 84;
  const ok = minClear >= need && buried.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'THIN'} ${c.name.padEnd(16)} spec ${String(c.width).padStart(3)}  narrowest ${String(Math.round(minClear)).padStart(3)} @${minAt}${buried.length ? `  buried ${buried.length} e.g. ${JSON.stringify(buried.slice(0, 3))}` : ''}`);
}
console.log(bad ? `${bad} corridor(s) need work` : 'all corridors pass');
