/**
 * MB-09. Starter templates for the Workshop's "New track" dialog.
 *
 * Each template is a hand-made TrackDef (not generated) so a first-time player
 * sees a distinct starting point. They are intentionally small and finishable,
 * validated by the same headless check as player tracks.
 */
import { START_H, FINISH_H, W } from './track';
import type { TrackDef, Piece } from './trackdef';
import type { ThemeId } from './types';

function baseDef(name: string, theme: ThemeId, height: number, pieces: Piece[]): TrackDef {
  return {
    v: 1,
    name: name.slice(0, 48),
    seed: 0,
    theme,
    height,
    pieces,
    segments: [
      { name: 'Start', y: 0, h: START_H },
      { name: 'Custom', y: START_H, h: Math.max(1, height - START_H - FINISH_H) },
      { name: 'Finish', y: height - FINISH_H, h: FINISH_H },
    ],
  };
}

/** A truly empty track — just the start grid and finish stub, no obstacles. */
export function blankTemplate(): TrackDef {
  const height = START_H + FINISH_H + 800;
  return baseDef('Blank canvas', 'default', height, []);
}

/**
 * Loop gauntlet: three loops the marble must carry speed through, each fed by a
 * straight ramp. The entry ramps are shallow (12°) so even a light marble rolls in;
 * gaps between loops are short drops so momentum carries.
 */
export function loopGauntletTemplate(): TrackDef {
  const height = START_H + 3200 + FINISH_H;
  const pieces: Piece[] = [
    // Feed ramp into first loop
    { t: 'ramp', a: [0, START_H + 40], b: [340, START_H + 140] },
    { t: 'loop', x: 470, bottom: START_H + 460, r: 90 },
    { t: 'ramp', a: [560, START_H + 460], b: [W - 40, START_H + 540] },
    // Second loop
    { t: 'ramp', a: [W, START_H + 700], b: [120, START_H + 820] },
    { t: 'loop', x: 460, bottom: START_H + 1180, r: 95 },
    { t: 'ramp', a: [580, START_H + 1180], b: [W, START_H + 1280] },
    // Third loop — slightly larger
    { t: 'ramp', a: [0, START_H + 1500], b: [360, START_H + 1620] },
    { t: 'loop', x: 480, bottom: START_H + 1920, r: 100 },
    { t: 'ramp', a: [520, START_H + 1920], b: [W - 100, START_H + 2060] },
    // Open drop to finish — no trap
    // A couple pegs for points
    { t: 'peg', x: 200, y: START_H + 900, r: 11 },
    { t: 'peg', x: 700, y: START_H + 900, r: 11 },
    { t: 'ppeg', x: 450, y: START_H + 1700, color: 'orange', r: 10 },
  ];
  return baseDef('Loop gauntlet', 'default', height, pieces);
}

/**
 * Peggle cascade: a dense field of blue/orange/green pegs that erase on hit,
 * with a moving minecart bucket at the bottom that rewards a catch.
 */
