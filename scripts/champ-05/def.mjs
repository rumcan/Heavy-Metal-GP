// CHAMP-05 — Suzuka Spiral as Worg Windscar (issue #89).
//
// The authoring helper for `src/game/official-tracks/champ-4.json`: the ticket
// describes the circuit as marble-travel centrelines with clear corridor widths,
// and this module turns that description into plain TrackDef pieces (ramps,
// curves, walls and the machines the ticket names). Nothing here ships —
// `write.mjs` emits the flat JSON the game loads, and `check.mjs` re-runs the
// directed route proofs against that JSON.
//
// World frame: x = 0..900, y grows DOWN. Marble radius 14, rail thickness 26.
// `ramp` endpoints are the rail's top (collision) face, so a boundary polyline
// is literally the surface a marble rolls on.
import {
  railPieces, corridorSides, vwall, hwall, trimPoly, trimToY, trimFromY, pointAtY,
  wallBetween, dist, yAtX, r,
} from './lib.mjs';

export const HEIGHT = 3640;
export const FINISH_TOP = 3340; // height - FINISH_H (300)
export const SEED = 41005;
export const NAME = 'Suzuka Spiral';
export const THEME = 'worg';

export const SEGMENTS = [
  { name: 'Start', y: 0, h: 440 },
  { name: 'Bone Fork', y: 440, h: 760 },
  { name: 'Windscar Lift', y: 1200, h: 1060 },
  { name: "Hunter's Slalom", y: 2260, h: 1080 },
  { name: 'Finish', y: 3340, h: 300 },
];

// ────────────────────────────────────────────────────────────── centrelines
// The ticket's route tables. They drive the boundary maths and draw.mjs paints
// them, so a reviewer can see the spec against the rails that were built.
const APPROACH = [[450, 440], [450, 660]];
const LEFT = [[450, 660], [210, 810], [145, 1020], [450, 1200]];
const CENTRE = [[450, 660], [450, 850], [450, 1020], [450, 1200]];
const RIGHT = [[450, 660], [700, 815], [735, 1010], [450, 1200]];
const DETOUR = [[450, 890], [566, 930], [566, 1010], [450, 1090]];

const DECK = [[80, 1250], [570, 1480]];                 // chamber entry deck
const SHELF1 = [[695, 1570], [150, 1790]];              // normal / failed-board catch
const SHELF2 = [[70, 1880], [600, 2078], [655, 2102]];    // lower zigzag shelf + end kicker
// Inner shorter line: its mouth is the hole in SHELF1 (see sector B notes), so
// the first vertex sits on the shelf line where the two ordinary lines fork.
const INNER = [[565, 1622], [450, 1800], [550, 2010]];
const BASIN = [[660, 2100], [450, 2260]];               // chamber exit corridor

const C_ENTRY = [[450, 2260], [450, 2400]];             // broad entry
const C_LEFT = [[450, 2420], [210, 2550], [290, 2730], [180, 2890], [450, 3080]];
const C_RIGHT = [[450, 2420], [655, 2580], [665, 2850], [450, 3080]];
const C_FINISH = [[450, 3080], [450, 3340]];

