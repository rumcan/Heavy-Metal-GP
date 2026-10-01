// P2-00 (#124): platformer courses — the planner, the built track, and a whole race played headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planCourse, floorAt, COURSE_TUNING, PLATFORMER_COURSES, planOfficial, platformerCourse, isPlatformerPick, PLATFORMER_TRACK_ID } from '../src/game/platformer/course';
import type { Lane } from '../src/game/platformer/course';
import { buildPlatformerTrack, ALL_LANES } from '../src/game/platformer/build';
import { laneCategory } from '../src/game/lanes';
import { meta } from '../src/game/track';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, mulberry32, randomStats, TRACK_THEMES } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';

const LANES: Lane[] = [0, 1, 2];

test('planCourse: the same seed plans the same course; another seed plans another', () => {
  assert.deepEqual(planCourse(7), planCourse(7));
  assert.notDeepEqual(planCourse(7).floors, planCourse(8).floors);
});

test('planCourse: every lane has floor at the start and at the finish', () => {
  const plan = planCourse(3);
  for (const lane of LANES) {
    assert.notEqual(floorAt(plan, lane, plan.startX - 100), null, `start, lane ${lane}`);
    assert.notEqual(floorAt(plan, lane, plan.finishX), null, `finish, lane ${lane}`);
  }
  assert.ok(plan.finishX > COURSE_TUNING.length - COURSE_TUNING.finishLen);
});

test('planCourse: the course descends overall and never climbs more than a jump', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const plan = planCourse(seed);
    assert.ok(plan.finishY > plan.startY + 500, `seed ${seed} descends`);
    const middle = plan.floors.filter((f) => f.lane === 1).sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < middle.length; i++) assert.ok(middle[i - 1].y1 - middle[i].y0 <= 80, `seed ${seed}: step up at ${middle[i].x0}`);
  }
});

test('planCourse: gaps are jumpable and every lane gate stands on floor in both of its lanes', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const plan = planCourse(seed);
    for (const lane of LANES) {
      const floors = plan.floors.filter((f) => f.lane === lane).sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < floors.length; i++) assert.ok(floors[i].x0 - floors[i - 1].x1 <= COURSE_TUNING.gapMax, `seed ${seed} lane ${lane}: gap at ${floors[i].x0}`);
    }
    for (const g of plan.gates) {
      for (const x of [g.x, g.x + g.w / 2, g.x + g.w]) {
        assert.notEqual(floorAt(plan, g.lane, x), null, `seed ${seed}: ${g.kind} at ${g.x} has floor in lane ${g.lane}`);
        assert.notEqual(floorAt(plan, g.to, x), null, `seed ${seed}: ${g.kind} at ${g.x} has floor in lane ${g.to}`);
      }
      assert.equal(Math.abs(g.to - g.lane), 1, 'gates join neighbouring lanes');
    }
  }
});

test('buildPlatformerTrack: floors collide only with their own lane; shared walls with every lane', () => {
  const track = buildPlatformerTrack(5, TRACK_THEMES.forest);
  assert.ok(track.platformer);
  for (const body of track.bodies) {
    const md = meta(body);
    if (md.kind === 'floor') assert.equal(body.collisionFilter.mask, laneCategory(md.lane!));
    else assert.equal(body.collisionFilter.mask, ALL_LANES, md.kind);
  }
  assert.equal(meta(track.gate).kind, 'gate');
});

function roster(): MarbleInfo[] {
  const rng = mulberry32(777);
  return Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: i % 6 }));
}

test('a platformer race: the whole AI field finishes, in progress order, inside two minutes', () => {
  for (const seed of [1, 2]) {
    const track = buildPlatformerTrack(seed, TRACK_THEMES.forest);
    const game = new Game(seed, roster(), { track });
    game.start();
    game.openGate();
    let t = 0;
    const lanesSeen = new Set<number>();
    for (; t < 120000 && !game.allFinished(); t += PHYSICS_STEP) {
      game.step(PHYSICS_STEP);
      for (const m of game.marbles) lanesSeen.add(m.lane ?? 1);
    }
    assert.ok(game.allFinished(), `seed ${seed}: everyone finished (${game.finishOrder.length}/10 after ${Math.round(t / 1000)} s)`);
    assert.ok(t > 20000, `seed ${seed}: a real race, not a teleport (${Math.round(t / 1000)} s)`);
    assert.equal(lanesSeen.size, 3, `seed ${seed}: racers used all three lanes`);
    const times = game.finishOrder.map((m) => m.finishedAt!);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'finish order is time order');
  }
});

test('a platformer race replays identically from the same seed', () => {
  const run = () => {
    const game = new Game(9, roster(), { track: buildPlatformerTrack(9, TRACK_THEMES.forest) });
    game.start();
    game.openGate();
    for (let i = 0; i < 2400; i++) game.step(PHYSICS_STEP);
    return game.marbles.map((m) => `${m.body.position.x.toFixed(4)},${m.body.position.y.toFixed(4)},${m.lane}`).join('|');
  };
  assert.equal(run(), run());
});

test('official courses: picks resolve, unknown picks fall back to the first course', () => {
  assert.ok(isPlatformerPick(PLATFORMER_TRACK_ID));
  assert.ok(!isPlatformerPick('abc123'));
  assert.ok(!isPlatformerPick(null));
  assert.equal(platformerCourse('platformer:misty-ridge').name, 'Misty Ridge');
  assert.equal(platformerCourse('platformer:nope').id, PLATFORMER_COURSES[0].id);
});

test('official courses: every gate stands on floor in both lanes, and the whole AI field finishes', () => {
  for (const course of PLATFORMER_COURSES) {
    const plan = planOfficial(course);
    for (const g of plan.gates) for (const x of [g.x, g.x + g.w]) {
      assert.notEqual(floorAt(plan, g.lane, x), null, `${course.name}: gate at ${g.x}`);
      assert.notEqual(floorAt(plan, g.to, x), null, `${course.name}: gate at ${g.x}`);
    }
    const game = new Game(4, roster(), { track: buildPlatformerTrack(4, TRACK_THEMES.forest, course.id) });
    game.start();
    game.openGate();
    let t = 0;
    for (; t < 150000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
    assert.ok(game.allFinished(), `${course.name}: ${game.finishOrder.length}/10 finished after ${Math.round(t / 1000)} s`);
  }
});

test('the wire carries each marble\'s lane (host state frames)', () => {
  const game = new Game(3, roster(), { track: buildPlatformerTrack(3, TRACK_THEMES.forest) });
  game.start();
  game.openGate();
  for (let i = 0; i < 600; i++) game.step(PHYSICS_STEP);
  assert.deepEqual(game.marbleStates().map((s) => s.lane), game.marbles.map((m) => m.lane));
});
