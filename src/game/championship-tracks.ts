// The championship calendar's tracks. The drop (pinball) circuits are retired from play: every Grand Prix races a
// platformer course (platformer/course.ts GP_COURSES), handed to the rest of the game as an ordinary platformer
// TrackDef, so the season, Quick race, Online, the Workshop's "copy an official course" and every preview treat it
// like any other track. (The old archives in official-tracks.ts stay for the engine's regression tests.)
import { validateTrackDef } from './trackdef';
import type { TrackDef } from './trackdef';
import { GP_COURSES, planOfficial } from './platformer/course';
import { defFromPlan } from './platformer/def';

const cache = new Map<number, TrackDef | null>();

/** The platformer track a calendar round races (null only if the round does not exist). */
export function championshipTrack(round: number): TrackDef | null {
  if (cache.has(round)) return cache.get(round)!;
  const course = GP_COURSES[round];
  let def: TrackDef | null = null;
  if (course) {
    const check = validateTrackDef(defFromPlan(planOfficial(course), course.name));
    def = check.ok ? check.def : null;
  }
  cache.set(round, def);
  return def;
}
