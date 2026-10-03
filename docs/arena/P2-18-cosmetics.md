# P2-18: Ball customisation (cosmetic, unlockable)

**Phase 2 · issue #126** · part of #106. Purely cosmetic: physics, stats and skills are not touched.

## Why
Today you only pick one of 7 colours. Players want their ball to be their own.

## What to build
1. **Catalogue** (`src/game/cosmetics.ts`): materials (10: Steel default, Chrome, Brass, Rusty Iron, Oak, Granite, Glass, Lava, Ice, Gold), primary and secondary colour from a 24-swatch palette, patterns (12: plain, stripes, racing band, checker, flames, skull, goblin face, number 00-99, team logo, stars, cracks, rivets), trails (8: none, smoke, sparks, fire, ice crystals, rainbow, coins, ghost wisps), KO bursts (4), finish celebrations (4).
2. **Unlocks:** a few free starters; every other item unlocks by **level** (`progressOf(account).level` in `src/game/economy.ts`), with **credits** in a Cosmetics tab of the shop, or by **achievement** (first win, 10 KOs, campaign complete, 50 orange pegs in one race, and similar). A locked item always says exactly how to unlock it.
3. **Rendering** (`src/game/ball-skin.ts`): draw the ball (material, colours, pattern) once into a cached offscreen canvas per marble and redraw only when the look changes; each frame draw that sprite rotated with the body angle; trails use the existing trail points. Budget: 10 balls at 60 fps on a phone. **Procedural vector art only, no generated textures, no credits spent.** The platformer renderer (`src/game/platformer/render.ts`) must draw the same skin.
4. **Garage:** a Ball panel with a big spinning live preview, categories as tabs, locked items with their hint. Cosmetics are global (the same ball in every mode). Mount it where the garage now keeps the driver (see `src/components/SetupScreen.tsx` and `src/components/home/`).
5. **Multiplayer:** cosmetic ids travel in `SeatGarage`, are validated against the catalogue (unknown becomes default), every screen renders everyone's ball. Bump `PROTOCOL_VERSION` (currently 9).
6. Storage through `src/game/storage.ts` (register new keys); old saves load with the default ball.

## Files
| | |
|---|---|
| **You own** | new `src/game/cosmetics.ts`, new `src/game/ball-skin.ts`, new `src/components/garage/BallCustomizer.tsx`, new `tests/cosmetics.test.ts` |
| **Shared: keep edits small** | `src/game/render.ts` (`drawMarble` calls ball-skin), `src/game/platformer/render.ts` (marble draw only), `src/components/SetupScreen.tsx` or the home driver pane (mount the panel), `src/game/economy.ts` (owned cosmetics, purchases, migration), `src/components/PitShop.tsx` (Cosmetics tab), `src/net/protocol.ts`, `src/net/lobby.ts` |
| **Do not touch** | physics, stats, skills, `tests/engine-checksum.test.ts` |

## Rules
- Branch and PR: your branch is created for you; never rename it. Empty commit `P2-18: start`, push, open a **draft PR** "P2-18: Ball customisation" with "Closes #126". Push after every commit. If you cannot push, work locally and say so.
- Tests: `npx tsc --noEmit -p .` and `node --import tsx --test tests/cosmetics.test.ts tests/protocol.test.ts tests/lobby.test.ts tests/host.test.ts tests/guest.test.ts tests/engine-checksum.test.ts tests/platformer.test.ts`. Do not run `tests/browser.test.ts` or `scripts/e2e-mp.mjs`.
- No localStorage. Phone portrait 375 px, landscape 812x375 and desktop must work. Don't deploy or merge.
- Finish: `git fetch origin && git rebase origin/main`, re-run the tests, push, mark the PR Ready with What changed / How to try it / Known gaps / Touched outside my files.

## Done when
- The garage Ball panel previews and saves a look; locked items show their hint; credits and achievement unlocks work.
- Both race renderers draw the skin; a guest sees the host's chosen ball and an unknown id falls back to the default.
- Tests cover the catalogue (counts, unique ids), unlock rules, migration of old saves, the wire validation, and the skin cache (redraw only on change).

## Prompt for the agent (paste as the task)
```text
You are a senior TypeScript/React game engineer on Heavy-Metal-GP (Vite + React + Matter.js, RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Your ticket is issue #126, "P2-18: Ball customisation". Read docs/arena/P2-18-cosmetics.md completely first, then src/game/render.ts (drawMarble), src/game/platformer/render.ts, src/game/economy.ts, src/components/PitShop.tsx, src/components/SetupScreen.tsx, src/net/protocol.ts and lobby.ts (SeatGarage), and src/game/storage.ts.

FIRST: empty commit "P2-18: start", push your branch (do not rename it), open a DRAFT PR "P2-18: Ball customisation" with "Closes #126". Push after EVERY commit. If you cannot push, keep working locally and say so.

One commit each, running the spec's tests after each:
1. src/game/cosmetics.ts: catalogue, unlock rules, owned-items storage and migration, tests.
2. src/game/ball-skin.ts: procedural cached sprite per marble, wired into both renderers.
3. The Ball panel in the garage (live spinning preview, category tabs, unlock hints) and the Cosmetics tab in the shop.
4. Multiplayer: cosmetic ids in SeatGarage, validated, rendered for everyone, PROTOCOL_VERSION bump.
5. tests/cosmetics.test.ts covering the spec's Done-when list.

Rules: stay inside the files the spec lists; keep shared edits small and list them under "Touched outside my files". Procedural art only, spend no credits. Never use localStorage. Do not run tests/browser.test.ts or scripts/e2e-mp.mjs. engine-checksum must pass unchanged. Do not deploy or merge. Final: git fetch origin && git rebase origin/main, re-run tests, push, mark the PR Ready with What changed / How to try it / Known gaps.
```
