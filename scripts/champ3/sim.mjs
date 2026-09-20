/**
 * CHAMP-04 directed route checks.
 *
 *   node --import tsx scripts/champ3/sim.mjs [checkpoint] [route]
 *
 * Runs the authored circuit headlessly with the four archetype builds from the ticket
 * (SPEED 3/9/3, MASS 9/3/3, BOUNCE 3/3/9, BALANCED 5/5/5) and a light steering controller, so
 * a route can be exercised deliberately instead of hoping randomness picks it. Every run
 * reports finish time, checkpoint crossings (which branch was taken), recoveries and holds.
 */
import { Game } from '../../src/game/engine.ts';
import { buildTrackFromDef, validateTrackDef } from '../../src/game/trackdef.ts';
import { meta } from '../../src/game/track.ts';
import { buildDef } from './def.mjs';

const FRAME = 1000 / 60;
const CAP_MS = 540000;

export const BUILDS = {
  SPEED: { weight: 3, speed: 9, bounce: 3 },
  MASS: { weight: 9, speed: 3, bounce: 3 },
  BOUNCE: { weight: 3, speed: 3, bounce: 9 },
  BALANCED: { weight: 5, speed: 5, bounce: 5 },
};

/**
 * Checkpoints: y -> (x ranges -> branch names). Recorded when a marble first crosses each y.
 * The bands are the real geometry, not guesses: e.g. at y900 a marble is in the left sweep,
 * the centre cut, the detour or the net room.
 */
const CHECKPOINTS = [
  { y: 700, name: 'forkA', bands: [[0, 380, 'left'], [380, 520, 'centre'], [520, 900, 'right']] },
  { y: 900, name: 'midA', bands: [[0, 300, 'left-sweep'], [300, 500, 'centre-cut'], [500, 620, 'detour'], [620, 900, 'net-room']] },
  { y: 1080, name: 'mergeA', bands: [[0, 380, 'left'], [380, 520, 'centre'], [520, 900, 'right']] },
  { y: 1240, name: 'entry', bands: [[0, 330, 'approach-left'], [330, 700, 'entry-rail'], [700, 900, 'burrow-deck']] },
  { y: 1500, name: 'feeder', bands: [[0, 320, 'upper-west'], [320, 620, 'raised-line'], [620, 900, 'turn']] },
  { y: 1650, name: 'oxbow', bands: [[0, 280, 'dry-west'], [280, 600, 'pool'], [600, 900, 'net-room']] },
  { y: 1900, name: 'lower', bands: [[0, 140, 'west-catch'], [140, 380, 'descent'], [380, 900, 'east-side']] },
  { y: 2400, name: 'sprint', bands: [[0, 300, 'runout-catch'], [300, 560, 'wide-entry'], [560, 900, 'east-side']] },
  { y: 2600, name: 'splitC', bands: [[0, 380, 'root-channel'], [380, 560, 'shoulder'], [560, 900, 'outside-S']] },
  { y: 2950, name: 'midC', bands: [[0, 400, 'root-channel'], [400, 600, 'shoulder'], [600, 900, 'outside-S']] },
  { y: 3250, name: 'runinC', bands: [[0, 900, 'finish-run']] },
];

/** Desired-x targets for steering: [y, x] the controller chases (only where a choice exists). */
export const ROUTE_TARGETS = {
  // Canopy Descent: hold the left bank, then the outer sweep.
  leftA: [[600, 430], [680, 330], [800, 200], [1000, 200], [1080, 440]],
  // Canopy Descent: stay central, then take the crumble or its detour.
  centreA: [[600, 450], [700, 450], [900, 450], [1080, 450]],
  // Canopy Descent: right spring line into the net room.
  rightA: [[600, 470], [700, 600], [800, 700], [900, 690], [1020, 700], [1080, 700]],
  // Emerald Oxbow: the pool line - keep the entry ribbon, skim left out of the switchback.
  skimB: [[1180, 500], [1262, 520], [1340, 640], [1440, 745], [1520, 700], [1600, 520], [1700, 300], [1800, 220], [2000, 300], [2100, 560], [2200, 450]],
  // Emerald Oxbow: the raised line - hold the inside of the turn and climb onto the shelf.
  raisB: [[1180, 480], [1300, 560], [1400, 640], [1470, 640], [1560, 500], [1650, 300], [1800, 220], [2000, 300], [2100, 560], [2200, 450]],
  // Emerald Oxbow: the wade - keep left of the turn and drop into the basin.
  wadeB: [[1180, 500], [1340, 640], [1450, 740], [1550, 640], [1660, 420], [1760, 260], [1900, 260], [2100, 560], [2200, 450]],
  // Emerald Oxbow: hold the ramp for the spring strip / burrow.
  burrowB: [[1180, 500], [1262, 520], [1330, 560]],
  // Rootbound Sprint: the outside line.
  outsideC: [[2270, 430], [2380, 400], [2450, 440], [2560, 560], [2680, 700], [2810, 700], [2950, 660], [3080, 620], [3200, 540], [3300, 470]],
  // Rootbound Sprint: the root channel.
  rootC: [[2270, 430], [2380, 400], [2500, 440], [2620, 430], [2700, 430], [2800, 450], [2900, 470], [3000, 460], [3150, 455], [3300, 455]],
};

export function roster(build, id = 0, count = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: id + i,
    name: `M${id + i}`,
    color: '#ffffff',
    stats: { ...build },
    isPlayer: i === 0,
  }));
}

