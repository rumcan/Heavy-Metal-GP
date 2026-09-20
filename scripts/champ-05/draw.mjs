// CHAMP-05 map inspector (dev only): draws every collision body of the authored
// def, colour-coded by kind, with the ticket's centrelines and any recorded
// marble traces on top, then rasterises the SVG with sharp so the geometry can
// be eyeballed without a browser.
//
//   node --import tsx scripts/champ-05/draw.mjs                    # whole map
//   node --import tsx scripts/champ-05/draw.mjs --win 0,600,900,700 --scale 1
//   node --import tsx scripts/champ-05/draw.mjs --trace tests/artifacts/scratch/trace-a.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { buildTrackFromDef } from '../../src/game/trackdef.ts';
import { meta } from '../../src/game/track.ts';
import { def, CENTRELINES } from './def.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = join(root, 'tests', 'artifacts');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const win = (arg('win') ?? '0,0,900,3640').split(',').map(Number);
const scale = Number(arg('scale', win[3] > 1400 ? 0.42 : 1));
const name = arg('out', `champ05-${win[1]}.png`);
const kinds = arg('kinds');
const traceFiles = args.filter((a, i) => args[i - 1] === '--trace');

const ROCK = { ramp: '#a2542c', wall: '#8d4526', curve: '#a2542c', block: '#7c3d21', ice: '#9fd8e8' };
const HAZARD = new Set(['blade', 'mace', 'saw', 'crusher', 'boulder', 'spinner', 'wrecker', 'turnstile']);
const SENSOR = new Set(['boost', 'itembox', 'finish', 'gate', 'switchPad', 'bucket', 'tunnel', 'scoop', 'wind', 'magnet', 'trampoline']);

const track = buildTrackFromDef(def);
const W = win[2], H = win[3], X0 = win[0], Y0 = win[1];
const parts = [];
parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W * scale)}" height="${Math.round(H * scale)}" viewBox="${X0} ${Y0} ${W} ${H}">`);
parts.push(`<rect x="${X0}" y="${Y0}" width="${W}" height="${H}" fill="#180d07"/>`);

// sector bands from the def's own segment list
for (const s of def.segments ?? []) {
  if (s.y + s.h < Y0 || s.y > Y0 + H) continue;
  parts.push(`<rect x="${X0}" y="${s.y}" width="${W}" height="${s.h}" fill="none" stroke="#3a2418" stroke-width="2" stroke-dasharray="14 10"/>`);
  parts.push(`<text x="${X0 + 8}" y="${s.y + 26}" fill="#e8b48a" font-size="22" font-family="monospace">${s.name} y=${s.y}</text>`);
}

// centrelines the ticket specifies
for (const line of CENTRELINES) {
  if (kinds && !kinds.split(',').includes(line.key)) continue;
  const d = line.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
  parts.push(`<path d="${d}" fill="none" stroke="${line.color ?? '#39d3c3'}" stroke-width="3" stroke-dasharray="10 8" opacity="0.85"/>`);
  for (const p of line.pts) parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="${line.color ?? '#39d3c3'}"/>`);
  if (line.label) {
    const p = line.pts[0];
    parts.push(`<text x="${p[0] + 8}" y="${p[1] - 8}" fill="${line.color ?? '#39d3c3'}" font-size="18" font-family="monospace">${line.label}</text>`);
  }
}

// bodies
for (const b of track.bodies) {
  const md = meta(b);
  const kind = md?.kind ?? b.label;
  const bb = b.bounds;
  if (bb.max.x < X0 || bb.min.x > X0 + W || bb.max.y < Y0 || bb.min.y > Y0 + H) continue;
  const poly = b.vertices.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';
  let fill = ROCK[kind] ?? '#6b6b6b';
  let stroke = '#2a150c';
  let width = 1;
  let dash = '';
  let opacity = 1;
  if (kind === 'ppeg') { fill = md.pegColor === 'green' ? '#4ade80' : md.pegColor === 'orange' ? '#fb923c' : '#60a5fa'; stroke = '#0b0b0b'; }
  else if (kind === 'peg') { fill = '#d6d3d1'; }
  else if (kind === 'itembox') { fill = 'none'; stroke = '#facc15'; width = 3; dash = '6 5'; }
  else if (kind === 'boost') { fill = 'rgba(56,189,248,0.35)'; stroke = '#38bdf8'; width = 2; }
  else if (kind === 'crumble') { fill = '#a16207'; stroke = '#451a03'; }
  else if (kind === 'barricade') { fill = '#b91c1c'; stroke = '#450a0a'; }
  else if (HAZARD.has(kind)) { fill = '#dc2626'; stroke = '#fee2e2'; width = 2; }
  else if (kind === 'platform') { fill = '#7c93a8'; stroke = '#dbeafe'; width = 2; }
  else if (kind === 'switch' || kind === 'switchPad') { fill = kind === 'switchPad' ? 'none' : '#f5f5f4'; stroke = '#f5f5f4'; width = 2; dash = kind === 'switchPad' ? '6 5' : ''; }
  else if (kind === 'sling') { fill = '#f97316'; stroke = '#7c2d12'; }
  else if (SENSOR.has(kind)) { fill = 'none'; stroke = '#fde047'; width = 2; dash = '6 5'; opacity = 0.9; }
  else if (kind === 'gate') { fill = 'none'; stroke = '#22c55e'; width = 3; dash = '8 6'; }
  else if (kind === 'finish') { fill = 'none'; stroke = '#22c55e'; width = 3; dash = '8 6'; }
  parts.push(`<path d="${poly}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="${opacity}"/>`);
}

// recorded marble traces
for (const file of traceFiles) {
  const trace = JSON.parse(readFileSync(file, 'utf8'));
  for (const t of trace) {
    const d = t.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="${t.color}" stroke-width="3.5" opacity="0.95"/>`);
    const p0 = t.pts[0], p1 = t.pts[t.pts.length - 1];
    parts.push(`<circle cx="${p0[0].toFixed(1)}" cy="${p0[1].toFixed(1)}" r="7" fill="${t.color}"/>`);
    parts.push(`<text x="${(p1[0] + 8).toFixed(1)}" y="${(p1[1] - 6).toFixed(1)}" fill="${t.color}" font-size="18" font-family="monospace">${t.label ?? ''} ${(t.ms / 1000).toFixed(1)}s</text>`);
  }
}

parts.push('</svg>');
const svg = parts.join('\n');
const out = join(outDir, name);
await sharp(Buffer.from(svg)).png().toFile(out);
writeFileSync(join(outDir, name.replace(/\.png$/, '.svg')), svg);
console.log(`wrote tests/artifacts/${name} (${Math.round(W * scale)}x${Math.round(H * scale)}) — ${track.bodies.length} bodies, ${def.pieces.length} authored pieces`);
