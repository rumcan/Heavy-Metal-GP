// ══════════════════════════════════════════════════════════════════════════
// ST-02 — the story engine: progress, triggers, branching and objectives.
//
// The acceptance list for #24, and the "reachable in engine tests" clauses of
// #26/#27/#28: whole stories are walked with scripted results (all wins, all
// losses, mixed), the ending is asserted every time, every scene in the outline
// is reached by some script, every flag combination gets a valid epilogue, and
// a save survives a reload with chapter, heat, flags and seen scenes intact.
//
// Pure data: no physics, no browser. `state.ts` reaches the RUN SDK through
// `storage.ts`, so the same two `window`/`document` stubs the multiplayer suite
// uses are set before the dynamic import below.
// ══════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const {
  STORY_KEY, chapterUnlocked, chaptersCleared, clearStory, loadStory, newStory, parseStory, saveStory,
  startReplay, storyPosition, storyProfile, storyRaceSeed, storyRoster, activeFlags, applyChoice, markSceneSeen,
} = await import('../src/game/story/state');
const {
  addCounters, chapterTitle, countersWithRanks, endingOf, evaluateHeat, evaluateObjectives, markScenePlayed,
  mergeObjectives, nextScene, nextScenes, objectiveChips, playerResult, settleHeat, storyBeats, triggerOutcome,
} = await import('../src/game/story/engine');
const { CHAPTERS, SCENES, SCENE_BY_ID, chapterDef, chapterSceneIds } = await import('../src/game/story/outline');
const { CAST, STORY_GRID } = await import('../src/game/story/cast');
const { CALENDAR, loadSeason, saveSeason, newSeason } = await import('../src/game/season');
const { HEATS_PER_GP } = await import('../src/game/types');
const types = await import('../src/game/story/types');

import type { StoryState, StoryDriver } from '../src/game/story/state';
import type { ChapterNumber, EndingId, FlagMap, RaceCounters, StoryFlag, StoryOutcome, Trigger } from '../src/game/story/types';
import type { HeatResult } from '../src/game/types';

const {
  ENDINGS, STORY_FLAGS, emptyFlags, emptyRaceCounters, endingForPosition, triggerForOutcome,
} = types;

const DRIVER: StoryDriver = { name: 'Sprocket', color: '#d63e2e', portrait: 0, stats: { weight: 5, speed: 5, bounce: 5 } };
const SEED = 0x5eed1234;
const CHAPTERS_ALL = [1, 2, 3, 4, 5, 6] as const;

// ─────────────────────────── scripted races ───────────────────────────

/** A full ten-marble classification with the player at `playerRank`, or last with a DNF. */
function classification(playerRank: number | null): HeatResult[] {
  const rivals = STORY_GRID.map((id) => CAST[id].gridId).filter((id) => id !== 0);
  const order = playerRank === null
    ? [...rivals, 0]
    : [...rivals.slice(0, playerRank - 1), 0, ...rivals.slice(playerRank - 1)];
  return order.map((id, index) => ({
    id,
    rank: index + 1,
    time: id === 0 && playerRank === null ? null : 30000 + index * 700,
    pegs: id === 0 ? 12 : 4,
  }));
}

/** Counters as if every lesson had been taken, and the chapter 4 sabotage fired in heat 2. */
function richCounters(chapter: number, heat: number): RaceCounters {
  return {
    ...emptyRaceCounters(),
    orangePegs: 14, crates: 2, hoops: 4, loops: 2, buckets: 2, pads: 2, itemBoxes: 3,
    overtakes: { [CAST.ace.gridId]: 2, [CAST.vex.gridId]: 1 },
    eventsFired: chapter === 4 && heat === 2 ? ['c4-sabotage'] : [],
    sectors: 30,
  };
}

const dryCounters = (): RaceCounters => emptyRaceCounters();

interface Script {
  name: string;
  rank: (chapter: number, heat: number) => number | null;
  counters: (chapter: number, heat: number) => RaceCounters;
  choices: Partial<Record<StoryFlag, boolean>>;
  /** Cold-start replay of one chapter (chapter select on a fresh save). */
  replayChapter?: number;
}

interface WalkResult {
  state: StoryState;
  played: string[];
  beats: { chapter: number; heat: number; atSector: number; text: string }[];
  endings: (EndingId | null)[];
  positions: (number | null)[];
  flagsSet: StoryFlag[];
  choices: string[];
  heats: number;
}

function pickOption(scene: { choice?: { options: readonly { label: string; set: StoryFlag; value?: boolean; when?: unknown }[] } }, choices: Script['choices']) {
  const options = scene.choice?.options ?? [];
  const wanted = options.find((option) => choices[option.set] !== undefined && (choices[option.set] ?? true) === (option.value ?? true));
  return wanted ?? options[0];
}

