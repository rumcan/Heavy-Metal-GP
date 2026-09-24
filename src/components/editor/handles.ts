/**
 * MB-03. Handles per piece type.
 *
 * Every piece exposes a small set of draggable points in world space.
 * Dragging a handle mutates that piece and no other state; the editor
 * pushes one undo entry at the start of the drag and replaces the def
 * on every move.  Multi-selected pieces are not handle-edited — the spec
 * calls handles "per piece type" and a multi-selection moves as a block
 * via body drag and nudge, which is how vector editors behave.
 *
 * Snap is applied in world units when the grid toggle is on (`SNAP = 25`).
 */
import type { Piece } from '../../game/trackdef';
import { SNAP } from './camera';
import { W } from '../../game/track';
import { clampDeltaToExtent, xExtent } from './extent';
import { fitGroupTranslation, translatePiece } from './translation';
import { applyRotateHandle } from './rotate';
import { applyCornerResize, HANDLE_RANGES } from './scale';
export { HANDLE_RANGES };
import type { CornerHandleId } from './scale';

export interface Handle {
  id: string;
  x: number;
  y: number;
  /** Cursor style while hovering / dragging this handle. */
  cursor: string;
  /** Short label for the tooltip / accessibility. */
  label: string;
}

const snapVal = (v: number) => Math.round(v / SNAP) * SNAP;
const clampX = (x: number) => Math.max(0, Math.min(W, x));
const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function withSnap(v: number, snap: boolean): number {
  return snap ? snapVal(v) : v;
}

/**
 * The delta a move-handle drag can actually apply: the piece slides as far as the wall allows and no
 * further, and every point travels that same distance (#71). Clamping the coordinates one by one
 * reshaped the piece instead — a ramp dragged into the left wall came back half as long.
 */
function moveDelta(piece: Piece, toX: number, anchorX: number, snap: boolean): number {
  return clampDeltaToExtent(xExtent(piece), withSnap(toX, snap) - anchorX);
}

/**
 * The size ranges a handle may drive.  These are the SAME bounds the settings panel offers and the
 * `TrackDef` schema accepts (`src/game/trackdef.ts`), and they are imported back by
 * `PropertiesPanel.tsx` so the three can never drift apart.
 *
 * The prompted timing fields a placement asks about (`trapdoor.open`, `crusher.period`, `boulder.rest`,
 * …) are #71's and live beside that path in `pieceSettings.ts` as `SETTING_RANGES`: those are the
 * numbers a player types, these are the numbers a drag owns. Both read the schema, neither copies it.
 */
// HANDLE_RANGES moved to scale.ts with the shared corner-resize model; re-exported above so the
// settings panel keeps importing it from here.

/** `Builder.crusher`'s plate height: the deck the width handle is measured across. */
export const CRUSHER_PLATE_H = 44;

/**
 * Catapult arm geometry, shared by the code that draws the length handle and the code that decodes a
 * drag of it — the bug this replaced was one formula each: the handle was drawn at `0.7 * len` on
 * both axes but read back as a radius divided by `1.2`, so grabbing it without moving it rewrote a
 * 230 arm as 189.74.
 *
 * `Builder.catapult` rests the arm at 135° for `dir` 0 and 45° for `dir` 1 in the piece's stored
 * space (`handlesFor` mirrors `flip` on top), and the handle hangs on that line at
 * `CATAPULT_ARM_SCALE` of the arm length — the diagonal of the offset it has always been drawn with.
 */
const CATAPULT_ARM_T = 0.7;
/** Radius multiplier of the drawn handle: the diagonal of its per-axis offset. */
export const CATAPULT_ARM_SCALE = Math.hypot(CATAPULT_ARM_T, CATAPULT_ARM_T);

export function catapultArmDir(piece: { dir: 0 | 1 }): readonly [number, number] {
  const restA = ((piece.dir === 0 ? 135 : 45) * Math.PI) / 180;
  return [Math.cos(restA), Math.sin(restA)];
}

/** Where the catapult's length handle is drawn (stored space, i.e. before the flip mirror). */
export function catapultArmHandle(piece: { x: number; y: number; len: number; dir: 0 | 1 }) {
  const [ux, uy] = catapultArmDir(piece);
  return { x: piece.x + ux * piece.len * CATAPULT_ARM_SCALE, y: piece.y + uy * piece.len * CATAPULT_ARM_SCALE };
}

// ── #99 Part 1: the shared item base ─────────────────────────────────────────────────────────
// Every placeable item, whatever its type, presents the same base controls on top of its own
// effect handles: a bounding box (drawn in EditorCanvas), four round corner resize dots, one
// rotate handle, a settings cog — only when the item has settings beyond its position — and a
// lock icon. Positions come from the piece's world-space visual bounds, so a flipped piece shows
// them exactly where it is drawn; drags are mirrored back into stored space before they are read
// (applyHandle already does that for every handle).

/** Ramp and wall are the only two types whose whole "settings" is their position/shape — every
 * other palette item has behaviour to configure, and so gets the cog. */
export function pieceHasSettings(t: Piece['t']): boolean {
  return t !== 'ramp' && t !== 'wall';
}

