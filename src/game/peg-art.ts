/**
 * Peg art: premade pictures made of Peggle pegs, stamped into the Workshop as one group.
 *
 * Two kinds of picture:
 *  - pixel art: a grid of characters, one peg per character ('b' blue, 'o' orange, 'g' green item peg, '.' empty);
 *  - plotted art: pegs laid along curves or filled from a formula (spirals, suns, roses, galaxies...).
 * Every picture is centred on (0, 0) and spaced so a marble still fits between neighbouring pegs.
 */
export type PegArtColor = 'blue' | 'orange' | 'green';
export interface PegArtDot { x: number; y: number; color: PegArtColor }
export interface PegArt { id: string; name: string; dots: PegArtDot[] }

/** Distance between neighbouring pegs of a pixel picture, and the peg radius every picture uses. */
export const PEG_ART_STEP = 26;
export const PEG_ART_R = 8;
/** Pegs of plotted pictures never sit closer than this (a marble has to fit through). */
const MIN_GAP = 23;

const COLOR: Record<string, PegArtColor> = { b: 'blue', o: 'orange', g: 'green' };

function pixels(rows: string[]): PegArtDot[] {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const dots: PegArtDot[] = [];
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    const color = COLOR[ch];
    if (color) dots.push({ x: (i - (w - 1) / 2) * PEG_ART_STEP, y: (j - (h - 1) / 2) * PEG_ART_STEP, color });
  }));
  return dots;
}

/** Keep dots at least MIN_GAP apart (first come wins), then centre the picture. */
function tidy(dots: PegArtDot[]): PegArtDot[] {
  const kept: PegArtDot[] = [];
  for (const d of dots) if (kept.every((k) => Math.hypot(k.x - d.x, k.y - d.y) >= MIN_GAP)) kept.push(d);
  const xs = kept.map((d) => d.x), ys = kept.map((d) => d.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return kept.map((d) => ({ x: Math.round(d.x - cx), y: Math.round(d.y - cy), color: d.color }));
}

/** Points along a curve p(t), t from 0 to 1, spaced about `gap` apart. */
function along(p: (t: number) => [number, number], color: (t: number) => PegArtColor, gap = MIN_GAP + 2): PegArtDot[] {
  const out: PegArtDot[] = [];
  let last: [number, number] | null = null;
  for (let i = 0; i <= 4000; i++) {
    const t = i / 4000;
    const q = p(t);
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) >= gap) { out.push({ x: q[0], y: q[1], color: color(t) }); last = q; }
  }
  return out;
}

/** Fill a grid over [-size, size]^2 wherever `color(x, y)` returns a colour. */
function field(size: number, color: (x: number, y: number) => PegArtColor | null, step = PEG_ART_STEP): PegArtDot[] {
  const out: PegArtDot[] = [];
  for (let y = -size; y <= size + 0.1; y += step) for (let x = -size; x <= size + 0.1; x += step) {
    const c = color(x, y);
    if (c) out.push({ x, y, color: c });
  }
  return out;
}

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- plotted pictures
const spiral = (): PegArtDot[] => tidy([
  ...along((t) => { const a = t * 3.2 * TAU, r = 18 + t * 230; return [Math.cos(a) * r, Math.sin(a) * r]; }, () => 'orange'),
  ...along((t) => { const a = t * 3.2 * TAU + Math.PI, r = 18 + t * 230; return [Math.cos(a) * r, Math.sin(a) * r]; }, () => 'blue'),
  { x: 0, y: 0, color: 'green' },
]);

const galaxy = (): PegArtDot[] => tidy([
  { x: 0, y: 0, color: 'green' },
  ...[0, 1, 2].flatMap((arm) => along((t) => {
    const a = arm * (TAU / 3) + t * 1.35 * TAU, r = 30 * Math.exp(t * 2.05);
    return [Math.cos(a) * r, Math.sin(a) * r * 0.8];
  }, (t) => (t > 0.7 ? 'orange' : 'blue'))),
]);

const sunburst = (): PegArtDot[] => tidy([
  { x: 0, y: 0, color: 'green' },
  ...[40, 66].flatMap((r) => along((t) => [Math.cos(t * TAU) * r, Math.sin(t * TAU) * r], () => 'orange')),
  ...Array.from({ length: 16 }, (_, k) => along((t) => {
    const a = (k / 16) * TAU, r = 100 + t * (k % 2 ? 90 : 150);
    return [Math.cos(a) * r, Math.sin(a) * r];
  }, () => (k % 2 ? 'blue' : 'orange'))).flat(),
]);

const target = (): PegArtDot[] => tidy([
  { x: 0, y: 0, color: 'green' },
  ...[40, 80, 120, 160, 200].flatMap((r, i) => along((t) => [Math.cos(t * TAU) * r, Math.sin(t * TAU) * r], () => (i % 2 ? 'blue' : 'orange'))),
]);