/** Play a whole story (or one replayed chapter) exactly the way the story screen does. */
function walk(script: Script): WalkResult {
  let state = newStory(SEED, DRIVER, 1_700_000_000_000);
  if (script.replayChapter) state = startReplay(state, script.replayChapter as ChapterNumber);
  const played: string[] = [];
  const beats: WalkResult['beats'] = [];
  const endings: (EndingId | null)[] = [];
  const positions: (number | null)[] = [];
  const flagsSet: StoryFlag[] = [];
  const choicesMade: string[] = [];
  let heats = 0;

  const drain = (trigger: Trigger, outcome: StoryOutcome | null, chapter: number) => {
    for (let guard = 0; guard < 60; guard++) {
      const scene = nextScene(state, trigger, outcome, chapter);
      if (!scene) return;
      played.push(scene.id);
      state = markScenePlayed(state, scene);
      if (scene.choice) {
        const option = pickOption(scene, script.choices);
        choicesMade.push(`${scene.id}:${option.label}`);
        state = applyChoice(state, option.set, option.value ?? true);
      }
    }
    throw new Error(`scene queue for ${trigger} in chapter ${chapter} did not terminate`);
  };

  const chapters = script.replayChapter ? [script.replayChapter] : [...CHAPTERS_ALL];
  for (const chapter of chapters) {
    for (let heat = 1; heat <= HEATS_PER_GP; heat++) {
      drain('intro', null, chapter);
      drain('pre-race', null, chapter);
      // Mid-race scenes are not "played" and marked seen: they fire as bubbles in every heat of the chapter.
      for (const scene of nextScenes(state, 'mid-race', null, chapter)) played.push(scene.id);
      for (const beat of storyBeats(chapter, state.flags)) {
        beats.push({ chapter, heat, atSector: beat.atSector, text: beat.line.text });
      }
      const results = classification(script.rank(chapter, heat));
      const counters = script.counters(chapter, heat);
      heats++;
      if (script.replayChapter) {
        const evaluated = evaluateHeat(chapterDef(chapter), results, counters);
        drain(triggerForOutcome(evaluated.outcome), evaluated.outcome, chapter);
        if (heat === HEATS_PER_GP) drain('outro', null, chapter);
        continue;
      }
      const settlement = settleHeat(state, results, counters);
      state = settlement.state;
      flagsSet.push(...settlement.flagsSet);
      positions.push(settlement.position);
      endings.push(settlement.ending);
      drain(settlement.trigger, settlement.outcome, settlement.chapterRaced);
      if (settlement.chapterDone || settlement.storyDone) drain('outro', null, settlement.chapterRaced);
    }
  }
  return { state, played, beats, endings, positions, flagsSet, choices: choicesMade, heats };
}

const SCRIPTS: Script[] = [
  { name: 'all wins / signed / trusted Zapp / allied with Ace', rank: () => 1, counters: richCounters, choices: { acceptedVexDeal: true, trustedZapp: true, aceAlly: true } },
  { name: 'all wins / refused Vex / blamed Zapp / raced alone', rank: () => 1, counters: richCounters, choices: { refusedVex: true, blamedZapp: true, aceAlly: false } },
  { name: 'all podiums / signed / trusted Zapp / alone', rank: (chapter, heat) => (heat % 2 ? 2 : 3), counters: richCounters, choices: { acceptedVexDeal: true, trustedZapp: true, aceAlly: false } },
  { name: 'all podiums / refused / blamed Zapp / allied', rank: (chapter, heat) => (heat % 2 ? 3 : 2), counters: dryCounters, choices: { refusedVex: true, blamedZapp: true, aceAlly: true } },
  { name: 'all losses / signed / trusted Zapp / allied', rank: (chapter, heat) => (heat === 2 ? null : 8), counters: richCounters, choices: { acceptedVexDeal: true, trustedZapp: true, aceAlly: true } },
  { name: 'all losses / refused / blamed Zapp / alone', rank: () => 9, counters: dryCounters, choices: { refusedVex: true, blamedZapp: true, aceAlly: false } },
  { name: 'mixed: rookie wins, rise, then the fall', rank: (chapter) => (chapter <= 2 ? 1 : chapter <= 4 ? 3 : 7), counters: richCounters, choices: { acceptedVexDeal: true, trustedZapp: true, aceAlly: true } },
  { name: 'mixed: slow start, podium at the finale', rank: (chapter) => (chapter <= 3 ? 6 : 2), counters: dryCounters, choices: { refusedVex: true, blamedZapp: true, aceAlly: false } },
  { name: 'mixed: one win, one DNF, the rest midfield', rank: (chapter, heat) => (heat === 1 && chapter % 2 ? 1 : heat === 3 ? null : 5), counters: richCounters, choices: { acceptedVexDeal: true, trustedZapp: true, aceAlly: true } },
  { name: 'every heat a DNF', rank: () => null, counters: dryCounters, choices: { refusedVex: true, blamedZapp: true, aceAlly: false } },
];
const ALL_DNF = SCRIPTS[SCRIPTS.length - 1];

