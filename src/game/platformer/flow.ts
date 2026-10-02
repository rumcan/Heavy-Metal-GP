// P2-00 (#124): "flow" courses — long smooth downhill slopes that roll and crest (gameplay inspired by
// Alto's Adventure; the art is our own), chasms to jump, crates to hop, and three parallel depth ridges.
// Pure data (a CoursePlan), deterministic from the seed. Floors are short straight pieces along a smooth curve.
import { mulberry32 } from '../types';
import type { Bump, CoursePlan, Floor, Lane, LaneGate } from './course';

export interface FlowTuning {
  length: number;
  startY: number;
  /** Average descent: px down per px along. */
  grade: number;
  /** Length of one floor piece along the curve. */
  step: number;
  chasmChance: readonly number[];
  crateChance: readonly number[];
  gateEvery: number;
}

export const FLOW_TUNING: FlowTuning = {
  length: 30000,
  startY: 600,
  grade: 0.11,
  step: 40,
  /** Per 1000 px and lane. Middle is the safe line; the outer lanes are riskier. */
  chasmChance: [0.34, 0.18, 0.4],
  crateChance: [0.4, 0.3, 0.45],
  gateEvery: 1700,
};

const LANES: Lane[] = [0, 1, 2];
const START_FLAT = 900;
/** Out on the slopes the back lane runs this much higher and the front lane this much lower, so the ridges behind
 * you always show above your own (Alto's layered hills). Zero on the start and finish flats. */
const LANE_RISE = 90;
const FINISH_FLAT = 1100;

/** Plan a flow course. */
export function planFlow(seed: number, t: FlowTuning = FLOW_TUNING): CoursePlan {
  const rng = mulberry32(seed ^ 0xa17055);
  const roll = (a: number, b: number) => a + rng() * (b - a);
  // The hills: one big shape every lane shares (parallel ridges, like Alto's), plus a small ripple of each lane's own.
  const big = { a1: roll(70, 120), l1: roll(900, 1400), p1: roll(0, Math.PI * 2), a3: roll(120, 220), l3: roll(4000, 6500), p3: roll(0, Math.PI * 2) };
  const waves = LANES.map(() => ({ ...big, a2: roll(15, 32), l2: roll(300, 520), p2: roll(0, Math.PI * 2) }));
  const end = t.length - FINISH_FLAT;
  // Ease the hills in after the start and out before the finish so both are flat.
  const envelope = (x: number) => Math.max(0, Math.min(1, (x - START_FLAT) / 600, (end - x) / 600));
  const hills = (lane: Lane, x: number) => {
    const w = waves[lane];
    return w.a1 * Math.sin(x / w.l1 + w.p1) + w.a2 * Math.sin(x / w.l2 + w.p2) + w.a3 * Math.sin(x / w.l3 + w.p3);
  };
  /** The floor height of `lane` at `x`: the descent, plus the lane's hills (zero at the start, faded out at the finish). */
  const heightAt = (lane: Lane, x: number) => {
    const along = Math.max(0, Math.min(x, end) - START_FLAT);
    return t.startY + along * t.grade + ((hills(lane, x) - hills(lane, START_FLAT)) - LANE_RISE * (1 - lane)) * envelope(x);
  };

  // Chasms and rocks: decided per 1000 px block and lane, kept off each other and off the start/finish.
  const chasms = new Map<Lane, [number, number][]>();
  const rocks: Bump[] = [];
  for (const lane of LANES) {
    const list: [number, number][] = [];
    for (let bx = START_FLAT + 800; bx < end - 900; bx += 1000) {
      if (rng() < t.chasmChance[lane]) {
        const w = Math.round(roll(90, 160) / 10) * 10;
        const x = Math.round((bx + roll(100, 800)) / 10) * 10;
        list.push([x, x + w]);
      }
      if (rng() < t.crateChance[lane]) {
        const x = Math.round((bx + roll(100, 850)) / 10) * 10;
        const clear = list.every(([a, b]) => x + 70 < a - 160 || x > b + 160);
        if (clear) {
          const w = Math.round(roll(46, 80));
          const h = Math.round(roll(28, 46));
          const top = Math.min(heightAt(lane, x), heightAt(lane, x + w));
          rocks.push({ lane, x, w, y: top - h + 6, h });
        }
      }
    }
    chasms.set(lane, list);
  }
  const inChasm = (lane: Lane, x: number) => chasms.get(lane)!.some(([a, b]) => x > a && x < b);

  // Floors: straight pieces of `step` along each lane's curve, cut at the chasms.
  const floors: Floor[] = [];
  for (const lane of LANES) {
    floors.push({ lane, x0: -200, y0: t.startY, x1: START_FLAT, y1: heightAt(lane, START_FLAT) });
    const cuts = chasms.get(lane)!;
    let x = START_FLAT;
    while (x < t.length + 200) {
      let x1 = Math.min(x + t.step, t.length + 200);
      const cut = cuts.find(([a]) => a > x && a < x1);
      if (cut) x1 = cut[0];
      if (!inChasm(lane, (x + x1) / 2)) floors.push({ lane, x0: x, y0: heightAt(lane, x), x1, y1: heightAt(lane, x1) });
      const jump = cuts.find(([a]) => a === x1);
      x = jump ? jump[1] : x1;
    }
  }

  // Lane gates every ~gateEvery px: alternate ramps and doors, only where both lanes have floor and no rock.
  const gates: LaneGate[] = [];
  const clearAt = (lane: Lane, x0: number, x1: number) =>
    !chasms.get(lane)!.some(([a, b]) => x1 > a - 80 && x0 < b + 80) && !rocks.some((r) => r.lane === lane && x1 > r.x - 60 && x0 < r.x + r.w + 60);
  for (let gx = START_FLAT + 1200; gx < end - 1200; gx += t.gateEvery) {
    const x = Math.round((gx + roll(-300, 300)) / 10) * 10;
    const lane = LANES[Math.floor(rng() * 3)];
    const to = (lane === 1 ? (rng() < 0.5 ? 0 : 2) : 1) as Lane;
    const kind = rng() < 0.5 ? 'ramp' : 'door';
    if (clearAt(lane, x, x + 170) && clearAt(to, x, x + 170)) gates.push({ kind, lane, to, x, w: 170, y: heightAt(lane, x + 85) });
  }

  const path: { x: number; y: number }[] = [];
  for (let x = 0; x <= t.length; x += 200) path.push({ x, y: heightAt(1, x) - 30 });
  const finishX = end + 360;
  const finishY = heightAt(1, finishX);
  const height = Math.max(...floors.map((f) => Math.max(f.y0, f.y1))) + 900;
  return { seed, style: 'flow' as const, width: t.length, height, floors, bumps: rocks, gates, path, startX: 520, startY: t.startY, finishX, finishY };
}
