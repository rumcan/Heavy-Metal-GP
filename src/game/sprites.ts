import type Matter from 'matter-js';

/** Gameplay sprites sliced from the "game graphics kit" sheet (see assets/ui). */
const files = import.meta.glob<string>('../assets/game/*.webp', { eager: true, import: 'default' });
const images = new Map<string, HTMLImageElement>();
if (typeof Image !== 'undefined') {
  for (const [path, url] of Object.entries(files)) {
    const img = new Image();
    img.src = url;
    images.set(path.slice(path.lastIndexOf('/') + 1, -'.webp'.length), img);
  }
}

/**
 * Art-theme skins (src/assets/game/skins/<skin>/<name>.webp) override base sprites of the same name. `render()`
 * sets the skin for the track it draws; any name a skin lacks falls back to the base art.
 */
const skinFiles = import.meta.glob<string>('../assets/game/skins/*/*.webp', { eager: true, import: 'default' });
if (typeof Image !== 'undefined') {
  for (const [path, url] of Object.entries(skinFiles)) {
    const [skin, file] = path.split('/skins/')[1].split('/');
    const img = new Image();
    img.src = url;
    images.set(`${skin}/${file.slice(0, -'.webp'.length)}`, img);
  }
}
/** Skin sprites that stand in for base names the theme sheets have no separate art for. */
const SKIN_ALIASES: Record<string, string> = {
  'balcony-horn': 'balcony-crowd', 'balcony-cannon': 'balcony-crowd', 'goblin-crowd': 'balcony-crowd',
  'tower-3': 'tower-1', 'tower-4': 'tower-2', 'mine-wall': 'cliff-left', 'mine-edge': 'cliff-left', 'flag-checker': 'flag-race',
};

let activeSkin: string | null = null;
/** Draw with an art theme's sprites (null = the default goblin art). */
export function setSkin(skin: string | null): void { activeSkin = skin; }
export function currentSkin(): string | null { return activeSkin; }

function loaded(img: HTMLImageElement | undefined): HTMLImageElement | null {
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export function sprite(name: string): HTMLImageElement | null {
  if (activeSkin) {
    const own = images.get(`${activeSkin}/${name}`);
    if (own) return loaded(own);
    const alias = SKIN_ALIASES[name];
    const aliased = alias ? images.get(`${activeSkin}/${alias}`) : undefined;
    if (aliased) return loaded(aliased);
  }
  return loaded(images.get(name));
}

const BALLS: [string, number, number][] = [
  // name, hue, saturation cut-off (low saturation => steel)
  ['red', 0, 0], ['orange', 28, 0], ['gold', 48, 0], ['green', 110, 0], ['cyan', 190, 0], ['blue', 220, 0], ['purple', 275, 0],
];
const ballCache = new Map<string, string>();
/** Closest-looking kit ball for a livery colour. */
export function ballFor(hex: string): string {
  const cached = ballCache.get(hex);
  if (cached) return cached;
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let name = 'steel';
  if (d > 0.18) {
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    // yellow-green liveries (Volt) read best as the lime/green ball
    if (h > 62 && h < 95) h = 110;
    let best = Infinity;
    for (const [candidate, hue] of BALLS) {
      const dist = Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue));
      if (dist < best) { best = dist; name = candidate; }
    }
  }
  const result = `ball-${name}`;
  ballCache.set(hex, result);
  return result;
}

const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();
function pattern(ctx: CanvasRenderingContext2D, img: HTMLImageElement, name: string): CanvasPattern | null {
  let map = patterns.get(ctx);
  if (!map) { map = new Map(); patterns.set(ctx, map); }
  let p = map.get(name);
  if (!p) {
    p = ctx.createPattern(img, 'repeat') ?? undefined;
    if (!p) return null;
    map.set(name, p);
  }
  return p;
}

/** Local frame of a (possibly chamfered) rectangular body: extents along its angle. */
export function bodyFrame(body: Matter.Body) {
  const a = body.angle;
  const ux = Math.cos(a), uy = Math.sin(a);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of body.vertices) {
    const dx = p.x - body.position.x, dy = p.y - body.position.y;
    const u = dx * ux + dy * uy;
    const v = -dx * uy + dy * ux;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  return { minU, maxU, minV, maxV };
}

