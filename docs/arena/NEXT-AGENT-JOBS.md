# Next agent jobs, and what is scheduled for later

Run **A, B and D in parallel** (they touch different files). Run **C after A has merged** (both edit the Workshop palette).

Standing rules for every job: the branch is created for you (never rename it); make an empty commit, then open a draft PR first; push after every commit; no localStorage (use `src/game/storage.ts`); physics stays vector shapes; phone portrait 375 px, landscape 812x375 and desktop must all work; do not run `tests/browser.test.ts` or `scripts/e2e-mp.mjs` (except job D, whose whole job is that file); `tests/engine-checksum.test.ts` stays unchanged; bump `PROTOCOL_VERSION` (now 10) only for wire changes; do not deploy or merge; finish with `git fetch origin && git rebase origin/main`, re-run the tests, push, and mark the PR Ready with What changed / How to try it / Known gaps / Touched outside my files.

---
## A. P2-12 (issue #118): Workshop scaffold tunnels

Spec: the body of GitHub issue #118. Ten premade kits in `src/game/scaffold-kits.ts` built from existing `curve` and `ramp` pieces, a wooden scaffold skin through an optional `PieceBase.skin`, a palette section with preview and ghost, and a test that a marble rolls through every kit. Vector drawing only, spend no credits.

```text
You are a senior TypeScript/React game engineer on Heavy-Metal-GP (Vite + React + Matter.js, RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your ticket is issue #118, "P2-12: Workshop: premade curved scaffold tunnels". Read the issue completely first (gh issue view 118), then src/game/peg-art.ts, src/components/editor/PiecePalette.tsx, ghost.ts, group.ts, templates.ts, defaults.ts, src/game/trackdef.ts and the curve/ramp drawing in src/game/render.ts.

FIRST: empty commit "P2-12: start", push your branch (never rename it), open a DRAFT PR "P2-12: Workshop scaffold tunnels" with "Closes #118". Push after EVERY commit; if you cannot push, keep working locally and say so.

One commit each, with tests after each:
1) scaffold-kits.ts with the 10 kits and a headless test that a marble rolls through each.
2) The scaffold skin (optional validated PieceBase.skin kept through share codes; vector-drawn planks, supports, bolts; collision unchanged).
3) The palette section, live preview, ghost, stamped as one group, wider-than-track warning.

Vector art only, spend no credits. Tests: npx tsc --noEmit -p . and node --import tsx --test on your new test plus tests/trackdef.test.ts tests/editor-ui.test.ts tests/placement-bounds.test.ts tests/engine-checksum.test.ts. Follow the standing rules in docs/arena/NEXT-AGENT-JOBS.md.
```

---
## B. P2-21: Platformer routes: loops and rope bridges

**Why:** the platformer planner (`src/game/platformer/course.ts`, `flow.ts`, `build.ts`, `render.ts`) has flat floors, bumps, springs, ledges, lane gates and boosts. Races need more varied routes: a **loop** (a vertical ring a fast ball rides over the top; a slow ball falls back and retries) and a **rope bridge** (a sagging plank bridge over a chasm that sways a little and holds weight).

**Build:**
1. New section kinds `loop` and `bridge` in the plan with their own build functions, made only of Matter vector bodies.
2. The planner places them on the flow courses (at most one loop and two bridges per course, never on the tutorial) with the lane rules respected.
3. The coaster skin draws them (`coaster.ts`).
4. The AI (`decide()` in `src/game/engine/platformer.ts`) takes the right speed into a loop and crosses a bridge.
5. Tests: every seeded course still finishes for the whole field (extend `tests/platformer.test.ts`, use `scripts/platformer-sim.ts` as a guide); a slow marble falls out of a loop and a fast one clears it.

**You own:** new `src/game/platformer/routes.ts`, new `tests/platformer-routes.test.ts`. **Shared, small edits:** `course.ts`, `flow.ts`, `build.ts`, `render.ts`, `coaster.ts`, `src/game/engine/platformer.ts`. **Do not touch:** classic track code, skills, net code.

