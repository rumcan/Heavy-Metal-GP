// P2-22: a platformer course made in the Workshop: the def, its JSON, its validation (readable errors) and how it
// stands in for a planned course.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMER_DEF_VERSION, basePlan, customCourseId, defFromSeed, parsePlatformerDef, planFromDef, registerPlatformerDef, serializePlatformerDef, validatePlatformerDef } from '../src/game/platformer/def';
import type { PlatformerDef } from '../src/game/platformer/def';
import { floorAt, planOfficial, platformerCourse, unregisterCustomCourse } from '../src/game/platformer/course';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { AI_COLORS, AI_NAMES, TRACK_THEMES, mulberry32, randomStats } from '../src/game/types';

const flow = () => defFromSeed(11, 30000, 'flow', 'Hills');
const blocks = () => defFromSeed(7, 22000, 'blocks', 'Blocks');
const errorsOf = (value: unknown) => { const r = validatePlatformerDef(value); assert.ok(!r.ok, 'expected a refusal'); return r.ok ? [] : r.errors; };

test('def: a def grown from a seed validates, for both styles and several seeds', () => {
  for (const def of [flow(), blocks(), defFromSeed(3, 12000, 'flow'), defFromSeed(5, 40000, 'blocks')]) {
    const r = validatePlatformerDef(def);
    assert.ok(r.ok, r.ok ? '' : r.errors.join(' | '));
    assert.equal(def.version, PLATFORMER_DEF_VERSION);
  }
});

test('def: JSON round trip is exact, and the text is plain JSON', () => {
  for (const def of [flow(), blocks()]) {
    const text = serializePlatformerDef(def);
    const back = parsePlatformerDef(text);
    assert.ok(back.ok);
    if (back.ok) assert.deepEqual(back.def, def);
    assert.deepEqual(JSON.parse(text), def);
  }
  const bad = parsePlatformerDef('{not json');
  assert.ok(!bad.ok);
  if (!bad.ok) assert.match(bad.errors[0], /not valid JSON/);
});

test('def: the plan takes the def\'s lists in place of the planned ones, and keeps the seed\'s floors', () => {
  const def = flow();
  const base = basePlan(def);
  assert.ok(def.gates.length >= 3, 'the seed planned some gates');
  const edited: PlatformerDef = { ...def, gates: def.gates.slice(1), springs: [], bumps: def.bumps.slice(0, 2) };
  const plan = planFromDef(edited);
  assert.equal(plan.gates.length, def.gates.length - 1);
  assert.deepEqual(plan.springs, []);
  assert.equal(plan.bumps.length, 2);
  assert.deepEqual(plan.floors, base.floors);
  assert.deepEqual(plan.path, base.path);
  assert.equal(plan.finishX, base.finishX);
  assert.deepEqual(planFromDef(def).gates, base.gates.map((g) => ({ ...g, y: Math.round(g.y * 10) / 10 })), 'an untouched def plans what the seed planned');
});

test('def: refusals read as sentences', () => {
  const def = flow();
  assert.match(errorsOf({ ...def, version: 2 })[0], /newer version/);
  assert.match(errorsOf({ ...def, version: 0 })[0], /version must be 1/);
  assert.match(errorsOf({ ...def, name: '  ' }).join(' '), /needs a name/);
  assert.match(errorsOf({ ...def, length: 100 }).join(' '), /length must be between 6000 and 60000/);
  assert.match(errorsOf({ ...def, style: 'tubes' }).join(' '), /style must be/);
  assert.match(errorsOf({ ...def, theme: 'lava-disco' }).join(' '), /theme must be one of/);
  assert.match(errorsOf({ ...def, gates: 'many' }).join(' '), /lane gate list is missing/);
  assert.match(errorsOf({ ...def, springs: [{ lane: 4, x: 3000, y: 800 }] }).join(' '), /lane must be 0/);
  assert.match(errorsOf({ ...def, bumps: Array.from({ length: 301 }, () => ({ lane: 1, x: 3000, w: 60, y: 700, h: 40 })) }).join(' '), /Too many crates/);
  assert.match(errorsOf(null)[0], /must be an object/);
});

test('def: things must stand on solid floor, inside the course, clear of each other', () => {
  const def = flow();
  const plan = basePlan(def);
  // find a chasm in the middle lane: a stretch with no floor
  let gap = -1;
  for (let x = plan.startX + 1500; x < plan.finishX - 1500; x += 10) if (floorAt(plan, 1, x) === null && floorAt(plan, 1, x - 10) !== null) { gap = x; break; }
  assert.ok(gap > 0, 'the course has a chasm to test with');
  const y = floorAt(plan, 1, gap - 30)!;
  const over = errorsOf({ ...def, springs: [{ lane: 1, x: gap - 20, y }] });
  assert.match(over.join(' '), /Spring 1 \(middle lane, at [\d,]+\) is not on solid floor/);
  const gate = errorsOf({ ...def, gates: [{ kind: 'ramp', lane: 1, to: 1, x: 3000, w: 170, y: 900 }] });
  assert.match(gate.join(' '), /must join neighbouring lanes/);
  const wide = errorsOf({ ...def, gates: [{ kind: 'door', lane: 0, to: 2, x: 3000, w: 170, y: 900 }] });
  assert.match(wide.join(' '), /neighbouring lanes/);
  const out = errorsOf({ ...def, bumps: [{ lane: 1, x: -50, w: 60, y: 600, h: 40 }] });
  assert.match(out.join(' '), /outside the course|too close to the start/);
  const finish = errorsOf({ ...def, springs: [{ lane: 1, x: plan.finishX - 40, y: plan.finishY }] });
  assert.match(finish.join(' '), /too close to the finish/);
  const x = plan.startX + 2000;
  const f = floorAt(plan, 1, x + 30)!;
  const clash = errorsOf({ ...def, springs: [{ lane: 1, x, y: f }, { lane: 1, x: x + 80, y: f }] });
  assert.match(clash.join(' '), /overlaps/);
  assert.match(clash.join(' '), /at least 40 px apart/);
});