const rose = (): PegArtDot[] => tidy([
  { x: 0, y: 0, color: 'green' },
  ...along((t) => { const a = t * TAU, r = 210 * Math.cos(4 * a); return [Math.cos(a) * r, Math.sin(a) * r]; }, (t) => (Math.floor(t * 16) % 2 ? 'orange' : 'blue'), 24),
  ...along((t) => [Math.cos(t * TAU) * 44, Math.sin(t * TAU) * 44], () => 'orange'),
]);

const star = (): PegArtDot[] => {
  // five-point star: orange outline, blue fill
  const R = 220, r = 88;
  const pts = Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + (k * Math.PI) / 5, rad = k % 2 ? r : R; return [Math.cos(a) * rad, Math.sin(a) * rad] as [number, number]; });
  const outline = along((t) => {
    const f = t * 10, k = Math.min(9, Math.floor(f)), u = f - k, a = pts[k], b = pts[(k + 1) % 10];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  }, () => 'orange');
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = 9; i < 10; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const fill = field(200, (x, y) => (inside(x, y * 1) && inside(x * 1.18, y * 1.18) ? (x === 0 && Math.abs(y) < 14 ? 'green' : 'blue') : null));
  return tidy([...outline, ...fill]);
};

const heart = (): PegArtDot[] => {
  const hx = (t: number) => 16 * Math.sin(t) ** 3;
  const hy = (t: number) => -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
  const outline = along((t) => [hx(t * TAU) * 13, hy(t * TAU) * 13], () => 'orange');
  const inside = (x: number, y: number) => { const X = x / 150, Y = -y / 150 + 0.25; return (X * X + Y * Y - 1) ** 3 - X * X * Y ** 3 < 0; };
  const fill = field(200, (x, y) => (inside(x * 1.12, y * 1.12 + 10) ? (Math.abs(x) < 14 && Math.abs(y + 20) < 14 ? 'green' : 'blue') : null));
  return tidy([...outline, ...fill]);
};

const waves = (): PegArtDot[] => tidy(
  [-120, -60, 0, 60, 120].flatMap((y0, i) => along((t) => [-240 + t * 480, y0 + Math.sin(t * TAU * 2 + i * 0.9) * 26], () => (i % 2 ? 'blue' : 'orange'))),
);

const diamonds = (): PegArtDot[] => tidy(field(208, (x, y) => {
  const d = Math.abs(x) + Math.abs(y);
  const band = Math.round(d / PEG_ART_STEP);
  if (d > 212) return null;
  if (band === 0) return 'green';
  return band % 3 === 0 ? 'orange' : band % 3 === 1 ? 'blue' : null;
}));

const yinYang = (): PegArtDot[] => {
  const R = 200;
  const ring = along((t) => [Math.cos(t * TAU) * R, Math.sin(t * TAU) * R], () => 'orange');
  const fill = field(R - 20, (x, y) => {
    if (x * x + y * y > (R - 24) ** 2) return null;
    const top = Math.hypot(x, y + R / 2), bottom = Math.hypot(x, y - R / 2);
    if (top < 26 || bottom < 26) return 'green';
    const dark = top < R / 2 ? false : bottom < R / 2 ? true : x > 0;
    return dark ? 'blue' : null;
  });
  return tidy([...ring, ...fill]);
};

const snowflake = (): PegArtDot[] => tidy([
  { x: 0, y: 0, color: 'green' },
  ...Array.from({ length: 6 }, (_, k) => {
    const a = (k / 6) * TAU, c = Math.cos(a), s = Math.sin(a);
    const arm = along((t) => [c * (30 + t * 190), s * (30 + t * 190)], () => 'blue');
    const twigs = [90, 150].flatMap((d) => [-1, 1].flatMap((side) => along((t) => {
      const b = a + side * 0.75;
      return [c * d + Math.cos(b) * t * 60, s * d + Math.sin(b) * t * 60];
    }, () => 'orange')));
    return [...arm, ...twigs];
  }).flat(),
]);

// ---------------------------------------------------------------- pixel pictures
const skull = () => pixels([
  '....oooooo....',
  '..oobbbbbboo..',
  '.obbbbbbbbbbo.',
  'obbbbbbbbbbbbo',
  'obb..bbbb..bbo',
  'obb..bbbb..bbo',
  'obbbbbbbbbbbbo',
  '.obbbbggbbbbo.',
  '..obbbbbbbbo..',
  '...obobobob...',
  '...ob.b.b.o...',
  '....ooooooo...',
]);

const mushroom = () => pixels([
  '.....oooooo.....',
  '...oooboooooo...',
  '..ooobbbooobooo.',
  '.oooobbbbooobbbo',
  '.oobboooooooobbo',
  'ooobbbooooooooob',
  'ooooooooggooooob',
  '.ooooooooooooooo',
  '.....bbbbbb.....',
  '.....b.bb.b.....',
  '.....bbbbbb.....',
  '.....bbbbbb.....',
  '......bbbb......',
]);

