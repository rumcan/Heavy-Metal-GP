// P2-21: platformer routes: loops and rope bridges. Physics (a slow marble falls out of a loop, a fast one clears it,
// a marble crosses a bridge), the planner's limits, and whole races on courses that have them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { meta } from '../src/game/track';
import { AI_COLORS, AI_NAMES, TRACK_THEMES, mulberry32, randomStats } from '../src/game/types';
import type { MarbleInfo } from '../src/game/types';
import { trackFromPlan } from '../src/game/platformer/build';
import { FLOW_TUNING, planFlow } from '../src/game/platformer/flow';
import { PLATFORMER_COURSES, floorAt, planOfficial, planTutorial } from '../src/game/platformer/course';
import type { CoursePlan, Floor } from '../src/game/platformer/course';
import { LOOP_PITCH, LOOP_R, PLANK_H, bridgeDeckAt, buildBridgeBodies, buildLoopBodies, loopPoint } from '../src/game/platformer/routes';
import type { BridgeSpot, LoopSpot } from '../src/game/platformer/routes';

const Y = 600;
const driver: MarbleInfo = { id: 0, name: 'Tester', color: '#ff0000', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true } as MarbleInfo;

/** A flat three-lane course with whatever `extra` adds (a loop, a bridge), and a finish far to the right. */
function flat(extra: Partial<CoursePlan>, floors: Floor[] = [0, 1, 2].map((lane) => ({ lane: lane as 0, x0: -200, y0: Y, x1: 4200, y1: Y }))): CoursePlan {
  return { seed: 0, width: 3800, height: Y + 900, floors, bumps: [], gates: [], path: [{ x: 0, y: Y - 30 }, { x: 3800, y: Y - 30 }], startX: 520, startY: Y, finishX: 3500, finishY: Y, ...extra };
}

