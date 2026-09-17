/**
 * MB-05. Validation before save/share — static + headless.
 *
 * Static checks: gate/finish present, nothing overlaps start gate, loops
 * have entry speed (≈ sqrt(5 g r)), no piece outside 0..W, height/piece
 * budget.
 * Headless: 10 marbles, fixed seed, 4× speed off-screen, finish rate,
 * median time, stuck spots via Game.onRecover, time limit hits.
 * A track must pass (≥9/10, no hard errors) to be shared/used online;
 * drafts always save.
 */
import { W, START_H, FINISH_H } from '../../game/track';
import { MAX_HEIGHT, MAX_PIECES, validateTrackDef } from '../../game/trackdef';
import type { TrackDef, Piece } from '../../game/trackdef';
import type { Track } from '../../game/track';
import { buildTrackFromDef } from '../../game/trackdef';
import { Game } from '../../game/engine';
import { PHYSICS_STEP, HEAT_TIME_LIMIT } from '../../game/physics';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats } from '../../game/types';
import type { MarbleInfo } from '../../game/types';
import type { Point } from './camera';
import { buildEditorTrack } from './build';

export type IssueSeverity = 'error' | 'warning';
export interface ValidationIssue {
  severity: IssueSeverity;
  message: string;
  pos?: Point;
  pieceIndex?: number;
}

export interface HeadlessReport {
  finishRate: number;
  medianTime: number | null;
  stuckSpots: Point[];
  timeLimitHits: number;
  finishTimes: (number | null)[];
  totalRecoveries: number;
  averageRecoveries: number;
}

export interface ValidationResult {
  ok: boolean; // same as canShare for now
  canShare: boolean;
  canSaveDraft: true;
  issues: ValidationIssue[];
  staticIssues: ValidationIssue[];
  headlessIssues: ValidationIssue[];
  headless: HeadlessReport;
  /** Human summary */
  summary: string;
}

const VALIDATION_SEED = 42;
const G = 1; // Matter gravity y

function roster(seed = VALIDATION_SEED): MarbleInfo[] {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    name: id === 0 ? 'You' : AI_NAMES[(id - 1) % AI_NAMES.length],
    color: id === 0 ? '#d63e2e' : AI_COLORS[(id - 1) % AI_COLORS.length],
    stats: randomStats(rng),
    isPlayer: id === 0,
  }));
}

function pieceXs(piece: Piece): number[] {
  switch (piece.t) {
    case 'ramp':
    case 'ice':
      return [piece.a[0], piece.b[0]];
    case 'curve':
      return [piece.a[0], piece.c[0], piece.b[0]];
    case 'loop':
      return [piece.x];
    case 'hoop':
    case 'pad':
    case 'boost':
    case 'spinner':
    case 'breakable':
    case 'peg':
    case 'ppeg':
    case 'itembox':
    case 'wall':
    case 'block':
      return [(piece as { x: number }).x];
    case 'wrecker':
      return [piece.pivot[0]];
    case 'bucket':
      return [W / 2];
  }
}

function pieceYs(piece: Piece): number[] {
  switch (piece.t) {
    case 'ramp':
    case 'ice':
      return [piece.a[1], piece.b[1]];
    case 'curve':
      return [piece.a[1], piece.c[1], piece.b[1]];
    case 'loop':
      return [piece.bottom];
    case 'wrecker':
      return [piece.pivot[1] + piece.chain, piece.pivot[1]];
    case 'bucket':
      return [piece.y];
    default: {
      const p = piece as { y: number };
      return [p.y];
    }
  }
}

