# Agent batch 2: what can go to AI Arena agents now

Everything the agents were given in batch 1 is merged (see `NEXT-AGENT-JOBS.md`, `P2-13`, `P2-18`, `P2-19`, `P2-20`) apart from job D. Since then the platformer Workshop (P2-22) and Infinity mode (P2-24) landed on main, so there is more to give out. All five jobs below are independent: run them in parallel. Job 5 waits for Infinity (P2-24) to be on main: check `ls src/components/infinity/InfinityScreen.tsx` first.

Standing rules for every job: the branch is created for you (never rename it); empty commit, then a draft PR first; push after every commit; no localStorage (use `src/game/storage.ts`, register new keys in `STORAGE_KEYS`); physics stays vector shapes; phone portrait 375 px, landscape 812x375 and desktop must work; do not run `tests/browser.test.ts` or `scripts/e2e-mp.mjs` (except job 1); `tests/engine-checksum.test.ts` unchanged; do not deploy or merge; finish with `git fetch origin && git rebase origin/main`, re-run the tests, push, mark the PR Ready with What changed / How to try it / Known gaps / Touched outside my files. RUN.world credits are unlimited (the owner said so), but always do a dry run first (`rundot whoami`; if it does not work, do NOT try to log in: commit the script and manifest and add the PR checklist item "needs generation run").

---
## 1. P2-23: Browser tests for the home-tab UI, the platformer Workshop and Infinity

The 5 old tests in `tests/browser.test.ts` drive the pre-redesign garage and time out. The game opens on home tabs now (Story, Championship, Quick race, Online, Infinity, Workshop: `src/components/SetupScreen.tsx`, `src/components/home/*`). The Workshop can also build platformer courses sideways (New track, Platformer course).

```text
You are a senior TypeScript/test engineer on Heavy-Metal-GP (Vite + React). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your ticket is "P2-23: Browser tests for the home-tab UI". Read docs/arena/AGENT-BATCH-2.md (job 1) and docs/arena/NEXT-AGENT-JOBS.md (section D) first, then tests/browser.test.ts, src/components/SetupScreen.tsx, src/components/home/*, src/components/TrackEditor.tsx.

FIRST: empty commit "P2-23: start", push your branch (never rename it), open a DRAFT PR "P2-23: Browser tests for the home-tab UI". Push after EVERY commit; if you cannot push, keep working locally and say so.

Run node --import tsx --test tests/browser.test.ts, then fix the failing tests one at a time (one commit each), keeping each test's intent and updating only the navigation and locators to the current home-tab flow. Then add tests, each at phone portrait 375 px and desktop: the Loadout screen, the Talents screen, the Ball customizer, the Infinity tab (Roll opens a canvas with a km readout; Hide UI hides the buttons and a tap brings them back; Pause shows Resume / New seed / Leave), and the platformer Workshop (New track > Blank platformer course: the lane buttons Back / Middle / Front and the Length buttons are there; arm Floor and click the canvas: the piece count goes to 1; Test drive starts a race and leaving it returns to the Workshop with the piece still there). Prefer role and label locators; where nothing stable exists add a tiny aria-label or data-testid and list it under "Touched outside my files". Do not change game logic. This is the one job allowed to run tests/browser.test.ts; do not run scripts/e2e-mp.mjs. Final: the whole of tests/browser.test.ts passes; say so with the output.
```

---
## 2. #120 P2-14: Story voice-over (every campaign line spoken)

Spec: the body of GitHub issue #120 (`gh issue view 120`). The voice pipeline exists (`scripts/voice/generate.mjs`, manifests in `src/voice/manifests/`, `VoiceSubtitles`, the cast voice ids), and the tutorial manifest (`src/voice/manifests/tutorial.json`, about 404 credits, committed but not yet generated) is the model.

```text
You are a senior TypeScript engineer on Heavy-Metal-GP (Vite + React, RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your ticket is issue #120, "P2-14: Story voice-over". Read the issue completely first (gh issue view 120), docs/arena/AGENT-BATCH-2.md (job 2), then scripts/voice/generate.mjs, src/voice/manifests/*, src/game/story/script/*, src/components/story/*, and tests/voice*.test.ts.

FIRST: empty commit "P2-14: start", push your branch (never rename it), open a DRAFT PR "P2-14: Story voice-over" with "Closes #120". Push after EVERY commit; if you cannot push, keep working locally and say so.

Do it in small commits with the voice tests after each: 1) the manifests for every story scene line (id, speaker, text, settings) with the schema validator passing; 2) the player wiring so a spoken line plays with its subtitle, can be skipped, and respects the mute and voice settings; 3) a dry run of the generator (count lines, estimate the credits); 4) if `rundot whoami` works, generate the audio and commit the files (credits are unlimited, but keep the files small: check the size and use the generator's smallest acceptable format); if it does not work, do not log in: commit the manifests and add the PR checklist item "needs voice generation run". The committed-audio-never-stale test must pass. Also generate the tutorial audio: node scripts/voice/generate.mjs --set tutorial (if rundot works). Follow the standing rules in docs/arena/AGENT-BATCH-2.md.
```