test('def: a custom course registers under platformer:my-<id>, resolves like an official one, plans from its def and races', () => {
  const def = { ...flow(), name: 'Goblin Gauntlet', gates: [] as PlatformerDef['gates'], bumps: [] as PlatformerDef['bumps'] };
  const id = registerPlatformerDef('abc', def);
  try {
    assert.equal(id, customCourseId('abc'));
    const course = platformerCourse(`platformer:${id}`);
    assert.equal(course.name, 'Goblin Gauntlet');
    assert.equal(platformerCourse(id).name, 'Goblin Gauntlet');
    const plan = planOfficial(course);
    assert.deepEqual(plan.gates, []);
    assert.equal(platformerCourse('platformer:my-unknown').id, platformerCourse('platformer:rolling-hills').id, 'an unknown pick falls back to the first official course');
    const track = buildPlatformerTrack(def.seed, TRACK_THEMES.forest, id);
    assert.deepEqual(track.platformer!.plan.gates, []);
    const rng = mulberry32(777);
    const roster = Array.from({ length: 4 }, (_, i) => ({ id: i, name: AI_NAMES[i], color: AI_COLORS[i], stats: randomStats(rng), isPlayer: false, character: i }));
    const game = new Game(1, roster, { track });
    game.start();
    game.openGate();
    for (let t = 0; t < 240000 && !game.allFinished(); t += PHYSICS_STEP) game.step(PHYSICS_STEP);
    assert.ok(game.finishOrder.length >= 3, `${game.finishOrder.length}/4 finished`);
  } finally { unregisterCustomCourse(id); }
});

// ------------------------------------------------------------------ saving and sharing
import { COURSES_KEY, deleteCourse, loadSavedCourses, saveCourse } from '../src/game/platformer/courses-store';
import { PLATFORMER_CODE_PREFIX, decodePlatformerCode, encodePlatformerCode } from '../src/game/platformer/share';
import { getItem, setItem } from '../src/game/storage';
import { customCourseList } from '../src/game/platformer/course';

test('share code: pf1- round trip is exact, compact, and tampering is refused with a reason', async () => {
  const def = flow();
  const code = await encodePlatformerCode(def);
  assert.ok(code.startsWith(PLATFORMER_CODE_PREFIX));
  assert.ok(code.length < JSON.stringify(def).length, 'deflated');
  assert.deepEqual(await decodePlatformerCode(` ${code}\n`), def);
  await assert.rejects(decodePlatformerCode('1-abc'), /not a platformer course code/);
  await assert.rejects(decodePlatformerCode(PLATFORMER_CODE_PREFIX + 'not base64!'), /characters/);
  await assert.rejects(decodePlatformerCode(PLATFORMER_CODE_PREFIX + 'AAAA'), /damaged/);
  await assert.rejects(decodePlatformerCode(code.slice(0, -12)), /damaged|name|list|must/);
  await assert.rejects(encodePlatformerCode({ ...def, name: '' }), /needs a name/);
});

test('saved courses: save, list, overwrite, delete; each saved course is raceable as platformer:my-<id>', () => {
  setItem(COURSES_KEY, '');
  assert.deepEqual(loadSavedCourses(), []);
  const a = saveCourse({ ...flow(), name: 'First' });
  assert.ok('id' in a);
  if (!('id' in a)) return;
  assert.match(a.id, /^[a-z0-9]{4,24}$/);
  assert.equal(platformerCourse(`platformer:my-${a.id}`).name, 'First');
  const b = saveCourse({ ...blocks(), name: 'Second' });
  assert.ok('id' in b);
  assert.deepEqual(loadSavedCourses().map((c) => c.def.name), ['Second', 'First']);
  const again = saveCourse({ ...flow(), name: 'First, renamed' }, a.id);
  assert.ok('id' in again && again.id === a.id);
  assert.equal(loadSavedCourses().length, 2);
  assert.equal(platformerCourse(`platformer:my-${a.id}`).name, 'First, renamed');
  assert.ok('error' in saveCourse({ ...flow(), name: '' }), 'an invalid course is not saved');
  assert.equal(loadSavedCourses().length, 2);
  assert.ok(deleteCourse(a.id));
  assert.equal(deleteCourse(a.id), false);
  assert.deepEqual(loadSavedCourses().map((c) => c.def.name), ['Second']);
  assert.ok(!customCourseList().some((c) => c.id === `my-${a.id}`), 'a deleted course is gone from the registry');
  // a corrupt entry in storage is dropped, not fatal
  setItem(COURSES_KEY, JSON.stringify([{ id: 'zzzz1234', def: { version: 1, name: 'x' } }, 'junk', ...JSON.parse(getItem(COURSES_KEY)!)]));
  assert.deepEqual(loadSavedCourses().map((c) => c.def.name), ['Second']);
  if ('id' in b) deleteCourse(b.id);
  setItem(COURSES_KEY, '');
});