```text
You are a senior TypeScript game engineer on Heavy-Metal-GP (Vite + React + Matter.js). Repository: https://github.com/rumcan/Heavy-Metal-GP. Read docs/arena/NEXT-AGENT-JOBS.md section B completely first, then src/game/platformer/course.ts, flow.ts, build.ts, render.ts, coaster.ts, src/game/engine/platformer.ts (decide), scripts/platformer-sim.ts and tests/platformer.test.ts.

FIRST: empty commit "P2-21: start", push your branch (never rename it), open a DRAFT PR "P2-21: Platformer loops and rope bridges" (create a GitHub issue first if you can, and write "Closes #N"). Push after EVERY commit; if you cannot push, keep working locally and say so.

One commit each, with tests after each:
1) routes.ts: loop and bridge as vector Matter bodies with a headless test (a slow marble falls out of the loop, a fast marble clears it, a marble crosses a bridge).
2) Plan and build integration on flow courses (limits: one loop, two bridges, never the tutorial) and a test that every seeded course still finishes for the whole field.
3) The coaster skin drawing for both.
4) AI handling in decide() with a test.

Tests: npx tsc --noEmit -p . and node --import tsx --test tests/platformer-routes.test.ts tests/platformer.test.ts tests/skills.test.ts tests/tutorial.test.ts tests/engine-checksum.test.ts. Physics stays vector shapes; art is only a skin. Follow the standing rules in docs/arena/NEXT-AGENT-JOBS.md.
```

---
## C. P2-22: Workshop tools for platformer courses (run after A has merged)

**Why:** platformer courses can only be generated or hand-coded; builders cannot make, test and share one.

**Build:** a "Platformer course" mode in the Workshop.
1. Pick length, seed and theme, and see the planned course as a side-view strip.
2. Add, move and delete springs, ledges, lane gates (ramp and door), boosts, item boxes and wreckers per lane.
3. Test-drive it (existing `TestDrive.tsx`), save it to My tracks, share it and publish it like other tracks, and race it in quick race and online as a `platformer:` pick.
4. The saved form is a versioned JSON `PlatformerDef` that overrides the planned course (`planOfficial` and `planCourse` return it unchanged when present). It is validated by `validatePlatformerDef` (gates inside floors, nothing overlapping, a floor under every lane the finish needs) with readable errors.

**You own:** new `src/game/platformer/def.ts`, new `src/components/editor/PlatformerEditor.tsx`, new `tests/platformer-def.test.ts`. **Shared, small:** `src/game/platformer/course.ts`, `src/components/TrackEditor.tsx`, `src/components/editor/MyTracksPanel.tsx`, `NewTrackDialog.tsx`, `src/game/storage.ts`, `src/net/protocol.ts` (the def travels with the room, so bump `PROTOCOL_VERSION`). **Do not touch:** classic piece palette internals, physics.

```text
You are a senior TypeScript/React game engineer on Heavy-Metal-GP (Vite + React + Matter.js). Repository: https://github.com/rumcan/Heavy-Metal-GP. Read docs/arena/NEXT-AGENT-JOBS.md section C completely first, then src/game/platformer/course.ts, src/components/TrackEditor.tsx, src/components/editor/MyTracksPanel.tsx, NewTrackDialog.tsx, TestDrive.tsx, PublishDialog.tsx, src/game/trackdef.ts (the classic def format and validator, as a model) and src/game/storage.ts. Start from the latest origin/main and check the scaffold-tunnel work (#118) is merged first; if it is not, stop and say so.

FIRST: empty commit "P2-22: start", push your branch (never rename it), open a DRAFT PR "P2-22: Workshop tools for platformer courses" (create a GitHub issue first if you can, and write "Closes #N"). Push after EVERY commit; if you cannot push, keep working locally and say so.

One commit each, with tests after each:
1) def.ts: PlatformerDef, JSON round trip, validatePlatformerDef with readable errors, and the plan override, with tests.
2) The Workshop Platformer mode: side-view strip, add/move/delete per lane, test-drive.
3) Save, My tracks, share code and publish, and racing it as a platformer: pick in quick race.
4) Online: the def rides with the room (validated on the host and guests), PROTOCOL_VERSION bump.

Tests: npx tsc --noEmit -p . and node --import tsx --test tests/platformer-def.test.ts tests/platformer.test.ts tests/trackdef.test.ts tests/editor-ui.test.ts tests/protocol.test.ts tests/host.test.ts tests/engine-checksum.test.ts. Follow the standing rules in docs/arena/NEXT-AGENT-JOBS.md.
```

