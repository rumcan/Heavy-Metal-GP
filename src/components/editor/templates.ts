import type { Piece } from '../../game/trackdef';
import { getItem, setItem } from '../../game/storage';
import { Builder, W } from '../../game/track';
import { replayPiece } from '../../game/trackdef';
import { visualBoundsForPiece } from './bounds';
import { SNAP } from './camera';
import { fitGroupTranslation, translatePiece } from './translation';

export interface SavedTemplate {
  id: string;
  name: string;
  sprite: string;
  pieces: Piece[];
  /** Missing/1 = legacy first-piece anchor. 2 = visual group centre at (0, 0).
   * Flip retains the track's W - x representation even in local coordinates.
   */
  version?: 1 | 2;
  /** Buckets have a fixed horizontal route: keep the entire group at its saved x. */
  fixedOriginX?: number;
}

const TEMPLATES_KEY = 'heavy-metal-templates';

export function getTemplates(): SavedTemplate[] {
  try {
    const data = getItem(TEMPLATES_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load templates:', err);
  }
  return [];
}

export function saveTemplate(template: Omit<SavedTemplate, 'id'>): SavedTemplate {
  const templates = getTemplates();
  const id = 'template-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
  const newTemplate = { ...template, id };
  templates.push(newTemplate);
  try {
    setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch (err) {
    console.error('Failed to save template:', err);
  }
  return newTemplate;
}

export function deleteTemplate(id: string) {
  const templates = getTemplates();
  const filtered = templates.filter(t => t.id !== id);
  try {
    setItem(TEMPLATES_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.error('Failed to delete template:', err);
  }
}

/** Capture an independent, centre-normalised snapshot BEFORE opening the dialog. */
export function snapshotTemplate(pieces: readonly Piece[]): Pick<SavedTemplate, 'version' | 'pieces' | 'fixedOriginX'> {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const piece of pieces) {
    // Calculate unflipped bounds, then mirror them. Sprite bounds also need to
    // follow flip, not just the replayed physics bodies.
    const unflipped = { ...piece, flip: false };
    const builder = new Builder(0);
    replayPiece(builder, unflipped);
    const bounds = visualBoundsForPiece(unflipped, builder.bodies);
    minX = Math.min(minX, piece.flip ? W - bounds.max.x : bounds.min.x);
    maxX = Math.max(maxX, piece.flip ? W - bounds.min.x : bounds.max.x);
    minY = Math.min(minY, bounds.min.y);
    maxY = Math.max(maxY, bounds.max.y);
  }
  const cx = pieces.length ? (minX + maxX) / 2 : 0;
  const cy = pieces.length ? (minY + maxY) / 2 : 0;
  return {
    version: 2,
    pieces: pieces.map(p => translatePiece(structuredClone(p), -cx, -cy)),
    ...(pieces.some(p => p.t === 'bucket') ? { fixedOriginX: cx } : {}),
  };
}

/** Shared by the canvas ghost and committed placement. No first-piece inference for v2. */
export function placeTemplate(template: SavedTemplate, world: { x: number; y: number }, snap: boolean): Piece[] | null {
  if (!template.pieces.length) return null;
  let dx = snap ? Math.round(world.x / SNAP) * SNAP : world.x;
  let dy = snap ? Math.round(world.y / SNAP) * SNAP : world.y;
  if (template.version === 2) {
    if (template.fixedOriginX !== undefined) dx = template.fixedOriginX;
  } else if (template.version === undefined || template.version === 1) {
    // Preserve the historical anchor exactly, including its incomplete type
    // fallbacks. Old saves may already be distorted: don't silently recenter them.
    const anchor = template.pieces[0];
    dx -= 'x' in anchor ? anchor.x : ('a' in anchor ? anchor.a[0] : 0);
    dy -= 'y' in anchor ? anchor.y : ('a' in anchor ? anchor.a[1] : 0);
  } else {
    return null; // A future format must not be silently treated as legacy.
  }
  const fittedX = fitGroupTranslation(template.pieces, dx);
  if (fittedX === null || (template.fixedOriginX !== undefined && fittedX !== dx)) return null;
  return template.pieces.map(p => translatePiece(structuredClone(p), fittedX, dy));
}
