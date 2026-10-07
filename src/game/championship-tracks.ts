// The championship calendar's tracks. Every Grand Prix races a platformer course (platformer/course.ts GP_COURSES),
// handed to the rest of the game as an ordinary platformer TrackDef, so Quick race, Online, the Workshop's "copy an
// official course" and every preview treat it like any other track. A course archived from the Workshop's dev tools
// (official-tracks/gp-<round>.json) is raced as saved; a round with no archive races its generated course.
//
// The owner: the pinball (drop) circuits come back for two rounds of the season only, in the championship and in
// story: Monte Pipo and Suzuka race their archived pinball circuits (official-tracks/champ-<round>.json). That is the
// only place a pinball circuit is raced (seasonTrack); everywhere else those rounds are platformer courses too.
import { validateTrackDef } from './trackdef';
import type { TrackDef } from './trackdef';
import { GP_COURSES, planOfficial } from './platformer/course';
import { defFromPlan } from './platformer/def';
import { officialTrack } from './official-tracks';

/** The calendar rounds raced on their pinball circuits in the championship and story: Monte Pipo (1) and Suzuka (4). */
export const PINBALL_ROUNDS: ReadonlySet<number> = new Set([1, 4]);

// The platformer archives (dev tools: Archive). Vite collects them; outside Vite (node tests) there are none.
const archives: Record<string, unknown> = typeof import.meta.glob === 'function'
  ? import.meta.glob('./official-tracks/gp-*.json', { eager: true, import: 'default' })
  : {};

/** A round's archived platformer course, if one was archived and still validates. */
export function archivedPlatformerTrack(round: number): TrackDef | null {
  const raw = archives[`./official-tracks/gp-${round}.json`];
  if (!raw) return null;
  const check = validateTrackDef(raw);
  return check.ok && check.def.mode === 'platformer' ? check.def : null;
}

/** A round's platformer course freshly generated from its seed (the dev tools' Generate). */
export function generatedPlatformerTrack(round: number): TrackDef | null {
  const course = GP_COURSES[round];
  if (!course) return null;
  const check = validateTrackDef(defFromPlan(planOfficial(course), course.name));
  return check.ok ? check.def : null;
}

const cache = new Map<number, TrackDef | null>();

/** The platformer track a calendar round races: its archive, else its generated course (null if no such round). */
export function championshipTrack(round: number): TrackDef | null {
  if (cache.has(round)) return cache.get(round)!;
  const def = archivedPlatformerTrack(round) ?? generatedPlatformerTrack(round);
  cache.set(round, def);
  return def;
}

/** What a round races in the championship and story: Monte Pipo and Suzuka on their pinball circuits, else the course. */
export function seasonTrack(round: number): TrackDef | null {
  if (PINBALL_ROUNDS.has(round)) return officialTrack(round) ?? championshipTrack(round);
  return championshipTrack(round);
}
