// P2-07: who the race camera follows once the player is out. Knocked out by a rival: that rival for a few seconds
// (watch who did it), then the leader. Knocked out by a hazard, or classified out as a straggler: the leader at once.
// Pure: the race screen hands it the facts every frame.

/** How long the camera stays on the marble that knocked you out. */
export const SPECTATE_KILLER_MS = 3000;

export interface SpectateRacer { id: number; racing: boolean }

export interface SpectateInput {
  now: number;
  /** When the player went out (game time), and who did it (a marble id; -1 a hazard; -2 a straggler cut). */
  koAt: number;
  koBy: number;
  /** Everyone, in race order (leader first), with whether they are still on the course. */
  order: SpectateRacer[];
}

export interface SpectateView {
  /** The marble to follow, or null when nobody is left on the course (hold the last view). */
  follow: number | null;
  /** True while the camera is on the marble that knocked the player out. */
  onKiller: boolean;
}

export function spectateTarget(input: SpectateInput): SpectateView {
  const killer = input.order.find((r) => r.id === input.koBy);
  if (input.koBy >= 0 && killer?.racing && input.now - input.koAt < SPECTATE_KILLER_MS) return { follow: killer.id, onKiller: true };
  const leader = input.order.find((r) => r.racing);
  return { follow: leader?.id ?? null, onKiller: false };
}

/** The line the race screen shows while the player is out. */
export function outMessage(koBy: number, nameOf: (id: number) => string): string {
  if (koBy >= 0) return `Knocked out by ${nameOf(koBy)}`;
  if (koBy === -2) return 'Too far behind: did not finish';
  return 'Knocked out';
}
