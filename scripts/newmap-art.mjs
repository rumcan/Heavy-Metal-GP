#!/usr/bin/env node
/**
 * New Map Builder art slicing: cuts the author's three sprite sheets
 * (assets/new-map-builder/) into the game sprite inventory. Sheets have real
 * alpha; each job names the window it lives in, we alpha-trim and rasterise to
 * stock dims. Replaces the AI-painted interim art.
 *
 * Every sprite on the sheets is sliced: the whole inventory rides the
 * author's sheet art now (bar the drawing cells the author labelled with
 * their own names for assets not in the game — see below). Window
 * assignments follow the author's labelled reference: crusher = yellow
 * warning piston, crusher-house = slatted gate, trapdoor = splat plank,
 * conveyor = red-chevron plank, switchplate = arrow totem, screw = vertical
 * coil lift, bridge/flipper = bracketed plank, seesaw = diamond plank,
 * trampoline = rope net, posts = braced pair.
 *
 * Not sliced (no game consumer — author's own names): wooden_cannon (banded
 * log), skull-box (skull in iron frame).
 *
 * Run: node scripts/newmap-art.mjs
 */
import { decodePng, encodePng, bbox, crop, resize } from './lib/png-pipe.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = join(ROOT, 'assets/new-map-builder');
const OUT = join(ROOT, 'src/assets/game');

const sheet = (file) => decodePng(readFileSync(join(SHEETS, file)));
const S = {
  1: sheet('2f4dfdf4-a974-4b87-ae05-2860d59ff461.png'),
  2: sheet('708c764a-8a69-4594-81a2-8b7f8c7a6fc0.png'),
  3: sheet('9014596d-0081-4bdb-a5c1-5e5bb8a0716c.png'),
};

function save(name, img) {
  writeFileSync(join(OUT, name), encodePng(img.w, img.h, img.px));
  console.log(`wrote ${name} ${img.w}x${img.h}`);
}

/** crop a blob window, alpha-trim, letterbox into WxH (keeps art aspect). */
function cut(sheetNo, x0, y0, x1, y1, W, H, { pad = 6 } = {}) {
  const img = S[sheetNo];
  const bb = bbox(crop(img, x0, y0, x1, y1));
  const a = crop(img, x0 + Math.max(0, bb.x0 - pad), y0 + Math.max(0, bb.y0 - pad), x0 + bb.x1 + 1 + pad, y0 + bb.y1 + 1 + pad);
  const k = Math.min(W / a.w, H / a.h);
  const rw = Math.max(1, Math.round(a.w * k)), rh = Math.max(1, Math.round(a.h * k));
  const r = resize(a, rw, rh);
  // center on a WxH transparent canvas
  const out = { w: W, h: H, px: new Uint8ClampedArray(W * H * 4) };
  const ox = Math.round((W - rw) / 2), oy = Math.round((H - rh) / 2);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const si = (y * rw + x) * 4, di = ((y + oy) * W + x + ox) * 4;
    for (let c = 0; c < 4; c++) out.px[di + c] = r.px[si + c];
  }
  return out;
}

// ---- sheet 1: MB-10A passages + MB-10B/D machinery ----
save('crumble.png', cut(1, 62, 46, 390, 328, 100, 140));
save('crusher.png', cut(1, 458, 116, 876, 288, 150, 60));        // yellow-triangle piston beam
save('crusher-house.png', cut(1, 936, 114, 1404, 286, 170, 46)); // slatted piston gate
save('barricade.png', cut(1, 58, 368, 496, 566, 140, 60));
save('blade.png', cut(1, 642, 294, 816, 672, 70, 170));
save('blast.png', cut(1, 1068, 320, 1350, 602, 96, 96));
save('boulder.png', cut(1, 172, 584, 380, 788, 76, 76));
save('flipper.png', cut(1, 576, 676, 830, 766, 160, 48));
save('bridge.png', cut(1, 576, 676, 830, 766, 56, 14));
save('cannon.png', cut(1, 916, 602, 1406, 818, 192, 48));
save('catapult.png', cut(1, 54, 786, 904, 1048, 224, 64));
save('conveyor.png', cut(1, 950, 900, 1445, 1000, 132, 22));     // red-chevron plank
save('arrow.png', cut(1, 950, 900, 1445, 1000, 132, 24));        // the chevron plank doubles as the switch arrow

// ---- sheet 2: MB-10E fields + movers ----
save('mud.png', cut(2, 18, 168, 614, 362, 160, 56));
save('platform.png', cut(2, 648, 0, 1436, 404, 280, 120, { pad: 4 }));
save('pool.png', cut(2, 38, 478, 566, 724, 160, 56));
save('saw.png', cut(2, 602, 420, 944, 760, 82, 82));
save('scoop.png', cut(2, 1008, 442, 1422, 772, 120, 72));
save('geyser.png', cut(2, 726, 780, 882, 1056, 44, 56));
save('mace.png', cut(2, 890, 788, 1166, 1064, 76, 76));
save('magnet.png', cut(2, 1182, 776, 1432, 1040, 120, 112));

// ---- sheet 3: MB-10C movers + MB-10F set pieces ----
save('switchplate.png', cut(3, 88, 10, 210, 312, 24, 120));      // arrow totem
save('target-pin.png', cut(3, 346, 94, 496, 294, 48, 64));
save('targets.png', cut(3, 560, 142, 988, 252, 224, 60));
save('tunnel.png', cut(3, 1148, 326, 1374, 552, 100, 100));      // portal ring
save('turnstile.png', cut(3, 56, 560, 306, 806, 160, 160));
save('vortex.png', cut(3, 406, 562, 694, 824, 240, 240));
save('wheel.png', cut(3, 788, 554, 1056, 812, 128, 128));
save('wind.png', cut(3, 1150, 622, 1386, 772, 80, 56));
save('trapdoor.png', cut(3, 596, 372, 1072, 478, 120, 28));      // hinged splat plank
save('seesaw.png', cut(3, 296, 880, 770, 945, 140, 16));         // diamond-chevron plank
save('screw.png', cut(3, 10, 825, 205, 1075, 64, 112));          // vertical coil lift
save('sling.png', cut(3, 1100, 780, 1448, 1080, 120, 136));

// trampoline: rope net for the palette; the braced posts come from row 2
save('trampoline.png', cut(3, 1028, 86, 1404, 280, 192, 96));
save('trampoline-post-l.png', cut(3, 30, 283, 245, 560, 64, 96));
save('trampoline-post-r.png', cut(3, 330, 283, 565, 560, 64, 96));

console.log("Sheets sliced: full inventory now on the author's sheet art.");
