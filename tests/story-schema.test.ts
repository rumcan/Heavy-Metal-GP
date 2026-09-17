// ══════════════════════════════════════════════════════════════════════════
// ST-01 — the story bible as data: schema, cast, outline and the script stubs.
//
// No browser, no SDK, no Vite: this suite imports the story data modules and the
// art NAME TABLES, then checks the script against the files on disk. That is the
// acceptance list for #23 — every scene id in the outline exists in an act file,
// every `who` resolves to a real portrait, every background/prop/ending name
// exists, and The Hood is hidden until the chapter 5 reveal.
// ══════════════════════════════════════════════════════════════════════════
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CAST, CAST_IDS, STORY_GRID, castTeam } from '../src/game/story/cast';
import type { CastId } from '../src/game/story/cast';
import { CHAPTERS, OUTLINE, REVEAL_SCENE_ID, SCENES, SCENE_BY_ID, chapterDef, chapterSceneIds } from '../src/game/story/outline';
import { STORY_BACKGROUNDS, STORY_CHAPTERS, STORY_ENDINGS, STORY_PORTRAITS, STORY_PROPS } from '../src/game/story/assets';
import {
  CHAPTER_COUNT, ENDINGS, MAX_LINE_LENGTH, RACE_COUNTERS, STORY_FLAGS, TRIGGERS,
  flagsMatch, emptyFlags, outcomeForRank, triggerForOutcome,
} from '../src/game/story/types';
import type { ChapterDef, FlagCondition, ObjectiveDef, Scene, StoryFlag } from '../src/game/story/types';

// `season.ts` reaches `storage.ts` and therefore the RUN SDK, which wants a browser `window`. Same stubs the
// multiplayer suite uses — the minimum that import reads, not a jsdom.
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
const { CALENDAR } = await import('../src/game/season');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The rival names, in sheet order, read out of `src/game/characters.ts`. A source scan rather than an import:
 * that module builds its portrait table with `import.meta.glob`, which only Vite resolves.
 */
const RIVAL_NAMES: string[] = (() => {
  const source = readFileSync(join(ROOT, 'src', 'game', 'characters.ts'), 'utf8');
  const block = /export const RIVALS[\s\S]*?\n];/.exec(source)?.[0] ?? '';
  return [...block.matchAll(/name: '([^']+)'/g)].map((match) => match[1]);
})();
const storyArt = (...parts: string[]) => join(ROOT, 'src', 'assets', 'story', ...parts);
const raceArt = (...parts: string[]) => join(ROOT, 'src', 'assets', 'portraits', ...parts);

const pad = (n: number) => String(n).padStart(2, '0');
const slug = (title: string) => title.toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const chapters = () => Array.from({ length: CHAPTER_COUNT }, (_, i) => (i + 1) as 1 | 2 | 3 | 4 | 5 | 6);

/** Every flag condition used anywhere in the script, flattened. */
function conditionsIn(condition: FlagCondition | undefined, into: FlagCondition[] = []): FlagCondition[] {
  if (!condition) return into;
  into.push(condition);
  if ('all' in condition) condition.all.forEach((inner) => conditionsIn(inner, into));
  if ('any' in condition) condition.any.forEach((inner) => conditionsIn(inner, into));
  return into;
}

// ─────────────────────────── outline & chapters ───────────────────────────

test('Story schema: six chapters, one per Grand Prix, in the right acts', () => {
  assert.equal(CHAPTERS.length, CHAPTER_COUNT);
  assert.deepEqual([...CHAPTERS].map((def) => def.chapter), chapters());
  for (const def of CHAPTERS) {
    assert.equal(def.gp, def.chapter - 1, `${def.title} should be Grand Prix ${def.chapter - 1}`);
    assert.ok(CALENDAR[def.gp], `${def.title} points at a Grand Prix that does not exist`);
    assert.equal(def.act, def.chapter <= 2 ? 1 : def.chapter <= 4 ? 2 : 3, `${def.title} is in the wrong act`);
    assert.ok(def.title.length > 2, `${def.chapter} needs a title`);
    assert.ok(def.objectives.length > 0, `${def.title} needs at least one objective`);
  }
});

