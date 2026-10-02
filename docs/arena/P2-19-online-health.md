# P2-19: Online health, DNF, KOs and skill effects on the wire

**Phase 2 · follow-up to #113, #114, #117** · part of #106

## Why
Health, DNF, KO bounties and the 16 new skills work in offline platformer races, but are switched off online (`Game.healthOn = !!track.platformer && !wireEvents`). Online races on platformer courses have no health, and the new skills' effects (bolts, bombs, spikes, decoys, shield bubbles) are invisible to guests. This ticket makes them work for multiplayer, host-authoritative like everything else.

## What to build
1. **Turn health on for the host.** The host simulates health (it is the single source of truth). Remove the `!this.wireEvents` condition in `src/game/engine.ts` so a host with `wireEvents` also has `healthOn`.
2. **Health on the wire.** Add each marble's HP and DNF flag to what guests receive:
   - state frames: one more byte per marble: `hp` as 0..255 (round(hp / maxHp * 255)) in a new `hp` byte, and DNF in a spare bit of the flags byte (`FLAG_*` in `src/net/protocol.ts`; bit layout is documented there). Update `packState` / `unpackState`, `BYTES_PER_MARBLE`, `packedStateLength`, and the pinned layout test in `tests/protocol.test.ts` (this is a deliberate wire change).
   - snapshots (`RaceSnapshot`): `hp`, `dnf`, `kos` per marble, validated in `isRaceSnapshot`.
3. **Events for what guests cannot derive.** Add race events (see `RaceEvent` in `src/net/protocol.ts`, validated in `readEvent`), each applied on the guest in `src/net/guest.ts`: `ko` (victim seat, killer seat or -1), `skillfx` (kind: 'bolt' | 'bomb' | 'spikes' | 'decoy' | 'shield' | 'reflect' | 'emp', owner seat, target seat, x, y, until) so guests can draw projectiles and auras. Guests must **never** simulate these (they only draw). Mirror the existing `freeze` / `oil` events.
4. **Guest drawing.** `src/game/skills/draw.ts` already draws bolts, bombs, spikes, decoys and auras from `game.projectiles` / `game.bombs` / `game.spikes` / `game.decoys` / `marble.fx`. A guest should fill those arrays from the events (position only) so the same drawing works. DNF marbles are hidden on the guest. The HUD health bar uses `marble.health` and `marble.maxHp`: set them from the frames.
5. **Purse and XP online.** `settleOnlineRace` in `src/game/economy.ts` pays from the host's classification. Add `dnf` and `kos` to the wire result rows (`ResultMsg`) and use them: KO bounties and XP apply online; the Shaman's fee is **free online** (`shamanFee('online')` is 0, already in `src/game/settlement.ts`). Award XP online once per race id (`awardRaceXp`).
6. **Talents online (host rule).** Add `RaceSettings.talents?: boolean` (default true; ranked races are always off). A guest sends its validated build with its garage (`SeatGarage.talents`, validated with `validateBuild(raw, level, points)` from `src/game/talents.ts`). The host calls `game.applyTalents(marble, build, slots)` for that seat. Add the host toggle in `src/components/OnlineLobby.tsx`.
7. **Bump `PROTOCOL_VERSION`** (currently 7) in `src/net/protocol.ts`.

## Files
| | |
|---|---|
| **You own** | new `tests/online-health.test.ts` |
| **Shared: keep edits small** | `src/net/protocol.ts`, `src/net/host.ts`, `src/net/guest.ts`, `src/net/session.ts`, `src/game/engine.ts` (one line: `healthOn`; emit events from `damage` / `knockOut` / skill effects), `src/game/skills/effects.ts` (emit `skillfx` events), `src/game/economy.ts`, `src/components/OnlineLobby.tsx`, `tests/protocol.test.ts` (pinned bytes), `tests/guest.test.ts`, `tests/host.test.ts` |
| **Do not touch** | the platformer course code, the renderers, the loadout screen, the talent tree rules |

