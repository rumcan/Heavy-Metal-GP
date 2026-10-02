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
    if (md.lane !== undefined) assert.equal(body.collisionFilter.mask, laneCategory(md.lane), `${md.kind} sees only its own lane`);
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

test('online: race settings carry a platformer course id; a bad id is refused', async () => {
  const { readRaceSettings } = await import('../src/net/protocol');
  assert.deepEqual(readRaceSettings({ circuit: 0, platformer: 'misty-ridge' }), { circuit: 0, platformer: 'misty-ridge' });
  assert.equal(readRaceSettings({ circuit: 0, platformer: 'Misty Ridge!' }), null);
  assert.equal(readRaceSettings({ circuit: 0, platformer: 7 }), null);
  assert.deepEqual(readRaceSettings({ circuit: 2 }), { circuit: 2 });
});

test('flow courses: smooth, descending, and the back ridge always stands above the middle one out on the slopes', async () => {
  const { planFlow } = await import('../src/game/platformer/flow');
  const plan = planFlow(11);
  assert.equal(plan.style, 'flow');
  assert.ok(plan.finishY > plan.startY + 1500, 'a long descent');
  for (const lane of LANES) {
    const floors = plan.floors.filter((f) => f.lane === lane).sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < floors.length; i++) {
      const a = floors[i - 1], b = floors[i];
      if (b.x0 - a.x1 < 0.5) assert.ok(Math.abs(b.y0 - a.y1) < 0.01, `lane ${lane}: the slope is continuous at ${b.x0}`);
      else assert.ok(b.x0 - a.x1 <= 170, `lane ${lane}: a jumpable chasm at ${a.x1}`);
    }
  }
  for (let x = 3000; x < plan.width - 3000; x += 250) {
    const back = floorAt(plan, 0, x), middle = floorAt(plan, 1, x);
    if (back !== null && middle !== null) assert.ok(back < middle, `back ridge above the middle at ${x}`);
  }
});

test('springs and one-way ledges: a ball passes up through a ledge, lands on it, and a spring launches it', async () => {
  const { planFlow } = await import('../src/game/platformer/flow');
  const plan = planFlow(11);
  assert.ok((plan.springs?.length ?? 0) > 0 && plan.springs!.length === plan.ledges!.length, 'a ledge for every spring');
  for (const l of plan.ledges!) {
    const under = floorAt(plan, l.lane, l.x + 10);
    if (under !== null) assert.ok(l.y < under - 150, 'a ledge stands well above the ground');
  }
  // In a race: count how many balls ever stood on a ledge and were launched by a spring.
  const game = new Game(5, roster(), { track: buildPlatformerTrack(5, TRACK_THEMES.forest, 'rolling-hills') });
  game.start();
  game.openGate();
  let launched = 0, onLedge = 0;
  const seen = new Set<number>();
  for (let i = 0; i < 9000 && !game.allFinished(); i++) {
    game.step(PHYSICS_STEP);
    for (const m of game.marbles) {
      if (m.springAt === game.time) launched++;
      const lane = m.lane ?? 1;
      const p = m.body.position;
      if (!seen.has(m.info.id) && game.track.platformer!.plan.ledges!.some((l) => l.lane === lane && p.x > l.x && p.x < l.x + l.w && Math.abs(p.y + 14 - l.y) < 4 && m.grounded < 3)) { seen.add(m.info.id); onLedge++; }
    }
  }
  assert.ok(launched > 0, 'springs launched someone');
  assert.ok(onLedge > 0, 'someone rode a ledge');
  assert.ok(game.allFinished(), 'and everyone still finished');
});

test('map pieces on flow courses: power-up boxes get picked up, wrecking balls swing, boosts push, everyone finishes', () => {
  const track = buildPlatformerTrack(2, TRACK_THEMES.forest, 'rolling-hills');
  const plan = track.platformer!.plan;
  assert.ok((plan.itemBoxes?.length ?? 0) >= 6, 'power-up boxes');
  assert.ok((plan.wreckers?.length ?? 0) >= 3, 'wrecking balls');
  assert.ok((plan.boosts?.length ?? 0) >= 2, 'boost pads');
  assert.equal(track.itemBoxes.length, plan.itemBoxes!.length);
  assert.equal(track.wreckers.length, plan.wreckers!.length);
  const game = new Game(2, roster(), { track });
  game.start();
  game.openGate();
  const start = track.wreckers.map((w) => ({ ...w.position }));
  let picked = 0;
  for (let i = 0; i < 18000 && !game.allFinished(); i++) {
    game.step(PHYSICS_STEP);
    if (i === 60) assert.ok(track.wreckers.some((w, k) => Math.abs(w.position.x - start[k].x) > 1), 'the wrecking balls swing');
  }
  for (const box of track.itemBoxes) if (meta(box).respawnAt) picked++;
  assert.ok(picked > 0, 'someone picked up a power-up box');
  assert.ok(game.allFinished(), `everyone finished (${game.finishOrder.length}/10)`);
});