test('Story schema: chapter titles match the plaque art', () => {
  for (const def of CHAPTERS) {
    assert.equal(`chapter-${def.chapter}-${slug(def.title)}`, STORY_CHAPTERS[def.chapter - 1],
      `${def.title} does not match its plaque (src/assets/story/titles)`);
    assert.ok(existsSync(storyArt('titles', `${STORY_CHAPTERS[def.chapter - 1]}.webp`)), `missing plaque art for chapter ${def.chapter}`);
  }
});

test('Story schema: every outline scene id exists in an act file, and every scene is in the outline', () => {
  const outlineIds = chapters().flatMap((chapter) => TRIGGERS.flatMap((trigger) => [...chapterSceneIds(chapter, trigger)]));
  assert.equal(outlineIds.length, SCENES.length, 'a scene is missing from the outline, or listed twice');
  assert.equal(new Set(outlineIds).size, outlineIds.length, 'duplicate scene id in the outline');
  for (const id of outlineIds) assert.ok(SCENE_BY_ID[id], `outline lists ${id}, no act file defines it`);
  for (const scene of SCENES) {
    assert.ok(chapterSceneIds(scene.chapter, scene.trigger).includes(scene.id), `${scene.id} is not in its own outline slot`);
    assert.ok(new RegExp(`^c${scene.chapter}-`).test(scene.id), `${scene.id} must start with c${scene.chapter}-`);
    assert.ok(chapterDef(scene.chapter), `${scene.id} belongs to a chapter that does not exist`);
  }
});

test('Story schema: every chapter has an intro, a pre-race and all three post-race variants', () => {
  for (const chapter of chapters()) {
    for (const trigger of ['intro', 'pre-race', 'post-win', 'post-podium', 'post-loss', 'outro'] as const) {
      assert.ok(chapterSceneIds(chapter, trigger).length > 0, `chapter ${chapter} has no ${trigger} scene`);
    }
    const outcomes = ['post-win', 'post-podium', 'post-loss'].map((trigger) => chapterSceneIds(chapter, trigger as never).length);
    assert.ok(outcomes.every((count) => count > 0), `chapter ${chapter} is missing a win/podium/loss variant`);
  }
});

test('Story schema: a post-race scene\'s declared outcome agrees with its trigger', () => {
  for (const scene of SCENES) {
    if (scene.outcome) assert.equal(scene.trigger, triggerForOutcome(scene.outcome), `${scene.id}: outcome ${scene.outcome} does not belong to ${scene.trigger}`);
    if (scene.trigger === 'mid-race') {
      assert.ok(typeof scene.atSector === 'number' && scene.atSector >= 1, `${scene.id} is a mid-race beat without a sector`);
      assert.ok(scene.lines.length <= 3, `${scene.id}: mid-race bubbles stay short`);
    } else {
      assert.equal(scene.atSector, undefined, `${scene.id}: only mid-race scenes carry a sector`);
    }
    if (scene.ending) {
      assert.ok(ENDINGS.includes(scene.ending), `${scene.id} points at an ending that does not exist`);
      assert.equal(scene.chapter, CHAPTER_COUNT, `${scene.id}: endings belong to the finale`);
    }
  }
});

// ─────────────────────────── script content ───────────────────────────

test('Story script: every speaker resolves to a portrait that exists on disk', () => {
  let lines = 0;
  for (const scene of SCENES) {
    assert.ok(scene.lines.length > 0, `${scene.id} has no lines`);
    for (const line of scene.lines) {
      lines++;
      const cast = CAST[line.who];
      assert.ok(cast, `${scene.id}: unknown speaker "${line.who}"`);
      assert.ok(cast.moods.includes(line.mood), `${scene.id}: ${line.who} has no "${line.mood}" portrait`);
      assert.ok(line.text.trim().length > 0, `${scene.id}: empty line`);
      assert.ok(line.text.length <= MAX_LINE_LENGTH,
        `${scene.id}: line is ${line.text.length} chars (max ${MAX_LINE_LENGTH}): "${line.text}"`);
      if (cast.portrait.kind === 'story') {
        assert.ok((STORY_PORTRAITS[cast.portrait.character] as readonly string[]).includes(line.mood),
          `${scene.id}: ${line.mood} is not a painted mood for ${cast.portrait.character}`);
        assert.ok(existsSync(storyArt('portraits', `${cast.portrait.character}_${line.mood}.webp`)),
          `${scene.id}: missing art portraits/${cast.portrait.character}_${line.mood}.webp`);
      } else {
        assert.ok(['angry', 'happy', 'surprised'].includes(line.mood),
          `${scene.id}: ${line.who} only has race moods (angry/happy/surprised)`);
        assert.ok(existsSync(raceArt(`r${pad(cast.portrait.index)}_${line.mood}.webp`)),
          `${scene.id}: missing art r${pad(cast.portrait.index)}_${line.mood}.webp`);
      }
      if (line.prop) {
        assert.ok((STORY_PROPS as readonly string[]).includes(line.prop), `${scene.id}: unknown prop ${line.prop}`);
        assert.ok(existsSync(storyArt('props', `${line.prop}.webp`)), `${scene.id}: missing art props/${line.prop}.webp`);
      }
    }
  }
  assert.ok(lines > 200, `the story is only ${lines} lines long`);
});

