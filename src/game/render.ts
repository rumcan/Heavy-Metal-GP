import Matter from 'matter-js';
import { Game, Marble } from './engine';
import { hingeTimerState, hingeIsOpen, trapdoorWarn, pistonState, beltDir } from './elements';
import { meta, W, cannonAim } from './track';
import { MARBLE_RADIUS, ITEM_INFO, skinFor, themeIdFor } from './types';
import { ballFor, bodyFrame, contentBox, currentSkin, drawRail, drawSprite, drawStrip, setSkin, sprite } from './sprites';
import { windFanAnchor } from '../components/editor/bounds';
import { CATAPULT_ARM, CATAPULT_BASE, CATAPULT_ARM_AXIS, CATAPULT_ARM_LENGTH, catapultArtAngle, flipperArtAngle, flipperArtRect, warDrumArtRect, warDrumArtAngle } from './launcher-art';
import repeatingBgUrl from '../assets/bg/repeating.webp';
import mineEntranceUrl from '../assets/bg/mine-entrance.webp';
import mineUrl from '../assets/bg/mine.webp';

/**
 * drawSprite, but the rectangle names where the sprite's *visible content*
 * should land rather than its letterboxed frame — the slicing pipeline pads
 * some art with transparent margins (cannon above all), so a frame-centred
 * draw leaves the painted machine floating short of its anchor. False until
 * the art loads, so callers keep their vector fallback.
 */
