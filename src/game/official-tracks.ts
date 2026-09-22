/**
 * The shipped championship circuits — what a calendar round races when the player has
 * not swapped in one of their own.
 *
 * Each Grand Prix has one archived TrackDef under `src/game/official-tracks/champ-<round>.json`:
 * generated once in the Workshop (New track → Procedural Generator, or the dev Generate button),
 * hand-fixed there, then archived with the dev Archive button, which writes the file straight
 * from the editor's current circuit. The game loads these files and never generates a calendar
 * circuit at race time — the menu demo, every heat and the Workshop all rebuild exactly the
 * bodies the archive records, so a change archived in dev mode is the change everyone races.
 *
 * The files are first-party but still validated on the way in: one that fails is dropped
 * (`null`) and the round falls back to the seeded generator inside `Game.trackFor` — a broken
 * archive must never take a race down.
 *
 * Dev workflow (Workshop → My tracks → Dev tools, `import.meta.env.DEV` only):
 *   Generate → a fresh seeded circuit for that round, loaded into the editor;
 *   Load saved → the archived circuit the round currently races, loaded for another pass;
 *   Archive → write the editor's current circuit to `champ-<round>.json` (Vite reloads, and
 *   the next build ships it).
 */
import champ0 from './official-tracks/champ-0.json';
import champ1 from './official-tracks/champ-1.json';
import champ2 from './official-tracks/champ-2.json';
import champ3 from './official-tracks/champ-3.json';
import champ4 from './official-tracks/champ-4.json';
import champ5 from './official-tracks/champ-5.json';
import { validateTrackDef } from './trackdef';
import type { TrackDef } from './trackdef';

const ARCHIVES: unknown[] = [champ0, champ1, champ2, champ3, champ4, champ5];

function archiveOf(value: unknown): TrackDef | null {
  const check = validateTrackDef(value);
  return check.ok ? check.def : null;
}

/** Round-indexed archives. `null` where the file is missing or was refused by validation. */
export const OFFICIAL_TRACKS: readonly (TrackDef | null)[] = ARCHIVES.map(archiveOf);

/** The shipped circuit a calendar round races, or null when there is no usable archive. */
export function officialTrack(round: number): TrackDef | null {
  return OFFICIAL_TRACKS[round] ?? null;
}
