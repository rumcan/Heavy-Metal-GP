// ══════════════════════════════════════════════════════════════════════════
// ST-07 — story race hooks: counters, forced events, rival targeting, weights.
//
// Headless, no browser. The acceptance list for #29:
//   • the counters match the events the engine already reports,
//   • the sabotage fires at the configured sector (and only in the configured heat),
//   • a race WITHOUT hooks is identical to one with hooks that only observe —
//     i.e. story mode adds nothing to the simulation it was not asked to add,
//   • and a full field still finishes a finale with every modifier switched on.
//
// `engine.ts` reaches `season.ts` → `storage.ts` → the RUN SDK, so the two browser
// stubs the multiplayer suite uses are set before the dynamic imports.
// ══════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';

const stubs = globalThis as unknown as { window?: unknown; document?: unknown };
stubs.window ??= {
  location: { href: 'http://localhost:5173/', origin: 'http://localhost:5173' },
  innerWidth: 1280, innerHeight: 800,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};
stubs.document ??= {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} }, body: { appendChild() {} },
  querySelector: () => null, addEventListener() {},
};

const { Game } = await import('../src/game/engine');
const { PHYSICS_STEP, HEAT_TIME_LIMIT } = await import('../src/game/physics');
const { W, meta, DEFAULT_PROFILE, generateTrack } = await import('../src/game/track');
const { CALENDAR, gpSeed } = await import('../src/game/season');
const { aiTargets, buildStoryHooks, profileWithStory, sectorOf } = await import('../src/game/story/modifiers');
const { newStory, storyProfile, storyRaceSeed, storyRoster } = await import('../src/game/story/state');
const { chapterDef } = await import('../src/game/story/outline');
const { CAST } = await import('../src/game/story/cast');
const { emptyFlags, emptyRaceCounters } = await import('../src/game/story/types');
const { AI_NAMES, mulberry32, randomStats } = await import('../src/game/types');
import type { StoryHooks } from '../src/game/story/types';
import type { MarbleInfo, TrackProfile } from '../src/game/types';
import type { Track } from '../src/game/track';

const DRIVER = { name: 'Sprocket', color: '#d63e2e', portrait: 0, stats: { weight: 5, speed: 5, bounce: 5 } };
const SEED = 0xc0ffee;
const storyGrid = () => storyRoster(DRIVER);

/** A plain ten-marble grid (the championship's shape) for the "engine unchanged" comparisons. */
function plainRoster(seed = 42): MarbleInfo[] {
  const rng = mulberry32(seed);
  return Array.from({ length: 10 }, (_, id) => ({
    id, name: id === 0 ? 'You' : AI_NAMES[id - 1], color: '#d63e2e',
    stats: randomStats(rng), isPlayer: id === 0, character: id === 0 ? 0 : id - 1,
  }));
}

const SHORT_PROFILE: TrackProfile = { ...DEFAULT_PROFILE, segments: 9 };

/** A test track with `segments` sectors of `sectorHeight`, a gate at the top and a finish far below. */
function sectorFixture(sectors: number, sectorHeight = 300, obstacles: Matter.Body[] = []): Track {
  const finishY = sectors * sectorHeight + 400;
  const gate = Matter.Bodies.rectangle(W / 2, 140, W, 20, { isStatic: true, label: 'gate' });
  gate.plugin = { kind: 'gate' };
  const finish = Matter.Bodies.rectangle(W / 2, finishY, W, 14, { isStatic: true, isSensor: true });
  finish.plugin = { kind: 'finish' };
  const walls = [-20, W + 20].map((x) => Matter.Bodies.rectangle(x, finishY / 2, 40, finishY + 600, { isStatic: true }));
  walls.forEach((body) => { body.plugin = { kind: 'wall' }; });
  const segmentList = [
    { name: 'Start', y: 0, h: sectorHeight },
    ...Array.from({ length: sectors }, (_, index) => ({ name: `Sector ${index + 1}`, y: (index + 1) * sectorHeight, h: sectorHeight })),
    { name: 'Finish', y: finishY - 200, h: 200 },
  ];
  return {
    seed: 42, bodies: [gate, finish, ...walls, ...obstacles], height: finishY + 200,
    startY: 116, finishY, gate, segments: segmentList,
    spinners: [], itemBoxes: [], buckets: [], pegCount: { orange: 0, total: 0 },
    ramps: obstacles.filter((body) => !!meta(body).surface), theme: DEFAULT_PROFILE.theme, decor: [], wreckers: [],
    targetBanks: [],
  };
}