function drawSpriteContent(ctx: CanvasRenderingContext2D, name: string, x0: number, y0: number, x1: number, y1: number): boolean {
  const cb = contentBox(name);
  if (!cb) return false;
  const cw = cb.x1 - cb.x0, ch = cb.y1 - cb.y0;
  if (cw <= 0 || ch <= 0) return false;
  const w = (x1 - x0) / cw, h = (y1 - y0) / ch;
  return drawSprite(ctx, name, x0 - cb.x0 * w + w / 2, y0 - cb.y0 * h + h / 2, w, h);
}

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
  // Art themes bring one seamless tile that repeats all the way down (no sky -> mine descent).
  const skin = currentSkin();
  const skinTile = skin ? sprite('backdrop') : null;
  if (skin && skinTile) {
    const dpr = ctx.getTransform().a || 1;
    const tw = Math.max(cw, 600);
    const th = tw * (skinTile.naturalHeight / skinTile.naturalWidth);
    const v = cam.y * 0.18;
    const x = (cw - tw) / 2;
    const tile = tintedTile(skinTile, `skin:${skin}`, tw * dpr, 'rgba(20,10,6,0.45)');
    for (let row = Math.floor(v / th); row * th - v < ch; row++) ctx.drawImage(tile, x, row * th - v, tw, th + 1);
    ctx.drawImage(vignetteFor(cw, ch), 0, 0, cw, ch);
    return;
  }
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
  // Humans (online) get a big, bold tag in their livery; AI drivers a small grey one.
  const human = m.info.isPlayer || m.info.isHuman === true;
  const size = human ? 15 : 10;
  ctx.font = `${human ? 'bold ' : ''}${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = m.info.isPlayer ? 'YOU' : human ? m.info.name.toUpperCase() : m.info.name;
  const tw = ctx.measureText(label).width;
  const boxH = size + 4;
  ctx.fillStyle = human ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.roundRect(x - tw / 2 - 5, y - r - 6 - boxH, tw + 10, boxH, 4);
  ctx.fill();
  if (human) {
    ctx.strokeStyle = m.info.color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = human ? '#fff' : '#b8c2cf';
  ctx.fillText(label, x, y - r - 7);
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

export function render(ctx: CanvasRenderingContext2D, game: Game, cam: Camera, cw: number, ch: number, t: number, options: { minimap?: boolean; shake?: boolean; workshopPreview?: boolean } = {}) {
  ctx.clearRect(0, 0, cw, ch);

  const theme = game.track.theme;
  // Art themes swap in their own sprites; everything else draws the goblin art.
  setSkin(skinFor(themeIdFor(theme)));
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

  drawSkinRockOuter(ctx, viewLeft, viewRight, viewTop, viewBottom);
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
    const md = meta(b);
    // Workshop bodies stay at rest while their artwork previews the swing.
    const artReach = md?.catapult ? md.catapult.len * 1.4 : md?.flipper?.len ?? 0;
    if (b.bounds.max.y + artReach < viewTop || b.bounds.min.y - artReach > viewBottom) continue;
    if (b.bounds.max.x + artReach < viewLeft || b.bounds.min.x - artReach > viewRight) continue;
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
          // squash about the base of the art (84% below the pad surface) so the base stays planted and the top bobs
          ctx.translate(0, h * 0.84);
          ctx.scale(face, squash);
          ctx.drawImage(sheep, -w * 0.42, -h, w, h);
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
      // ---- MB-10A: shortcuts and secrets ----
      case 'barricade':
        drawBarricade(ctx, b, md);
        break;
      case 'crumble':
        drawCrumble(ctx, b, md, game, t);
        break;
      case 'tunnel':
        drawTunnel(ctx, b, md, t);
        break;
      case 'trapdoor':
        drawTrapdoor(ctx, b, md, game, t);
        break;
      case 'switch':
        drawSwitchBlade(ctx, b, md, game, t);
        break;
      case 'switchPad':
        drawSwitchPad(ctx, b, md, game, t);
        break;
      // ---- MB-10B: blades and crushers ----
      case 'blade':
        drawBlade(ctx, b, md, t);
        break;
      case 'saw':
        drawSaw(ctx, b, md, t);
        break;
      case 'crusher':
        drawCrusher(ctx, b, md, game, t);
        break;
      case 'boulder':
        drawBoulder(ctx, b, md);
        break;
      case 'mace':
        drawMace(ctx, b, md, game, t);
        break;
      // ---- MB-10C: mechanical movers ----
      case 'wheel':
        if (!b.isSensor) drawWheel(ctx, b, md, game, t);
        break;
      case 'screw':
        drawScrew(ctx, b, md, t);
        break;
      case 'seesaw':
        drawSeesaw(ctx, b, md);
        break;
      case 'bridge':
        drawBridgePlank(ctx, b, md, game);
        break;
      case 'conveyor':
        drawConveyor(ctx, b, md, game, t);
        break;
      // ---- MB-10D: launchers and pinball ----
      case 'cannon':
        if (!b.isSensor) drawCannon(ctx, b, md, game, t);
        break;
      case 'catapult':
        if (!b.isSensor) drawCatapult(ctx, b, md, game, options.workshopPreview ? t : undefined);
        break;
      case 'flipper':
        drawFlipper(ctx, b, md, game.time, options.workshopPreview ? t : undefined);
        break;
      case 'sling':
        drawSling(ctx, b, md, game, t);
        break;
      case 'scoop':
        drawScoop(ctx, b, md, game, t);
        break;
      // ---- MB-10E: fields and surfaces ----
      case 'wind':
        if (b.isSensor) drawWind(ctx, b, md, game, t);
        break;
      case 'magnet':
        if (b.isSensor) drawMagnet(ctx, b, md, game, t);
        break;
      case 'mud':
        if (b.isSensor) drawMud(ctx, b, md, game, t);
        break;
      case 'pool':
        if (b.isSensor) drawPool(ctx, b, md, game, t);
        break;
      case 'geyser':
        // the geyser metadata rides the blast-column sensor; the mound body
        // below it carries none, so drawing the non-sensor body drew nothing
        if (b.isSensor) drawGeyser(ctx, b, md, game, t);
        break;
      // ---- MB-10F: big set pieces ----
      case 'trampoline':
        drawTrampoline(ctx, b, md, game, t);
        break;
      case 'turnstile':
        drawTurnstile(ctx, b, md, game, t);
        break;
      case 'target':
        drawTargets(ctx, b, md, game, t);
        break;
      case 'vortex':
        if (b.isSensor) drawVortex(ctx, b, md, game, t);
        break;
      case 'platform':
        drawPlatform(ctx, b, md, game, t);
        break;
      default:
        break;
    }
  }

  // marbles (player drawn last)
  const sorted = [...game.marbles].sort((a, b) => Number(a.info.isPlayer) - Number(b.info.isPlayer));
  for (const m of sorted) {
    const p = m.body.position;
    if (m.hold && m.hold.kind === 'tunnel') continue; // hidden inside the cliff (MB-10A); MB-10C movers keep the rider on screen
    if (p.y < viewTop || p.y > viewBottom || game.benched.has(m.info.id)) continue;
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
  const cacheKey = `${currentSkin() ?? 'base'}/${name}`;
  const hit = blurred.get(cacheKey);
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
    // Every theme: a tileable cliff face out from the wall, fading to solid dark brown (the column hides the seam).
    drawSkinRock(ctx, STATIC_X0, viewTop, viewBottom);
    // above ground: cliffs, scaffold towers and balconies; underground: mine walls
    const ug = undergroundY(game);
    ctx.save();
    ctx.beginPath();
    ctx.rect(STATIC_X0 - 10, viewTop, 1000, Math.max(0, Math.min(viewBottom, ug) - viewTop));
    ctx.clip();
    const edge = side === 1 && cliffR ? cliffR : cliffL;
    const cw = 300, chh = cw * edge.naturalHeight / edge.naturalWidth;
    // every theme (goblin art too) now has a two-sided cliff column that hides the seam to the rock behind it
    if (sprite('cliff-column')) drawSkinColumn(ctx, viewTop, viewBottom);
    else for (let y = Math.floor(viewTop / chh) * chh; y < viewBottom; y += chh) {
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
    if (viewBottom > ug && currentSkin() && sprite('cliff-column')) {
      // art themes keep the same cliff column all the way down
      drawSkinColumn(ctx, Math.max(viewTop, ug), viewBottom);
    } else if (viewBottom > ug) {
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

/** Width one tile of the art-theme cliff face is drawn at. */
const CLIFF_W = 300;
/** Colour the far rock fades into (world-space gradient, so static layer and zoomed-out outer parts agree). */
const ROCK_DARK = '#1b120c';
// The fade finishes inside the baked static layer (which ends at STATIC_X0 = -400), so it never cuts off.
const FADE_NEAR = -250, FADE_FAR = -405;

/**
 * Art themes, left side (x < 0): the tileable cliff face from the wall out to `fromX`, then a fade to dark brown
 * that is solid by FADE_FAR. The tile grid and the gradient are anchored in world space so pieces drawn in
 * different passes line up. The vertical cliff column is drawn over the seam by `drawSkinColumn`.
 */
function drawSkinRock(ctx: CanvasRenderingContext2D, fromX: number, top: number, bottom: number) {
  const img = sprite('cliff-face') ?? sprite('rock-fill');
  if (img) {
    const h = CLIFF_W * img.naturalHeight / img.naturalWidth;
    for (let x = -CLIFF_W; x + CLIFF_W > Math.max(fromX, FADE_FAR - CLIFF_W); x -= CLIFF_W - 1) {
      for (let y = Math.floor(top / h) * h; y < bottom; y += h) ctx.drawImage(img, x, y, CLIFF_W, h + 1);
    }
  }
  const g = ctx.createLinearGradient(FADE_NEAR, 0, FADE_FAR, 0);
  g.addColorStop(0, 'rgba(27,18,12,0)');
  g.addColorStop(1, ROCK_DARK);
  ctx.fillStyle = g;
  ctx.fillRect(Math.max(fromX, FADE_FAR), top, FADE_NEAR - Math.max(fromX, FADE_FAR), bottom - top);
  if (fromX < FADE_FAR) {
    ctx.fillStyle = ROCK_DARK;
    ctx.fillRect(fromX, top, FADE_FAR - fromX, bottom - top);
  }
}

/** The vertical cliff column (hard rock edges on both sides) along the wall, in front of the face tiles. */
function drawSkinColumn(ctx: CanvasRenderingContext2D, top: number, bottom: number) {
  const img = sprite('cliff-column');
  if (!img) return;
  // where the art's solid rock ends on its right, as a share of its width (measured from each source image)
  const coreRight = ({ worg: 0.81, dwarven: 0.85 } as Record<string, number>)[currentSkin() ?? ''] ?? 0.86;
  const w = 440, h = w * img.naturalHeight / img.naturalWidth;
  const x = 18 - w * coreRight;
  for (let y = Math.floor(top / h) * h; y < bottom; y += h) ctx.drawImage(img, x, y, w, h + 1);
}

/** Beyond the baked static layer (zoomed far out): keep the rock face going instead of flat darkness. */
function drawSkinRockOuter(ctx: CanvasRenderingContext2D, viewLeft: number, viewRight: number, top: number, bottom: number) {
  for (const side of [0, 1] as const) {
    const reach = side === 0 ? -viewLeft : viewRight - W;
    if (reach <= -STATIC_X0) continue;
    ctx.save();
    if (side === 1) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.beginPath();
    ctx.rect(-reach - 10, top, reach + STATIC_X0 + 12, bottom - top);
    ctx.clip();
    drawSkinRock(ctx, -reach - 20, top, bottom);
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

// ---------------------------------------------------------------------------
// MB-10A: shortcuts and secrets. Every piece keeps a plain-vector fallback so
// the track plays before (and without) the PNG kit art; `sprite()` swaps it in.
// ---------------------------------------------------------------------------

/** A deterministic 0..1 hash per body + salt, so jitter never flickers per-frame. */
function bodyJitter(b: Matter.Body, salt: number): number {
  const x = b.position.x * 12.9898 + b.position.y * 78.233 + salt * 37.719;
  return Math.abs(Math.sin(x) * 43758.5453) % 1;
}

// ---- MB-10B: blades and crushers — all moving parts drawn per frame from the clock ----

/** Swinging axe blade on its iron arm: pivot hub at the top, blade sweeping with the body angle. */
function drawBlade(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, t: number) {
  const motion = md.motion;
  if (!motion || motion.mode !== 'pendulum') return;
  const pv = motion.pivot;
  // swivel mount at the pivot
  drawSprite(ctx, 'tile-metal', pv.x, pv.y, 26, 14);
  ctx.fillStyle = '#374151';
  ctx.beginPath(); ctx.arc(pv.x, pv.y, 5, 0, Math.PI * 2); ctx.fill();
  // arm + axe head (art points down the arm when angle = 0)
  const img = sprite('blade');
  ctx.save();
  ctx.translate(pv.x, pv.y);
  ctx.rotate(b.angle + Math.sin(t / 1600) * 0.004);
  const len = motion.arm;
  if (img) {
    const bw = len * 0.58, bh = img.naturalHeight * (len * 1.18) / img.naturalWidth;
    ctx.drawImage(img, -bw / 2, 0, bw, len * 1.18 > bh ? bh : len * 1.18);
  } else {
    // iron arm
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(-5, 0, 10, len * 0.78);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.strokeRect(-5, 0, 10, len * 0.78);
    // wedge blade: wide crescent at the tip
    ctx.beginPath();
    ctx.moveTo(-len * 0.26, len * 0.66);
    ctx.lineTo(len * 0.26, len * 0.66);
    ctx.lineTo(len * 0.2, len);
    ctx.lineTo(-len * 0.2, len);
    ctx.closePath();
    const grad = ctx.createLinearGradient(-len * 0.26, 0, len * 0.26, 0);
    grad.addColorStop(0, '#9ca3af');
    grad.addColorStop(0.5, '#e5e7eb');
    grad.addColorStop(1, '#6b7280');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // a nick of goblin red at the edge
    ctx.strokeStyle = '#b3261e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-len * 0.19, len - 5);
    ctx.lineTo(len * 0.19, len - 5);
    ctx.stroke();
  }
  ctx.restore();
}

/** Spinning saw disc (red teeth, skull hub), plus the wood-and-iron slot it runs in. */
function drawSaw(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, t: number) {
  const motion = md.motion;
  if (!motion || motion.mode !== 'slide') return;
  const r = motion.r;
  // the slot bed (static path), drawn each frame under the disc — cheap: two rails and shadow
  if (motion.a.x !== motion.b.x || motion.a.y !== motion.b.y) {
    ctx.save();
    ctx.strokeStyle = 'rgba(120,113,108,0.5)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(motion.a.x, motion.a.y);
    ctx.lineTo(motion.b.x, motion.b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  const spin = t * motion.spinW * 0.06 + motion.phaseMs * 0.01;
  const img = sprite('saw');
  if (img) {
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(spin);
    ctx.drawImage(img, -r * 1.25, -r * 1.25, r * 2.5, r * 2.5);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(spin);
  const teeth = 14;
  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const tip = a + Math.PI / teeth * 0.5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(tip) * r * 1.22, Math.sin(tip) * r * 1.22);
  }
  ctx.closePath();
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.strokeStyle = '#7f1d1d';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
  ctx.fillStyle = '#9ca3af';
  ctx.fill();
  ctx.strokeStyle = '#4b5563';
  ctx.stroke();
  // skull hub
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#f3e9cf';
  ctx.fill();
  ctx.fillStyle = '#1f2937';
  ctx.beginPath(); ctx.arc(-r * 0.11, -r * 0.05, r * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.11, -r * 0.05, r * 0.07, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Crusher piston: housing at the top, hanging stamper; warning glow + shadow while it arms. */
function drawCrusher(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, game: Game, t: number) {
  const motion = md.motion;
  if (!motion || motion.mode !== 'piston') return;
  const st = pistonState(motion, game.time);
  const { min, max } = b.bounds;
  const w = max.x - min.x;
  const floorY = motion.top.y + 22 + motion.travel + 22;
  // shadow of the falling plate on the deck, growing with the drop
  ctx.save();
  ctx.globalAlpha = 0.16 + st.k * 0.3;
  ctx.fillStyle = '#0b1120';
  ctx.beginPath();
  ctx.ellipse((min.x + max.x) / 2, floorY, w / 2 * (0.5 + st.k * 0.5), 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // hazard plate at the deck line
  hazardStripe(ctx, min.x - 12, floorY + 6, w + 24, 12, '#eab308');
  // housing: iron cylinder the piston drops out of
  const houseImg = sprite('crusher-house');
  if (houseImg) {
    ctx.drawImage(houseImg, min.x - 10, motion.top.y - 58, w + 20, 60);
  } else {
    ctx.fillStyle = '#3f4653';
    ctx.fillRect(min.x - 8, motion.top.y - 56, w + 16, 58);
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 3;
    ctx.strokeRect(min.x - 8, motion.top.y - 56, w + 16, 58);
    ctx.fillStyle = '#576072';
    for (let x = min.x; x < max.x - 8; x += 22) ctx.fillRect(x, motion.top.y - 52, 5, 50);
  }
  // the stamper block
  const img = sprite('crusher');
  const warn = st.warn ? 0.5 + 0.5 * Math.sin(t / 90) : 0;
  if (img) {
    ctx.drawImage(img, min.x - 6, min.y - 8, w + 12, (max.y - min.y) + 16);
  } else {
    ctx.fillStyle = '#57534e';
    ctx.fillRect(min.x, min.y, w, max.y - min.y);
    ctx.strokeStyle = '#292524';
    ctx.lineWidth = 3;
    ctx.strokeRect(min.x, min.y, w, max.y - min.y);
    // iron bands
    ctx.fillStyle = '#44403c';
    ctx.fillRect(min.x, min.y + 6, w, 7);
    ctx.fillRect(min.x, max.y - 13, w, 7);
    // rivets
    ctx.fillStyle = '#a8a29e';
    for (let x = min.x + 10; x < max.x - 6; x += 18) {
      ctx.beginPath(); ctx.arc(x, min.y + 9.5, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, max.y - 9.5, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  // warning glow across the bands while the slam arms
  if (warn > 0) {
    ctx.save();
    ctx.globalAlpha = warn * 0.5;
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(min.x, min.y + 6, w, 7);
    ctx.restore();
  }
}

/** Boulder with a carved goblin face, spinning with the distance it has rolled. */
function drawBoulder(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>) {
  const r = md.radius ?? 27;
  const img = sprite('boulder');
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  if (img) {
    ctx.drawImage(img, -r * 1.12, -r * 1.12, r * 2.24, r * 2.24);
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
    grad.addColorStop(0, '#a8a29e');
    grad.addColorStop(1, '#57534e');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#44403c';
    ctx.lineWidth = 3;
    ctx.stroke();
    // the face: two crater eyes, a jagged grin
    ctx.fillStyle = '#292524';
    ctx.beginPath(); ctx.ellipse(-r * 0.32, -r * 0.18, r * 0.14, r * 0.18, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(r * 0.3, -r * 0.14, r * 0.12, r * 0.16, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#292524';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, r * 0.36);
    ctx.quadraticCurveTo(0, r * 0.55, r * 0.38, r * 0.3);
    ctx.stroke();
  }
  ctx.restore();
}

/** Spiked mace ball on its arm; the arm swings with the ball body. Stars while jammed. */
function drawMace(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, game: Game, t: number) {
  const motion = md.motion;
  if (!motion || motion.mode !== 'sweep') return;
  const pv = motion.pivot;
  const r = md.radius ?? 24;
  const stunned = game.time < (md.stunUntil ?? 0);
  // the arm from pivot to ball
  ctx.strokeStyle = stunned ? '#7c5f2c' : '#1f2937';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pv.x, pv.y);
  ctx.lineTo(b.position.x, b.position.y);
  ctx.stroke();
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pv.x, pv.y);
  ctx.lineTo(b.position.x, b.position.y);
  ctx.stroke();
  drawSprite(ctx, 'tile-metal', pv.x, pv.y, 22, 12);
  ctx.fillStyle = '#9ca3af';
  ctx.beginPath(); ctx.arc(pv.x, pv.y, 4, 0, Math.PI * 2); ctx.fill();
  // the ball
  const img = sprite('mace');
  if (img) {
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(t * 0.002);
    ctx.drawImage(img, -r * 1.35, -r * 1.35, r * 2.7, r * 2.7);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(t * 0.002);
    // spikes
    ctx.fillStyle = '#6b7280';
    const spikes = 10;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
      ctx.lineTo(Math.cos(a + 0.16) * r * 1.42, Math.sin(a + 0.16) * r * 1.42);
      ctx.lineTo(Math.cos(a + 0.32) * r * 0.8, Math.sin(a + 0.32) * r * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
    grad.addColorStop(0, '#9ca3af');
    grad.addColorStop(1, '#374151');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }
  // jam stars while shocked
  if (stunned) {
    ctx.fillStyle = '#facc15';
    for (let i = 0; i < 3; i++) {
      const a = t / 300 + (i * Math.PI * 2) / 3;
      const sx = b.position.x + Math.cos(a) * (r + 14), sy = b.position.y - 6 + Math.sin(a) * 6;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const aa = (k / 4) * Math.PI * 2;
        ctx.lineTo(Math.cos(aa) * 5, Math.sin(aa) * 5);
        ctx.lineTo(Math.cos(aa + Math.PI / 4) * 1.8, Math.sin(aa + Math.PI / 4) * 1.8);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

/** Ramped warning stripes (drawn under crusher decks and machinery beds). */
function hazardStripe(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.fillStyle = '#1c1917';
  ctx.fillRect(x, y, w, h);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  for (let sx = x - h; sx < x + w + h; sx += 16) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + 8, y);
    ctx.lineTo(sx + 16, y);
    ctx.lineTo(sx + 8, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** NO ENTRY planks over a tunnel (or any shortcut). Cracks grow as hp drops. */
function drawBarricade(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>) {
  const { min, max } = b.bounds;
  const w = max.x - min.x, h = max.y - min.y;
  const ratio = (md.hp ?? 1) / (md.maxHp ?? 1);
  const img = sprite('barricade');
  if (img) {
    ctx.drawImage(img, min.x - w * 0.06, min.y - h * 0.08, w * 1.12, h * 1.16);
  } else {
    // planks: three crossed boards over a dark opening
    ctx.fillStyle = 'rgba(5,8,14,0.85)';
    ctx.fillRect(min.x, min.y, w, h);
    const planks = Math.max(2, Math.round(h / 16));
    for (let i = 0; i < planks; i++) {
      const py = min.y + (i + 0.5) * h / planks;
      ctx.fillStyle = i % 2 ? '#8a5a33' : '#a06a3c';
      ctx.fillRect(min.x - 3, py - h / planks / 2 - 2, w + 6, h / planks - 4);
      ctx.strokeStyle = 'rgba(40,20,8,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(min.x - 3, py - h / planks / 2 - 2, w + 6, h / planks - 4);
    }
    // diagonal brace
    ctx.strokeStyle = '#7c4f2a';
    ctx.lineWidth = Math.min(10, w * 0.09);
    ctx.beginPath();
    ctx.moveTo(min.x + 4, max.y - 4 - bodyJitter(b, 2) * 3);
    ctx.lineTo(max.x - 4, min.y + 4);
    ctx.stroke();
  }
  // cracks by wear — tough 1..10 shows up as how many hits this has already shrugged off
  if (ratio < 0.999) {
    const n = Math.ceil((1 - ratio) * 7);
    ctx.strokeStyle = 'rgba(15,10,6,0.85)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < n; i++) {
      const sx = min.x + ((i * 41 + 13) % Math.max(10, w - 8)) + 4;
      const sy = min.y + ((i * 29 + 7) % Math.max(10, h - 8)) + 4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 7 + bodyJitter(b, i) * 6, sy + 12);
      ctx.lineTo(sx + 2, sy + 22);
      ctx.stroke();
    }
  }
  // the sign
  const sx = b.position.x, sy = b.position.y;
  const signW = Math.min(64, w * 0.9), signH = 22;
  ctx.save();
  if (img) ctx.scale(0.85, 0.85);
  ctx.translate(img ? sx * 1.176 + 12 : sx, img ? sy * 1.176 : sy);
  ctx.fillStyle = '#f3e9cf';
  ctx.strokeStyle = '#422b14';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(-signW / 2, -signH / 2, signW, signH, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#b3261e';
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NO ENTRY', 0, 1);
  ctx.restore();
}

/** Weak stone the pack knocks down over the race: bricks, cracks and dust. */
function drawCrumble(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, _t: number) {
  const { min, max } = b.bounds;
  const w = max.x - min.x, h = max.y - min.y;
  const img = sprite('crumble');
  const tile = md.crumbleTile ?? { row: 0, col: 0, rows: 1, cols: 1 };
  if (img) {
    const sw = img.naturalWidth / tile.cols, sh = img.naturalHeight / tile.rows;
    ctx.drawImage(img, tile.col * sw, tile.row * sh, sw, sh, min.x, min.y, w, h);
  } else {
    ctx.fillStyle = tile.row % 2 ? '#7d7466' : '#8d8474';
    ctx.fillRect(min.x, min.y, w, h);
  }
  if ((md.hp ?? 1) < (md.maxHp ?? 1)) {
    ctx.strokeStyle = '#302a24';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(min.x + w * 0.3, min.y);
    ctx.lineTo(min.x + w * 0.6, min.y + h * 0.5);
    ctx.lineTo(min.x + w * 0.4, max.y);
    ctx.stroke();
  }
}

/** Both ends of a cliff burrow: the entrance hole at the sensor, the exit at md.exit, glowing. */
function drawTunnelHole(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, lit: boolean, t: number, dir?: { x: number; y: number }) {
  if (lit) {
    const pulse = 0.65 + 0.35 * Math.sin(t / 420 + x);
    const gr = r * (1.7 + 0.25 * pulse);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.2 * pulse;
    ctx.drawImage(colorGlow('#f6bf63'), x - gr, y - gr, gr * 2, gr * 2);
    ctx.restore();
  }
  const img = sprite('tunnel');
  if (img) {
    const rot = dir ? Math.atan2(dir.y, dir.x) + Math.PI / 2 : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const s = r * 3.1;
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  } else {
    // rubble ring
    ctx.fillStyle = '#574a39';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a3128';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.06, 0, Math.PI * 2);
    ctx.fill();
    // black hole
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, '#04060a');
    g.addColorStop(0.8, '#0a0e16');
    g.addColorStop(1, '#141a26');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.94, 0, Math.PI * 2);
    ctx.fill();
    // a faint wood lintel
    ctx.fillStyle = '#6e4a2a';
    ctx.fillRect(x - r * 0.8, y - r * 1.02, r * 1.6, 7);
  }
  // drifting chevrons out of the exit so the "short way" is telegraphed
  if (lit && dir) {
    const dm = Math.hypot(dir.x, dir.y) || 1;
    const ph = (t / 500) % 1;
    for (let i = 0; i < 2; i++) {
      const k = (ph + i / 2) % 1;
      ctx.strokeStyle = `rgba(252,211,77,${0.15 + 0.5 * (1 - k)})`;
      ctx.lineWidth = 2.5;
      const d = 14 + k * 26;
      const ax = x + (dir.x / dm) * d, ay = y + (dir.y / dm) * d;
      const pxv = -(dir.y / dm) * 7, pyv = (dir.x / dm) * 7;
      ctx.beginPath();
      ctx.moveTo(ax - (dir.x / dm) * 6 - pxv, ay - (dir.y / dm) * 6 - pyv);
      ctx.lineTo(ax, ay);
      ctx.lineTo(ax - (dir.x / dm) * 6 + pxv, ay - (dir.y / dm) * 6 + pyv);
      ctx.stroke();
    }
  }
}

/** A cliff tunnel: entrance hole where the sensor lives, glowing exit hole where marbles pop out. */
function drawTunnel(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, t: number) {
  drawTunnelHole(ctx, b.position.x, b.position.y, 34, false, t);
  if (md.exit) drawTunnelHole(ctx, md.exit.x, md.exit.y, 34, true, t, md.exit.dir);
}

/** Hinged hatch drawn about its pivot. Timer mode walks a warning lamp; weight mode shows a scale pan. */
function drawTrapdoor(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, game: Game, t: number) {
  const motion = md.motion && md.motion.mode === 'hinge' ? md.motion : null;
  const pivot = motion?.pivot ?? b.position;
  const len = motion?.len ?? 120;
  const dirX = motion?.dirX ?? 1;
  const thick = 12;
  ctx.save();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(b.angle);
  const img = sprite('trapdoor');
  if (img) {
    // The trapdoor graphic has transparent padding on its sides.
    // By shifting it left by ~25% of len, the visual metal hinge aligns with x=0.
    const pad = len * 0.25;
    if (dirX === 1) ctx.drawImage(img, -pad, -thick * 1.2, len + pad * 2, thick * 2.4);
    else { ctx.scale(-1, 1); ctx.drawImage(img, -pad, -thick * 1.2, len + pad * 2, thick * 2.4); ctx.scale(-1, 1); }
  } else {
    // grating floor: frame + bars
    const x0 = dirX === 1 ? 0 : -len;
    ctx.fillStyle = '#4f5a6a';
    ctx.strokeStyle = '#20262f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x0, -thick / 2, len, thick, 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(20,26,34,0.8)';
    ctx.lineWidth = 1.5;
    for (let d = x0 + 10; d < x0 + len - 4; d += 12) {
      ctx.beginPath();
      ctx.moveTo(d, -thick / 2 + 2);
      ctx.lineTo(d, thick / 2 - 2);
      ctx.stroke();
    }
  }
  ctx.restore();
  // hinge
  ctx.fillStyle = '#20262f';
  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8f9aa8';
  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y, 2, 0, Math.PI * 2);
  ctx.fill();
  // the tell: a little lamp / scale pan beside the hinge
  const open01 = game.ewma(b);
  const lx = pivot.x + dirX * -16, ly = pivot.y - 26;
  if (md.mode === 'weight') {
    // scale pan with a dial: swings with the easing, labelled with kg
    ctx.strokeStyle = '#39424f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly + 10);
    ctx.lineTo(lx, ly - 3);
    ctx.stroke();
    ctx.save();
    ctx.translate(lx, ly + 10);
    ctx.rotate(open01 * 0.5 * dirX);
    ctx.fillStyle = '#c3cdd7';
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    ctx.lineTo(6, 6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = trapdoorWarn(md, game.time) ? '#f87171' : '#9ae6b4';
    ctx.font = 'bold 9px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round((md.weightKg ?? 2.4) * 10) / 10}kg`, lx, ly + 16);
  } else {
    // clock lamp: green while open, flashing amber while the swing is close, dim otherwise
    const st = motion ? hingeTimerState(motion, game.time) : null;
    const isOpen = motion ? hingeIsOpen(motion, b.angle) : false;
    const warn = st?.warn ?? false;
    const glow = isOpen ? '#4ade80' : warn && Math.sin(t / 90) > 0 ? '#facc15' : '#93a1b3';
    ctx.fillStyle = '#39424f';
    ctx.fillRect(lx - 3, ly - 2, 7, 14);
    ctx.drawImage(colorGlow(glow), lx - 12, ly - 22, 26, 26);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx + 0.5, ly - 8, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The flip-paddle in the road: fork blade + pivot + lantern; the blade leans toward the live route. */
function drawSwitchBlade(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, game: Game, t: number) {
  const pv = md.pivot ?? b.position;
  const len = md.plateLen ?? 120;
  const thick = 12;
  // the blade as the eased physics pose has it: hinge at pivot, tip leaning to the live route
  ctx.save();
  ctx.translate(pv.x, pv.y);
  ctx.rotate(b.angle);
  const img = sprite('switchplate');
  if (img) {
    ctx.drawImage(img, -thick, -len, len, thick * 2);
  } else {
    ctx.fillStyle = '#8f4f2c';
    ctx.strokeStyle = '#3c2412';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-thick / 2, -len, thick, len, 4);
    ctx.fill();
    ctx.stroke();
    // route arrow toward the tip
    ctx.fillStyle = 'rgba(255,240,200,0.8)';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((md.side ?? 0) === 1 ? '➜' : '⬅', 0, -len * 0.55);
  }
  ctx.restore();
  // pivot post
  ctx.fillStyle = '#2b3140';
  ctx.beginPath();
  ctx.arc(pv.x, pv.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b6472';
  ctx.beginPath();
  ctx.arc(pv.x, pv.y, 3, 0, Math.PI * 2);
  ctx.fill();
  // lantern at the pivot; flares briefly when the pad flips the route (ghost preview for the next marble)
  const sway = game.time - (md.flippedAt ?? -1e9);
  const flicker = sway < 700 ? 1 : 0.55 + 0.45 * Math.sin(t / 260 + pv.x);
  ctx.save();
  ctx.globalAlpha = 0.5 + 0.5 * flicker;
  ctx.drawImage(colorGlow('#ffd97a'), pv.x - 26, pv.y - 46, 52, 52);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#f2c14e';
  ctx.beginPath();
  ctx.arc(pv.x, pv.y - 20, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#463512';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  if (sway < 900) {
    // dashed arc between the two resting leans so the flip reads
    const target = (md.side ?? 0) === 1 ? (md.swingAngle ?? 0.65) : -(md.swingAngle ?? 0.65);
    const a0 = Math.min(b.angle, target), a1 = Math.max(b.angle, target);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 0.5 * (1 - sway / 900));
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.arc(pv.x, pv.y, len * 0.55, -Math.PI / 2 + a0, -Math.PI / 2 + a1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/** The trigger paddle above the fork: a little lever sign that flashes when it trips. */
function drawSwitchPad(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, game: Game, t: number) {
  const { x, y } = b.position;
  const pressed = game.time - (md.hitAt ?? -1e9) < 450;
  ctx.save();
  ctx.translate(x, y + (pressed ? 2 : 0));
  ctx.fillStyle = pressed ? '#caa04e' : '#9fb2c6';
  ctx.strokeStyle = '#2e3743';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(-15, -7, 30, 12, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2e3743';
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const glow = pressed ? '#fbbf24' : '#8fb4d9';
  const pulse = pressed ? 1 : 0.55 + 0.3 * Math.sin(t / 380 + x);
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.drawImage(colorGlow(glow), x - 16, y - 36, 32, 32);
  ctx.restore();
  ctx.fillStyle = glow;
  ctx.font = 'bold 13px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⇄', x, y - 20);
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

/**
 * MB-02. Forgets a game's baked static chunks, so the next frame repaints them from the circuit it now holds.
 *
 * The editor is the only caller: it rebuilds a `Track` as the player edits, and a chunk baked from the previous
 * circuit would otherwise be drawn as-is. The race never needs this — its circuit is built once, and the chunks
 * are re-baked on their own whenever the camera's resolution changes.
 */
export function clearStaticChunks(game: Game): void {
  chunkCaches.delete(game);
}

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
  const artReady = STATIC_ART.every((n) => !!sprite(n)) && (!currentSkin() || (!!sprite('cliff-column') && !!sprite('cliff-face')));
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
    const key = `${currentSkin() ?? 'base'}:${index}@${res}`;
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
    if (m.hold && m.hold.kind === 'tunnel') continue; // hidden inside the cliff (MB-10A); MB-10C movers keep the rider on screen
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


// ---------------- MB-10C: mechanical movers ----------------

/**
 * Water wheel: rim, spokes and bucket paddles rotating on the race clock. The skin reads the
 * hub body's angle (set by the shared spin motion), so host and guest draw the same pose; the
 * drizzle marks it as wet unless the venue runs it dry. Buckets with riders get a highlight.
 */
// ==================== MB-10D: launchers and pinball skins ====================

/**
 * Cannon: a winched barrel on a little mount; the aim fan sweeps on the race clock and the
 * breech glows while loaded. Falls back to pure goblin vector when the kit art misses.
 */
function drawCannon(ctx: CanvasRenderingContext2D, _b: Matter.Body, md: ReturnType<typeof meta>, game: Game, t: number) {
  const mo = md.motion;
  const cn = md.cannon;
  if (!mo || mo.mode !== 'aim' || !cn) return;
  const P = mo.pivot;
  const a = cannonAim(mo, game.time);
  // mount
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.fillStyle = '#44403c';
  ctx.beginPath(); ctx.moveTo(-16, 14); ctx.lineTo(0, -8); ctx.lineTo(16, 14); ctx.closePath(); ctx.fill();
  // aim fan rails (subtle)
  ctx.strokeStyle = 'rgba(214,211,209,0.25)';
  ctx.setLineDash([3, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(mo.minA) * cn.len, Math.sin(mo.minA) * cn.len); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(mo.maxA) * cn.len, Math.sin(mo.maxA) * cn.len); ctx.stroke();
  ctx.setLineDash([]);
  // barrel
  ctx.rotate(a);
  // the barrel art runs from the breech at the pivot along +x (same local
  // rectangle as the vector fallback); land the painted content, not the
  // letterboxed frame, on that rectangle
  if (!drawSpriteContent(ctx, 'cannon', 0, -14, cn.len + 6, 14)) {
    ctx.fillStyle = '#78350f';
    ctx.fillRect(0, -9, cn.len, 18);
    ctx.fillStyle = '#a16207';
    for (let x = 10; x < cn.len; x += 16) ctx.fillRect(x, -9, 3, 18);
    ctx.fillStyle = '#44403c';
    ctx.fillRect(cn.len - 8, -11, 8, 22);
  }
  // breech glow while loaded
  if (cn.loaded) {
    const pulse = 0.55 + 0.45 * Math.sin(t / 90);
    ctx.fillStyle = `rgba(252,211,77,${0.5 * pulse})`;
    ctx.beginPath(); ctx.arc(-2, 0, 10, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  // blast flash off the muzzle for a beat after the shot
  if (cn.lastFiredAt && game.time - cn.lastFiredAt < 180) {
    const k = 1 - (game.time - cn.lastFiredAt) / 180;
    const mx = P.x + Math.cos(a) * (cn.len + 8), my = P.y + Math.sin(a) * (cn.len + 8);
    if (!drawSprite(ctx, 'blast', mx, my, 44, 44)) {
      ctx.globalAlpha = k;
      ctx.fillStyle = '#fcd34d';
      ctx.beginPath(); ctx.arc(mx, my, 8 + (1 - k) * 22, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * Catapult: a trebuchet frame with the arm reposing on its state clocks; the spoon cup rides
 * the tip and the frame shows a release flash for a beat after the throw.
 */
function drawCatapult(ctx: CanvasRenderingContext2D, _b: Matter.Body, md: ReturnType<typeof meta>, game: Game, previewTime?: number) {
  const ct = md.catapult;
  if (!ct) return;
  const a = catapultArtAngle(ct, game.time, previewTime);
  const P = { x: ct.px, y: ct.py };
  ctx.save();
  ctx.translate(P.x, P.y);
  // The supplied A-frame stays planted; only the separate arm follows the clock.
  const base = sprite('catapult_static');
  const mirror = Math.cos(ct.restA) < 0 ? -1 : 1;
  ctx.save();
  ctx.scale(mirror, 1);
  if (base) {
    const k = ct.len / 600;
    ctx.drawImage(base, -CATAPULT_BASE.pivotX * k, -CATAPULT_BASE.pivotY * k, CATAPULT_BASE.width * k, CATAPULT_BASE.height * k);
  } else {
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-26, 34); ctx.lineTo(0, -6); ctx.lineTo(26, 34); ctx.stroke();
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-34, 34); ctx.lineTo(34, 34); ctx.stroke();
  }
  ctx.restore();
  // arm with spoon
  ctx.rotate(a);
  ctx.scale(1, mirror);
  const arm = sprite('catapult_arm');
  if (arm) {
    const k = ct.len / CATAPULT_ARM_LENGTH;
    ctx.rotate(-CATAPULT_ARM_AXIS);
    ctx.drawImage(arm, -CATAPULT_ARM.pivotX * k, -CATAPULT_ARM.pivotY * k, CATAPULT_ARM.width * k, CATAPULT_ARM.height * k);
  } else {
    ctx.fillStyle = '#92610f';
    ctx.fillRect(0, -5, ct.len, 10);
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, -5, ct.len, 10);
    // spoon cup at the tip
    ctx.fillStyle = '#5b3a12';
    ctx.beginPath();
    ctx.arc(ct.len, 0, 15, 0, Math.PI, false);
    ctx.fill();
  }
  ctx.restore();
  // release flash
  if (ct.lastFiredAt && game.time - ct.lastFiredAt < 160) {
    const k = 1 - (game.time - ct.lastFiredAt) / 160;
    ctx.globalAlpha = k * 0.7;
    ctx.strokeStyle = '#fda4af';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(P.x, P.y, 30 + (1 - k) * 30, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Flipper: a lacquered bat on a brass pivot, pose read from its firedAt clock. */
function drawFlipper(ctx: CanvasRenderingContext2D, _b: Matter.Body, md: ReturnType<typeof meta>, gameTime: number, previewTime?: number) {
  const fl = md.flipper;
  if (!fl) return;
  const a = flipperArtAngle(fl, gameTime, previewTime);
  ctx.save();
  ctx.translate(fl.px, fl.py);
  ctx.rotate(a);
  ctx.scale(1, fl.side);
  const rect = flipperArtRect(fl.len);
  // Keep the painted bolt on the hinge and mirror the right bat without turning its lighting upside down.
  if (!drawSprite(ctx, 'flipper', rect.x, rect.y, rect.w, rect.h)) {
    ctx.fillStyle = '#9f1239';
    ctx.strokeStyle = '#4c0519';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(0, -6, fl.len, 12, 6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fda4af';
    ctx.fillRect(fl.len - 12, -6, 10, 12);
    // Fallback pivot cap; the supplied sprite already includes its iron hinge.
    ctx.fillStyle = '#b45309';
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** War Drum: the supplied painted drum, with a brief drumhead pulse after a kick. */
function drawSling(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, game: Game, _t: number) {
  const sl = md.sling;
  if (!sl) return;
  const size = sl.size ?? 90;
  const rect = warDrumArtRect(size);
  const age = game.time - sl.flashAt;
  const impact = age >= 0 && age < 260 ? 1 - age / 260 : 0;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(warDrumArtAngle(sl.facing));
  if (!drawSprite(ctx, 'sling', rect.x, rect.y, rect.w, rect.h)) {
    ctx.fillStyle = '#783f23';
    ctx.strokeStyle = '#33271d';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(-rect.w / 2, -size * 0.16, rect.w, rect.h * 0.76, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e2c79b';
    ctx.beginPath(); ctx.ellipse(0, -size * 0.16, rect.w / 2, size * 0.22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (impact > 0) {
    // A drumhead resonance ring replaces the old rubber-band stroke.
    ctx.globalAlpha *= impact * 0.65;
    ctx.strokeStyle = '#ffe2a3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.12, size * (0.4 + (1 - impact) * 0.15), size * (0.17 + (1 - impact) * 0.07), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Scoop: a brass pocket lip with a chevron showing the kick direction; dimmed while it holds a rider. */

// ---------------- MB-10E: fields and surfaces ----------------

// the five fields share a clock pulse with the engine: same phase, same windows
function fieldPulse(t: number, pulseMs: number, phaseMs: number): number {
  if (pulseMs <= 0) return 1;
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.cos((2 * Math.PI * (t + phaseMs)) / pulseMs));
}

function drawWind(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const w = md.wind;
  if (!w) return;
  const { x: lx, y: ly, w: bw, h: bh } = w.box;
  ctx.save();
  
  const cx = lx + bw / 2;
  const cy = ly + bh / 2;
  const angle = Math.atan2(w.uy, w.ux) + Math.PI / 2;
  const fade = (Math.sin(t / (3000 / (Math.PI * 2))) + 1) / 2;
  
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  
  ctx.strokeStyle = `rgba(125, 211, 252, ${0.2 * fade})`;
  ctx.lineWidth = 15;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  for (let i = -1; i <= 1; i++) {
    const yOffset = i * 40;
    ctx.beginPath();
    ctx.moveTo(-40, yOffset + 20);
    ctx.lineTo(0, yOffset - 20);
    ctx.lineTo(40, yOffset + 20);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  // the fan box rides the leading corner of the field — same placement
  // formula the editor's selection bounds use (windFanAnchor)
  const fan = windFanAnchor(w);
  ctx.translate(fan.x, fan.y);
  // centred on the fan anchor, scaled up 400%
  if (!drawSprite(ctx, 'wind', 0, 0, 112, 80)) {
    ctx.fillStyle = '#57534e';
    ctx.fillRect(-56, -40, 112, 80);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(-16, -16, 32, 32);
  }
  ctx.restore();
  void b;
}

function drawMagnet(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const g = md.magnet;
  if (!g) return;
  const on = g.periodMs <= 0 || (((t + g.phaseMs) % g.periodMs + g.periodMs) % g.periodMs) < g.periodMs / 2;
  ctx.save();
  ctx.translate(g.cx, g.cy);
  const pulse = on ? 0.4 + 0.2 * Math.sin(t / 180) : 0.08;
  ctx.globalAlpha = Math.max(0.05, pulse);
  ctx.strokeStyle = '#fca5a5';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, g.r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, g.r * (0.72 + 0.05 * Math.sin(t / 220)), 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  // centred on the field centre, matching the horseshoe fallback
  if (!drawSprite(ctx, 'magnet', 0, 0, 48, 45)) {
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(-20, -2, 10, 16);
    ctx.fillRect(10, -2, 10, 16);
    ctx.beginPath(); ctx.arc(0, 0, 16, Math.PI, 0); ctx.stroke();
  }
  ctx.restore();
  void b;
}

function drawMud(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const mud = md.mud;
  if (!mud) return;
  const cx = b.position.x, cy = b.position.y;
  ctx.save();
  ctx.translate(cx, cy);

  // Draw the normal graphic upright in the center
  drawSprite(ctx, 'mud', 0, 0, mud.box.w, mud.box.h);

  ctx.restore();
}

function drawPool(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const po = md.pool;
  if (!po) return;
  const lx = po.box.x, hx = po.box.x + po.box.w, top = po.topY;
  // basin clay banks
  ctx.fillStyle = '#475569';
  ctx.fillRect(lx - 10, top, 10, po.depth + 12);
  ctx.fillRect(hx, top, 10, po.depth + 12);
  // water slab
  ctx.fillStyle = 'rgba(3,105,161,0.55)';
  ctx.fillRect(lx, top + 2, hx - lx, po.depth + 14);
  // painted surface sheen: the puddle art stretched over the pool mouth
  drawSprite(ctx, 'pool', (lx + hx) / 2, top + 4, (hx - lx) + 22, 22);
  // wobbling surface line
  ctx.strokeStyle = '#7dd3fc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = lx; x <= hx; x += 8) {
    const y = top + 2 + Math.sin((x + t / 12) / 14) * 2;
    if (x === lx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // slow ripples deeper down
  ctx.strokeStyle = 'rgba(56,189,248,0.35)';
  ctx.lineWidth = 1.5;
  for (let d = 18; d < po.depth; d += 18) {
    ctx.beginPath();
    for (let x = lx + 6; x <= hx - 6; x += 14) {
      const y = top + d + Math.sin((x + t / 20) / 18) * 1.4;
      if (x === lx + 6) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  void b;
}

function drawGeyser(ctx: CanvasRenderingContext2D, _b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const gy = md.geyser;
  if (!gy) return;
  const tt = (((t + gy.phaseMs) % gy.periodMs) + gy.periodMs) % gy.periodMs;
  const erupting = tt >= 900 && tt < 900 + gy.burstMs;
  ctx.save();
  // anchor on the mound the metadata describes (the sensor column that carries
  // it floats half the blast height above), keeping the sit-on-mound offset
  ctx.translate(gy.cx, gy.topY - 8);
  // centred over the mound: art base lands on the fallback mound's base
  if (!drawSprite(ctx, 'geyser', 0, -6, 34, 44)) {
    ctx.fillStyle = '#78350f';
    ctx.beginPath(); ctx.moveTo(-12, 16); ctx.lineTo(0, -12); ctx.lineTo(12, 16); ctx.fill();
  }
  if (erupting) {
    const k = 0.6 + 0.4 * Math.sin(t / 60);
    ctx.globalAlpha = 0.55 * k;
    ctx.fillStyle = '#e2e8f0';
    for (let yi = 20; yi < gy.h; yi += 26) {
      const wbb = 7 + (yi / gy.h) * 7;
      ctx.beginPath();
      ctx.ellipse(Math.sin((yi + t / 15) / 30) * 5, -yi, wbb, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (tt < 900) {
    // the warning bubble beat before the blast
    ctx.fillStyle = 'rgba(226,232,240,0.6)';
    const beep = (tt / 900) * 2.2 % 1;
    ctx.beginPath(); ctx.arc(0, -12 - beep * 12, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}


// ---------------- MB-10F: big set pieces ----------------

function drawTrampoline(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, _t: number) {
  const tp = md.trampoline;
  if (!tp) return;
  const sag = md.tramp?.depth ?? 0;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  // wooden posts (painted art, mirrored at the far end); procedural frame if art is missing
  if (!(drawSprite(ctx, 'trampoline-post-l', -tp.half - 12, -12, 32, 44) &&
        drawSprite(ctx, 'trampoline-post-r', tp.half + 12, -12, 32, 44))) {
    ctx.fillStyle = '#78350f';
    ctx.fillRect(-tp.half - 10, -4, 10, 14);
    ctx.fillRect(tp.half, -4, 10, 14);
  }
  // the net: a catenary that deepens when it takes a landing
  ctx.strokeStyle = '#d4a04a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const dip = 3 + sag * 16;
  ctx.moveTo(-tp.half, 0);
  ctx.quadraticCurveTo(0, dip * 2, tp.half, 0);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(212,160,74,0.6)';
  for (let k = 1; k < 6; k++) {
    const xk = -tp.half + (2 * tp.half * k) / 6;
    ctx.beginPath();
    ctx.moveTo(xk, 0);
    ctx.quadraticCurveTo(xk * 0.5, dip, xk * -0.5 * -1 + xk * 0.18, dip);
    ctx.stroke();
  }
  ctx.restore();
  void b;
}

function drawTurnstile(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, _t: number) {
  const ts = md.turnstile;
  if (!ts) return;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(b.angle);
  // painted rotor art when it matches the arm count (the art is a 4-arm X)
  if (ts.arms === 4 && drawSprite(ctx, 'turnstile', 0, 0, ts.r * 2 + 16, ts.r * 2 + 16)) {
    ctx.restore();
    void b;
    return;
  }
  // hub
  ctx.fillStyle = '#44403c';
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  // blades (art shows two; the physical bar matches two; the rest are painted)
  for (let k = 0; k < ts.arms; k++) {
    ctx.save();
    ctx.rotate((k / ts.arms) * Math.PI);
    ctx.strokeStyle = k < 2 ? '#8a5a2e' : 'rgba(138,90,46,0.55)';
    ctx.lineWidth = k < 2 ? 11 : 10;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-ts.r, 0); ctx.lineTo(ts.r, 0); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#b45309';
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  void b;
}

function drawTargets(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const tg = md.target;
  if (!tg) return;
  const p = b.position;
  ctx.save();
  ctx.translate(p.x, p.y);
  const down = tg.dropAt >= 0;
  if (!down) {
    // standing pin: painted art, base resting on the lane
    if (drawSprite(ctx, 'target-pin', 0, -9, 19, 25)) {
      ctx.restore();
      return;
    }
    // standing pin: red face, cream cap
    ctx.fillStyle = '#b91c1c';
    ctx.fillRect(-9, -13, 18, 14);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(-9, -13, 18, 4);
    ctx.strokeStyle = '#450a0a';
    ctx.lineWidth = 2;
    ctx.strokeRect(-9, -13, 18, 14);
  } else {
    // down: fold flat with a soft settle wobble right after the hit
    const age = Math.min(1, (t - tg.dropAt) / 200);
    ctx.fillStyle = 'rgba(185,28,28,0.35)';
    ctx.fillRect(-9, -4 + age * 2, 18, 5);
  }
  ctx.restore();
}

function drawVortex(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const vo = md.vortex;
  if (!vo) return;
  ctx.save();
  ctx.translate(vo.cx, vo.cy);
  // painted funnel bowl beneath the field animation
  drawSprite(ctx, 'vortex', 0, 0, vo.r * 2.35, vo.r * 2.35);
  // spiral: three packets of dash-arcs spinning on the clock
  for (let k = 0; k < 3; k++) {
    ctx.save();
    ctx.rotate((t / 900) * Math.PI * 2 * (0.8 + k * 0.25) * (k % 2 ? -1 : 1) + (k * Math.PI * 2) / 3);
    ctx.strokeStyle = ['rgba(125,211,252,0.5)', 'rgba(167,139,250,0.45)', 'rgba(244,114,182,0.4)'][k];
    ctx.lineWidth = 5 - k;
    ctx.beginPath();
    const r0 = vo.holeR + (vo.r - vo.holeR) * (1 - k * 0.22);
    ctx.arc(0, 0, r0, 0.8, Math.PI * 2 - 1.6);
    ctx.stroke();
    ctx.restore();
  }
  // the drain: dark ring that gulps
  ctx.fillStyle = '#0c0a09';
  ctx.beginPath(); ctx.arc(0, 0, vo.holeR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#e8813a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, vo.holeR + 2, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  void b;
}

function drawPlatform(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const mo = md.motion;
  if (!mo || mo.mode !== 'platform') return;
  const p = b.position;
  // the rail between its endpoints (the winch route)
  ctx.save();
  ctx.strokeStyle = 'rgba(120,113,108,0.5)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(mo.a.x, mo.a.y + 10); ctx.lineTo(mo.b.x, mo.b.y + 10); ctx.stroke();
  ctx.setLineDash([]);
  ctx.translate(p.x, p.y);
  const w = b.bounds.max.x - b.bounds.min.x;
  if (!drawSprite(ctx, 'platform', 0, -12, w + 10, (w + 10) * 0.43)) {
    // wooden plank with iron shoes + chain loops
    ctx.fillStyle = '#8a5a2e';
    ctx.fillRect(-w / 2, -8, w, 16);
    ctx.fillStyle = '#b45309';
    ctx.fillRect(-w / 2, -8, w, 4);
    ctx.strokeStyle = '#3f2a14';
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -8, w, 16);
    ctx.strokeStyle = '#57534e';
    ctx.beginPath(); ctx.moveTo(-w / 3, -8); ctx.lineTo(-w / 3, -26); ctx.moveTo(w / 3, -8); ctx.lineTo(w / 3, -26); ctx.stroke();
  }
  ctx.restore();
  void t;
}

function drawScoop(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, _game: Game, t: number) {
  const sc = md.scoop;
  if (!sc) return;
  const p = b.position;
  const busy = sc.loadedAt !== null;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = busy ? 0.65 : 1;
  // centred on the pocket/hole the sensor marks
  if (!drawSprite(ctx, 'scoop', 0, 0, 80, 48)) {
    ctx.fillStyle = '#0c0a09';
    ctx.beginPath(); ctx.ellipse(0, 0, 36, 20, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, 0, 36, 20, 0, Math.PI, 0, false); ctx.stroke();
  }
  // direction chevrons (or the subway portal)
  if (md.exit) {
    const bob = Math.sin(t / 300) * 2;
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-12, 8 + bob); ctx.lineTo(12, 8 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8, 20 - bob); ctx.lineTo(8, 20 - bob); ctx.stroke();
  } else {
    const pulse = 0.6 + 0.4 * Math.sin(t / 260);
    ctx.rotate(sc.deg);
    ctx.strokeStyle = `rgba(253,224,71,${pulse})`;
    ctx.lineWidth = 4;
    for (let i = 0; i < 2; i++) {
      const o = 16 + i * 10;
      ctx.beginPath(); ctx.moveTo(-8, -o); ctx.lineTo(0, -o - 7); ctx.lineTo(8, -o); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawWheel(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, game: Game, t: number) {
  const motion = md.motion;
  if (!motion || motion.mode !== 'spin' || !md.wheel) return;
  const P = motion.pivot;
  const r = motion.radius;
  const n = md.wheel.buckets;
  const taus = Math.PI * 2;
  // drips under the wheel (wet skin); the frame counter keeps them cheap
  if (t % 3 < 1) {
    ctx.fillStyle = 'rgba(125,211,252,0.5)';
    const dx = P.x + Math.sin(t * 0.0013) * r * 0.5;
    ctx.fillRect(dx, P.y + r + 4, 2, 6);
    ctx.fillRect(dx + 14, P.y + r + 1, 2, 4);
  }
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.rotate(b.angle);
  // rim + spokes
  ctx.strokeStyle = '#6b4423';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, taus); ctx.stroke();
  ctx.strokeStyle = '#4b5563';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, taus); ctx.stroke();
  for (let i = 0; i < n; i++) {
    const a = (i * taus) / n;
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
    // bucket paddle: a little open box on the rim, riding lit while occupied
    const busy = md.wheel.slots[i] > game.time;
    ctx.save();
    ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = busy ? '#d4a04a' : '#8a5a2e';
    ctx.strokeStyle = '#3f2a14';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-11, -8, 22, 16);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // hub
  ctx.fillStyle = '#44403c';
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, taus); ctx.fill();
  ctx.fillStyle = '#a8a29e';
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, taus); ctx.fill();
  const img = sprite('wheel');
  if (img) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(img, -r - 8, -r - 8, (r + 8) * 2, (r + 8) * 2);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Screw lift: a translucent tube with the auger helix turning inside and little windows the
 * rider slides past. The entry collar shows the queue: full tubes dim.
 */
function drawScrew(ctx: CanvasRenderingContext2D, _b: Matter.Body, md: ReturnType<typeof meta>, t: number) {
  const sc = md.screw;
  if (!sc) return;
  const a = sc.a, c = sc.b;
  const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
  const ang = Math.atan2(c.y - a.y, c.x - a.x);
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(ang);
  // tube shell
  ctx.fillStyle = 'rgba(125,211,252,0.14)';
  ctx.strokeStyle = '#57534e';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(0, -14, len, 28, 8); ctx.fill(); ctx.stroke();
  // auger helix — a sine spine running the spiral, turning with the frame clock
  ctx.strokeStyle = '#a16207';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  for (let x = 3; x < len - 3; x += 4) {
    const y = Math.sin((x / 14) + t * 0.004) * 9;
    if (x === 3) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  // windows
  ctx.fillStyle = 'rgba(2,6,23,0.55)';
  for (let x = 18; x < len - 6; x += 44) ctx.fillRect(x, -7, 14, 14);
  // entry collar + crank housing
  ctx.fillStyle = '#44403c';
  ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#a8a29e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
  if (!drawSprite(ctx, 'crusher-house', len - 10, 18, 44, 36)) {
    ctx.fillStyle = '#57534e';
    ctx.fillRect(len - 26, 12, 30, 22);
  }
  ctx.restore();
}

/** Seesaw: the plank body plus the stone pivot it swings on (pivot drawn under it). */
function drawSeesaw(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>) {
  const ss = md.seesaw;
  if (!ss) return;
  const P = b.position;
  // stone pivot
  ctx.fillStyle = '#78716c';
  ctx.strokeStyle = '#44403c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(P.x - 18, P.y + 34);
  ctx.lineTo(P.x, P.y + 2);
  ctx.lineTo(P.x + 18, P.y + 34);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // plank
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.rotate(ss.angle);
  if (!drawSprite(ctx, 'seesaw', 0, 0, ss.len * 1.06, 16)) {
    ctx.fillStyle = '#8a5a2e';
    ctx.strokeStyle = '#3f2a14';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(-ss.len / 2, -7, ss.len, 14, 4); ctx.fill(); ctx.stroke();
    for (let x = -ss.len / 2 + 24; x < ss.len / 2; x += 48) {
      ctx.fillStyle = '#44403c';
      ctx.fillRect(x, -7, 6, 14);
    }
  }
  // iron pin
  ctx.fillStyle = '#a8a29e';
  ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

type BridgeNeighbours = { previous: Matter.Body | null; next: Matter.Body | null };
/** Cache neighbours once; positions remain live as the bridge sags. */
const bridgeNeighbours = new WeakMap<Game['track'], Map<Matter.Body, BridgeNeighbours>>();
function neighboursForBridge(game: Game, body: Matter.Body): BridgeNeighbours {
  let links = bridgeNeighbours.get(game.track);
  if (!links) {
    links = new Map();
    let previous: Matter.Body | null = null;
    for (const plank of game.track.bodies) {
      const br = meta(plank).bridge;
      if (!br) continue;
      if (br.idx === 0) previous = null;
      links.set(plank, { previous, next: null });
      if (previous) links.get(previous)!.next = plank;
      previous = plank;
    }
    bridgeNeighbours.set(game.track, links);
  }
  return links.get(body) ?? { previous: null, next: null };
}

/** Painted timber deck with continuous ropes following the existing live plank bodies. */
function drawBridgePlank(ctx: CanvasRenderingContext2D, b: Matter.Body, md: ReturnType<typeof meta>, game: Game) {
  const br = md.bridge;
  if (!br) return;
  const neighbours = neighboursForBridge(game, b);
  const previous = neighbours.previous?.position ?? br.anchor[0];
  const next = neighbours.next?.position ?? br.anchor[1];
  const points = [previous, b.position];
  if (br.idx === br.n - 1) points.push(br.anchor[1]);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Continuous handrope and lower suspension rope, with a dark edge and a warm fibre highlight.
  for (const lift of [-24, 5]) {
    for (const [width, colour] of [[5, '#352215'], [3, '#a77c43'], [1, '#e4bd76']] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y + lift) : ctx.moveTo(p.x, p.y + lift));
      ctx.stroke();
    }
  }
  // Follow the deck tangent even before the first physics tick in the workshop.
  // The collision planks overlap for safety; painted boards meet at their midpoint instead.
  const angle = Math.atan2(next.y - previous.y, next.x - previous.x);
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const before = (b.position.x - previous.x) * ux + (b.position.y - previous.y) * uy;
  const after = (next.x - b.position.x) * ux + (next.y - b.position.y) * uy;
  const left = br.idx === 0 ? before : before / 2;
  const right = br.idx === br.n - 1 ? after : after / 2;
  ctx.save();
  ctx.translate(b.position.x, b.position.y);
  ctx.rotate(angle);
  if (!drawSpriteContent(ctx, 'rail-wood', -left - 1, -5, right + 1, 9)) {
    ctx.fillStyle = '#a3653d';
    ctx.strokeStyle = '#51321c';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-left, -5, left + right, 12, 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
  // Lash each slat to the handrope; these remain attached as the deck flexes.
  ctx.strokeStyle = '#50351f';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(b.position.x, b.position.y - 24); ctx.lineTo(b.position.x, b.position.y + 7); ctx.stroke();
  ctx.strokeStyle = '#d0a36a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#493329';
  ctx.beginPath(); ctx.arc(b.position.x, b.position.y, 2.5, 0, Math.PI * 2); ctx.fill();
  // Two fixed anchor posts; the deck and ropes move independently beneath them.
  for (const end of [0, 1]) {
    if (br.idx !== (end === 0 ? 0 : br.n - 1)) continue;
    const anchor = br.anchor[end];
    ctx.save();
    ctx.translate(anchor.x, anchor.y);
    const wood = ctx.createLinearGradient(-6, 0, 6, 0);
    wood.addColorStop(0, '#422817'); wood.addColorStop(0.4, '#aa7140'); wood.addColorStop(1, '#50301d');
    ctx.fillStyle = wood;
    ctx.strokeStyle = '#2b211b';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-6, -38, 12, 46, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#55514a';
    ctx.fillRect(-7, -35, 14, 5); ctx.fillRect(-7, 0, 14, 5);
    ctx.strokeStyle = '#c79a62'; ctx.lineWidth = 2;
    for (let y = -27; y <= -21; y += 3) {
      ctx.beginPath(); ctx.moveTo(-7, y); ctx.lineTo(7, y + 1); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Conveyor belt: an iron deck with rollers at both ends and a moving chevron tread; the tread
 * direction (and its clock flip) matches what the engine pushes with.
 */
function drawConveyor(ctx: CanvasRenderingContext2D, _b: Matter.Body, md: ReturnType<typeof meta>, game: Game, t: number) {
  const surface = md.surface;
  const belt = md.belt;
  if (!surface || !belt) return;
  const dir = beltDir(belt, game.time);
  const tx = surface.tangent.x, ty = surface.tangent.y;
  const L = surface.length;
  const mx = (surface.start.x + surface.end.x) / 2, my = (surface.start.y + surface.end.y) / 2;
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(Math.atan2(ty, tx));
  // deck
  if (!drawSprite(ctx, 'conveyor', 0, -4, L * 1.02, 16)) {
    ctx.fillStyle = '#1f2937';
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-L / 2, -9, L, 18, 5); ctx.fill(); ctx.stroke();
  }
  // rollers
  ctx.fillStyle = '#6b7280';
  ctx.strokeStyle = '#374151';
  ctx.lineWidth = 2;
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.arc((L / 2 - 8) * sx * 1, 0, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.translate((L / 2 - 8) * sx, 0);
    ctx.rotate(dir * t * 0.01);
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 7); ctx.stroke();
    ctx.restore();
  }
  // moving chevron tread
  const offset = posMod(dir * t * belt.v * 60, 46);
  ctx.strokeStyle = 'rgba(250,204,21,0.75)';
  ctx.lineWidth = 3;
  for (let x = -L / 2 + offset; x < L / 2 - 8; x += 46) {
    ctx.beginPath();
    if (dir === 1) {
      ctx.moveTo(x - 6, -6);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x - 6, 6);
    } else {
      ctx.moveTo(x + 6, -6);
      ctx.lineTo(x - 5, 0);
      ctx.lineTo(x + 6, 6);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function posMod(v: number, m: number): number {
  return ((v % m) + m) % m;
}
