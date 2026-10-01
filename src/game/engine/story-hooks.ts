// Story mode hooks: sectors, counters, per-step story callbacks and story AI targets.
// Split out of engine.ts (P2-00a). Every function takes the Game as `game`; Game's methods delegate here.










import type { RaceCounter } from '../story/types';

import { Game, Marble } from '../engine';


export function sectorOf(game: Game, m: Marble): number  {
  const y = m.body.position.y;
  const segments = game.track.segments;
  for (let i = 0; i < segments.length; i++) if (y >= segments[i].y && y < segments[i].y + segments[i].h) return i;
  return y < (segments[0]?.y ?? 0) ? 0 : Math.max(0, segments.length - 1);
}

export function storyCounter(game: Game, counter: RaceCounter, m: Marble, rivalId?: number) {
  const hooks = game.story;
  if (!hooks?.onCounter) return;
  hooks.onCounter({
    counter, marbleId: m.info.id, player: m.info.isPlayer, sectorIndex: game.sectorOf(m),
    ...(rivalId === undefined ? {} : { rivalId }),
  });
}

export function storyStep(game: Game) {
  const hooks = game.story!;
  for (const m of game.marbles) {
    if (m.finishedAt !== null) continue;
    const index = game.sectorOf(m);
    const previous = game.storySectors.get(m.info.id);
    game.storySectors.set(m.info.id, index);
    if (previous !== undefined && previous !== index) hooks.onSector?.(game, m, index);
  }
  if (!hooks.onCounter) return;
  const order = game.marbles.filter((m) => m.finishedAt === null)
    .map((m) => m.info.id)
    .sort((a, b) => game.byId.get(b)!.body.position.y - game.byId.get(a)!.body.position.y);
  const previousOrder = game.storyOrder;
  game.storyOrder = order;
  if (!previousOrder.length) return;
  const playerId = game.player.info.id;
  const now = order.indexOf(playerId);
  const before = previousOrder.indexOf(playerId);
  if (now < 0 || before < 0) return;
  for (const rivalId of order) {
    if (rivalId === playerId) continue;
    const wasAhead = previousOrder.indexOf(rivalId);
    const isBehind = order.indexOf(rivalId);
    if (wasAhead >= 0 && wasAhead < before && isBehind > now) game.storyCounter('overtakes', game.player, rivalId);
  }
}

export function storyTarget(game: Game, m: Marble): Marble | undefined  {
  const id = game.story?.aiTarget?.(game, m);
  if (id === null || id === undefined) return undefined;
  const target = game.byId.get(id);
  return target && target !== m && target.finishedAt === null ? target : undefined;
}