test('cannon start: everyone starts in their own cannon (nobody stacked); people aim and fire, or are fired anyway', async () => {
  const { CANNON_AUTOFIRE_MS, CANNON_MIN, CANNON_MAX } = await import('../src/game/engine/platformer');
  const people = roster().map((m, i) => (i === 0 ? { ...m, isPlayer: true } : m));
  const game = new Game(4, people, { track: buildPlatformerTrack(4, TRACK_THEMES.forest, 'rolling-hills') });
  const spots = game.marbles.map((m) => `${m.cannon!.lane}:${Math.round(m.cannon!.x)}`);
  assert.equal(new Set(spots).size, 10, 'ten different cannons');
  game.start();
  // aiming on the grid: left lifts the barrel, right flattens it, within the limits
  game.nudge = -1;
  for (let i = 0; i < 400; i++) game.step(PHYSICS_STEP);
  assert.equal(game.player.cannon!.angle, CANNON_MAX);
  game.nudge = 1;
  for (let i = 0; i < 400; i++) game.step(PHYSICS_STEP);
  assert.equal(game.player.cannon!.angle, CANNON_MIN);
  game.nudge = 0;
  assert.ok(game.marbles.every((m) => !m.cannon!.fired), 'nobody fires before lights out');
  game.openGate();
  for (let i = 0; i < 120; i++) game.step(PHYSICS_STEP);
  assert.ok(game.marbles.filter((m) => !m.info.isPlayer).every((m) => m.cannon!.fired), 'the AI fires within a second');
  assert.equal(game.player.cannon!.fired, false, 'a person fires when they choose');
  game.jumpPressed = true;
  game.step(PHYSICS_STEP);
  assert.ok(game.player.cannon!.fired, 'jump fires it');
  assert.ok(game.player.body.velocity.x > 10, 'out of the barrel at speed');
  // someone who never fires is fired anyway
  const idle = new Game(4, people, { track: buildPlatformerTrack(4, TRACK_THEMES.forest, 'rolling-hills') });
  idle.start();
  idle.openGate();
  for (let t = 0; t < CANNON_AUTOFIRE_MS + 100; t += PHYSICS_STEP) idle.step(PHYSICS_STEP);
  assert.ok(idle.player.cannon!.fired);
});

test('health: damage hurts, 0 HP is a DNF (last in the order, off the course), the last attacker gets the KO', () => {
  const game = new Game(6, roster(), { track: buildPlatformerTrack(6, TRACK_THEMES.forest, 'rolling-hills') });
  assert.equal(game.healthOn, true);
  game.start();
  game.openGate();
  for (let i = 0; i < 600; i++) game.step(PHYSICS_STEP);
  const victim = game.marbles[3], killer = game.marbles[5];
  assert.equal(game.damage(victim, 25, killer.info.id, 'bolt'), false);
  assert.equal(victim.health!.hp, 75);
  assert.equal(game.damage(victim, 25, null, 'wrecker'), false, 'a second hit straight away is still in the grace period');
  game.time += 800;
  assert.equal(game.damage(victim, 25, null, 'wrecker'), false);
  assert.equal(victim.health!.hp, 50);
  game.time += 800;
  assert.equal(game.damage(victim, 60, null, 'wrecker'), true);
  assert.ok(victim.dnf);
  assert.equal(killer.kos, 1, 'the rival who hurt it last within 4 s gets the KO');
  const order = game.ranking();
  assert.equal(order.at(-1)!.marble, victim);
  assert.equal(order.at(-1)!.dnf, true);
  assert.equal(order.at(-1)!.finished, false);
});

test('health: a race where everyone still racing finishes ends even with a DNF in it, and classic drops have no health', () => {
  const game = new Game(6, roster(), { track: buildPlatformerTrack(6, TRACK_THEMES.forest, 'rolling-hills') });
  game.start();
  game.openGate();
  game.damage(game.marbles[2], 500, null, 'crusher');
  assert.ok(game.marbles[2].dnf);
  for (let t = 0; t < 120000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
  assert.ok(game.allFinished());
  assert.equal(game.finishOrder.length, 9);
});

test('the purse: a DNF in a quick race pays the Shaman 10 %; a KO pays 75; a finish pays the placement', async () => {
  const { createAccount, settleRace } = await import('../src/game/economy');
  const acc = { ...createAccount(), credits: 1000 };
  const dnf = settleRace(acc, 'r1', { id: 0, rank: 10, time: null, pegs: 2, dnf: true, kos: 1 }, 1, 'quick');
  assert.equal(dnf.payout.koBounty, 75);
  assert.equal(dnf.payout.pegBonus, 10);
  assert.equal(dnf.payout.shamanFee, Math.round((1000 + 85) * 0.1));
  assert.equal(dnf.account.credits, 1000 + 85 - dnf.payout.shamanFee!);
  assert.equal(settleRace(dnf.account, 'r1', { id: 0, rank: 10, time: null, pegs: 2, dnf: true, kos: 1 }, 1, 'quick').account.credits, dnf.account.credits, 'paid once');
  const win = settleRace(acc, 'r2', { id: 0, rank: 1, time: 40000, pegs: 0, dnf: false, kos: 0 }, 1, 'quick');
  assert.equal(win.payout.placement, 500);
  assert.equal(win.payout.shamanFee, 0);
  const old = settleRace(acc, 'r3', { id: 0, rank: 1, time: 40000, pegs: 0 });
  assert.equal(old.payout.total, 500, 'results without health pay exactly as before');
});