const COLD_STARTS: Script[] = [3, 5, 6].map((chapter) => ({
  name: `cold start: chapter ${chapter} only`,
  rank: (c: number, heat: number) => (heat === 2 ? 4 : 2),
  counters: dryCounters,
  choices: {},
  replayChapter: chapter,
}));

// ─────────────────────────── the whole story, walked ───────────────────────────

test('Story engine: every scripted season reaches the ending its results earned', () => {
  for (const script of SCRIPTS) {
    const run = walk(script);
    assert.equal(run.heats, 18, `${script.name}: a season is 18 heats`);
    assert.equal(run.state.season.complete, true, `${script.name}: the season never finished`);
    assert.ok(run.state.ending, `${script.name}: no ending was chosen`);
    const position = storyPosition(run.state)!;
    assert.equal(run.state.ending, endingForPosition(position), `${script.name}: ending does not match P${position}`);
    assert.equal(run.endings.filter(Boolean).length, 1, `${script.name}: the ending was decided more than once`);
    assert.equal(run.state.chapter, 6, `${script.name}: the story did not reach the finale chapter`);
    assert.equal(run.state.heat, HEATS_PER_GP, `${script.name}: heat counter did not close the finale`);
    assert.ok(run.state.finishedAt, `${script.name}: finishedAt was never set`);
  }
});

test('Story engine: all wins is champion, all losses is heartbreak, all podiums is bittersweet', () => {
  const champion = walk(SCRIPTS[0]);
  assert.equal(champion.state.ending, 'champion');
  assert.equal(storyPosition(champion.state), 1);
  assert.ok(champion.played.includes('c6-end-champion'), 'the champion epilogue never played');

  const heartbreak = walk(SCRIPTS[5]);
  assert.equal(heartbreak.state.ending, 'heartbreak');
  assert.ok(heartbreak.played.includes('c6-end-heartbreak'), 'the heartbreak epilogue never played');

  const bittersweet = walk(SCRIPTS[2]);
  assert.equal(bittersweet.state.ending, 'bittersweet');
  assert.equal(storyPosition(bittersweet.state), 2);
  assert.ok(bittersweet.played.includes('c6-end-bittersweet'), 'the bittersweet epilogue never played');
});

test('Story engine: every scene in the outline is reachable by some script', () => {
  const reached = new Set<string>();
  for (const script of [...SCRIPTS, ...COLD_STARTS]) for (const id of walk(script).played) reached.add(id);
  // The epilogue families are enumerated exhaustively below, so count them as reached here too.
  for (const scene of SCENES) if (scene.ending) for (const combo of epilogueCombinations()) {
    const state = epilogueState(combo.ending, combo.flags);
    for (const selected of nextScenes(state, 'outro', null, 6)) reached.add(selected.id);
  }
  const missing = SCENES.map((scene) => scene.id).filter((id) => !reached.has(id));
  assert.deepEqual(missing, [], `unreachable scenes: ${missing.join(', ')}`);
  assert.ok(reached.size >= SCENES.length);
});

test('Story engine: choices, flags and objectives are all reachable in both directions', () => {
  const signed = walk(SCRIPTS[0]);
  const refused = walk(SCRIPTS[1]);
  assert.equal(signed.state.flags.acceptedVexDeal, true, 'signing the contract did not set acceptedVexDeal');
  assert.equal(signed.state.flags.refusedVex, false);
  assert.equal(refused.state.flags.refusedVex, true, 'walking out did not set refusedVex');
  assert.equal(refused.state.flags.acceptedVexDeal, false);
  assert.ok(signed.played.includes('c4-post-win-deal') && refused.played.includes('c4-post-win-free'),
    'both Act II deal branches must reach the post-race scenes');
  assert.ok(signed.played.some((id) => id.startsWith('c5-')) && refused.played.some((id) => id.startsWith('c6-')),
    'both deal branches must reach Act III');

  const trusted = walk(SCRIPTS[2]);
  const blamed = walk(SCRIPTS[3]);
  assert.equal(trusted.state.flags.trustedZapp, true);
  assert.equal(blamed.state.flags.blamedZapp, true);
  assert.ok(trusted.played.includes('c4-outro-zapp-trust') && blamed.played.includes('c4-outro-zapp-blame'));
  assert.ok(trusted.state.ending && blamed.state.ending, 'both Zapp branches must reach an ending');
  assert.ok(trusted.played.includes('c6-intro-zapp'), 'trusting Zapp should pay off in Act III');

  const allied = walk(SCRIPTS[0]);
  const alone = walk(SCRIPTS[1]);
  assert.equal(allied.state.flags.aceAlly, true);
  assert.equal(alone.state.flags.aceAlly, false);
  assert.ok(allied.played.includes('c6-pre-ally') && alone.played.includes('c6-pre-alone'));
  assert.ok(allied.played.includes('c6-end-champion-ace'), 'the ally epilogue should play for the allied run');
  assert.ok(!alone.played.some((id) => id.includes('-end-') && id.endsWith('-ace')), 'a lone wolf gets no ally epilogue');
});

