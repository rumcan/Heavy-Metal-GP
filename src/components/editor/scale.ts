import { Piece } from '../../game/trackdef';

/**
 * The size ranges a drag may drive. These are the SAME bounds the settings panel offers and the
 * `TrackDef` schema accepts (`src/game/trackdef.ts`), re-exported through `handles.ts` so
 * `PropertiesPanel.tsx` and the dots can never drift apart.
 */
export const HANDLE_RANGES = {
  /** `catapult.len` — the throw arm. */
  catapultLen: { min: 120, max: 400 },
  /** `sling.size` — the rubber wedge. */
  slingSize: { min: 40, max: 180 },
  /** `crusher.w` — the piston plate. */
  crusherW: { min: 40, max: 400 },
  /** `platform.w` — the ferry deck. */
  platformW: { min: 40, max: 300 },
} as const;

/**
 * #99 Part 1 — one resize behaviour for every item.
 *
 * The old model was a hand-written branch per type driven by "pointer distance from the centre",
 * and every type without a branch simply ignored the drag. The shared base spec says the four
 * round corner dots of the selection box must rescale the selected item, so the model is now a
 * field table: grabbing a corner pins the OPPOSITE corner of the box and scales the type's size
 * fields by the per-axis box ratios — the dragged corner follows the pointer one-to-one, like a
 * vector editor's frame resize.
 *
 * Three transform styles per type:
 *  - `fields`: scalar size fields scaled by the axis ratio (`sx` grows x-reach, `sy` y-reach).
 *  - `pts`: point-list geometry (`a`/`b`/`c`, `ax…by`, waypoint arrays) scaled about the anchor
 *    corner pointwise, plus optional scalar fields.
 *  - no entry (`itembox`, `hoop`, `targets`, `bucket`, `cannon`): fixed-size set-pieces with no
 *    size field — the dots are drawn like on every item, but dragging them changes nothing.
 *
 * Ranges are the ones the settings panel and TrackDef schema agree on (`HANDLE_RANGES` / the
 * per-handle clamps in `handles.ts`), so the dots can never drive a piece out of schema.
 */

