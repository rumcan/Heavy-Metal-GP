// P2-10b (#116): the loadout screen before every race. Whether to show it is the player's choice ("Don't ask before
// every race"), remembered on this device through storage.ts; the tutorial and Infinity never ask (no skills there).
import * as storage from './storage';

export const PRE_RACE_KEY = 'heavy-metal-gp:pre-race-loadout';

/** What the race about to start is, as far as the loadout question cares. */
export interface RaceStart { mode: 'quick' | 'championship' | 'story' | 'online' | 'infinity'; tutorial?: boolean }

export function askEveryRace(): boolean {
  try { return storage.getItem(PRE_RACE_KEY) !== 'off'; } catch { return true; }
}

export function setAskEveryRace(on: boolean): void {
  storage.setItem(PRE_RACE_KEY, on ? 'on' : 'off');
}

/** Show the loadout screen before this race? */
export function shouldAskLoadout(start: RaceStart, ask = askEveryRace()): boolean {
  if (!ask || start.tutorial) return false;
  // Infinity has no skills; online, the lobby has its own loadout and the host's clock starts the race
  return start.mode === 'quick' || start.mode === 'championship' || start.mode === 'story';
}
