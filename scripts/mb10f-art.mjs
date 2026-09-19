import { load, save, keyBackground, erodeAlpha, bbox, crop, square, resize, flipX } from './lib/png-pipe.mjs';

// ---------- trampoline: poster + two end posts ----------
{
  const img = load('trampoline-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  // poster icon: full net region
  const poster = crop(img, bb.x0 - 6, bb.y0 - 10, bb.x1 + 6, bb.y1 + 6);
  save(resize(poster, 192, 96), 'trampoline.png');
  // left post, cropped tight; the right post is its mirror so the frame reads symmetrical
  const lw = (bb.x1 - bb.x0) * 0.10;
  const left = crop(img, bb.x0 - 4, bb.y0 - 8, bb.x0 + lw, bb.y1 + 4);
  const lbb = bbox(left);
  const post = resize(crop(left, lbb.x0, lbb.y0, lbb.x1 + 1, lbb.y1 + 1), 64, 96);
  save(post, 'trampoline-post-l.png');
  save(flipX(post), 'trampoline-post-r.png');
}

// ---------- turnstile: square rotor ----------
{
  const img = load('turnstile-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  const side = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) + 20;
  save(resize(crop(img, cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), 160, 160), 'turnstile.png');
}

// ---------- targets: 4-pin strip poster + single standing pin ----------
{
  const img = load('targets-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  save(resize(crop(img, bb.x0 - 8, bb.y0 - 8, bb.x1 + 8, bb.y1 + 8), 224, 60), 'targets.png');
}
{
  const img = load('target-pin-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  // keep the plank + a hint of the iron base
  save(resize(crop(img, bb.x0 - 6, bb.y0 - 4, bb.x1 + 6, bb.y1 + 4), 48, 64), 'target-pin.png');
}

// ---------- vortex bowl ----------
{
  const img = load('vortex-src.png');
  keyBackground(img);
  erodeAlpha(img);
  save(resize(square(img), 240, 240), 'vortex.png');
}

// ---------- ferry platform ----------
{
  const img = load('platform-src.png');
  keyBackground(img);
  erodeAlpha(img);
  const bb = bbox(img);
  save(resize(crop(img, bb.x0 - 4, bb.y0 - 4, bb.x1 + 4, bb.y1 + 4), 280, 120), 'platform.png');
}

console.log('MB-10F painted sprites shipped.');