---
## 3. #121 P2-15: Workshop voice tour (Zapp explains how to build)

Spec: the body of issue #121. The Workshop is now final enough to describe: a classic circuit and a **platformer course** (New track > Platformer course: floors, lanes Back / Middle / Front, springs, lane ramps and doors, loops, rope bridges, Test drive, Validate, Publish).

```text
You are a senior TypeScript/React engineer on Heavy-Metal-GP (Vite + React, RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your ticket is issue #121, "P2-15: Workshop voice tour". Read the issue completely first (gh issue view 121), docs/arena/AGENT-BATCH-2.md (job 3), then src/components/editor/CoachMarks.tsx, src/components/TrackEditor.tsx, scripts/voice/generate.mjs, src/voice/manifests/*, and the voice player/subtitle components used by the story.

FIRST: empty commit "P2-15: start", push your branch (never rename it), open a DRAFT PR "P2-15: Workshop voice tour" with "Closes #121". Push after EVERY commit; if you cannot push, keep working locally and say so.

Small commits, voice tests after each: 1) the tour script (steps, each anchored to a Workshop element by data-coach), covering both a classic circuit and a platformer course; 2) the manifest for Zapp's lines and the player with subtitles, skip and replay (a Tour button in the Workshop header next to Tutorial); 3) a dry run of the generator; 4) generate the audio if `rundot whoami` works (do not log in if it does; leave the PR checklist item "needs voice generation run"). Keep edits to TrackEditor.tsx and CoachMarks.tsx small and list them. Follow the standing rules in docs/arena/AGENT-BATCH-2.md.
```

---
## 4. Skill icons: the 16 new skills (art)

Today `src/components/ItemGlyph.tsx` draws placeholder glyphs for the 16 skills added in P2-08 (the original 8 have real art). Make a proper icon for each: same style as the existing 8, readable at 40 px and 22 px, on a dark button.

```text
You are a senior TypeScript/React engineer and technical artist on Heavy-Metal-GP (Vite + React). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your task: real icons for the 16 skills that only have placeholder glyphs. Read docs/arena/AGENT-BATCH-2.md (job 4), then src/components/ItemGlyph.tsx, src/game/skills/catalog.ts (the 24 skill ids, names and descriptions), src/components/InventoryToolbar.tsx, src/components/loadout/LoadoutScreen.tsx, and look at how the original 8 icons are drawn and sized.

FIRST: empty commit "icons: start", push your branch (never rename it), open a DRAFT PR "Skill icons for the 16 new skills". Push after EVERY commit; if you cannot push, keep working locally and say so.

Run `rundot whoami` first. If it works: generate the icon art with `rundot generate image` (dry run first; one consistent style prompt for all 16, a transparent or flat dark background, a bold silhouette that reads at 22 px; credits are unlimited, but keep each file under 40 KB webp and the whole set under 600 KB), save under src/assets/skills/, and load them in ItemGlyph.tsx with a vector fallback. If it does not work: do not log in; draw clean vector SVG icons by hand for all 16 in the same style as the original 8 (this is also acceptable as the final result) and add the PR checklist item "optional: generated art run". Add tests/skill-icons.test.ts: every skill id has an icon, no two icons are the same, files exist and are small. Check the toolbar and the loadout screen at phone portrait 375 px, landscape 812x375 and desktop, and put before/after screenshots in the PR. Follow the standing rules in docs/arena/AGENT-BATCH-2.md. Do not touch the original 8 icons.
```

---
## 5. P2-25: Infinity mode, the beautiful and soothing pass (needs P2-24 on main)

The full ticket and prompt are in `docs/arena/P2-24-infinity-mode.md` (section P2-25). Paste its "Prompt for the agent" block as the task. It starts by checking that `src/components/infinity/InfinityScreen.tsx` exists.
