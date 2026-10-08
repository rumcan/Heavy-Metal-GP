// An online guest's picture of the premium skills (skills/premium.ts): the host's `skillfx` events put the things,
// shots and hexes where the host said, and they are aged here. DRAWING only: nothing on a guest hits, damages or
// knocks anything; the host's frames move the marbles.
import type { Game } from '../engine';
import type { SkillFxEvent } from '../../net/protocol';
import type { Shot, Zone } from './premium';

export function premiumFx(game: Game, e: SkillFxEvent, lane: number): void {
  const t = game.time;
  const [kind, what] = e.fx.split('-') as [string, string];
  const target = e.target >= 0 ? game.marbles[e.target] : undefined;
  if (kind === 'z') {
    const zone: Zone = { id: game.nextProjectileId++, kind: what as Zone['kind'], owner: e.seat, target: e.target, x: e.x, y: e.y, lane: what === 'wall' && target ? (target.lane ?? lane) : lane, at: t, until: e.until, h: 72 };
    game.zones.push(zone);
  } else if (kind === 's') {
    // a shot drawn flying forward (or at its target); its hits come from the host
    const dx = target ? target.body.position.x - e.x : game.track.platformer ? 1 : 0;
    const dy = target ? target.body.position.y - e.y : game.track.platformer ? 0 : 1;
    const d = Math.hypot(dx, dy) || 1, speed = what === 'cluster' ? 8 : 11;
    const shot: Shot = { id: game.nextProjectileId++, kind: what as Shot['kind'], owner: e.seat, target: e.target, x: e.x, y: e.y, vx: (dx / d) * speed, vy: what === 'cluster' ? -9 : (dy / d) * speed, at: t, until: e.until, lane, hits: [] };
    game.shots.push(shot);
  } else if (kind === 'a' && target) {
    const fx = (target.fx ??= {}) as Record<string, number>;
    const key = { lift: 'liftUntil', slow: 'slowUntil', shrink: 'shrinkUntil', zap: 'zapUntil', thorns: 'thornsUntil', blades: 'bladesUntil', bubble: 'bubbleUntil' }[what];
    if (key) fx[key] = e.until;
    if (what === 'blades') fx.blades = 3;
  }
}

export function agePremiumFx(game: Game, dt: number): void {
  const t = game.time, k = dt / 16.7;
  for (let i = game.shots.length - 1; i >= 0; i--) {
    const s = game.shots[i];
    if (s.until < t) { game.shots.splice(i, 1); continue; }
    if (s.kind === 'cluster' || s.kind === 'bomblet') s.vy += 0.35 * k;
    if (s.kind === 'boomerang' && t - s.at > 650) {
      const owner = game.marbles[s.owner];
      if (owner) { const dx = owner.body.position.x - s.x, dy = owner.body.position.y - s.y, d = Math.hypot(dx, dy) || 1; s.vx += ((dx / d) * 15 - s.vx) * 0.12 * k; s.vy += ((dy / d) * 15 - s.vy) * 0.12 * k; if (d < 30) { game.shots.splice(i, 1); continue; } }
    }
    s.x += s.vx * k; s.y += s.vy * k;
  }
  for (let i = game.zones.length - 1; i >= 0; i--) {
    const z = game.zones[i];
    if (z.until < t) { game.zones.splice(i, 1); continue; }
    const owner = game.marbles[z.owner];
    if (z.kind === 'laser' && owner) { z.x = owner.body.position.x; z.y = owner.body.position.y; }
    if (z.kind === 'leech') { const v = game.marbles[z.target]; if (v) { z.x = v.body.position.x; z.y = v.body.position.y; } }
    if (z.kind === 'twin' && owner) {
      const past = owner.past ?? (owner.past = []);
      past.push({ t, x: owner.body.position.x, y: owner.body.position.y, vx: 0, vy: 0, lane: owner.lane ?? 1, hp: 100 });
      while (past.length && t - past[0].t > 1000) past.shift();
      z.x = past[0].x; z.y = past[0].y; z.lane = game.track.platformer ? past[0].lane : 0;
    }
  }
}