## Rules (every agent)
- **Branch and PR:** your branch is created for you; never rename it. Start from the latest `origin/main`. Within your first minutes make an empty commit `P2-19: start`, push, and open a **draft PR** titled "P2-19: Online health, DNF, KOs and skill effects on the wire" whose body contains "Closes #164" (use the real issue number). Then `git push` after **every** commit.
- **Testing:** run `npx tsc --noEmit -p .` and `node --import tsx --test tests/online-health.test.ts tests/protocol.test.ts tests/guest.test.ts tests/host.test.ts tests/session.test.ts tests/engine-checksum.test.ts tests/platformer.test.ts tests/skills.test.ts tests/talents-wiring.test.ts`. Do **not** run `tests/browser.test.ts` or `scripts/e2e-mp.mjs`. Known to fail on main already (not yours): "MP-04 host: a full race completes…".
- `tests/engine-checksum.test.ts` must still pass unchanged (classic races must not change).
- Never use `localStorage`; use `src/game/storage.ts`. Physics stays vector shapes. Only `src/net/transport.ts` imports the RUN realtime SDK. A frame must stay under `FRAME_CAP_BYTES`.
- Don't deploy, don't merge.
- Finish: `git fetch origin && git rebase origin/main`, re-run the tests, push, mark the PR Ready for review with **What changed / How to try it / Known gaps**.

## Done when
- A host and a guest in a platformer race (see `tests/room-harness.ts` and `tests/host.test.ts` for how to run a host and a guest in one process) see the same HP, the same KO and DNF, and the guest draws bolts and bombs.
- Unit tests in `tests/online-health.test.ts` cover: pack/unpack of hp and dnf, snapshot validation, each new event (valid, invalid), a host race where a marble is knocked out and the guest's classification matches, and the online purse (KO bounty paid, no Shaman fee).

## 🤖 Prompt for the agent (paste this as the task)

```text
You are a senior TypeScript/React game engineer working on Heavy Metal GP (Vite + React + Matter.js, deployed on RUN.world). The repository is https://github.com/rumcan/Heavy-Metal-GP. Your ticket is the GitHub issue "P2-19: Online health, DNF, KOs and skill effects on the wire": the full spec is docs/arena/P2-19-online-health.md in the repository (read it first, completely), then read src/game/engine.ts (healthOn, damage, knockOut, applyTalents), src/game/skills/effects.ts and draw.ts, src/net/protocol.ts, host.ts, guest.ts, session.ts, src/game/economy.ts and tests/protocol.test.ts, tests/host.test.ts, tests/guest.test.ts.

FIRST, within your first few minutes: make an empty commit "P2-19: start", push your branch (do not rename it), and open a DRAFT pull request titled "P2-19: Online health, DNF, KOs and skill effects on the wire" with "Closes #164" in the body. Then push after EVERY commit.

Do it in this order, one commit each, running the tests listed in the spec after each:
1. Health on for the host; hp + dnf in state frames (update the pinned bytes test on purpose); snapshot fields.
2. The ko and skillfx events, host side and guest side.
3. Guest drawing from the events; the HUD reads marble.health and maxHp.
4. Online purse and XP from dnf and kos in the result rows.
5. Talents online: RaceSettings.talents, SeatGarage.talents, host validation and applyTalents, the lobby toggle.
6. Bump PROTOCOL_VERSION.
7. tests/online-health.test.ts.

Rules: stay inside the files the spec lists; keep edits to shared files small and list them in the PR under "Touched outside my files". Never use localStorage. Do not run tests/browser.test.ts or scripts/e2e-mp.mjs. tests/engine-checksum.test.ts must pass unchanged. Do not deploy or merge. Before your final push: git fetch origin && git rebase origin/main, re-run the tests, then mark the PR Ready for review with What changed / How to try it / Known gaps.
```
