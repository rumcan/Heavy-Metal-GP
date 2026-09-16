import Matter from 'matter-js';
import { Game, Marble } from './engine';
import { meta, W } from './track';
import { MARBLE_RADIUS, ITEM_INFO } from './types';
import { ballFor, bodyFrame, drawRail, drawSprite, drawStrip, sprite } from './sprites';
import repeatingBgUrl from '../assets/bg/repeating.webp';
import mineEntranceUrl from '../assets/bg/mine-entrance.webp';
import mineUrl from '../assets/bg/mine.webp';

const loadImage = (src: string) => (typeof Image !== 'undefined' ? Object.assign(new Image(), { src }) : null);
const skyBg = loadImage(repeatingBgUrl);
const entranceBg = loadImage(mineEntranceUrl);
const mineBg = loadImage(mineUrl);
const ready = (img: HTMLImageElement | null): img is HTMLImageElement => !!img && img.complete && img.naturalWidth > 0;

/**
 * Screen-space backdrop that scrolls slowly with the camera: sky tile(s), then the mine entrance, then the mine shaft
 * repeating below. The parallax rate is picked per circuit so the field drops into the mine around the halfway mark.
 */
let hazyShip: HTMLCanvasElement | null = null;
/** The airship with a little atmospheric haze baked in, so it sits between the far backdrop and the track. */
function airshipImage(): HTMLCanvasElement | null {
  if (hazyShip) return hazyShip;
  const img = sprite('airship');
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(40,60,100,0.15)';
  g.fillRect(0, 0, c.width, c.height);
  hazyShip = c;
  return c;
}

/**
 * Goblin airships on their own parallax layer: they scroll up slower than the track but faster than the far backdrop,
 * and drift sideways across the sky. Only above ground.
 */
function drawAirships(ctx: CanvasRenderingContext2D, game: Game, cam: Camera, cw: number, ch: number, t: number) {
  const ship = airshipImage();
  if (!ship) return;
  const PARALLAX = 0.4, GAP = 1100;
  const v = cam.y * PARALLAX;
  const skyEnd = undergroundY(game) * PARALLAX;
  const seed = game.track.seed;
  for (let i = Math.floor((v - ch) / GAP); i * GAP - v < ch * 1.5; i++) {
    if (i < 0 || i * GAP > skyEnd) continue;
    const depth = 0.55 + hash01(seed, i, 41) * 0.45; // nearer ships are bigger and faster
    const h = 250 * depth * Math.min(1.3, ch / 800);
    const w = h * ship.width / ship.height;
    const speed = (0.012 + hash01(seed, i, 42) * 0.02) * depth;
    const dir = hash01(seed, i, 43) < 0.5 ? 1 : -1;
    const span = cw + w * 2;
    const travel = ((t * speed + hash01(seed, i, 44) * span) % span + span) % span;
    const x = dir > 0 ? travel - w : cw + w - travel - w;
    const y = i * GAP - v + ch * 0.2 + Math.sin(t / 900 + i) * 8;
    if (y > ch || y + h < 0) continue;
    ctx.save();
    ctx.globalAlpha = 0.55 + depth * 0.35;
    if (dir < 0) {
      // art faces right; mirror ships heading left
      ctx.translate(x + w, y);
      ctx.scale(-1, 1);
      ctx.drawImage(ship, 0, 0, w, h);
    } else ctx.drawImage(ship, x, y, w, h);
    ctx.restore();
  }
}

const tintedTiles = new Map<string, HTMLCanvasElement>();
/** Backdrop tile resized to its on-screen size (at reduced resolution; it sits under a dark wash) with the wash baked in. */
function tintedTile(img: HTMLImageElement, key: string, pxWidth: number, wash: string): HTMLCanvasElement {
  const w = Math.max(64, Math.round(pxWidth * 0.6 / 64) * 64);
  const id = `${key}:${w}`;
  let c = tintedTiles.get(id);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round(w * img.naturalHeight / img.naturalWidth);
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, c.width, c.height);
    g.fillStyle = wash;
    g.fillRect(0, 0, c.width, c.height);
    tintedTiles.set(id, c);
  }
  return c;
}

let vignette: { w: number; h: number; canvas: HTMLCanvasElement } | null = null;
function vignetteFor(cw: number, ch: number): HTMLCanvasElement {
  if (vignette && vignette.w === cw && vignette.h === ch) return vignette.canvas;
  // a smooth radial gradient survives heavy upscaling, so bake it at quarter size
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(cw / 4));
  c.height = Math.max(8, Math.round(ch / 4));
  const g = c.getContext('2d')!;
  // wide vignette: darkening starts close to the centre and is near-black at the edges
  const grad = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.08, c.width / 2, c.height / 2, Math.hypot(c.width, c.height) / 2);
  grad.addColorStop(0, 'rgba(4,8,18,0.15)');
  grad.addColorStop(0.45, 'rgba(3,6,14,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0.95)');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  vignette = { w: cw, h: ch, canvas: c };
  return c;
}

/**
 * Screen-space backdrop that scrolls slowly with the camera: sky tile(s), then the mine entrance, then the mine shaft
 * repeating below. The parallax rate is picked per circuit so the field drops into the mine around the halfway mark.
 */
