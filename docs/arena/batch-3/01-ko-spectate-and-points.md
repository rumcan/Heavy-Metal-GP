# Work item 1: KO spectating, KO points and the KO column (finishes #113)

Copy everything inside the box below into the Arena agent as its task. It is self-contained.

```text
You are a senior TypeScript/React game engineer on Heavy-Metal-GP, a marble racing game (Vite + React + Matter.js, deployed on RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Work only in this repository.

YOUR TASK: finish GitHub issue #113 (P2-07 Health and DNF). Health, damage, DNF, KO credit and KO bounties already work. Three parts of the issue were never built:
1. Spectating. When the local player is knocked out (marble.dnf becomes true), the race camera follows the marble that knocked them out for 3 seconds, then follows the race leader. Show a small banner "Knocked out by <name>" during those 3 seconds (or "Knocked out" when there is no killer, a hazard). When only AI drivers remain, offer the existing fast-forward button. Today the screen just waits and then shows the results.
2. Championship KO points: +2 championship points per KO in the standings (src/game/season.ts). Heat results already carry `kos` (HeatResult.kos in src/game/types.ts). Keep the change small: where points are added up, add 2 x kos.
3. A KO column in the race results table (src/components/RaceResults.tsx) and in the championship standings, shown only when at least one driver has a KO or a DNF in that table. DNF rows already exist; make sure they read "DNF".

READ FIRST, completely: gh issue view 113; then src/components/RaceScreen.tsx (the camera block: search for `following` and `finishHold`), src/game/engine.ts (search `killer`, `knockOut`, `kos`, `dnf`), src/game/season.ts (pointsFor, the standings function), src/components/RaceResults.tsx, src/components/ChampionshipScreen.tsx, src/game/types.ts (HeatResult).

STEP 0, BEFORE ANY CODE (do this in your first minutes):
- Your branch is created for you. Never rename it. Start from the latest origin/main (git fetch origin && git rebase origin/main).
- Make an empty commit: git commit --allow-empty -m "P2-07b: start"
- Push it: git push -u origin HEAD
- Open a DRAFT pull request right away: gh pr create --draft --title "P2-07b: KO spectating, KO points and the KO column" --body "Refs #113. Work in progress."
- From then on, git push after EVERY commit. Small commits, often. The GitHub token can expire during long runs: pushed work is never lost.
- If git push or gh fails with an auth error, do NOT ask for a token and do NOT try to log in: keep committing locally and say so clearly at the top of your final message.

FILES:
- You own: new tests/ko-spectate.test.ts, new src/game/spectate.ts (the pure camera-target rule: who to follow, for how long).
- Shared, keep edits small and list each one in the PR under "Touched outside my files": src/components/RaceScreen.tsx (camera target and the banner only), src/game/season.ts (the points sum only), src/components/RaceResults.tsx, src/components/ChampionshipScreen.tsx, a few lines of CSS.
- Do not touch: physics, src/net/*, the platformer course code, tests/engine-checksum.test.ts and its golden file.

TESTS, EXACTLY THESE:
- Run after every commit: npx tsc --noEmit -p .
- Run after every commit: node --import tsx --test tests/ko-spectate.test.ts tests/health-rules.test.ts tests/online-health.test.ts tests/engine-checksum.test.ts
  (if one of those files does not exist, skip it and say so; do not create it just to make the command pass)
- DO NOT RUN tests/browser.test.ts (slow Playwright suite) and DO NOT RUN scripts/e2e-mp.mjs (multiplayer end-to-end). The reviewer runs those. Do not run the whole tests/ folder either: it takes many minutes.
- tests/engine-checksum.test.ts must pass UNCHANGED. Never edit it or its golden file.
- Do not pin exact constants in tests (for example never assert PROTOCOL_VERSION === 10; use >=).
- Your new tests must cover: the spectate rule (killer for 3 s then the leader; no killer goes straight to the leader; the killer itself out goes to the leader), 2 points per KO in the standings, and that the KO column only shows when there is a KO or DNF.

HARD RULES:
- Never use localStorage or sessionStorage (RUN.world blocks them). Use src/game/storage.ts if you need to store anything.
- Physics stays vector shapes (Matter.js bodies); art is only a skin.
- Every screen must work on a phone in portrait (375 px wide), in landscape (812x375) and on desktop.
- Do not change any multiplayer message. If you find you must, bump PROTOCOL_VERSION in src/net/protocol.ts and say why.
- Do not deploy (no rundot deploy), do not merge, do not edit rundot/ config.
- Keep the same code style as the files around you (comment density, naming).

FINISH:
1. git fetch origin && git rebase origin/main, fix conflicts, re-run the tests above, push.
2. Mark the PR Ready for review (gh pr ready) and set its body to four short sections: What changed / How to try it (exact clicks and keys) / Known gaps / Touched outside my files. Keep "Refs #113" in the body.
3. Your final message: the PR link, the test output (pass/fail counts), and anything you could not do.
```
