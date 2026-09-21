import { Game } from '../../src/game/engine';
import { render } from '../../src/game/render';
import { W } from '../../src/game/track';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../../src/game/types';
import { TRACK_THEMES } from '../../src/game/types';
import type { MarbleInfo } from '../../src/game/types';

declare global {
  interface Window { __READY__?: boolean; __ERROR__?: string }
}

const FRAME_MS = 1000 / 60;

async function artReady(): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < 8000) {
    const imgs = [...document.images];
    if (imgs.length > 40 && imgs.every((i) => i.complete && i.naturalWidth > 0)) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

function roster(seed: number): MarbleInfo[] {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    name: id === 0 ? 'You' : AI_NAMES[(id - 1) % AI_NAMES.length],
    color: id === 0 ? '#d63e2e' : AI_COLORS[(id - 1) % AI_COLORS.length],
    stats: randomStats(rng),
    isPlayer: id === 0,
  }));
}

async function main() {
  const game = new Game(42, roster(42), { profile: { segments:30, weights:{}, theme:TRACK_THEMES.classic }, recovery:false, effects:true, aiItems:false });
  game.openGate();
  await artReady();

  const shoot = (view: string, cam: { x: number; y: number; scale: number }, w: number, h: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.dataset.view = view;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    render(ctx, game, cam, w, h, game.time, { minimap: false, shake: false });
  };

  const advance = (ms: number) => { for (let t = 0; t < ms; t += FRAME_MS) game.step(FRAME_MS); };

  advance(2000);
  shoot('overview', { x:450, y:game.track.height/2, scale:1 }, 900, game.track.height);
  const sector=(prefix:string)=>game.track.segments.find(s=>s.name.startsWith(prefix))!;
  shoot('fork', {x:450,y:sector('Foundry').y+300,scale:1},900,820);
  shoot('ferry', {x:450,y:sector('Sky Ferry').y+300,scale:1},900,820);
  shoot('shortcut', {x:450,y:sector('Smuggler').y+300,scale:1},900,820);
  shoot('battle', {x:450,y:sector('Crane').y+300,scale:1},900,820);
  shoot('phone', {x:450,y:sector('Smuggler').y+450,scale:390/900},390,844);

  window.__READY__ = true;
}

main().catch((e) => { window.__ERROR__ = String(e?.stack ?? e); });
