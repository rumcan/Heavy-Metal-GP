import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import PiecePalette from '../src/components/editor/PiecePalette';
import { Game } from '../src/game/engine';
import { render } from '../src/game/render';
import { meta, flipperAngle } from '../src/game/track';
import { sprite } from '../src/game/sprites';
import { updateElements } from '../src/game/elements';
import { bridgePlankPose } from '../src/game/track';
import Matter from 'matter-js';
import type { TrackDef } from '../src/game/trackdef';

const def: TrackDef = { v: 1, name: 'Workshop art', seed: 11, theme: 'classic', height: 2400, pieces: [
  { t: 'flipper', x: 240, y: 650, side: 0, len: 160, strength: 1.4, timer: 0, phase: 0 },
  { t: 'flipper', x: 660, y: 650, side: 1, len: 160, strength: 1.4, timer: 0, phase: 0 },
  { t: 'catapult', x: 300, y: 870, len: 170, reload: 1400, dir: 0 },
  { t: 'catapult', x: 600, y: 870, len: 170, reload: 1400, dir: 1 },
  { t: 'bridge', a: [130, 1210], b: [770, 1250], planks: 12, slack: 45 },
] };
const game = new Game(11, [{ id: 0, name: 'Probe', color: '#fff', isPlayer: true, stats: { speed: 5, weight: 5, bounce: 5 } }], { def, effects: false, aiItems: false });
const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 950;
document.body.appendChild(canvas);
const palette = document.createElement('div'); document.body.appendChild(palette);
createRoot(palette).render(createElement(PiecePalette, { active: null, onPick: () => {} }));
const ctx = canvas.getContext('2d')!;
type Draw = { name: string; angle: number; matrix: number[]; rect: number[] };
let calls: Draw[] = [];
const originalDraw = ctx.drawImage.bind(ctx);
ctx.drawImage = ((img: CanvasImageSource, ...args: number[]) => {
  if (img instanceof HTMLImageElement) {
    const name = ['flipper', 'catapult_arm', 'catapult_static', 'bridge'].find(n => img === sprite(n));
    if (name) {
      const m = ctx.getTransform();
      calls.push({ name, angle: Math.atan2(m.b, m.a), matrix: [m.a, m.b, m.c, m.d, m.e, m.f], rect: args });
    }
  }
  (originalDraw as (...args: unknown[]) => void)(img, ...args);
}) as typeof ctx.drawImage;

function frame(time: number, preview = false) {
  game.time = time;
  for (const b of game.track.bodies) {
    const md = meta(b);
    if (md.flipper) md.flipper.firedAt = 1530;
    if (md.catapult) { md.catapult.loadedAt = 0; md.catapult.firedAt = null; }
  }
  if (!preview) updateElements(game.track, time, 0);
  calls = [];
  const stateBefore = JSON.stringify(game.track.bodies.map(b => ({ p: b.position, a: b.angle, plugin: b.plugin })));
  // Deliberately offset browser time from simulation time: this reproduced the invisible swing.
  render(ctx, game, { x: 450, y: 950, scale: 1 }, 900, 950, preview ? time : 900000, { minimap: false, shake: false, workshopPreview: preview });
  const stateAfter = JSON.stringify(game.track.bodies.map(b => ({ p: b.position, a: b.angle, plugin: b.plugin })));
  return { calls, unchanged: stateBefore === stateAfter,
    expectedFlipper: game.track.bodies.filter(b => meta(b).flipper).map(b => flipperAngle(meta(b).flipper!, time)) };
}

function sagBridge() {
  const planks = game.track.bodies.filter(b => meta(b).bridge);
  const sag = planks.map((_, i) => Math.sin((i + 0.5) / planks.length * Math.PI) * 30);
  planks.forEach((b, i) => {
    const br = meta(b).bridge!;
    const p = bridgePlankPose(br.anchor, br.slack, i, br.n, sag);
    Matter.Body.setPosition(b, p); Matter.Body.setAngle(b, p.angle);
  });
  return frame(1640);
}
const api = { frame, sagBridge, ready: false };
(window as unknown as { workshopArt: typeof api }).workshopArt = api;
await Promise.all(['flipper', 'catapult_arm', 'catapult_static', 'rail-wood'].map(async name => {
  for (let i = 0; i < 200 && !sprite(name); i++) await new Promise(r => setTimeout(r, 25));
  if (!sprite(name)) throw new Error(`Sprite did not load: ${name}`);
}));
frame(1000);
api.ready = true;