---
## D. P2-23: Rewrite the browser tests for the home-tab UI

**Why:** 5 tests in `tests/browser.test.ts` drive the pre-redesign garage (`#circuit-title`, a "Quick race" button on the garage, the circuit selector) and time out. The game now opens on home tabs (Story, Championship, Quick race, Online, Workshop; see `src/components/SetupScreen.tsx` and `src/components/home/*`).

**Build:**
1. Update the failing tests to the new flow, keeping each test's intent: garage controls preserve budget and select the circuit; mobile layout stays in bounds; a complete long heat pays winnings and the saved season advances; shop purchases persist and quitting pays nothing; template dialog blocks editor shortcuts.
2. Add one test per new screen: Loadout, Talents and the Ball customizer.
3. Use role and label locators, not CSS classes that changed. The suite must pass headless on Windows with the local Chrome or Edge (`BROWSER_PATH`).

**You own:** `tests/browser.test.ts` (and `tests/ui-fixture*` if needed). **Shared, small:** add `aria-label`s or `data-testid`s in components where a locator has nothing stable (keep each edit tiny and list it). **Do not touch** game logic.

```text
You are a senior TypeScript/test engineer on Heavy-Metal-GP (Vite + React). Repository: https://github.com/rumcan/Heavy-Metal-GP. Read docs/arena/NEXT-AGENT-JOBS.md section D completely first, then tests/browser.test.ts, src/components/SetupScreen.tsx and src/components/home/*.

FIRST: empty commit "P2-23: start", push your branch (never rename it), open a DRAFT PR "P2-23: Browser tests for the home-tab UI". Push after EVERY commit; if you cannot push, keep working locally and say so.

Run node --import tsx --test tests/browser.test.ts to see the failing tests, then fix them one at a time (one commit each), keeping each test's intent and updating only the navigation and locators to the current home-tab flow. Then add tests for the Loadout, Talents and Ball customizer screens at phone portrait (375 px) and desktop. Prefer role and label locators; where nothing stable exists add a tiny aria-label or data-testid and list it under "Touched outside my files". Do not change game logic. This is the one job allowed to run tests/browser.test.ts; do not run scripts/e2e-mp.mjs. Follow the standing rules in docs/arena/NEXT-AGENT-JOBS.md. Final: the whole of tests/browser.test.ts passes; say so with the output.
```

---
## Scheduled for later (voice and art: they spend credits, run last)

| Job | Issue | Cost | Notes |
|---|---|---|---|
| Story voice-over, every campaign line | #120 | cap in the ticket | needs `rundot whoami` to work; also the tutorial audio (about 404 credits: `node scripts/voice/generate.mjs --set tutorial --cap 1500`) |
| Workshop voice tour (Zapp) | #121 | cap in the ticket | after jobs A and C land, so the tour describes the final tools |
| 16 new skill icons (placeholder glyphs today) | new | about 2,400 credits | `src/components/ItemGlyph.tsx`, 24 glyphs |
| Look and feel pass: platformer art, backdrops, owner's art drop | new | owner art in `assets/new-art/` | parked until everything else is built |
