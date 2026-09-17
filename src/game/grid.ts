// ══════════════════════════════════════════════════════════════════════════
// The start grid.
//
// Ten marbles across the track width: pole in the centre, the rest alternating
// outward, so P1 gets the cleanest line and P10 the widest. Pure geometry — no
// SDK, no DOM, no storage — which is WHY it lives here rather than in
// `season.ts`.
//
// `season.ts` boots the SDK (it saves through `storage.ts` → `RundotGameAPI`),
// and `engine.ts` needs this function. Keeping it in `season.ts` made the
// simulation's import tree pull the whole SDK in: a node test that so much as
// constructed a `Game` died on `window is not defined` before it ran a line.
// The season is a campaign; the grid is a line of marbles — only one of them
// needs an account.
// ══════════════════════════════════════════════════════════════════════════
import { W } from './track';

/**
 * Convert a grid order (P1..P10) into x positions on the start line: pole in
 * the centre, alternating outward.
 */
export function gridSlots(order: number[]): { id: number; x: number; slot: number }[] {
  const n = order.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: order[0], x: W / 2, slot: 1 }];
  const spacing = (W - 120) / (n - 1);
  const xs = Array.from({ length: n }, (_, i) => 60 + i * spacing);
  const byCenter = [...xs].sort((a, b) => Math.abs(a - W / 2) - Math.abs(b - W / 2));
  return order.map((id, i) => ({ id, x: byCenter[i], slot: i + 1 }));
}
