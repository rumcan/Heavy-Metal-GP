// Run with: node --import tsx --test tests/course-generator.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourse } from '../src/game/course-builder';
import { COURSE_FEATURES, COURSE_LAYOUTS, planCourse } from '../src/game/course-plan';
import type { CourseFeature } from '../src/game/course-plan';
import { Game } from '../src/game/engine';
import { HEAT_TIME_LIMIT, PHYSICS_STEP } from '../src/game/physics';
import type { RampSurface } from '../src/game/physics';
import { CALENDAR } from '../src/game/season';
import { Builder, START_H, generateTrack, meta } from '../src/game/track';
import type { SegmentInfo } from '../src/game/track';
import { buildTrackFromDef, generateTrackDef, validateTrackDef } from '../src/game/trackdef';
import { CIRCUIT_LENGTH_MULTIPLIER, TRACK_THEMES, emptyInventory } from '../src/game/types';
import type { MarbleInfo, MarbleStats, TrackProfile } from '../src/game/types';

const W = 900;
const profile: TrackProfile = { segments: 30, weights: {}, theme: TRACK_THEMES.classic };
const builds: MarbleStats[] = [
  { weight: 3, speed: 9, bounce: 3 }, { weight: 9, speed: 3, bounce: 3 },
  { weight: 3, speed: 3, bounce: 9 }, { weight: 5, speed: 5, bounce: 5 },
  { weight: 1, speed: 10, bounce: 4 }, { weight: 10, speed: 1, bounce: 4 },
  { weight: 1, speed: 4, bounce: 10 }, { weight: 4, speed: 1, bounce: 10 },
  { weight: 10, speed: 4, bounce: 1 }, { weight: 4, speed: 10, bounce: 1 },
];
const roster = (): MarbleInfo[] => builds.map((stats, id) => ({
  id, name: `M${id}`, color: '#fff', stats: { ...stats }, isPlayer: id === 0,
  inventory: emptyInventory(),
}));

test('plans are deterministic, varied and alternate entry sides without mutating the profile', () => {
  const frozen = Object.freeze({ ...profile, weights: Object.freeze({ ...profile.weights }) });
  const sequences = new Set<string>();
  const layouts = new Set<string>();
  for (let seed = 0; seed < 1000; seed++) {
    const plan = planCourse(seed, frozen);
    assert.equal(plan.length, 10);
    assert.deepEqual(planCourse(seed, frozen), plan);
    for (const [i, chapter] of plan.entries()) {
      layouts.add(chapter.layout);
      assert.ok(COURSE_LAYOUTS.includes(chapter.layout));
      assert.ok(COURSE_FEATURES.includes(chapter.feature));
      assert.ok(Number.isInteger(chapter.variant) && chapter.variant >= 0 && chapter.variant < 3);
      assert.equal(chapter.mirror, ((seed & 1) ^ (i & 1)) === 1);
      if (i > 0) assert.notEqual(chapter.layout, plan[i - 1].layout);
    }
    sequences.add(plan.map(c => `${c.layout}:${c.feature}`).join(','));
  }
  assert.deepEqual([...layouts].sort(), [...COURSE_LAYOUTS].sort());
  assert.ok(sequences.size > 900, 'layout/feature sequences must vary, not only mirrors or variants');
});

test('profile lengths produce 8-14 chapters and extend the same seeded prefix', () => {
  for (let count = 8; count <= 14; count++) {
    const p = { ...profile, segments: count * CIRCUIT_LENGTH_MULTIPLIER };
    assert.equal(planCourse(42, p).length, count);
    assert.deepEqual(planCourse(42, p).slice(0, 8), planCourse(42, { ...p, segments: 24 }));
  }
  for (const [segments, expected] of [[0, 8], [-1, 8], [1000, 14], [NaN, 10], [Infinity, 10]]) {
    assert.equal(planCourse(1, { ...profile, segments }).length, expected);
  }
  const heights = [24, 30, 36, 42].map(segments => generateTrack(42, { ...profile, segments }).height);
  assert.ok(heights.every((h, i) => i === 0 || h > heights[i - 1]));
  const counts = CALENDAR.map(gp => planCourse(42, gp.profile).length);
  assert.ok(new Set(counts).size >= 3, 'Grand Prix profiles must not all have the same length');
});