test('Story script: every scene background exists in assets.ts and on disk', () => {
  for (const scene of SCENES) {
    assert.ok((STORY_BACKGROUNDS as readonly string[]).includes(scene.background), `${scene.id}: unknown background ${scene.background}`);
    assert.ok(existsSync(storyArt('backgrounds', `${scene.background}.webp`)), `${scene.id}: missing art backgrounds/${scene.background}.webp`);
  }
  for (const ending of ENDINGS) {
    const art = { champion: 'champion-ending', bittersweet: 'bittersweet-ending', heartbreak: 'heartbreak-ending' }[ending];
    assert.ok((STORY_ENDINGS as readonly string[]).includes(art), `${ending}: unknown ending art ${art}`);
    assert.ok(existsSync(storyArt('endings', `${art}.webp`)), `missing art endings/${art}.webp`);
    assert.ok(SCENES.some((scene) => scene.ending === ending), `${ending} has no epilogue scene`);
  }
});

test('Story script: The Hood is hidden until the chapter 5 reveal, and revealed after it', () => {
  const order = chapters().flatMap((chapter) => TRIGGERS.flatMap((trigger) => chapterSceneIds(chapter, trigger)));
  const revealAt = order.indexOf(REVEAL_SCENE_ID);
  assert.ok(revealAt > 0, `the reveal scene ${REVEAL_SCENE_ID} must be in the outline`);
  const reveal = SCENE_BY_ID[REVEAL_SCENE_ID]!;
  assert.equal(reveal.chapter, 5);
  assert.ok(reveal.sets?.includes('hoodRevealed'), 'the reveal must set hoodRevealed');

  let hiddenBefore = 0;
  order.forEach((id, index) => {
    const scene = SCENE_BY_ID[id]!;
    const speakers = scene.lines.map((line) => line.who);
    if (index < revealAt) {
      assert.ok(!speakers.includes('hood-revealed'), `${id} shows The Hood's face before the reveal`);
      hiddenBefore += speakers.filter((who) => who === 'hood').length;
    } else if (index > revealAt) {
      assert.ok(!speakers.includes('hood'), `${id} puts the hood back on after the reveal`);
    }
  });
  assert.ok(hiddenBefore >= 3, `The Hood should loom before the reveal (only ${hiddenBefore} hidden lines)`);

  // inside the reveal scene the hidden lines come first, then the face
  const faces = reveal.lines.map((line) => line.who);
  const lastHidden = faces.lastIndexOf('hood');
  const firstRevealed = faces.indexOf('hood-revealed');
  assert.ok(lastHidden >= 0 && firstRevealed > lastHidden, 'the reveal scene must turn the hidden lines into revealed ones');
});

test('Story script: every flag is both written and read somewhere', () => {
  const written = new Set<StoryFlag>();
  const read = new Set<StoryFlag>();
  for (const scene of SCENES) {
    scene.sets?.forEach((flag) => written.add(flag));
    conditionsIn(scene.when).forEach((condition) => { if ('flag' in condition) read.add(condition.flag); });
    for (const option of scene.choice?.options ?? []) {
      written.add(option.set);
      conditionsIn(option.when).forEach((condition) => { if ('flag' in condition) read.add(condition.flag); });
    }
  }
  for (const def of CHAPTERS) {
    if (def.completeFlag) written.add(def.completeFlag);
    for (const objective of def.objectives) if (objective.flag) written.add(objective.flag);
    for (const event of def.events ?? []) if (event.flag) written.add(event.flag);
    for (const directive of def.ai ?? []) conditionsIn(directive.when).forEach((condition) => { if ('flag' in condition) read.add(condition.flag); });
  }
  for (const flag of STORY_FLAGS) {
    assert.ok(written.has(flag), `${flag} is never set by a scene, choice, objective or event`);
    assert.ok(read.has(flag), `${flag} is never read by a scene or an AI directive`);
  }
  assert.deepEqual([...written].filter((flag) => !STORY_FLAGS.includes(flag)), [], 'a scene sets a flag that is not in STORY_FLAGS');
});

