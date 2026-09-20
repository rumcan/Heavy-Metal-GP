// node --import tsx scripts/champ3/capture.mjs [out.svg]
// Whole-map authoring capture: draws the authored def's collision geometry to scale so the PR can
// carry an overview next to the in-game screenshots. Floors are solid strokes, rails thin, and the
// machines get labelled markers at their real world positions.
import { writeFileSync } from 'node:fs';
import { buildDef, HEIGHT } from './def.mjs';
import { ROLES } from './map.mjs';

const def = buildDef();
const W = 900;
const pad = 40;
const scale = 1;
const svg = [];
const line = (a, b, w, color, opacity = 1) =>
  svg.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" opacity="${opacity}" />`);
const dot = (x, y, r, color) => svg.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" />`);
const tag = (x, y, text, color = '#e2e8f0') =>
  svg.push(`<text x="${x}" y="${y}" fill="${color}" font-family="monospace" font-size="13">${text}</text>`);

const SEG = [
  ['START', 0, 440, '#1f2937'],
  ['CANOPY DESCENT', 440, 1100, '#0f2f22'],
  ['EMERALD OXBOW', 1100, 2260, '#0b2b33'],
  ['ROOTBOUND SPRINT', 2260, 3360, '#2b2410'],
  ['FINISH', 3360, 3660, '#1f2937'],
];
for (const [name, y0, y1, fill] of SEG) {
  svg.push(`<rect x="0" y="${y0}" width="${W}" height="${y1 - y0}" fill="${fill}" />`);
  tag(12, y0 + 22, name, '#94a3b8');
}

for (const p of def.pieces) {
  const role = ROLES.get(p) ?? (p.t === 'ramp' ? 'floor' : '');
  if (p.t === 'ramp') {
    const rail = role === 'rail' || role === 'ice';
    line(p.a, p.b, p.thickness ?? 26, rail ? '#6b7280' : '#cbd5e1', rail ? 0.85 : 1);
  } else if (p.t === 'ice') {
    line(p.a, p.b, 26, '#7dd3fc', 0.9);
  } else if (p.t === 'wall') {
    svg.push(`<rect x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}" fill="#475569" />`);
  } else if (p.t === 'pool') {
    const x0 = Math.min(p.a[0], p.b[0]);
    const x1 = Math.max(p.a[0], p.b[0]);
    svg.push(`<rect x="${x0}" y="${p.a[1]}" width="${x1 - x0}" height="${p.depth}" fill="#0e7490" opacity="0.65" />`);
    tag(x0 + 6, p.a[1] + 18, 'POOL (skim / wade)');
  } else if (p.t === 'bridge') {
    line(p.a, p.b, 12, '#a16207');
    tag(p.a[0] - 6, p.a[1] - 10, 'ROPE BRIDGE', '#fbbf24');
  } else if (p.t === 'trampoline') {
    line([p.x - p.w / 2, p.y], [p.x + p.w / 2, p.y], 14, '#22c55e');
    tag(p.x - 24, p.y + 24, `NET t=${p.tension}`);
  } else if (p.t === 'pad') {
    line([p.x - p.w / 2, p.y], [p.x + p.w / 2, p.y], 12, '#f97316');
    tag(p.x - 30, p.y - 10, 'JUMP STRIP', '#fdba74');
  } else if (p.t === 'boost') {
    line([p.x, p.y], [p.x + p.dir[0] * p.len, p.y + p.dir[1] * p.len], 12, '#eab308');
    tag(p.x + p.dir[0] * p.len, p.y + p.dir[1] * p.len + 14, 'BOOST', '#facc15');
  } else if (p.t === 'tunnel') {
    dot(p.x, p.y, 10, '#a855f7');
    svg.push(`<line x1="${p.x}" y1="${p.y}" x2="${p.exit[0]}" y2="${p.exit[1]}" stroke="#a855f7" stroke-width="2" stroke-dasharray="8 6" opacity="0.8" />`);
    tag(p.x + 12, p.y - 8, `TUNNEL ${p.ms}ms`, '#d8b4fe');
  } else if (p.t === 'crumble') {
    svg.push(`<rect x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}" fill="#b91c1c" opacity="0.85" />`);
    tag(p.x - 20, p.y - 12, 'CRUMBLE', '#fecaca');
  } else if (p.t === 'ppeg') {
    dot(p.x, p.y, p.r, p.color === 'green' ? '#4ade80' : '#fb923c');
    if (p.item) tag(p.x + 12, p.y + 4, p.item.toUpperCase(), '#bbf7d0');
  } else if (p.t === 'itembox') {
    svg.push(`<rect x="${p.x - 17}" y="${p.y - 17}" width="34" height="34" fill="none" stroke="#facc15" stroke-width="2" />`);
  }
}

svg.push(`<rect x="26" y="0" width="${W - 52}" height="${HEIGHT}" fill="none" stroke="#f472b6" stroke-width="1" stroke-dasharray="10 8" />`);
tag(30, HEIGHT - 14, 'border x26..874 · height 3660 · sensor 3400', '#f9a8d4');

const out = process.argv[2] ?? 'scripts/champ3/champ-3-overview.svg';
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${pad} -${pad} ${W + pad * 2} ${HEIGHT + pad * 2}" width="${(W + pad * 2) * scale}" height="${(HEIGHT + pad * 2) * scale}">` +
  `<rect x="-${pad}" y="-${pad}" width="${(W + pad * 2) * scale}" height="${HEIGHT + pad * 2}" fill="#020617" />${svg.join('')}</svg>\n`);
console.log(`wrote ${out} — ${def.pieces.length} pieces`);