function drawBackdrop(ctx: CanvasRenderingContext2D, cam: Camera, cw: number, ch: number, trackHeight: number) {
  ctx.fillStyle = '#0a1a33';
  ctx.fillRect(0, 0, cw, ch);
  if (!ready(skyBg)) return;
  const dpr = ctx.getTransform().a || 1;
  const tw = Math.max(cw, 600);
  const th = tw * (skyBg.naturalHeight / skyBg.naturalWidth);
  const haveMine = ready(entranceBg) && ready(mineBg);
  // entrance tile (row 1) is centred on screen when the camera is ~55% down the circuit
  const parallax = haveMine ? Math.max(0.06, Math.min(0.5, (1.5 * th - ch / 2) / Math.max(1, trackHeight * 0.55))) : 0.15;
  const v = cam.y * parallax;
  const x = (cw - tw) / 2;
  for (let row = Math.floor(v / th); row * th - v < ch; row++) {
    const y = row * th - v;
    const tile = !haveMine || row < 1
      ? tintedTile(skyBg, 'sky', tw * dpr, 'rgba(8,24,56,0.55)')
      : row === 1 ? tintedTile(entranceBg!, 'entrance', tw * dpr, 'rgba(20,16,20,0.55)') : tintedTile(mineBg!, 'mine', tw * dpr, 'rgba(24,14,8,0.55)');
    ctx.drawImage(tile, x, y, tw, th + 1);
  }
  const seam = th - v;
  if (haveMine && seam > -80 && seam < ch + 80) {
    // soften the sky -> entrance seam
    const fog = ctx.createLinearGradient(0, seam - 70, 0, seam + 70);
    fog.addColorStop(0, 'rgba(90,110,140,0)');
    fog.addColorStop(0.5, 'rgba(90,110,140,0.5)');
    fog.addColorStop(1, 'rgba(90,110,140,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, seam - 70, cw, 140);
  }
  ctx.drawImage(vignetteFor(cw, ch), 0, 0, cw, ch);
}

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

function polygon(ctx: CanvasRenderingContext2D, body: Matter.Body) {
  const v = body.vertices;
  ctx.beginPath();
  ctx.moveTo(v[0].x, v[0].y);
  for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
  ctx.closePath();
}

function drawPipe(ctx: CanvasRenderingContext2D, body: Matter.Body, fill: string, edge: string) {
  polygon(ctx, body);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = edge;
  ctx.stroke();
  // highlight along the top surface (local top edge => vertices around index 0..1 for un-chamfered; approximate using bounds)
  const v = body.vertices;
  // find edge closest to "up" normal via body angle
  const a = body.angle;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = Math.sin(a);
  const ny = -Math.cos(a);
  // top surface line: project vertices onto normal, take max
  let maxN = -Infinity;
  for (const p of v) {
    const d = (p.x - body.position.x) * nx + (p.y - body.position.y) * ny;
    if (d > maxN) maxN = d;
  }
  // extent along u
  let minU = Infinity;
  let maxU = -Infinity;
  for (const p of v) {
    const d = (p.x - body.position.x) * ux + (p.y - body.position.y) * uy;
    if (d < minU) minU = d;
    if (d > maxU) maxU = d;
  }
  const off = maxN - 3;
  ctx.beginPath();
  ctx.moveTo(body.position.x + ux * (minU + 6) + nx * off, body.position.y + uy * (minU + 6) + ny * off);
  ctx.lineTo(body.position.x + ux * (maxU - 6) + nx * off, body.position.y + uy * (maxU - 6) + ny * off);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * amt)));
  g = Math.max(0, Math.min(255, Math.round(g * amt)));
  b = Math.max(0, Math.min(255, Math.round(b * amt)));
  return `rgb(${r},${g},${b})`;
}

