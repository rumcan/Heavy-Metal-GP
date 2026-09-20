#!/usr/bin/env node
/**
 * CHAMP-02 authoring helper (issue #86): composes `src/game/official-tracks/champ-1.json`
 * — Monte Pipo Harbour Heist — from the ticket's route tables.
 *
 * Route tables give marble-travel centrelines with clear widths; this script offsets them
 * half-width to each side, mitres and rounds the corners and emits plain TrackDef pieces
 * (ramp / curve / ice / wall + the machines and pickups). Build-time tool only: the
 * committed artefact is the plain JSON — there is no runtime routing system.
 *
 * Usage: node tools/champ1-author.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'game', 'official-tracks', 'champ-1.json');

// ---------------------------------------------------------------- vector maths
const V = (x, y) => ({ x, y });
const add = (a, b) => V(a.x + b.x, a.y + b.y);
const sub = (a, b) => V(a.x - b.x, a.y - b.y);
const mul = (a, k) => V(a.x * k, a.y * k);
const len = (a) => Math.hypot(a.x, a.y);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const R = (n) => Math.round(n * 10) / 10;
const rv = (p) => [R(p.x), R(p.y)];

/** Intersection of lines p+t·d and q+s·e (null when parallel). */
function lineHit(p, d, q, e) {
  const den = d.x * e.y - d.y * e.x;
  if (Math.abs(den) < 1e-9) return null;
  const r = sub(q, p);
  return add(p, mul(d, (r.x * e.y - r.y * e.x) / den));
}

/**
 * Offset a polyline by `dist` along each segment's right-hand normal (dy,−dx).
 * Adjacent offsets are mitred at their intersection; the ends keep the plain offset point.
 */
function offsetPolyline(pts, dist) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = norm(sub(pts[i + 1], pts[i]));
    const n = V(d.y, -d.x);
    segs.push({ p: add(pts[i], mul(n, dist)), d });
  }
  const out = [segs[0].p];
  for (let i = 0; i < segs.length - 1; i++) {
    out.push(lineHit(segs[i].p, segs[i].d, segs[i + 1].p, segs[i + 1].d) ?? segs[i + 1].p);
  }
  const last = segs[segs.length - 1];
  out.push(add(pts[pts.length - 1], mul(V(last.d.y, -last.d.x), dist)));
  return out;
}

/** Keep the part of a polyline with y <= yCut (the corridor above a room/chamber mouth). */
function clipTop(poly, yCut) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    if (poly[i].y <= yCut) out.push(poly[i]);
    if (i < poly.length - 1) {
      const a = poly[i], b = poly[i + 1];
      if ((a.y <= yCut) !== (b.y <= yCut)) out.push(lerp(a, b, (yCut - a.y) / (b.y - a.y)));
    }
  }
  return out;
}

// ---------------------------------------------------------------- piece helpers
const pieces = [];
const P = (piece) => { pieces.push(piece); return piece; };
const ramp = (a, b) => P({ t: 'ramp', a: rv(a), b: rv(b) });
const ice = (a, b) => P({ t: 'ice', a: rv(a), b: rv(b) });
const curve = (a, c, b, n = 12) => P({ t: 'curve', a: rv(a), c: rv(c), b: rv(b), n });
const wall = (x, y, w, h) => P({ t: 'wall', x: R(x), y: R(y), w: R(w), h: R(h) });
const wallSeg = (a, b, thick = 26) => {
  if (Math.abs(a.x - b.x) < 2) return wall(a.x, (a.y + b.y) / 2, thick, Math.abs(b.y - a.y));
  return ramp(a, b);
};

/**
 * Emit a boundary polyline: straight runs become ramps (walls when vertical), every
 * interior corner is rounded with a quadratic `curve` of radius r (n=12). Straight runs
 * crossing [iceY0, iceY1] downward are split and the band is emitted as `ice`.
 */