function featureCount(p: TrackProfile, feature: CourseFeature): number {
  let count = 0;
  for (let seed = 0; seed < 256; seed++) count += planCourse(seed, p).filter(c => c.feature === feature).length;
  return count;
}

test('legacy profile weights measurably influence sampled features', () => {
  const cases: [CourseFeature, string][] = [
    ['peggle', 'Peggle Board'], ['ice', 'Ice Slide'], ['machines', 'Spinners'],
    ['banking', 'Curve Drop'], ['boost', 'Splitter'],
  ];
  for (const [feature, key] of cases) {
    const low = featureCount({ ...profile, weights: { [key]: 0 } }, feature);
    const high = featureCount({ ...profile, weights: { [key]: 50 } }, feature);
    assert.ok(high > low * 2, `${key}: ${low} low-weight chapters versus ${high} high-weight chapters`);
  }
  assert.ok(featureCount(CALENDAR[2].profile, 'peggle') > featureCount(CALENDAR[3].profile, 'peggle') * 2);
  assert.ok(featureCount(CALENDAR[3].profile, 'ice') > featureCount(CALENDAR[2].profile, 'ice') * 2);
  assert.ok(featureCount(CALENDAR[5].profile, 'machines') > featureCount(CALENDAR[0].profile, 'machines') * 2);
});

test('disabled choices stay disabled; single-choice and invalid-weight profiles terminate', () => {
  const disabled = Object.fromEntries(COURSE_FEATURES.map(f => [f, 0]));
  for (const feature of COURSE_FEATURES) {
    const p = { ...profile, weights: { ...disabled, [feature]: 1 } };
    for (const seed of [0, 1, 17, 42]) assert.ok(planCourse(seed, p).every(c => c.feature === feature));
  }
  for (const layout of COURSE_LAYOUTS) {
    const p = { ...profile, weights: Object.fromEntries(COURSE_LAYOUTS.map(l => [l, l === layout ? 1 : 0])) };
    assert.ok(planCourse(17, p).every(c => c.layout === layout));
  }
  for (const value of [0, -1, NaN, Infinity]) {
    const weights = Object.fromEntries([...COURSE_FEATURES, ...COURSE_LAYOUTS].map(key => [key, value]));
    const plan = planCourse(17, { ...profile, weights });
    assert.equal(plan.length, 10);
    assert.ok(plan.every(c => c.feature === 'banking' && c.layout === 'sweeper'));
  }
});

const ends = (s: RampSurface) => s.start.y < s.end.y ? [s.start, s.end] : [s.end, s.start];
const within = (s: RampSurface, segment: SegmentInfo) =>
  Math.min(s.start.y, s.end.y) >= segment.y && Math.max(s.start.y, s.end.y) < segment.y + segment.h;