test('Story script: every ending has flag-gated epilogues and a season 2 teaser', () => {
  for (const ending of ENDINGS) {
    const scenes = SCENES.filter((scene) => scene.ending === ending);
    assert.ok(scenes.length >= 3, `${ending} needs a base epilogue plus flag variants`);
    assert.ok(scenes.some((scene) => !scene.when), `${ending} needs an epilogue that always plays`);
    assert.ok(scenes.filter((scene) => scene.when).length >= 2, `${ending} needs at least two flag-dependent epilogues`);
    const lines = scenes.flatMap((scene) => scene.lines.map((line) => line.text));
    assert.ok(lines.some((text) => /next|season|spring|mail|entries/i.test(text)), `${ending} has no season 2 teaser`);
  }
});

// ─────────────────────────── objectives ───────────────────────────

test('Story objectives: every objective is well formed and its counters exist', () => {
  const seen = new Set<string>();
  for (const def of CHAPTERS) {
    for (const objective of def.objectives) {
      assert.ok(!seen.has(objective.id), `duplicate objective id ${objective.id}`);
      seen.add(objective.id);
      assert.ok(objective.id.startsWith(`c${def.chapter}-`), `${objective.id} must start with c${def.chapter}-`);
      assert.ok(objective.label.length > 3 && objective.label.length <= 42, `${objective.id}: label "${objective.label}" is not chip-sized`);
      assertObjective(objective);
    }
    if (def.completeFlag) assert.ok(STORY_FLAGS.includes(def.completeFlag), `${def.title}: unknown completeFlag`);
    for (const event of def.events ?? []) {
      assert.ok(event.atSector >= 1, `${event.id}: sector must be >= 1`);
      assert.ok(['sabotage', 'slick', 'shake'].includes(event.kind), `${event.id}: unknown kind`);
      for (const heat of event.heats ?? []) assert.ok(heat >= 1 && heat <= 3, `${event.id}: heat ${heat} is out of range`);
    }
    for (const directive of def.ai ?? []) {
      assert.ok(CAST[directive.who], `${def.title}: ai directive for unknown cast ${directive.who}`);
      assert.ok(directive.target === 'player' || CAST[directive.target as CastId], `${def.title}: ai directive targets nobody`);
    }
  }
  // the montage chapter has to be able to score its own objectives
  const montage = chapterDef(3);
  assert.deepEqual(montage.objectives.map((objective) => objective.counter), ['crates', 'loops', 'hoops']);
  assert.ok(montage.weights?.['Crack Wall Shortcut'] && montage.weights?.Loop && montage.weights?.['Curve Drop'],
    'chapter 3 must weight the pieces its objectives need');
});

function assertObjective(objective: ObjectiveDef) {
  if (objective.kind === 'counter') {
    assert.ok(objective.counter, `${objective.id}: counter objective without a counter`);
    assert.ok(RACE_COUNTERS.includes(objective.counter), `${objective.id}: unknown counter ${objective.counter}`);
    assert.ok((objective.target ?? 0) >= 1, `${objective.id}: counter objective needs a target`);
  }
  if (objective.kind === 'rank') {
    assert.ok((objective.rank ?? 0) >= 1 && (objective.rank ?? 99) <= 10, `${objective.id}: rank must be 1..10`);
  }
  if (objective.kind === 'ahead') {
    assert.ok(objective.rival && CAST[objective.rival], `${objective.id}: ahead of whom?`);
    assert.ok(objective.rival !== 'sprocket', `${objective.id}: cannot finish ahead of yourself`);
  }
  if (objective.kind === 'finish') assert.ok((objective.target ?? 1) >= 1, `${objective.id}: finish target must be >= 1`);
  assert.ok(['heat', 'chapter'].includes(objective.scope ?? 'heat'), `${objective.id}: unknown scope`);
}

