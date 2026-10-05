// Perf + quality: big art drawn small. The game's sprites are painted large (a 300 px catapult, a 1500 px tree line) and
// drawn at whatever size the camera needs. Shrinking an image a lot in one go with the browser's fast filter skips
// most of its pixels, which is what makes art look grainy and sparkle as it moves, and it reads a big texture every
// frame. `drawImg` draws through a pre-shrunk copy instead (a mip level: half, quarter, ... size, each made from the
// one above with the best filter) whenever the image lands on screen at under half its real size.

type Level = HTMLCanvasElement;
const pyramids = new WeakMap<HTMLImageElement, Level[]>();

/** Each smaller copy -> the picture it was made from (tests use it to name what was drawn). */
const sources = new WeakMap<object, HTMLImageElement>();
export const mipSource = (img: CanvasImageSource): CanvasImageSource => sources.get(img as object) ?? img;

function level(img: HTMLImageElement, k: number): Level | null {
  if (typeof document === 'undefined') return null;
  let levels = pyramids.get(img);
  if (!levels) { levels = []; pyramids.set(img, levels); }
  for (let i = levels.length; i < k; i++) {
    const src: CanvasImageSource = i === 0 ? img : levels[i - 1];
    const sw = i === 0 ? img.naturalWidth : levels[i - 1].width, sh = i === 0 ? img.naturalHeight : levels[i - 1].height;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw / 2));
    c.height = Math.max(1, Math.round(sh / 2));
    const cx = c.getContext('2d');
    if (!cx) return null;
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, 0, 0, c.width, c.height);
    sources.set(c, img);
    levels.push(c);
  }
  return levels[k - 1] ?? null;
}

/** Which pre-shrunk level suits an image drawn `ratio` of its real size (0 = the original). */
export function mipLevel(ratio: number, naturalW: number, naturalH: number): number {
  if (!(ratio > 0) || ratio >= 0.5) return 0;
  let k = Math.floor(Math.log2(1 / ratio));
  while (k > 0 && (naturalW >> k < 8 || naturalH >> k < 8)) k--;
  return Math.min(k, 6);
}

/** `ctx.drawImage` with the same arguments (2, 4 or 8 numbers), drawing big art drawn small from a mip level. */
export function drawImg(ctx: CanvasRenderingContext2D, img: CanvasImageSource, ...a: number[]): void {
  if (!(typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) || !img.naturalWidth) {
    (ctx.drawImage as (...args: unknown[]) => void)(img, ...a);
    return;
  }
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const sw = a.length >= 8 ? a[2] : nw;
  const dw = a.length >= 8 ? a[6] : a.length >= 4 ? a[2] : nw;
  const m = ctx.getTransform();
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  const k = mipLevel((Math.abs(dw) * scale) / Math.max(1, Math.abs(sw)), nw, nh);
  const lv = k ? level(img, k) : null;
  if (!lv) { (ctx.drawImage as (...args: unknown[]) => void)(img, ...a); return; }
  const fx = lv.width / nw, fy = lv.height / nh;
  if (a.length >= 8) ctx.drawImage(lv, a[0] * fx, a[1] * fy, a[2] * fx, a[3] * fy, a[4], a[5], a[6], a[7]);
  else if (a.length >= 4) ctx.drawImage(lv, a[0], a[1], a[2], a[3]);
  else ctx.drawImage(lv, a[0], a[1], nw, nh);
}