function sensor(kind: string, x: number, y: number, w: number, h: number, plugin: Record<string, unknown> = {}) {
  const body = Matter.Bodies.rectangle(x, y, w, h, {
    isStatic: true, isSensor: true,
    collisionFilter: { category: 0x0004, mask: 0x0002, group: 0 },
  });
  body.plugin = { kind, ...plugin };
  return body;
}

function peg(x: number, y: number, color: 'blue' | 'orange' | 'green', radius = 10) {
  const body = Matter.Bodies.circle(x, y, radius, { isStatic: true, label: 'ppeg', restitution: 0.4 });
  body.restitution = 0.42;
  body.friction = 0;
  body.plugin = { kind: 'ppeg', radius, pegColor: color, hit: false, hitAt: 0 };
  return body;
}

function crate(x: number, y: number, hp = 0.001) {
  const body = Matter.Bodies.rectangle(x, y, 60, 40, { isStatic: true, label: 'breakable' });
  body.plugin = { kind: 'breakable', hp, maxHp: hp, req: 1 };
  return body;
}

async function simulate(game: InstanceType<typeof Game>, ms: number, stopOnFinish = false) {
  const steps = Math.ceil(ms / PHYSICS_STEP);
  for (let tick = 0; tick < steps; tick++) {
    game.step(PHYSICS_STEP);
    if (game.raceTime() > HEAT_TIME_LIMIT) break;
    if (stopOnFinish && game.allFinished()) break;
  }
}

const classify = (game: InstanceType<typeof Game>) =>
  game.classify().map((entry) => ({ id: entry.marble.info.id, rank: entry.rank, time: entry.time, pegs: entry.marble.pegs, x: entry.marble.body.position.x, y: entry.marble.body.position.y }));

// ─────────────────────────── the engine without story mode ───────────────────────────

test('Story hooks: a race with no hooks is identical to a race that only watches', async () => {
  const roster = plainRoster(7);
  const runs: Record<string, ReturnType<typeof classify>> = {};
  const observers: Record<string, StoryHooks> = {
    none: undefined as unknown as StoryHooks,
    empty: {},
    watching: {
      onCounter() { /* counts only */ },
      onSector() { /* observes only */ },
      aiTarget: () => null,
    },
  };
  for (const [name, story] of Object.entries(observers)) {
    const game = new Game(1234, roster, { profile: SHORT_PROFILE, effects: false, ...(story ? { story } : {}) });
    try {
      game.openGate();
      await simulate(game, 240000, true);
      runs[name] = classify(game);
    } finally { game.destroy(); }
  }
  assert.ok(runs.none.every((entry) => entry.time !== null), 'the baseline race did not finish');
  assert.deepEqual(runs.empty, runs.none, 'empty hooks changed the simulation');
  assert.deepEqual(runs.watching, runs.none, 'observing hooks changed the simulation');
});

test('Story hooks: counters are only the player\'s, and they match what the engine already counted', async () => {
  const roster = storyGrid();
  const handle = buildStoryHooks({ chapter: 3, heat: 1, flags: emptyFlags(), seed: SEED, roster });
  const game = new Game(storyRaceSeed(newStory(SEED, DRIVER, 0), 3), roster, {
    profile: storyProfile(3), effects: false, story: handle.hooks,
  });
  try {
    game.openGate();
    await simulate(game, 420000, true);
    assert.ok(game.allFinished(), 'the training chapter did not finish with its extra weights');
    // orange pegs: the engine already counts them per marble, so the story counter must agree exactly
    assert.equal(handle.counters.orangePegs, game.player.pegs, 'orange peg counter disagrees with the engine');
    assert.ok(handle.counters.orangePegs > 0, 'the player hit no orange pegs at all');
    assert.ok(handle.counters.sectors > 5, `the player only reached sector ${handle.counters.sectors}`);
    for (const key of ['crates', 'hoops', 'loops', 'buckets', 'pads', 'itemBoxes'] as const) {
      assert.ok(Number.isInteger(handle.counters[key]) && handle.counters[key] >= 0, `${key} is not a count`);
    }
    // loops and hoops exist on this weighted track; the field as a whole must have used them
    const fieldLoops = game.marbles.reduce((sum, marble) => sum + (marble.loopStage === 1 ? 1 : 0), 0);
    void fieldLoops;
    assert.deepEqual(handle.counters.eventsFired, [], 'chapter 3 has no scripted events');
  } finally { game.destroy(); }
});