export interface SelectionBox {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

/** Above-the-box stalk height in world units (screen-space constant would need the camera). */
export const BASE_STALK = 25;

/** The shared base handles of the selected piece: rotate stalk above the box, the four corner
 * resize dots, the settings cog (items with settings only) and the lock icon. The bounding box
 * itself is a canvas stroke, not a handle. */
export function baseBoxHandles(piece: Piece, bounds: SelectionBox): Handle[] {
  const midX = (bounds.min.x + bounds.max.x) / 2;
  const top = bounds.min.y - BASE_STALK;
  const handles: Handle[] = [
    { id: 'box-rot', x: midX, y: top, cursor: 'grab', label: 'Rotate' },
    { id: 'box-nw', x: bounds.min.x, y: bounds.min.y, cursor: 'nwse-resize', label: 'Resize' },
    { id: 'box-ne', x: bounds.max.x, y: bounds.min.y, cursor: 'nesw-resize', label: 'Resize' },
    { id: 'box-sw', x: bounds.min.x, y: bounds.max.y, cursor: 'nesw-resize', label: 'Resize' },
    { id: 'box-se', x: bounds.max.x, y: bounds.max.y, cursor: 'nwse-resize', label: 'Resize' },
  ];
  if (pieceHasSettings(piece.t)) {
    handles.push({ id: 'settings', x: bounds.max.x + BASE_STALK, y: top, cursor: 'pointer', label: 'Settings' });
  }
  return handles;
}

/** Layer icons beside the selected box's right edge: bring to front (drawn over everything), send to back. */
export function orderHandlePoints(bounds: SelectionBox): { front: { x: number; y: number }; back: { x: number; y: number } } {
  const x = bounds.max.x + BASE_STALK;
  return { front: { x, y: bounds.min.y + 6 }, back: { x, y: bounds.min.y + 36 } };
}

/** Where a locked (or unlocked) piece carries its lock icon: above the box's top-left corner. */
export function lockHandlePoint(bounds: SelectionBox): { x: number; y: number } {
  return { x: bounds.min.x, y: bounds.min.y - BASE_STALK };
}

/** The inverse of `catapultArmHandle`: the arm length a pointer at `to` decodes to, before clamping. */
export function catapultLenAt(piece: { x: number; y: number; dir: 0 | 1 }, to: { x: number; y: number }) {
  const [ux, uy] = catapultArmDir(piece);
  // Project onto the arm line rather than taking a radial distance: pulling the handle along the arm
  // is what owns the length, and the projection is exactly the offset the handle was drawn with.
  return ((to.x - piece.x) * ux + (to.y - piece.y) * uy) / CATAPULT_ARM_SCALE;
}

/** Sling wedge: `Builder.sling` builds it entirely behind its anchor, opposite the kick normal. */
export function slingBackDir(piece: { facing: number }): readonly [number, number] {
  const fa = (piece.facing * Math.PI) / 180;
  return [-Math.cos(fa), -Math.sin(fa)];
}

/** World positions of every handle for `piece`. The first entry is always the "move" handle (centre).
 * #99: the old per-type rotate pads are gone — `box-rot` from `baseBoxHandles` is THE rotate
 * handle now (one for every item, always), and `applyHandle` routes it like the old `rot`. */
export function handlesFor(piece: Piece): Handle[] {
  const handles = baseHandles(piece);
  // A flipped piece (common in copies of calendar circuits) stores mirrored coordinates and is drawn at W - x:
  // put its handles where it is drawn, not where its numbers point.
  return piece.flip ? handles.map((h) => ({ ...h, x: W - h.x })) : handles;
}

/** The move handle (the piece's centre) without the rotate handle; `rotate.ts` builds on it. */
export function moveHandle(piece: Piece): Handle {
  return baseHandles(piece)[0];
}

function baseHandles(piece: Piece): Handle[] {
  switch (piece.t) {
    case 'ramp':
    case 'ice': {
      const [ax, ay] = piece.a;
      const [bx, by] = piece.b;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      return [
        { id: 'move', x: mx, y: my, cursor: 'move', label: 'Move' },
        { id: 'a', x: ax, y: ay, cursor: 'crosshair', label: 'Start' },
        { id: 'b', x: bx, y: by, cursor: 'crosshair', label: 'End' },
      ];
    }
    case 'curve': {
      const [ax, ay] = piece.a;
      const [cx, cy] = piece.c;
      const [bx, by] = piece.b;
      const mx = (ax + bx + cx) / 3;
      const my = (ay + by + cy) / 3;
      return [
        { id: 'move', x: mx, y: my, cursor: 'move', label: 'Move' },
        { id: 'a', x: ax, y: ay, cursor: 'crosshair', label: 'Start' },
        { id: 'c', x: cx, y: cy, cursor: 'crosshair', label: 'Control' },
        { id: 'b', x: bx, y: by, cursor: 'crosshair', label: 'End' },
      ];
    }
    case 'loop': {
      const cy = piece.bottom - piece.r;
      // Centre handle at the loop's centre, radius handle to the right of it.
      return [
        { id: 'move', x: piece.x, y: cy, cursor: 'move', label: 'Centre' },
        { id: 'r', x: piece.x + piece.r, y: cy, cursor: 'ew-resize', label: 'Radius' },
      ];
    }
    case 'hoop': {
      const mx = piece.x;
      const my = piece.y;
      const dirLen = 44;
      const dx = piece.dir[0];
      const dy = piece.dir[1];
      const m = Math.hypot(dx, dy) || 1;
      const nx = dx / m;
      const ny = dy / m;
      return [
        { id: 'move', x: mx, y: my, cursor: 'move', label: 'Move' },
        { id: 'dir', x: mx + nx * dirLen, y: my + ny * dirLen, cursor: 'crosshair', label: 'Direction' },
      ];
    }
    case 'wrecker': {
      const [px, py] = piece.pivot;
      // Ball position at rest energy (amp = 0) is directly below the pivot on screen (positive y = down? Actually track y grows downward, but the builder uses pivot + cos/sin with y = pivot.y + cos*chain (down). So still below.
      const bx = px + Math.sin(0) * piece.chain;
      const by = py + Math.cos(0) * piece.chain;
      const ampX = px + Math.sin(piece.amp) * piece.chain;
      const ampY = py + Math.cos(piece.amp) * piece.chain;
      return [
        { id: 'move', x: px, y: py, cursor: 'move', label: 'Pivot' },
        { id: 'chain', x: bx, y: by, cursor: 'ns-resize', label: 'Chain' },
        { id: 'amp', x: ampX, y: ampY, cursor: 'crosshair', label: 'Amplitude' },
      ];
    }
    case 'pad': {
      const dirX = piece.x + piece.dir * 36;
      const dirY = piece.y - 18;
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'w', x: piece.x + piece.w / 2, y: piece.y, cursor: 'ew-resize', label: 'Width' },
        { id: 'dir', x: dirX, y: dirY, cursor: 'crosshair', label: 'Direction' },
      ];
    }
    case 'boost': {
      const dx = piece.dir[0];
      const dy = piece.dir[1];
      const m = Math.hypot(dx, dy) || 1;
      const nx = dx / m;
      const ny = dy / m;
      const dirLen = 48;
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'dir', x: piece.x + nx * dirLen, y: piece.y + ny * dirLen, cursor: 'crosshair', label: 'Direction' },
        { id: 'len', x: piece.x + nx * (piece.len / 2), y: piece.y + ny * (piece.len / 2), cursor: 'ew-resize', label: 'Length' },
      ];
    }
    case 'spinner': {
      // Blade end to the right; centre is the move handle. Speed handle sits above/below centre.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'len', x: piece.x + piece.len / 2, y: piece.y, cursor: 'ew-resize', label: 'Length' },
        { id: 'speed', x: piece.x, y: piece.y + piece.speed * 600, cursor: 'ns-resize', label: 'Speed' },
      ];
    }
    case 'breakable':
    case 'wall':
    case 'block':
    // ---- MB-10A ----
    case 'barricade':
    case 'crumble': {
      // Rect centred at (x,y). Handles: centre moves, corner resizes.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'se', x: piece.x + piece.w / 2, y: piece.y + piece.h / 2, cursor: 'nwse-resize', label: 'Size' },
      ];
    }
    case 'trapdoor': {
      // The leaf is thin and hinged; thickness is fixed, so only the width is draggable.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'se', x: piece.x + piece.w / 2, y: piece.y + 7, cursor: 'ew-resize', label: 'Width' },
      ];
    }
    case 'tunnel': {
      // Entrance moves the whole pair; exit/arrow handles reshape the ride.
      const d = Math.hypot(piece.edir[0], piece.edir[1]) || 1;
      const ax = piece.exit[0] + (piece.edir[0] / d) * 56;
      const ay = piece.exit[1] + (piece.edir[1] / d) * 56;
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'exit', x: piece.exit[0], y: piece.exit[1], cursor: 'crosshair', label: 'Exit hole' },
        { id: 'dir', x: ax, y: ay, cursor: 'crosshair', label: 'Launch direction' },
      ];
    }
    // ---- MB-10B ----
    case 'blade': {
      // Pivot moves; the arc handle sits at the tip of the swing for amplitude.
      return [
        { id: 'move', x: piece.pivot[0], y: piece.pivot[1], cursor: 'move', label: 'Pivot' },
        { id: 'arc', x: piece.pivot[0] + Math.sin(piece.amp) * piece.len, y: piece.pivot[1] + Math.cos(piece.amp) * piece.len, cursor: 'crosshair', label: 'Swing' },
        { id: 'len', x: piece.pivot[0], y: piece.pivot[1] + piece.len, cursor: 'ns-resize', label: 'Arm length' },
      ];
    }
    case 'saw': {
      // Slot ends and radius (spin lives in the panel).
      return [
        { id: 'move', x: (piece.a[0] + piece.b[0]) / 2, y: (piece.a[1] + piece.b[1]) / 2, cursor: 'move', label: 'Move' },
        { id: 'a', x: piece.a[0], y: piece.a[1], cursor: 'crosshair', label: 'Slot start' },
        { id: 'b', x: piece.b[0], y: piece.b[1], cursor: 'crosshair', label: 'Slot end' },
        { id: 'r', x: piece.a[0] + piece.r, y: piece.a[1], cursor: 'ew-resize', label: 'Radius' },
      ];
    }
    case 'crusher': {
      // Top moves; the deck handle sets the slam travel; the plate-edge handle sets the plate width.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'travel', x: piece.x, y: piece.y + piece.travel + CRUSHER_PLATE_H, cursor: 'ns-resize', label: 'Travel' },
        { id: 'w', x: piece.x + piece.w / 2, y: piece.y + CRUSHER_PLATE_H / 2, cursor: 'ew-resize', label: 'Plate width' },
      ];
    }
    case 'boulder': {
      // Whole path moves from its midpoint; each waypoint drags.
      const mx = piece.pts.reduce((s, p) => s + p[0], 0) / piece.pts.length;
      const my = piece.pts.reduce((s, p) => s + p[1], 0) / piece.pts.length;
      const hs: Handle[] = [
        { id: 'move', x: mx, y: my, cursor: 'move', label: 'Move' },
        { id: 'r', x: piece.pts[0][0] + piece.r, y: piece.pts[0][1], cursor: 'ew-resize', label: 'Radius' },
        { id: `p${piece.pts.length - 1}`, x: piece.pts[piece.pts.length - 1][0], y: piece.pts[piece.pts.length - 1][1], cursor: 'crosshair', label: 'End' },
      ];
      for (let i = 0; i < piece.pts.length - 1; i++) {
        hs.push({ id: `p${i}`, x: piece.pts[i][0], y: piece.pts[i][1], cursor: 'crosshair', label: 'Waypoint' });
      }
      return hs;
    }
    case 'mace': {
      // Pivot moves; ball handle at the resting (straight-down) pose sets arm length.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Pivot' },
        { id: 'len', x: piece.x, y: piece.y + piece.arm + piece.r, cursor: 'ns-resize', label: 'Arm length' },
      ];
    }
    // ---- MB-10C: movers ----
    case 'wheel': {
      // Centre moves; rim handle sets radius; release marker points where buckets tip out.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Centre' },
        { id: 'r', x: piece.x + piece.r, y: piece.y, cursor: 'ew-resize', label: 'Radius' },
        { id: 'release', x: piece.x + Math.cos((piece.release * Math.PI) / 180) * piece.r, y: piece.y + Math.sin((piece.release * Math.PI) / 180) * piece.r, cursor: 'crosshair', label: 'Tip-out angle' },
      ];
    }
    case 'screw':
    case 'conveyor':
    case 'bridge': {
      // Two-point pieces: ends + shared middle drag.
      const p2 = piece as unknown as { a: readonly [number, number]; b: readonly [number, number] };
      const labels = piece.t === 'screw' ? ['Tube entry', 'Tube exit'] : piece.t === 'conveyor' ? ['Belt start', 'Belt end'] : ['Anchor A', 'Anchor B'];
      return [
        { id: 'move', x: (p2.a[0] + p2.b[0]) / 2, y: (p2.a[1] + p2.b[1]) / 2, cursor: 'move', label: 'Move' },
        { id: 'a', x: p2.a[0], y: p2.a[1], cursor: 'crosshair', label: labels[0] },
        { id: 'b', x: p2.b[0], y: p2.b[1], cursor: 'crosshair', label: labels[1] },
      ];
    }
    case 'seesaw': {
      // Pivot moves; the plank end sets the length.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Pivot' },
        { id: 'len', x: piece.x + piece.len / 2, y: piece.y, cursor: 'ew-resize', label: 'Plank length' },
      ];
    }
    // ---- MB-10D ----
    case 'cannon': {
      // Aim fan / power are property fields; the collar drags as one point.
      return [{ id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' }];
    }
    case 'sling': {
      // Anchor is the kick tip; the size handle sits one wedge behind it, so its distance reads the
      // wedge size directly and stays on the drawn triangle for a mirrored piece too.
      const [bx, by] = slingBackDir(piece);
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'size', x: piece.x + bx * piece.size, y: piece.y + by * piece.size, cursor: 'nwse-resize', label: 'Size' },
      ];
    }
    case 'catapult': {
      // Pivot moves; the arm-end drag sets the length, out along the resting arm it resizes.
      const arm = catapultArmHandle(piece);
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Pivot' },
        { id: 'len', x: arm.x, y: arm.y, cursor: 'ew-resize', label: 'Arm length' },
      ];
    }
    case 'flipper': {
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Pivot' },
        { id: 'len', x: piece.x + (piece.side === 0 ? 1 : -1) * piece.len, y: piece.y, cursor: 'ew-resize', label: 'Bat length' },
      ];
    }
    case 'sign': {
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'w', x: piece.x + piece.w / 2, y: piece.y, cursor: 'ew-resize', label: 'Width' },
      ];
    }
    case 'ring': {
      // Radius on the right of the plank's middle line; thickness on the plank's outer edge at the top.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'r', x: piece.x + piece.r, y: piece.y, cursor: 'ew-resize', label: 'Radius' },
        { id: 'thick', x: piece.x, y: piece.y - piece.r - piece.thick / 2, cursor: 'ns-resize', label: 'Thickness' },
      ];
    }
    case 'peg':
    case 'ppeg': {
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'r', x: piece.x + piece.r, y: piece.y, cursor: 'ew-resize', label: 'Radius' },
      ];
    }
    case 'itembox': {
      return [{ id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' }];
    }
    case 'bucket': {
      // Only y matters; pivot is centre-x. Handle at (W/2, y).
      return [{ id: 'move', x: W / 2, y: piece.y, cursor: 'ns-resize', label: 'Height' }];
    }
    // ---- MB-10E ----
    case 'wind': {
      const mx = (piece.a[0] + piece.b[0]) / 2, my = (piece.a[1] + piece.b[1]) / 2;
      const fa = (piece.dir * Math.PI) / 180;
      return [
        { id: 'move', x: mx, y: my, cursor: 'move', label: 'Move' },
        { id: 'a', x: piece.a[0], y: piece.a[1], cursor: 'crosshair', label: 'Corner A' },
        { id: 'b', x: piece.b[0], y: piece.b[1], cursor: 'crosshair', label: 'Corner B' },
        { id: 'dir', x: mx + Math.cos(fa) * 56, y: my + Math.sin(fa) * 56, cursor: 'crosshair', label: 'Blow direction' },
      ];
    }
    case 'magnet':
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'r', x: piece.x + piece.r, y: piece.y, cursor: 'ew-resize', label: 'Radius' },
      ];
    case 'mud':
      return [
        { id: 'move', x: (piece.a[0] + piece.b[0]) / 2, y: (piece.a[1] + piece.b[1]) / 2, cursor: 'move', label: 'Move' },
        { id: 'a', x: piece.a[0], y: piece.a[1], cursor: 'crosshair', label: 'Start' },
        { id: 'b', x: piece.b[0], y: piece.b[1], cursor: 'crosshair', label: 'End' },
      ];
    case 'trampoline':
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'w', x: piece.x + piece.w / 2, y: piece.y, cursor: 'ew-resize', label: 'Width' },
      ];
    case 'turnstile':
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'r', x: piece.x + piece.r, y: piece.y, cursor: 'ew-resize', label: 'Arm length' },
      ];
    case 'targets':
      return [{ id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' }];
    case 'vortex':
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'r', x: piece.x + piece.r, y: piece.y, cursor: 'ew-resize', label: 'Bowl radius' },
      ];
    case 'platform': {
      // The deck rides the path midpoint, so the width handle measures from there; ends stay separate.
      const mx = (piece.ax + piece.bx) / 2;
      const my = (piece.ay + piece.by) / 2;
      return [
        { id: 'move', x: mx, y: my, cursor: 'move', label: 'Move path' },
        { id: 'a', x: piece.ax, y: piece.ay, cursor: 'crosshair', label: 'End A' },
        { id: 'b', x: piece.bx, y: piece.by, cursor: 'crosshair', label: 'End B' },
        { id: 'w', x: mx + piece.w / 2, y: my, cursor: 'ew-resize', label: 'Deck width' },
      ];
    }
    case 'geyser':
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'h', x: piece.x, y: piece.y - piece.h, cursor: 'ns-resize', label: 'Blast height' },
      ];
  }
}