test('actual built surfaces, curve chords, handovers and machine envelopes are safe in both mirrors', () => {
  const covered = new Set<string>();
  for (const gp of CALENDAR) {
    for (let seed = 0; seed < 64; seed++) {
      const b = new Builder(seed);
      b.flip = true;
      const segments = buildCourse(b, seed, gp.profile, START_H);
      const plan = planCourse(seed, gp.profile);
      assert.equal(b.flip, false, 'do not leak the last mirror into finish infrastructure');
      assert.equal(segments.length, plan.length + 2);
      assert.equal(segments[0].name, 'Open grid collector');
      assert.equal(segments.at(-1)!.name, 'Home straight');
      const surfaces = b.bodies.flatMap(body => meta(body).surface ? [meta(body).surface!] : []);
      assert.ok(surfaces.length > plan.length * 3);
      for (const s of surfaces) {
        const dx = Math.abs(s.end.x - s.start.x);
        const dy = Math.abs(s.end.y - s.start.y);
        assert.ok(dx > 0 && dy / dx >= 0.22 - 1e-10, `${gp.short}/${seed}: slope ${dy / dx}`);
        assert.ok(s.normal.y < 0);
        for (const p of [s.start, s.end]) {
          assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
          assert.ok(p.x >= 0 && p.x <= W && p.y >= START_H && p.y < segments.at(-1)!.y + segments.at(-1)!.h);
        }
      }
      for (const [i, segment] of segments.entries()) {
        if (i > 0) assert.equal(segment.y, segments[i - 1].y + segments[i - 1].h);
        const roads = surfaces.filter(s => within(s, segment));
        assert.ok(roads.length > 0);
        if (i > 0 && i <= plan.length) {
          const chapter = plan[i - 1];
          covered.add(`${chapter.layout}:${chapter.feature}:${chapter.mirror}:${chapter.variant}`);
          const entryX = chapter.mirror ? W : 0;
          assert.ok(roads.some(s => ends(s)[0].x === entryX && ends(s)[0].y === segment.y + 40),
            `${gp.short}/${seed}/${chapter.layout}: receiver must meet the wall`);
          const exit = roads.map(s => ends(s)[1]).sort((a, c) => c.y - a.y)[0];
          assert.ok(chapter.mirror ? exit.x <= 200 : exit.x >= 700);
        }
        if (i < segments.length - 1) {
          const exit = roads.map(s => ends(s)[1]).sort((a, c) => c.y - a.y)[0];
          const next = segments[i + 1];
          const receivers = surfaces.filter(s => within(s, next) && ends(s)[0].y < next.y + 300);
          assert.ok(receivers.some(s => exit.x >= s.start.x && exit.x <= s.end.x && ends(s)[0].y > exit.y),
            `${gp.short}/${seed}/${segment.name}: outlet misses the following receiver`);
        }
      }
      for (const body of b.bodies) {
        const md = meta(body);
        if (md.belt) {
          const s = md.surface!;
          assert.equal(Math.sign(md.belt.dir0 * s.tangent.y), 1, 'belt must push downhill after mirroring');
          assert.ok(!md.belt.flipMs, 'belts may not reverse into an uphill stall');
        }
        if (md.motion?.mode === 'sweep') {
          const m = md.motion;
          assert.ok(m.arc >= 0.4 && m.arc <= 2.6);
          const reach = m.arm + (md.radius ?? 16);
          assert.ok(m.pivot.x - reach >= 0 && m.pivot.x + reach <= W);
        }
        if (md.kind === 'spinner' || md.kind === 'ppeg' || md.vortex) {
          const radius = md.vortex?.r ?? md.radius!;
          assert.ok(body.position.x - radius >= 0 && body.position.x + radius <= W);
        }
      }
      const finish = segments.at(-1)!;
      assert.ok(b.bodies.filter(body => body.position.y >= finish.y).every(body => meta(body).kind === 'ramp'),
        'home straight must have no pickups, pegs or machines');
    }
  }
  for (const layout of COURSE_LAYOUTS) {
    for (const feature of COURSE_FEATURES) {
      for (const mirror of [false, true]) {
        for (let variant = 0; variant < 3; variant++) {
          assert.ok(covered.has(`${layout}:${feature}:${mirror}:${variant}`), 'geometry sweep missed a combination');
        }
      }
    }
  }
});