test('Story engine: objective flags follow the scripted counters', () => {
  const rich = walk(SCRIPTS[0]);
  for (const flag of ['beatAceEarly', 'streetSmart', 'trainingDone', 'sabotaged', 'vexExposed'] as StoryFlag[]) {
    assert.equal(rich.state.flags[flag], true, `${flag} should be set when the counters deliver`);
  }
  assert.ok(rich.played.includes('c2-pre-ace-wary'), 'beating Ace early should change chapter 2');
  assert.ok(rich.played.includes('c3-pre-smart'), 'street smarts should change chapter 3');
  assert.ok(rich.played.includes('c4-pre-trained'), 'the training should change chapter 4');
  assert.ok(rich.played.includes('c4-outro-sabotage'), 'the sabotage should leave evidence');

  const dry = walk(SCRIPTS[5]);
  for (const flag of ['beatAceEarly', 'streetSmart', 'trainingDone', 'sabotaged', 'vexExposed'] as StoryFlag[]) {
    assert.equal(dry.state.flags[flag], false, `${flag} must not be set when the counters deliver nothing`);
  }
  assert.equal(dry.state.flags.smokeyProud, true, 'finishing the finale, even last, is still the finale');

  // A season where nothing ever crossed the line: no bonus flags at all, and no mentor epilogue.
  const dnf = walk(ALL_DNF);
  assert.equal(dnf.state.ending, 'heartbreak', 'a season of DNFs is the heartbreak ending');
  const earned = ['metSmokey', 'hoodSeen', 'hoodRevealed', 'vexPlan', 'refusedVex', 'blamedZapp', 'midpointCrash', 'smokeyInjured', 'hoodRedeemed'];
  for (const flag of STORY_FLAGS.filter((name) => !earned.includes(name))) {
    assert.equal(dnf.state.flags[flag], false, `${flag} must not be set when nothing was ever finished`);
  }
  assert.ok(!dnf.played.some((id) => id.includes('-end-') && id.includes('smokey')), 'no pride, no mentor epilogue');
  assert.ok(dnf.played.includes('c6-end-heartbreak'), 'the heartbreak epilogue still plays');
});

test('Story engine: mid-race beats come from the script, in sector order, per chapter', () => {
  const run = walk(SCRIPTS[0]);
  assert.ok(run.beats.length >= 6, 'expected at least one mid-race bubble per chapter');
  for (const chapter of CHAPTERS_ALL) {
    for (let heat = 1; heat <= HEATS_PER_GP; heat++) {
      const beats = run.beats.filter((beat) => beat.chapter === chapter && beat.heat === heat);
      assert.ok(beats.length > 0, `chapter ${chapter} heat ${heat} has no mid-race bubble`);
      const sectors = beats.map((beat) => beat.atSector);
      assert.deepEqual(sectors, [...sectors].sort((a, b) => a - b), 'beats must be offered in sector order');
      assert.ok(sectors.every((sector) => sector >= 1 && sector < 60), 'a beat fired outside the circuit');
    }
  }
});

test('Story engine: a cold-start replay never touches the saved run', () => {
  for (const script of COLD_STARTS) {
    const run = walk(script);
    assert.equal(run.state.replaying, true);
    assert.equal(run.state.season.complete, false, 'a replay must not finish the season');
    assert.equal(run.state.chapter, script.replayChapter, 'a replay must stay in its chapter');
    assert.equal(run.endings.every((ending) => ending === null), true, 'a replay must not choose an ending');
    saveStory(run.state);
    assert.equal(loadStory(), null, 'a replaying state must never be written to the device cache');
  }
  const coldSix = walk(COLD_STARTS[2]);
  assert.ok(coldSix.played.includes('c6-intro-blind'), 'a cold start at the finale has no plan, and must say so');
  const coldThree = walk(COLD_STARTS[0]);
  assert.ok(coldThree.played.includes('c3-intro-alone'), 'a cold start never met Smokey, and must have a variant');
});

// ─────────────────────────── epilogues for every flag combination ───────────────────────────

const EPILOGUE_FLAGS = ['aceAlly', 'acceptedVexDeal', 'vexExposed', 'hoodRedeemed', 'smokeyProud', 'smokeyInjured'] as const;