export const CENTRELINES = [
  { key: 'A', pts: APPROACH, color: '#39d3c3', label: 'approach 550→300', width: 550 },
  { key: 'A', pts: LEFT, color: '#f97316', label: 'LEFT momentum 145', width: 145 },
  { key: 'A', pts: CENTRE, color: '#a78bfa', label: 'CENTRE mass 135', width: 135 },
  { key: 'A', pts: RIGHT, color: '#facc15', label: 'RIGHT bounce 200', width: 200 },
  { key: 'A', pts: DETOUR, color: '#c084fc', label: 'crumble detour 90', open: true, need: 36, width: 88 },
  { key: 'B', pts: DECK, color: '#38bdf8', label: 'entry deck', open: true, width: 150 },
  { key: 'B', pts: SHELF1, color: '#4ade80', label: 'catch shelf', open: true, width: 170 },
  { key: 'B', pts: SHELF2, color: '#4ade80', label: 'lower shelf', open: true, width: 170 },
  { key: 'B', pts: INNER, color: '#f472b6', label: 'inner line 130', width: 130 },
  { key: 'B', pts: BASIN, color: '#e879f9', label: 'exit corridor 200', open: true, width: 200 },
  { key: 'C', pts: C_ENTRY, color: '#39d3c3', label: 'broad entry 330', width: 330 },
  { key: 'C', pts: C_LEFT, color: '#f97316', label: 'LEFT slalom 170', width: 170 },
  { key: 'C', pts: C_RIGHT, color: '#facc15', label: 'RIGHT blade pass 220', width: 220 },
  { key: 'C', pts: C_FINISH, color: '#39d3c3', label: 'finish 280', width: 280 },
];

/** The routes check.mjs probes for true clear passage between collision faces. */
export const CORRIDORS = CENTRELINES.map(({ label, pts, width, open, need }) => ({ name: label, pts, width, open, need }));

const W_LEFT = 145, W_CENTRE = 135, W_RIGHT = 200;

const pieces = [];
const push = (...ps) => { for (const p of ps) if (p) pieces.push(p); };
const rail = (pts, opts) => push(...railPieces(pts, { pull: 90, bendDeg: 20, ...opts }));

/** Where a descending polyline crosses the vertical line x (point, or null). */
function crossX(pts, x) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) {
      const t = (x - a[0]) / (b[0] - a[0]);
      return [x, a[1] + (b[1] - a[1]) * t];
    }
  }
  return null;
}

// ══════════════════════════════════════════════════════════════ A — Bone Fork
const lS = corridorSides(LEFT, W_LEFT);
const cS = corridorSides(CENTRE, W_CENTRE);
const rS = corridorSides(RIGHT, W_RIGHT);

// Decision mouth at y=650: the apron banks land on the two momentum lanes'
// outer boundaries, so all three routes are open the moment the pack drops in.
const MOUTH_Y = 650;
const MOUTH_L = [280, MOUTH_Y];
const MOUTH_R = [624, MOUTH_Y];
// Where the two dividers end: the momentum lanes have folded into the mass lane
// by then, and the shared mouth below them is the ticket's 330px common exit.
const MERGE_L = crossX([lS.right[2], lS.right[3]], cS.left[0][0]);   // ≈ [382.5, 1076]
const MERGE_R = crossX([rS.left[2], rS.left[3]], cS.right[0][0]);    // ≈ [517.5, 1035]
const EXIT_Y = 1200;

// West border: apron bank → momentum lane's roof → hairpin → the common exit.
rail(trimToY([[0, 440], [175, 560], MOUTH_L, lS.left[1], lS.left[2], lS.left[3]], EXIT_Y));
// East border: apron bank → bounce lane's roof → hairpin → the common exit.
rail(trimToY([[900, 440], [725, 560], MOUTH_R, rS.right[1], rS.right[2], rS.right[3]], EXIT_Y));

// The lane floors double as the decision room's floor: each is clipped where it
// meets the mass lane's wall, so the middle opening stays clear below the switch
// plate's tip and a mass build can still commit after contact.
const CENTRE_W = cS.left[0][0];  // 382.5 — mass lane's west face
const CENTRE_E = cS.right[0][0]; // 517.5 — mass lane's east face
const leftFloorY = yAtX(lS.right[0], lS.right[1], CENTRE_W);
const rightFloorY = yAtX(rS.left[0], rS.left[1], CENTRE_E);

// Momentum lane: floor out of the room, hairpin, then the divider to the merge.
rail([[CENTRE_W, leftFloorY], lS.right[1], lS.right[2], MERGE_L]);
// Bounce lane: floor out of the room, then the divider down to its own merge.
rail([[CENTRE_E, rightFloorY], rS.left[1], rS.left[2], MERGE_R]);

