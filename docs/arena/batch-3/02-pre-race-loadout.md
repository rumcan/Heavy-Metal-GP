# Work item 2: pick your loadout before every race (finishes #116)

Copy everything inside the box below into the Arena agent as its task. It is self-contained.

```text
You are a senior TypeScript/React game engineer on Heavy-Metal-GP, a marble racing game (Vite + React + Matter.js, deployed on RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Work only in this repository.

YOUR TASK: finish GitHub issue #116 (P2-10 Loadout). The loadout already exists: 8 skill slots per mode (quick, championship, story, online) stored by src/game/loadout-store.ts (loadSlots(mode) / saveSlots(slots, mode)), edited in src/components/loadout/LoadoutScreen.tsx, which today only opens from the Pit shop / wallet button. The race toolbar already reads the mode's slots (RaceScreen loadoutMode prop). What is missing is the issue's step 1:
1. When the player presses the big Race / Start / Continue button in Quick race, Championship (each Grand Prix start) and Story (each chapter race), show the loadout screen first, for THAT mode, before the loading screen. It has two buttons: "Race with this loadout" (saves and goes on) and "Same as last time" (goes on with no change). It is skipped automatically for the tutorial course and for Infinity mode (no skills there).
2. A setting to skip the screen: a checkbox on the screen "Don't ask before every race" (remembered per device through src/game/storage.ts; register the key in STORAGE_KEYS). When it is on, races start straight away, and the loadout is still reachable from the Pit shop.
3. Online: the host's lobby already has a loadout budget; guests open their online loadout from the lobby before they press Ready. Do not add a blocking screen to the online race start (the host's clock starts the race).

READ FIRST, completely: gh issue view 116; then src/App.tsx (launchQuickRace, startSeason, the story start, and where LoadoutScreen is rendered: search "LoadoutScreen" and "shopOpen"), src/components/loadout/LoadoutScreen.tsx, src/game/loadout-store.ts, src/game/loadout.ts, src/components/SetupScreen.tsx (the primary button per tab), src/components/story/StoryMode.tsx, src/game/storage.ts.

STEP 0, BEFORE ANY CODE (do this in your first minutes):
- Your branch is created for you. Never rename it. Start from the latest origin/main (git fetch origin && git rebase origin/main).
- Make an empty commit: git commit --allow-empty -m "P2-10b: start"
- Push it: git push -u origin HEAD
- Open a DRAFT pull request right away: gh pr create --draft --title "P2-10b: pick your loadout before every race" --body "Refs #116. Work in progress."
- From then on, git push after EVERY commit. Small commits, often.
- If git push or gh fails with an auth error, do NOT ask for a token and do NOT try to log in: keep committing locally and say so clearly at the top of your final message.

FILES:
- You own: new src/components/loadout/PreRaceLoadout.tsx (a wrapper around LoadoutScreen with the two buttons and the checkbox), new src/game/pre-race.ts (the pure rule: should the screen show for this mode and course?), new tests/pre-race-loadout.test.ts.
- Shared, keep edits small and list each one in the PR under "Touched outside my files": src/App.tsx (the race start paths only), src/components/loadout/LoadoutScreen.tsx (only props needed to embed it), src/components/story/StoryMode.tsx (the chapter race start only), src/game/storage.ts (one new key).
- Do not touch: the race engine, physics, src/net/*, the platformer course code, tests/engine-checksum.test.ts and its golden file.

TESTS, EXACTLY THESE:
- Run after every commit: npx tsc --noEmit -p .
- Run after every commit: node --import tsx --test tests/pre-race-loadout.test.ts tests/loadout.test.ts tests/unwired.test.ts tests/garages.test.ts tests/engine-checksum.test.ts
- DO NOT RUN tests/browser.test.ts (slow Playwright suite) and DO NOT RUN scripts/e2e-mp.mjs (multiplayer end-to-end). The reviewer runs those. Do not run the whole tests/ folder either.
- tests/engine-checksum.test.ts must pass UNCHANGED. Never edit it or its golden file.
- Your new tests must cover the rule: shows for quick / championship / story, never for the tutorial course or Infinity, never when "Don't ask" is on; "Same as last time" leaves the stored slots unchanged; "Race with this loadout" saves exactly the shown slots for that mode only.

HARD RULES:
- Never use localStorage or sessionStorage (RUN.world blocks them). Use src/game/storage.ts and add any new key to STORAGE_KEYS.
- Every screen must work on a phone in portrait (375 px wide), in landscape (812x375) and on desktop. The loadout screen must fit at 812x375 without the two buttons falling off screen (scroll the slot list, not the buttons).
- Do not change any multiplayer message. If you find you must, bump PROTOCOL_VERSION in src/net/protocol.ts and say why.
- Do not deploy (no rundot deploy), do not merge, do not edit rundot/ config.
- Keep the same code style as the files around you.

FINISH:
1. git fetch origin && git rebase origin/main, fix conflicts, re-run the tests above, push.
2. Mark the PR Ready for review (gh pr ready) and set its body to four short sections: What changed / How to try it (exact clicks) / Known gaps / Touched outside my files. Keep "Refs #116" in the body.
3. Your final message: the PR link, the test output (pass/fail counts), and anything you could not do.
```
