import type { Builder, SegmentInfo } from './track';
import type { ItemType, TrackProfile } from './types';
import { planCourse } from './course-plan';
import type { CourseChapter, CourseFeature, CourseLayout } from './course-plan';

// A runtime import from track would introduce a circular ESM initialization dependency.
const W = 900;
type Road = [number, number, number, number];
type Point = [number, number];

const NAMES: Record<CourseLayout, string> = {
  sweeper: 'Grand Sweeper',
  split: 'Dual-Carriageway Split',
  slalom: 'High-Speed Slalom',
  terraces: 'Stepped Terraces',
  arena: 'Arena Bowl',
};
const SUPPLY: Record<CourseFeature, ItemType> = {
  banking: 'aero', peggle: 'rocket', ice: 'aero', boost: 'jump', machines: 'ghost',
};

/** Only right-going local roads use belts; the builder mirrors their tangent, not dir. */
function road(b: Builder, chapter: CourseChapter, points: Road): void {
  const [x1, y1, x2, y2] = points;
  if (chapter.feature === 'ice') b.ice(...points);
  else if (chapter.feature === 'machines') {
    b.conveyor(...points, 0.16 + chapter.variant * 0.025, 0, b.flip ? 1 : 0);
  } else if (chapter.feature === 'banking') {
    b.curve(x1, y1, x1 + (x2 - x1) * 0.45, y1 + (y2 - y1) * 0.38, x2, y2, 10);
  } else {
    b.ramp(...points);
    if (chapter.feature === 'boost') b.boostOnRamp(...points, 0.62, 85);
  }
}

/** Features occupy open air, never a narrow pocket between a machine and a rail. */
function feature(b: Builder, chapter: CourseChapter, [x, y]: Point): void {
  if (chapter.feature === 'peggle') {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        b.ppeg(x - 30 + col * 60, y - 24 + row * 48,
          (row + col + chapter.variant) % 2 ? 'orange' : 'blue', 9);
      }
    }
  } else if (chapter.feature === 'machines') {
    if (chapter.variant === 2) b.mace(x, y - 70, 70, 0.65, 1100, 120, 500, 16);
    else b.spinner(x, y, 70, (b.flip ? -1 : 1) * (0.035 + chapter.variant * 0.01));
  }
}

function buildChapter(b: Builder, chapter: CourseChapter, y: number): number {
  const tip = 700 + chapter.variant * 20;
  let exit: Road;
  let spot: Point;
  let height: number;
  switch (chapter.layout) {
    case 'sweeper':
      b.curve(0, y + 40, 250, y + 145, tip, y + 260, 14);
      b.curve(W, y + 370, 650, y + 480, 160 + chapter.variant * 10, y + 680, 14);
      exit = [0, y + 780, tip, y + 1000];
      spot = [790, y + 340];
      height = 1160;
      break;
    case 'split':
      // Fast marbles clear the gap onto the high road; short jumps fall onto the highway.
      b.ramp(0, y + 40, 320, y + 160);
      b.boostOnRamp(0, y + 40, 320, y + 160, 0.65, 90);
      road(b, chapter, [500, y + 250, 680, y + 310]);
      b.curve(0, y + 340, 300, y + 460, 650, y + 610, 14);
      // Wall riders and both roads meet above the final, unobstructed exit road.
      b.ramp(W, y + 710, 610, y + 810);
      exit = [0, y + 700, tip, y + 940];
      spot = [390, y + 245];
      height = 1100;
      break;
    case 'slalom':
      road(b, chapter, [0, y + 40, tip, y + 280]);
      b.ramp(W, y + 410, 160 + chapter.variant * 20, y + 670);
      exit = [0, y + 790, tip, y + 1040];
      spot = [790, y + 350];
      height = 1200;
      break;
    case 'terraces':
      road(b, chapter, [0, y + 40, 250, y + 180]);
      // Ice terraces cannot trap a stopped low-bounce kit on a horizontal spring pad.
      b.ice(160, y + 260, 540, y + 385);
      b.ice(380, y + 470, 710, y + 590);
      b.ramp(W, y + 640, 600, y + 770);
      exit = [0, y + 700, tip, y + 940];
      spot = [360, y + 220];
      height = 1100;
      break;
    case 'arena':
      b.curve(0, y + 40, 230, y + 150, 330, y + 250, 10);
      b.ramp(W, y + 40, 570, y + 250);
      // A broad drain and no solid bowl floor: gravity also provides an ordinary bypass.
      b.vortex(450, y + 365, 110 + chapter.variant * 10, 0.5 + chapter.variant * 0.05, 76);
      b.ramp(0, y + 560, 350, y + 740);
      b.ramp(W, y + 560, 550, y + 740);
      exit = [0, y + 850, tip, y + 1100];
      spot = [450, y + 730];
      height = 1260;
      break;
  }
  road(b, chapter, exit);
  feature(b, chapter, spot);
  const at = (x: number) => exit[1] + (exit[3] - exit[1]) * x / exit[2];
  b.ppeg(260, at(260) - 52, 'green', 13, SUPPLY[chapter.feature]);
  b.itemBox(420, at(420) - 30);
  return height + chapter.variant * 20;
}

/** Local entry is the left wall; local exit is the right-hand opening (at least 160 wide).
 * Alternate mirrors to give the next wall-flush receiver the previous chapter's outlet.
 * All gaps are over catch roads, and no rolling surface has a horizontal tangent.
 */
export function buildCourse(b: Builder, seed: number, profile: TrackProfile, start: number): SegmentInfo[] {
  const plan = planCourse(seed, profile);
  const segments: SegmentInfo[] = [];
  b.flip = false;
  b.ramp(0, start + 20, 340, start + 160);
  b.ramp(W, start + 20, 560, start + 160);
  // The open grid drains centrally, then this bank feeds the first chapter's actual entry side.
  b.flip = !plan[0].mirror;
  b.ramp(0, start + 280, 740, start + 520);
  segments.push({ name: 'Open grid collector', y: start, h: 680 });
  let y = start + 680;
  for (const chapter of plan) {
    b.flip = chapter.mirror;
    const h = buildChapter(b, chapter, y);
    segments.push({ name: `${NAMES[chapter.layout]} / ${chapter.feature}`, y, h });
    y += h;
  }
  // The final receiver depends on chapter parity, not merely seed parity.
  b.flip = !plan[plan.length - 1].mirror;
  b.ramp(0, y + 40, 740, y + 300);
  segments.push({ name: 'Home straight', y, h: 480 });
  b.flip = false;
  return segments;
}
