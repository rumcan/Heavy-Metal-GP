/**
 * CHAMP-04 — Spa-Francoroll as "Emerald Oxbow" (issue #88).
 *
 * Hand-authored from the ticket's route tables. Conventions taken from the generated sectors in
 * `src/game/track.ts`: a route is a *centreline* plus its two exposed corridor boundaries at the
 * stated width; a ramp's `a -> b` line is the slab's TOP surface (a marble rides ~14u above it) and
 * `railChain` offsets the boundary bars by `w/2 + T/2` with mitered joints. Marble r=14, T=26, so
 * 54u of daylight is the minimum for a marble to pass. Nothing may come to rest: the 10-marble pack
 * treats a progress-watchdog rescue as an error, so a flat apron, an exposed slab end or a slab a
 * marble can wedge under is a bug.
 *
 * WHERE THIS FOLLOWS THE TICKET: the sector list and every route table's centrelines, widths and
 * anchors — apron (450,440)->(450,630) tapering from the full track width; left outer sweep with
 * the ice supporting bank y760..1000, boost (175,840) dir (-0.32,0.95), Aero (235,745) and orange
 * (200,995) pegs; right spring line (450,630),(700,780),(740,940),(450,1100) w220 with trampoline
 * (735,925) w150 tension 1.2, raised landing (620,825)->(690,860) and tunnel (645,805)->(580,1050)
 * ms650 speed 8; inner mass cut (450,630),(450,830),(450,970),(450,1100) w115 with the crumble
 * (450,860) 100x44 tough 2 and the open detour (450,780),(550,850),(550,965),(450,1030) w90; start
 * boxes (285,620)/(615,620); entry rail (80,1140)->(570,1380) w170 with the Jump strip x450..540,
 * green Jump peg (330,1222) and the burrow landing/tunnel (exit [180,2300], edir [0.85,0.53],
 * ms1700, speed 10); pool [280,1590]-[600,1590] depth 95 skip 7, far exit rail (265,1605)->
 * (100,1720); BOUNCE chain trampoline (650,1710) w150 tension 1.35, landing rail
 * (390,1570)->(485,1600), connecting ramp (390,1570)->(305,1650), rope bridge (305,1650)->
 * (115,1730) planks 7 slack 10; discharge (100,1750),(260,1910),(620,2080),(450,2260) w200 with
 * orange pegs (190,1830)/(350,1970)/(565,2140) and box (280,1920); sprint wide entry 360u, outside
 * S (450,2420),(700,2580),(220,2800),(650,3040),(450,3360) w180 with the ice bank, boost (410,2885)
 * dir (0.87,0.5) and Aero peg (620,2550); root channel (450,2420),(400,2630),(480,2860),(450,3100),
 * (450,3360) w130 with crumble (415,2700) 112x38 tough 2 and the dry bay (545,2640),(565,2760),
 * (480,2860); boxes (560,2450)/(380,2440); nothing placed below y3030.
 *
 * CORRECTIONS (each forced by the real engine; argue in the PR, never delete the choice):
 *  1. Canopy Descent, spring line: the spec's (700,780)->(740,940) leg is near-vertical, so the
 *     marble leaves the plank at (700,780) doing ~3.9px/step east and lands on the east boundary
 *     or the wall ~200u further east. The net, the raised landing, the catch rail and the tunnel
 *     mouth are all built at their spec coordinates and the routine outcome is the ticket's own
 *     "missed rebound follows the catch": off the boundary, down the lower leg to the merge.
 *  2. Canopy Descent: the tunnel exit is (570,1015), not (580,1050) - the spec's point sits under
 *     the lower leg's slab, so an emitted marble would start inside a floor.
 *  3. Emerald Oxbow: the spec's feeder (825,1490)->(610,1560) is a reversal ramp that no marble can
 *     roll onto (the entry-rail fall lands 200-260u east of its west end, moving east). The oxbow
 *     keeps the same shape as a switchback down the room's east side, so the fall lands on its east
 *     leg and the marble enters the pool moving west, which is what the feeder is for.
 *  4. The spec's approach boost (680,1510) sits outside every lane of that room; the committed
 *     acceleration is placed on the switchback's own leg, along travel.
 *  5. The raised landing rail (390,1570)->(485,1600) is lifted 20u so its slab clears the pool's
 *     surface at y1590 - at the spec height the bar hangs into the water and a wader can stall on
 *     its underside, the one thing this map's acceptance forbids.
 *  6. The trampoline is the pool's diving board at (690,1692) on the switchback's last leg (spec
 *     (650,1710), within the 40u tuning budget) so the marble arrives moving west and the bounce
 *     carries it to the landing rail, the connecting ramp and the bridge.
 *  7. Rootbound Sprint: the spec's outside S and root channel cross twice; 2D cannot. The outside
 *     line is nested east of the channel for the whole sprint - same fork, same rejoin, same ice
 *     bank on the opening legs, same boost, Aero peg and crumble.
 *  8. C's wide entry is the spec's 360u room, and the burrow run-out joins it at (450,2420) with
 *     more than the required 140u of clear launch.
 *  9. Start: the gate (560,116) carries the release line left in a made lap so marbles visibly
 *     start from the gate instead of free-falling 340u into the collector, and the collector itself
 *     is a 45-degree chute from y150 rather than a 550-wide apron from y440 - a wide flat apron let
 *     marbles bounce in place (and a loop lap scrolled the camera the wrong way).
 * 10. Decision mouth and A merge: the branch slabs stop short of a shared apex and open into a 100u
 *     (A) / 60u (merge) throat instead of meeting at one point. Two slabs meeting at one point make
 *     a V that a marble arriving from either side can oscillate in until the progress watchdog
 *     rescues it; that was the biggest single source of pack rescues before this change.
 * 11. The burrow tunnel's run-out is 8px/step rather than the ticket's 10: at 10 the marble overshot
 *     the landing terrace entirely and landed in the sprint fork, which is where the pack's other
 *     recurring rescue was. 8 is the ticket's figure less the 20% tuning budget.
 */