/** Put the player in the middle lane at (x, floor) rolling at `vx` and step `steps`; steering is off (a push of zero). */
function roll(plan: CoursePlan, x: number, vx: number, steps: number) {
  const game = new Game(1, [driver], { track: trackFromPlan(plan, 1, TRACK_THEMES.forest), recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.player;
  m.lane = 1;
  m.cannon = undefined;
  Matter.Body.setPosition(m.body, { x, y: Y - 16 });
  Matter.Body.setVelocity(m.body, { x: vx, y: 0 });
  const trace: { x: number; y: number; phase: number }[] = [];
  for (let i = 0; i < steps; i++) {
    game.step(PHYSICS_STEP);
    trace.push({ x: m.body.position.x, y: m.body.position.y, phase: m.loopPhase ?? 0 });
  }
  return { game, m, trace };
}

// ------------------------------------------------------------------ loops
const LOOP: LoopSpot = { lane: 1, x: 1400, y: Y, r: LOOP_R, pitch: LOOP_PITCH };

test('loop: the ring is a helix, entry and exit side by side on the floor line', () => {
  const a = loopPoint(LOOP, 0), b = loopPoint(LOOP, Math.PI * 2), top = loopPoint(LOOP, Math.PI);
  assert.equal(Math.round(a.y), Y);
  assert.equal(Math.round(b.y), Y);
  assert.ok(Math.abs(b.x - a.x - LOOP_PITCH) < 1e-6, 'it leaves one pitch further along');
  assert.ok(Math.abs(Y - top.y - LOOP_R * 2) < 1e-6, 'the top is a full diameter up');
  const bodies = buildLoopBodies(LOOP);
  assert.equal(bodies.length, 48);
  assert.ok(bodies.every((b) => meta(b).kind === 'floor' && meta(b).lane === 1), 'floors in its own lane only');
});

test('loop: a marble that carries speed rides up, over the top and out the far side', () => {
  const { trace } = roll(flat({ loops: [LOOP] }), LOOP.x - 200, 13, 700);
  const top = Math.min(...trace.map((p) => p.y));
  assert.ok(Y - top > LOOP_R * 2 - 40, `reached ${Math.round(Y - top)} px: the top of the ring`);
  assert.ok(trace.some((p) => p.phase === 1), 'it was on the way back down at some point');
  const end = trace[trace.length - 1];
  assert.ok(end.x > LOOP.x + LOOP_PITCH + 100, `out the far side (x ${Math.round(end.x)})`);
  assert.ok(end.y > Y - 30, 'back on the floor');
  assert.equal(end.phase, 0, 'and off the ring');
});

test('loop: a slow marble runs out of speed on the way up and falls back out the way it came', () => {
  const { trace } = roll(flat({ loops: [LOOP] }), LOOP.x - 200, 7, 700);
  const top = Math.min(...trace.map((p) => p.y));
  assert.ok(Y - top > 30, `it did climb (${Math.round(Y - top)} px)`);
  assert.ok(Y - top < LOOP_R * 2 - 30, `but not to the top (${Math.round(Y - top)} px)`);
  assert.ok(trace.every((p) => p.phase === 0), 'it never got past the top');
  const end = trace[trace.length - 1];
  assert.ok(end.x < LOOP.x, `rolled back out the entry (x ${Math.round(end.x)})`);
  assert.ok(end.y > Y - 30, 'and is on the floor');
});

test('loop: a marble in another lane rolls straight through; the ring is only there for its own lane', () => {
  const game = new Game(1, [driver], { track: trackFromPlan(flat({ loops: [LOOP] }), 1, TRACK_THEMES.forest), recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.player;
  m.lane = 2;
  m.cannon = undefined;
  Matter.Body.setPosition(m.body, { x: LOOP.x - 200, y: Y - 16 });
  Matter.Body.setVelocity(m.body, { x: 9, y: 0 });
  for (let i = 0; i < 400; i++) game.step(PHYSICS_STEP);
  assert.ok(m.body.position.x > LOOP.x + LOOP_PITCH + 100, 'ran past');
  assert.ok(m.body.position.y > Y - 30, 'never left the floor');
});

// ------------------------------------------------------------------ rope bridges
const CHASM: [number, number] = [1500, 1640];
const BRIDGE: BridgeSpot = { lane: 1, x0: CHASM[0], y0: Y + PLANK_H / 2, x1: CHASM[1], y1: Y + PLANK_H / 2, planks: 7, slack: 12 };
const withChasm = (extra: Partial<CoursePlan>): CoursePlan => flat(extra, [0, 1, 2].flatMap((lane) => [
  { lane: lane as 0, x0: -200, y0: Y, x1: CHASM[0], y1: Y },
  { lane: lane as 0, x0: CHASM[1], y0: Y, x1: 4200, y1: Y },
]));

test('bridge: a deck of planks over the chasm, in one lane, that floorAt reports as floor', () => {
  const planks = buildBridgeBodies(BRIDGE);
  assert.equal(planks.length, 7);
  assert.ok(planks.every((p) => meta(p).kind === 'bridge' && meta(p).lane === 1));
  const plan = withChasm({ bridges: [BRIDGE] });
  assert.equal(floorAt(plan, 1, 1570), bridgeDeckAt(BRIDGE, 1570));
  assert.ok(floorAt(plan, 1, 1570)! > Y, 'the deck sags below the floor ends');
  assert.equal(floorAt(plan, 0, 1570), null, 'other lanes still have a chasm there');
  assert.equal(floorAt(withChasm({}), 1, 1570), null, 'no bridge, no floor');
});

test('bridge: a marble rolls across it, the planks give under it, and without the bridge it falls', () => {
  const across = roll(withChasm({ bridges: [BRIDGE] }), CHASM[0] - 200, 8, 520);
  const end = across.trace[across.trace.length - 1];
  assert.ok(end.x > CHASM[1] + 40, `crossed (x ${Math.round(end.x)})`);
  assert.ok(end.y < Y + 40, 'and is up on the far floor, not in the chasm');
  const sags = (across.game.track.bodies.filter((b) => meta(b).kind === 'bridge')).map((b) => meta(b).sag ?? 0);
  assert.ok(Math.max(...sags.map(Math.abs)) < 90);
  // while it is on the deck the planks under it dip
  const crossing = roll(withChasm({ bridges: [BRIDGE] }), CHASM[0] + 10, 0.01, 120);
  const dip = Math.max(...crossing.game.track.bodies.filter((b) => meta(b).kind === 'bridge').map((b) => meta(b).sag ?? 0));
  assert.ok(dip > 1, `the deck gave under the marble (${dip.toFixed(1)} px)`);
  const fell = roll(withChasm({}), CHASM[0] - 200, 8, 520);
  assert.ok(fell.trace[fell.trace.length - 1].y > Y + 100, 'no bridge: it fell into the chasm');
});

// ------------------------------------------------------------------ the planner
test('planner: at most one loop and two bridges per flow course, and every one stands where it can be ridden', () => {
  for (const seed of [11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
    const plan = planFlow(seed);
    assert.ok((plan.loops ?? []).length <= 1, `seed ${seed}: loops`);
    assert.ok((plan.bridges ?? []).length <= 2, `seed ${seed}: bridges`);
    for (const l of plan.loops ?? []) {
      // flat floor from the entry through the whole ring, a run-up with a boost in it, no gate or chasm near
      for (let x = l.x; x <= l.x + l.pitch; x += 20) assert.ok(Math.abs((floorAt(plan, l.lane, x) ?? 1e9) - l.y) < 1, `seed ${seed}: flat under the loop at ${x}`);
      assert.ok((plan.boosts ?? []).some((b) => b.lane === l.lane && b.x < l.x - 100 && b.x > l.x - 700), `seed ${seed}: a boost in the run-up`);
      assert.ok(!plan.gates.some((g) => (g.lane === l.lane || g.to === l.lane) && g.x + g.w > l.x - 400 && g.x < l.x + 800), `seed ${seed}: no gate near the loop`);
    }
    for (const b of plan.bridges ?? []) {
      assert.ok(floorAt(plan, b.lane, b.x0 - 5) !== null && floorAt(plan, b.lane, b.x1 + 5) !== null, `seed ${seed}: floor at both ends of the bridge`);
      assert.ok(b.slack >= 8 && b.slack <= 14);
    }
  }
  assert.ok([11, 1, 2, 4, 6, 7, 8].every((s) => (planFlow(s).loops ?? []).length === 1), 'most seeds get a loop');
});

test('planner: routes are deterministic, switch off cleanly, and never touch the tutorial or the block courses', () => {
  assert.deepEqual(planFlow(11), planFlow(11));
  // (sky runs are switched off on both sides: they keep clear of loops, so they move when the loops do)
  const off = planFlow(11, { ...FLOW_TUNING, routes: false, sky: false });
  assert.equal(off.loops?.length, 0);
  assert.equal(off.bridges?.length, 0);
  const tutorial = planTutorial();
  assert.equal(tutorial.loops, undefined);
  assert.equal(tutorial.bridges, undefined);
  for (const c of PLATFORMER_COURSES.filter((c) => !c.flow)) {
    const plan = planOfficial(c);
    assert.equal(plan.loops, undefined, c.name);
    assert.equal(plan.bridges, undefined, c.name);
  }
  // the hills, chasms, gates and everything else are exactly as they were without routes (apart from the flat under a loop)
  const on = planFlow(11, { ...FLOW_TUNING, sky: false });
  assert.deepEqual(on.gates, off.gates);
  assert.deepEqual(on.bumps, off.bumps);
  assert.deepEqual(on.springs, off.springs);
  assert.deepEqual(on.ledges, off.ledges);
});

// ------------------------------------------------------------------ whole races
function field(): MarbleInfo[] {
  const rng = mulberry32(777);
  return Array.from({ length: 10 }, (_, i) => ({ id: i, name: AI_NAMES[i] ?? `AI ${i}`, color: AI_COLORS[i % AI_COLORS.length], stats: randomStats(rng), isPlayer: false, character: i % 6 }));
}

test('races: the AI field gets through every flow course that has a loop and bridges (nobody is held up by a route)', () => {
  for (const seed of [11, 2, 6]) {
    const plan = planFlow(seed);
    assert.ok(plan.loops!.length === 1 && plan.bridges!.length >= 1, `seed ${seed} has routes`);
    const game = new Game(seed, field(), { track: trackFromPlan(plan, seed, TRACK_THEMES.forest) });
    game.start();
    game.openGate();
    let t = 0;
    const loopX = plan.loops![0].x;
    const passed = new Set<number>();
    const rode = new Set<number>();
    for (; t < 240000 && !game.allFinished(); t += PHYSICS_STEP) {
      game.step(PHYSICS_STEP);
      for (const m of game.marbles) {
        if (m.body.position.x > loopX + LOOP_PITCH + 200) passed.add(m.info.id);
        if (m.loopPhase === 1) rode.add(m.info.id);
      }
    }
    assert.ok(game.allFinished(), `seed ${seed}: the race ended (${game.finishOrder.length}/10 finished after ${Math.round(t / 1000)} s)`);
    const finished = game.finishOrder.length;
    assert.ok(finished >= 8, `seed ${seed}: ${finished}/10 finished`);
    assert.ok(passed.size >= 8, `seed ${seed}: ${passed.size}/10 got past the loop`);
    assert.ok(rode.size >= 1, `seed ${seed}: somebody rode the loop over the top`);
  }
});

// ------------------------------------------------------------------ the AI
test('AI: a computer driver commits to a loop (full push, no hop) and rides it over the top after the boost pad', () => {
  const plan = flat({ loops: [LOOP], boosts: [{ lane: 1, x: LOOP.x - 420, w: 160 }] });
  const ai = { ...driver, isPlayer: false } as MarbleInfo;
  const game = new Game(1, [ai], { track: trackFromPlan(plan, 1, TRACK_THEMES.forest), humanSeats: [], recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.marbles[0];
  m.lane = 1;
  m.cannon = undefined;
  Matter.Body.setPosition(m.body, { x: LOOP.x - 750, y: Y - 16 });
  Matter.Body.setVelocity(m.body, { x: 0, y: 0 });
  let rode = false, hopped = false, maxVy = 0;
  for (let i = 0; i < 1400; i++) {
    game.step(PHYSICS_STEP);
    const p = m.body.position;
    if (m.loopPhase === 1) rode = true;
    if (p.x > LOOP.x - 330 && p.x < LOOP.x && p.y < Y - 24) hopped = true; // up in the air on the run-up
    maxVy = Math.min(maxVy, m.body.velocity.y);
  }
  assert.ok(!hopped, 'no hop on the way into the ring');
  assert.ok(rode, 'it rode over the top');
  assert.ok(m.body.position.x > LOOP.x + LOOP_PITCH + 150, `and came out the far side (x ${Math.round(m.body.position.x)})`);
});

test('AI: a computer driver rolls across a rope bridge instead of jumping the chasm', () => {
  const plan = withChasm({ bridges: [BRIDGE] });
  const ai = { ...driver, isPlayer: false } as MarbleInfo;
  const game = new Game(1, [ai], { track: trackFromPlan(plan, 1, TRACK_THEMES.forest), humanSeats: [], recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.marbles[0];
  m.lane = 1;
  m.cannon = undefined;
  Matter.Body.setPosition(m.body, { x: CHASM[0] - 500, y: Y - 16 });
  let airborne = 0;
  for (let i = 0; i < 1200; i++) {
    game.step(PHYSICS_STEP);
    if (m.body.position.x > CHASM[0] - 20 && m.body.position.x < CHASM[1] + 20 && m.body.position.y < Y - 30) airborne++;
  }
  assert.ok(m.body.position.x > CHASM[1] + 100, `crossed (x ${Math.round(m.body.position.x)})`);
  assert.equal(airborne, 0, 'it never jumped over the deck');
});

test('bridge: a marble on the deck counts as grounded, so it can jump from it', () => {
  const game = new Game(1, [driver], { track: trackFromPlan(withChasm({ bridges: [BRIDGE] }), 1, TRACK_THEMES.forest), recovery: false, effects: false, aiItems: false });
  game.start();
  game.openGate();
  const m = game.player;
  m.lane = 1;
  m.cannon = undefined;
  Matter.Body.setPosition(m.body, { x: (CHASM[0] + CHASM[1]) / 2, y: Y - 10 });
  let grounded = 0;
  for (let i = 0; i < 90; i++) { game.step(PHYSICS_STEP); if (i > 40 && m.grounded < 5) grounded++; }
  assert.ok(grounded >= 45, `grounded on ${grounded} of 49 steps once settled on the deck`);
  assert.ok(m.body.position.y > Y - 20 && m.body.position.y < Y + 20, 'resting on the deck, not in the chasm');
});