function emitBoundary(poly, { r = 48, iceRange = null } = {}) {
  if (poly.length < 2) return;
  const lines = [];
  let cursor = poly[0];
  for (let i = 1; i < poly.length - 1; i++) {
    const p = poly[i];
    const dIn = norm(sub(p, poly[i - 1]));
    const dOut = norm(sub(poly[i + 1], p));
    const t = Math.min(r, len(sub(p, poly[i - 1])) * 0.45, len(sub(poly[i + 1], p)) * 0.45);
    const e = sub(p, mul(dIn, t));
    const x = add(p, mul(dOut, t));
    if (len(sub(e, cursor)) > 2) lines.push([cursor, e]);
    curve(e, p, x);
    cursor = x;
  }
  if (len(sub(poly[poly.length - 1], cursor)) > 2) lines.push([cursor, poly[poly.length - 1]]);
  for (const [a, b] of lines) {
    let segs = [[a, b]];
    if (iceRange) {
      const split = [];
      for (const [p0, p1] of segs) {
        const cuts = [0, 1];
        for (const yc of iceRange) if ((p0.y - yc) * (p1.y - yc) < 0) cuts.push((yc - p0.y) / (p1.y - p0.y));
        cuts.sort((m, n) => m - n);
        for (let i = 0; i < cuts.length - 1; i++) split.push([lerp(p0, p1, cuts[i]), lerp(p0, p1, cuts[i + 1])]);
      }
      segs = split;
    }
    for (const [p0, p1] of segs) {
      if (len(sub(p0, p1)) < 2) continue;
      if (iceRange && p0.y >= iceRange[0] - 0.5 && p1.y <= iceRange[1] + 0.5 && p1.y > p0.y) ice(p0, p1);
      else wallSeg(p0, p1);
    }
  }
}

// ================================================================ the layout
// Absolute world pixels, y down. Marble r=14; standard rail T=26.

// ---- Start apron / shared read zone: full width at y440, 540 by y560, 300 mouth at y660.
ramp(V(0, 440), V(180, 560));
ramp(V(180, 560), V(315.5, 673)); // ties into the rooftop line's west bank
ramp(V(900, 440), V(720, 560));
ramp(V(720, 560), V(693, 673)); // ties into the warehouse line's outer bank

// ---- A: Rooftops or Cargo --------------------------------------------------
// The fork nose is where the two inner boundaries cross: (451,738).
const NOSE = V(451, 738);

// Rooftop fast line (450,660),(215,820),(130,1010) w=130 — the room below overrides y1000+.
const leftCL = [V(450, 660), V(215, 820), V(130, 1010)];
const leftL = [V(315.5, 673), ...offsetPolyline(leftCL, -65).slice(1)];
const leftR = [NOSE, ...offsetPolyline(leftCL, 65).slice(1)];
emitBoundary(clipTop(leftL, 950), { r: 48 }); // west bank ends inside the room wall
emitBoundary(clipTop(leftR, 1000), { r: 48, iceRange: [846, 1020] }); // east bank = the iced support bank

// Rooftop room x80..350, y1000..1200: shell, drain notch, floor and loft furniture.
wall(80, 1040, 26, 200); // west wall y940..1140 — the bank discharges onto it and drops straight to the floor
// No ceiling west of the notch: the corridor bank undersides seal that side, and the notch
// above the drain sensor is the room's only way out — everything crossing it is captured.
ramp(V(272, 1000), V(350, 1000)); // ceiling east of the notch
wall(310, 947, 164, 26); // lintel (x228..392, y934..960) — roofs the launch zone, the drain notch and the east wall top
wall(350, 1051, 26, 103); // east wall y999..1103 — the corridor rail resumes below it
ramp(V(80, 1053), V(289, 1221)); // room floor = the corridor's supporting bank, extended
ramp(V(260, 1010), V(340, 1050)); // landing rail: landings inside the notch drop into the drain
P({ t: 'tunnel', x: 250, y: 988, exit: [350, 1210], edir: [0.7, 0.7], ms: 600, speed: 7 }); // (spec x285 -> 250, within tuning: puts the capture box over the whole pad so every launch lofts)
P({ t: 'pad', x: 200, y: 1100, w: 110, dir: 1 }); // (spec 170 w90 -> 200 w110: catches the ice-bank drop at x~165 and every floor roller; every launch flies through the drain's capture box)
P({ t: 'boost', x: 180, y: 885, len: 80, thick: 40, dir: [-0.4, 0.92] });

