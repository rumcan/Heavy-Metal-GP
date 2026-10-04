// P2-13, rebuilt casual-game style (src/game/story/tutorial.ts). The race freezes on each lesson's spot and only the
// asked-for key goes through; between lessons the ball drives itself at a steady speed. Covered: the step order, the
// freeze rules, input gating, skip, the voice script, the grid, and a full self-driving ride on the Training Grounds
// where every lesson's action (pressed the moment the race freezes) actually clears its obstacle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Matter from 'matter-js';

import {
  TUTORIAL_SEED, TUTORIAL_STEPS, TUTORIAL_VOICE_SET, CRUISE_SPEED,
  allows, autopilot, currentStep, newTutorial, replayTutorial, skipTutorial, speedCap, tutorialFrame, tutorialInput, tutorialRoster,
} from '../src/game/story/tutorial';
import type { TutorialState } from '../src/game/story/tutorial';
import { Game } from '../src/game/engine';
import { PHYSICS_STEP } from '../src/game/physics';
import { TRACK_THEMES, emptyInventory } from '../src/game/types';
import { buildPlatformerTrack } from '../src/game/platformer/build';
import { subtitleText } from '../src/game/voice';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'src/voice/manifests/tutorial.json'), 'utf8')) as { id: string; speaker: string; text: string }[];
const CAST = JSON.parse(readFileSync(path.join(ROOT, 'src/voice/cast.json'), 'utf8')) as Record<string, unknown>;
const driver = { name: 'Sprocket', color: '#d63e2e', portrait: 3, stats: { weight: 5, speed: 5, bounce: 5 } };
const frame = (x: number, more: Partial<{ vx: number; lane: number; gateOpen: boolean; finished: boolean }> = {}) => ({ x, vx: 0, lane: 1, gateOpen: true, finished: false, ...more });

test('steps in course order: fire, roll, engine, skill, crate, gap, lane, door, shortcut, finish', () => {
  assert.deepEqual(TUTORIAL_STEPS.map((s) => s.id), ['fire', 'roll', 'engine', 'skill', 'crate', 'gap', 'lane', 'door', 'shortcut', 'finish']);
  for (const s of TUTORIAL_STEPS) {
    if (s.keys) assert.ok(s.prompt && s.keys.keyboard.length && s.keys.codes.length && s.keys.touch, `${s.id} shows its key`);
    else assert.ok(s.expect === 'lane' || s.expect === 'finish', `${s.id} needs no key`);
  }
});

test('the race freezes on the spot, only the asked-for key goes through, and it unfreezes on it', () => {
  let s = newTutorial();
  assert.equal(autopilot(s), true);
  s = tutorialFrame(s, frame(400, { gateOpen: false }));
  assert.equal(s.frozen, false, 'nothing before the lights go out');
  s = tutorialFrame(s, frame(400));
  assert.equal(s.frozen, true, 'the cannon lesson freezes the moment the gate opens');
  assert.equal(autopilot(s), false, 'frozen: nothing moves');
  for (const wrong of ['right', 'left', 'engine', 'skill'] as const) {
    assert.equal(allows(s, wrong), false, `${wrong} is refused`);
    assert.equal(tutorialInput(s, wrong), s, `${wrong} changes nothing`);
  }
  assert.equal(allows(s, 'jump'), true);
  s = tutorialInput(s, 'jump');
  assert.equal(currentStep(s)?.id, 'roll');
  assert.equal(s.frozen, false);
  assert.equal(allows(s, 'right'), false, 'not frozen yet: the ball is driving itself');
  s = tutorialFrame(s, frame(705));
  assert.ok(s.frozen && allows(s, 'right'));
});

test('jump lessons freeze earlier at speed (the same number of steps before the obstacle)', () => {
  let s = newTutorial();
  while (currentStep(s)?.id !== 'crate') { s = tutorialFrame(s, frame(5000, { lane: 0 })); if (s.frozen) s = tutorialInput(s, currentStep(s)!.expect as 'jump'); }
  const slow = tutorialFrame(s, frame(1240, { vx: 4 }));
  const fast = tutorialFrame(s, frame(1120, { vx: 20 }));
  assert.equal(slow.frozen, false);
  assert.equal(fast.frozen, true, 'a fast ball is stopped further back');
});

test('no-key steps complete on their own: the back lane, and the chequered flag', () => {
  let s: TutorialState = { index: TUTORIAL_STEPS.findIndex((x) => x.id === 'lane'), frozen: false, done: false, skipped: false };
  assert.equal(tutorialFrame(s, frame(3000, { lane: 1 })).index, s.index);
  s = tutorialFrame(s, frame(3000, { lane: 0 }));
  assert.equal(currentStep(s)?.id, 'door');
  s = { index: TUTORIAL_STEPS.length - 1, frozen: false, done: false, skipped: false };
  s = tutorialFrame(s, frame(6000, { finished: true }));
  assert.equal(s.done, true);
});

