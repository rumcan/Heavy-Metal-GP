// P2-24: Infinity mode's land. Pure data, no Matter.js. The land is a closed-form function of (seed, x), so any stretch of
// it can be rebuilt on demand and the same seed always gives the same land. It is cut into chunks of CHUNK_W px: a chunk
// depends only on (seed, index), never on its neighbours, and its floors meet the next chunk's exactly (they sample the
// same height function). Features (chasms, bridges, springs and ledges, crates, lane gates, boost pads and now and then a
// loop) sit well inside a chunk, so a neighbour never needs to know about them. Nothing hostile is built (no wrecking
// balls, no item boxes, no wall a rolling ball cannot get over) except the one death pit a km, with its ramp to jump it.
import { mulberry32 } from '../types';
import { SPRING_W } from './course';
import type { BoostSpot, Bump, Floor, HoopSpot, Kicker, Lane, LaneGate, Ledge, PitSpot, RingSpot, SmashSpot, Spring, StandSpot, VentSpot } from './course';
import { LOOP_PITCH, LOOP_R, PLANK_H } from './routes';
import type { BridgeSpot, LoopSpot } from './routes';

/** Width of one chunk of land. */
export const CHUNK_W = 1600;
/** The world is shifted back by this much (in x) whenever the ball gets this far from the origin: Matter loses precision far out. */
export const ORIGIN_STEP = 40_000;
/** World units per kilometre on the distance counter (a 30 000 u race course is three km). */
export const PX_PER_KM = 10_000;
/** The land's height at the start line, and where the flat start meadow ends. */
export const INF_START_Y = 600;
export const INF_START_FLAT = 900;
/** Mean descent in px down per px along: the land rolls downhill, so a ball that keeps pushing right keeps rolling. */
const GRADE = 0.1;
const LANE_RISE = 90;
const STEP = 40;
const LANES: readonly Lane[] = [0, 1, 2];

/**
 * The death pits (the owner: "a hole once every 1km with a ramp to ramp over it"): one per km, across every lane, at the
 * start of the first chunk that begins PIT_FROM past the km mark (clear of the goblin stands' level stretch). In each
 * lane a boost pad and a kicker ramp lead up to it: a ball pushing on and jumping at the edge clears it, a coasting or
 * slow one can drop in and lose a life.
 */
const PIT_FROM = 4600;
export const PIT_W = 400;
/** The level run-up before a pit and the level landing after it (each eases in from the land over 300 px). */
export const PIT_RUN = 840;
const PIT_LAND = 250;
/** The chunk the pit of km `k` (1 and up) sits in. */
export function pitChunk(k: number): number { return Math.ceil((k * PX_PER_KM + PIT_FROM) / CHUNK_W); }
/** The km whose pit sits in chunk `index`, or 0 when it has none. */
export function pitKm(index: number): number {
  const k = Math.floor((index * CHUNK_W - PIT_FROM) / PX_PER_KM);
  return k >= 1 && pitChunk(k) === index ? k : 0;
}

interface Waves { a1: number; l1: number; p1: number; a3: number; l3: number; p3: number; a4: number; l4: number; p4: number; a2: number[]; l2: number[]; p2: number[]; breathe: number }
const waveCache = new Map<number, Waves>();

/** The seed's hills: a big shape every lane shares, a slow swell, and a small ripple of each lane's own. */
function wavesOf(seed: number): Waves {
  let w = waveCache.get(seed);
  if (w) return w;
  const rng = mulberry32((seed ^ 0x1f3a77b1) >>> 0);
  const roll = (a: number, b: number) => a + rng() * (b - a);
  w = {
    a1: roll(70, 115), l1: roll(900, 1400), p1: roll(0, Math.PI * 2),
    a3: roll(120, 210), l3: roll(4000, 6500), p3: roll(0, Math.PI * 2),
    a4: roll(160, 300), l4: roll(18000, 34000), p4: roll(0, Math.PI * 2),
    a2: LANES.map(() => roll(15, 30)), l2: LANES.map(() => roll(300, 520)), p2: LANES.map(() => roll(0, Math.PI * 2)),
    breathe: roll(0, Math.PI * 2),
  };
  if (waveCache.size > 64) waveCache.clear();
  waveCache.set(seed, w);
  return w;
}

const ease = (x: number) => Math.max(0, Math.min(1, (x - INF_START_FLAT) / 600));

/**
 * The floor height of `lane` at absolute `x`. A mean descent (its steepness breathes slowly), plus the hills, eased in
 * after the start meadow. Continuous and bounded away from the mean line, so the land rolls but never runs off.
 */