// Corridor resumes below the room and funnels into the merge.
ramp(V(350, 1103), V(371.4, 1119.8));
ramp(V(371.4, 1119.8), V(493.9, 1232.1)); // east bank fin of the merge
ramp(V(407.4, 1152.8), V(365.1, 1195.1)); // west fin of the merge (the inner banks cross at 407.4,1152.8)
ramp(V(289, 1221), V(346.4, 1280)); // west bank spills into the chamber mouth

// Warehouse line (450,660),(700,820),(745,990),(580,1150),(450,1280) w=240:
// outer bank only — the inside of the bend is one open arena around the cargo cut.
const rightCL = [V(450, 660), V(700, 820), V(745, 990), V(580, 1150), V(450, 1280)];
const rightR = [V(693, 673), ...offsetPolyline(rightCL, 120).slice(1)];
emitBoundary(clipTop(rightR, 1280), { r: 55 });
// Fork divider: from the nose to the cut's west-bank tip — its top face feeds the cut mouth.
ramp(V(451, 738), V(662, 780.3));
// Cargo heavy cut (700,820),(585,930),(550,1080),(580,1150) w=110 — a real channel: both banks.
const cutCL = [V(700, 820), V(585, 930), V(550, 1080), V(580, 1150)];
emitBoundary(offsetPolyline(cutCL, -55), { r: 48 });
emitBoundary(offsetPolyline(cutCL, 55), { r: 48 });
P({ t: 'crumble', x: 575, y: 985, w: 130, h: 45, tough: 5 }); // w100->130 (spec width left a 41px squeeze past its own gate); tough 3->5 (engine hp formula made tough 3 break on any first contact — no mass gate)
P({ t: 'ppeg', x: 675, y: 840, color: 'green', r: 10, item: 'anvil' });

// Pre-split supplies and the two apex rewards.
P({ t: 'itembox', x: 270, y: 650 });
P({ t: 'itembox', x: 630, y: 650 });
P({ t: 'ppeg', x: 200, y: 980, color: 'orange', r: 10 });
P({ t: 'ppeg', x: 710, y: 1050, color: 'orange', r: 10 });

// ---- B: Harbour Ferry — open chamber x70..830, y1280..2200 -----------------
wall(70, 1740, 26, 920); // west wall y1280..2200
wall(830, 1760, 26, 1040); // east wall y1240..2280 — raised to roof the pier
ramp(V(80, 1320), V(555, 1500)); // inlet ramp, moving right
ramp(V(828, 1637), V(180, 1860)); // return shelf — reaches the east wall, so a short fall cannot drop behind it
ramp(V(70, 1940), V(730, 2140)); // lower quay ramp
ramp(V(753, 2247.5), V(726, 2253.2)); // entry stub: catches slow rollers off the quay ramp, spills to the shelf
ramp(V(700, 2280), V(640, 2317.5)); // shortcut landing shelf — the ferry drain drops onto it; tip clear of the entry wall corner (spec's 620 wedged marbles under it)
ramp(V(70, 2120), V(240, 2212)); // west collection funnel — the tip drops marbles in free fall onto the chicane's outer bank (a tip at the entry wall wedged them in the downhill-into-face corner)

P({ t: 'bridge', a: [555, 1500], b: [772, 1552], planks: 8, slack: 12 }); // the gangway (b −33px: spec's 805 pinched marbles against the chamber wall; 45px gap lets them drop to the shelf)
P({ t: 'platform', ax: 635, ay: 1400, bx: 730, by: 1320, w: 110, travel: 1200, pause: 500, phase: 0 }); // the hoist ferry (bx −50: the deck needs a 28px disembark gap at the wall)
ramp(V(755, 1345), V(825, 1360)); // pier landing rail — feeds the drain
ramp(V(700, 1240), V(870, 1206)); // pier roof: seals the pier from above and the east margin (to x870; the 4px sliver to the cap below is marble-proof)
P({ t: 'tunnel', x: 800, y: 1315, exit: [700, 2250], edir: [-0.8, 0.6], ms: 1000, speed: 9 });

