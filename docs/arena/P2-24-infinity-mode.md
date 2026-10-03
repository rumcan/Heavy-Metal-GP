# P2-24: Infinity mode (an endless, soothing roll)

**Phase 2 · part of #106 · no issue yet (open one from this file).** A solo mode with no finish line: you roll your ball across a land that grows in front of you for as long as you keep going. No rivals, no timer, no fail state. It is a **calm, pretty time-waster** you can leave running on a phone. This ticket builds the engine and the mode; **P2-25 (below) is the "make it beautiful" pass** and may follow straight after.

## Why
The platformer courses (P2-00, `src/game/platformer/`) are races: long, but they end. Players asked for something to play without pressure: drive forward, watch the land roll by, stop whenever. The platformer already has the right feel (rolling slopes, springs, ledges, loops, bridges); what it lacks is a course that never ends and a mode wrapped around it.

## The idea in one paragraph
Mode name **Infinity**. You start on a flat meadow at dawn. As you roll right (left/right to steer, jump, the Magic Engine to push), the land ahead is generated in **chunks** from a seed and the land far behind is thrown away, so memory and physics cost stay flat forever. The generator reuses what the flow planner already knows (smooth hills, chasms to jump, bridges, springs, ledges, loops) but never builds anything hostile: no wrecking balls, no walls you cannot get over. If you fall, you are set gently back on the last solid ground. A small counter shows the distance (km). The world changes slowly as you go: biomes, time of day, weather, music.

## What to build
1. **The generator** (`src/game/platformer/infinity.ts`, pure data, no Matter.js). `infinityChunk(seed, index): CoursePlan`-like data for one stretch of `CHUNK_W` px (suggest 1600). Rules:
   - **Stateless per chunk.** Chunk *n* depends only on `(seed, n)` and on a few numbers that chunk *n−1* hands over (end height, end slope). Any chunk can be rebuilt on demand, so the same seed always gives the same land (this is what makes "seed of the day" and share-a-seed possible).
   - **Continuous joins.** Floor height and slope match at every chunk boundary (a test checks it: no step above 2 px, slope difference below 0.05).
   - **Hills that keep you rolling.** Not a steady descent (that runs the height off to infinity): the land rolls, with long gentle downhills, short climbs a rolling ball can still make, and now and then a long descent. Average height stays inside a band; the floating origin below keeps coordinates small.
   - **Things.** Chasms (always jumpable at normal speed, or crossed by a rope bridge, see `routes.ts`), springs with a ledge over a chasm, the occasional loop with its boost pad (`routes.ts`), crates to hop, item-free: no power-ups. Three depth lanes as in the platformer, lane gates now and then (ramps and doors) so the lane choice stays part of the feel. Density is low: a lot of calm road between things.
   - **No dead ends.** From any spot a ball that keeps pushing right must be able to go on for ever (a headless test drives a simple bot 20 km and checks it never needs rescue more than a handful of times).