const middles = new Map<string, HTMLCanvasElement>();
/** The plank between a rail sprite's iron end caps, cached as its own tileable image. */
function railMiddle(img: HTMLImageElement, name: string, capFrac: number): HTMLCanvasElement {
  let c = middles.get(name);
  if (!c) {
    const cap = Math.round(img.naturalWidth * capFrac);
    c = document.createElement('canvas');
    c.width = img.naturalWidth - cap * 2;
    c.height = img.naturalHeight;
    c.getContext('2d')!.drawImage(img, cap, 0, c.width, c.height, 0, 0, c.width, c.height);
    middles.set(name, c);
  }
  return c;
}

const RAIL_CAP = 0.125;
/**
 * Nine-slice style rail: iron end caps stay undistorted, the plank between them tiles along the body.
 * `caps` lists world points that should get a cap; ends near them are capped (default: both ends).
 */
export function drawRail(ctx: CanvasRenderingContext2D, body: Matter.Body, name: string, caps?: Matter.Vector[], thicknessScale = 1.3): boolean {
  const img = sprite(name);
  if (!img) return false;
  const frame = bodyFrame(body);
  // lay the rail along the body's long axis (upright walls are unrotated tall boxes)
  const upright = frame.maxV - frame.minV > frame.maxU - frame.minU;
  const angle = body.angle + (upright ? Math.PI / 2 : 0);
  const { minU, maxU, minV, maxV } = upright
    ? { minU: frame.minV, maxU: frame.maxV, minV: -frame.maxU, maxV: -frame.minU }
    : frame;
  const thick = (maxV - minV) * thicknessScale;
  const scale = thick / img.naturalHeight;
  const capW = img.naturalWidth * RAIL_CAP * scale;
  const ux = Math.cos(angle), uy = Math.sin(angle);
  const endNear = (u: number) => !caps || caps.some((p) => Math.hypot(body.position.x + ux * u - p.x, body.position.y + uy * u - p.y) < 24);
  const capL = endNear(minU), capR = endNear(maxU);
  const cy = (minV + maxV) / 2 - thick / 2;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(angle);
  const mid = railMiddle(img, name, RAIL_CAP);
  const x0 = minU + (capL ? capW * 0.6 : 0);
  const x1 = maxU - (capR ? capW * 0.6 : 0);
  const tileW = mid.width * scale;
  for (let x = x0; x < x1; x += tileW) {
    const w = Math.min(tileW, x1 - x);
    ctx.drawImage(mid, 0, 0, w / scale, mid.height, x, cy, w + 0.5, thick);
  }
  const srcCap = img.naturalWidth * RAIL_CAP;
  if (capL) ctx.drawImage(img, 0, 0, srcCap, img.naturalHeight, minU - capW * 0.4, cy, capW, thick);
  if (capR) ctx.drawImage(img, img.naturalWidth - srcCap, 0, srcCap, img.naturalHeight, maxU - capW * 0.6, cy, capW, thick);
  ctx.restore();
  return true;
}

/**
 * Fill a body with a tiled strip sprite, scaled so the strip height matches the body thickness.
 * Returns false when the sprite is not loaded yet so callers can fall back to flat drawing.
 */
export function drawStrip(ctx: CanvasRenderingContext2D, body: Matter.Body, name: string, options: { tile?: number } = {}): boolean {
  const img = sprite(name);
  if (!img) return false;
  const p = pattern(ctx, img, name);
  if (!p) return false;
  const { minU, maxU, minV, maxV } = bodyFrame(body);
  const thick = maxV - minV;
  const scale = (options.tile ?? thick) / img.naturalHeight;
  ctx.save();
  ctx.translate(body.position.x, body.position.y);
  ctx.rotate(body.angle);
  p.setTransform(new DOMMatrix().translateSelf(minU, minV).scaleSelf(scale, scale));
  ctx.fillStyle = p;
  ctx.fillRect(minU, minV, maxU - minU, thick);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(minU, minV, maxU - minU, thick);
  ctx.restore();
  return true;
}

export function drawSprite(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, w: number, h: number, angle = 0): boolean {
  const img = sprite(name);
  if (!img) return false;
  if (angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
  }
  return true;
}