function drawMarble(ctx: CanvasRenderingContext2D, game: Game, m: Marble, t: number) {
  const b = m.body;
  const { x, y } = b.position;
  const r = MARBLE_RADIUS;
  const frozen = game.time < m.frozenUntil;
  const ghost = game.time < m.ghostUntil;
  const anvil = game.time < m.anvilUntil;
  const rocket = game.time < m.rocketUntil;

  ctx.save();
  if (ghost) ctx.globalAlpha = 0.45;

  // trail
  if (m.trail.length > 2) {
    ctx.beginPath();
    ctx.moveTo(m.trail[0].x, m.trail[0].y);
    for (let i = 1; i < m.trail.length; i++) ctx.lineTo(m.trail[i].x, m.trail[i].y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = rocket ? 'rgba(251,146,60,0.7)' : m.info.color + '55';
    ctx.lineWidth = rocket ? 10 : 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // shadow
  ctx.beginPath();
  ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();

  // body: kit ball sprite (spiked ball while Heavy metal is active), flat gradient until sprites load
  if (drawSprite(ctx, anvil ? 'ball-spiked' : ballFor(m.info.color), x, y, (anvil ? r * 2.9 : r * 2.2), (anvil ? r * 2.9 : r * 2.2), b.angle)) {
    // spin is visible in the sprite texture
  } else {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  const base = anvil ? '#475569' : m.info.color;
  g.addColorStop(0, shade(base, 1.6));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shade(base, 0.55));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // swirl showing spin
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(b.angle);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0.2, Math.PI * 0.9);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, Math.PI + 0.2, Math.PI * 1.9);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.stroke();
  ctx.restore();

  // specular
  ctx.beginPath();
  ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fill();
  }

  // outline
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = m.info.isPlayer ? 3 : 1.5;
  ctx.strokeStyle = m.info.isPlayer ? `rgba(255,255,255,${0.7 + 0.3 * Math.sin(t / 120)})` : 'rgba(0,0,0,0.4)';
  ctx.stroke();

  if (anvil) {
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (frozen) {
    ctx.beginPath();
    ctx.arc(x, y, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(186,230,253,0.55)';
    ctx.fill();
    ctx.strokeStyle = '#e0f2fe';
    ctx.lineWidth = 2;
    ctx.stroke();
    // ice spikes
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2));
      ctx.lineTo(x + Math.cos(a) * (r + 9), y + Math.sin(a) * (r + 9));
      ctx.stroke();
    }
  }
  if (m.inOil) {
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(168,85,247,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (game.time < m.aeroUntil) {
    ctx.strokeStyle = '#5eead4bb';
    ctx.lineWidth = 1.5;
    for (const direction of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x, y, r + 6, direction * 0.4 + t / 700, direction * 0.4 + t / 700 + 1.1);
      ctx.stroke();
    }
  }
  ctx.restore();

  // name tag
  ctx.save();
  ctx.font = `${m.info.isPlayer ? 'bold ' : ''}11px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = m.info.isPlayer ? 'YOU' : m.info.name;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(x - tw / 2 - 4, y - r - 20, tw + 8, 14, 4);
  ctx.fill();
  ctx.fillStyle = m.info.isPlayer ? '#fff' : '#e2e8f0';
  ctx.fillText(label, x, y - r - 8);
  const heldItem = game.availableItem(m);
  if (heldItem) {
    ctx.beginPath();
    ctx.arc(x + tw / 2 + 10, y - r - 13, 3, 0, Math.PI * 2);
    ctx.fillStyle = ITEM_INFO[heldItem].color;
    ctx.fill();
  }
  if (m.info.isPlayer) {
    // arrow marker
    const by = y - r - 26 - Math.abs(Math.sin(t / 200)) * 4;
    ctx.beginPath();
    ctx.moveTo(x, by);
    ctx.lineTo(x - 7, by - 9);
    ctx.lineTo(x + 7, by - 9);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  ctx.restore();
}

export function render(ctx: CanvasRenderingContext2D, game: Game, cam: Camera, cw: number, ch: number, t: number, options: { minimap?: boolean; shake?: boolean } = {}) {
  ctx.clearRect(0, 0, cw, ch);

  const theme = game.track.theme;
  // background
  // Scrolling repeating backdrop under a blue vignette.
  drawBackdrop(ctx, cam, cw, ch, game.track.height);
  drawAirships(ctx, game, cam, cw, ch, t);

  ctx.save();
  const shakeX = options.shake !== false && game.shake > 0 ? (Math.random() - 0.5) * game.shake * 0.7 : 0;
  const shakeY = options.shake !== false && game.shake > 0 ? (Math.random() - 0.5) * game.shake * 0.7 : 0;
  ctx.translate(cw / 2 + shakeX, ch / 2 + shakeY);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.y);

  const viewTop = cam.y - ch / 2 / cam.scale - 100;
  const viewBottom = cam.y + ch / 2 / cam.scale + 100;
  const viewLeft = cam.x - cw / 2 / cam.scale - 100;
  const viewRight = cam.x + cw / 2 / cam.scale + 100;

  drawStaticLayer(ctx, game, viewTop, viewBottom);
  drawTorchGlows(ctx, game, viewTop, viewBottom, t);

  // oil slicks
  for (const o of game.oils) {
    const life = (o.expiresAt - game.time) / 9000;
    ctx.save();
    ctx.globalAlpha = Math.min(1, life * 3);
    ctx.beginPath();
    ctx.ellipse(o.x, o.y, o.r, o.r * 0.75, 0, 0, Math.PI * 2);
    const og = ctx.createRadialGradient(o.x, o.y, 4, o.x, o.y, o.r);
    og.addColorStop(0, '#3b0764');
    og.addColorStop(0.7, '#581c87');
    og.addColorStop(1, 'rgba(88,28,135,0)');
    ctx.fillStyle = og;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(o.x - 10, o.y - 8, o.r * 0.35, o.r * 0.15, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(216,180,254,0.35)';
    ctx.fill();
    ctx.restore();
  }

  // static bodies
  const bodies = game.track.bodies;
  for (const b of bodies) {
    if (b.label === 'marble') continue;
    if (b.bounds.max.y < viewTop || b.bounds.min.y > viewBottom) continue;
    if (b.bounds.max.x < viewLeft || b.bounds.min.x > viewRight) continue;
    const md = meta(b);
    if (md?.destroyed || STATIC_KINDS.has(md?.kind)) continue;
    switch (md?.kind) {
      case 'ramp':
        if (!drawRail(ctx, b, 'rail-wood', md.caps) && !drawStrip(ctx, b, 'strip-wood')) drawPipe(ctx, b, theme.pipe, theme.pipeEdge);
        break;
      case 'hoop': {
        const img = sprite('fire-hoop');
        const flicker = 0.75 + 0.25 * Math.sin(t / 90 + b.position.y) * Math.sin(t / 37);
        ctx.globalAlpha = flicker;
        ctx.drawImage(glowSprite(), b.position.x - 90, b.position.y - 90, 180, 180);
        ctx.globalAlpha = 1;
        if (img) {
          // hole centre sits at (200, 269) in the 400x593 art; hole diameter 251
          const k = 84 / 251;
          ctx.drawImage(img, b.position.x - 200 * k, b.position.y - 269 * k, img.naturalWidth * k, img.naturalHeight * k);
        } else {
          ctx.beginPath();
          ctx.arc(b.position.x, b.position.y, 38, 0, Math.PI * 2);
          ctx.strokeStyle = '#fb923c';
          ctx.lineWidth = 6;
          ctx.stroke();
        }
        break;
      }
      case 'wrecker': {
        const pv = md.pivot!;
        const dx = b.position.x - pv.x, dy = b.position.y - pv.y;
        const len = Math.hypot(dx, dy) || 1;
        // chain links
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pv.x, pv.y);
        ctx.lineTo(b.position.x, b.position.y);
        ctx.stroke();
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 2;
        for (let d = 6; d < len - 20; d += 11) {
          const cx = pv.x + dx * d / len, cy = pv.y + dy * d / len;
          ctx.beginPath();
          ctx.ellipse(cx, cy, 2.6, 5, Math.atan2(dy, dx) + Math.PI / 2 * ((d / 11) % 2 < 1 ? 1 : 0), 0, Math.PI * 2);
          ctx.stroke();
        }
        drawSprite(ctx, 'tile-metal', pv.x, pv.y, 22, 12);
        ctx.fillStyle = '#9ca3af';
        ctx.beginPath();
        ctx.arc(pv.x, pv.y, 4, 0, Math.PI * 2);
        ctx.fill();
        const r = md.radius ?? 24;
        const ballImg = sprite('wrecking-ball');
        if (ballImg) {
          // the art hangs from a chain stub; its ball centre sits ~62% down the image
          const bw = r * 3.1, bh = bw * ballImg.naturalHeight / ballImg.naturalWidth;
          ctx.save();
          ctx.translate(b.position.x, b.position.y);
          ctx.rotate(-Math.atan2(dx, dy));
          ctx.drawImage(ballImg, -bw / 2, -bh * 0.62, bw, bh);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(b.position.x, b.position.y, r, 0, Math.PI * 2);
          ctx.fillStyle = '#1f2937';
          ctx.fill();
        }
        break;
      }
      case 'loop':
        // Hidden under the loop ring skin once it has loaded.
        if (sprite('loop-ring')) break;
        if (!drawStrip(ctx, b, 'strip-metal')) drawPipe(ctx, b, theme.pipe, theme.pipeEdge);
        break;
      case 'gate': {
        if (drawStrip(ctx, b, 'strip-hazard')) break;
        // trapdoor with red/white kerb stripes
        polygon(ctx, b);
        ctx.fillStyle = '#334155';
        ctx.fill();
        const { min, max } = b.bounds;
        for (let x = min.x, i = 0; x < max.x; x += 20, i++) {
          ctx.fillStyle = i % 2 === 0 ? '#ef4444' : '#f8fafc';
          ctx.fillRect(x, min.y, Math.min(20, max.x - x), 5);
        }
        break;
      }
      case 'block': {
        if (drawStrip(ctx, b, 'tile-metal', { tile: 36 })) break;
        polygon(ctx, b);
        ctx.fillStyle = '#94a3b8';
        ctx.fill();
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
      case 'ppeg': {
        const r = md.radius ?? 10;
        const col = md.pegColor ?? 'blue';
        const base = col === 'orange' ? '#f97316' : col === 'green' ? (md.itemDrop ? ITEM_INFO[md.itemDrop].color : '#22c55e') : '#3b82f6';
        const lit = col === 'orange' ? '#fed7aa' : col === 'green' ? '#bbf7d0' : '#bfdbfe';
        const hit = !!md.hit;
        const age = hit ? game.time - (md.hitAt ?? 0) : 0;
        const pulse = hit ? Math.max(0.3, 1 - age / 210) : col === 'green' ? 1 + Math.sin(t / 330 + b.position.x) * 0.06 : 1;
        const gem = sprite(`gem-${col === 'green' && md.itemDrop ? 'purple' : col}`);
        if (hit || col === 'green') {
          ctx.drawImage(colorGlow(base), b.position.x - r * 2.2, b.position.y - r * 2.2, r * 4.4, r * 4.4);
        }
        if (gem) {
          const size = r * 2.5 * pulse;
          ctx.drawImage(gem, b.position.x - size / 2, b.position.y - size / 2, size, size);
          if (hit) {
            // brighten with an additive second pass; canvas filters are far slower
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.8;
            ctx.drawImage(gem, b.position.x - size / 2, b.position.y - size / 2, size, size);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
          }
        } else {
        const pg = ctx.createRadialGradient(b.position.x - 3, b.position.y - 3, 1, b.position.x, b.position.y, r * pulse);
        pg.addColorStop(0, hit ? '#ffffff' : lit);
        pg.addColorStop(0.5, hit ? lit : base);
        pg.addColorStop(1, hit ? base : shade(base, 0.55));
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, r * pulse, 0, Math.PI * 2);
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = hit ? '#fff' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        }
        if (col === 'green' && !hit) {
          ctx.beginPath();
          ctx.arc(b.position.x, b.position.y, r + 5, t / 450, t / 450 + Math.PI * 1.4);
          ctx.strokeStyle = base;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 10px system-ui';
          const mark = md.itemDrop ? { rocket: '>>', jump: '^', oil: 'O', shock: 'S', anvil: 'W', aero: 'A', freeze: 'F', ghost: 'G' }[md.itemDrop] : '?';
          ctx.strokeStyle = '#102019bb';
          ctx.lineWidth = 2;
          ctx.strokeText(mark, b.position.x, b.position.y + 1);
          ctx.fillText(mark, b.position.x, b.position.y + 1);
        }
        break;
      }
      case 'bucket': {
        const { x, y } = b.position;
        const cart = sprite('minecart');
        if (cart) {
          // minecart shuttling along its rail (the rail is part of the static layer)
          const vx = Math.cos(game.time * 0.0011 + (md.phase ?? 0));
          const rattle = Math.sin(t / 45 + x * 0.1) * 1.2 * Math.min(1, Math.abs(vx) * 1.5);
          const w = 124, h = w * cart.naturalHeight / cart.naturalWidth;
          ctx.save();
          ctx.translate(x, y + 22);
          ctx.rotate(vx * 0.06);
          ctx.drawImage(cart, -w / 2, -h + rattle, w, h);
          ctx.restore();
          break;
        }
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.moveTo(-55, -17);
        ctx.lineTo(-42, 17);
        ctx.lineTo(42, 17);
        ctx.lineTo(55, -17);
        ctx.closePath();
        ctx.fillStyle = '#92400e';
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'ice':
        if (!drawStrip(ctx, b, 'strip-ice')) drawPipe(ctx, b, '#7dd3fc', '#38bdf8');
        break;
      case 'wall': {
        // outer boundary walls live under the cliff skin
        if (b.position.x < 0 || b.position.x > W) { if (sprite('cliff-left')) break; }
        const f = bodyFrame(b);
        if (Math.min(f.maxV - f.minV, f.maxU - f.minU) <= 30 && drawRail(ctx, b, 'rail-wood', undefined, 1.25)) break;
        if (drawStrip(ctx, b, 'strip-metal')) break;
        polygon(ctx, b);
        ctx.fillStyle = '#2b3652';
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'spinner': {
        const blade = sprite('spinner-blade');
        if (blade) {
          const f = bodyFrame(b);
          const lw = (f.maxU - f.minU) * 1.08;
          const lh = lw * blade.naturalHeight / blade.naturalWidth;
          drawSprite(ctx, 'spinner-blade', b.position.x, b.position.y, lw, lh, b.angle);
          break;
        }
        if (!drawStrip(ctx, b, 'strip-red')) {
          polygon(ctx, b);
          ctx.fillStyle = '#f43f5e';
          ctx.fill();
          ctx.strokeStyle = '#881337';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        if (drawSprite(ctx, 'bumper-spiked', b.position.x, b.position.y, 30, 26)) break;
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#fecdd3';
        ctx.fill();
        break;
      }
      case 'peg': {
        const r = md.radius ?? 11;
        if (drawSprite(ctx, 'bumper-crown', b.position.x, b.position.y, r * 2.9, r * 2.35)) break;
        const pg = ctx.createRadialGradient(b.position.x - 3, b.position.y - 3, 1, b.position.x, b.position.y, r);
        pg.addColorStop(0, '#94a3b8');
        pg.addColorStop(1, '#334155');
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, r, 0, Math.PI * 2);
        ctx.fillStyle = pg;
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        break;
      }
      case 'breakable': {
        const ratio = (md.hp ?? 1) / (md.maxHp ?? 1);
        const { min, max } = b.bounds;
        const crate = sprite('crate-tall');
        if (crate) ctx.drawImage(crate, min.x - (max.x - min.x) * 0.3, min.y - 6, (max.x - min.x) * 1.6, (max.y - min.y) + 12);
        else if (!drawStrip(ctx, b, 'crate', { tile: 40 })) {
          polygon(ctx, b);
          ctx.fillStyle = '#b45309';
          ctx.fill();
          ctx.strokeStyle = '#78350f';
          ctx.lineWidth = 2;
          ctx.stroke();
          // brick lines
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 1.5;
          for (let yy = min.y + 12; yy < max.y; yy += 12) {
            ctx.beginPath();
            ctx.moveTo(min.x, yy);
            ctx.lineTo(max.x, yy);
            ctx.stroke();
          }
        }
        // cracks
        if (ratio < 0.99) {
          ctx.strokeStyle = '#fde68a';
          ctx.lineWidth = 1.5;
          const n = Math.ceil((1 - ratio) * 6);
          for (let i = 0; i < n; i++) {
            const sx = min.x + ((i * 37) % (max.x - min.x));
            const sy = min.y + ((i * 53) % (max.y - min.y));
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + 8, sy + 14);
            ctx.lineTo(sx - 4, sy + 26);
            ctx.stroke();
          }
        }
        // requirement label
        ctx.save();
        ctx.translate(b.position.x, crate ? max.y - 16 : b.position.y);
        if (crate) ctx.scale(0.78, 0.78);
        ctx.fillStyle = '#fff7ed';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(8,20,32,0.7)';
        ctx.fillRect(-13, -21, 26, 44);
        ctx.fillStyle = '#fff7ed';
        ctx.fillText('⚖', 0, -12);
        ctx.fillText(`${md.req}`, 0, 4);
        ctx.font = '8px system-ui';
        ctx.fillText('WT', 0, 16);
        ctx.restore();
        break;
      }
      case 'pad': {
        const pulse = 0.6 + 0.4 * Math.sin(t / 150);
        const sheep = sprite('sheep-spring');
        if (sheep) {
          // the whole sheep-on-a-spring: its woolly back (16% down the art, wool centred at 42% across) is the pad surface
          const f = bodyFrame(b);
          const w = (f.maxU - f.minU) * 1.55;
          const h = w * sheep.naturalHeight / sheep.naturalWidth;
          const squash = 1 + 0.03 * Math.sin(t / 120);
          const face = (md.dir?.x ?? 1) < 0 ? -1 : 1;
          ctx.save();
          ctx.translate(b.position.x, b.position.y - (f.maxV - f.minV) / 2);
          ctx.rotate(b.angle);
          ctx.scale(face, squash);
          ctx.drawImage(sheep, -w * 0.42, -h * 0.16, w, h);
          ctx.restore();
          break;
        }
        polygon(ctx, b);
        if (!drawStrip(ctx, b, 'strip-hazard')) {
          ctx.fillStyle = '#065f46';
          ctx.fill();
        }
        ctx.strokeStyle = `rgba(52,211,153,${pulse})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = `rgba(110,231,183,${pulse})`;
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('▲ BOUNCE ▲', b.position.x, b.position.y);
        break;
      }
      case 'boost': {
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        const w = (b.bounds.max.x - b.bounds.min.x);
        const h = (b.bounds.max.y - b.bounds.min.y);
        // compute local dims from vertices
        const v = b.vertices;
        const lw = Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y);
        const lh = Math.hypot(v[2].x - v[1].x, v[2].y - v[1].y);
        void w;
        void h;
        const chevron = sprite('rail-chevron');
        if (chevron) {
          // chevron planks laid along the boost direction; wide zones get several rows
          const rows = Math.max(1, Math.round(lh / 44));
          const th = Math.min(30, lh / rows * 0.8);
          const ph = chevron.naturalHeight * th / chevron.naturalHeight;
          ctx.globalAlpha = 0.9;
          for (let r = 0; r < rows; r++) {
            const cy = -lh / 2 + (r + 0.5) * lh / rows - ph / 2;
            ctx.drawImage(chevron, -lw / 2, cy, lw, ph);
          }
          ctx.globalAlpha = 1;
          const sweep = ((t / 700) % 1) * lw * 1.4 - lw * 0.7;
          const shine = ctx.createLinearGradient(sweep - 30, 0, sweep + 30, 0);
          shine.addColorStop(0, 'rgba(255,237,213,0)');
          shine.addColorStop(0.5, 'rgba(255,237,213,0.45)');
          shine.addColorStop(1, 'rgba(255,237,213,0)');
          ctx.fillStyle = shine;
          ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
          ctx.restore();
          break;
        }
        const redStrip = sprite('strip-red');
        if (redStrip) ctx.drawImage(redStrip, -lw / 2, -lh / 2, lw, lh);
        ctx.fillStyle = 'rgba(249,115,22,0.18)';
        ctx.fillRect(-lw / 2, -lh / 2, lw, lh);
        ctx.strokeStyle = 'rgba(251,146,60,0.5)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-lw / 2, -lh / 2, lw, lh);
        // animated chevrons pointing along +x local
        const phase = (t / 400) % 1;
        const n = Math.max(2, Math.floor(lw / 26));
        for (let i = 0; i < n; i++) {
          const px = -lw / 2 + ((i + phase) / n) * lw;
          const alpha = 0.4 + 0.6 * ((i + phase) / n);
          ctx.strokeStyle = `rgba(253,186,116,${alpha})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(px - 6, -lh / 2 + 6);
          ctx.lineTo(px + 4, 0);
          ctx.lineTo(px - 6, lh / 2 - 6);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      case 'itembox': {
        if (!md.active) {
          ctx.beginPath();
          ctx.arc(b.position.x, b.position.y, 17, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(250,204,21,0.25)';
          ctx.setLineDash([3, 4]);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        ctx.save();
        ctx.translate(b.position.x, b.position.y + Math.sin(t / 300) * 3);
        ctx.rotate(Math.sin(t / 500) * 0.3);
        const ig = ctx.createLinearGradient(-17, -17, 17, 17);
        ig.addColorStop(0, '#fde047');
        ig.addColorStop(1, '#f59e0b');
        if (!drawSprite(ctx, 'crate', 0, 0, 34, 30)) {
          ctx.beginPath();
          ctx.roundRect(-15, -15, 30, 30, 7);
          ctx.fillStyle = ig;
          ctx.fill();
          ctx.strokeStyle = '#fff7ed';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 4;
        ctx.font = 'bold 20px system-ui';
        ctx.strokeText('?', 0, 1);
        ctx.fillStyle = '#fde047';
        ctx.font = 'bold 20px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 1);
        ctx.restore();
        break;
      }
      case 'finish':
        break;
      default:
        break;
    }
  }

  // marbles (player drawn last)
  const sorted = [...game.marbles].sort((a, b) => Number(a.info.isPlayer) - Number(b.info.isPlayer));
  for (const m of sorted) {
    const p = m.body.position;
    if (p.y < viewTop || p.y > viewBottom) continue;
    drawMarble(ctx, game, m, t);
  }

  // effects
  for (const e of game.effects) {
    const k = e.ttl / e.maxTtl;
    switch (e.type) {
      case 'ring': {
        ctx.beginPath();
        ctx.arc(e.x, e.y, (1 - k) * 120 + 10, 0, Math.PI * 2);
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = k;
        ctx.lineWidth = 4 * k + 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'flash': {
        ctx.beginPath();
        ctx.arc(e.x, e.y, (1 - k) * 14 + 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${k * 0.7})`;
        ctx.fill();
        break;
      }
      case 'beam': {
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x2 ?? e.x, e.y2 ?? e.y);
        ctx.strokeStyle = e.color;
        ctx.globalAlpha = k;
        ctx.lineWidth = 6 * k + 1;
        ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * k;
        ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case 'debris':
      case 'snow': {
        ctx.fillStyle = e.color;
        ctx.globalAlpha = k;
        for (const p of e.particles ?? []) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.s * k, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'text': {
        ctx.save();
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        const ty = e.y - (1 - k) * 30;
        ctx.strokeText(e.text ?? '', e.x, ty);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text ?? '', e.x, ty);
        ctx.restore();
        break;
      }
      default:
        break;
    }
  }

  // side walls: plain metal plates until the cliff skin loads (drawn in drawSides)
  const cliff = sprite('cliff-left');
  const plate = sprite('tile-metal');
  const platePattern = plate ? ctx.createPattern(plate, 'repeat') : null;
  if (platePattern) platePattern.setTransform(new DOMMatrix().scaleSelf(40 / plate!.naturalWidth, 40 / plate!.naturalWidth));
  ctx.fillStyle = platePattern ?? '#1e2942';
  if (!cliff) {
    ctx.fillRect(-40, viewTop, 40, viewBottom - viewTop);
    ctx.fillRect(W, viewTop, 40, viewBottom - viewTop);
  }
  if (!cliff) {
    ctx.fillStyle = '#334155';
    ctx.fillRect(-6, viewTop, 6, viewBottom - viewTop);
    ctx.fillRect(W, viewTop, 6, viewBottom - viewTop);
  }

  ctx.restore();

  // fast blurred foreground silhouettes; skipped for reduced motion and in static previews
  if (options.shake !== false) drawForeground(ctx, game, cam, cw, ch);

  if (options.minimap !== false && ch > 240) drawMinimap(ctx, game, cw, ch);
}

