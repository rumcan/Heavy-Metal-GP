// Story chapters on platformer courses. Each chapter races its Grand Prix's course (platformer/course.ts GP_COURSES)
// with the pieces its objectives and its track weights need placed along the way, so nothing the story asks for is
// lost now that the drop tracks are retired:
//   - "Hit 10 orange pegs" (chapter 2): orange and blue pegs hanging over every lane at hop height;
//   - "Break through a SMASH wall" / Crack Wall Shortcut weight: SMASH walls on the track in every lane;
//   - "Fly through 3 fire hoops": fire hoops over every lane;
//   - the Spinners weight: spinners over the track.
// Loops are the course's own loop rings (the engine counts a ride over the top). The pieces are ordinary classic
// pieces (P2-26 extras), built and drawn the same way as anywhere else.
import type { Piece } from '../trackdef';
import { GP_COURSES, floorAt, planOfficial, registerCustomCourse } from '../platformer/course';
import type { CoursePlan, Lane } from '../platformer/course';
import { mulberry32 } from '../types';
import { chapterDef } from './outline';

/** How many sectors a platformer course is split into for the story's mid-race scenes and events. */
export const STORY_SECTORS = 30; // the latest story beat fires at sector 26

type Extra = NonNullable<CoursePlan['extras']>[number];

/** Evenly spread x positions over the run between the start and the finish, a little jitter so they are not a grid. */
function spread(plan: CoursePlan, count: number, rng: () => number, from = 0.08, to = 0.92): number[] {
  const x0 = plan.startX + 600, x1 = plan.finishX - 600;
  return Array.from({ length: count }, (_, i) => x0 + (x1 - x0) * (from + (to - from) * ((i + 0.3 + rng() * 0.4) / count)));
}

/** A spot on a lane's floor at x (null over a chasm). */
function floorSpot(plan: CoursePlan, lane: Lane, x: number): number | null {
  return floorAt(plan, lane, x);
}

/** The pieces a chapter adds to its course. */
export function storyExtras(chapter: number, plan: CoursePlan): Extra[] {
  const def = chapterDef(chapter);
  const rng = mulberry32(0x5707 + chapter * 977);
  const out: Extra[] = [];
  const counters = new Set((def.objectives ?? []).map((o) => o.counter).filter(Boolean));
  const weights = def.weights ?? {};
  const each = (count: number, make: (x: number, floor: number, lane: Lane) => Piece | null) => {
    for (const lane of [0, 1, 2] as Lane[]) {
      for (const x of spread(plan, count, rng)) {
        const floor = floorSpot(plan, lane, x);
        if (floor === null) continue;
        const piece = make(Math.round(x), floor, lane);
        if (piece) out.push({ lane, piece: { ...piece, lane } as Piece });
      }
    }
  };
  if (counters.has('orangePegs')) {
    // a little arc of pegs at hop height: two orange, one blue, every few hundred metres
    each(10, (x, floor) => ({ t: 'ppeg', x, y: Math.round(floor - 70), color: 'orange', r: 10 }));
    each(8, (x, floor) => ({ t: 'ppeg', x: x + 40, y: Math.round(floor - 95), color: 'blue', r: 10 }));
  }
  if (counters.has('crates') || weights['Crack Wall Shortcut']) {
    each(counters.has('crates') ? 4 : 2, (x, floor) => ({ t: 'breakable', x, y: Math.round(floor - 30), w: 40, h: 60, req: 3 }));
  }
  if (counters.has('hoops')) {
    each(7, (x, floor) => ({ t: 'hoop', x, y: Math.round(floor - 60), dir: [1, 0] }));
  }
  if (weights.Spinners) {
    each(3, (x, floor) => ({ t: 'spinner', x, y: Math.round(floor - 110), len: 120, speed: 0.12 }));
  }
  return out;
}

const registered = new Map<number, string>();

/** The course id a chapter races: its Grand Prix course, with the chapter's pieces added (registered once). */
export function storyCourseId(chapter: number): string {
  const known = registered.get(chapter);
  if (known) return known;
  const gp = GP_COURSES[chapterDef(chapter).gp] ?? GP_COURSES[0];
  const base = planOfficial(gp);
  const extras = storyExtras(chapter, base);
  const id = `story-c${chapter}`;
  registerCustomCourse(id, gp.name, extras.length ? { ...base, extras: [...(base.extras ?? []), ...extras] } : base);
  registered.set(chapter, id);
  return id;
}
