/**
 * Scratch harness for issue #73: renders the audited pieces (cannon, catapult,
 * flippers, slings at sizes 40/90/180, magnet, wind, scoop, geyser) on a tall
 * strip and overlays the physics colliders in red so art-vs-anchor alignment
 * can be eyeballed, with and without the sprite art loaded.
 */
import { Game } from '../../src/game/engine';
import { render } from '../../src/game/render';
import { W, meta, cannonAim, catapultAngle, flipperAngle } from '../../src/game/track';

const def = {
  v: 1, name: 'render check', seed: 11, theme: 'classic', height: 2800,
  segments: [
    { name: 'Start', y: 0, h: 120 },
    { name: 'Gauntlet', y: 120, h: 2560 },
    { name: 'Out', y: 2680, h: 120 },
  ],
  pieces: [
    { t: 'cannon', x: 450, y: 250, aimMin: 292, aimMax: 330, power: 9, auto: 1700, phase: 0 },
    { t: 'catapult', x: 300, y: 560, len: 230, reload: 1400, dir: 0 },
    { t: 'flipper', x: 260, y: 860, side: 0, len: 120, strength: 1.4, timer: 0, phase: 0 },
    { t: 'flipper', x: 660, y: 980, side: 1, len: 120, strength: 1.4, timer: 0, phase: 0 },
    { t: 'sling', x: 250, y: 1180, size: 40, facing: 245, strength: 4 },
    { t: 'sling', x: 560, y: 1260, size: 90, facing: 305, strength: 4 },
    { t: 'sling', x: 330, y: 1480, size: 180, facing: 225, strength: 4 },
    { t: 'magnet', x: 450, y: 1750, r: 120, str: 3, period: 0, phase: 0 },
    { t: 'wind', a: [220, 1880], b: [700, 2010], dir: 270, str: 0.28, pulse: 0, phase: 0 },
    { t: 'scoop', x: 450, y: 2160, deg: 270, hold: 800 },
    { t: 'geyser', x: 450, y: 2430, h: 300, period: 4200, phase: 0 },
    { t: 'ramp', a: [0, 2620], b: [900, 2700] },
  ],
};

const roster = [{ id: 0, name: 'P', color: '#ffcc00', stats: { speed: 5, bounce: 5, weight: 5, grip: 5 }, isPlayer: true }];

const params = new URLSearchParams(location.search);
const wantArt = params.get('art') !== '0';
const t = 400;

async function artReady(): Promise<boolean> {
  const t0 = performance.now();
  while (performance.now() - t0 < 8000) {
    const imgs = [...document.images];
    if (imgs.length > 40 && imgs.every((i) => i.complete && i.naturalWidth > 0)) return true;
    await new Promise((r) => setTimeout(r, 60));
  }
  return false;
}

async function main() {
  const game = new Game(7, roster as never, { def: def as never, recovery: false, effects: false, wireEvents: false });
  if (wantArt) await artReady();

  const H = game.track.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  render(ctx, game, { x: W / 2, y: H / 2, scale: 1 }, W, H, t, { minimap: false, shake: false });

  // overlay physics colliders of the audited pieces
  const labels = new Set(['cannon', 'catapult', 'flipper', 'sling', 'scoop', 'wind', 'magnet', 'geyser']);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,40,40,0.9)';
  ctx.lineWidth = 2;
  for (const b of game.track.bodies) {
    if (!labels.has(b.label)) continue;
    ctx.beginPath();
    const v = b.vertices;
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,40,40,0.9)';
    ctx.beginPath();
    ctx.arc(b.position.x, b.position.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // green outlines = the intended art rectangles (drawSprite call sites)
  ctx.save();
  ctx.strokeStyle = 'rgba(60,255,60,0.9)';
  ctx.lineWidth = 2;
  for (const b of game.track.bodies) {
    const md = meta(b);
    if (md?.sling) {
      const s = md.sling.size;
      const fa = Math.atan2(md.sling.facing.y, md.sling.facing.x);
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(fa + Math.PI);
      ctx.strokeRect(-s * 0.38, -s * 0.62, s * 0.6, s * 1.24);
      ctx.restore();
    }
    if (md?.cannon && md.motion?.mode === 'aim') {
      const a = cannonAim(md.motion, game.time);
      ctx.save();
      ctx.translate(md.motion.pivot.x, md.motion.pivot.y);
      ctx.rotate(a);
      ctx.strokeRect(0, -14, md.cannon.len + 6, 28);
      ctx.restore();
    }
    if (md?.catapult) {
      ctx.save();
      ctx.translate(md.catapult.px, md.catapult.py);
      ctx.rotate(catapultAngle(md.catapult, game.time));
      ctx.strokeRect(0, -13, md.catapult.len + 22, 26);
      ctx.restore();
    }
    if (md?.flipper) {
      ctx.save();
      ctx.translate(md.flipper.px, md.flipper.py);
      ctx.rotate(flipperAngle(md.flipper, t));
      ctx.strokeRect(0, -8, md.flipper.len, 16); // content rect
      ctx.restore();
    }
  }
  ctx.restore();

  (window as unknown as { __READY__: boolean }).__READY__ = true;
}

main().catch((e) => {
  document.body.textContent = String(e?.stack ?? e);
  (window as unknown as { __ERROR__: string }).__ERROR__ = String(e);
});
