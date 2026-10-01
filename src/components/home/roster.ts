/** Small helpers shared by the home tabs: the player's marble from a garage, and the grid it races on. */
import type { MarbleInfo } from '../../game/types';
import type { Garage } from '../../game/garages';

/** The player's marble, as the previews and the grid show it. */
export function playerOf(garage: Garage): MarbleInfo {
  return { id: 0, name: 'You', color: garage.color, stats: garage.stats, isPlayer: true, character: garage.portrait };
}

/** The player first, then the rivals: the order of the grid. */
export function rosterWith(garage: Garage, rivals: MarbleInfo[]): MarbleInfo[] {
  return [playerOf(garage), ...rivals];
}
