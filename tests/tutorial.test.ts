// P2-13 (#119) — the tutorial lesson state machine (src/game/story/tutorial.ts) and its
// voice manifest. Covers: advance-on-action, NO advance without the action, zone gating,
// the full lesson order, skip, replay, the training roster, and every spoken line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TUTORIAL_LESSONS, TUTORIAL_SEED, TUTORIAL_SHORTCUT, TUTORIAL_VOICE_SET,
  currentLesson, newTutorial, replayTutorial, skipTutorial, tutorialRoster, tutorialStep,
} from '../src/game/story/tutorial';
import type { TutorialFrame, TutorialState } from '../src/game/story/tutorial';
import { planOfficial, PLATFORMER_COURSES } from '../src/game/platformer/course';
import { subtitleText } from '../src/game/voice';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'src/voice/manifests/tutorial.json'), 'utf8')) as
  { id: string; speaker: string; text: string }[];
const CAST = JSON.parse(readFileSync(path.join(ROOT, 'src/voice/cast.json'), 'utf8')) as Record<string, unknown>;

const driver = { name: 'Sprocket', color: '#d63e2e', portrait: 3, stats: { weight: 5, speed: 5, bounce: 5 } };

/** Drive the machine to the lesson with `id`, asserting every lesson before it completes. */
function advanceTo(id: string): TutorialState {
  let state = newTutorial();
  const order = TUTORIAL_LESSONS.map((lesson) => lesson.id);
  for (const next of order) {
    if (next === id) return state;
    state = tutorialStep(state, actionFor(next));
  }
  throw new Error(`no lesson called ${id}`);
}

/** One frame that performs the action a lesson teaches, deep into its trigger zone. */
function actionFor(id: string): TutorialFrame {
  const enter = TUTORIAL_LESSONS.find((lesson) => lesson.id === id)!.enterAt;
  const x = Math.max(enter + 40, 100);
  switch (id) {
    case 'steer': return { x, steerLeft: true, steerRight: true };
    case 'engine': return { x, engineFired: true };
    case 'skills': return { x, skillUsed: true };
    case 'jump': return { x, jumped: true };
    case 'shortcut': return { x, shortcutTaken: true };
    default: return { x: 6000, finished: true };
  }
}

test('tutorial: six lessons in teaching order, each with a voice line and a key prompt', () => {
  assert.deepEqual(TUTORIAL_LESSONS.map((lesson) => lesson.id), ['steer', 'engine', 'skills', 'jump', 'shortcut', 'finish']);
  for (const lesson of TUTORIAL_LESSONS) {
    assert.ok(lesson.line.startsWith(`${TUTORIAL_VOICE_SET}-`), `${lesson.id} speaks a line from the tutorial set`);
    assert.ok(lesson.text.trim(), `${lesson.id} has caption text`);
    if (lesson.id !== 'finish') {
      assert.ok(lesson.keys, `${lesson.id} shows a key prompt`);
      assert.ok(lesson.keys!.keyboard.length > 0, `${lesson.id} names keyboard keys`);
      assert.ok(lesson.keys!.touch.trim(), `${lesson.id} names the touch control`);
    }
  }
  assert.equal(TUTORIAL_LESSONS[TUTORIAL_LESSONS.length - 1].keys, null, 'the finish lesson waits for the race, not a key');
});

test('tutorial: the trigger zones line up with the Training Grounds course, in order', () => {
  const course = PLATFORMER_COURSES.find((c) => c.id === 'training');
  assert.ok(course?.tutorial, 'the tutorial races the Training Grounds');
  const plan = planOfficial(course!);
  for (const lesson of TUTORIAL_LESSONS) {
    assert.ok(lesson.enterAt >= 0 && lesson.enterAt < plan.finishX, `${lesson.id} arms before the finish line`);
  }
  for (let i = 1; i < TUTORIAL_LESSONS.length; i++) {
    assert.ok(TUTORIAL_LESSONS[i].enterAt > TUTORIAL_LESSONS[i - 1].enterAt, 'zones advance along the course');
  }
  assert.ok(TUTORIAL_SHORTCUT.x0 > TUTORIAL_LESSONS.find((l) => l.id === 'jump')!.enterAt, 'the shortcut sits after the gap');
  assert.ok(TUTORIAL_SHORTCUT.x1 < plan.finishX, 'the shortcut ends before the finish');
});

test('tutorial: nothing advances without the action', () => {
  let state = newTutorial();
  for (let i = 0; i < 40; i++) state = tutorialStep(state, { x: 300 + i * 100 });
  assert.equal(currentLesson(state)?.id, 'steer', 'coasting through the course teaches nothing');
  assert.equal(state.completed.length, 0);
  assert.equal(state.done, false);
});

test('tutorial: steering wants BOTH directions before it counts', () => {
  let state = newTutorial();
  state = tutorialStep(state, { x: 600, steerLeft: true });
  assert.equal(currentLesson(state)?.id, 'steer', 'left alone is not steering');
  state = tutorialStep(state, { x: 620 });
  assert.equal(currentLesson(state)?.id, 'steer', 'the progress survives a quiet frame');
  state = tutorialStep(state, { x: 640, steerRight: true });
  assert.equal(currentLesson(state)?.id, 'engine');
  assert.deepEqual([...state.completed], ['steer']);
});

test('tutorial: each lesson advances exactly when its action happens', () => {
  const cases: [string, TutorialFrame][] = [
    ['engine', { x: 900, engineFired: true }],
    ['skills', { x: 1050, skillUsed: true }],
    ['jump', { x: 1600, jumped: true }],
  ];
  for (const [id, frame] of cases) {
    const before = advanceTo(id);
    assert.equal(tutorialStep(before, { x: frame.x }), before, `${id} ignores a frame without the action`);
    const after = tutorialStep(before, frame);
    assert.equal(currentLesson(after)?.id, TUTORIAL_LESSONS[TUTORIAL_LESSONS.findIndex((l) => l.id === id) + 1].id, `${id} completes on its action`);
    assert.equal(after.completed.at(-1), id);
  }
});