// Mass lane walls. The west wall is solid to the merge; the east wall is opened
// twice so the crumble's side detour (the wedge between the two lanes) has a
// mouth above the wall and a discharge below it.
push(vwall(CENTRE_W - 13, leftFloorY, MERGE_L[1]));
push(vwall(CENTRE_E + 13, rightFloorY, 856));
push(vwall(CENTRE_E + 13, 930, 952));

// ── machines and pickups, sector A
push({ t: 'switch', x: 450, y: 790, len: 100, angle: 0.4, side: 0 });
push({ t: 'boost', x: 180, y: 870, len: 85, thick: 42, dir: [-0.3, 0.95] });
push({ t: 'crumble', x: 450, y: 950, w: 112, h: 40, tough: 2 });
push({ t: 'ppeg', x: 450, y: 840, r: 13, color: 'green', item: 'anvil' });
push({ t: 'sling', x: 748, y: 875, size: 85, facing: 65, strength: 3.7 });
push({ t: 'sling', x: 778, y: 1033, size: 85, facing: 130, strength: 3.7 });
push({ t: 'ppeg', x: 725, y: 935, r: 10, color: 'orange' });
push({ t: 'ppeg', x: 660, y: 1090, r: 10, color: 'orange' });
push({ t: 'itembox', x: 275, y: 645 });
push({ t: 'itembox', x: 625, y: 645 });

export const SECTOR_A = { MOUTH_L, MOUTH_R, CENTRE_W, CENTRE_E, leftFloorY, rightFloorY, MERGE_L, MERGE_R, lS, cS, rS };

// ══════════════════════════════════════════════════════════ B — Windscar Lift
// Open chamber x70..850 with the lift shaft tucked against the east wall.
// Ceiling rock closes everything except the sector-A port (x307..630); the cap
// over the shaft is part of the east ceiling run.
push(hwall(1213, 26, 312));
push(hwall(1213, 622, 697));
push(hwall(1215, 684, 874));                 // shaft top cap (ticket: cap at 1215)
push(vwall(48, 1200, 2262, 44));             // chamber west shell, face at x=70
push(vwall(862, 1200, 2250, 24));            // chamber east shell, face at x=850

// Entry deck. The ticket's (80,1250) lies on this line; the head is tied into
// the west shell so nothing slips behind it.
rail([[210, 1309.2], [570, 1480]]);

// The two ordinary lines. SHELF1 is emitted in two runs with a 160px mouth
// between them: that hole IS the inner line's entry (a 130px lane crossing the
// shelf at 32° would need a 240px hole, which would delete the shelf), and it
// sorts by approach speed — a fast roll carries across onto the long shelf, a
// slow one drops into the inner line. Documented deviation from the ticket's
// silent shelf.
push({ t: 'ramp', a: [695, 1570], b: [620, 1600] });          // trunk / failed-board catch
push({ t: 'ramp', a: [500, 1648], b: [150, 1790] });          // long shelf
const iS = corridorSides(INNER, 130);
// Inner floor under the mouth, trimmed at both ends: head opens the mouth,
// tail stops 90px short of the crumble so the outside dodge is a real slot
// down to the lower shelf.
rail(trimPoly(iS.right.slice(0, 2), 55, 130));
push({ t: 'crumble', x: 440, y: 1815, w: 130, h: 42, tough: 3 });
rail(trimPoly(iS.left.slice(1), 0, 117));   // floor under the crumble, ends above shelf2
rail(SHELF2);
rail([[710, 2200], [570, 2250]]);            // discharge ramp, catch under shelf2
rail([[874, 2236], [615, 2282]]);            // shaft-pit drain into the port
rail([[26, 2252], [285, 2278]]);             // west pit drain into the port