function epilogueCombinations(): { ending: EndingId; flags: FlagMap; label: string }[] {
  const out: { ending: EndingId; flags: FlagMap; label: string }[] = [];
  for (const ending of ENDINGS) {
    for (let bits = 0; bits < 1 << EPILOGUE_FLAGS.length; bits++) {
      const flags = emptyFlags();
      const label: string[] = [];
      EPILOGUE_FLAGS.forEach((flag, index) => {
        const on = (bits & (1 << index)) !== 0;
        flags[flag] = on;
        if (on) label.push(flag);
      });
      out.push({ ending, flags, label: label.join('+') || 'no flags' });
    }
  }
  return out;
}

function epilogueState(ending: EndingId, flags: FlagMap): StoryState {
  const state = newStory(SEED, DRIVER, 0);
  return { ...state, chapter: 6, heat: HEATS_PER_GP, flags, ending, finishedAt: 1 };
}

test('Story engine: every ending and every flag combination gets a valid epilogue', () => {
  let checked = 0;
  for (const combo of epilogueCombinations()) {
    const state = epilogueState(combo.ending, combo.flags);
    const scenes = nextScenes(state, 'outro', null, 6).filter((scene) => scene.ending);
    assert.ok(scenes.length >= 1, `${combo.ending} / ${combo.label}: no epilogue at all`);
    assert.equal(scenes[0].id, `c6-end-${combo.ending}`, `${combo.ending} / ${combo.label}: the base epilogue must come first`);
    for (const scene of scenes) assert.equal(scene.ending, combo.ending, `${combo.ending} / ${combo.label}: ${scene.id} belongs to another ending`);
    const lines = scenes.flatMap((scene) => scene.lines).length;
    assert.ok(lines >= 4, `${combo.ending} / ${combo.label}: only ${lines} epilogue lines (need 4-8+)`);
    assert.ok(scenes.every((scene) => scene.chapter === 6 && scene.trigger === 'outro'));
    checked += scenes.length;
  }
  assert.equal(checked >= ENDINGS.length * 64, true, 'the epilogue matrix was not fully walked');
  // and the flag-gated variants really do change what plays
  const base = nextScenes(epilogueState('champion', emptyFlags()), 'outro', null, 6).filter((scene) => scene.ending).map((scene) => scene.id);
  const everything = (() => { const flags = emptyFlags(); for (const flag of EPILOGUE_FLAGS) flags[flag] = true; return nextScenes(epilogueState('champion', flags), 'outro', null, 6).filter((scene) => scene.ending).map((scene) => scene.id); })();
  assert.ok(everything.length > base.length, 'flag-gated epilogues should add scenes');
  assert.deepEqual(base, ['c6-end-champion']);
});

test('Story engine: the reveal is the hinge between the hidden and revealed Hood', () => {
  const run = walk(SCRIPTS[0]);
  const revealAt = run.played.indexOf('c5-intro-mine');
  assert.ok(revealAt > 0, 'the reveal never played');
  assert.equal(run.state.flags.hoodRevealed, true);
  assert.equal(run.state.flags.vexPlan, true, 'the outro of chapter 5 must explain the rig');
  const before = run.played.slice(0, revealAt).map((id) => SCENE_BY_ID[id]!);
  const reveal = SCENE_BY_ID['c5-intro-mine']!;
  assert.ok(reveal.lines.some((line) => line.who === 'hood') && reveal.lines.some((line) => line.who === 'hood-revealed'),
    'the reveal scene turns the hidden Hood into the revealed one');
  const after = run.played.slice(revealAt + 1).map((id) => SCENE_BY_ID[id]!);
  assert.ok(before.every((scene) => scene.lines.every((line) => line.who !== 'hood-revealed')));
  assert.ok(after.every((scene) => scene.lines.every((line) => line.who !== 'hood')));
});

// ─────────────────────────── objectives ───────────────────────────

test('Objectives: rank, finish, counter and ahead all score a single heat', () => {
  const def = chapterDef(3);
  const results = classification(2);
  const counters = countersWithRanks({ ...emptyRaceCounters(), crates: 1, loops: 1, hoops: 2 }, results);
  const outcomes = evaluateObjectives(def, playerResult(results), counters);
  const byId = Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome]));
  assert.equal(byId['c3-crate'].met, true, 'one crate meets the crate lesson');
  assert.equal(byId['c3-loop'].met, true);
  assert.equal(byId['c3-hoops'].met, false, 'two hoops is not three');
  assert.equal(byId['c3-hoops'].progress, 2);
  assert.equal(byId['c3-hoops'].target, 3);

  const dnf = evaluateObjectives(chapterDef(1), playerResult(classification(null)), countersWithRanks(emptyRaceCounters(), classification(null)));
  assert.equal(dnf.find((outcome) => outcome.id === 'c1-finish')!.met, false, 'a DNF never finishes');
  assert.equal(dnf.find((outcome) => outcome.id === 'c1-ace')!.met, false, 'a DNF is ahead of nobody');

  const ahead = evaluateObjectives(chapterDef(1), playerResult(classification(1)), countersWithRanks(emptyRaceCounters(), classification(1)));
  assert.equal(ahead.find((outcome) => outcome.id === 'c1-ace')!.met, true, 'P1 is ahead of Ace');
  const behind = evaluateObjectives(chapterDef(1), playerResult(classification(9)), countersWithRanks(emptyRaceCounters(), classification(9)));
  assert.equal(behind.find((outcome) => outcome.id === 'c1-ace')!.met, false, 'P9 is behind Ace');
});