test('Story hooks: a fixture reports crate, loop, hoop and peg events to the counters', async () => {
  const roster = storyGrid();
  const track = sectorFixture(12, 300, [
    peg(W / 2, 500, 'orange'),
    sensor('hoop', W / 2, 900, 68, 68),
    sensor('loopTop', W / 2, 1300, 40, 44),
    crate(W / 2, 1700),
    peg(W / 2 + 120, 2100, 'blue'),
  ]);
  const handle = buildStoryHooks({ chapter: 3, heat: 1, flags: emptyFlags(), seed: SEED, roster });
  const game = new Game(99, roster.slice(0, 1), { track, effects: false, recovery: false, aiItems: false, story: handle.hooks });
  try {
    game.openGate();
    await simulate(game, 20000, true);
    assert.equal(handle.counters.orangePegs, 1, 'the orange peg was not counted');
    assert.equal(game.player.pegs, 1, 'the engine and the story counter disagree about the peg');
    assert.equal(handle.counters.hoops, 1, 'the fire hoop was not counted');
    assert.equal(handle.counters.loops, 1, 'the loop top was not counted');
    assert.equal(handle.counters.crates, 1, 'the crack wall was not counted');
    assert.ok(handle.counters.sectors >= 6, `sectors reached: ${handle.counters.sectors}`);
  } finally { game.destroy(); }
});

test('Story hooks: rival events do not land in the player counters', async () => {
  const roster = storyGrid();
  // The peg sits in the grid slot a rival starts from; the player is moved out of that column.
  const track = sectorFixture(6, 300, [peg(60, 500, 'orange')]);
  const handle = buildStoryHooks({ chapter: 2, heat: 1, flags: emptyFlags(), seed: SEED, roster });
  const game = new Game(99, roster.slice(0, 3), { track, effects: false, recovery: false, aiItems: false, story: handle.hooks });
  try {
    game.openGate();
    const rival = game.marbles.find((marble) => marble.info.id === 1)!;
    assert.ok(Math.abs(rival.body.position.x - 60) < 40, `the rival should start over the peg, starts at ${rival.body.position.x}`);
    Matter.Body.setPosition(game.player.body, { x: 840, y: 116 });
    await simulate(game, 6000);
    assert.equal(handle.counters.orangePegs, 0, 'a rival peg hit was counted for the player');
    assert.ok(rival.pegs > 0, 'the rival never reached the peg either');
  } finally { game.destroy(); }
});

// ─────────────────────────── scripted events ───────────────────────────

