// Sky runs on platformer courses: the owner's clouds (cut from assets/new-art/clouds_*.png by
// scripts/assets/clouds.mjs) drawn over cloud platforms, and the wooden kicker ramps that throw a ball up to them.
// Art only: the physics is the plan's one-way ledge and the kicker's floor wedge (build.ts).
import type { CoursePlan, Kicker, Ledge } from './course';
import { floorAt } from './course';

const urls = import.meta.glob<string>('../../assets/game/platformer/clouds/*.webp', { eager: true, import: 'default' });
const load = (src: string) => (typeof Image !== 'undefined' ? Object.assign(new Image(), { src }) : null);
/** The flat-bottomed clouds first (cloud-1..5, the platforms), then the puffy ones (cloud-6..10). */
const CLOUDS = Object.keys(urls)
  .sort((a, b) => Number(/(\d+)\.webp$/.exec(a)![1]) - Number(/(\d+)\.webp$/.exec(b)![1]))
  .map((k) => load(urls[k]));
const ready = (img: HTMLImageElement | null): img is HTMLImageElement => !!img && img.complete && img.naturalWidth > 0;
/** Cloud picture `i` (0..9; 5..9 are the puffy ones), once loaded. */
export function cloudPicture(i: number): HTMLImageElement | null {
  const img = CLOUDS[((i % CLOUDS.length) + CLOUDS.length) % CLOUDS.length] ?? null;
  return ready(img) ? img : null;
}

/** Where a cloud's deck (the line a ball rolls on) sits in its picture, from the top: the flat clouds' fluffy top rises above it. */
const DECK = 0.42;

/** A cloud platform: the picture a little wider than the deck, its deck line on the ledge's top. */
export function drawCloudLedge(ctx: CanvasRenderingContext2D, l: Ledge): void {
  const img = CLOUDS[(l.cloud ?? 0) % Math.max(1, CLOUDS.length)] ?? null;
  const w = l.w * 1.22;
  if (!ready(img)) {
    // until the art loads: a soft white pill
    ctx.fillStyle = 'rgba(245,250,255,0.92)';
    ctx.beginPath();
    ctx.ellipse(l.x + l.w / 2, l.y + 10, w / 2, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const h = (img.naturalHeight / img.naturalWidth) * w;
  ctx.drawImage(img, l.x + l.w / 2 - w / 2, l.y - h * DECK, w, h);
}

/** A kicker ramp: a wooden wedge on the track with its lip at the top, struts underneath and a red stripe on the lip. */
export function drawKicker(ctx: CanvasRenderingContext2D, plan: CoursePlan, k: Kicker): void {
  const y0 = floorAt(plan, k.lane, k.x) ?? 0, y1 = floorAt(plan, k.lane, k.x + k.w) ?? y0;
  const top = y1 - k.h;
  ctx.save();
  // body
  ctx.fillStyle = '#7a4a26';
  ctx.beginPath();
  ctx.moveTo(k.x, y0 + 2);
  ctx.lineTo(k.x + k.w, top);
  ctx.lineTo(k.x + k.w, y1 + 4);
  ctx.closePath();
  ctx.fill();
  // struts
  ctx.strokeStyle = '#4a2c15';
  ctx.lineWidth = 4;
  for (let i = 1; i < 4; i++) {
    const x = k.x + (k.w * i) / 4, yt = y0 + ((top - y0) * i) / 4;
    ctx.beginPath(); ctx.moveTo(x, yt + 3); ctx.lineTo(x, y0 + ((y1 - y0) * i) / 4 + 2); ctx.stroke();
  }
  // deck planks
  ctx.strokeStyle = '#c98a4b';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(k.x, y0); ctx.lineTo(k.x + k.w, top); ctx.stroke();
  // the lip
  ctx.fillStyle = '#d63e2e';
  ctx.fillRect(k.x + k.w - 6, top - 4, 8, 10);
  ctx.restore();
}