test('Objectives: chapter scope adds up, heat scope keeps the best single heat', () => {
  const def = chapterDef(3);
  const perHeat = (crates: number, hoops: number) =>
    evaluateObjectives(def, playerResult(classification(4)), countersWithRanks({ ...emptyRaceCounters(), crates, hoops, loops: 0 }, classification(4)));
  const merged = mergeObjectives(def, [], perHeat(1, 1));
  const twice = mergeObjectives(def, merged, perHeat(0, 2));
  assert.equal(twice.find((outcome) => outcome.id === 'c3-crate')!.progress, 1, 'chapter scope accumulates');
  assert.equal(twice.find((outcome) => outcome.id === 'c3-hoops')!.progress, 2, 'heat scope keeps the best heat, not the sum');
  assert.equal(twice.find((outcome) => outcome.id === 'c3-hoops')!.met, false);
  const third = mergeObjectives(def, twice, perHeat(0, 3));
  assert.equal(third.find((outcome) => outcome.id === 'c3-hoops')!.met, true, 'three hoops in one heat completes the lesson');
  // failing never blocks: the chapter still advances
  assert.equal(third.every((outcome) => typeof outcome.met === 'boolean'), true);
});

test('Objectives: addCounters accumulates a chapter and keeps the latest classification', () => {
  const a = { ...emptyRaceCounters(), orangePegs: 4, overtakes: { 4: 1 }, rivalRanks: { 4: 2 }, eventsFired: ['x'] };
  const b = { ...emptyRaceCounters(), orangePegs: 6, overtakes: { 4: 2, 2: 1 }, rivalRanks: { 4: 5 }, eventsFired: ['y'] };
  const summed = addCounters(a, b);
  assert.equal(summed.orangePegs, 10);
  assert.equal(summed.overtakes[4], 3);
  assert.equal(summed.overtakes[2], 1);
  assert.equal(summed.rivalRanks[4], 5, 'ranks are the latest heat, not a sum');
  assert.deepEqual(summed.eventsFired, ['x', 'y']);
});

test('Objectives: HUD chips show progress, and met objectives earn their flags', () => {
  const run = walk(SCRIPTS[0]);
  const chips = objectiveChips(run.state, 3);
  assert.equal(chips.length, chapterDef(3).objectives.length);
  assert.ok(chips.every((chip) => chip.met), 'a clean sweep should complete the montage');
  assert.equal(run.state.flags.trainingDone, true, 'the montage flag comes from the chapter completeFlag');
  assert.equal(run.state.flags.smokeyProud, true, 'finishing the finale makes Smokey proud');
});

// ─────────────────────────── chapters, season, saves ───────────────────────────

test('Story state: a new run is chapter one, heat zero, no flags, and its own season', () => {
  const state = newStory(SEED, DRIVER, 42);
  assert.equal(state.chapter, 1);
  assert.equal(state.heat, 0);
  assert.deepEqual(state.seenScenes, []);
  assert.deepEqual(activeFlags(state), []);
  assert.equal(state.season.seed, SEED, 'the story season derives from the story seed, not Math.random()');
  assert.equal(state.season.roster.length, 10);
  assert.equal(state.season.roster.find((marble) => marble.isPlayer)!.id, 0);
  assert.deepEqual(state.season.roster.map((marble) => marble.id), STORY_GRID.map((id) => CAST[id].gridId));
  assert.equal(state.season.round, 0);
  assert.equal(state.ending, null);
  assert.equal(storyPosition(state), null, 'nobody has points yet');
  assert.equal(chaptersCleared(state), 0);
  assert.equal(chapterUnlocked(state, 1), true);
  assert.equal(chapterUnlocked(state, 3), false);
  assert.equal(state.startedAt, 42);
  // a deterministic roster: same seed and driver, same grid
  assert.deepEqual(storyRoster(DRIVER), storyRoster(DRIVER));
});

