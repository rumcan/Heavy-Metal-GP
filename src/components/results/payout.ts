/** Eight audible steps per line, then the next line. Points never enter the CR total. */
export const PAYOUT_TICK_MS = 80;
export const PAYOUT_LINE_MS = PAYOUT_TICK_MS * 8;

export function payoutFrame(targets: readonly number[], elapsed: number): { values: number[]; active: number; done: boolean } {
  const at = Math.max(0, elapsed);
  const active = Math.min(targets.length, Math.floor(at / PAYOUT_LINE_MS));
  const fraction = Math.floor((at % PAYOUT_LINE_MS) / PAYOUT_TICK_MS) / 8;
  return {
    values: targets.map((value, i) => i < active ? value : i === active ? Math.floor(value * fraction) : 0),
    active,
    done: active === targets.length,
  };
}