test('tutorial: actions before a lesson arms are ignored (zone gating)', () => {
  const state = advanceTo('engine'); // arms at x = 850
  const early = tutorialStep(state, { x: 500, engineFired: true, skillUsed: true, jumped: true });
  assert.equal(early, state, 'signals ahead of the zone do not count');
  const late = tutorialStep(state, { x: 950, engineFired: true });
  assert.equal(currentLesson(late)?.id, 'skills');
});

test('tutorial: the shortcut passes when taken — or when the long way rolls past it', () => {
  const viaLedge = tutorialStep(advanceTo('shortcut'), { x: 4300, shortcutTaken: true });
  assert.equal(currentLesson(viaLedge)?.id, 'finish', 'jumping into the tunnel completes the lesson');

  const longWay = tutorialStep(advanceTo('shortcut'), { x: TUTORIAL_SHORTCUT.x1 + 20 });
  assert.equal(currentLesson(longWay)?.id, 'finish', 'the long way round must not soft-lock the tutorial');

  const waiting = tutorialStep(advanceTo('shortcut'), { x: TUTORIAL_SHORTCUT.x0 + 10 });
  assert.equal(currentLesson(waiting)?.id, 'shortcut', 'inside the section without the ledge, the lesson keeps waiting');
});

test('tutorial: the finish lesson waits for the chequered flag, then the ride is done', () => {
  let state = advanceTo('finish');
  state = tutorialStep(state, { x: 5600 });
  assert.equal(currentLesson(state)?.id, 'finish');
  assert.equal(state.done, false);
  state = tutorialStep(state, { x: 6000, finished: true });
  assert.equal(state.done, true);
  assert.equal(currentLesson(state), null);
  assert.deepEqual([...state.completed], TUTORIAL_LESSONS.map((lesson) => lesson.id));
});

test('tutorial: a finished machine ignores every later frame', () => {
  let state = advanceTo('finish');
  state = tutorialStep(state, { x: 6000, finished: true });
  assert.equal(tutorialStep(state, { x: 200, steerLeft: true, jumped: true, skillUsed: true }), state);
});

test('tutorial: skip completes every lesson at once and is final', () => {
  const skipped = skipTutorial(newTutorial());
  assert.equal(skipped.done, true);
  assert.equal(skipped.skipped, true);
  assert.equal(currentLesson(skipped), null);
  assert.deepEqual([...skipped.completed], TUTORIAL_LESSONS.map((lesson) => lesson.id));
  assert.equal(skipTutorial(skipped), skipped, 'skipping twice changes nothing');
  assert.equal(tutorialStep(skipped, { x: 700, steerLeft: true }), skipped, 'a skipped ride never starts again');
});

test('tutorial: replay hands back a brand-new machine', () => {
  const finished = skipTutorial(newTutorial());
  const replay = replayTutorial();
  assert.deepEqual(replay, newTutorial());
  assert.notDeepEqual(replay, finished);
  assert.equal(currentLesson(replay)?.id, 'steer');
});

test('tutorial manifest: every line has an id, a text and a cast speaker', () => {
  assert.ok(Array.isArray(MANIFEST) && MANIFEST.length >= 7, 'welcome + one line per lesson');
  const seen = new Set<string>();
  for (const line of MANIFEST) {
    assert.match(line.id, /^[a-z0-9-]+$/, `${line.id ?? 'line'} id is kebab-case`);
    assert.ok(!seen.has(line.id), `${line.id} appears once`);
    seen.add(line.id);
    assert.ok(typeof line.speaker === 'string' && CAST[line.speaker], `${line.id} speaks with a cast voice`);
    assert.ok(typeof line.text === 'string' && line.text.trim(), `${line.id} says something`);
    assert.ok(line.text.length <= 400, `${line.id} stays one speakable breath`);
    assert.ok(line.id.startsWith(`${TUTORIAL_VOICE_SET}-`), `${line.id} belongs to the tutorial set`);
  }
});

test('tutorial manifest: every lesson speaks its own line, and the captions match', () => {
  for (const lesson of TUTORIAL_LESSONS) {
    const line = MANIFEST.find((entry) => entry.id === lesson.line);
    assert.ok(line, `lesson ${lesson.id} has a voice line (${lesson.line})`);
    assert.equal(subtitleText(line!.text), lesson.text, `the ${lesson.id} caption is what the narrator says`);
  }
  assert.ok(MANIFEST.some((entry) => entry.id === 'tutorial-welcome'), 'the ride opens with a welcome line');
});

test('tutorial: the grid is the player plus exactly two slow rivals', () => {
  const roster = tutorialRoster(driver);
  assert.equal(roster.length, 3, 'a learner races two rivals, not ten');
  assert.equal(roster[0].isPlayer, true);
  assert.deepEqual(roster.map((m) => m.id), [0, 1, 2], 'grid ids stay unique and in order');
  for (const rival of roster.slice(1)) {
    assert.equal(rival.isPlayer, false);
    assert.equal(rival.stats.weight + rival.stats.speed + rival.stats.bounce, 15, 'AI stats stay on budget');
    assert.ok(rival.stats.speed <= 3, `${rival.name} is slow enough to learn behind`);
  }
  assert.ok(Number.isInteger(TUTORIAL_SEED) && TUTORIAL_SEED > 0, 'the tutorial seed is fixed');
});