P({ t: 'ppeg', x: 490, y: 1445, color: 'green', r: 10, item: 'jump' }); // spec had (265,1360) — unreachable: chamber entrants land x360..520 and roll east. Moved into the landing rollout so the ferry line keeps its guaranteed jump.
P({ t: 'itembox', x: 390, y: 1410 });
P({ t: 'ppeg', x: 620, y: 1685, color: 'orange', r: 10 });
P({ t: 'ppeg', x: 290, y: 1980, color: 'orange', r: 10 });

// ---- C: Dockside Ambush ----------------------------------------------------
wall(300, 2265, 26, 130); // pack entry west wall y2200..2330, flush on the chicane bank
wall(600, 2250, 26, 100); // pack entry east wall y2200..2300 — clear of the shelf tip so the V-gap drop is clean
// Left chicane (450,2350),(210,2470),(310,2630),(185,2790),(450,2940) w=170.
const chicCL = [V(450, 2350), V(210, 2470), V(310, 2630), V(185, 2790), V(450, 2940)];
emitBoundary(offsetPolyline(chicCL, -85), { r: 50 });
emitBoundary(offsetPolyline(chicCL, 85), { r: 50 });
// Right crane lane (450,2350),(675,2490),(650,2720),(450,2940) w=220.
const laneCL = [V(450, 2350), V(675, 2490), V(650, 2720), V(450, 2940)];
emitBoundary(offsetPolyline(laneCL, -110), { r: 52 });
// Outer bank with the mace pocket — the full swept arc (to x=797) stays clear.
// East lane edge: a deflector that sheds drifters into the open mace pocket — its floor ramp
// drains back west into the lane, so nothing can wedge against the cap wall.
ramp(V(660, 2350), V(760, 2420));
wall(838, 2510, 72, 220); // pocket + margin cap (x802..874, y2400..2620) — nothing can walk or bounce into the east margin
ramp(V(874, 2384), V(806, 2398)); // cap deflector: anything landing on the cap rolls back into the pocket
ramp(V(815, 2620), V(759.3, 2731.9)); // pocket floor — drains west into the merge throat
P({ t: 'mace', x: 735, y: 2460, arm: 140, arc: 0.55, sweep: 1300, rest: 350, phase: 0, r: 24 });
// Supplies and battle picks.
P({ t: 'ppeg', x: 610, y: 2390, color: 'green', r: 10, item: 'shock' });
P({ t: 'ppeg', x: 500, y: 2290, color: 'green', r: 10, item: 'ghost' });
P({ t: 'itembox', x: 220, y: 2470 });
P({ t: 'itembox', x: 650, y: 2670 });
P({ t: 'ppeg', x: 210, y: 2750, color: 'orange', r: 10 });
// Finish run (450,2940)→(450,3140) w=260 — nothing below y2880 but walls.
wall(320, 3066, 26, 147.3); // y2992.7..3140, flush on the chicane's outer bank
wall(580, 3050, 26, 179.3); // y2960.7..3140, flush on the lane's outer bank

// ================================================================ the def
const def = {
  v: 1,
  name: 'Monte Pipo Street Circuit',
  seed: 41002,
  theme: 'street',
  height: 3440,
  segments: [
    { name: 'Start', y: 0, h: 440 },
    { name: 'Rooftops or Cargo', y: 440, h: 840 },
    { name: 'Harbour Ferry', y: 1280, h: 920 },
    { name: 'Dockside Ambush', y: 2200, h: 940 },
    { name: 'Finish', y: 3140, h: 300 },
  ],
  pieces,
};

writeFileSync(OUT, `${JSON.stringify(def, null, 2)}\n`);
console.log(`champ-1: ${pieces.length} authored pieces → ${OUT}`);
