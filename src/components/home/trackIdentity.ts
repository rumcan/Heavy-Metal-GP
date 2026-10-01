/**
 * Which track is which. The home screen has to answer two questions about tracks it did not make:
 *   - is this community track already in My tracks? (so picking it twice does not save it twice)
 *   - is the Workshop's open draft worth protecting before something else replaces it?
 * Both come down to "are these two defs the same circuit?" — by content, never by name alone: a player's own track
 * can share a community track's name. Pure apart from reading My tracks.
 */
import { OFFICIAL_TRACKS } from '../../game/official-tracks';
import { compressDef, loadTracksSync } from '../../game/tracks';
import type { SavedTrack } from '../../game/tracks';
import type { TrackDef } from '../../game/trackdef';

/** JSON with the keys in a fixed order: key order must not decide whether two defs are the same track. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** The same circuit, as My tracks would store it (compressed, so a saved and an unsaved copy compare equal). */
export function sameTrack(a: TrackDef, b: TrackDef): boolean {
  return stableJson(compressDef(a)) === stableJson(compressDef(b));
}

/** The My tracks entry that already holds this circuit under this name, if the player has saved it. */
export function savedCopyOf(def: TrackDef, name: string): SavedTrack | undefined {
  const wanted = { ...def, name };
  return loadTracksSync().find((t) => sameTrack(t.def, wanted));
}

/**
 * Would replacing this draft lose the player's work? Not if it is empty, a copy of a saved track, or an untouched
 * calendar circuit (what the Workshop opens on the first time): none of those is anything the player made.
 */
export function draftNeedsSaving(draft: TrackDef | null, saved: readonly SavedTrack[]): boolean {
  if (!draft || draft.pieces.length === 0) return false;
  if (saved.some((t) => sameTrack(t.def, draft))) return false;
  if (OFFICIAL_TRACKS.some((official) => official && sameTrack(official, draft))) return false;
  return true;
}