export function terrainY(seed: number, lane: Lane, x: number): number {
  const y = rollingY(seed, lane, x);
  if (lane !== STAND_LANE) return y;
  // The back lane is level for a stretch after every km mark: the goblin stands (coaster.ts) stand there. Eased ramps
  // in and out; the level sits halfway between the land at its two ends, so with the land's descent both ramps go down.
  const k = Math.round((x - STAND_FROM - STAND_LEN / 2) / PX_PER_KM);
  if (k < 1) return y;
  const a = k * PX_PER_KM + STAND_FROM, b = a + STAND_LEN;
  if (x <= a - STAND_RAMP || x >= b + STAND_RAMP) return y;
  const level = (rollingY(seed, lane, a) + rollingY(seed, lane, b)) / 2;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const f = x < a ? smooth((x - (a - STAND_RAMP)) / STAND_RAMP) : x > b ? smooth(((b + STAND_RAMP) - x) / STAND_RAMP) : 1;
  return y + (level - y) * f;
}

/** The level of the back lane's stand stretch after km `k` (the height terrainY holds there). */
export function standLevel(seed: number, k: number): number {
  const a = k * PX_PER_KM + STAND_FROM, b = a + STAND_LEN;
  return (rollingY(seed, STAND_LANE, a) + rollingY(seed, STAND_LANE, b)) / 2;
}

/** The back lane's level stretch for the goblin stands: from STAND_FROM past each km mark, STAND_LEN long. */
const STAND_LANE: Lane = 0;
export const STAND_FROM = -100;
export const STAND_LEN = 2600;
const STAND_RAMP = 2000;

function rollingY(seed: number, lane: Lane, x: number): number {
  const w = wavesOf(seed);
  const along = Math.max(0, x - INF_START_FLAT);
  // The grade breathes between 0.6x and 1.4x over about 90 000 u; its integral is closed-form.
  const period = 90_000;
  const descent = GRADE * (along + 0.4 * (period / (Math.PI * 2)) * (Math.sin(along / (period / (Math.PI * 2)) + w.breathe) - Math.sin(w.breathe)));
  const hills = w.a1 * Math.sin(x / w.l1 + w.p1) + w.a2[lane] * Math.sin(x / w.l2[lane] + w.p2[lane]) + w.a3 * Math.sin(x / w.l3 + w.p3) + w.a4 * Math.sin(x / w.l4 + w.p4);
  const hills0 = w.a1 * Math.sin(INF_START_FLAT / w.l1 + w.p1) + w.a2[lane] * Math.sin(INF_START_FLAT / w.l2[lane] + w.p2[lane]) + w.a3 * Math.sin(INF_START_FLAT / w.l3 + w.p3) + w.a4 * Math.sin(INF_START_FLAT / w.l4 + w.p4);
  const e = ease(x);
  return INF_START_Y + descent + ((hills - hills0) - LANE_RISE * (1 - lane)) * e;
}

export interface InfinityChunk {
  index: number;
  /** Absolute x range this chunk is responsible for. */
  x0: number;
  x1: number;
  floors: Floor[];
  bumps: Bump[];
  gates: LaneGate[];
  springs: Spring[];
  ledges: Ledge[];
  loops: LoopSpot[];
  bridges: BridgeSpot[];
  boosts: BoostSpot[];
  kickers: Kicker[];
  rings: RingSpot[];
  /** The goblin stands' spots this chunk overlaps (a stand spans two chunks: both carry it). */
  stands: StandSpot[];
  hoops: HoopSpot[];
  smashes: SmashSpot[];
  vents: VentSpot[];
  pits: PitSpot[];
}

