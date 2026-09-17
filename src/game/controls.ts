/** Steering from the held controls: touch wins, else right minus left. -1 … 0 … +1. */
export function nudgeOf(controls: { left: boolean; right: boolean; touch: number }): number {
  return controls.touch || Number(controls.right) - Number(controls.left);
}