export function peggleCascadeTemplate(): TrackDef {
  const height = START_H + 2600 + FINISH_H;
  const pieces: Piece[] = [];
  // Top funnels
  pieces.push({ t: 'ramp', a: [0, START_H + 20], b: [300, START_H + 180] });
  pieces.push({ t: 'ramp', a: [W, START_H + 20], b: [W - 300, START_H + 180] });
  // Dense peg field — 5 rows, 8 cols
  const rows = 5, cols = 8;
  for (let r = 0; r < rows; r++) {
    const y = START_H + 320 + r * 140;
    const offset = (r % 2) * 40;
    for (let c = 0; c < cols; c++) {
      const x = 80 + offset + c * 100;
      if (x > W - 40) continue;
      // Skip a couple for variety
      if ((r === 1 && c === 3) || (r === 3 && c === 5)) continue;
      const roll = ((r * 7 + c * 3) % 10) / 10;
      const color = roll < 0.15 ? 'green' : roll < 0.45 ? 'orange' : 'blue';
      // Green pegs need item, but we leave random — builder will roll, we specify blue/orange/green directly
      pieces.push({ t: 'ppeg', x, y, color: color as 'blue'|'orange'|'green', r: 10 } as Piece);
    }
  }
  // Bucket lane below the field
  const bucketY = START_H + 320 + rows * 140 + 80;
  pieces.push({ t: 'bucket', y: bucketY, phase: 0 });
  pieces.push({ t: 'ramp', a: [0, bucketY + 40], b: [120, bucketY + 80] });
  pieces.push({ t: 'ramp', a: [W, bucketY + 40], b: [W - 120, bucketY + 80] });
  // Exit to finish with a gentle S
  pieces.push({ t: 'curve', a: [120, bucketY + 120], c: [W/2, bucketY + 340], b: [W - 120, bucketY + 460], n: 10 });
  // A hoop for fun
  pieces.push({ t: 'hoop', x: W/2, y: bucketY + 280, dir: [0, 1] });
  // Some walls to keep field bounded
  pieces.push({ t: 'wall', x: 60, y: START_H + 500, w: 12, h: 220 });
  pieces.push({ t: 'wall', x: W - 60, y: START_H + 500, w: 12, h: 220 });
  return baseDef('Peggle cascade', 'default', height, pieces);
}

/**
 * Minecart run: the bucket carts shuttle across the track; hit them for a launch.
 * Two buckets with connecting ramps and a boost strip.
 */
export function minecartRunTemplate(): TrackDef {
  const height = START_H + 2800 + FINISH_H;
  const pieces: Piece[] = [
    // Initial drop into first bucket lane
    { t: 'ramp', a: [0, START_H + 30], b: [W/2 - 60, START_H + 200] },
    { t: 'ramp', a: [W, START_H + 30], b: [W/2 + 60, START_H + 200] },
    { t: 'bucket', y: START_H + 420, phase: 0 },
    { t: 'ramp', a: [0, START_H + 500], b: [140, START_H + 560] },
    { t: 'ramp', a: [W, START_H + 500], b: [W - 140, START_H + 560] },
    // Mid ramps
    { t: 'ramp', a: [140, START_H + 900], b: [W - 100, START_H + 1060] },
    { t: 'boost', x: 500, y: START_H + 980, len: 140, thick: 40, dir: [1, 0.2] },
    // Second bucket lower down
    { t: 'bucket', y: START_H + 1380, phase: Math.PI },
    { t: 'ramp', a: [0, START_H + 1460], b: [120, START_H + 1520] },
    { t: 'ramp', a: [W, START_H + 1460], b: [W - 120, START_H + 1520] },
    // Exit curves
    { t: 'curve', a: [120, START_H + 1700], c: [W/2 - 80, START_H + 2000], b: [W - 120, START_H + 2140], n: 12 },
    { t: 'hoop', x: 620, y: START_H + 1880, dir: [1, 0] },
    // Pegs for score along the way
    { t: 'ppeg', x: 400, y: START_H + 700, color: 'orange', r: 10 },
    { t: 'ppeg', x: 500, y: START_H + 700, color: 'green', r: 10 },
    { t: 'ppeg', x: 450, y: START_H + 1600, color: 'blue', r: 10 },
    // Walls
    { t: 'wall', x: W/2, y: START_H + 2400, w: 16, h: 120 },
  ];
  return baseDef('Minecart run', 'default', height, pieces);
}

export interface TemplateEntry {
  id: string;
  label: string;
  desc: string;
  build: () => TrackDef;
}

export const TEMPLATES: TemplateEntry[] = [
  { id: 'blank', label: 'Blank canvas', desc: 'Start empty — just the grid and finish line.', build: blankTemplate },
  { id: 'loop', label: 'Loop gauntlet', desc: 'Three loops in a row — carry speed through each.', build: loopGauntletTemplate },
  { id: 'peggle', label: 'Peggle cascade', desc: 'A field of pegs that pop and score, with a minecart catch.', build: peggleCascadeTemplate },
  { id: 'minecart', label: 'Minecart run', desc: 'Two shuttling minecarts — hitch a ride for a launch.', build: minecartRunTemplate },
];