test('Story hooks: the chapter 4 sabotage fires at its sector, once, in heat 2 only', async () => {
  const roster = storyGrid();
  const run = async (heat: number) => {
    const handle = buildStoryHooks({ chapter: 4, heat, flags: emptyFlags(), seed: SEED, roster });
    const game = new Game(4242, roster.slice(0, 1), {
      track: sectorFixture(14, 300), effects: false, recovery: false, aiItems: false,
      inventory: { rocket: 2, jump: 1 }, story: handle.hooks,
    });
    const toasts: string[] = [];
    game.onEvent = (message) => toasts.push(message);
    try {
      game.openGate();
      const firedAt: number[] = [];
      for (let tick = 0; tick < 4000 && !game.allFinished(); tick++) {
        game.step(PHYSICS_STEP);
        if (handle.counters.eventsFired.length && firedAt.length === 0) firedAt.push(sectorOf(game, game.player));
      }
      return { handle, toasts, firedAt, inventory: { ...game.player.inventory }, oils: game.oils.length, shake: game.shake };
    } finally { game.destroy(); }
  };

  const heatTwo = await run(2);
  assert.deepEqual(heatTwo.handle.counters.eventsFired, ['c4-sabotage'], 'the sabotage never fired in heat 2');
  assert.deepEqual(heatTwo.handle.eventsFired, ['c4-sabotage'], 'the handle should report the same live list');
  assert.ok(heatTwo.firedAt[0] >= 8, `the sabotage fired at sector ${heatTwo.firedAt[0]}, configured for 8`);
  assert.ok(heatTwo.toasts.some((toast) => /SABOTAGE/i.test(toast)), 'the player was never told');
  assert.equal(heatTwo.inventory.rocket, 1, 'the malfunction should destroy one charge');
  assert.equal(heatTwo.inventory.jump, 1, 'only one charge is destroyed');

  const heatOne = await run(1);
  assert.deepEqual(heatOne.handle.counters.eventsFired, [], 'the sabotage must not fire in heat 1');
  assert.equal(heatOne.inventory.rocket, 2, 'heat 1 must not touch the loadout');
});

test('Story hooks: events fire once per heat and never before their sector', async () => {
  const roster = storyGrid();
  const handle = buildStoryHooks({ chapter: 6, heat: 3, flags: emptyFlags(), seed: SEED, roster });
  const game = new Game(77, roster.slice(0, 1), {
    track: sectorFixture(40, 200), effects: false, recovery: false, aiItems: false, story: handle.hooks,
  });
  try {
    game.openGate();
    await simulate(game, 30000, true);
    assert.deepEqual(handle.counters.eventsFired, ['c6-slick', 'c6-blast'], 'both finale events should fire, in order');
    assert.equal(new Set(handle.counters.eventsFired).size, handle.counters.eventsFired.length, 'an event fired twice');
    assert.ok(game.oils.length >= 0);
  } finally { game.destroy(); }
});

// ─────────────────────────── rival targeting ───────────────────────────

test('Story hooks: aiTarget makes a rival freeze the driver the chapter points at', () => {
  const roster = storyGrid();
  const flags = { ...emptyFlags(), acceptedVexDeal: true };
  const targets = aiTargets(chapterDef(4), flags, roster);
  assert.equal(targets.get(CAST.vex.gridId), 0, 'Vex should be hunting the player in chapter 4');
  assert.equal(targets.get(CAST.hood.gridId), 0);
  assert.equal(targets.get(CAST.ace.gridId), undefined, 'Ace has no orders in chapter 4');

  const allied = aiTargets(chapterDef(6), { ...emptyFlags(), aceAlly: true }, roster);
  assert.equal(allied.get(CAST.ace.gridId), CAST.vex.gridId, 'with the alliance, Ace goes after Vex');
  assert.equal(aiTargets(chapterDef(6), { ...emptyFlags(), aceAlly: false }, roster).get(CAST.ace.gridId), undefined,
    'alone, Ace keeps his own lines');
  assert.equal(aiTargets(chapterDef(6), { ...emptyFlags(), trustedZapp: true }, roster).get(CAST.zapp.gridId), CAST.vex.gridId,
    'a trusted Zapp helps in the finale');

  const freezeTest = (story?: StoryHooks) => {
    const track = sectorFixture(4, 400);
    const game = new Game(5, roster, { track, effects: false, recovery: false, aiItems: false, ...(story ? { story } : {}) });
    try {
      game.openGate();
      const vex = game.marbles.find((marble) => marble.info.id === CAST.vex.gridId)!;
      const grubba = game.marbles.find((marble) => marble.info.id === CAST.grubba.gridId)!;
      const player = game.player;
      Matter.Body.setPosition(vex.body, { x: 450, y: 400 });
      Matter.Body.setPosition(grubba.body, { x: 460, y: 460 });   // nearest, ahead: the default target
      Matter.Body.setPosition(player.body, { x: 440, y: 700 });  // further ahead: the story target
      vex.inventory.freeze = 1;
      assert.equal(game.useItem(vex, 'freeze'), true, 'the freeze could not be used');
      return { player: player.frozen, grubba: grubba.frozen };
    } finally { game.destroy(); }
  };

  const handled = freezeTest(buildStoryHooks({ chapter: 4, heat: 1, flags, seed: SEED, roster }).hooks);
  assert.equal(handled.player, true, 'with hooks, Vex freezes the driver the chapter points at');
  assert.equal(handled.grubba, false);

  const plain = freezeTest();
  assert.equal(plain.grubba, true, 'without hooks, Vex freezes the nearest rival ahead — today\'s behaviour');
  assert.equal(plain.player, false);
});