// Lift shaft: solid left wall except the boarding aperture (1250..1370) and the
// disembark opening (2140..2240).
push(vwall(697, 1228, 1250));
// Bounce-build marbles that ricochet into the shaft can otherwise bounce on
// the slab forever (10px side gaps): this lip above the top stop kicks any
// rising marble sideways out of the boarding aperture — an ordinary route loss.
push({ t: 'ramp', a: [800, 1235], b: [690, 1255] });
push(vwall(697, 1370, 2140));
push(vwall(697, 2240, 2300));
push({ t: 'platform', ax: 780, ay: 1350, bx: 780, by: 2170, w: 120, travel: 1800, pause: 540, phase: 0 });
// The slab is flat, so riders stand still at the b dwell: the ticket's optional
// unload boost is what puts them off the platform through the disembark
// aperture and onto the discharge ramp.
push({ t: 'boost', x: 735, y: 2150, len: 60, thick: 40, dir: [-1, 0.2] });

// ── pickups, sector B
push({ t: 'ppeg', x: 330, y: 1335, r: 13, color: 'green', item: 'jump' });
push({ t: 'itembox', x: 300, y: 1708 });      // ticket (300,1740) sat inside the shelf body
push({ t: 'ppeg', x: 560, y: 1725, r: 10, color: 'orange' });
push({ t: 'ppeg', x: 295, y: 1950, r: 10, color: 'orange' });

// ═══════════════════════════════════════════════════════ C — Hunter's Slalom
const NOSE_Y = 2560;
const clS = corridorSides(C_LEFT, 170);
const crS = corridorSides(C_RIGHT, 220);

// Broad entry throat off the port, tied into the lanes' outer roofs.
const throatL = crossX([clS.left[0], clS.left[1]], 272);
const throatR = crossX([crS.right[0], crS.right[1]], 628);
push(vwall(272, 2260, throatL[1] + 6));
push(vwall(628, 2260, throatR[1] + 6));

// Lane boundaries, cut off at the merge mouth.
rail(trimToY([throatL, ...trimFromY(clS.left, throatL[1])], 3085));
rail(trimFromY(trimToY(clS.right, 2945), NOSE_Y));
rail(trimToY([throatR, ...trimFromY(crS.right, throatR[1])], 3085));
rail(trimFromY(trimToY(crS.left, 2945), NOSE_Y));
// Fork nose: the two inner boundaries start out crossed (each lane offsets its
// inner rail to the far side of the fork point), so the divider begins at a
// horizontal bar below the crossover instead of at the raw heads.
const NOSE_L = pointAtY(clS.right, NOSE_Y);
const NOSE_R = pointAtY(crS.left, NOSE_Y);
push(wallBetween(NOSE_R, NOSE_L));

// Finish corridor walls tie the lane floors' cut ends down to the finish stub.
const finL = pointAtY(clS.left, 3080);
const finR = pointAtY(crS.right, 3080);
push(vwall(finL[0] - 13, 3080, 3345));
push(vwall(finR[0] + 13, 3080, 3345));

// ── machines and pickups, sector C
push({ t: 'blade', pivot: [710, 2520], len: 140, amp: 0.5, period: 3600, phase: 0, thin: 12 });
push({ t: 'mace', x: 100, y: 2660, arm: 130, arc: 0.45, sweep: 1600, rest: 420, phase: 900, r: 22 });
push({ t: 'ppeg', x: 580, y: 2450, r: 13, color: 'green', item: 'ghost' });
push({ t: 'ppeg', x: 250, y: 2630, r: 13, color: 'green', item: 'shock' });
push({ t: 'itembox', x: 330, y: 2390 });
push({ t: 'itembox', x: 580, y: 2920 });
push({ t: 'ppeg', x: 250, y: 2810, r: 10, color: 'orange' });
push({ t: 'ppeg', x: 630, y: 2760, r: 10, color: 'orange' });

export const SECTOR_BC = { iS, clS, crS, throatL, throatR, finL, finR };

export const def = {
  v: 1,
  name: NAME,
  seed: SEED,
  theme: THEME,
  height: HEIGHT,
  segments: SEGMENTS,
  pieces,
};
