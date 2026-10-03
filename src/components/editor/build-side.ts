// P2-22: the Workshop's build for a platformer course: the same shape `buildEditorTrack` returns (a track to draw, a
// bounding box per piece, an error), but the track is the CoursePlan's own and there is no body-to-piece map: a
// platformer course picks pieces by their boxes (and the lane being edited), not by the Matter bodies.
import type { Piece, TrackDef } from '../../game/trackdef';
import { validateTrackDef } from '../../game/trackdef';
import { TRACK_THEMES, themeFor } from '../../game/types';
import { trackFromPlan } from '../../game/platformer/build';
import { SPRING_W } from '../../game/platformer/course';
import { planFromTrackDef, settle } from '../../game/platformer/def';
import { LOOP_PITCH, LOOP_R, PLANK_H } from '../../game/platformer/routes';
import type { Track } from '../../game/track';
import type { Bounds } from './bounds';

type Built = { track: Track | null; bodyToPiece: number[]; pieceBounds: Bounds[]; error: string | null };

const box = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ min: { x: Math.min(x0, x1), y: Math.min(y0, y1) }, max: { x: Math.max(x0, x1), y: Math.max(y0, y1) } });

/** The selection box of a platformer piece, in world coordinates. */
export function sideBounds(p: Piece): Bounds {
  switch (p.t) {
    case 'ramp': case 'ice': return box(p.a[0], p.a[1] - 14, p.b[0], p.b[1] + 30);
    case 'curve': {
      const ys = [p.a[1], p.b[1], (p.a[1] + 2 * p.c[1] + p.b[1]) / 4], xs = [p.a[0], p.b[0], (p.a[0] + 2 * p.c[0] + p.b[0]) / 4];
      return box(Math.min(...xs), Math.min(...ys) - 14, Math.max(...xs), Math.max(...ys) + 30);
    }
    case 'pad': return box(p.x - SPRING_W / 2, p.y - 46, p.x + SPRING_W / 2, p.y + 4);
    case 'boost': return box(p.x - p.len / 2, p.y - 22, p.x + p.len / 2, p.y + 8);
    case 'itembox': return box(p.x - 22, p.y - 22, p.x + 22, p.y + 22);
    case 'block': return box(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2);
    case 'wrecker': {
      const reach = p.chain * Math.sin(Math.min(1.5, p.amp)) + 30;
      return box(p.pivot[0] - reach, p.pivot[1] - 20, p.pivot[0] + reach, p.pivot[1] + p.chain + 30);
    }
    case 'bridge': return box(p.a[0], Math.min(p.a[1], p.b[1]) - 10, p.b[0], Math.max(p.a[1], p.b[1]) + p.slack + PLANK_H + 6);
    case 'loop': return box(p.x - LOOP_R - 40, p.bottom - LOOP_R * 2 - 24, p.x + LOOP_PITCH + LOOP_R + 40, p.bottom + 20);
    case 'gate': return box(p.x, p.y - 110, p.x + p.w, p.y + 14);
    case 'ledge': return box(p.x, p.y - 8, p.x + p.w, p.y + 18);
    case 'sign': return box(p.x - p.w / 2, p.y - p.w * 0.21, p.x + p.w / 2, p.y + p.w * 0.21);
    default: {
      const x = 'x' in p ? (p as { x: number }).x : 0, y = 'y' in p ? (p as { y: number }).y : 0;
      return box(x - 30, y - 30, x + 30, y + 30);
    }
  }
}

/** Builds a platformer def for the editor: never throws, like `buildEditorTrack`. */
export function buildPlatformerEditor(def: TrackDef): Built {
  const check = validateTrackDef(def);
  if (!check.ok) return { track: null, bodyToPiece: [], pieceBounds: [], error: check.error };
  try {
    const plan = planFromTrackDef(settle(check.def));
    const track = trackFromPlan(plan, check.def.seed ?? 0, themeFor(check.def.theme) ?? TRACK_THEMES.forest);
    return { track, bodyToPiece: [], pieceBounds: check.def.pieces.map(sideBounds), error: null };
  } catch (error) {
    return { track: null, bodyToPiece: [], pieceBounds: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** The topmost piece under a point among `pieceBounds`, skipping `blocked` indices (locked, or in another lane). */
export function hitSidePiece(point: { x: number; y: number }, pieceBounds: Bounds[], blocked?: ReadonlySet<number>): number | null {
  for (let i = pieceBounds.length - 1; i >= 0; i--) {
    if (blocked?.has(i)) continue;
    const { min, max } = pieceBounds[i] ?? {};
    if (!min || !max) continue;
    if (point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y) return i;
  }
  return null;
}