test('skip ends it at once; replay is a fresh ride', () => {
  const skipped = skipTutorial(tutorialFrame(newTutorial(), frame(10)));
  assert.ok(skipped.done && skipped.skipped && !skipped.frozen && !autopilot(skipped));
  assert.deepEqual(replayTutorial(), newTutorial());
});

test('the self-driving ball cruises, with a taste of speed after the boosts', () => {
  assert.equal(speedCap(1000, null), CRUISE_SPEED);
  assert.ok(speedCap(1500, 1000) > CRUISE_SPEED);
  assert.equal(speedCap(9000, 1000), CRUISE_SPEED);
});

test('a full ride on the Training Grounds: every action, pressed when the race freezes, clears its obstacle', () => {
  const rival = { id: 1, name: 'Rival', color: '#0f0', stats: { weight: 9, speed: 2, bounce: 4 }, isPlayer: false, character: 1 };
  const g = new Game(TUTORIAL_SEED, [{ id: 0, name: 'You', color: '#d63e2e', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true, character: 0 }, rival],
    { track: buildPlatformerTrack(TUTORIAL_SEED, TRACK_THEMES.forest, 'training'), inventory: { ...emptyInventory(), rocket: 3 }, aiItems: false });
  g.healthOn = false;
  g.start();
  const m = g.player;
  let s = newTutorial();
  let boostedAt: number | null = null, engineUntil = -1, onLedge = false, everBack = false;
  const frozenAt: Record<string, number> = {};
  for (let i = 0; i < 20000 && !s.done; i++) {
    if (i === 300) g.openGate();
    s = tutorialFrame(s, { x: m.body.position.x, vx: m.body.velocity.x, lane: m.lane ?? 1, gateOpen: g.gateOpen, finished: m.finishedAt !== null });
    if (s.frozen) {
      const step = currentStep(s)!;
      frozenAt[step.id] = Math.round(m.body.position.x);
      if (step.expect === 'jump') g.jumpPressed = true;
      if (step.expect === 'engine') { engineUntil = g.time + 600; boostedAt = g.time; }
      if (step.expect === 'skill') { g.useItem(m, 'rocket'); boostedAt = g.time; }
      s = tutorialInput(s, step.expect as 'jump');
    }
    g.nudge = autopilot(s) ? 1 : 0;
    g.engineHeld = g.time < engineUntil;
    g.step(PHYSICS_STEP);
    if (autopilot(s)) { const v = m.body.velocity, cap = speedCap(g.time, boostedAt); if (v.x > cap) Matter.Body.setVelocity(m.body, { x: cap, y: v.y }); }
    const p = m.body.position;
    if (p.x > 4130 && p.x < 5000 && p.y < 640) onLedge = true;
    if (m.lane === 0) everBack = true;
  }
  assert.equal(s.done, true, `the ride ends (stuck at ${currentStep(s)?.id})`);
  assert.equal(m.recoveries, 0, 'no crate, gap or ledge was missed (no rescue)');
  assert.ok(m.finishedAt !== null, 'the learner crossed the line');
  assert.ok(everBack, 'the green arrows took the ball to the back lane');
  assert.ok(onLedge, 'the shortcut jump landed on the ledge');
  for (const id of ['fire', 'roll', 'engine', 'skill', 'crate', 'gap', 'door', 'shortcut']) assert.ok(frozenAt[id] !== undefined, `froze for ${id}`);
});

test('voice script: a welcome plus one line per step, the caption is the step text, all in a cast voice', () => {
  assert.ok(MANIFEST.some((l) => l.id === 'tutorial-welcome'));
  for (const s of TUTORIAL_STEPS) {
    const line = MANIFEST.find((l) => l.id === s.line);
    assert.ok(line, `${s.id} has its line ${s.line}`);
    assert.equal(subtitleText(line!.text), s.text);
  }
  for (const l of MANIFEST) { assert.ok(CAST[l.speaker]); assert.ok(l.id.startsWith(`${TUTORIAL_VOICE_SET}-`)); }
});

test('the grid is the player plus exactly two slow rivals', () => {
  const roster = tutorialRoster(driver);
  assert.equal(roster.length, 3);
  assert.equal(roster[0].isPlayer, true);
  for (const rival of roster.slice(1)) assert.ok(rival.stats.speed <= 3);
});