/** A different random stream per chunk and purpose, stable for ever. */
function chunkRng(seed: number, index: number, salt: number) {
  let h = (seed ^ Math.imul(index + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return mulberry32((h ^ (h >>> 16)) >>> 0);
}

/** Is chunk `index` a loop chunk? (Every ninth or so, never near the start.) */
export function isLoopChunk(seed: number, index: number): boolean {
  return index >= 3 && chunkRng(seed, index, 7)() < 0.11;
}

const round10 = (v: number) => Math.round(v / 10) * 10;

/**
 * The land of chunk `index` (absolute coordinates). Stateless: the same (seed, index) always gives the same chunk, and
 * rebuilding a chunk needs nothing from any other.
 */
export function infinityChunk(seed: number, index: number): InfinityChunk {
  const x0 = index * CHUNK_W, x1 = x0 + CHUNK_W;
  const h = (lane: Lane, x: number) => terrainY(seed, lane, x);
  const rng = chunkRng(seed, index, 1);
  const roll = (a: number, b: number) => a + rng() * (b - a);
  // Gold rings to collect (the owner): each pays RING_CREDITS; stable ids, so a collected one stays collected while the
  // chunk is rebuilt.
  const ring = (lane: Lane, x: number, y: number) => chunk.rings.push({ id: `${index}:${chunk.rings.length}`, lane, x: Math.round(x), y: Math.round(y) });
  const chunk: InfinityChunk = { index, x0, x1, floors: [], bumps: [], gates: [], springs: [], ledges: [], loops: [], bridges: [], boosts: [], kickers: [], rings: [], stands: [], hoops: [], smashes: [], vents: [], pits: [] };
  // the goblin stands' spots: every km's level stretch on the back lane that overlaps this chunk
  for (let k = Math.max(1, Math.floor((x0 - STAND_FROM - STAND_LEN) / PX_PER_KM)); k * PX_PER_KM + STAND_FROM < x1; k++) {
    const a = k * PX_PER_KM + STAND_FROM;
    if (a + STAND_LEN > x0) chunk.stands.push({ id: k, lane: STAND_LANE, x: a, w: STAND_LEN, y: standLevel(seed, k) });
  }

  // ---- the features: kept inside [x0 + 250, x1 + 220] so a neighbour never meets them
  const chasms = new Map<Lane, [number, number]>();
  const ledgeLanes = new Set<Lane>();
  const springLanes = new Set<Lane>();
  // a loop's (or a pit's) flat: [from, to, y, ramp length, blend]. A loop eases from the land's height at each end; a
  // pit blends from the land itself (its slope too), so a pit's run-up can start right at a chunk's edge without a kink.
  const flat = new Map<Lane, [number, number, number, number, boolean?]>();
  const busy = index >= 2;

  const pitK = pitKm(index);
  if (pitK) {
    // A death pit across every lane, with a boost pad and a kicker ramp in front of it in each lane, on level ground held
    // at the land's height where the run-up starts (a ball rolling down a hill would fly past the ramp and drop in). Its
    // far side is level with the lip, then eases back to the land. Placed where the land comes in least steeply.
    let a = x0 + PIT_RUN, bestErr = Infinity;
    for (let s = x0 + PIT_RUN; s + PIT_W + PIT_LAND <= x1 - 60; s += 10) {
      const err = Math.max(...LANES.map((lane) => Math.abs(h(lane, s - PIT_RUN) - h(lane, s - PIT_RUN - 200))));
      if (err < bestErr) { bestErr = err; a = s; }
    }
    const b = a + PIT_W;
    for (const lane of LANES) {
      chasms.set(lane, [a, b]);
      flat.set(lane, [a - PIT_RUN, b + PIT_LAND, Math.round(h(lane, a - PIT_RUN)), PIT_LAND, true]);
      chunk.boosts.push({ lane, x: a - 500, w: 200 });
      chunk.kickers.push({ lane, x: a - 280, w: 150, h: 70 });
      // a gold arc over the hole, along the path of a ball that clears it
      const ly = Math.round(h(lane, a - PIT_RUN));
      for (let k = 0; k < 5; k++) ring(lane, a - 40 + k * 95, ly - 110 - 120 * Math.sin((Math.PI * (k + 0.5)) / 5));
    }
    chunk.pits.push({ id: pitK, x0: a, x1: b, y: Math.round(Math.min(...LANES.map((lane) => h(lane, a - PIT_RUN)))) });
  } else if (busy && isLoopChunk(seed, index)) {
    // A loop in one lane: a long flat for the run-up and the ring (a ramp down into it, a ramp down out of it), a boost
    // pad on the flat. The ball arrives rolling on level ground, never falling onto the ring. Skipped when the land has no
    // stretch in this chunk that suits it.
    const lane = LANES[Math.floor(rng() * 3)];
    const RAMP = 300, RUN_UP = 380;
    let best: { entry: number; err: number } | null = null;
    for (let entry = x0 + 700; entry <= x0 + 1000; entry += 20) {
      const y0 = h(lane, entry);
      const dropIn = y0 - h(lane, entry - RUN_UP - RAMP), dropOut = h(lane, entry + LOOP_PITCH + 60 + RAMP) - y0;
      // In: the land is at or above the flat (a long easy ramp down into it, never up); out: it falls away at most a little.
      if (dropIn < -5 || dropIn > 90 || dropOut > 90 || dropOut < -30) continue;
      const err = dropIn + Math.abs(dropOut);
      if (!best || err < best.err) best = { entry, err };
    }
    if (best) {
      const entry = best.entry, flatEnd = entry + LOOP_PITCH + 60;
      const y0 = Math.round(h(lane, entry));
      flat.set(lane, [entry - RUN_UP - RAMP, flatEnd + RAMP, y0, RAMP]);
      chunk.loops.push({ lane, x: entry, y: y0, r: LOOP_R, pitch: LOOP_PITCH });
    }
  } else if (busy) {
    const chasmChance = [0.18, 0.08, 0.2];
    for (const lane of LANES) {
      if (rng() >= chasmChance[lane]) continue;
      const a = round10(roll(760, 900) + x0), width = Math.round(roll(90, 160) / 10) * 10, b = a + width;
      chasms.set(lane, [a, b]);
      const r = rng();
      if (r < 0.45) {
        // A spring before the chasm and a ledge high over it that carries you past.
        const sx = round10(a - 300);
        const lx0 = round10(a - 120), lx1 = round10(b + roll(480, 760));
        let low = Infinity;
        for (let x = lx0; x <= lx1; x += 20) if (x < a || x > b) low = Math.min(low, h(lane, x));
        chunk.springs.push({ lane, x: sx, y: h(lane, sx + SPRING_W / 2) });
        chunk.ledges.push({ lane, x: lx0, w: lx1 - lx0, y: Math.round(low - roll(170, 220)) });
        springLanes.add(lane); ledgeLanes.add(lane);
      } else if (r < 0.85) {
        // A rope bridge over it.
        const planks = Math.ceil(width / 20);
        chunk.bridges.push({ lane, x0: a, y0: h(lane, a) + PLANK_H / 2, x1: b, y1: h(lane, b) + PLANK_H / 2, planks, slack: Math.max(8, Math.min(14, Math.round(width * 0.09))) });
      }
    }
    // Boost pads on downhill stretches (not in a lane with a spring in this chunk).
    for (const lane of LANES) {
      if (springLanes.has(lane) || chasms.has(lane) || rng() >= 0.22) continue;
      const bx = round10(x0 + 260 + roll(0, 100));
      if (h(lane, bx + 160) - h(lane, bx) >= 10) chunk.boosts.push({ lane, x: bx, w: 160 });
    }
    // A lane gate, alternating ramps and doors, where both lanes are free of chasms and ledges.
    // (the owner: jump ramps come often, most from the middle lane, where a ball spends most of its run; from the
    // middle, a bit more often up to the back track than down to the front)
    if (rng() < 0.6) {
      const pickLane = rng();
      const lane = (pickLane < 0.6 ? 1 : pickLane < 0.8 ? 0 : 2) as Lane;
      const to = (lane === 1 ? (rng() < 0.6 ? 0 : 2) : 1) as Lane;
      const gx = round10(x0 + 1200 + roll(0, 100));
      if (!ledgeLanes.has(lane) && !ledgeLanes.has(to) && !chasms.has(lane) && !chasms.has(to)) {
        rng(); // the owner: every lane change is a jump ramp (the roll stays, so the land is unchanged)
        chunk.gates.push({ kind: 'ramp', lane, to, x: gx, w: 170, y: h(lane, gx + 85) });
      }
    }
    // No crates (the owner: being stopped by a box is no fun here). Their rolls stay, so the rest of the land is unchanged.
    for (const lane of LANES) {
      if (rng() >= 0.22 || ledgeLanes.has(lane) || chasms.has(lane)) continue;
      roll(1100, 1450);
      if (chunk.gates.some((g) => g.lane === lane || g.to === lane)) continue;
      roll(46, 80); roll(28, 46);
    }
    // Sky runs (the owner: clouds you ramp up to and ride), as on the race courses (flow.ts): a boost pad, a kicker
    // ramp that throws a fast ball into the air, and a cloud or two above the landing (one-way: rise through, land on
    // top). Their own random stream, so nothing above moves. In a lane with nothing else going on in this chunk.
    const sky = chunkRng(seed, index, 9);
    let skyLane: Lane | null = null;
    if (sky() < 0.4) {
      const first = Math.floor(sky() * 3);
      for (let k = 0; k < 3; k++) {
        const lane = LANES[(first + k) % 3];
        if (chasms.has(lane) || springLanes.has(lane) || ledgeLanes.has(lane) || chunk.boosts.some((b) => b.lane === lane)) continue;
        if (chunk.gates.some((g) => g.lane === lane || g.to === lane)) continue;
        const boostX = x0 + 250, kickX = x0 + 430, lip = kickX + 150;
        if (h(lane, kickX) - h(lane, boostX) < -20) continue;
        chunk.boosts.push({ lane, x: boostX, w: 180 });
        chunk.kickers.push({ lane, x: kickX, w: 150, h: 80 });
        // the flight: a gold arc of rings along the path of a fast ball off the lip
        const ly = h(lane, lip);
        for (let k = 0; k < 4; k++) ring(lane, lip + 70 + k * 65, ly - 90 - 150 * Math.sin((Math.PI * (k + 1)) / 5));
        // a staircase of clouds climbing into the sky (the owner: lots, high up): hop from one to the next, a few rings
        // on each, the highest richest
        const clouds = 1 + Math.floor(sky() * 3);
        for (let i = 0; i < clouds; i++) {
          const cx = lip + 200 + i * 330, w = Math.round(270 + sky() * 30);
          if (cx + w > x0 + CHUNK_W + 250) break;
          let low = Infinity;
          for (let x = cx; x <= cx + w; x += 40) low = Math.min(low, h(lane, x));
          const cy = Math.round(low - 170 - i * 85);
          chunk.ledges.push({ lane, x: cx, w, y: cy, cloud: Math.floor(sky() * 5) });
          for (let k = 0; k < 2 + i; k++) ring(lane, cx + (w * (k + 1)) / (3 + i), cy - 42);
        }
        skyLane = lane;
        // now and then a fire ring after the arc, where a fast ball comes down (its own stream)
        if (chunkRng(seed, index, 17)() < 0.5) chunk.hoops.push({ id: `${index}:air`, lane, x: lip + 340, y: Math.round(ly - 200), r: 46, air: true });
        break;
      }
    }
    // Clouds all over the sky at random heights (the owner: a lot more of them), their own stream: one to three per
    // chunk, from just above a jump up to high overhead, each a platform you can land on, some with rings on top.
    const air = chunkRng(seed, index, 13);
    const many = 1 + Math.floor(air() * 3);
    for (let i = 0; i < many; i++) {
      const lane = LANES[Math.floor(air() * 3)];
      const cx = Math.round(x0 + 200 + air() * 1300), w = Math.round(250 + air() * 110);
      let low = Infinity;
      for (let x = cx; x <= cx + w; x += 40) low = Math.min(low, h(lane, x));
      const cy = Math.round(low - 300 - air() * 750);
      chunk.ledges.push({ lane, x: cx, w, y: cy, cloud: Math.floor(air() * 5) });
      if (air() < 0.5) for (let k = 0; k < 3; k++) ring(lane, cx + (w * (k + 1)) / 4, cy - 42);
    }
    // Rings along the track (their own stream): a line to roll through or a little arc to hop, in a lane with no chasm.
    const rr = chunkRng(seed, index, 11);
    if (rr() < 0.55) {
      const lane = LANES[Math.floor(rr() * 3)];
      const hop = rr() < 0.5;
      const rx = x0 + 300 + Math.round(rr() * 200);
      if (lane !== skyLane && !chasms.has(lane) && !springLanes.has(lane)) {
        for (let k = 0; k < 5; k++) { const x = rx + k * 70; ring(lane, x, h(lane, x) - 40 - (hop ? 110 * Math.sin((Math.PI * (k + 0.5)) / 5) : 0)); }
      }
    }
    // The owner's toys: smash crates (no resistance, they burst), fire rings to roll through, and vents (an updraft up to
    // a cloud with rings on it, or a geyser that erupts now and then). Their own streams; only in a lane with nothing
    // else going on here (no sky run, chasm, spring, ledge or lane change).
    const taken = (lane: Lane) => lane === skyLane || chasms.has(lane) || springLanes.has(lane) || ledgeLanes.has(lane) || chunk.gates.some((g) => g.lane === lane || g.to === lane);
    const sr = chunkRng(seed, index, 19);
    if (sr() < 0.35) {
      const lane = LANES[Math.floor(sr() * 3)];
      const n = 1 + Math.floor(sr() * 3);
      if (!taken(lane)) for (let k = 0; k < n; k++) { const x = x0 + 900 + k * 64; chunk.smashes.push({ id: `${index}:s${k}`, lane, x, y: Math.round(h(lane, x)) }); }
    }
    const vr = chunkRng(seed, index, 23);
    const pick = vr();
    const vlane = LANES[Math.floor(vr() * 3)];
    const vx = round10(x0 + 1180 + vr() * 120);
    if (pick < 0.42 && !taken(vlane)) {
      const vy = Math.round(h(vlane, vx));
      if (pick < 0.15) chunk.hoops.push({ id: `${index}:ground`, lane: vlane, x: vx, y: vy - 34, r: 46, air: false });
      else if (pick < 0.3) {
        chunk.vents.push({ id: `${index}:v`, lane: vlane, kind: 'updraft', x: vx, y: vy, w: 110, h: 440 });
        const cy = vy - 450;
        chunk.ledges.push({ lane: vlane, x: vx - 150, w: 300, y: cy, cloud: Math.floor(vr() * 5) });
        for (let k = 0; k < 3; k++) ring(vlane, vx - 75 + k * 75, cy - 42);
      } else if (Math.abs(h(vlane, vx - 60) - h(vlane, vx + 60)) < 25) {
        chunk.vents.push({ id: `${index}:v`, lane: vlane, kind: 'geyser', x: vx, y: vy, w: 70, h: 320 });
        for (let k = 0; k < 3; k++) ring(vlane, vx, vy - 150 - k * 70);
      }
    }
  }

  // ---- the floors: slabs of STEP along each lane's land, cut at the chasms, flat where a loop sits
  for (const lane of LANES) {
    const cut = chasms.get(lane);
    const lp = flat.get(lane);
    const from = index === 0 ? -400 : x0;
    let x = from;
    while (x < x1) {
      let nx = Math.min(x + STEP, x1);
      if (cut && cut[0] > x && cut[0] < nx) nx = cut[0];
      if (lp && lp[0] > x && lp[0] < nx) nx = lp[0];
      if (lp && lp[1] > x && lp[1] < nx) nx = lp[1];
      const mid = (x + nx) / 2;
      if (!(cut && mid > cut[0] && mid < cut[1])) {
        const smooth = (t: number) => t * t * (3 - 2 * t);
        const y = (px: number) => {
          if (!lp || px < lp[0] || px > lp[1]) return h(lane, px);
          // Eased ramps (no corner to launch the ball off) in and out of the flat.
          if (px < lp[0] + lp[3]) return lp[4] ? h(lane, px) + smooth((px - lp[0]) / lp[3]) * (lp[2] - h(lane, px)) : h(lane, lp[0]) + smooth((px - lp[0]) / lp[3]) * (lp[2] - h(lane, lp[0]));
          if (px > lp[1] - lp[3]) return lp[4] ? lp[2] + smooth((px - (lp[1] - lp[3])) / lp[3]) * (h(lane, px) - lp[2]) : lp[2] + smooth((px - (lp[1] - lp[3])) / lp[3]) * (h(lane, lp[1]) - lp[2]);
          return lp[2];
        };
        chunk.floors.push({ lane, x0: x, y0: y(x), x1: nx, y1: y(nx) });
      }
      x = cut && nx === cut[0] ? cut[1] : nx;
      // slabs that start at a chasm's far edge keep the grid of the chunk from there
      if (x > x1) break;
    }
  }
  return chunk;
}

/** A chunk moved by (dx, dy): the same land in another frame (the engine works in coordinates near zero). */
export function shiftChunk(c: InfinityChunk, dx: number, dy: number): InfinityChunk {
  return {
    index: c.index, x0: c.x0 + dx, x1: c.x1 + dx,
    floors: c.floors.map((f) => ({ ...f, x0: f.x0 + dx, x1: f.x1 + dx, y0: f.y0 + dy, y1: f.y1 + dy })),
    bumps: c.bumps.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })),
    gates: c.gates.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
    springs: c.springs.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
    ledges: c.ledges.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
    loops: c.loops.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
    bridges: c.bridges.map((b) => ({ ...b, x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy })),
    boosts: c.boosts.map((b) => ({ ...b, x: b.x + dx })),
    kickers: c.kickers.map((k) => ({ ...k, x: k.x + dx })),
    rings: c.rings.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })),
    stands: c.stands.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
    hoops: c.hoops.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })),
    smashes: c.smashes.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })),
    vents: c.vents.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })),
    pits: c.pits.map((o) => ({ ...o, x0: o.x0 + dx, x1: o.x1 + dx, y: o.y + dy })),
  };
}