/** Art skin drawn over the physics vectors. Each sprite is optional; missing art falls back to the vector look. */
function drawDecor(ctx: CanvasRenderingContext2D, game: Game, viewTop: number, viewBottom: number) {
  for (const d of game.track.decor) {
    if (d.type !== 'loop' || d.y + d.r * 2 < viewTop || d.y - d.r * 2 > viewBottom) continue;
    const img = sprite('loop-ring');
    if (!img) continue;
    // The ring's hole (131x135 px, centred at 127,121.5 in the 255x242 art) is scaled onto the physics running surface.
    const inner = d.r * 2 + 4;
    const kx = inner / 131, ky = inner / 135;
    ctx.drawImage(img, d.x - 127 * kx, d.y - 121.5 * ky, img.naturalWidth * kx, img.naturalHeight * ky);
  }
}

const blurred = new Map<string, HTMLCanvasElement>();
/** Cheap, portable blur: shrink the sprite hard, darken it, and let the browser smooth it back up when drawn. */
function blurredSprite(name: string): HTMLCanvasElement | null {
  const hit = blurred.get(name);
  if (hit) return hit;
  const img = sprite(name);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = Math.max(4, Math.round(img.naturalWidth / 5));
  c.height = Math.max(4, Math.round(img.naturalHeight / 5));
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(10,6,4,0.55)';
  g.fillRect(0, 0, c.width, c.height);
  // upsample in two passes so the result is a soft blur rather than bilinear blocks
  const mid = document.createElement('canvas');
  mid.width = c.width * 2;
  mid.height = c.height * 2;
  const m = mid.getContext('2d')!;
  m.imageSmoothingQuality = 'high';
  m.drawImage(c, 0, 0, mid.width, mid.height);
  if (name.startsWith('tower')) {
    // soft top and bottom so stacked scaffold sections blend into one continuous column
    m.globalCompositeOperation = 'destination-in';
    const fade = m.createLinearGradient(0, 0, 0, mid.height);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(0.12, 'rgba(0,0,0,1)');
    fade.addColorStop(0.88, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    m.fillStyle = fade;
    m.fillRect(0, 0, mid.width, mid.height);
  }
  blurred.set(name, mid);
  return mid;
}

const FOREGROUND = ['tower-1', 'banner', 'tower-3', 'torch', 'tower-2', 'wrecking-ball', 'tower-4', 'banner'];
const FG_PARALLAX = 2.2;
const FG_GAP = 2600;
/** Scaffold columns are a run of stacked sections (overlapping at their faded ends) rather than one floating piece. */
const FG_TOWER_SECTIONS = 3;
const FG_TOWER_OVERLAP = 0.14;

/** Big out-of-focus props sweeping past the screen edges faster than the track, for a sense of speed and depth. */
function drawForeground(ctx: CanvasRenderingContext2D, game: Game, cam: Camera, cw: number, ch: number) {
  const v = cam.y * FG_PARALLAX;
  const seed = game.track.seed;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  for (let i = Math.floor((v - ch * 4) / FG_GAP); i * FG_GAP - v < ch * 2; i++) {
    if (hash01(seed, i, 31) < 0.3) continue;
    const name = FOREGROUND[Math.floor(hash01(seed, i, 32) * FOREGROUND.length)];
    const img = blurredSprite(name);
    if (!img) continue;
    const left = hash01(seed, i, 33) < 0.5;
    const tall = name.startsWith('tower');
    const h = tall ? ch * 1.2 : ch * (0.4 + hash01(seed, i, 34) * 0.15);
    const w = h * img.width / img.height;
    const y = i * FG_GAP - v + hash01(seed, i, 35) * 400;
    const sections = tall ? FG_TOWER_SECTIONS : 1;
    const step = h * (1 - FG_TOWER_OVERLAP);
    if (y > ch || y + step * (sections - 1) + h < 0) continue;
    // hug the screen edge so the racing line stays clear
    const x = left ? cw * 0.04 - w * 0.2 : cw * 0.96 - w * 0.8;
    ctx.globalAlpha = tall ? 1 : 0.85;
    ctx.save();
    if (!left) {
      ctx.translate(x + w, 0);
      ctx.scale(-1, 1);
    } else ctx.translate(x, 0);
    for (let k = 0; k < sections; k++) {
      const sy = y + k * step;
      if (sy > ch || sy + h < 0) continue;
      // alternate section art so the column does not look copy-pasted
      const part = tall ? blurredSprite(TOWERS[Math.floor(hash01(seed, i * 7 + k, 36) * TOWERS.length)]) ?? img : img;
      ctx.drawImage(part, 0, sy, h * part.width / part.height, h);
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Deterministic 0..1 hash so side scenery stays put for a given circuit. */
function hash01(a: number, b: number, c: number) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const TOWERS = ['tower-1', 'tower-2', 'tower-3', 'tower-4'];
const BALCONIES = ['balcony-crowd', 'balcony-horn', 'balcony-cannon'];

/**
 * Scenery outside the side walls: tileable rock behind, a cliff edge facing the track, scaffold towers bolted to it,
 * goblin balconies at sector starts and flickering torches. The right side is the left side mirrored about the track.
 */
function drawSidesStatic(ctx: CanvasRenderingContext2D, game: Game, viewTop: number, viewBottom: number) {
  const rock = sprite('rock-fill');
  const cliffL = sprite('cliff-left');
  const cliffR = sprite('cliff-right');
  if (!rock || !cliffL) return;
  const seed = game.track.seed;
  for (const side of [0, 1] as const) {
    ctx.save();
    if (side === 1) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    // everything below is authored for the left side (track to the right, x = 0 is the wall)
    const rw = 300, rh = rw * rock.naturalHeight / rock.naturalWidth;
    for (let y = Math.floor(viewTop / rh) * rh; y < viewBottom; y += rh) {
      for (let x = STATIC_X0 - rw; x < -200; x += rw) ctx.drawImage(rock, x, y, rw, rh);
    }
    ctx.fillStyle = 'rgba(6,16,36,0.45)';
    ctx.fillRect(STATIC_X0, viewTop, -200 - STATIC_X0, viewBottom - viewTop);
    // above ground: cliffs, scaffold towers and balconies; underground: mine walls
    const ug = undergroundY(game);
    ctx.save();
    ctx.beginPath();
    ctx.rect(STATIC_X0 - 10, viewTop, 1000, Math.max(0, Math.min(viewBottom, ug) - viewTop));
    ctx.clip();
    const edge = side === 1 && cliffR ? cliffR : cliffL;
    const cw = 300, chh = cw * edge.naturalHeight / edge.naturalWidth;
    for (let y = Math.floor(viewTop / chh) * chh; y < viewBottom; y += chh) {
      if (side === 1 && cliffR) {
        // the right-hand art already faces left; undo the mirror for it
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(cliffR, -10, y, cw, chh);
        ctx.restore();
      } else ctx.drawImage(cliffL, -cw + 10, y, cw, chh);
    }
    // scaffold towers
    const th = 540;
    for (let i = Math.floor(viewTop / th); i * th < viewBottom; i++) {
      const name = TOWERS[Math.floor(hash01(seed, i, side) * TOWERS.length)];
      const img = sprite(name);
      if (!img) continue;
      const tw = th * img.naturalWidth / img.naturalHeight;
      ctx.drawImage(img, -tw + 22, i * th, tw, th);
    }
    // goblin balconies at sector starts, alternating sides
    game.track.segments.forEach((seg, i) => {
      if (i === 0 || (i + side) % 2 === 1) return;
      if (seg.y + 200 < viewTop || seg.y > viewBottom) return;
      const name = BALCONIES[Math.floor(hash01(seed, i, 7) * BALCONIES.length)];
      const img = sprite(name);
      if (!img) return;
      const bh = 150, bw = bh * img.naturalWidth / img.naturalHeight;
      ctx.drawImage(img, -bw - 60, seg.y + 30, bw, bh);
    });
    ctx.restore();
    if (viewBottom > ug) {
      const mh = 680;
      for (let k = Math.max(0, Math.floor((viewTop - ug) / mh)); ug + k * mh < viewBottom; k++) {
        // mostly miners and skeleton guards, sometimes bare rock
        const img = sprite(hash01(seed, k, side + 21) < 0.7 ? 'mine-wall' : 'mine-edge');
        if (img) ctx.drawImage(img, -300 + 14, ug + k * mh, 300, mh + 1);
      }
    }
    const torch = sprite('torch');
    if (torch) for (const y of torchRows(seed, side, viewTop, viewBottom)) ctx.drawImage(torch, -8, y - 40, 42, 78);
    ctx.restore();
  }
}

/** World y where the side scenery switches from cliffs to mine walls, matching the backdrop's descent. */
function undergroundY(game: Game) {
  return Math.round(game.track.height * 0.52 / 600) * 600;
}

const TORCH_GAP = 460;
function torchRows(seed: number, side: number, top: number, bottom: number): number[] {
  const rows: number[] = [];
  for (let i = Math.floor((top - 400) / TORCH_GAP); i * TORCH_GAP < bottom; i++) rows.push(i * TORCH_GAP + 180 + hash01(seed, i, side + 11) * 120);
  return rows;
}

const colorGlows = new Map<string, HTMLCanvasElement>();
/** Soft radial glow in a peg colour, baked once per colour. */
function colorGlow(color: string): HTMLCanvasElement {
  let c = colorGlows.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 7, 32, 32, 32);
    grad.addColorStop(0, color + 'aa');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    colorGlows.set(color, c);
  }
  return c;
}

let glow: HTMLCanvasElement | null = null;
/** Warm radial glow baked once; drawn with a flickering alpha for torches and fire hoops. */
function glowSprite(): HTMLCanvasElement {
  if (glow) return glow;
  glow = document.createElement('canvas');
  glow.width = glow.height = 128;
  const g = glow.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 3, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,170,70,0.42)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return glow;
}

function drawTorchGlows(ctx: CanvasRenderingContext2D, game: Game, viewTop: number, viewBottom: number, t: number) {
  if (!sprite('cliff-left')) return;
  for (const side of [0, 1]) {
    for (const [i, y] of torchRows(game.track.seed, side, viewTop, viewBottom).entries()) {
      const flick = 0.8 + 0.2 * Math.sin(t / 70 + i * 3.1) * Math.sin(t / 23 + side);
      const r = 110 * flick;
      const x = side ? W - 10 : 10;
      ctx.globalAlpha = flick;
      ctx.drawImage(glowSprite(), x - r, y - 22 - r, r * 2, r * 2);
    }
  }
  ctx.globalAlpha = 1;
}

/** Bodies that never move or change; they are baked into the static layer instead of redrawn every frame. */
const STATIC_KINDS = new Set<string | undefined>(['ramp', 'ice', 'wall', 'loop']);
const CHUNK_H = 1024;
const STATIC_X0 = -400;
const STATIC_W = W - STATIC_X0 * 2;
const STATIC_PAD = 2;
/** Art the static layer depends on; chunks are only cached once all of it has loaded. */
const STATIC_ART = ['tile-metal', 'mine-wall', 'mine-edge', 'rail-wood', 'strip-ice', 'loop-ring', 'rock-fill', 'cliff-left', 'cliff-right', 'tower-1', 'tower-2', 'tower-3', 'tower-4', 'balcony-crowd', 'balcony-horn', 'balcony-cannon', 'torch', 'goblin-crowd', 'flag-race'];

/** Everything in the static layer, painted in world space between top and bottom. */
function paintStatic(ctx: CanvasRenderingContext2D, game: Game, top: number, bottom: number) {
  const theme = game.track.theme;
  // track interior: semi-opaque so the backdrop faintly shows through
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = theme.track;
  ctx.fillRect(0, top, W, bottom - top);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gy = Math.floor(top / 100) * 100; gy < bottom; gy += 100) {
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(158,190,211,0.12)';
  for (let gy = Math.floor(top / 50) * 50; gy < bottom; gy += 50) {
    for (let gx = 25; gx < W; gx += 50) ctx.fillRect(gx, gy, 1.5, 1.5);
  }

  drawSidesStatic(ctx, game, top, bottom);
  drawDecor(ctx, game, top, bottom);

  const fy = game.track.finishY;
  if (fy + 100 > top && fy - 100 < bottom) {
    const sq = 15;
    for (let i = 0; i < W / sq; i++)
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 === 0 ? '#f8fafc' : '#0f172a';
        ctx.fillRect(i * sq, fy - sq + j * sq, sq, sq);
      }
    for (const side of [0, 1]) {
      ctx.save();
      if (side) {
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
      }
      // cheering goblins on the grandstand just outside the wall
      drawSprite(ctx, 'goblin-crowd', -70, fy - 32, 150, 64);
      if (!drawSprite(ctx, 'flag-race', 40, fy - 48, 74, 64)) drawSprite(ctx, 'flag-checker', 34, fy - 44, 56, 52);
      ctx.restore();
    }
  }

  // minecart rails under each peg board
  for (const bk of game.track.buckets) {
    const ry = (meta(bk).baseY ?? bk.position.y) + 22;
    if (ry < top - 40 || ry > bottom + 40) continue;
    ctx.fillStyle = '#3b2414';
    for (let rx = 40; rx <= W - 40; rx += 26) ctx.fillRect(rx - 3, ry - 1, 6, 10);
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(30, ry - 3, W - 60, 4);
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(30, ry - 3, W - 60, 1.5);
    drawSprite(ctx, 'tile-metal', 30, ry, 16, 18);
    drawSprite(ctx, 'tile-metal', W - 30, ry, 16, 18);
  }

  const cliffs = !!sprite('cliff-left');
  for (const b of game.track.bodies) {
    const md = meta(b);
    if (!STATIC_KINDS.has(md?.kind)) continue;
    if (b.bounds.max.y < top - 60 || b.bounds.min.y > bottom + 60) continue;
    switch (md.kind) {
      case 'ramp':
        if (!drawRail(ctx, b, 'rail-wood', md.caps) && !drawStrip(ctx, b, 'strip-wood')) drawPipe(ctx, b, theme.pipe, theme.pipeEdge);
        break;
      case 'ice':
        if (!drawStrip(ctx, b, 'strip-ice')) drawPipe(ctx, b, '#7dd3fc', '#38bdf8');
        break;
      case 'loop':
        // hidden under the loop ring skin once it has loaded
        if (sprite('loop-ring')) break;
        if (!drawStrip(ctx, b, 'strip-metal')) drawPipe(ctx, b, theme.pipe, theme.pipeEdge);
        break;
      case 'wall': {
        // outer boundary walls live under the cliff skin
        if ((b.position.x < 0 || b.position.x > W) && cliffs) break;
        const f = bodyFrame(b);
        if (Math.min(f.maxV - f.minV, f.maxU - f.minU) <= 30 && drawRail(ctx, b, 'rail-wood', undefined, 1.25)) break;
        if (drawStrip(ctx, b, 'strip-metal')) break;
        polygon(ctx, b);
        ctx.fillStyle = '#2b3652';
        ctx.fill();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
    }
  }
}

interface StaticChunk { canvas: HTMLCanvasElement; used: number }
const chunkCaches = new WeakMap<Game, Map<string, StaticChunk>>();
const MAX_CHUNKS = 5;

function bakeChunk(game: Game, index: number, res: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(STATIC_W * res);
  c.height = Math.ceil((CHUNK_H + STATIC_PAD * 2) * res);
  const g = c.getContext('2d')!;
  g.scale(res, res);
  g.translate(-STATIC_X0, -(index * CHUNK_H - STATIC_PAD));
  const top = index * CHUNK_H - STATIC_PAD;
  const bottom = top + CHUNK_H + STATIC_PAD * 2;
  g.beginPath();
  g.rect(STATIC_X0, top, STATIC_W, bottom - top);
  g.clip();
  paintStatic(g, game, top, bottom);
  return c;
}

/**
 * The static layer is cut into horizontal chunks baked at the current on-screen resolution. Visible chunks are baked on
 * demand; at most one extra chunk ahead of the camera is pre-baked per frame so crossing a boundary does not hitch.
 */
function drawStaticLayer(ctx: CanvasRenderingContext2D, game: Game, viewTop: number, viewBottom: number) {
  const artReady = STATIC_ART.every((n) => !!sprite(n));
  if (!artReady || typeof document === 'undefined') {
    paintStatic(ctx, game, viewTop, viewBottom);
    return;
  }
  const dpr = Math.abs(ctx.getTransform().a) || 1; // includes camera scale at this point
  const res = Math.max(0.5, Math.min(1.5, Math.round(dpr * 4) / 4));
  let cache = chunkCaches.get(game);
  if (!cache) {
    cache = new Map();
    chunkCaches.set(game, cache);
  }
  const now = performance.now();
  const get = (index: number) => {
    const key = `${index}@${res}`;
    let chunk = cache!.get(key);
    if (!chunk) {
      chunk = { canvas: bakeChunk(game, index, res), used: now };
      cache!.set(key, chunk);
      if (cache!.size > MAX_CHUNKS) {
        const oldest = [...cache!.entries()].sort((a, b) => a[1].used - b[1].used)[0];
        cache!.delete(oldest[0]);
      }
    }
    chunk.used = now;
    return chunk.canvas;
  };
  const first = Math.floor(viewTop / CHUNK_H), last = Math.floor(viewBottom / CHUNK_H);
  for (let i = first; i <= last; i++) {
    if (i * CHUNK_H > game.track.height + 400 || (i + 1) * CHUNK_H < -400) continue;
    // draw only the core of each chunk (the padding just gives clean edge sampling), so semi-transparent fills never double up
    const canvas = get(i);
    const k = canvas.height / (CHUNK_H + STATIC_PAD * 2);
    ctx.drawImage(canvas, 0, STATIC_PAD * k, canvas.width, CHUNK_H * k, STATIC_X0, i * CHUNK_H, STATIC_W, CHUNK_H);
  }
  // pre-bake the next chunk below the camera (the field only ever travels down)
  const ahead = last + 1;
  if (ahead * CHUNK_H < game.track.height + 400 && !cache.has(`${ahead}@${res}`)) get(ahead);
  // beyond the baked strip, keep the rock colour so wide zoomed-out views stay filled
  ctx.fillStyle = '#1a140f';
  ctx.fillRect(STATIC_X0 - 2000, viewTop, 2000, viewBottom - viewTop);
  ctx.fillRect(STATIC_X0 + STATIC_W, viewTop, 2000, viewBottom - viewTop);
}

function drawMinimap(ctx: CanvasRenderingContext2D, game: Game, cw: number, ch: number) {
  const mh = ch - 140;
  const mx = cw - 26;
  const my = 70;
  const H = game.track.height;
  ctx.save();
  ctx.fillStyle = 'rgba(15,23,42,0.7)';
  ctx.beginPath();
  ctx.roundRect(mx - 14, my - 10, 28, mh + 20, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // segments ticks
  for (const s of game.track.segments) {
    const yy = my + (s.y / H) * mh;
    ctx.fillStyle = 'rgba(148,163,184,0.25)';
    ctx.fillRect(mx - 8, yy, 16, 1);
  }
  // finish
  const fy = my + (game.track.finishY / H) * mh;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(mx - 9, fy - 1, 18, 3);
  // marbles
  const list = [...game.marbles].sort((a, b) => Number(a.info.isPlayer) - Number(b.info.isPlayer));
  for (const m of list) {
    const yy = my + Math.max(0, Math.min(1, m.body.position.y / H)) * mh;
    const xx = mx + ((m.body.position.x / W) - 0.5) * 14;
    ctx.beginPath();
    ctx.arc(xx, yy, m.info.isPlayer ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = m.info.color;
    ctx.fill();
    if (m.info.isPlayer) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.restore();
}
