# Handover for the next AI (written 2026-10-03)

Repo: https://github.com/rumcan/Heavy-Metal-GP (local: `C:\Work Admin\PERSONAL\Repos\Heavy-Metal-GP`, Windows, Git Bash + PowerShell). Owner: Francois Smit (rumcan). Stack: Vite single-file build, React, Matter.js, RUN.world SDK (`rundot` CLI).

## Standing rules (the owner's, do not break)
- Flow: **branch -> PR -> merge**. Deploy (`rundot deploy`, `rundot game set-public`) **only when the owner says "push and publish"**. The owner said: **no publishing until everything is built, all tests fixed and the game is play-tested.**
- No `localStorage`: use `src/game/storage.ts` and register keys. Physics stays vector shapes; art is only a skin.
- Check phone portrait 375 px, phone landscape 812x375, and desktop.
- Never put a GitHub token or credential into a third-party chat. Never push or open PRs for the owner's Arena agents when the owner said they will.
- "Just use your best judgement and build it. Make the recommended decision and keep going."
- Look and feel work is **parked until the end**.
- Tickets must be very clear and include an AI prompt. Agents: PR-first, push every commit, start slowly (one module per Arena battle; wait for "Context received" before message 2).
- Auto-mode classifier blocked one `gh pr merge` once ("merge without review"); the owner said "try again" and it worked. Review (tsc + the ticket's tests + read the shared-file edits) before merging.

## State of main (everything below is merged, NOTHING since v1.30.0 is deployed)
Phase 2 epic #106 is built except the items under "Open work". Merged since v1.30.0: platformer courses (lanes, coaster look, cannon start, owner's art), health/DNF/KO, 24 skills, progression/XP, loadout, AI brain, talents, online health on the wire (#166), P2-20 unwired features (#168: championship+story XP and purse, per-mode loadouts, Driver talent tree, host loadout budget online), tutorial (#171), ball customisation (#173), and test fixes (#167, #169, #174).
- `PROTOCOL_VERSION` is **10**. A deploy must be atomic for anyone in a lobby (old tabs are refused with "reload to race together").
- Last deployed: v1.30.0.

## Tests
- `npx tsc --noEmit -p .` is clean.
- `node --import tsx --test tests/*.test.ts`: everything passes **except the Browser tests** in `tests/browser.test.ts` (they drive the old garage UI and time out; the game now opens on home tabs: Story, Championship, Quick race, Online, Workshop; see `src/components/SetupScreen.tsx`, `src/components/home/*`). Job D below fixes them. `tests/engine-checksum.test.ts` (golden file) must always pass unchanged: classic races are deterministic.
- Do not pin `PROTOCOL_VERSION` exactly in tests (use `>=`); two tests broke that way.
- Race safety checks live in `src/game/regressions.ts` (run by `tests/physics.test.ts`); full-field heats race the shipped archived circuits (`officialTrack(id)`), not the procedural generator.

## Arena agents (AI Arena "Agent Mode", the owner runs them and does the PRs)
Prompts and specs are in `docs/arena/`:
- `NEXT-AGENT-JOBS.md`: **A** #118 scaffold tunnels, **B** P2-21 loops and rope bridges, **C** P2-22 Workshop tools for platformer courses (after A merges), **D** P2-23 rewrite the browser tests. A, B, D run in parallel. Check which the owner already started (`gh pr list`).
- Done and merged: P2-19 (`P2-19-online-health.md`), P2-20 (`P2-20-finish-unwired.md`), P2-13 tutorial (`P2-13-tutorial.md`), P2-18 cosmetics (`P2-18-cosmetics.md`).
- When the owner pastes "PR #N is Ready": `gh pr view N`, fetch `pull/N/head`, run tsc and the ticket's tests plus engine-checksum, skim the shared-file edits, merge, and fix any test that pins a changed constant.
- The agent cannot push to GitHub sometimes (no credentials): it then works locally and the owner pushes.

## Open work, in order
1. Agent jobs A, B, D (then C). Review and merge each.
2. **Game test** (no deploy): phone portrait/landscape and desktop. Platformer race, online host + guest race, Loadout, Talents, Ball customizer, tutorial prologue, a classic race. Use the Browser pane (`.claude/launch.json` dev server on port 5173; the dev server was stopped during a reinstall and may need `preview_start`).
3. Scheduled for later (spend RUN.world credits; need `rundot whoami` to work, dry run first): story voice-over #120, Workshop voice tour #121 (after A and C), tutorial audio (about 404 credits: `node scripts/voice/generate.mjs --set tutorial --cap 1500`), 16 new skill icons (about 2,400 credits, glyph placeholders in `src/components/ItemGlyph.tsx`), the look-and-feel pass (platformer art, backdrops, owner's art in `assets/new-art/`, which is git-ignored; converted copies live in `src/assets/game/platformer/`).
4. Not wired / polish: the 2x4 skill bar polish (#107), per-mode loadouts exist but host budget only trims by skill-type count, the Workshop voice tour, cosmetics art is procedural only.
5. When all of the above is done and the owner says so: bump version, `rundot deploy`, and `rundot game set-public` only if asked.

## Pitfalls (learned the hard way)
- **node_modules / worktrees:** `git worktree remove --force` on a worktree with a `node_modules` junction deleted files from the real `node_modules`. Do not junction `node_modules`; if broken: stop any running Vite dev server (it locks `lightningcss`), then `npm ci --legacy-peer-deps`.
- Windows: `sed` with escaped dots is fragile (use `perl -pi -e`); no `python`; very large heredocs in Bash can fail to parse (use the Write tool for long docs). CRLF warnings on commit are harmless.
- `rundot` prints "update available"; ignore. Never try to log in for the owner.
- `src/game/types.ts` must stay pure; classic tracks keep the legacy item pool (`Game.dropPool` only for loadouts); classic engine code paths must not change (checksum).
- Arena workspace can go over budget (output may be incomplete): check the bundle/PR has everything.

## Key code map
- Platformer: `src/game/platformer/{course,flow,build,render,coaster}.ts`, `src/game/engine/platformer.ts` (AI `decide()`), lane rules `src/game/lanes.ts`.
- Health/skills: `src/game/health.ts`, `settlement.ts`, `skills/{catalog,effects,draw}.ts`, `loadout*.ts`, `talents.ts`, `progression.ts`, `ai-brain.ts`, `cosmetics.ts`, `ball-skin.ts`.
- Online: `src/net/{protocol,host,guest,session,lobby}.ts`; tests `tests/{protocol,host,guest,online-health,unwired}.test.ts`.
- Story/tutorial: `src/game/story/*`, `src/components/story/*`, voice in `src/voice/manifests/*` and `scripts/voice/generate.mjs`.
- Economy: `src/game/economy.ts` (`settleRace`, `awardRaceXp`, `progressOf`, talents, cosmetics).
- Auto-memory for this project: `C:\Users\Francois Smit\.claude\projects\C--Work-Admin-PERSONAL-Repos-Heavy-Metal-GP\memory\` (ticket format, release flow). Full previous transcripts: `C:\Users\Francois Smit\.claude\projects\C--Work-Admin-PERSONAL-Repos-Heavy-Metal-GP\3e5ea183-ce72-4bd0-b73a-357799ed2847.jsonl`.