test('Story state: heats advance inside a chapter, then the chapter advances', () => {
  let state = newStory(SEED, DRIVER, 0);
  for (let heat = 1; heat <= HEATS_PER_GP; heat++) {
    const settlement = settleHeat(state, classification(heat === 3 ? 1 : 3));
    state = settlement.state;
    if (heat < HEATS_PER_GP) {
      assert.equal(state.chapter, 1, `heat ${heat} should stay in chapter 1`);
      assert.equal(state.heat, heat);
      assert.equal(settlement.chapterDone, false);
    } else {
      assert.equal(state.chapter, 2, 'the third heat opens the next chapter');
      assert.equal(state.heat, 0);
      assert.equal(settlement.chapterDone, true);
      assert.equal(settlement.chapterRaced, 1, 'the settlement reports the chapter that was raced');
      assert.equal(chapterUnlocked(state, 2), true);
    }
  }
  assert.equal(state.season.results[0].length, HEATS_PER_GP);
  assert.equal(chaptersCleared(state), 1);
});

test('Story state: a DNF scores nothing but still moves the story on', () => {
  let state = newStory(SEED, DRIVER, 0);
  const settlement = settleHeat(state, classification(null));
  assert.equal(settlement.outcome, 'loss');
  assert.equal(settlement.trigger, 'post-loss');
  assert.equal(settlement.player.time, null);
  state = settlement.state;
  assert.equal(state.heat, 1, 'a DNF is still a finished heat');
  assert.equal(state.season.results[0][0].find((result) => result.id === 0)!.time, null);
});

test('Story state: the story save is its own record and never touches the championship save', () => {
  clearStory();
  const before = loadSeason();
  let state = newStory(SEED, DRIVER, 7);
  state = settleHeat(state, classification(2)).state;
  state = markSceneSeen(state, 'c1-intro-yard');
  state = applyChoice(state, 'aceAlly');
  saveStory(state);
  const loaded = loadStory();
  assert.ok(loaded, 'the story did not come back');
  assert.deepEqual(loaded, state, 'save → reload must restore the whole record');
  assert.equal(loaded!.chapter, state.chapter);
  assert.equal(loaded!.heat, state.heat);
  assert.deepEqual(loaded!.seenScenes, state.seenScenes);
  assert.deepEqual(loaded!.flags, state.flags);
  assert.deepEqual(loaded!.objectiveResults, state.objectiveResults);
  assert.deepEqual(loaded!.counters, state.counters);
  assert.deepEqual(loaded!.season.results, state.season.results);
  assert.equal(STORY_KEY, 'heavy-metal-gp:story');
  assert.deepEqual(loadSeason(), before, 'the free championship save must be untouched');
  clearStory();
  assert.equal(loadStory(), null);
});

test('Story state: a walked season survives a reload mid-chapter', () => {
  let state = newStory(SEED, DRIVER, 0);
  for (let chapter = 1; chapter <= 3; chapter++) {
    for (let heat = 1; heat <= HEATS_PER_GP; heat++) {
      state = settleHeat(state, classification(heat === 1 ? 1 : 4), richCounters(chapter, heat)).state;
      for (const scene of nextScenes(state, 'outro', null, chapter)) state = markScenePlayed(state, scene);
    }
  }
  state = markScenePlayed(state, SCENE_BY_ID['c4-intro-office']!);
  state = applyChoice(state, 'acceptedVexDeal');
  saveStory(state);
  const loaded = loadStory()!;
  assert.equal(loaded.chapter, 4, 'resuming keeps the chapter');
  assert.equal(loaded.heat, 0);
  assert.equal(loaded.flags.acceptedVexDeal, true, 'resuming keeps the flags');
  assert.equal(loaded.flags.trainingDone, true);
  assert.equal(loaded.seenScenes.length, state.seenScenes.length, 'resuming keeps the seen scenes');
  assert.ok(loaded.seenScenes.length > 3, 'the walk should have played more than a handful of scenes');
  assert.deepEqual(loaded.seenScenes, [...new Set(loaded.seenScenes)]);
  assert.deepEqual(loaded.season.results[2].length, HEATS_PER_GP);
  assert.equal(storyPosition(loaded), storyPosition(state));
});