function staticChecks(def: TrackDef, track: Track | null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // height
  if (def.height < START_H + FINISH_H || def.height > MAX_HEIGHT) {
    issues.push({ severity: 'error', message: `Height ${def.height} outside ${START_H + FINISH_H}..${MAX_HEIGHT}`, pos: { x: W / 2, y: def.height / 2 } });
  }

  // piece budget (perf)
  if (def.pieces.length > MAX_PIECES) {
    issues.push({ severity: 'error', message: `Too many pieces: ${def.pieces.length} / ${MAX_PIECES}`, pos: { x: W / 2, y: 100 } });
  } else if (def.pieces.length > 1500) {
    issues.push({ severity: 'warning', message: `Large circuit: ${def.pieces.length} pieces may hurt performance`, pos: { x: W / 2, y: 100 } });
  }

  // outside 0..W
  def.pieces.forEach((p, i) => {
    for (const x of pieceXs(p)) {
      if (x < 0 || x > W) {
        issues.push({ severity: 'error', message: `${p.t} #${i} at x=${Math.round(x)} outside 0..${W}`, pos: { x: Math.max(0, Math.min(W, x)), y: pieceYs(p)[0] ?? 0 }, pieceIndex: i });
        break;
      }
    }
    for (const y of pieceYs(p)) {
      if (y > def.height) {
        issues.push({ severity: 'error', message: `${p.t} #${i} at y=${Math.round(y)} below height ${def.height}`, pos: { x: pieceXs(p)[0] ?? W / 2, y }, pieceIndex: i });
      }
    }
  });

  // grid and finish present
  if (!track) {
    issues.push({ severity: 'error', message: 'Circuit cannot be built — see build error', pos: { x: W / 2, y: 100 } });
  } else {
    if (!track.segments || track.segments.length < 3) {
      issues.push({ severity: 'error', message: 'Circuit missing start/finish sectors', pos: { x: W / 2, y: 50 } });
    }
    if (!track.gate) {
      issues.push({ severity: 'error', message: 'Start gate missing', pos: { x: W / 2, y: track.startY } });
    }
    // start gate overlap
    if (track.gate) {
      const gateB = track.gate.bounds;
      const { min, max } = gateB;
      // Use bodyToPiece to map, but we can approximate via piece positions near gate
      // Check each piece's y near start and x near center
      def.pieces.forEach((p, i) => {
        const ys = pieceYs(p);
        const xs = pieceXs(p);
        const y = ys[0] ?? 0;
        const x = xs[0] ?? W / 2;
        // Gate spans y roughly startY-? to startY+? (START_H 440, gate at top)
        // Approximate gate bounds: x 0..W, y 0.. START_H
        const nearGateY = y < START_H + 60 && y > -40;
        const nearGateX = x > 80 && x < W - 80;
        if (nearGateY && nearGateX) {
          // More precise: check if piece bounds would intersect gate bounds via built bodies
          // We can check later with bodies, but for now heuristic warning for any piece very close to gate
          // Only flag walls/blocks/breakables that sit on gate
          if (p.t === 'wall' || p.t === 'block' || p.t === 'breakable' || p.t === 'ramp' || p.t === 'ice') {
            // Check actual body overlap via track bodies for this piece index
            // Find bodies for this piece via built track's bodies and meta? Instead use heuristic distance
            // If piece is within gate's y range and near center, mark as error
            if (y < 200) {
              issues.push({ severity: 'error', message: `${p.t} #${i} overlaps start gate — marbles can't leave grid`, pos: { x, y }, pieceIndex: i });
            }
          }
        }
        void min; void max;
      });
      // Also check via actual bodies for accuracy
      try {
        const built = buildEditorTrack(def);
        if (built.track) {
          const gMin = track.gate.bounds.min;
          const gMax = track.gate.bounds.max;
          for (let bi = 0; bi < built.track.bodies.length; bi++) {
            const pi = built.bodyToPiece[bi];
            if (pi === -1 || pi === undefined) continue;
            const b = built.track.bodies[bi];
            const { min: bMin, max: bMax } = b.bounds;
            const overlap = !(bMax.x < gMin.x || bMin.x > gMax.x || bMax.y < gMin.y || bMin.y > gMax.y);
            if (overlap) {
              const p = def.pieces[pi];
              issues.push({ severity: 'error', message: `${p.t} #${pi} overlaps start gate`, pos: { x: (bMin.x + bMax.x) / 2, y: (bMin.y + bMax.y) / 2 }, pieceIndex: pi });
              break; // one is enough to flag
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // loops entry ramp check — warn if no ramp provides 2.5r drop
    const loops = def.pieces.map((p, idx) => ({ p, idx })).filter(({ p }) => p.t === 'loop') as { p: Extract<Piece, { t: 'loop' }>; idx: number }[];
    for (const { p: loop, idx } of loops) {
      const need = 2.5 * loop.r;
      const wantY = loop.bottom - need;
      let ok = false;
      for (const cand of def.pieces) {
        if (cand.t !== 'ramp' && cand.t !== 'ice') continue;
        const ys = [cand.a[1], cand.b[1]];
        const xs = [cand.a[0], cand.b[0]];
        const highY = Math.min(...ys);
        const lowY = Math.max(...ys);
        // Ramp must be above loop and within x near loop
        const xNear = xs.some((x) => Math.abs(x - loop.x) < 260);
        if (highY < wantY && lowY < loop.bottom - 40 && xNear) {
          // Check drop enough
          const drop = loop.bottom - highY;
          if (drop >= need * 0.85) {
            ok = true;
            break;
          }
        }
      }
      if (!ok) {
        const needSpeed = Math.sqrt(5 * G * loop.r);
        issues.push({
          severity: 'warning',
          message: `Loop #${idx} r=${Math.round(loop.r)} needs ~${needSpeed.toFixed(1)} speed (drop ~${Math.round(need)}u) — no entry ramp found`,
          pos: { x: loop.x, y: loop.bottom },
          pieceIndex: idx,
        });
      }
    }
  }

  // validateTrackDef already checks many of these, but we also surface its errors as issues
  const check = validateTrackDef(def);
  if (!check.ok) {
    // Add each error as issue at top
    for (const err of check.errors.slice(0, 5)) {
      issues.unshift({ severity: 'error', message: err, pos: { x: W / 2, y: 80 } });
    }
  }

  return issues;
}

function headlessCheck(def: TrackDef): { report: HeadlessReport; issues: ValidationIssue[] } {
  const spots: Point[] = [];
  let track: Track | null = null;
  try {
    track = buildTrackFromDef(def);
  } catch {
    return {
      report: { finishRate: 0, medianTime: null, stuckSpots: [], timeLimitHits: 10, finishTimes: Array(10).fill(null), totalRecoveries: 0, averageRecoveries: 0 },
      issues: [{ severity: 'error', message: 'Circuit cannot be built for headless test', pos: { x: W / 2, y: 100 } }],
    };
  }

  const onRecover = (_id: number, pos: Point) => spots.push({ x: Math.round(pos.x), y: Math.round(pos.y) });

  const game = new Game(VALIDATION_SEED, roster(VALIDATION_SEED), { track, effects: false, aiItems: false, recovery: true, onRecover });
  game.openGate();

  let steps = 0;
  const maxIter = 80000; // at 4x, ~ HEAT_TIME_LIMIT / PHYSICS_STEP /4 ≈ 540000*120/1000/4≈16200
  while (!game.allFinished() && game.raceTime() < HEAT_TIME_LIMIT && steps < maxIter) {
    for (let k = 0; k < 4; k++) game.step(PHYSICS_STEP);
    steps++;
  }

  const finishTimes: (number | null)[] = game.marbles.map((m) => m.finishedAt);
  const finished = finishTimes.filter((t) => t !== null) as number[];
  const finishRate = finished.length / game.marbles.length;
  const sorted = [...finished].sort((a, b) => a - b);
  const medianTime = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const timeLimitHits = game.marbles.filter((m) => m.finishedAt === null).length;
  const totalRecoveries = game.marbles.reduce((s, m) => s + m.recoveries, 0);
  const averageRecoveries = totalRecoveries / game.marbles.length;

  // deduplicate stuck spots by grid (80u)
  const clustered: Point[] = [];
  for (const s of spots) {
    if (!clustered.some((c) => Math.hypot(c.x - s.x, c.y - s.y) < 80)) clustered.push(s);
  }

  const report: HeadlessReport = {
    finishRate,
    medianTime,
    stuckSpots: clustered,
    timeLimitHits,
    finishTimes,
    totalRecoveries,
    averageRecoveries,
  };

  const issues: ValidationIssue[] = [];

  if (finishRate < 0.9) {
    const pos = clustered[0] ?? { x: W / 2, y: track.finishY - 100 };
    issues.push({ severity: 'error', message: `Only ${finished.length}/10 finished — need ≥9/10`, pos });
  }
  if (timeLimitHits > 0) {
    const pos = clustered[0] ?? { x: W / 2, y: track.finishY - 100 };
    issues.push({ severity: 'error', message: `${timeLimitHits} marble(s) hit time limit (${(HEAT_TIME_LIMIT / 1000).toFixed(0)}s)`, pos });
  }
  // stuck spots: treat many recoveries as hard error, few as warning
  // Calendar baseline: up to 3 recoveries / 3 spots with all finish is still PASS (warnings only)
  if (clustered.length > 0) {
    if (totalRecoveries > 5 || clustered.length >= 4) {
      for (const p of clustered.slice(0, 4)) {
        issues.push({ severity: 'error', message: `Trap detected — recovery marshal fired at ${Math.round(p.x)},${Math.round(p.y)}`, pos: p });
      }
      if (clustered.length > 4) {
        issues.push({ severity: 'error', message: `+${clustered.length - 4} more trap spots`, pos: clustered[4] });
      }
    } else {
      for (const p of clustered) {
        issues.push({ severity: 'warning', message: `Stuck spot at ${Math.round(p.x)},${Math.round(p.y)} — marshal recovered marble`, pos: p });
      }
    }
  }

  game.destroy();

  return { report, issues };
}

export function validateStatic(def: TrackDef): ValidationIssue[] {
  let track: Track | null = null;
  try {
    track = buildTrackFromDef(def);
  } catch {
    track = null;
  }
  return staticChecks(def, track);
}

export function validateHeadless(def: TrackDef): { report: HeadlessReport; issues: ValidationIssue[] } {
  return headlessCheck(def);
}

export function validateTrack(def: TrackDef): ValidationResult {
  const staticIssues = staticChecks(def, (() => { try { return buildTrackFromDef(def); } catch { return null; } })());
  const { report: headless, issues: headlessIssues } = headlessCheck(def);
  const issues = [...staticIssues, ...headlessIssues];
  const hasError = issues.some((i) => i.severity === 'error');
  const canShare = headless.finishRate >= 0.9 && !hasError && headless.timeLimitHits === 0;
  const ok = canShare;
  const summary = canShare
    ? `PASS — ${Math.round(headless.finishRate * 10)}/10 finished, median ${(headless.medianTime ?? 0) / 1000}s`
    : `FAIL — ${issues.filter((i) => i.severity === 'error').length} error(s), ${Math.round(headless.finishRate * 10)}/10 finished`;

  return {
    ok,
    canShare,
    canSaveDraft: true,
    issues,
    staticIssues,
    headlessIssues,
    headless,
    summary,
  };
}

// Async wrapper for UI — runs headless off the main tick to keep editor responsive
export function validateTrackAsync(def: TrackDef): Promise<ValidationResult> {
  return new Promise((resolve) => {
    // Use timeout to yield to paint before heavy simulation
    setTimeout(() => resolve(validateTrack(def)), 20);
  });
}
