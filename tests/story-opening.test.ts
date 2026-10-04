// Where story mode opens (src/game/story/opening.ts). The chapter is picked ONCE, on the home screen's Story tab;
// story mode used to open on a second copy of the chapter list, so every chapter was picked twice. Covered: a fresh
// save learns to race first and then gets the picked chapter, any other save goes straight into the picked chapter
// at the right heat, a cleared chapter is a replay that leaves the save alone, and a locked or missing pick falls back
// to the next chapter to play. The browser suite clicks the same flow end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// `state.ts` reaches the RUN SDK through `storage.ts`: the same stubs the other story suites use.
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

const { completeTutorial, newStory } = await import('../src/game/story/state');
const { chapterTitle } = await import('../src/game/story/engine');
const { checkedPick, enterChapter, needsTutorial, openStory, storyPrimary } = await import('../src/game/story/opening');
type StoryState = ReturnType<typeof newStory>;

const driver = { name: 'Sprocket', color: '#d63e2e', portrait: 0, stats: { weight: 5, speed: 5, bounce: 5 } };
const fresh = () => newStory(7, driver, 0);

/** A save with `heats[i]` heats banked in chapter i + 1 (only the count matters to the opening). */
function saveWith(heats: number[], more: Partial<StoryState> = {}): StoryState {
  const base = completeTutorial(fresh());
  const results = base.season.results.map((_, i) => Array.from({ length: heats[i] ?? 0 }, () => []));
  return { ...base, ...more, season: { ...base.season, results: results as unknown as StoryState['season']['results'] } };
}

test('a brand-new save learns to race first, then gets the picked chapter (chapter 1)', () => {
  assert.equal(needsTutorial(null), true);
  assert.equal(needsTutorial(fresh()), true);
  const opening = openStory(null, { chapter: 1, replay: false }, fresh);
  assert.equal(opening.tutorial, true);
  assert.deepEqual(opening.pick, { chapter: 1, replay: false });
  assert.equal(opening.state.replaying, false);
});

test('a save that has done the tutorial goes straight into the picked chapter: no second chapter list', () => {
  const saved = saveWith([3]);
  assert.equal(needsTutorial(saved), false);
  const opening = openStory(saved, { chapter: 2, replay: false }, fresh);
  assert.equal(opening.tutorial, false);
  assert.deepEqual(opening.pick, { chapter: 2, replay: false });
  assert.equal(opening.state.chapter, 2);
  assert.equal(opening.heat, 1);
  assert.equal(opening.base, null);
});

test('a skipped tutorial or any progress counts as having learned to race', () => {
  assert.equal(needsTutorial({ ...fresh(), seenScenes: ['c1-intro'] }), false);
  assert.equal(needsTutorial(saveWith([1], { tutorialDone: false })), false);
});

test('a chapter part-way through resumes at its next heat', () => {
  const opening = openStory(saveWith([3, 1]), { chapter: 2, replay: false }, fresh);
  assert.equal(opening.heat, 2);
});

test('a cleared chapter is a replay: the save it came from is kept to go back to', () => {
  const saved = saveWith([3, 3]);
  const opening = openStory(saved, { chapter: 1, replay: true }, fresh);
  assert.equal(opening.pick.replay, true);
  assert.equal(opening.state.replaying, true);
  assert.equal(opening.state.chapter, 1);
  assert.equal(opening.base, saved);
  assert.equal(opening.heat, 1);
});

test('the replay flag comes from the save, not from the pick', () => {
  const saved = saveWith([3]);
  assert.deepEqual(checkedPick(saved, { chapter: 2, replay: true }), { chapter: 2, replay: false });
  assert.deepEqual(checkedPick(saved, { chapter: 1, replay: false }), { chapter: 1, replay: true });
});

test('a locked or missing pick starts the next chapter to play', () => {
  const saved = saveWith([3]);
  assert.deepEqual(checkedPick(saved, { chapter: 4, replay: false }), { chapter: 2, replay: false });
  assert.deepEqual(checkedPick(saved, null), { chapter: 2, replay: false });
  assert.equal(enterChapter(saved, checkedPick(saved, null)).state.chapter, 2);
});

test('the big Story button says what it starts', () => {
  assert.equal(storyPrimary(fresh()).label, 'Start the story');
  const next = storyPrimary(saveWith([3]));
  assert.equal(next.chapter, 2);
  assert.equal(next.label, `Continue · ${chapterTitle(2)}`);
  const done = saveWith([3, 3, 3, 3, 3, 3]);
  const finished = storyPrimary({ ...done, season: { ...done.season, complete: true } });
  assert.deepEqual([finished.chapter, finished.replay], [1, true]);
  assert.equal(finished.label, `Replay · ${chapterTitle(1)}`, 'a finished story starts a replay of chapter 1 (the cards pick any other)');
});
