# P2-20: Finish the unwired Phase 2 features

**Phase 2 · part of #106** · four small jobs, one commit each, in this order.

## Why
Health, skills, loadout, talents, XP and online health are built and merged, but four things are still not connected. Until they are, some game modes ignore the new systems.

## Jobs
1. **Championship and story XP + purse.** Offline platformer races already call `awardRaceXp` and `settleRace(account, raceId, result, scale, mode)` (see `src/game/economy.ts`, `src/game/settlement.ts`, `src/game/progression.ts`). Championship rounds and story races must do the same: XP once per race id, KO bounty paid, Shaman fee charged (offline modes), and the level-up card shown on the results screen (`src/components/progression/LevelUpCard.tsx`). Find where championship and story results are settled (search for `settleRace` / `settleChampionship` in `src/App.tsx` and `src/components/`) and wire them.
2. **Per-mode loadouts.** Today there is one loadout (8 slots, `src/game/loadout.ts`, `loadout-store.ts`, key `heavy-metal-gp:loadout:v1`). Make it one loadout per mode: `quick`, `championship`, `story`, `online`. Storage goes through `src/game/storage.ts`, never localStorage. A mode with no saved loadout falls back to the old shared one (migration, no data loss). `LoadoutScreen.tsx` gets a mode switch; each race reads the loadout for its own mode.
3. **Driver talent tree.** A sixth tree in `src/game/talents.ts` (`TREES`, `TALENTS`) for the driver (not the car): tier 1-4, same rules as the others (tier level gates, points needed below). Suggested talents: Quick Reflexes (shorter lane-switch time), Steady Hands (less speed lost on landing), Second Wind (bigger HP regen delay cut), Lucky Draw (better item-box drops). Apply them through `applyTalents` / `m.tfx` like the other trees, add the tab and colour in `src/components/talents/TalentsScreen.tsx`, and extend `tests/talents-wiring.test.ts`.
4. **Host loadout budget online.** In an online race the host decides how many skills each seat may bring (a budget, default 8 slots, host can lower it). Add `RaceSettings.loadoutSlots?: number` (1-8) in `src/net/protocol.ts`, a host-only control in `src/components/OnlineLobby.tsx`, and make the host trim each seat's loadout to the budget (the host is the authority; guests only display). This changes the wire, so bump `PROTOCOL_VERSION` (currently 8).

## Files
| | |
|---|---|
| **You own** | `tests/unwired.test.ts` (new) |
| **Shared: keep edits small** | `src/game/economy.ts`, `src/game/talents.ts`, `src/game/loadout.ts`, `src/game/loadout-store.ts`, `src/components/loadout/LoadoutScreen.tsx`, `src/components/talents/TalentsScreen.tsx`, `src/components/OnlineLobby.tsx`, `src/net/protocol.ts`, `src/net/host.ts`, `src/App.tsx`, `tests/talents-wiring.test.ts`, `tests/protocol.test.ts` |
| **Do not touch** | platformer course code, renderers, `tests/engine-checksum.test.ts` and its golden file |

## Rules
- Branch and PR: your branch is created for you; never rename it. Make an empty commit `P2-20: start`, push, open a **draft PR** titled "P2-20: Finish the unwired Phase 2 features". Push after every commit. If you cannot push, work locally and say so; the owner will open the PR.
- Tests: `npx tsc --noEmit -p .` and `node --import tsx --test tests/unwired.test.ts tests/talents-wiring.test.ts tests/xp-wiring.test.ts tests/skills.test.ts tests/protocol.test.ts tests/host.test.ts tests/engine-checksum.test.ts tests/platformer.test.ts`. Do not run `tests/browser.test.ts` or `scripts/e2e-mp.mjs`.
- `tests/engine-checksum.test.ts` must pass unchanged (classic races must not change).
- No localStorage. 375 px phone portrait must stay readable. Don't deploy, don't merge.
- Finish: `git fetch origin && git rebase origin/main`, re-run tests, push, mark the PR Ready with **What changed / How to try it / Known gaps / Touched outside my files**.

## Done when
- A championship round and a story race each pay XP (once) and the purse, and show the level-up card.
- The loadout screen has a mode switch; two modes can hold different loadouts; an old save still loads.
- The Driver tree shows in the talents screen and its talents change a race (tested).
- An online host can lower the loadout budget and a guest's extra skills are trimmed by the host.

## Prompt for the agent (paste as the task)
```text
You are a senior TypeScript/React game engineer on Heavy Metal GP (Vite + React + Matter.js, RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Read docs/arena/P2-20-finish-unwired.md completely first, then src/game/economy.ts, settlement.ts, progression.ts, loadout.ts, loadout-store.ts, talents.ts, src/components/loadout/LoadoutScreen.tsx, src/components/talents/TalentsScreen.tsx, src/net/protocol.ts, host.ts and src/App.tsx.

FIRST: make an empty commit "P2-20: start", push your branch (do not rename it), open a DRAFT PR "P2-20: Finish the unwired Phase 2 features". Push after EVERY commit. If you cannot push, keep working locally and tell me.

Four jobs, one commit each, running the spec's tests after each:
1. Championship and story results: XP once per race id, KO bounty, Shaman fee, level-up card.
2. Per-mode loadouts (quick, championship, story, online) with a fallback to the old shared loadout, and a mode switch on the loadout screen.
3. A Driver talent tree (4 tiers, applied through applyTalents) with tests.
4. Host loadout budget online (RaceSettings.loadoutSlots, lobby control, host trims seats, PROTOCOL_VERSION bump).
Then tests/unwired.test.ts covering each job.

Rules: stay inside the listed files, keep shared edits small and list them in the PR under "Touched outside my files". Never use localStorage (use src/game/storage.ts). engine-checksum must pass unchanged. Do not run tests/browser.test.ts or scripts/e2e-mp.mjs. Don't deploy or merge. Final: git fetch origin && git rebase origin/main, re-run tests, push, mark the PR Ready with What changed / How to try it / Known gaps.
```
