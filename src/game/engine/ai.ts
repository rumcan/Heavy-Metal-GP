// Computer drivers: today only their item use. P2-16 (AI drivers v2) replaces this with a real driving brain.
// Split out of engine.ts (P2-00a).
import type { Game, Marble } from '../engine';
import { meta } from '../track';
import { elementBodies } from '../elements';

/** Fire this AI marble's item when it makes sense. */
export function useItems(game: Game, m: Marble): void {
  const b = m.body;
  // AI item usage
  const item = game.availableItem(m);
  if (game.aiItemsEnabled && !game.isHuman(m) && item && game.time > m.aiUseAt) {
    // STORY HOOK (ST-07): a chapter may give game rival a preferred target. Unset: today's AI, unchanged.
    const hunted = game.story ? game.storyTarget(m) : undefined;
    const shockRange = hunted ? 260 : 200;
    // simple smarts: don't waste freeze if nobody ahead, save shock if nobody near
    if (item === 'freeze' && !game.marbles.some((o) => o !== m && o.finishedAt === null && o.body.position.y > b.position.y - 20 && Math.abs(o.body.position.y - b.position.y) < 900)) {
      m.aiUseAt = game.time + 1500;
    } else if (item === 'shock' && !game.marbles.some((o) => o !== m && Math.hypot(o.body.position.x - b.position.x, o.body.position.y - b.position.y) < shockRange)) {
      m.aiUseAt = game.time + 700;
    } else if (item === 'ghost' && m.ghostUntil < game.time) {
      // MB-10B: ghost is the timing cheat — burn it where the danger machines actually are.
      let danger = false;
      for (const kind of ['blade', 'saw', 'crusher', 'boulder', 'mace'] as const) {
        for (const d of elementBodies(game.track, kind)) {
          const md = meta(d);
          if (md.destroyed) continue;
          const dx = d.position.x - b.position.x;
          const dy = d.position.y - b.position.y;
          if (Math.abs(dx) < 260 && dy > -60 && dy < 620) { danger = true; break; }
        }
        if (danger) break;
      }
      if (danger) game.useItem(m);
      else m.aiUseAt = game.time + 1200;
    } else game.useItem(m);
  }
}
