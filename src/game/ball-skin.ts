/**
 * P2-18: procedural marble cosmetics.
 *
 * A single small vector canvas is generated for each marble and kept in a
 * WeakMap. The hot render path only compares its appearance key and blits the
 * cached image at the marble's position/angle; no gradients or decals are
 * rebuilt per frame. Everything is drawn with Canvas2D — no texture assets.
 */
import type { Marble } from './engine';
import {
  DEFAULT_LOOK, currentBallLook, sanitizeLook,
} from './cosmetics';
import type { BallLook } from './cosmetics';

const SPRITE_SIZE = 96;
const SPRITE_CENTER = SPRITE_SIZE / 2;
const SPRITE_RADIUS = 43;

interface CacheEntry<T> { key: string; sprite: T }

/** Small generic cache so its redraw contract can be tested without a DOM canvas. */
export class BallSkinCache<T> {
  private readonly entries = new WeakMap<object, CacheEntry<T>>();

  get(owner: object, key: string, build: () => T): T {
    const cached = this.entries.get(owner);
    if (cached?.key === key) return cached.sprite;
    const sprite = build();
    this.entries.set(owner, { key, sprite });
    return sprite;
  }

  delete(owner: object): void {
    this.entries.delete(owner);
  }
}

const sprites = new BallSkinCache<HTMLCanvasElement | null>();

/** Stable key in declared field order; invalid/untrusted looks normalize first. */
export function ballSkinKey(raw: unknown): string {
  return JSON.stringify(sanitizeLook(raw));
}

function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return hex;
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

function rgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return `rgba(220,230,240,${alpha})`;
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner = outer * 0.44) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const radius = i % 2 === 0 ? outer : inner;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function drawMaterial(ctx: CanvasRenderingContext2D, look: BallLook, cx: number, cy: number, r: number) {
  const base = look.primary;
  const secondary = look.secondary;
  const gradient = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.43, r * 0.05, cx, cy, r * 1.15);
  gradient.addColorStop(0, shade(base, 1.72));
  gradient.addColorStop(0.38, base);
  gradient.addColorStop(1, shade(base, 0.4));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  ctx.clip();
  switch (look.material) {
    case 'steel':
    case 'chrome': {
      const bands = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      bands.addColorStop(0, 'rgba(255,255,255,0.02)');
      bands.addColorStop(0.3, 'rgba(255,255,255,0.62)');
      bands.addColorStop(0.48, 'rgba(255,255,255,0.08)');
      bands.addColorStop(0.72, 'rgba(10,18,28,0.28)');
      bands.addColorStop(0.86, 'rgba(255,255,255,0.3)');
      bands.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.fillStyle = bands;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1.4;
      for (let x = cx - r; x < cx + r; x += r * 0.42) {
        ctx.beginPath(); ctx.moveTo(x, cy - r); ctx.lineTo(x + r * 0.3, cy + r); ctx.stroke();
      }
      break;
    }
    case 'brass':
    case 'gold': {
      const metal = ctx.createLinearGradient(cx - r, cy - r * 0.7, cx + r, cy + r);
      metal.addColorStop(0, 'rgba(255,255,220,0.52)');
      metal.addColorStop(0.22, 'rgba(255,255,255,0.06)');
      metal.addColorStop(0.48, 'rgba(80,35,0,0.23)');
      metal.addColorStop(0.68, 'rgba(255,248,190,0.45)');
      metal.addColorStop(1, 'rgba(40,20,0,0.3)');
      ctx.fillStyle = metal;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      break;
    }
    case 'rust':
    case 'granite': {
      for (let i = 0; i < 46; i++) {
        const a = i * 2.399963;
        const distance = r * Math.sqrt(((i * 37) % 47) / 47);
        const x = cx + Math.cos(a) * distance;
        const y = cy + Math.sin(a) * distance;
        ctx.beginPath();
        ctx.arc(x, y, 0.8 + (i % 4) * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = i % 3 === 0 ? rgba('#f4f1ea', 0.44) : rgba(look.material === 'rust' ? '#6c2f18' : '#111827', 0.38);
        ctx.fill();
      }
      if (look.material === 'rust') {
        ctx.strokeStyle = rgba('#ffb703', 0.24);
        ctx.lineWidth = 2;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath(); ctx.moveTo(cx - r, cy + i * 15); ctx.lineTo(cx + r, cy + i * 15 - 9); ctx.stroke();
        }
      }
      break;
    }
    case 'oak': {
      ctx.strokeStyle = rgba(secondary, 0.5);
      ctx.lineWidth = 1.7;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.ellipse(cx + (i % 2) * 5 - 3, cy + (i - 3) * 4, r * 0.82 - i * 3, r * 0.16, -0.48, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'glass': {
      ctx.fillStyle = 'rgba(210,250,255,0.32)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.84)';
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.55, cy + r * 0.68); ctx.lineTo(cx + r * 0.46, cy - r * 0.58); ctx.stroke();
      break;
    }
    case 'lava': {
      ctx.shadowColor = '#ff5a1f';
      ctx.shadowBlur = 7;
      ctx.strokeStyle = '#ffb703';
      ctx.lineWidth = 2.4;
      for (let i = -2; i <= 2; i++) {
        const y = cy + i * 14;
        ctx.beginPath(); ctx.moveTo(cx - r, y + 6); ctx.lineTo(cx - 10, y - 4); ctx.lineTo(cx + 1, y + 4); ctx.lineTo(cx + r, y - 8); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      break;
    }
    case 'ice': {
      ctx.fillStyle = 'rgba(190,245,255,0.36)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.66)';
      ctx.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(cx - r, cy + i * 18); ctx.lineTo(cx + r, cy + i * 18 - 11); ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

function drawPattern(ctx: CanvasRenderingContext2D, look: BallLook, cx: number, cy: number, r: number) {
  const color = look.secondary;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (look.pattern) {
    case 'stripes':
      ctx.strokeStyle = rgba(color, 0.86); ctx.lineWidth = 7;
      for (let x = cx - r * 1.6; x < cx + r * 1.6; x += 19) {
        ctx.beginPath(); ctx.moveTo(x, cy + r); ctx.lineTo(x + r, cy - r); ctx.stroke();
      }
      break;
    case 'band': {
      ctx.fillStyle = color; ctx.fillRect(cx - r, cy - 11, r * 2, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(cx - r, cy - 11, r * 2, 3);
      break;
    }
    case 'checker':
      ctx.fillStyle = rgba(color, 0.9);
      for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
        if ((row + col) % 2 === 0) ctx.fillRect(cx - r + col * 23, cy - r + row * 23, 23, 23);
      }
      break;
    case 'flames':
      ctx.fillStyle = color;
      for (let i = -1; i <= 1; i++) {
        const x = cx + i * 22;
        ctx.beginPath(); ctx.moveTo(x - 10, cy + r); ctx.bezierCurveTo(x - 19, cy + 13, x + 9, cy + 12, x - 3, cy - 11);
        ctx.bezierCurveTo(x + 23, cy + 10, x + 13, cy + 28, x + 22, cy + r); ctx.closePath(); ctx.fill();
      }
      break;
    case 'skull':
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.ellipse(cx, cy - 1, 16, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 10, cy + 9, 20, 10);
      ctx.fillStyle = shade(look.primary, 0.3);
      ctx.beginPath(); ctx.arc(cx - 6, cy - 1, 4, 0, Math.PI * 2); ctx.arc(cx + 6, cy - 1, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(cx - 1.5, cy + 4, 3, 5);
      break;
    case 'goblin':
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(cx - 12, cy - 8); ctx.lineTo(cx - 34, cy - 24); ctx.lineTo(cx - 28, cy + 1); ctx.lineTo(cx - 14, cy + 9); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx + 12, cy - 8); ctx.lineTo(cx + 34, cy - 24); ctx.lineTo(cx + 28, cy + 1); ctx.lineTo(cx + 14, cy + 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,245,210,0.95)';
      ctx.beginPath(); ctx.ellipse(cx, cy + 2, 19, 17, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.beginPath(); ctx.ellipse(cx - 7, cy - 1, 3, 5, -0.2, 0, Math.PI * 2); ctx.ellipse(cx + 7, cy - 1, 3, 5, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#111827'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 8, cy + 12); ctx.quadraticCurveTo(cx, cy + 17, cx + 8, cy + 11); ctx.stroke();
      break;
    case 'number':
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 25px system-ui, sans-serif';
      ctx.fillText(String(look.number).padStart(2, '0'), cx, cy + 1, r * 1.55);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2; ctx.strokeText(String(look.number).padStart(2, '0'), cx, cy + 1, r * 1.55);
      break;
    case 'team':
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(cx, cy - 27); ctx.lineTo(cx + 25, cy - 14); ctx.lineTo(cx + 21, cy + 11); ctx.lineTo(cx, cy + 27); ctx.lineTo(cx - 21, cy + 11); ctx.lineTo(cx - 25, cy - 14); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = look.primary; star(ctx, cx, cy, 10);
      break;
    case 'stars':
      ctx.fillStyle = color;
      for (const [x, y, s] of [[cx - 21, cy - 15, 7], [cx + 18, cy - 18, 6], [cx + 2, cy + 15, 9], [cx - 22, cy + 21, 5]] as const) star(ctx, x, y, s);
      break;
    case 'cracks':
      ctx.strokeStyle = color; ctx.lineWidth = 2.6;
      for (let i = 0; i < 3; i++) {
        const x = cx - 24 + i * 23;
        ctx.beginPath(); ctx.moveTo(x, cy - r); ctx.lineTo(x - 4, cy - 9); ctx.lineTo(x + 5, cy - 2); ctx.lineTo(x - 2, cy + 8); ctx.lineTo(x + 8, cy + r); ctx.stroke();
      }
      break;
    case 'rivets':
      ctx.fillStyle = color;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const x = cx + Math.cos(a) * (r - 7), y = cy + Math.sin(a) * (r - 7);
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x - 0.7, y - 0.7, 0.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
      }
      break;
  }
  // A fixed glint makes the sphere read as polished without hiding its decal.
  const glint = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.43, 1, cx - r * 0.38, cy - r * 0.43, r * 0.58);
  glint.addColorStop(0, 'rgba(255,255,255,0.48)'); glint.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glint; ctx.beginPath(); ctx.arc(cx - r * 0.38, cy - r * 0.43, r * 0.58, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function createSprite(look: BallLook): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawMaterial(ctx, look, SPRITE_CENTER, SPRITE_CENTER, SPRITE_RADIUS);
  drawPattern(ctx, look, SPRITE_CENTER, SPRITE_CENTER, SPRITE_RADIUS);
  ctx.beginPath(); ctx.arc(SPRITE_CENTER, SPRITE_CENTER, SPRITE_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(SPRITE_CENTER - 1.5, SPRITE_CENTER - 2, SPRITE_RADIUS - 3, Math.PI * 1.07, Math.PI * 1.74);
  ctx.strokeStyle = 'rgba(255,255,255,0.46)'; ctx.lineWidth = 2; ctx.stroke();
  return canvas;
}

/** Draw a cached ball sprite at any center/radius. Used by the live garage preview too. */
export function drawCachedBall(
  ctx: CanvasRenderingContext2D,
  owner: object,
  rawLook: unknown,
  x: number,
  y: number,
  radius: number,
  angle: number,
): boolean {
  if (typeof document === 'undefined') return false;
  const look = sanitizeLook(rawLook);
  const image = sprites.get(owner, JSON.stringify(look), () => createSprite(look));
  if (!image) return false;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(image, -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
  return true;
}

/** Resolve network seat metadata or the global local-player selection. */
export function ballLookForMarble(marble: Marble): BallLook {
  const info = marble.info as typeof marble.info & { cosmeticLook?: unknown };
  const stats = marble.info.stats as typeof marble.info.stats & { cosmeticLook?: unknown };
  const raw = info.cosmeticLook ?? stats.cosmeticLook;
  return raw !== undefined
    ? sanitizeLook(raw)
    : marble.info.isPlayer
      ? currentBallLook()
      : { ...DEFAULT_LOOK, primary: marble.info.color };
}

/** Draw a race marble. Seat cosmetics and the global local-player look share the same cache. */
export function drawBallSkin(ctx: CanvasRenderingContext2D, marble: Marble): boolean {
  const { x, y } = marble.body.position;
  return drawCachedBall(ctx, marble, ballLookForMarble(marble), x, y, 14, marble.body.angle);
}

/** Draw the chosen trail using the already-recorded marble trail points. */
export function drawBallTrail(
  ctx: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  x: number,
  y: number,
  look: BallLook,
  fallbackColor: string,
  rocket: boolean,
): void {
  if (points.length <= 2) return;
  const path = () => {
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.lineTo(x, y);
  };
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (rocket) {
    path(); ctx.strokeStyle = 'rgba(251,146,60,0.72)'; ctx.lineWidth = 10; ctx.stroke();
    ctx.restore(); return;
  }
  switch (look.trail) {
    case 'none':
      path(); ctx.strokeStyle = `${fallbackColor}55`; ctx.lineWidth = 6; ctx.stroke();
      break;
    case 'smoke':
      path(); ctx.strokeStyle = 'rgba(148,163,184,0.48)'; ctx.lineWidth = 9; ctx.stroke();
      for (let i = 0; i < points.length; i += 3) { ctx.beginPath(); ctx.arc(points[i].x, points[i].y, 2 + (i % 3), 0, Math.PI * 2); ctx.fillStyle = 'rgba(203,213,225,0.38)'; ctx.fill(); }
      break;
    case 'sparks':
      path(); ctx.strokeStyle = look.secondary; ctx.lineWidth = 3; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      for (let i = 0; i < points.length; i += 3) { ctx.beginPath(); ctx.arc(points[i].x, points[i].y, 2.2, 0, Math.PI * 2); ctx.fillStyle = i % 2 ? '#ffb703' : '#fff4cc'; ctx.fill(); }
      break;
    case 'fire': {
      path(); const g = ctx.createLinearGradient(points[0].x, points[0].y, x, y); g.addColorStop(0, '#ef444466'); g.addColorStop(0.6, '#f97316'); g.addColorStop(1, '#fde047');
      ctx.strokeStyle = g; ctx.lineWidth = 9; ctx.stroke(); break;
    }
    case 'ice':
      path(); ctx.strokeStyle = 'rgba(125,211,252,0.82)'; ctx.lineWidth = 6; ctx.stroke();
      for (let i = 1; i < points.length; i += 4) { ctx.save(); ctx.translate(points[i].x, points[i].y); ctx.rotate(Math.PI / 4); ctx.fillStyle = 'rgba(224,242,254,0.9)'; ctx.fillRect(-2.4, -2.4, 4.8, 4.8); ctx.restore(); }
      break;
    case 'rainbow': {
      path(); const g = ctx.createLinearGradient(points[0].x, points[0].y, x, y); ['#ef4444', '#f97316', '#facc15', '#22c55e', '#38bdf8', '#8b5cf6'].forEach((c, i) => g.addColorStop(i / 5, c));
      ctx.strokeStyle = g; ctx.lineWidth = 7; ctx.stroke(); break;
    }
    case 'coins':
      path(); ctx.strokeStyle = 'rgba(251,191,36,0.25)'; ctx.lineWidth = 3; ctx.stroke();
      for (let i = 0; i < points.length; i += 4) { ctx.beginPath(); ctx.arc(points[i].x, points[i].y, 4, 0, Math.PI * 2); ctx.fillStyle = '#facc15'; ctx.fill(); ctx.strokeStyle = '#a16207'; ctx.lineWidth = 1; ctx.stroke(); }
      break;
    case 'wisps':
      path(); ctx.strokeStyle = 'rgba(196,181,253,0.24)'; ctx.lineWidth = 4; ctx.stroke();
      for (let i = 0; i < points.length; i += 3) { ctx.beginPath(); ctx.arc(points[i].x, points[i].y, 2.5 + (i % 2), 0, Math.PI * 2); ctx.fillStyle = 'rgba(221,214,254,0.76)'; ctx.fill(); }
      break;
  }
  ctx.restore();
}
