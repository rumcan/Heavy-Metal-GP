# P2-13: Tutorial, a skippable, fully voiced first race of the campaign

**Phase 2 · Wave 3 · issue #119** · part of #106. Everything it was blocked by (#124, #107, #109) is merged.

## Why
New players do not know what is going on. The first race of the campaign becomes a short, fully voiced tutorial on the platformer course that teaches steering, the Magic Engine, skills, jumping and the shortcut idea. It is skippable and can be replayed from How to play.

## What already exists (use it, do not rebuild it)
- **Training Grounds** (`id: 'training'`, `tutorial: true`) in `src/game/platformer/course.ts` (`planTutorial()`): a short hand-built course, one of each thing in the order you learn it (crate, gap, ramp, door, slope, climb). Extend it only if a lesson below has no place on it.
- Cannon start, three lanes, jump, health and skills already work on platformer courses. A tutorial race has the player plus 2 slow AI and **no damage** (`Game.healthOn` off for it, or invulnerable).
- Story engine: `src/game/story/*`, `StoryMode.tsx`, story hooks in `src/game/engine.ts`. Voice: `scripts/voice/generate.mjs`, `src/voice/manifests/*`, `VoiceSubtitles`. How to play: `RulesDialog.tsx`.

## Flow
1. A fresh story save starts with "Prologue: Learn to Race" and a big **Skip tutorial** button. Skip goes straight to Chapter 1.
2. The race is the Training Grounds course, landscape on phones. Lessons run in order and each one **waits for the player**: the voice line plays, a big key prompt shows (keyboard keys on desktop, the on-screen button highlighted on touch) and it advances when the action happens.
   1. **Steer:** "Press left and right to steer."
   2. **Magic Engine:** "Hold down to fire your Magic Engine. Watch the heat bar."
   3. **Skills:** "Your skills live on Q W E R and A S D F." The player uses Speed Boost.
   4. **Jump:** "Press up or Space to jump the gap." A soft catch net if they miss. On a phone: the JUMP button.
   5. **Shortcut:** "See that tunnel in the cliff? Jump into it to skip a whole section." The long way round is clearly longer.
   6. **Finish:** "That is it. Now let us go racing." Then Chapter 1.
3. Detect actions with trigger zones (x-ranges on the course), story hooks and item-use events. The engine physics are not changed.
4. **Voice:** narrator lines from the cast, manifest `src/voice/manifests/tutorial.json`, generated with `scripts/voice/generate.mjs` (cap 1,500 credits), subtitles through `VoiceSubtitles`. Run `rundot whoami` first; if it does not work do NOT try to log in, commit the manifest and add a PR checklist item "needs voice generation run". Dry run first.
5. **How to play** gets a "Play the tutorial" button. Completion is stored in the story save (`tutorialDone` in `src/game/story/state.ts`).

## Files
| | |
|---|---|
| **You own** | new `src/game/story/tutorial.ts`, new `src/components/story/Tutorial*.tsx`, `src/voice/manifests/tutorial.json`, `src/assets/voice/tutorial/*`, new `tests/tutorial.test.ts` |
| **Shared: keep edits small** | `src/game/platformer/course.ts` (only the Training Grounds plan, only if a lesson needs a piece), `StoryMode.tsx` (prologue entry and skip), `src/game/story/state.ts` (`tutorialDone`), `RulesDialog.tsx` (button), `RaceScreen.tsx` (key prompt overlay hook only) |
| **Do not touch** | chapters 1 to 6 scripts, the engine physics, `tests/engine-checksum.test.ts` |

## Rules
- Branch and PR: your branch is created for you; never rename it. Empty commit `P2-13: start`, push, open a **draft PR** "P2-13: Tutorial: a skippable, fully voiced first race of the campaign" with "Closes #119". Push after every commit. If you cannot push, work locally and say so.
- Tests: `npx tsc --noEmit -p .` and `node --import tsx --test tests/tutorial.test.ts tests/platformer.test.ts tests/story-modifiers.test.ts tests/engine-checksum.test.ts`. Do not run `tests/browser.test.ts` or `scripts/e2e-mp.mjs`.
- No localStorage (use `src/game/storage.ts`, register new keys). Physics stays vector shapes. 375 px portrait, 812x375 landscape and desktop must all work. Do not deploy or merge.
- Finish: `git fetch origin && git rebase origin/main`, re-run the tests, push, mark the PR Ready with What changed / How to try it / Known gaps / Touched outside my files.

## Done when
- A fresh story save opens the prologue; Skip goes to Chapter 1; finishing sets `tutorialDone`; How to play can replay it.
- Each lesson waits for its action and shows the right key (keyboard vs touch). Unit tests cover the lesson state machine (advance on action, no advance otherwise, skip, replay) and the manifest (every line has an id, text and speaker).

## Prompt for the agent (paste as the task)
```text
You are a senior TypeScript/React game engineer on Heavy-Metal-GP (Vite + React + Matter.js, RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your ticket is issue #119, "P2-13: Tutorial". Read docs/arena/P2-13-tutorial.md completely first, then src/game/platformer/course.ts (planTutorial, the Training Grounds course), src/game/story/state.ts, src/components/story/StoryMode.tsx, src/components/RulesDialog.tsx, src/components/RaceScreen.tsx, scripts/voice/generate.mjs and an existing manifest in src/voice/manifests/.

FIRST: empty commit "P2-13: start", push your branch (do not rename it), open a DRAFT PR "P2-13: Tutorial: a skippable, fully voiced first race of the campaign" with "Closes #119". Push after EVERY commit. If you cannot push, keep working locally and say so.

Build in this order, one commit each, running the spec's tests after each:
1. The lesson state machine in src/game/story/tutorial.ts (steer, Magic Engine, skills, jump, shortcut, finish; each waits for its action) with tests.
2. Wire it to the Training Grounds race: trigger zones, key prompt overlay (keyboard vs touch), only the player plus 2 slow AI, no damage.
3. The prologue in StoryMode (fresh save starts here, Skip goes to Chapter 1, tutorialDone in the save) and the Play the tutorial button in How to play.
4. Voice: manifest, subtitles, dry run of the generator. Only generate audio if `rundot whoami` works; otherwise leave a checklist item.

Rules: stay inside the files the spec lists; keep shared edits small and list them under "Touched outside my files". Never use localStorage. Do not run tests/browser.test.ts or scripts/e2e-mp.mjs. engine-checksum must pass unchanged. Do not deploy or merge. Final: git fetch origin && git rebase origin/main, re-run tests, push, mark the PR Ready with What changed / How to try it / Known gaps.
```
