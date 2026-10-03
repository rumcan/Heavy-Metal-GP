// P2-22: validation for a platformer course. The same result the classic Workshop shows (static problems, then a headless
// race of ten AI marbles that must get 9 home), so the Validate / Share / Publish gating works the same for both.
import { Game } from '../../game/engine';
import { PHYSICS_STEP } from '../../game/physics';
import { AI_COLORS, AI_NAMES, TRACK_THEMES, mulberry32, randomStats } from '../../game/types';
import type { MarbleInfo } from '../../game/types';
import { validateTrackDef } from '../../game/trackdef';
import type { TrackDef } from '../../game/trackdef';
import { trackFromPlan } from '../../game/platformer/build';
import { planFromTrackDef, platformerIssues, settle } from '../../game/platformer/def';
import type { HeadlessReport, ValidationIssue, ValidationResult } from './validate';
import type { Point } from './camera';

const SEED = 42;
/** A platformer heat is long: five minutes of racing is the most a course may take. */
const HEAT_LIMIT_MS = 300_000;

function roster(): MarbleInfo[] {
  const rng = mulberry32(SEED);
  return Array.from({ length: 10 }, (_, id) => ({
    id, name: AI_NAMES[id % AI_NAMES.length], color: AI_COLORS[id % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: id % 6,
  }));
}

/** Races ten AI marbles through the course. Never throws. */
function headless(def: TrackDef): { report: HeadlessReport; issues: ValidationIssue[] } {
  const none: HeadlessReport = { finishRate: 0, medianTime: null, stuckSpots: [], timeLimitHits: 10, finishTimes: Array(10).fill(null), totalRecoveries: 0, averageRecoveries: 0 };
  const spots: Point[] = [];
  let game: Game | null = null;
  try {
    const plan = planFromTrackDef(settle(def));
    const track = trackFromPlan(plan, def.seed ?? 0, TRACK_THEMES.forest);
    game = new Game(SEED, roster(), { track, effects: false, aiItems: false, recovery: true, onRecover: (_id: number, pos: Point) => spots.push({ x: Math.round(pos.x), y: Math.round(pos.y) }) });
    game.start();
    game.openGate();
    let steps = 0;
    while (!game.allFinished() && game.raceTime() < HEAT_LIMIT_MS && steps < 40_000) {
      for (let k = 0; k < 4; k++) game.step(PHYSICS_STEP);
      steps++;
    }
    const finishTimes = game.marbles.map((m) => m.finishedAt);
    const finished = finishTimes.filter((t): t is number => t !== null).sort((a, b) => a - b);
    const total = game.marbles.reduce((s, m) => s + m.recoveries, 0);
    const clustered: Point[] = [];
    for (const s of spots) if (!clustered.some((c) => Math.hypot(c.x - s.x, c.y - s.y) < 120)) clustered.push(s);
    const report: HeadlessReport = {
      finishRate: finished.length / game.marbles.length,
      medianTime: finished.length ? finished[Math.floor(finished.length / 2)] : null,
      stuckSpots: clustered, timeLimitHits: game.marbles.length - finished.length, finishTimes,
      totalRecoveries: total, averageRecoveries: total / game.marbles.length,
    };
    const issues: ValidationIssue[] = [];
    const where = clustered[0] ?? { x: plan.finishX - 300, y: plan.finishY - 100 };
    if (report.finishRate < 0.9) issues.push({ severity: 'error', message: `Only ${finished.length}/10 finished: at least 9 must get home.`, pos: where });
    if (report.timeLimitHits > 0) issues.push({ severity: 'error', message: `${report.timeLimitHits} marble(s) were still on the course after ${Math.round(HEAT_LIMIT_MS / 1000)} s.`, pos: where });
    if (clustered.length > 0) {
      const hard = total > 12 || clustered.length >= 5;
      for (const p of clustered.slice(0, 4)) issues.push({ severity: hard ? 'error' : 'warning', message: `${hard ? 'Trap' : 'Stuck spot'} near x ${p.x}: the marshal had to lift a marble out.`, pos: p });
    }
    return { report, issues };
  } catch (error) {
    return { report: none, issues: [{ severity: 'error', message: `The course cannot be raced: ${error instanceof Error ? error.message : String(error)}`, pos: { x: 600, y: 600 } }] };
  } finally {
    game?.destroy();
  }
}

export function validatePlatformer(def: TrackDef): ValidationResult {
  const check = validateTrackDef(def);
  const staticIssues: ValidationIssue[] = check.ok
    ? platformerIssues(check.def).map((i) => ({ severity: 'error' as const, message: i.message, pos: { x: i.x, y: i.y }, pieceIndex: i.piece }))
    : check.errors.slice(0, 5).map((message) => ({ severity: 'error' as const, message, pos: { x: 600, y: 600 } }));
  const blocked = staticIssues.length > 0;
  const { report, issues: headlessIssues } = blocked
    ? { report: { finishRate: 0, medianTime: null, stuckSpots: [], timeLimitHits: 10, finishTimes: Array(10).fill(null), totalRecoveries: 0, averageRecoveries: 0 } as HeadlessReport, issues: [] as ValidationIssue[] }
    : headless(check.ok ? check.def : def);
  const issues = [...staticIssues, ...headlessIssues];
  const canShare = !issues.some((i) => i.severity === 'error') && report.finishRate >= 0.9 && report.timeLimitHits === 0;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const summary = canShare
    ? `PASS: ${Math.round(report.finishRate * 10)}/10 finished, median ${((report.medianTime ?? 0) / 1000).toFixed(0)} s`
    : blocked ? `FAIL: ${errors} problem(s) to fix before it can be raced` : `FAIL: ${errors} error(s), ${Math.round(report.finishRate * 10)}/10 finished`;
  return { ok: canShare, canShare, canSaveDraft: true, issues, staticIssues, headlessIssues, headless: report, summary };
}