export interface AnchorBox {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

export type CornerHandleId = 'box-nw' | 'box-ne' | 'box-sw' | 'box-se';

/** All five set-pieces have a fixed physical footprint: corridors one marble wide, gates of a
 * fixed gauge. They still carry the four dots (every item's base is the same) but a corner drag
 * on them is a no-op on purpose. */
const FIXED_SIZE: readonly Piece['t'][] = ['itembox', 'hoop', 'targets', 'bucket', 'cannon', 'wrecker'];

interface RangeSpec { min: number; max?: number }

interface ResizeSpec {
  /** Scalar fields scaled by the horizontal box ratio. */
  x?: Record<string, RangeSpec>;
  /** Scalar fields scaled by the vertical box ratio. */
  y?: Record<string, RangeSpec>;
  /** Scalar fields scaled by the mean axis ratio (radial sizes). */
  uniform?: Record<string, RangeSpec>;
  /** Point arrays ([x, y]) scaled about the anchor corner pointwise. */
  pts?: string[];
  /** Flat scalar x/y point pairs (e.g. `ax`/`ay`), scaled about the anchor corner. */
  ptPairs?: [string, string][];
}

const R = (min: number, max?: number): RangeSpec => ({ min, max });

const RESIZE_SPECS: Partial<Record<Piece['t'], ResizeSpec>> = {
  ramp: { pts: ['a', 'b'] },
  curve: { pts: ['a', 'b', 'c'] },
  // The corner dots grow the circle; its plank keeps its thickness (that has its own handle).
  ring: { uniform: { r: R(30, 1200) } },
  sign: { uniform: { w: R(60, 600) } },
  ice: { pts: ['a', 'b'] },
  loop: { uniform: { r: R(20, 800) } },
  wrecker: { y: { chain: R(8, 2000) }, uniform: { amp: R(0.05, Math.PI / 2 - 0.01) } },
  pad: { x: { w: R(10) } },
  boost: { x: { len: R(10, 4000) }, y: { thick: R(6, 400) } },
  spinner: { x: { len: R(10, 4000) } },
  breakable: { x: { w: R(10) }, y: { h: R(10) } },
  peg: { uniform: { r: R(4, 200) } },
  ppeg: { uniform: { r: R(4, 200) } },
  wall: { x: { w: R(10) }, y: { h: R(10) } },
  block: { x: { w: R(10) }, y: { h: R(10) } },
  barricade: { x: { w: R(10) }, y: { h: R(10) } },
  crumble: { x: { w: R(10) }, y: { h: R(10) } },
  trapdoor: { x: { w: R(10) } },
  blade: { x: { len: R(10, 4000) } },
  saw: { pts: ['a', 'b'], uniform: { r: R(14, 60) } },
  crusher: {
    x: { w: R(HANDLE_RANGES.crusherW.min, HANDLE_RANGES.crusherW.max) },
    y: { travel: R(10, 4000) },
  },
  boulder: { pts: ['pts'], uniform: { r: R(8, 200) } },
  mace: { x: { arm: R(10, 2000) }, uniform: { r: R(10, 400) } },
  wheel: { uniform: { r: R(20, 2000) } },
  screw: { pts: ['a', 'b'], uniform: { cap: R(4, 400) } },
  conveyor: { pts: ['a', 'b'] },
  seesaw: { x: { len: R(10, 4000) } },
  bridge: { pts: ['a', 'b'] },
  catapult: { x: { len: R(HANDLE_RANGES.catapultLen.min, HANDLE_RANGES.catapultLen.max) } },
  flipper: { x: { len: R(10, 4000) } },
  sling: { uniform: { size: R(HANDLE_RANGES.slingSize.min, HANDLE_RANGES.slingSize.max) } },
  wind: { pts: ['a', 'b'] },
  magnet: { uniform: { r: R(40, 300) } },
  mud: { pts: ['a', 'b'] },
  geyser: { y: { h: R(50, 4000) } },
  trampoline: { x: { w: R(10, 2000) } },
  turnstile: { uniform: { r: R(10, 1000) } },
  // The drain hole grows with the bowl, so a resized vortex keeps its proportions.
  vortex: { uniform: { r: R(40, 1200), hole: R(16, 80) } },
  platform: {
    ptPairs: [['ax', 'ay'], ['bx', 'by']],
    x: { w: R(HANDLE_RANGES.platformW.min, HANDLE_RANGES.platformW.max) },
  },
};

/** The corner's opposite side: `box-nw` grabs min-x/min-y (so the anchor is max/max) — the id
 * letters are read in order ('n'/'s' is the y side at index 4, 'w'/'e' the x side). */
export function anchorFor(handleId: CornerHandleId, box: AnchorBox): { x: number; y: number } {
  const north = handleId[4] === 'n';
  const west = handleId[5] === 'w';
  return {
    x: west ? box.max.x : box.min.x,
    y: north ? box.max.y : box.min.y,
  };
}

const clampRange = (v: number, spec: RangeSpec): number =>
  Math.max(spec.min, spec.max === undefined ? v : Math.min(spec.max, v));

/**
 * The shared corner-resize. `to` is the (already grid-snapped, already un-mirrored) pointer, and
 * `anchor` is the DRAG-START selection box of the piece — giving every pointer position a stable
 * counterpart and keeping the far corner fixed while resizing. Types with no resizable field
 * (`FIXED_SIZE`) come back unchanged.
 */
export function applyCornerResize(piece: Piece, handleId: CornerHandleId, to: { x: number; y: number }, anchor: AnchorBox): Piece {
  const spec = RESIZE_SPECS[piece.t];
  const a = anchorFor(handleId, anchor);
  const boxW = Math.max(anchor.max.x - anchor.min.x, 1);
  const boxH = Math.max(anchor.max.y - anchor.min.y, 1);
  // Per-axis growth of the box measured from the pinned far corner, clamped so a piece can
  // neither invert nor explode in one drag frame.
  const sx = Math.min(20, Math.max(0.05, Math.abs(to.x - a.x) / boxW));
  const sy = Math.min(20, Math.max(0.05, Math.abs(to.y - a.y) / boxH));
  const su = (sx + sy) / 2;
  // Items with no size field of their own (fixed-size art, point items) scale as a whole via `sc`.
  if (!spec || FIXED_SIZE.includes(piece.t)) {
    const sc = Math.min(5, Math.max(0.2, (piece.sc ?? 1) * su));
    return { ...piece, sc: Math.round(sc * 1000) / 1000 };
  }

  const next = { ...piece } as Record<string, unknown>;
  const applyFields = (entries: Record<string, RangeSpec> | undefined, factor: number) => {
    if (!entries) return;
    for (const [field, range] of Object.entries(entries)) {
      const cur = (next as Record<string, number>)[field];
      if (typeof cur !== 'number') continue;
      (next as Record<string, number>)[field] = clampRange(cur * factor, range);
    }
  };
  applyFields(spec.x, sx);
  applyFields(spec.y, sy);
  applyFields(spec.uniform, su);

  if (spec.pts) {
    const scalePt = (pt: unknown): unknown =>
      Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number'
        ? [a.x + (pt[0] - a.x) * sx, a.y + (pt[1] - a.y) * sy]
        : pt;
    for (const key of spec.pts) {
      const v = next[key];
      if (Array.isArray(v) && typeof v[0] === 'number') next[key] = scalePt(v);
      else if (Array.isArray(v) && Array.isArray(v[0])) next[key] = (v as number[][]).map(scalePt);
    }
  }
  if (spec.ptPairs) {
    for (const [xf, yf] of spec.ptPairs) {
      const x = (next as Record<string, number>)[xf];
      const y = (next as Record<string, number>)[yf];
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      (next as Record<string, number>)[xf] = a.x + (x - a.x) * sx;
      (next as Record<string, number>)[yf] = a.y + (y - a.y) * sy;
    }
  }
  return next as unknown as Piece;
}
