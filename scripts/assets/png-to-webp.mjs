// Converts the game's PNG sprites (src/assets/game/*.png) to WebP at visually lossless quality, keeping each name, and
// removes the PNG. The sprite loader finds a sprite by name whatever its extension, and every sprite is inlined into
// the single-file build, so this cuts download and decode time without touching how anything looks.
// Run: node scripts/assets/png-to-webp.mjs [--dry-run]
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = fileURLToPath(new URL('../../src/assets/game/', import.meta.url));
const dry = process.argv.includes('--dry-run');
let before = 0, after = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.png'))) {
  const src = path.join(dir, name);
  const out = src.replace(/\.png$/, '.webp');
  const size = statSync(src).size;
  // near-lossless keeps edges and flat colours exact; alpha stays lossless
  const buf = await sharp(src).webp({ quality: 92, alphaQuality: 100, nearLossless: true, effort: 6 }).toBuffer();
  before += size; after += buf.length;
  if (buf.length >= size) { console.log(`keep ${name} (webp would be bigger)`); continue; }
  console.log(`${name}: ${(size / 1024).toFixed(0)} KB -> ${(buf.length / 1024).toFixed(0)} KB`);
  if (!dry) { await sharp(buf).toFile(out); unlinkSync(src); }
}
console.log(`total ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB${dry ? ' (dry run)' : ''}`);
