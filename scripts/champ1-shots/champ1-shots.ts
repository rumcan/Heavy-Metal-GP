/**
 * CHAMP-02 screenshot page (issue #86): races a 10-marble pack on the committed
 * Monte Pipo def and renders the acceptance views — full overview, the sector A
 * fork, the harbour ferry, the shortcut landing, the sector C battle area and a
 * phone-sized viewport — into labelled canvases for scripts/champ1-shots.mjs.
 */
import { Game } from '../../src/game/engine';
import { render } from '../../src/game/render';
import { W } from '../../src/game/track';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../../src/game/types';
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
  const def = await (await fetch('/src/game/official-tracks/champ-1.json')).json();
  const game = new Game(42, roster(42), { def, recovery: true, effects: true, aiItems: true });
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
  shoot('overview', { x: W / 2, y: game.track.height / 2, scale: 1 }, W, game.track.height);
  shoot('fork', { x: 450, y: 790, scale: 1.6 }, 900, 620);
  shoot('phone', { x: 450, y: 900, scale: 390 / 900 }, 390, 844);
  advance(4000);
  shoot('ferry', { x: 450, y: 1500, scale: 1.3 }, 900, 620);
  advance(3000);
  shoot('shortcut', { x: 600, y: 2290, scale: 1.6 }, 900, 620);
  advance(1500);
  shoot('battle', { x: 500, y: 2600, scale: 1.4 }, 900, 620);

  window.__READY__ = true;
}

main().catch((e) => { window.__ERROR__ = String(e?.stack ?? e); });
