// P2-22: which entries are platformer courses. A course is an ordinary TrackDef, so it lives in the same lists as a
// circuit: My tracks, the open draft, the community store. Every browse and picker therefore has to be able to tell the
// two apart — the classic lists (My tracks in Quick race, the championship's track picker, the online custom-track
// list, Community tracks) show circuits only, and the Platformer tab shows courses only. Pure, so the lists can be
// tested without a browser.
import type { TrackDef } from '../trackdef';
import { isPlatformerDef } from './def';

/** Anything that carries a def: a My tracks entry, or a community entry once its code is decoded. */
export interface HasDef { def: TrackDef }

/** What an entry is: a classic circuit, or a platformer course built sideways in three lanes. */
export type CommunityKind = 'track' | 'platformer';

export const isCourseEntry = (entry: HasDef): boolean => isPlatformerDef(entry.def);
export const isCircuitEntry = (entry: HasDef): boolean => !isPlatformerDef(entry.def);

export const kindOfDef = (def: TrackDef): CommunityKind => (isPlatformerDef(def) ? 'platformer' : 'track');
export const kindOfEntry = (entry: HasDef): CommunityKind => kindOfDef(entry.def);

/**
 * The kind a stored community entry declares. Entries published before courses existed carry no kind at all, and they
 * are all circuits.
 */
export const kindOf = (entry: { kind?: CommunityKind } | null | undefined): CommunityKind =>
  entry?.kind === 'platformer' ? 'platformer' : 'track';

export const coursesOf = <T extends HasDef>(list: readonly T[]): T[] => list.filter(isCourseEntry);
export const circuitsOf = <T extends HasDef>(list: readonly T[]): T[] => list.filter(isCircuitEntry);
export const entriesOfKind = <T extends { kind?: CommunityKind }>(list: readonly T[], kind: CommunityKind): T[] =>
  list.filter((entry) => kindOf(entry) === kind);

/** One pass over a mixed list: the circuits and the courses, in the order they came in. */
export function splitEntries<T extends HasDef>(list: readonly T[]): { circuits: T[]; courses: T[] } {
  const circuits: T[] = [], courses: T[] = [];
  for (const entry of list) (isCourseEntry(entry) ? courses : circuits).push(entry);
  return { circuits, courses };
}
