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

function withSnap(v: number, snap: boolean): number {
  return snap ? snapVal(v) : v;
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
    case 'block': {
      // Rect centred at (x,y). Handles: centre moves, corners resize.
      return [
        { id: 'move', x: piece.x, y: piece.y, cursor: 'move', label: 'Move' },
        { id: 'se', x: piece.x + piece.w / 2, y: piece.y + piece.h / 2, cursor: 'nwse-resize', label: 'Size' },
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
        const dx = withSnap(to.x, sx) - mx;
        const dy = withSnap(to.y, sx) - my;
        return {
          ...piece,
          a: [clampX(ax + dx), ay + dy],
          b: [clampX(bx + dx), by + dy],
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
        const dx = withSnap(to.x, sx) - mx;
        const dy = withSnap(to.y, sx) - my;
        return {
          ...piece,
          a: [clampX(ax + dx), ay + dy],
          c: [clampX(cx + dx), cy + dy],
          b: [clampX(bx + dx), by + dy],
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
        return { ...piece, r: sx ? snapVal(r) : r };
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
        return { ...piece, chain: sx ? snapVal(chain) : chain };
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
        return { ...piece, len: sx ? snapVal(len) : len };
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
    case 'block': {
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
    case 'peg': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'r') {
        const dx = withSnap(to.x, sx) - piece.x;
        const r = Math.max(2, Math.min(100, Math.abs(dx)));
        return { ...piece, r: sx ? snapVal(r) : r };
      }
      return piece;
    }
    case 'ppeg': {
      if (handleId === 'move') return { ...piece, x: withSnap(to.x, sx), y: withSnap(to.y, sx) };
      if (handleId === 'r') {
        const dx = withSnap(to.x, sx) - piece.x;
        const r = Math.max(2, Math.min(100, Math.abs(dx)));
        return { ...piece, r: sx ? snapVal(r) : r };
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
  }
}

/** Apply a translation delta to a piece (move as a block). */
export function movePiece(piece: Piece, dx: number, dy: number): Piece {
  // A flipped piece is drawn mirrored, so moving it right on screen means moving its stored x left.
  if (piece.flip) dx = -dx;
  switch (piece.t) {
    case 'ramp':
    case 'ice':
      return { ...piece, a: [clampX(piece.a[0] + dx), piece.a[1] + dy], b: [clampX(piece.b[0] + dx), piece.b[1] + dy] };
    case 'curve':
      return {
        ...piece,
        a: [clampX(piece.a[0] + dx), piece.a[1] + dy],
        c: [clampX(piece.c[0] + dx), piece.c[1] + dy],
        b: [clampX(piece.b[0] + dx), piece.b[1] + dy],
      };
    case 'loop':
      return { ...piece, x: clampX(piece.x + dx), bottom: piece.bottom + dy };
    case 'hoop':
      return { ...piece, x: clampX(piece.x + dx), y: piece.y + dy };
    case 'wrecker':
      return { ...piece, pivot: [clampX(piece.pivot[0] + dx), piece.pivot[1] + dy] };
    case 'pad':
      return { ...piece, x: clampX(piece.x + dx), y: piece.y + dy };
    case 'boost':
      return { ...piece, x: clampX(piece.x + dx), y: piece.y + dy };
    case 'spinner':
      return { ...piece, x: clampX(piece.x + dx), y: piece.y + dy };
    case 'breakable':
    case 'wall':
    case 'block':
      return { ...piece, x: clampX(piece.x + dx), y: piece.y + dy };
    case 'peg':
    case 'ppeg':
      return { ...piece, x: clampX(piece.x + dx), y: piece.y + dy };
    case 'itembox':
      return { ...piece, x: clampX(piece.x + dx), y: piece.y + dy };
    case 'bucket':
      return { ...piece, y: piece.y + dy };
  }
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
      return { ...piece, x: mx(piece.x) };
    case 'peg':
    case 'ppeg':
      return { ...piece, x: mx(piece.x) };
    case 'itembox':
      return { ...piece, x: mx(piece.x) };
    case 'bucket':
      // Bucket is always centred horizontally — nothing to mirror.
      return piece;
  }
}
