import type { Builder, SegmentInfo } from './track';
import type { ItemType, TrackProfile } from './types';
import { planCourse as planExperimentalCourse } from './course-plan-experimental';
import type { CourseChapter, SignatureLayout } from './course-plan-experimental';

// A runtime import from track would introduce a circular ESM initialization dependency.
const W = 900;

const NAMES: Record<SignatureLayout, string> = {
  fairground: 'Fairground Bounce',
  watermill: 'Watermill Shortcut',
  funhouse: 'Funhouse Pinball',
  tunnelrun: 'Tunnel Run',
  cannonalley: 'Cannon Alley',
  bladestreet: 'Blade Street',
  pegboard: 'Peg Board Drop',
  targetrange: 'Target Range',
  turnstiles: 'Turnstile Maze',
  icecascade: 'Ice Cascade',
  looprun: 'Loop Run',
  rapids: 'Rapids & Mud',
  macealley: 'Mace Alley',
  magnetcave: 'Magnet Cave',
  boulderrun: 'Boulder Run',
};

/** Green peg supply that unlocks the correct tool for each signature mechanic. */
export const SUPPLY: Record<SignatureLayout, ItemType> = {
  fairground: 'jump',
  watermill: 'jump',
  funhouse: 'aero',
  tunnelrun: 'ghost',
  cannonalley: 'jump',
  bladestreet: 'ghost',
  pegboard: 'rocket',
  targetrange: 'rocket',
  turnstiles: 'ghost',
  icecascade: 'aero',
  looprun: 'rocket',
  rapids: 'aero',
  macealley: 'ghost',
  magnetcave: 'anvil',
  boulderrun: 'aero',
};

/** Upper-road Y on a slope from (0,u1) → (tip,u2). */
function uy(u1: number, u2: number, tip: number, x: number): number {
  return u1 + (x / tip) * (u2 - u1);
}

/** Return-road Y on a slope from (W,r1) → (end,r2). */
function ry(r1: number, r2: number, end: number, x: number): number {
  return r1 + ((W - x) * (r2 - r1)) / (W - end);
}

/**
 * Handcraft one signature chapter.
 * Every layout draws its own roads with b.ramp — no generic frame, no random overlays.
 * Obstacles sit on proportional slope anchors so they never float or trap.
 */