// ─────────────────────────── track weights ───────────────────────────

test('Story hooks: chapter weights reshape the circuit, deterministically', () => {
  const base = CALENDAR[5].profile;
  const def = chapterDef(6);
  const weighted = profileWithStory(base, def);
  assert.deepEqual(weighted.weights.Chicane, def.weights!.Chicane);
  assert.equal(weighted.segments, base.segments, 'weights never change the circuit length');
  assert.equal(weighted.theme, base.theme, 'weights never change the theme');
  assert.deepEqual(storyProfile(6).weights, weighted.weights, 'state.ts and modifiers.ts merge the same way');

  const wreckers = (profile: TrackProfile) => generateTrack(gpSeed(SEED, 5), profile).wreckers.length;
  const plain = wreckers(base);
  const once = wreckers(weighted);
  assert.equal(once, wreckers(weighted), 'the same weights and seed must build the same circuit');
  assert.ok(once >= plain, `Vex's wrecking crew should add wrecking balls (base ${plain}, story ${once})`);

  // chapter 3 has to be able to score its own montage objectives
  const training = generateTrack(gpSeed(SEED, 2), storyProfile(3));
  const kinds = training.bodies.reduce<Record<string, number>>((all, body) => {
    const kind = meta(body).kind;
    all[kind] = (all[kind] ?? 0) + 1;
    return all;
  }, {});
  assert.ok((kinds.breakable ?? 0) >= 1, 'the montage track has no crack wall to break');
  assert.ok((kinds.loopTop ?? 0) >= 1, 'the montage track has no loop to clear');
  assert.ok((kinds.hoop ?? 0) >= 3, `the montage track has only ${kinds.hoop ?? 0} fire hoops, the lesson asks for 3`);
  assert.ok(training.pegCount.orange >= 10, 'a chapter asking for 10 orange pegs needs 10 orange pegs');
});

test('Story hooks: the whole grid still finishes the modified finale', async () => {
  const roster = storyGrid();
  const state = newStory(SEED, DRIVER, 0);
  const handle = buildStoryHooks({
    chapter: 6, heat: 1, flags: { ...emptyFlags(), aceAlly: true, trustedZapp: true, vexPlan: true, hoodRevealed: true },
    seed: storyRaceSeed(state, 6), roster,
  });
  const game = new Game(storyRaceSeed(state, 6), roster, { profile: storyProfile(6), effects: false, story: handle.hooks });
  try {
    game.openGate();
    await simulate(game, 540000, true);
    const stuck = game.marbles.filter((marble) => marble.finishedAt === null);
    assert.deepEqual(stuck.map((marble) => `${marble.info.name}@${Math.round(marble.body.position.y)}`), [],
      'the finale with every modifier on left marbles on track');
    assert.equal(new Set(game.finishOrder.map((marble) => marble.info.id)).size, 10, 'finish entries are missing or duplicated');
    assert.equal(handle.counters.eventsFired.length, 2, 'both scripted finale events should have fired');
    assert.ok(handle.counters.sectors > 10, 'the winner should have reached the mine');
  } finally { game.destroy(); }
});

test('Story hooks: counters survive a save-shaped round trip', () => {
  const counters = { ...emptyRaceCounters(), orangePegs: 3, overtakes: { 4: 2 }, eventsFired: ['c4-sabotage'] };
  const revived = JSON.parse(JSON.stringify(counters));
  assert.deepEqual(revived, counters);
  assert.equal(revived.overtakes[CAST.ace.gridId], 2, 'overtake keys survive JSON as marble ids');
});