test('Story state: corrupt, partial and hostile saves are rejected, not crashed on', () => {
  assert.equal(parseStory(null), null);
  assert.equal(parseStory(''), null);
  assert.equal(parseStory('not json'), null);
  assert.equal(parseStory('[]'), null);
  assert.equal(parseStory('{"version":2}'), null);
  assert.equal(parseStory('{"version":1}'), null, 'a story without a season is not a story');
  const state = newStory(SEED, DRIVER, 0);
  const raw = JSON.stringify(state) as string;
  const tampered = {
    ...JSON.parse(raw),
    chapter: 99, heat: -4, flags: { nonsense: true }, seenScenes: ['c1-intro-yard', 'c1-intro-yard', 42, null],
    objectiveResults: { 3: [{ id: 'c3-crate', met: 'yes' }], 99: [] },
    counters: { 3: { orangePegs: 'lots', overtakes: { '-4': 2, ace: 1 } } },
    ending: 'victory', driver: { name: 'x'.repeat(200), color: 'red', portrait: -3, stats: { weight: 99 } },
    replaying: true,
  };
  const parsed = parseStory(JSON.stringify(tampered))!;
  assert.ok(parsed, 'a repairable save should be repaired');
  assert.equal(parsed.chapter, 6, 'chapter is clamped into 1..6');
  assert.equal(parsed.heat, 0, 'a negative heat is clamped, not trusted');
  assert.deepEqual(Object.keys(parsed.flags).sort(), [...STORY_FLAGS].sort(), 'unknown flags are dropped, known ones kept');
  assert.equal(parsed.flags.nonsense, undefined);
  assert.deepEqual(parsed.seenScenes, ['c1-intro-yard']);
  assert.equal(parsed.objectiveResults[3]![0].met, false, 'a non-boolean met is not met');
  assert.equal(parsed.objectiveResults[99], undefined);
  assert.equal(parsed.counters[3]!.orangePegs, 0);
  assert.deepEqual(Object.keys(parsed.counters[3]!.overtakes), [], 'non-numeric rival keys are dropped');
  assert.equal(parsed.ending, null, 'an unknown ending is no ending');
  assert.equal(parsed.driver.color, '#d63e2e');
  assert.equal(parsed.driver.stats.weight, 5);
  assert.equal(parsed.replaying, false, 'a loaded save is never mid-replay');
});

test('Story state: seen scenes are skipped, and a replay shows them again', () => {
  let state = newStory(SEED, DRIVER, 0);
  const intro = nextScenes(state, 'intro');
  assert.ok(intro.length >= 2, 'chapter 1 opens with the yard and the tryout');
  state = markScenePlayed(state, intro[0]);
  assert.equal(nextScenes(state, 'intro')[0].id, intro[1].id, 'the played scene is not offered again');
  const replaying = startReplay(state, 1);
  assert.equal(nextScenes(replaying, 'intro')[0].id, intro[0].id, 'a replay offers everything again');
  assert.equal(markSceneSeen(state, intro[0].id), state, 'marking an already-seen scene is a no-op');
});

test('Story chapters: circuits, seeds and titles line up with the calendar', () => {
  for (const def of CHAPTERS) {
    assert.equal(chapterTitle(def.chapter), def.title);
    assert.equal(storyGrandPrixName(def.chapter), CALENDAR[def.gp].name);
    const profile = storyProfile(def.chapter);
    assert.equal(profile.segments, CALENDAR[def.gp].profile.segments, 'story mode never changes the circuit length');
    for (const [piece, weight] of Object.entries(def.weights ?? {})) assert.equal(profile.weights[piece], weight);
    for (const [piece, weight] of Object.entries(CALENDAR[def.gp].profile.weights)) {
      if (!(def.weights ?? {})[piece]) assert.equal(profile.weights[piece], weight, 'the Grand Prix weights survive the merge');
    }
    assert.equal(storyRaceSeed(newStory(SEED, DRIVER, 0), def.chapter), storyRaceSeed(newStory(SEED, DRIVER, 0), def.chapter), 'seeds are stable');
    assert.notEqual(storyRaceSeed(newStory(SEED, DRIVER, 0), def.chapter), storyRaceSeed(newStory(0xbeef, DRIVER, 0), def.chapter));
  }
});

function storyGrandPrixName(chapter: number): string {
  return CALENDAR[chapterDef(chapter).gp].name;
}

test('Story engine: the story season is a real season, and the free one is untouched', () => {
  clearStory();
  saveSeason(newSeason([{ id: 0, name: 'You', color: '#fff', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true }]));
  const freeBefore = loadSeason();
  const run = walk(SCRIPTS[0]);
  assert.equal(run.state.season.results.length, 6);
  assert.equal(run.state.season.results.every((gp) => gp.length === HEATS_PER_GP), true);
  assert.equal(endingOf(run.state), 'champion');
  saveStory(run.state);
  assert.deepEqual(loadSeason(), freeBefore, 'story mode must never write the championship save');
  clearStory();
});

test('Story engine: triggers line up with outcomes', () => {
  assert.equal(triggerOutcome('post-win'), 'win');
  assert.equal(triggerOutcome('post-podium'), 'podium');
  assert.equal(triggerOutcome('post-loss'), 'loss');
  assert.equal(triggerOutcome('intro'), null);
  const state = newStory(SEED, DRIVER, 0);
  assert.deepEqual(nextScenes(state, 'post-win', 'loss'), [], 'a mismatched outcome selects nothing');
  assert.ok(nextScenes(state, 'post-win', 'win').length > 0);
  assert.ok(nextScenes(state, 'post-loss').length > 0, 'a post-loss trigger implies its outcome');
  for (const chapter of CHAPTERS_ALL) {
    assert.ok(chapterSceneIds(chapter, 'intro').length > 0);
    assert.ok(SCENES.some((scene) => scene.chapter === chapter));
  }
});