2. **The streaming engine hook.** The engine builds a `Track` once today (`src/game/platformer/build.ts`). Add an *extendable* track: `Game.extendTrack(chunk)` adds the bodies of a new chunk ahead of the marble and `Game.trimTrack(x)` removes everything behind it (about 3 screens back). Keep the cost flat: bodies alive stay within a window around the marble (test it). Classic and normal platformer races must not change at all (`tests/engine-checksum.test.ts` and `tests/platformer.test.ts` unchanged).
3. **Floating origin.** Matter loses precision far from zero. Every `ORIGIN_STEP` px (suggest 40,000) shift the whole world (bodies, marble, camera, plan data) back by that amount and keep a running `distance` counter that does not care. Test: drive 500 km worth of steps in a headless run, positions stay under 100,000 and the physics behaves the same as at the start (same speed for the same slope).
4. **The mode shell** (`src/components/infinity/InfinityScreen.tsx`). Full screen, landscape-first (phone landscape 812x375 is the default; portrait 375 px and desktop must work). HUD: distance in km (soft, small), a pause button, mute, and a **Hide UI** button (photo mode: only the world is on screen; tap anywhere to bring the UI back). No timer, no ranking, no health bar. Pause menu: resume, new seed, leave.
5. **Entry.** A sixth home tab **Infinity** next to Story, Championship, Quick race, Online and Workshop (`src/game/garages.ts` `HOME_TABS`, `src/components/home/HomeTabs.tsx`, `src/components/SetupScreen.tsx`). Left pane: a calm card with the best distance and the seed in use ("Seed of the day" and "My seed", a seed is a short text); middle pane: the goblin and ball (reuse `GaragePanel` with its own garage, like every mode); right pane: your records. One big button: **Roll**. Update the tests that pin the number of tabs (`tests/garages.test.ts`).
6. **Falling and recovery.** Fall into a chasm or off the world: a soft fade, you reappear on the last solid ground with a little hop, no penalty. (Reuse `platformRecovery`'s idea but with the gentle fade and no marshal message.)
7. **Records.** `src/game/infinity-store.ts`: best distance, total distance and last seed, through `src/game/storage.ts` (register the new key). No credits and no XP (nothing to farm, and the point is calm). Stretch: cosmetics that unlock by total distance (a "Dandelion" trail at 10 km), through the existing cosmetics catalogue (`src/game/cosmetics.ts` achievements).
8. **Placeholder look.** Reuse the coaster skin's meadow palette and the existing parallax; keep it plain: this ticket is about the engine. The pretty pass is P2-25.

## Performance and safety targets
- 60 fps on a mid phone with the world running for an hour. Generating one chunk takes under 4 ms (measure it in a test and print it).
- Bodies alive and drawn objects stay bounded (a test asserts the body count never exceeds a limit while driving 50 km).
- Deterministic: the same seed and the same inputs give the same run (replay test over 5 km).
- Fully offline: nothing here touches the network or `src/net/`.

## Files
| | |
|---|---|
| **You own** | new `src/game/platformer/infinity.ts`, new `src/game/infinity-store.ts`, new `src/components/infinity/InfinityScreen.tsx`, new `tests/infinity.test.ts` |
| **Shared: keep edits small, list them** | `src/game/engine.ts` (the `extendTrack` / `trimTrack` / origin-shift hooks only), `src/game/platformer/build.ts` (build one chunk's bodies; reuse `buildLoopBodies` / `buildBridgeBodies` from `routes.ts`), `src/game/platformer/routes.ts` (only if a loop or bridge needs a small change to be placed per chunk), `src/game/garages.ts`, `src/components/home/HomeTabs.tsx`, `src/components/SetupScreen.tsx`, `src/App.tsx` (a phase for the mode), `src/game/storage.ts` (new key), `tests/garages.test.ts` (tab count) |
| **Do not touch** | classic track code, the race engine's physics constants, skills, `src/net/*`, `tests/engine-checksum.test.ts` |

## Rules
- Branch and PR: your branch is created for you; never rename it. Empty commit `P2-24: start`, push, open a **draft PR** "P2-24: Infinity mode" (create the GitHub issue from this file first if you can, and write "Closes #N"). Push after every commit. If you cannot push, work locally and say so.
- Tests: `npx tsc --noEmit -p .` and `node --import tsx --test tests/infinity.test.ts tests/platformer.test.ts tests/platformer-routes.test.ts tests/garages.test.ts tests/engine-checksum.test.ts`. Do not run `tests/browser.test.ts` or `scripts/e2e-mp.mjs`.
- No localStorage (use `src/game/storage.ts`). Physics stays vector shapes (Matter bodies); art is only a skin. Phone landscape 812x375, portrait 375 px and desktop must all work. Do not deploy or merge.
- Finish: `git fetch origin && git rebase origin/main`, re-run the tests, push, mark the PR Ready with What changed / How to try it / Known gaps / Touched outside my files.

## Done when
- **Roll** starts an endless run; the land keeps coming for as long as you drive right; nothing is ever built behind you.
- The same seed gives the same land; chunk joins are continuous; a bot can drive 20 km without being stuck.
- Body count and coordinates stay bounded over a very long run (tests).
- Falling is gentle and free; Hide UI shows only the world; best distance is kept between sessions.
- Classic races and normal platformer courses are unchanged (checksum and platformer tests pass untouched).

## Prompt for the agent (paste as the task)
```text
You are a senior TypeScript/React game engineer on Heavy-Metal-GP (Vite + React + Matter.js, RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your ticket is "P2-24: Infinity mode" (an endless, soothing solo roll). Read docs/arena/P2-24-infinity-mode.md completely first, then src/game/platformer/{course,flow,build,routes,render,coaster}.ts, src/game/engine.ts (how the Track's bodies are added and windowed, `loadedBodies`), src/game/engine/platformer.ts, src/game/garages.ts, src/components/SetupScreen.tsx, src/components/home/HomeTabs.tsx and src/game/storage.ts.

FIRST: empty commit "P2-24: start", push your branch (do not rename it), open a DRAFT PR "P2-24: Infinity mode" (create the GitHub issue first if you can and write "Closes #N"). Push after EVERY commit. If you cannot push, keep working locally and say so.

One commit each, running the spec's tests after each:
1. src/game/platformer/infinity.ts: the stateless chunk generator with continuous joins, and tests (determinism, joins, bounded heights).
2. The engine hooks: extendTrack / trimTrack and the floating origin, with tests (bounded body count, bounded coordinates, same physics at the start and 500 km in).
3. A headless bot that drives 20 km and a test that it is never stuck; fix the generator until it passes.
4. src/components/infinity/InfinityScreen.tsx (HUD, pause, Hide UI, gentle recovery) and src/game/infinity-store.ts (records).
5. The Infinity home tab and its panes, and the App phase; update the tab-count tests.

Rules: stay inside the files the spec lists; keep shared edits small and list them under "Touched outside my files". Never use localStorage. Do not run tests/browser.test.ts or scripts/e2e-mp.mjs. engine-checksum and platformer tests must pass unchanged. Do not deploy or merge. Final: git fetch origin && git rebase origin/main, re-run tests, push, mark the PR Ready with What changed / How to try it / Known gaps.
```

---

# P2-25: Infinity mode, the beautiful and soothing pass (after P2-24 merges)

**Blocked by P2-24.** Same land, made lovely. This is the part that turns a tech demo into something you leave on in the evening. The owner's brief: *very pretty and soothing*. Spend RUN.world credits freely (unlimited per the handover); do a dry run first (`rundot whoami`, count and estimate), and if `rundot` does not work, commit the generation script and manifest and add the checklist item "needs asset generation run".

## What to build
1. **Biomes by distance**, blended slowly (a crossfade over about 1 km, never a hard cut): sunrise meadow, green valley with a stream, misty pine forest, autumn hills, a still lake with reflections, snowfields, a starry night with fireflies and a faint aurora, then back to dawn. A biome is a palette, a ground skin, a set of scenery props and a particle type (see 3). The cycle repeats and the seed varies the order.
2. **Time of day** drifting with distance (and a slow real-time drift when you stand still): the sky gradient, the sun or moon, light on the ball, long soft shadows, stars appearing. Smooth, no flicker.
3. **Layers and life.** At least four parallax layers (far mountains, mid hills, near trees, foreground grass), grass and flowers that sway in a wind that changes slowly, clouds, birds, butterflies, drifting particles per biome (petals, leaves, snow, fireflies), a gentle depth blur or haze on the far layers, a soft vignette. Props are drawn from vectors or from generated art under `src/assets/infinity/` (a texture atlas keeps it fast); keep the draw count flat (cull by chunk).
4. **The ball and trail.** A soft glowing trail that fades with speed, little dust puffs on landings, a ripple when crossing water, the ball's shadow on the ground. Uses the player's chosen ball skin (`ball-skin.ts`).
5. **Sound.** A generative ambient bed (slow evolving pads, a few soft plucked notes picked from a scale that changes with the biome), a rolling sound whose pitch and volume follow speed, soft landing thuds, a chime at every kilometre. Everything quiet by default, one mute button, honours the existing mute setting. Voice-over is not wanted here.
6. **Gentle pacing.** The camera eases (a little lead in the direction of travel, a slow zoom out at speed), no screen shake, no flashes, no sudden loud sounds, no text pop-ups other than the km chime label. Respect a Reduce motion setting (fewer particles, no sway).
7. **Photo mode.** The Hide UI button from P2-24 plus a **Save picture** button that writes the current frame as an image (offer it as a download or the share sheet where the host allows it).
8. **Accessibility and comfort.** Colour choices pass contrast for the HUD, the HUD can be hidden, a Reduce motion toggle, large touch targets. Works in landscape 812x375, portrait 375 px and desktop; never drops below 30 fps on a mid phone (drop particle counts automatically if it does).

## Files
| | |
|---|---|
| **You own** | new `src/game/infinity-look.ts` (biomes, palettes, time of day), new `src/game/infinity-audio.ts`, new `src/components/infinity/InfinityRender.ts` (the canvas painter) and `InfinityHud.tsx`, new assets under `src/assets/infinity/`, new `scripts/infinity/generate.mjs` and its manifest, new `tests/infinity-look.test.ts` |
| **Shared: keep edits small** | `src/components/infinity/InfinityScreen.tsx` (P2-24), `src/game/platformer/infinity.ts` (scenery props per chunk: data only, no physics), `src/game/ball-skin.ts` (nothing, only call it), `src/game/storage.ts` (a `reduceMotion` and `infinityMuted` key if not present) |
| **Do not touch** | physics, the classic renderers, the race engine, `src/net/*` |

## Rules
Same as P2-24, plus: draw only what is on screen, never allocate in the frame loop, cache every gradient and sprite; assets must be small (a total under 6 MB for the mode); credits are unlimited but do the dry run first and keep the work sensible. Tests: `npx tsc --noEmit -p .` and `node --import tsx --test tests/infinity-look.test.ts tests/infinity.test.ts tests/platformer.test.ts tests/engine-checksum.test.ts`.

## Done when
- Driving through 10 km shows at least five different biomes blending smoothly, a full day and night, living scenery and particles, with a calm ambient sound.
- Reduce motion and mute work; Hide UI and Save picture work; 30 fps holds on a phone profile in the browser pane's mobile preset.
- Tests cover the biome blend (no jumps in the palette), the time-of-day curve, the audio scheduler (note choice, quiet defaults, mute) and the cull (draw count bounded).

## Prompt for the agent (paste as the task)
```text
You are a senior TypeScript/React game engineer and technical artist on Heavy-Metal-GP (Vite + React + Matter.js, RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your ticket is "P2-25: Infinity mode, the beautiful and soothing pass". P2-24 must already be merged; if src/components/infinity/InfinityScreen.tsx does not exist, stop and say so. Read docs/arena/P2-24-infinity-mode.md completely (both tickets), then src/components/infinity/*, src/game/platformer/infinity.ts, src/game/platformer/coaster.ts (the existing look), src/game/ball-skin.ts and src/game/storage.ts.

FIRST: empty commit "P2-25: start", push your branch (do not rename it), open a DRAFT PR "P2-25: Infinity mode, the beautiful pass". Push after EVERY commit; if you cannot push, keep working locally and say so.

Work slowly and show the result often: one commit each, tests after each:
1. infinity-look.ts: biomes, palettes, the slow blend, time of day, with tests.
2. The painter: parallax layers, sky, ground skin per biome, culling by chunk.
3. Life: sway, particles, birds and butterflies, the ball trail and landing dust.
4. infinity-audio.ts: the generative ambient bed, rolling sound, kilometre chime, mute.
5. Photo mode (Save picture), Reduce motion, the auto particle budget.
6. Generated art (run `rundot whoami`; do a dry run first; if it does not work commit scripts/infinity/generate.mjs and the manifest and add the PR checklist item "needs asset generation run").

Rules: calm above all: no flashes, no shake, no sudden sounds. Draw only what is on screen; never allocate in the frame loop. Never use localStorage. Do not run tests/browser.test.ts or scripts/e2e-mp.mjs. Do not deploy or merge. Final: git fetch origin && git rebase origin/main, re-run tests, push, mark the PR Ready with What changed / How to try it / Known gaps.
```