/**
 * Apply a handle drag.
 * `handleId` is one of the ids from `handlesFor(piece)` and `to` is the
 * new world position of that handle (already snapped if the grid is on).
 */
export interface ResizeAnchor {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

/**
 * Apply a handle drag.
 * `handleId` is one of the ids from `handlesFor(piece)` and `to` is the
 * new world position of that handle (already snapped if the grid is on).
 * `resizeAnchor` is the piece's selection box at the START of a base-handle drag (world space) —
 * the corner resize pins its far corner and needs that stable reference; without it (unit tests)
 * a 1-unit box around the piece centre is used so the behaviour stays pure.
 */
export function applyHandle(piece: Piece, handleId: string, to: { x: number; y: number }, snap: boolean, resizeAnchor?: ResizeAnchor): Piece {
  // Handles of a flipped piece live in world space (see handlesFor); bring the pointer back into its stored space.
  let hId = handleId;
  if (piece.flip) {
    to = { x: W - to.x, y: to.y };
    // The corner a flipped pointer grabs reads mirrored too: stored-space w ↔ world-space e.
    if (/^box-[ns][we]$/.test(hId)) hId = hId.replace(/w$/, 'W').replace(/e$/, 'w').replace(/W$/, 'e');
    if (resizeAnchor) {
      resizeAnchor = {
        min: { x: W - resizeAnchor.max.x, y: resizeAnchor.min.y },
        max: { x: W - resizeAnchor.min.x, y: resizeAnchor.max.y },
      };
    }
  }
  if (hId === 'rot' || hId === 'box-rot') return applyRotateHandle(piece, to, snap);
  if (/^box-[ns][we]$/.test(hId)) {
    const anchor: ResizeAnchor = resizeAnchor ?? (() => {
      // Fallback for direct calls: a degenerate box at the piece centre (uniform middle resize).
      return { min: { x: to.x, y: to.y }, max: { x: to.x, y: to.y } };
    })();
    return applyCornerResize(piece, hId as CornerHandleId, to, anchor);
  }
  handleId = hId;
  const sx = snap;
  switch (piece.t) {
    case 'ramp':
    case 'ice': {
      if (handleId === 'a') return { ...piece, a: [withSnap(to.x, sx), withSnap(to.y, sx)] };
      if (handleId === 'b') return { ...piece, b: [withSnap(to.x, sx), withSnap(to.y, sx)] };
      if (handleId === 'move') {
        const [ax, ay] = piece.a;
        const [bx, by] = piece.b;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const dx = moveDelta(piece, to.x, mx, sx);
        const dy = withSnap(to.y, sx) - my;
        return {
          ...piece,
          a: [ax + dx, ay + dy],
          b: [bx + dx, by + dy],
        };
      }
      return piece;
    }
    case 'curve': {
      if (handleId === 'a') return { ...piece, a: [withSnap(to.x, sx), withSnap(to.y, sx)] };
      if (handleId === 'c') return { ...piece, c: [withSnap(to.x, sx), withSnap(to.y, sx)] };
      if (handleId === 'b') return { ...piece, b: [withSnap(to.x, sx), withSnap(to.y, sx)] };
      if (handleId === 'move') {
        const [ax, ay] = piece.a;
        const [cx, cy] = piece.c;
        const [bx, by] = piece.b;
        const mx = (ax + bx + cx) / 3;
        const my = (ay + by + cy) / 3;
        const dx = moveDelta(piece, to.x, mx, sx);
        const dy = withSnap(to.y, sx) - my;
        return {
          ...piece,
          a: [ax + dx, ay + dy],
          c: [cx + dx, cy + dy],
          b: [bx + dx, by + dy],
        };
      }
      return piece;
    }
    case 'loop': {
      if (handleId === 'move') {
        const cy = piece.bottom - piece.r;
        const dx = withSnap(to.x, sx) - piece.x;
        const dy = withSnap(to.y, sx) - cy;
        const nx = clampX(piece.x + dx);
        const nb = piece.bottom + dy;
        return { ...piece, x: nx, bottom: nb };
      }
      if (handleId === 'r') {
        const cy = piece.bottom - piece.r;
        const nx = piece.x;
        const dx = withSnap(to.x, sx) - nx;
        const dy = withSnap(to.y, sx) - cy;
        const r = Math.max(40, Math.min(300, Math.hypot(dx, dy)));
        return { ...piece, r: clampNum(withSnap(r, sx), 40, 300) };
      }
      return piece;
    }
    case 'hoop': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'dir') {
        const dx = to.x - piece.x;
        const dy = to.y - piece.y;
        if (Math.hypot(dx, dy) < 4) return piece;
        const m = Math.hypot(dx, dy);
        return { ...piece, dir: [dx / m, dy / m] as [number, number] };
      }
      return piece;
    }
    case 'wrecker': {
      if (handleId === 'move') {
        const [px, py] = piece.pivot;
        const dx = withSnap(to.x, sx) - px;
        const dy = withSnap(to.y, sx) - py;
        return { ...piece, pivot: [clampX(px + dx), py + dy] };
      }
      if (handleId === 'chain') {
        const [px, py] = piece.pivot;
        const dx = withSnap(to.x, sx) - px;
        const dy = withSnap(to.y, sx) - py;
        const chain = Math.max(8, Math.min(2000, Math.hypot(dx, dy)));
        return { ...piece, chain: clampNum(withSnap(chain, sx), 8, 2000) };
      }
      if (handleId === 'amp') {
        const [px, py] = piece.pivot;
        const dx = to.x - px;
        const dy = to.y - py;
        // Amplitude is the angle from vertical. Compute from the dragged arc point relative to pivot.
        // dy = cos(amp)*chain, dx = sin(amp)*chain => amp = atan2(dx, dy)
        const amp = Math.abs(Math.atan2(dx, dy));
        const clamped = Math.max(0.05, Math.min(Math.PI / 2 - 0.01, amp));
        return { ...piece, amp: clamped };
      }
      return piece;
    }
    case 'pad': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'w') {
        const w = Math.max(8, Math.min(W, Math.abs(withSnap(to.x, sx) - piece.x) * 2));
        return { ...piece, w: sx ? snapVal(w) : w };
      }
      if (handleId === 'dir') {
        // Flip direction based on which side of the pad the handle is dropped on.
        return { ...piece, dir: to.x < piece.x ? (-1 as const) : (1 as const) };
      }
      return piece;
    }
    case 'boost': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'dir') {
        const dx = to.x - piece.x;
        const dy = to.y - piece.y;
        if (Math.hypot(dx, dy) < 4) return piece;
        const m = Math.hypot(dx, dy);
        return { ...piece, dir: [dx / m, dy / m] as [number, number] };
      }
      if (handleId === 'len') {
        // Project handle offset onto direction to change length.
        const dx = withSnap(to.x, sx) - piece.x;
        const dy = withSnap(to.y, sx) - piece.y;
        const dirX = piece.dir[0];
        const dirY = piece.dir[1];
        const m = Math.hypot(dirX, dirY) || 1;
        const nx = dirX / m;
        const ny = dirY / m;
        const proj = dx * nx + dy * ny;
        const len = Math.max(8, Math.min(4000, proj * 2));
        return { ...piece, len: clampNum(withSnap(len, sx), 8, 4000) };
      }
      return piece;
    }
    case 'spinner': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'len') {
        const dx = withSnap(to.x, sx) - piece.x;
        const len = Math.max(20, Math.min(W, Math.abs(dx) * 2));
        return { ...piece, len: sx ? snapVal(len) : len };
      }
      if (handleId === 'speed') {
        const dy = to.y - piece.y;
        // Map vertical offset to speed: 600 world units = 1.0 speed. Clamp like properties panel.
        const raw = dy / 600;
        const speed = Math.max(-0.5, Math.min(0.5, raw));
        // Snap rounds to nearest 0.05 when grid is on (matches panel step *2)
        const snapped = sx ? Math.round(speed * 20) / 20 : speed;
        return { ...piece, speed: snapped };
      }
      return piece;
    }
    case 'breakable':
    case 'wall':
    case 'block':
    // ---- MB-10A ----
    case 'barricade':
    case 'crumble': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'se') {
        const nx = withSnap(to.x, sx);
        const ny = withSnap(to.y, sx);
        const w = Math.max(8, Math.min(W, Math.abs(nx - piece.x) * 2));
        const h = Math.max(8, Math.min(4000, Math.abs(ny - piece.y) * 2));
        return { ...piece, w: sx ? snapVal(w) : w, h: sx ? snapVal(h) : h };
      }
      return piece;
    }
    case 'trapdoor': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'se') {
        // A trapdoor's thickness is fixed — the corner handle only sets the leaf width.
        const w = Math.max(40, Math.min(W, Math.abs(withSnap(to.x, sx) - piece.x) * 2));
        return { ...piece, w: sx ? snapVal(w) : w };
      }
      return piece;
    }
    case 'tunnel': {
      if (handleId === 'move') {
        // Entrance and exit travel together: the pair is measured as one, so the ride keeps its run.
        const dx = moveDelta(piece, to.x, piece.x, sx);
        const dy = withSnap(to.y, sx) - piece.y;
        return { ...piece, x: piece.x + dx, y: piece.y + dy, exit: [piece.exit[0] + dx, piece.exit[1] + dy] as [number, number] };
      }
      if (handleId === 'exit') {
        return { ...piece, exit: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      }
      if (handleId === 'dir') {
        const dx = to.x - piece.exit[0];
        const dy = to.y - piece.exit[1];
        const m = Math.hypot(dx, dy);
        if (m < 4) return piece;
        return { ...piece, edir: [dx / m, dy / m] as [number, number] };
      }
      return piece;
    }
    // ---- MB-10B ----
    case 'blade': {
      if (handleId === 'move') return { ...piece, pivot: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      if (handleId === 'arc') {
        const dx = to.x - piece.pivot[0];
        const dy = to.y - piece.pivot[1];
        const amp = Math.max(0.1, Math.min(1.5, Math.atan2(dx, dy)));
        return { ...piece, amp };
      }
      if (handleId === 'len') {
        const dy = withSnap(to.y, sx) - piece.pivot[1];
        const len = Math.max(60, Math.min(600, dy));
        return { ...piece, len: clampNum(withSnap(len, sx), 60, 600) };
      }
      return piece;
    }
    case 'saw': {
      if (handleId === 'move') {
        const cx = (piece.a[0] + piece.b[0]) / 2;
        const cy = (piece.a[1] + piece.b[1]) / 2;
        const dx = moveDelta(piece, to.x, cx, sx);
        const dy = withSnap(to.y, sx) - cy;
        return {
          ...piece,
          a: [piece.a[0] + dx, piece.a[1] + dy] as [number, number],
          b: [piece.b[0] + dx, piece.b[1] + dy] as [number, number],
        };
      }
      if (handleId === 'a') return { ...piece, a: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      if (handleId === 'b') return { ...piece, b: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      if (handleId === 'r') {
        const r = Math.max(14, Math.min(60, Math.abs(withSnap(to.x, sx) - piece.a[0])));
        return { ...piece, r: clampNum(withSnap(r, sx), 14, 60) };
      }
      return piece;
    }
    case 'crusher': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'travel') {
        const travel = Math.max(30, Math.min(600, withSnap(to.y, sx) - piece.y - CRUSHER_PLATE_H));
        return { ...piece, travel: clampNum(withSnap(travel, sx), 30, 600) };
      }
      if (handleId === 'w') {
        // The plate is an axis-aligned box centred on x, so the handle's distance from the centre
        // is half the width. Snap the width, not the pointer.
        const w = Math.abs(to.x - piece.x) * 2;
        const { min, max } = HANDLE_RANGES.crusherW;
        return { ...piece, w: clampNum(withSnap(w, sx), min, max) };
      }
      return piece;
    }
    case 'boulder': {
      if (handleId === 'r') return { ...piece, r: clampNum(withSnap(Math.abs(to.x - piece.pts[0][0]), sx), 12, 60) };
      if (handleId === 'move') {
        const mx = piece.pts.reduce((s, p) => s + p[0], 0) / piece.pts.length;
        const my = piece.pts.reduce((s, p) => s + p[1], 0) / piece.pts.length;
        const dx = moveDelta(piece, to.x, mx, sx);
        const dy = withSnap(to.y, sx) - my;
        return { ...piece, pts: piece.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
      }
      if (/^p\d+$/.test(handleId)) {
        const i = Number(handleId.slice(1));
        if (i >= 0 && i < piece.pts.length) {
          const pts = piece.pts.map((p, k) => (k === i ? ([clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number]) : p));
          return { ...piece, pts };
        }
      }
      return piece;
    }
    case 'mace': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'len') {
        const arm = Math.max(60, Math.min(400, withSnap(to.y, sx) - piece.y - piece.r));
        return { ...piece, arm: clampNum(withSnap(arm, sx), 60, 400) };
      }
      return piece;
    }
    // ---- MB-10C ----
    case 'wheel': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'r') {
        const r = Math.max(60, Math.min(200, Math.abs(withSnap(to.x, sx) - piece.x)));
        return { ...piece, r: clampNum(withSnap(r, sx), 60, 200) };
      }
      if (handleId === 'release') {
        // tip-out marker drags around the rim: angle from pivot to pointer
        const deg = ((Math.atan2(to.y - piece.y, to.x - piece.x) * 180) / Math.PI + 360) % 360;
        const release = Math.max(20, Math.min(340, Math.round(deg)));
        return { ...piece, release };
      }
      return piece;
    }
    case 'screw':
    case 'conveyor':
    case 'bridge': {
      const span = { x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (piece.t === 'screw' && (handleId === 'a' || handleId === 'b')) {
        const other = handleId === 'a' ? piece.b : piece.a;
        if (Math.hypot(clampX(span.x) - other[0], span.y - other[1]) < 1) return piece;
      }
      if (handleId === 'move') {
        const mx = (piece.a[0] + piece.b[0]) / 2;
        const my = (piece.a[1] + piece.b[1]) / 2;
        const dx = moveDelta(piece, to.x, mx, sx);
        const dy = span.y - my;
        return {
          ...piece,
          a: [piece.a[0] + dx, piece.a[1] + dy] as [number, number],
          b: [piece.b[0] + dx, piece.b[1] + dy] as [number, number],
        };
      }
      if (handleId === 'a') return { ...piece, a: [clampX(span.x), span.y] as [number, number] };
      if (handleId === 'b') return { ...piece, b: [clampX(span.x), span.y] as [number, number] };
      return piece;
    }
    case 'seesaw': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'len') {
        const len = Math.max(140, Math.min(420, Math.abs(withSnap(to.x, sx) - piece.x) * 2));
        return { ...piece, len: clampNum(withSnap(len, sx), 140, 420) };
      }
      return piece;
    }
    // ---- MB-10D ----
    case 'cannon': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      return piece;
    }
    case 'sling': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'size') {
        // The handle is one `size` out from the anchor, so the distance decodes 1:1. Snap the size
        // itself — snapping the pointer first would move it off the wedge's back line.
        const size = Math.hypot(to.x - piece.x, to.y - piece.y);
        const { min, max } = HANDLE_RANGES.slingSize;
        return { ...piece, size: clampNum(withSnap(size, sx), min, max) };
      }
      return piece;
    }
    case 'catapult': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'len') {
        // Undo the shared arm offset (see `catapultArmHandle`) and snap the length it decodes to,
        // never the pointer first — that is what made an unmoved handle jump the arm.
        const len = catapultLenAt(piece, to);
        const { min, max } = HANDLE_RANGES.catapultLen;
        return { ...piece, len: clampNum(withSnap(len, sx), min, max) };
      }
      return piece;
    }
    case 'flipper': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'len') {
        const len = Math.max(70, Math.min(180, Math.abs(withSnap(to.x, sx) - piece.x)));
        return { ...piece, len: clampNum(withSnap(len, sx), 70, 180) };
      }
      return piece;
    }
    case 'sign': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'w') return { ...piece, w: clampNum(Math.round(Math.abs(withSnap(to.x, sx) - piece.x) * 2), 60, 600) };
      return piece;
    }
    case 'ring': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      const d = Math.hypot(to.x - piece.x, to.y - piece.y);
      if (handleId === 'r') return { ...piece, r: clampNum(withSnap(d, sx), 30, 1200) };
      if (handleId === 'thick') return { ...piece, thick: clampNum(Math.round(Math.abs(d - piece.r) * 2), 8, 80) };
      return piece;
    }
    case 'peg': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'r') {
        const dx = withSnap(to.x, sx) - piece.x;
        const r = Math.max(2, Math.min(100, Math.abs(dx)));
        return { ...piece, r: clampNum(withSnap(r, sx), 2, 100) };
      }
      return piece;
    }
    case 'ppeg': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'r') {
        const dx = withSnap(to.x, sx) - piece.x;
        const r = Math.max(2, Math.min(100, Math.abs(dx)));
        return { ...piece, r: clampNum(withSnap(r, sx), 2, 100) };
      }
      return piece;
    }
    case 'itembox': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      return piece;
    }
    case 'bucket': {
      if (handleId === 'move') return { ...piece, y: withSnap(to.y, sx) };
      return piece;
    }
    // ---- MB-10E ----
    case 'wind': {
      if (handleId === 'a') return { ...piece, a: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      if (handleId === 'b') return { ...piece, b: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      if (handleId === 'dir') {
        const mx = (piece.a[0] + piece.b[0]) / 2, my = (piece.a[1] + piece.b[1]) / 2;
        const deg = ((Math.round((Math.atan2(to.y - my, to.x - mx) * 180) / Math.PI) % 360) + 360) % 360;
        return { ...piece, dir: deg };
      }
      const ddx = moveDelta(piece, to.x, (piece.a[0] + piece.b[0]) / 2, sx);
      const ddy = withSnap(to.y, sx) - (piece.a[1] + piece.b[1]) / 2;
      return { ...piece, a: [piece.a[0] + ddx, piece.a[1] + ddy], b: [piece.b[0] + ddx, piece.b[1] + ddy] };
    }
    case 'magnet': {
      if (handleId === 'r') {
        const r = Math.max(40, Math.min(400, Math.abs(withSnap(to.x, sx) - piece.x)));
        return { ...piece, r: clampNum(withSnap(r, sx), 40, 400) };
      }
      return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
    }
    case 'mud': {
      if (handleId === 'a') return { ...piece, a: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      if (handleId === 'b') return { ...piece, b: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      const ddx = moveDelta(piece, to.x, (piece.a[0] + piece.b[0]) / 2, sx);
      const ddy = withSnap(to.y, sx) - (piece.a[1] + piece.b[1]) / 2;
      return { ...piece, a: [piece.a[0] + ddx, piece.a[1] + ddy], b: [piece.b[0] + ddx, piece.b[1] + ddy] };
    }
    case 'trampoline': {
      if (handleId === 'w') return { ...piece, w: clampNum(Math.abs(withSnap(to.x, sx) - piece.x) * 2, 60, 400) };
      return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
    }
    case 'turnstile': {
      if (handleId === 'r') return { ...piece, r: clampNum(Math.abs(withSnap(to.x, sx) - piece.x), 30, 160) };
      return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
    }
    case 'targets':
      return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
    case 'vortex': {
      if (handleId === 'r') return { ...piece, r: clampNum(Math.abs(withSnap(to.x, sx) - piece.x), 60, 300) };
      return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
    }
    case 'platform': {
      const mx = (piece.ax + piece.bx) / 2;
      if (handleId === 'a') return { ...piece, ax: clampX(withSnap(to.x, sx)), ay: withSnap(to.y, sx) };
      if (handleId === 'b') return { ...piece, bx: clampX(withSnap(to.x, sx)), by: withSnap(to.y, sx) };
      if (handleId === 'w') {
        // `Builder.platform` builds an axis-aligned deck of `w` centred on the path midpoint, so the
        // handle reads as twice its distance from that midpoint. The route (a/b) stays its own control.
        const w = Math.abs(to.x - mx) * 2;
        const { min, max } = HANDLE_RANGES.platformW;
        return { ...piece, w: clampNum(withSnap(w, sx), min, max) };
      }
      const ddx = moveDelta(piece, to.x, mx, sx);
      const ddy = withSnap(to.y, sx) - (piece.ay + piece.by) / 2;
      return { ...piece, ax: piece.ax + ddx, ay: piece.ay + ddy, bx: piece.bx + ddx, by: piece.by + ddy };
    }
    case 'geyser': {
      if (handleId === 'h') {
        const h = Math.max(80, Math.min(600, piece.y - withSnap(to.y, sx)));
        return { ...piece, h: clampNum(withSnap(h, sx), 80, 600) };
      }
      return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
    }
  }
}

/**
 * Apply a translation delta to a piece (move as a block).
 *
 * The delta is measured against the piece's whole extent and cut back there, so a piece pushed
 * towards a wall stops at it intact: clamping each coordinate on its own used to shorten a ramp
 * from 300 to 100 and, pushed far enough, collapse it to nothing (#71). Moving never reshapes —
 * that is what the endpoint handles are for.
 */
export function movePiece(piece: Piece, dx: number, dy: number): Piece {
  return translatePiece(piece, fitGroupTranslation([piece], dx) ?? dx, dy);
}

/**
 * Move several pieces as one block. The delta is measured against the group's *combined* extent, so
 * the selection stops at the wall together and the spacing between its pieces survives (#71); with a
 * per-piece clamp, the piece nearest the wall stopped while the others slid on and sheared the group.
 */
export function movePieces(pieces: readonly Piece[], dx: number, dy: number): Piece[] {
  // Contradictory limits mean something is already out of range: keep the shapes and let validation
  // report it rather than quietly reshaping the group.
  // A selection of several items (a built section) may run into the side walls, as rails built into the
  // cliff do: it gets the maps' full margin past each edge. A single item still stops at the wall.
  const applied = fitGroupTranslation(pieces, dx, pieces.length > 1) ?? dx;
  return pieces.map((piece) => translatePiece(piece, applied, dy));
}

/** Mirror a piece horizontally about the centre line (x → W - x, dir.x → -dir.x, flip toggle). */
export function mirrorPiece(piece: Piece): Piece {
  // For authored pieces (no flip) mirroring is x → W - x.
  // For pieces that already carry a flip flag, we keep coordinates and toggle the flag — both describe the same world mirror
  // and the validation layer allows either.  We choose to keep the numeric fields mirrored in place and toggle flip when present,
  // otherwise we mirror coordinates directly.  This keeps the editor's numbers readable (the world x is where you see it).
  const mx = (x: number) => W - x;
  switch (piece.t) {
    case 'ramp':
    case 'ice':
      return { ...piece, a: [mx(piece.a[0]), piece.a[1]], b: [mx(piece.b[0]), piece.b[1]], flip: piece.flip ? undefined : undefined };
    case 'curve':
      return { ...piece, a: [mx(piece.a[0]), piece.a[1]], c: [mx(piece.c[0]), piece.c[1]], b: [mx(piece.b[0]), piece.b[1]] };
    case 'loop':
      return { ...piece, x: mx(piece.x) };
    case 'hoop':
      return { ...piece, x: mx(piece.x), dir: [-piece.dir[0], piece.dir[1]] as [number, number] };
    case 'wrecker':
      return { ...piece, pivot: [mx(piece.pivot[0]), piece.pivot[1]] };
    case 'pad':
      return { ...piece, x: mx(piece.x), dir: piece.dir === 1 ? -1 : 1 } as Piece;
    case 'boost':
      return { ...piece, x: mx(piece.x), dir: [-piece.dir[0], piece.dir[1]] as [number, number] };
    case 'spinner':
      return { ...piece, x: mx(piece.x), speed: -piece.speed };
    case 'breakable':
    case 'wall':
    case 'block':
    // ---- MB-10A ----
    case 'barricade':
    case 'crumble':
      return { ...piece, x: mx(piece.x) };
    case 'trapdoor':
      // Mirroring moves the hinge to the other side of the leaf.
      return { ...piece, x: mx(piece.x), hinge: piece.hinge === 1 ? -1 : 1 };
    case 'tunnel':
      return { ...piece, x: mx(piece.x), exit: [mx(piece.exit[0]), piece.exit[1]] as [number, number], edir: [-piece.edir[0], piece.edir[1]] as [number, number] };
    // ---- MB-10B ----
    case 'blade':
      return { ...piece, pivot: [mx(piece.pivot[0]), piece.pivot[1]] };
    case 'saw':
      return { ...piece, a: [mx(piece.a[0]), piece.a[1]] as [number, number], b: [mx(piece.b[0]), piece.b[1]] as [number, number] };
    case 'crusher':
    case 'mace':
      return { ...piece, x: mx(piece.x) };
    case 'boulder':
      return { ...piece, pts: piece.pts.map(([x, y]) => [mx(x), y] as [number, number]) };
    case 'peg':
    case 'ppeg':
    case 'ring':
    case 'sign':
      return { ...piece, x: mx(piece.x) };
    case 'itembox':
      return { ...piece, x: mx(piece.x) };
    // ---- MB-10C ----
    case 'wheel':
      // Mirroring flips the spin sense so the ride direction survives the course mirror.
      return { ...piece, x: mx((piece as unknown as { x: number }).x), dir: (piece.t === 'wheel' ? (piece.dir === 1 ? 0 : 1) : 0) } as Piece;
    case 'seesaw':
      return { ...piece, x: mx((piece as unknown as { x: number }).x) } as Piece;
    // ---- MB-10D ----
    case 'cannon': {
      // The whole aim fan maps θ → 180−θ, swapping the range ends.
      return { ...piece, x: mx(piece.x), aimMin: (180 - piece.aimMax + 360) % 360, aimMax: (180 - piece.aimMin + 360) % 360 };
    }
    case 'catapult':
      // Mirroring flips the throw sense, like the wheel's spin.
      return { ...piece, x: mx((piece as unknown as { x: number }).x), dir: (piece.dir === 1 ? 0 : 1) } as Piece;
    case 'flipper':
      return { ...piece, x: mx((piece as unknown as { x: number }).x), side: (piece.side === 1 ? 0 : 1) } as Piece;
    case 'sling':
      return { ...piece, x: mx(piece.x), facing: (180 - piece.facing + 360) % 360 };
    case 'wind': {
      // Swap the ends and steer the blow like every other mirrored angle.
      const dir = ((180 - piece.dir) % 360 + 360) % 360;
      return { ...piece, a: [mx(piece.b[0]), piece.b[1]] as [number, number], b: [mx(piece.a[0]), piece.a[1]] as [number, number], dir };
    }
    case 'mud':
      return {
        ...piece,
        a: [mx(piece.b[0]), piece.b[1]] as [number, number],
        b: [mx(piece.a[0]), piece.a[1]] as [number, number],
      } as Piece;
    case 'magnet':
    case 'geyser':
    case 'trampoline':
    case 'turnstile':
    case 'targets':
    case 'vortex':
      return { ...piece, x: mx(piece.x) } as Piece;
    case 'platform':
      return { ...piece, ax: mx(piece.bx), ay: piece.by, bx: mx(piece.ax), by: piece.ay } as Piece;
    case 'screw':
      // The entrance must stay the entrance: swapping ends reverses the lift.
      return { ...piece, a: [mx(piece.a[0]), piece.a[1]], b: [mx(piece.b[0]), piece.b[1]] };
    case 'conveyor':
      // Surface tangents are ordered left-to-right, so the belt sense must flip too.
      return { ...piece, a: [mx(piece.b[0]), piece.b[1]], b: [mx(piece.a[0]), piece.a[1]], dir: piece.dir === 0 ? 1 : 0 };
    case 'bridge': {
      // The bridge has interchangeable anchors.
      const p2 = piece as unknown as { a: readonly [number, number]; b: readonly [number, number] };
      return {
        ...piece,
        a: [mx(p2.b[0]), p2.b[1]] as [number, number],
        b: [mx(p2.a[0]), p2.a[1]] as [number, number],
      } as Piece;
    }
    case 'bucket':
      // Bucket is always centred horizontally — nothing to mirror.
      return piece;
  }
}
