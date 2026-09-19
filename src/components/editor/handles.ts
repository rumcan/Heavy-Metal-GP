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
import { applyRotateHandle, hasFreeRotation, rotateHandlePoint } from './rotate';

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

/** World positions of every handle for `piece`. The first entry is always the "move" handle (centre). */
export function handlesFor(piece: Piece): Handle[] {
  const handles = baseHandles(piece);
  if (hasFreeRotation(piece)) {
    const r = rotateHandlePoint(piece);
    handles.push({ id: 'rot', x: r.x, y: r.y, cursor: 'grab', label: 'Rotate' });
  }
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
    case 'switch': {
      // Junction tip moves; blade length along its resting lean resizes.
      const lean = piece.side === 1 ? -piece.angle : piece.angle;
      const bx = piece.x + Math.sin(lean) * piece.len * 0.85;
      const by = piece.y - Math.cos(lean) * piece.len * 0.85;
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'len', x: bx, y: by, cursor: 'ew-resize', label: 'Blade length' },
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
      // Top moves; the deck handle sets the slam travel.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'travel', x: piece.x, y: piece.y + piece.travel + 44, cursor: 'ns-resize', label: 'Travel' },
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
    case 'cannon':
    case 'sling': {
      // Aim fan / facing are property fields; the collar drags as one point.
      return [{ id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' }];
    }
    case 'catapult': {
      // Pivot moves; the arm-end drag sets the length.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Pivot' },
        { id: 'len', x: piece.x + (piece.dir === 0 ? -1 : 1) * piece.len * 0.7, y: piece.y + piece.len * 0.7, cursor: 'ew-resize', label: 'Arm length' },
      ];
    }
    case 'flipper': {
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Pivot' },
        { id: 'len', x: piece.x + (piece.side === 0 ? 1 : -1) * piece.len, y: piece.y, cursor: 'ew-resize', label: 'Bat length' },
      ];
    }
    case 'scoop': {
      const out: Handle[] = [{ id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Pocket' }];
      if (piece.exit) out.push({ id: 'exit', x: piece.exit[0], y: piece.exit[1], cursor: 'crosshair', label: 'Subway exit' });
      return out;
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
    case 'pool': {
      const top = Math.min(piece.a[1], piece.b[1]);
      return [
        { id: 'move', x: (piece.a[0] + piece.b[0]) / 2, y: (piece.a[1] + piece.b[1]) / 2, cursor: 'move', label: 'Move' },
        { id: 'a', x: piece.a[0], y: piece.a[1], cursor: 'crosshair', label: 'Corner A' },
        { id: 'b', x: piece.b[0], y: piece.b[1], cursor: 'crosshair', label: 'Corner B' },
        { id: 'depth', x: piece.b[0], y: top + piece.depth, cursor: 'ns-resize', label: 'Depth' },
      ];
    }
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
    case 'platform':
      return [
        { id: 'move', x: (piece.ax + piece.bx) / 2, y: (piece.ay + piece.by) / 2, cursor: 'move', label: 'Move path' },
        { id: 'a', x: piece.ax, y: piece.ay, cursor: 'crosshair', label: 'End A' },
        { id: 'b', x: piece.bx, y: piece.by, cursor: 'crosshair', label: 'End B' },
      ];
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
export function applyHandle(piece: Piece, handleId: string, to: { x: number; y: number }, snap: boolean): Piece {
  // Handles of a flipped piece live in world space (see handlesFor); bring the pointer back into its stored space.
  if (piece.flip) to = { x: W - to.x, y: to.y };
  if (handleId === 'rot') return applyRotateHandle(piece, to, snap);
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
    case 'switch': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'len') {
        const dx = withSnap(to.x, sx) - piece.x;
        const dy = withSnap(to.y, sx) - piece.y;
        const len = Math.max(40, Math.min(400, Math.hypot(dx, dy) / 0.85));
        return { ...piece, len: clampNum(withSnap(len, sx), 40, 400) };
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
        const travel = Math.max(30, Math.min(600, withSnap(to.y, sx) - piece.y - 44));
        return { ...piece, travel: clampNum(withSnap(travel, sx), 30, 600) };
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
    case 'cannon':
    case 'sling': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      return piece;
    }
    case 'catapult': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'len') {
        const len = Math.max(120, Math.min(400, Math.hypot(withSnap(to.x, sx) - piece.x, to.y - piece.y) / 1.2));
        return { ...piece, len: clampNum(withSnap(len, sx), 120, 400) };
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
    case 'scoop': {
      if (handleId === 'move') return { ...piece, x: clampX(withSnap(to.x, sx)), y: withSnap(to.y, sx) };
      if (handleId === 'exit' && piece.exit) {
        return { ...piece, exit: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx), piece.exit[2]] as [number, number, number] };
      }
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
    case 'pool': {
      if (handleId === 'a') return { ...piece, a: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      if (handleId === 'b') return { ...piece, b: [clampX(withSnap(to.x, sx)), withSnap(to.y, sx)] as [number, number] };
      if (handleId === 'depth') {
        const top = Math.min(piece.a[1], piece.b[1]);
        const depth = Math.max(40, Math.min(300, withSnap(to.y, sx) - top));
        return { ...piece, depth: clampNum(withSnap(depth, sx), 40, 300) };
      }
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
      if (handleId === 'a') return { ...piece, ax: clampX(withSnap(to.x, sx)), ay: withSnap(to.y, sx) };
      if (handleId === 'b') return { ...piece, bx: clampX(withSnap(to.x, sx)), by: withSnap(to.y, sx) };
      const ddx = moveDelta(piece, to.x, (piece.ax + piece.bx) / 2, sx);
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
  const applied = fitGroupTranslation(pieces, dx) ?? dx;
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
    case 'switch':
      return { ...piece, x: mx(piece.x), side: piece.side === 1 ? 0 : 1 };
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
    case 'scoop':
      return {
        ...piece,
        x: mx(piece.x),
        deg: (180 - piece.deg + 360) % 360,
        ...(piece.exit ? { exit: [mx((piece.exit as [number, number, number])[0]), (piece.exit as [number, number, number])[1], (piece.exit as [number, number, number])[2]] as [number, number, number] } : {}),
      };
    case 'wind': {
      // Swap the ends and steer the blow like every other mirrored angle.
      const dir = ((180 - piece.dir) % 360 + 360) % 360;
      return { ...piece, a: [mx(piece.b[0]), piece.b[1]] as [number, number], b: [mx(piece.a[0]), piece.a[1]] as [number, number], dir };
    }
    case 'mud':
    case 'pool':
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