const smiley = () => pixels([
  '....oooooo....',
  '..oo......oo..',
  '.o..........o.',
  'o...bb..bb...o',
  'o...bb..bb...o',
  'o............o',
  'o.....gg.....o',
  'o.b........b.o',
  'o..b......b..o',
  '.o..bbbbbb..o.',
  '..oo......oo..',
  '....oooooo....',
]);

const lightning = () => pixels([
  '......oooooo',
  '.....oobbbo.',
  '....oobbbo..',
  '...oobbbo...',
  '..oobbbooooo',
  '.oobbbbbbbo.',
  'ooooobbbbo..',
  '....obbgo...',
  '...obbbo....',
  '..obbbo.....',
  '.obbo.......',
  'obo.........',
]);

const crown = () => pixels([
  'g.....g.....g',
  'o.....o.....o',
  'oo...ooo...oo',
  'ooo.ooooo.ooo',
  'ooooooooooooo',
  'obbbbbbbbbbbo',
  'obgbbbgbbbgbo',
  'obbbbbbbbbbbo',
  'ooooooooooooo',
]);

const checkeredFlag = () => pixels([
  'o.............',
  'obb..bb..bb...',
  'obb..bb..bb...',
  'o..bb..bb..bb.',
  'o..bb..bb..bb.',
  'obb..bb..bb...',
  'obb..bb..bb...',
  'o..bb..bb..bb.',
  'o..bb..bb..bb.',
  'o.............',
  'o.............',
  'o.............',
  'og............',
]);

const moonStars = () => pixels([
  '.....oooo.......b..',
  '...ooo..........b..',
  '..oo.........bbbbbb',
  '.oo.............b..',
  '.oo.......b.....b..',
  'oo........b........',
  'oo......bbbbb......',
  'oo........b........',
  'oo........b.....g..',
  '.oo................',
  '.ooo.........o.....',
  '..oooo......ooo....',
  '....oooooo...o.....',
]);

const goblin = () => pixels([
  'b..............b',
  'bb....oooo....bb',
  '.bboooooooooobb.',
  '..oooooooooooo..',
  '..oo..oooo..oo..',
  '..oogg.oo.ggoo..',
  '..oooooooooooo..',
  '...oooobboooo...',
  '...oo.b..b.oo...',
  '....oo....oo....',
  '.....oooooo.....',
]);

const rocket = () => pixels([
  '......oo......',
  '.....obbo.....',
  '....obbbbo....',
  '....obggbo....',
  '....obggbo....',
  '....obbbbo....',
  '....obbbbo....',
  '...oobbbboo...',
  '..o.obbbbo.o..',
  '.o..oooooo..o.',
  '......oo......',
  '.....o..o.....',
  '......oo......',
]);

const anchor = () => pixels([
  '.....ooo.....',
  '....o...o....',
  '.....ooo.....',
  '......b......',
  '..bbbbbbbbb..',
  '......b......',
  '......b......',
  '......b......',
  'o.....b.....o',
  'oo....b....oo',
  '.oo...b...oo.',
  '..ooo.g.ooo..',
  '....ooooo....',
]);

const LIST: [string, string, () => PegArtDot[]][] = [
  ['spiral', 'Double spiral', spiral],
  ['galaxy', 'Galaxy', galaxy],
  ['sunburst', 'Sunburst', sunburst],
  ['target', 'Bullseye', target],
  ['rose', 'Rose (8 petals)', rose],
  ['snowflake', 'Snowflake', snowflake],
  ['star', 'Star', star],
  ['heart', 'Heart', heart],
  ['yinyang', 'Yin-yang', yinYang],
  ['waves', 'Waves', waves],
  ['diamonds', 'Diamond rings', diamonds],
  ['skull', 'Skull', skull],
  ['goblin', 'Goblin face', goblin],
  ['mushroom', 'Mushroom', mushroom],
  ['smiley', 'Smiley', smiley],
  ['lightning', 'Lightning bolt', lightning],
  ['crown', 'Crown', crown],
  ['flag', 'Chequered flag', checkeredFlag],
  ['moon', 'Moon and stars', moonStars],
  ['rocket', 'Rocket', rocket],
  ['anchor', 'Anchor', anchor],
];

let cache: PegArt[] | null = null;
/** Every premade picture, built once. */
export function pegArts(): PegArt[] {
  cache ??= LIST.map(([id, name, make]) => ({ id, name, dots: make() }));
  return cache;
}

export function pegArtById(id: string): PegArt {
  return pegArts().find((a) => a.id === id) ?? pegArts()[0];
}

/** The picture the Peg art tile stamps next (chosen from the Workshop's dropdown). */
let chosen = 'spiral';
export function chosenPegArt(): string { return chosen; }
export function choosePegArt(id: string): void { chosen = id; }