test('Story objectives: the fixed grid gives every rival objective a marble to point at', () => {
  assert.equal(STORY_GRID.length, 10);
  const ids = STORY_GRID.map((id) => CAST[id].gridId);
  assert.deepEqual([...ids].sort((a, b) => a - b), Array.from({ length: 10 }, (_, i) => i), 'the story grid must be marble ids 0..9');
  assert.equal(CAST.sprocket.gridId, 0, 'Sprocket is the player marble');
  for (const id of STORY_GRID) {
    const cast = CAST[id];
    assert.ok(castTeam(cast), `${id} has no team`);
    if (cast.portrait.kind === 'rival') assert.ok(RIVAL_NAMES[cast.portrait.index], `${id} points at a rival sheet that does not exist`);
    assert.ok(cast.name.length > 1, `${id} needs a display name`);
    assert.ok(cast.role.length > 1 && cast.arc.length > 1, `${id} needs a role and an arc`);
  }
  // names must agree with the race rival sheet they are drawn from
  for (const id of CAST_IDS) {
    const cast = CAST[id];
    if (cast.portrait.kind !== 'rival') continue;
    assert.equal(cast.name, RIVAL_NAMES[cast.portrait.index], `${id} does not match rival sheet ${cast.portrait.index}`);
  }
  for (const castId of ['ace', 'vex', 'smokey', 'zapp', 'hood'] as const) {
    const index = { ace: 0, vex: 1, smokey: 9, zapp: 11, hood: 12 }[castId];
    assert.equal(CAST[castId].name, RIVAL_NAMES[index], `${castId} must keep the paddock's name for ${RIVAL_NAMES[index]}`);
  }
});

// ─────────────────────────── pure helpers ───────────────────────────

test('Story helpers: outcomes, triggers and flag conditions', () => {
  assert.equal(outcomeForRank(1), 'win');
  assert.equal(outcomeForRank(2), 'podium');
  assert.equal(outcomeForRank(3), 'podium');
  assert.equal(outcomeForRank(4), 'loss');
  assert.equal(outcomeForRank(10), 'loss');
  assert.equal(outcomeForRank(null), 'loss');
  assert.equal(triggerForOutcome('win'), 'post-win');
  assert.equal(triggerForOutcome('podium'), 'post-podium');
  assert.equal(triggerForOutcome('loss'), 'post-loss');

  const flags = { ...emptyFlags(), aceAlly: true, acceptedVexDeal: false } as Record<StoryFlag, boolean>;
  assert.equal(flagsMatch(undefined, flags), true);
  assert.equal(flagsMatch({ flag: 'aceAlly' }, flags), true);
  assert.equal(flagsMatch({ flag: 'aceAlly', not: true }, flags), false);
  assert.equal(flagsMatch({ flag: 'acceptedVexDeal' }, flags), false);
  assert.equal(flagsMatch({ all: [{ flag: 'aceAlly' }, { flag: 'acceptedVexDeal', not: true }] }, flags), true);
  assert.equal(flagsMatch({ any: [{ flag: 'acceptedVexDeal' }, { flag: 'aceAlly' }] }, flags), true);
  assert.equal(flagsMatch({ any: [{ flag: 'acceptedVexDeal' }, { flag: 'hoodRevealed' }] }, flags), false);
});

test('Story schema: the script and engine stay pure data (no React, no art, no SDK at runtime)', () => {
  // The file contract: story content is data. Art names are types, portraits and storage live elsewhere.
  for (const file of ['script/act1.ts', 'script/act2.ts', 'script/act3.ts', 'outline.ts', 'types.ts', 'cast.ts', 'engine.ts']) {
    const text = readFileSync(join(ROOT, 'src/game/story', file), 'utf8');
    assert.ok(!/^import\s+(?!type).*react/m.test(text), `${file} must stay pure (no React)`);
    for (const line of text.split('\n')) {
      if (!line.startsWith('import')) continue;
      if (line.includes('import type')) continue;
      const target = /from '([^']+)'/.exec(line)?.[1] ?? '';
      assert.ok(!/assets|characters|storage|components|react/.test(target), `${file} runtime-imports ${target}; story data must stay node-safe`);
    }
  }
});