/** Piece-index lookup helpers so a report can name what a marble actually touched. */
function describeTrack(track) {
  const kinds = {};
  for (const body of track.bodies) kinds[meta(body)?.kind ?? body.label] = (kinds[meta(body)?.kind ?? body.label] ?? 0) + 1;
  return kinds;
}

export function runOne({ build, targets = [], seed = 41004, steer = true, useItems = [], log = false }) {
  const def = buildDef();
  const track = buildTrackFromDef(def);
  const game = new Game(seed, roster(build), {
    track, effects: false, aiItems: false, recovery: true,
    onRecover: (_id, pos) => recoveries.push([Math.round(pos.x), Math.round(pos.y), Math.round(game.time / 100) / 10]),
  });
  game.openGate();
  const m = game.marbles[0];
  const marks = {};
  const recoveries = [];
  game.onEvent = undefined;
  const holds = [];
  const events = [];
  const trace = [];
  let t = 0;
  while (!game.allFinished() && t < CAP_MS) {
    if (steer && m.finishedAt === null && !m.hold) {
      const p = m.body.position;
      const target = pickTarget(targets, p.y, p.x);
      if (target !== null) {
        const dx = target - p.x;
        const vx = m.body.velocity.x;
        if (Math.abs(dx) > 12 && (Math.abs(vx) < 9 || Math.sign(vx) !== Math.sign(dx))) game.nudge = Math.sign(dx);
        else game.nudge = 0;
      } else game.nudge = 0;
    }
    game.step(FRAME);
    t += FRAME;
    const p = m.body.position;
    for (const cp of CHECKPOINTS) {
      if (marks[cp.name] === undefined && p.y >= cp.y) {
        const band = cp.bands.find(([lo, hi]) => p.x >= lo && p.x < hi);
        marks[cp.name] = band ? band[2] : `x${Math.round(p.x)}`;
      }
    }
    if (m.hold && holds[holds.length - 1]?.kind !== m.hold.kind) holds.push({ kind: m.hold.kind, at: Math.round(t / 100) / 10, from: [Math.round(p.x), Math.round(p.y)] });
    if (log && t % 500 < FRAME) trace.push([Math.round(t / 100) / 10, Math.round(p.x), Math.round(p.y), Math.round(m.body.velocity.x * 100) / 100, Math.round(m.body.velocity.y * 100) / 100, Math.round(m.stuckTime)]);
    for (const e of game.drainRaceEvents()) events.push(e.kind);
  }
  return {
    finished: m.finishedAt !== null,
    time: m.finishedAt === null ? null : Math.round(m.finishedAt) / 1000,
    marks,
    holds,
    recoveries: m.recoveries,
    recoverySpots: recoveries,
    nudges: m.nudges,
    pack: game.marbles.length,
    trace,
    events,
  };
}

function pickTarget(targets, y, x) {
  let best = null;
  for (const [ty, tx] of targets) {
    if (ty >= y - 40) { best = tx; break; }
  }
  return best;
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('sim.mjs');
if (isMain) {
  const def = buildDef();
  const check = validateTrackDef(def);
  if (!check.ok) {
    console.error('def rejected:', check.errors.join('\n'));
    process.exit(1);
  }
  const track = buildTrackFromDef(def);
  console.log(`def ok — ${def.pieces.length} pieces, height ${def.height}, bodies ${track.bodies.length}`);
  if (process.env.TRACE) {
    const t = runOne({ build: BUILDS[process.env.TRACE.split(':')[0]] ?? BUILDS.BALANCED, targets: ROUTE_TARGETS[process.env.TRACE.split(':')[1]] ?? [], log: true });
    for (const row of t.trace) console.log(row.join('  '));
    console.log('recoveries', JSON.stringify(t.recoverySpots));
    process.exit(0);
  }
  console.log('pieces:', JSON.stringify(describeTrack(track)));
  const only = process.argv.slice(2);
  const cases = [
    ['SPEED', 'leftA'], ['BALANCED', 'leftA'],
    ['MASS', 'centreA'], ['BALANCED', 'centreA'],
    ['BOUNCE', 'rightA'], ['BALANCED', 'rightA'],
    ['SPEED', 'skimB'], ['BALANCED', 'skimB'],
    ['BOUNCE', 'raisB'], ['BALANCED', 'raisB'],
    ['MASS', 'wadeB'], ['BALANCED', 'wadeB'],
    ['BOUNCE', 'burrowB'], ['SPEED', 'burrowB'],
    ['SPEED', 'outsideC'], ['BALANCED', 'outsideC'],
    ['MASS', 'rootC'], ['BALANCED', 'rootC'],
  ];
  for (const [name, route] of cases) {
    if (only.length && !only.some((o) => route.includes(o) || name.toLowerCase().includes(o.toLowerCase()))) continue;
    const targets = ROUTE_TARGETS[route];
    const r = runOne({ build: BUILDS[name], targets });
    console.log(`${name.padEnd(8)} ${route.padEnd(9)} ${r.finished ? `${r.time.toFixed(1)}s` : 'DNF'}  rec=${r.recoveries}@${JSON.stringify(r.recoverySpots)} nudge=${r.nudges}  ${JSON.stringify(r.marks)}${r.holds.length ? ' holds=' + JSON.stringify(r.holds.map((h) => h.kind)) : ''}`);
  }
}
