// Piece order is depth: pieces draw in list order (a later one covers the earlier ones), and where tracks cross the
// later one is in front. These helpers reorder a def's pieces and say where every old index went.
import type { Piece } from '../../game/trackdef';

/** Move the pieces at `indices` to the end (in their current order): they come to the front. */
export function toFront(pieces: readonly Piece[], indices: readonly number[]): { pieces: Piece[]; newIndex: Map<number, number> } {
  const moving = new Set(indices);
  const order = [...pieces.keys()].filter((i) => !moving.has(i)).concat([...moving].sort((a, b) => a - b));
  return { pieces: order.map((i) => pieces[i]), newIndex: new Map(order.map((old, i) => [old, i])) };
}

/** Move piece `from` to sit just above (dir 1) or just below (dir -1) piece `past`. */
export function movePast(pieces: readonly Piece[], from: number, past: number, dir: 1 | -1): { pieces: Piece[]; newIndex: Map<number, number> } {
  const order = [...pieces.keys()].filter((i) => i !== from);
  const at = order.indexOf(past);
  order.splice(dir === 1 ? at + 1 : at, 0, from);
  return { pieces: order.map((i) => pieces[i]), newIndex: new Map(order.map((old, i) => [old, i])) };
}
