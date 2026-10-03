// P2-00 (#124): "flow" courses — long smooth downhill slopes that roll and crest (gameplay inspired by
// Alto's Adventure; the art is our own), chasms to jump, crates to hop, and three parallel depth ridges.
// Pure data (a CoursePlan), deterministic from the seed. Floors are short straight pieces along a smooth curve.
import { mulberry32 } from '../types';
import type { BoostSpot, Bump, CoursePlan, Floor, ItemBoxSpot, Lane, LaneGate, Ledge, Spring, WreckerSpot } from './course';
import { LOOP_PITCH, LOOP_R, LOOP_RUN_OUT, PLANK_H } from './routes';
import type { BridgeSpot, LoopSpot } from './routes';

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
  /** P2-21: plan a loop and rope bridges (default on; tests turn it off to compare). */
  routes?: boolean;
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

  // Shortcuts: before some chasms a spring, and a ledge high over the chasm that carries you past it.
  const springs: Spring[] = [];
  const ledges: Ledge[] = [];
  for (const lane of LANES) {
    for (const [a, b] of chasms.get(lane)!) {
      if (rng() > 0.55) continue;
      const sx = Math.round(a - 300);
      const lx0 = Math.round(a - 120), lx1 = Math.round(b + roll(480, 760));
      let low = Infinity;
      for (let x = lx0; x <= lx1; x += 20) if (!inChasm(lane, x)) low = Math.min(low, heightAt(lane, x));
      const blocked = rocks.some((r) => r.lane === lane && r.x + r.w > sx - 40 && r.x < lx1 + 40) || inChasm(lane, sx) || inChasm(lane, sx + 60);
      if (blocked || !Number.isFinite(low)) continue;
      springs.push({ lane, x: sx, y: heightAt(lane, sx + 30) });
      ledges.push({ lane, x: lx0, w: lx1 - lx0, y: Math.round(low - roll(170, 220)) });
    }
  }

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

  // A lane gate never shares its stretch with a spring or sits under a ledge (in either of its lanes).
  const busy = (lane: Lane, x0: number, x1: number) =>
    springs.some((s) => s.lane === lane && x1 > s.x - 80 && x0 < s.x + 140) || ledges.some((l) => l.lane === lane && x1 > l.x - 40 && x0 < l.x + l.w + 40);
  for (let i = gates.length - 1; i >= 0; i--) {
    const g = gates[i];
    if (busy(g.lane, g.x, g.x + g.w) || busy(g.to, g.x, g.x + g.w)) gates.splice(i, 1);
  }

  // The classic map pieces: power-up boxes, wrecking balls and boost pads. Their own random stream, so adding
  // them never moved a hill, a chasm or a gate. Each keeps clear of chasms, crates, gates, springs and ledges.
  const pick = mulberry32(seed ^ 0x17e3b0c5);
  const between = (a: number, b: number) => a + pick() * (b - a);
  const clearTrack = (lane: Lane, x0: number, x1: number) =>
    clearAt(lane, x0, x1) && !busy(lane, x0, x1) && !gates.some((g) => (g.lane === lane || g.to === lane) && x1 > g.x - 60 && x0 < g.x + g.w + 60);
  const itemBoxes: ItemBoxSpot[] = [];
  const wreckers: WreckerSpot[] = [];
  const boosts: BoostSpot[] = [];
  const taken = (lane: Lane, x0: number, x1: number) =>
    itemBoxes.some((b) => b.lane === lane && x1 > b.x - 120 && x0 < b.x + 120) ||
    wreckers.some((w) => w.lane === lane && x1 > w.x - w.chain - 120 && x0 < w.x + w.chain + 120) ||
    boosts.some((b) => b.lane === lane && x1 > b.x - 100 && x0 < b.x + b.w + 100);
  for (const lane of LANES) {
    for (let bx = START_FLAT + 600; bx < end - 600; bx += 1000) {
      const r = pick();
      const x = Math.round(bx + between(100, 800));
      if (r < 0.32) {
        // a row of power-up boxes over the track
        const n = 1 + Math.floor(pick() * 3);
        if (!clearTrack(lane, x - 40, x + n * 80) || taken(lane, x - 40, x + n * 80)) continue;
        for (let i = 0; i < n; i++) itemBoxes.push({ lane, x: x + i * 80, y: Math.round(heightAt(lane, x + i * 80) - 46) });
      } else if (r < 0.52) {
        // a wrecking ball across the track: the gantry stands over it, the ball swings through the line
        const chain = Math.round(between(120, 160));
        if (!clearTrack(lane, x - chain, x + chain) || taken(lane, x - chain, x + chain)) continue;
        wreckers.push({ lane, x, pivotY: Math.round(heightAt(lane, x) - chain - 38), chain, amp: between(0.75, 1.05), speed: between(0.0018, 0.0026), phase: between(0, Math.PI * 2) });
      } else if (r < 0.7) {
        // a boost pad on a downhill stretch
        const w = 160;
        if (heightAt(lane, x + w) - heightAt(lane, x) < 10) continue;
        if (!clearTrack(lane, x, x + w) || taken(lane, x, x + w)) continue;
        boosts.push({ lane, x, w });
      }
    }
  }

  // P2-21: at most one loop and two rope bridges. Their own random stream, so adding them moved nothing above.
  const route = mulberry32(seed ^ 0x2f1d0a3b);
  const loops: LoopSpot[] = [];
  const bridges: BridgeSpot[] = [];
  if (t.routes !== false) {
    // The loop: on a stretch that is clear of everything and not climbing into it, with a boost pad in the run-up (a
    // ring needs more speed than steering gives; the pad is what a driver builds it from). The floor under the ring is
    // laid flat, with a short ramp in and out.
    const RAMP = 120;
    const lanes = [...LANES].sort(() => route() - 0.5);
    search: for (const lane of lanes) {
      for (let bx = START_FLAT + 3000; bx < end - 3000; bx += 700) {
        // Snap to this lane's own floor pieces (their grid shifts after every chasm), so the flat replaces whole pieces.
        const laneFloors = floors.filter((f) => f.lane === lane).sort((p, q) => p.x0 - q.x0);
        const pieceAt = (x: number) => laneFloors.find((f) => x >= f.x0 && x < f.x1);
        const startPiece = pieceAt(bx + route() * 500), endPiece = startPiece && pieceAt(startPiece.x0 + RAMP * 2 + LOOP_PITCH + 60);
        if (!startPiece || !endPiece) continue;
        const a = startPiece.x0, b = endPiece.x1, entry = a + RAMP, flatEnd = b - RAMP;
        if (flatEnd - entry < LOOP_PITCH + 40) continue;
        const y0 = Math.round(heightAt(lane, entry));
        const from = a - 460, to = b + LOOP_RUN_OUT;
        if (!clearTrack(lane, from, to) || taken(lane, from, to)) continue;
        if (heightAt(lane, entry) - heightAt(lane, a) < -2 || Math.abs(heightAt(lane, b) - y0) > 60 || Math.abs(y0 - heightAt(lane, a)) > 60) continue;
        // Lay the flat: drop this lane's floor pieces in [a, b], then the ramps and the flat.
        for (let i = floors.length - 1; i >= 0; i--) if (floors[i].lane === lane && floors[i].x0 >= a && floors[i].x1 <= b) floors.splice(i, 1);
        floors.push({ lane, x0: a, y0: heightAt(lane, a), x1: entry, y1: y0 }, { lane, x0: entry, y0, x1: flatEnd, y1: y0 }, { lane, x0: flatEnd, y0, x1: b, y1: heightAt(lane, b) });
        loops.push({ lane, x: entry, y: y0, r: LOOP_R, pitch: LOOP_PITCH });
        boosts.push({ lane, x: entry - 420, w: 160 });
        break search;
      }
    }
    // Rope bridges: over up to two chasms (not the shortcut ones with a spring and a ledge, not near the loop).
    const nearLoop = (x: number) => loops.some((l) => x > l.x - 1500 && x < l.x + 1500);
    const eligible: { lane: Lane; a: number; b: number }[] = [];
    for (const lane of LANES) for (const [a, b] of chasms.get(lane)!) {
      const shortcut = springs.some((s) => s.lane === lane && Math.abs(s.x - (a - 300)) < 10);
      if (!shortcut && !nearLoop(a) && !gates.some((g) => (g.lane === lane || g.to === lane) && b > g.x - 60 && a < g.x + g.w + 60)) eligible.push({ lane, a, b });
    }
    for (let n = 0; n < 2 && eligible.length; n++) {
      const pickAt = Math.floor(route() * eligible.length);
      const { lane, a, b } = eligible.splice(pickAt, 1)[0];
      if (bridges.some((o) => Math.abs(o.x0 - a) < 1500)) continue;
      const span = b - a;
      const planks = Math.ceil(span / 20);
      bridges.push({ lane, x0: a, y0: heightAt(lane, a) + PLANK_H / 2, x1: b, y1: heightAt(lane, b) + PLANK_H / 2, planks, slack: Math.max(8, Math.min(14, Math.round(span * 0.09))) });
    }
  }

  const path: { x: number; y: number }[] = [];
  for (let x = 0; x <= t.length; x += 200) path.push({ x, y: heightAt(1, x) - 30 });
  const finishX = end + 360;
  const finishY = heightAt(1, finishX);
  const height = Math.max(...floors.map((f) => Math.max(f.y0, f.y1))) + 900;
  return { seed, style: 'flow' as const, width: t.length, height, floors, bumps: rocks, gates, path, springs, ledges, itemBoxes, wreckers, boosts, loops, bridges, startX: 520, startY: t.startY, finishX, finishY };
}