export function buildChapter(b: Builder, chapter: CourseChapter, y: number): number {
  const v = chapter.variant;
  const tip = 730 + v * 20;
  const end = 130 + v * 15;
  const layout = chapter.layout;

  // Shared return-road anchors used by most layouts (overridden where needed).
  let r1 = y + 420;
  let r2 = y + 660;
  let height = 820;

  switch (layout) {
    /* ------------------------------------------------------------------ */
    /* fairground: gap → trampoline → ropeBridge landing                  */
    /* ------------------------------------------------------------------ */
    case 'fairground': {
      // Upper road ends abruptly — intentional gap requiring the trampoline.
      const u1 = y + 50;
      const u2 = y + 170;
      const gapStart = 340;
      b.ramp(-100, u1, gapStart, u2);
      b.ppeg(220, uy(u1, u2, gapStart, 220) - 32, 'green', 10, SUPPLY.fairground);
      b.ppeg(300, uy(u1, u2, gapStart, 300) - 28, 'orange', 10);

      // Trampoline sits in the gap, slightly below the broken lip.
      const trampX = 470;
      const trampY = u2 + 110 + v * 8;
      b.trampoline(trampX, trampY, 180, 1.15 + v * 0.08);
      // Soft eject so a dead marble rolls off instead of camping the net.
      b.boost(trampX, trampY - 18, 150, 24, 1, 0);

      // Rope bridge catches the bounce and carries to the outer tip.
      const bridgeA = 560;
      const bridgeB = tip - 20;
      const bridgeY1 = u1 - 10;
      const bridgeY2 = u1 + 40;
      b.ropeBridge(bridgeA, bridgeY1, bridgeB, bridgeY2, 8, 28);
      b.ramp(bridgeB - 10, bridgeY2 + 6, tip, u2 + 40);

      r1 = y + 430;
      r2 = y + 670;
      height = 840;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* watermill: slow lower route + upper screwLift shortcut             */
    /* ------------------------------------------------------------------ */
    case 'watermill': {
      const u1 = y + 55;
      const u2 = y + 230;
      // Main road drops into the slow lower route.
      b.ramp(-100, u1, 360, y + 150);
      b.ramp(360, y + 150, tip, u2);
      b.ppeg(240, uy(u1, y + 150, 360, 240) - 30, 'green', 10, SUPPLY.watermill);
      b.ppeg(520, uy(u1, u2, tip, 520) - 30, 'orange', 10);

      // Upper screw lift: jump onto the entry shelf, ride the shortcut.
      const screwBottom = y + 175;
      const screwTop = y + 40;
      b.ramp(300, uy(u1, u2, tip, 300) - 8, 380, screwBottom - 10);
      b.screwLift(400, screwBottom, 400, screwTop, 2200 + v * 200, 2);
      // Exit shelf dumps onto the far upper road past the slow section.
      b.ramp(420, screwTop + 8, 560, y + 90);
      b.ramp(560, y + 90, tip - 40, y + 130);
      b.boost(430, screwTop - 6, 90, 30, 1, 0.15);

      r1 = y + 440;
      r2 = y + 680;
      height = 860;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* funhouse: narrow pinball roads with flippers + slings              */
    /* ------------------------------------------------------------------ */
    case 'funhouse': {
      const u1 = y + 45;
      const u2 = y + 240;
      // Narrow upper corridor.
      b.ramp(-100, u1, 280, y + 120);
      b.ramp(320, y + 135, 520, y + 185);
      b.ramp(560, y + 200, tip, u2);
      b.ppeg(200, uy(u1, y + 120, 280, 200) - 30, 'green', 10, SUPPLY.funhouse);

      // Flippers lining the gaps — purposeful bounces across open air.
      b.flipper(300, y + 145, 0, 0.55, 85, 2, 0, v * 400);
      b.flipper(540, y + 195, 1, 0.55, 85, 2, 0, v * 500);
      // Sling kickers on the corridor walls (integer strength 1–9).
      b.sling(250, y + 95, 48, 200, 2);
      b.sling(450, y + 160, 48, 20, 2);
      b.sling(650, y + 210, 48, 200, 2);
      b.ppeg(400, y + 155, 'orange', 10);
      b.ppeg(600, y + 195, 'orange', 10);

      r1 = y + 430;
      r2 = y + 670;
      height = 840;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* tunnelrun: barricade on main road; ghost phases; others fall       */
    /*            onto a dangerous crumble floor                          */
    /* ------------------------------------------------------------------ */
    case 'tunnelrun': {
      const u1 = y + 50;
      const u2 = y + 200;
      b.ramp(-100, u1, 360, y + 140);
      // Barricade blocks the main road — ghost peg grants phase-through.
      b.barricade(430, y + 155, 150, 28, 3 + v);
      b.boost(430, y + 132, 130, 24, 1, 0);
      b.ramp(510, y + 160, tip, u2);
      b.ppeg(250, uy(u1, y + 140, 360, 250) - 30, 'green', 10, SUPPLY.tunnelrun);
      b.ppeg(580, uy(u1, u2, tip, 580) - 28, 'orange', 10);

      // Crumble floor under the barricade for non-ghost runners.
      b.crumble(430, y + 280, 160, 40, 2 + v);
      b.ramp(340, y + 310, 540, y + 340);

      r1 = y + 450;
      r2 = y + 690;
      height = 870;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* cannonalley: massive gap crossed only via cannon → catapult catch  */
    /* ------------------------------------------------------------------ */
    case 'cannonalley': {
      const u1 = y + 55;
      // Short approach, then a huge void.
      b.ramp(-100, u1, 280, y + 130);
      b.ppeg(200, uy(u1, y + 130, 280, 200) - 30, 'green', 10, SUPPLY.cannonalley);

      // Fall into the cannon well.
      b.ramp(200, y + 200, 340, y + 280);
      b.cannon(360, y + 300, 210, 320, 10, 650, v * 300);

      // Far-side catching catapult and landing shelf.
      b.catapult(640, y + 160, 150, 850, 0);
      b.ramp(700, y + 100, tip, y + 150);
      b.ppeg(720, y + 120, 'orange', 10);

      // Safety net under the flight path.
      b.ramp(400, y + 380, 620, y + 400);

      r1 = y + 460;
      r2 = y + 700;
      height = 880;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* bladestreet: low blade pendulum + sliding saw — timing required    */
    /* ------------------------------------------------------------------ */
    case 'bladestreet': {
      const u1 = y + 50;
      const u2 = y + 240;
      b.ramp(-100, u1, tip, u2);
      b.ppeg(230, uy(u1, u2, tip, 230) - 30, 'green', 10, SUPPLY.bladestreet);

      // Low-hanging blade over the mid-slope.
      const bladeX = 420;
      const bladePivotY = uy(u1, u2, tip, bladeX) - 150;
      b.blade(bladeX, bladePivotY, 150, 0.85, 2400 + v * 200, v * 400, 8);

      // Sliding saw further down the road.
      const sawX1 = 560;
      const sawY = uy(u1, u2, tip, sawX1) - 18;
      b.saw(sawX1, sawY, 24, [sawX1 + 140, sawY + 30], 3200, 0.5, v * 500);
      b.ppeg(500, uy(u1, u2, tip, 500) - 28, 'orange', 10);
      b.boostOnRamp(0, u1, tip, u2, 0.5, 70);

      r1 = y + 430;
      r2 = y + 670;
      height = 840;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* pegboard: road drops away into scatterPegs → moving bucket         */
    /* ------------------------------------------------------------------ */
    case 'pegboard': {
      const u1 = y + 50;
      // Short lip then free fall into the peg field.
      b.ramp(-100, u1, 300, y + 130);
      b.ppeg(220, uy(u1, y + 130, 300, 220) - 30, 'green', 10, SUPPLY.pegboard);
      b.boostOnRamp(0, u1, 300, y + 130, 0.6, 90);

      // Massive vertical peg scatter.
      b.scatterPegs(y + 160, 420);

      // Far recovery shelf + moving bucket catch.
      b.ramp(540, y + 520, tip, y + 560);
      b.bucket(y + 500, v * 800);

      r1 = y + 580;
      r2 = y + 780;
      height = 960;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* targetrange: wall of targets — rocket blasts through               */
    /* ------------------------------------------------------------------ */
    case 'targetrange': {
      const u1 = y + 50;
      const u2 = y + 210;
      b.ramp(-100, u1, 380, y + 145);
      b.ppeg(240, uy(u1, y + 145, 380, 240) - 30, 'green', 10, SUPPLY.targetrange);
      b.boostOnRamp(0, u1, 380, y + 145, 0.58, 85);

      // Target bank blocks the road.
      b.targets(470, y + 155, 4 + (v % 2), 5500);
      b.ramp(560, y + 165, tip, u2);
      b.ppeg(640, uy(u1, u2, tip, 640) - 28, 'orange', 10);

      // Bypass under the targets for slow runners.
      b.ramp(380, y + 260, 560, y + 300);

      r1 = y + 430;
      r2 = y + 670;
      height = 840;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* turnstiles: maze of spinning turnstile arms                        */
    /* ------------------------------------------------------------------ */
    case 'turnstiles': {
      const u1 = y + 50;
      const u2 = y + 250;
      b.ramp(-100, u1, 300, y + 120);
      b.ramp(340, y + 140, 560, y + 190);
      b.ramp(600, y + 210, tip, u2);
      b.ppeg(220, uy(u1, y + 120, 300, 220) - 30, 'green', 10, SUPPLY.turnstiles);

      // Free-spinning turnstiles in the corridor gaps.
      b.turnstile(320, y + 130, 4, 65, 1, 5200, v * 300);
      b.turnstile(480, y + 170, 3, 60, 1, 4800, v * 600);
      b.turnstile(620, y + 215, 4, 70, 1, 5600, v * 200);
      b.ppeg(400, y + 150, 'orange', 10);
      b.ppeg(540, y + 185, 'orange', 10);

      r1 = y + 440;
      r2 = y + 680;
      height = 860;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* icecascade: frozen upper road → massive drop → wind updraft        */
    /* ------------------------------------------------------------------ */
    case 'icecascade': {
      const u1 = y + 45;
      const u2 = y + 200;
      // Completely frozen upper road.
      b.ice(0, u1, tip, u2);
      b.ppeg(250, uy(u1, u2, tip, 250) - 30, 'green', 10, SUPPLY.icecascade);
      b.ppeg(500, uy(u1, u2, tip, 500) - 28, 'orange', 10);

      // Massive drop after the ice tip.
      // Powerful updraft cushions the fall.
      b.wind(tip - 80, u2 + 20, tip + 40, u2 + 280, 270, 0.55, 0, 0);
      b.ramp(tip - 120, y + 380, tip - 20, y + 420);

      r1 = y + 480;
      r2 = y + 720;
      height = 900;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* looprun: high-speed approach into a loop; geyser rescues fails     */
    /* ------------------------------------------------------------------ */
    case 'looprun': {
      const u1 = y + 50;
      const u2 = y + 180;
      b.ramp(-100, u1, 420, u2);
      b.boostOnRamp(0, u1, 420, u2, 0.72, 110);
      b.ppeg(230, uy(u1, u2, 420, 230) - 30, 'green', 10, SUPPLY.looprun);

      // Loop sits at the end of the speed run.
      const loopCx = 560;
      const loopR = 95 + v * 5;
      const loopBottom = u2 + loopR + 10;
      b.loop(loopCx, loopBottom, loopR);
      b.ramp(loopCx + loopR - 10, loopBottom - 8, tip, loopBottom + 30);

      // Geyser on the lower road rescues failed loop attempts.
      b.geyser(480, y + 480, 280, 4000, v * 700);
      b.ppeg(600, loopBottom - 20, 'orange', 10);

      r1 = y + 500;
      r2 = y + 740;
      height = 920;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* rapids: long pool → thick mud; aero skips the water                */
    /* ------------------------------------------------------------------ */
    case 'rapids': {
      const u1 = y + 55;
      // Approach down into the run-out. #99 retired the skipping pool that used to bridge this
      // stretch, so the ramp now carries the pack straight across.
      b.ramp(-100, u1, 260, y + 120);
      b.ppeg(200, uy(u1, y + 120, 260, 200) - 30, 'green', 10, SUPPLY.rapids);

      // Run-out into the tar.
      b.ramp(260, y + 120, 640, y + 160);
      // Thick mud after the water.
      b.mud(640, y + 155, tip, y + 200, 0.28);
      b.ramp(630, y + 160, tip, y + 220);
      b.ppeg(500, y + 120, 'orange', 10);
      b.ppeg(700, y + 185, 'orange', 10);

      r1 = y + 450;
      r2 = y + 690;
      height = 870;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* macealley: mace over main path; wrecker guards the return road     */
    /* ------------------------------------------------------------------ */
    case 'macealley': {
      const u1 = y + 50;
      const u2 = y + 230;
      b.ramp(-100, u1, tip, u2);
      b.ppeg(240, uy(u1, u2, tip, 240) - 30, 'green', 10, SUPPLY.macealley);
      b.boostOnRamp(0, u1, tip, u2, 0.52, 75);

      // Brutal mace swings over the main path.
      const maceX = 480;
      const maceY = uy(u1, u2, tip, maceX) - 40;
      b.mace(maceX, maceY, 130, 0.55, 1500, 400, v * 600, 24);
      b.ppeg(600, uy(u1, u2, tip, 600) - 28, 'orange', 10);

      r1 = y + 430;
      r2 = y + 670;
      // Wrecker guards the return road (placed after anchors known).
      height = 850;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* magnetcave: giant gap with ceiling magnet pulling metal marbles    */
    /* ------------------------------------------------------------------ */
    case 'magnetcave': {
      const u1 = y + 55;
      // Approach lip.
      b.ramp(-100, u1, 300, y + 130);
      b.ppeg(220, uy(u1, y + 130, 300, 220) - 30, 'green', 10, SUPPLY.magnetcave);

      // Giant gap — magnet in the ceiling pulls heavy/anvil marbles across.
      b.magnet(500, y + 40, 200, 4, 0, 0);

      // Far landing shelf.
      b.ramp(680, y + 100, tip, y + 160);
      b.ppeg(720, y + 120, 'orange', 10);

      // Soft floor for light marbles that the magnet ignores.
      b.ramp(340, y + 300, 660, y + 340);
      b.trampoline(500, y + 320, 160, 1.05);

      r1 = y + 450;
      r2 = y + 690;
      height = 870;
      break;
    }

    /* ------------------------------------------------------------------ */
    /* boulderrun: backwards conveyor upper road; boulders on lower road  */
    /* ------------------------------------------------------------------ */
    case 'boulderrun': {
      const u1 = y + 50;
      const u2 = y + 230;
      // Entire upper road is a backwards conveyor.
      b.conveyor(0, u1, tip, u2, 0.24 + v * 0.03, undefined, 1);
      b.ppeg(240, uy(u1, u2, tip, 240) - 30, 'green', 10, SUPPLY.boulderrun);
      b.ppeg(520, uy(u1, u2, tip, 520) - 28, 'orange', 10);

      r1 = y + 430;
      r2 = y + 670;
      height = 850;
      break;
    }

    default: {
      // Exhaustiveness fallback — should never hit.
      b.ramp(-100, y + 50, tip, y + 230);
      r1 = y + 420;
      r2 = y + 660;
      height = 820;
      break;
    }
  }

  // ---- Shared return road (every layout draws its own; never a solid undroppable frame) ----
  b.ramp(W + 100, r1, end, r2);
  const retY = (x: number) => ry(r1, r2, end, x);
  b.itemBox(305, retY(305) - 35);
  b.ppeg(520, retY(520) - 32, 'orange', 10);

  // Layout-specific return-road hazards placed now that anchors are final.
  if (layout === 'macealley') {
    b.wrecker(700, retY(700) - 120, 100, 0.5, 0.0025, v * 1.2);
  }
  if (layout === 'boulderrun') {
    // Continuous boulder drops onto the lower return road.
    b.boulder(
      [
        [760, r1 - 40],
        [640, retY(640)],
        [480, retY(480)],
        [320, retY(320)],
      ],
      28,
      5,
      v * 400,
    );
    b.boulder(
      [
        [820, r1 - 20],
        [700, retY(700) + 10],
        [540, retY(540) + 10],
        [380, retY(380) + 10],
      ],
      26,
      4.5,
      900 + v * 300,
    );
  }
  if (layout === 'bladestreet') {
    // Extra ghost supply on the return if they dropped.
    b.ppeg(680, retY(680) - 30, 'green', 10, 'ghost');
  }
  if (layout === 'looprun') {
    // Geyser already placed; add a small boost after rescue.
    b.boost(400, retY(400) - 20, 100, 28, -1, 0);
  }

  return height + v * 15;
}

/**
 * Every chapter receives marbles at the left edge and returns them there.
 * Two overlapping banked roads catch misses; the next chapter catches the exit.
 * Mirroring the entire course preserves that contract.
 */
export function buildExperimentalCourse(
  b: Builder,
  seed: number,
  profile: TrackProfile,
  start: number,
): SegmentInfo[] {
  const plan = planExperimentalCourse(seed, profile);
  const segments: SegmentInfo[] = [];
  b.flip = false;

  // Fair opening: all ten grid columns meet the same open collector.
  b.ramp(-100, start + 20, 340, start + 160);
  b.ramp(W + 100, start + 20, 560, start + 160);
  // Bank feeds the first chapter's actual entry side.
  b.flip = !plan[0].mirror;
  b.ramp(-100, start + 280, 740, start + 520);
  segments.push({ name: 'Open grid collector', y: start, h: 680 });

  let y = start + 680;
  for (const chapter of plan) {
    b.flip = chapter.mirror;
    const h = buildChapter(b, chapter, y);
    segments.push({ name: NAMES[chapter.layout], y, h });
    y += h;
  }

  // Final receiver matches the last chapter's exit side.
  b.flip = plan[plan.length - 1].mirror;
  b.ramp(-100, y + 40, 740, y + 300);
  segments.push({ name: 'Home straight', y, h: 480 });
  b.flip = false;
  return segments;
}