test('recorded layouts validate and reproduce geometry, mirrors, machines and deliberate supplies', () => {
  for (const gp of CALENDAR) {
    for (const seed of [2, 3, 17, 42]) {
      const def = generateTrackDef(seed, gp.profile, gp.short);
      const check = validateTrackDef(def);
      assert.ok(check.ok, check.ok ? '' : check.errors.join('; '));
      const original = generateTrack(seed, gp.profile);
      const rebuilt = buildTrackFromDef(JSON.parse(JSON.stringify(def)));
      assert.deepEqual(rebuilt.segments, original.segments);
      assert.equal(rebuilt.height, original.height);
      assert.equal(rebuilt.bodies.length, original.bodies.length);
      for (const [i, body] of original.bodies.entries()) {
        const other = rebuilt.bodies[i];
        assert.equal(other.label, body.label);
        assert.deepEqual(other.position, body.position);
        assert.equal(other.angle, body.angle);
        assert.deepEqual(other.vertices.map(v => [v.x, v.y]), body.vertices.map(v => [v.x, v.y]));
        assert.deepEqual(meta(other), meta(body));
      }
      const expected = def.pieces.flatMap(p => p.t === 'ppeg' && p.color === 'green' ? [p.item] : []);
      const actual = rebuilt.bodies.map(meta).filter(m => m.pegColor === 'green').map(m => m.itemDrop);
      assert.equal(expected.length, planCourse(seed, gp.profile).length);
      assert.ok(expected.every(item => item !== undefined));
      assert.deepEqual(actual, expected);
    }
  }
});

for (const gp of CALENDAR) {
  for (const seed of [2, 3, 2026]) {
    for (const recovery of [true, false]) {
      test(`${gp.short}/${seed}/recovery=${recovery}: 10 mixed kits, zero stuck events or rescues`,
        { timeout: 120000 }, () => {
          let recoveryEvents = 0;
          let stuckEvents = 0;
          const game = new Game(seed, roster(), {
            profile: gp.profile, recovery, effects: false, aiItems: false,
            onRecover: () => { recoveryEvents++; },
          });
          try {
            game.openGate();
            // Independent clocks still observe stalls when recovery is disabled; final counters alone cannot.
            const probes = game.marbles.map(m => ({
              x: m.body.position.x, y: m.body.position.y, movedAt: game.time,
              depth: m.body.position.y, descendedAt: game.time,
            }));
            const limit = Math.ceil(HEAT_TIME_LIMIT / PHYSICS_STEP);
            for (let tick = 0; tick < limit && !game.allFinished(); tick++) {
              game.step(PHYSICS_STEP);
              for (const [i, m] of game.marbles.entries()) {
                // Observe transient nudges every step: progress can reset the engine's counter later.
                if (m.nudges > 0 || m.recoveries > 0 || recoveryEvents > 0) {
                  assert.fail(`${gp.short}/${seed}: assistance for M${i} at ${JSON.stringify(m.body.position)}`);
                }
                if (m.finishedAt !== null) continue;
                const p = m.body.position;
                assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= W);
                const probe = probes[i];
                if (Math.hypot(p.x - probe.x, p.y - probe.y) >= 26) {
                  probe.x = p.x;
                  probe.y = p.y;
                  probe.movedAt = game.time;
                }
                if (p.y > probe.depth + 16) {
                  probe.depth = p.y;
                  probe.descendedAt = game.time;
                }
                if (game.time - probe.movedAt > 1400 || game.time - probe.descendedAt > 6000) {
                  stuckEvents++;
                  assert.fail(`${gp.short}/${seed}: stuck M${i} at ${JSON.stringify(p)} after ${game.time}ms`);
                }
              }
            }
            assert.ok(game.allFinished(), JSON.stringify(game.marbles.filter(m => m.finishedAt === null)
              .map(m => ({ id: m.info.id, position: m.body.position }))));
            assert.equal(new Set(game.finishOrder.map(m => m.info.id)).size, 10);
            assert.ok(game.marbles.every(m => m.finishedAt !== null && Number.isFinite(m.finishedAt) && m.finishedAt > 0));
            assert.equal(stuckEvents, 0);
            assert.equal(recoveryEvents, 0);
            assert.equal(game.marbles.reduce((sum, m) => sum + m.recoveries, 0), 0);
          } finally {
            game.destroy();
          }
        });
    }
  }
}