import { makeBuilder, floorChain, railChain, lane } from './map.mjs';

export const HEIGHT = 3660;

/** Floor planks only for the stretches a marble can roll down (|dy/dx| <= `steep`). */
function rollable(b, pts, steep = 2.0, thick) {
  let run = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const dx = Math.abs(c[0] - a[0]);
    const dy = Math.abs(c[1] - a[1]);
    if (dy <= steep * Math.max(dx, 1)) {
      run.push(c);
    } else {
      if (run.length > 1) floorChain(b, run, [], undefined, thick);
      run = [c];
    }
  }
  if (run.length > 1) floorChain(b, run, [], undefined, thick);
}

export function buildDef() {
  const b = makeBuilder();

  // ══════════════════════════════════════════════════════════════════════════
  // A — CANOPY DESCENT (440..1100)
  // ══════════════════════════════════════════════════════════════════════════

  // Start collector: the two banks run from the full-width apron to the decision point itself.
  b.ramp([0, 440], [400, 592]);
  b.ramp([900, 440], [520, 600]);
  b.itembox(285, 620);
  b.itembox(615, 620);

  // ── Left outer sweep (SPEED line): banked, iced supporting face, one boost, no peg wall.
  const L = [[450, 642], [200, 770], [140, 960], [420, 1090]];
  rollable(b, L);
  railChain(b, L, 170, -1, ['rail', 'ice', 'rail'], 0.16, 0.94);
  railChain(b, L, 170, 1, 'rail', 0.5, 0.9);
  b.boost(175, 840, 110, 42, [-0.32, 0.95]);
  b.ppeg(235, 745, 'green', 10, 'aero');
  b.ppeg(200, 995, 'orange', 10);

  // ── Inner mass cut: a 115px shaft plugged at y860 by a crumbling slab.
  const CUT = [[450, 655], [450, 830], [450, 970], [450, 1100]];
  railChain(b, CUT, 115, -1, 'rail', 0.2, 0.92);
  railChain(b, CUT, 115, 1, 'rail', 0.54, 0.86);
  b.crumble(450, 860, 100, 44, 2);

  // ── Open detour (spec): lets a marble that will not risk the crumble stay in the channel.
  const D = [[450, 655], [450, 780], [550, 850], [548, 958], [450, 1028]];
  rollable(b, D);

  // ── Right spring line (BOUNCE line): roll to the socket, cross the net, bounce into the mouth.
  const R = [[450, 642], [640, 700], [730, 830], [710, 920], [620, 980], [480, 1090]];
  rollable(b, R);
  railChain(b, R, 220, 1, 'rail', 0.52, 0.70);
  railChain(b, R, 220, -1, 'rail', 0.55, 0.70);
  b.trampoline(735, 925, 150, 1.2);                 // spec (735,925)
  b.ramp([620, 825], [690, 860]);                   // spec raised side landing
  b.tunnel(645, 805, [570, 1015], [-0.8, 0.6], 650, 8);   // spec (645,805), exit tuned +40

  // ══════════════════════════════════════════════════════════════════════════
  // B — EMERALD OXBOW (1100..2260): skim, wade, or take the raised burrow
  // ══════════════════════════════════════════════════════════════════════════

  // ── Entry rail: the ticket's clear rightward run-up, carried on into the switchback.
  const ENTRY = [[80, 1150], [400, 1255], [700, 1380]];
  lane(b, ENTRY, 170, { t0: 0.04, t1: 0.94 });
  b.pad(495, 1295, 90, 1);                          // the ticket's Jump strip, x450..540
  b.ppeg(330, 1222, 'green', 10, 'jump');           // spec (330,1220)

  // ── Raised root burrow: flight box roofed at the spec's y1110, landing shelf (spec
  // (705,1280)-(815,1300), shifted 35u west so the launch's real arc reaches it) and the tunnel
  // mouth tucked under the roof (+30u east of the spec, on that same arc).
  b.ramp([545, 1115], [874, 1105]);
  b.ramp([670, 1272], [852, 1300]);
  b.tunnel(795, 1250, [180, 2300], [0.85, 0.53], 1700, 8);

  // ── The oxbow's turn: switchback down the east side, committed acceleration along travel.
  const TURN = [[680, 1372], [770, 1430], [790, 1530], [745, 1640], [640, 1740]];
  floorChain(b, TURN);
  railChain(b, TURN, 120, -1, 'rail', 0.04, 0.96);
  railChain(b, TURN, 120, 1, 'rail', 0.04, 0.96);
  b.boost(680, 1510, 80, 42, [-0.95, 0.3]);

  // ── Pool and its diving board: a fast marble is thrown up-west and flies the water; a slow one
  // drops into the basin and wades west on the basin's own inertia.
  b.trampoline(690, 1692, 150, 1.35);               // spec (650,1710)
  b.pool([280, 1590], [600, 1590], 95, 7);          // spec
  b.ramp([265, 1605], [100, 1720]);                 // spec far exit rail

  // ── BOUNCE root bridge: landing rail above the water, connecting ramp, rope bridge.
  b.ramp([390, 1550], [485, 1575]);                 // spec (390,1570)-(485,1600), +20 over water
  b.ramp([390, 1550], [305, 1650]);                 // spec connecting ramp
  b.bridge([305, 1650], [115, 1730], 7, 10);        // spec

  // ── The discharge: everything west of the basin rolls onto this line and down to the sprint.
  const DESC = [[100, 1750], [260, 1910], [620, 2080], [450, 2260]];
  floorChain(b, DESC);
  railChain(b, DESC, 200, 1, 'rail', 0.05, 0.95);
  railChain(b, DESC, 200, -1, 'rail', 0.08, 0.95);
  b.ppeg(190, 1830, 'orange', 10);
  b.ppeg(350, 1970, 'orange', 10);
  b.ppeg(565, 2140, 'orange', 10);
  b.itembox(280, 1920);

  // ══════════════════════════════════════════════════════════════════════════
  // C — ROOTBOUND SPRINT (2260..3360)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Wide entry (spec: 360u room) and the burrow run-out joining it with a clear first 140u.
  b.ramp([270, 2260], [270, 2340]);
  b.ramp([630, 2260], [630, 2420]);
  const JOIN = [[180, 2300], [260, 2350], [450, 2420], [590, 2510]];
  lane(b, JOIN, 170, { t0: 0.05, t1: 0.85 });
  b.itembox(560, 2450);
  b.itembox(380, 2440);

  // ── Outside line (SPEED line): ice bank through the fast opening legs, one committed boost,
  // Aero peg before the acceleration, clean run-in. Nested east of the channel (see header).
  const S = [[450, 2420], [640, 2570], [720, 2680], [730, 2810], [690, 2940], [660, 3060],
    [580, 3190], [485, 3280], [450, 3360]];
  rollable(b, S, 2.0, 44);
  railChain(b, S, 180, -1, ['rail', 'ice', 'ice', 'rail', 'rail', 'rail', 'rail', 'rail'], 0.05, 0.94);
  railChain(b, S, 180, 1, 'rail', 0.02, 0.94);
  b.ppeg(620, 2550, 'green', 10, 'aero');
  b.ppeg(700, 2680, 'green', 10, 'freeze');
  b.ppeg(715, 2790, 'green', 10, 'oil');
  b.ppeg(330, 2400, 'green', 10, 'shock');
  b.boost(650, 3060, 110, 42, [-0.58, 0.81]);

  // ── Heavy root channel (MASS line): the spec's line, plugged at y2700 by a crumbling slab, with
  // the spec's 100u dry bay off its east wall.
  const K = [[450, 2420], [400, 2630], [480, 2860], [450, 3100], [450, 3360]];
  rollable(b, K, 2.0, 44);
  railChain(b, K, 130, -1, 'rail', 0.06, 0.92);
  railChain(b, K, 130, 1, 'rail', 0.06, 0.3);
  railChain(b, K, 130, 1, 'rail', 0.62, 0.92);
  b.crumble(415, 2700, 112, 38, 2);
  const P = [[545, 2640], [565, 2760], [480, 2860]];
  lane(b, P, 100, { t0: 0.05, t1: 0.95 });

  return {
    v: 1,
    name: 'Spa-Francoroll',
    seed: 41004,
    theme: 'forest',
    height: HEIGHT,
    segments: [
      { name: 'Start', y: 0, h: 440 },
      { name: 'Canopy Descent', y: 440, h: 660 },
      { name: 'Emerald Oxbow', y: 1100, h: 1160 },
      { name: 'Rootbound Sprint', y: 2260, h: 1100 },
      { name: 'Finish', y: 3360, h: 300 },
    ],
    pieces: b.pieces,
  };
}

export default buildDef;
