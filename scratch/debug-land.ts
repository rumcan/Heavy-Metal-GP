import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { floorAt } from '../src/game/platformer/course';
import { meta } from '../src/game/track';
import Matter from 'matter-js';
function roster() {
  const rng = mulberry32(3);
  return Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? 'AI', color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: i === 0, character: i % 6 }));
}
const g = new Game(2, roster(), { track: buildPlatformerTrack(2, TRACK_THEMES.forest, 'rolling-hills'), talents: { 'steady-hands': 3 }, slots: [] });
g.start(); g.openGate();
for (let i = 0; i < 120; i++) g.step(PHYSICS_STEP);
const plan = g.track.platformer!.plan;
const floor = floorAt(plan, 1, 600);
const p = g.player;
p.cannon = undefined;
p.lane = 1;
Matter.Body.setPosition(p.body, { x: 600, y: (floor as number) - 40 });
Matter.Body.setVelocity(p.body, { x: 6, y: 6 });
g.applyMask(p);
const orig = g.contactSurface.bind(g);
(g as unknown as { contactSurface: unknown }).contactSurface = (m: typeof p, o: Matter.Body, pair: unknown, landing?: boolean) => {
  if (m === p && landing) {
    const md = meta(o);
    console.log('landing contact kind=', md?.kind, 'hasSurface=', !!md?.surface, 'v=', m.body.velocity.x.toFixed(2), m.body.velocity.y.toFixed(2));
  }
  const r = orig(m, o, pair as never, landing as never);
  if (m === p && landing) console.log('  after keep vx=', m.body.velocity.x.toFixed(3));
  return r;
};
for (let i = 0; i < 60; i++) g.step(PHYSICS_STEP);
