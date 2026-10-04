# Work item 3: AI driver personalities (finishes #122)

Copy everything inside the box below into the Arena agent as its task. It is self-contained.

```text
You are a senior TypeScript game engineer on Heavy-Metal-GP, a marble racing game (Vite + React + Matter.js, deployed on RUN.world). Repository: https://github.com/rumcan/Heavy-Metal-GP. Work only in this repository.

YOUR TASK: finish GitHub issue #122 (P2-16 AI drivers v2), step 5 "Personalities and difficulty". The AI brain already drives the platformer courses (src/game/ai-brain.ts decides from a Sense that src/game/engine/platformer.ts builds; difficulty today comes only from the Speed stat: easy / normal / hard). Every rival should drive like themselves:
1. Add a personality per rival in src/game/characters.ts next to RIVALS (keep RIVALS' existing fields): skill 1..5, aggression 0..1 (how often it uses offence skills and rams), caution 0..1 (how early it jumps chasms, brakes before wrecking balls and loops, avoids the risky outer lanes). Pick values that fit each character's tag line (for example Big Grubba: aggressive and clumsy; Ace Spadegrin: fast and precise; Duchess Vex: cautious and haughty). Document the table in a comment.
2. The brain reads the personality: skill scales reaction delay and jump timing error (no extra speed, no cheating forces: the same control rules as a human), aggression scales offence skill use, caution scales jump lead, lane choice and how often it takes shortcuts.
3. The race's difficulty setting (if none exists, the quick race uses "normal") shifts every rival's skill by -1 / 0 / +1, clamped to 1..5.
4. Deterministic: the same seed and inputs give the same race (no Math.random in the brain; use the game's rng).

READ FIRST, completely: gh issue view 122; then src/game/ai-brain.ts, src/game/engine/platformer.ts (aiDrive, sense, decide, difficultyOf, loopAhead), src/game/characters.ts (RIVALS, characterOf), src/game/skills/catalog.ts (the AI hint per skill), tests/ai-brain.test.ts, tests/platformer.test.ts.

STEP 0, BEFORE ANY CODE (do this in your first minutes):
- Your branch is created for you. Never rename it. Start from the latest origin/main (git fetch origin && git rebase origin/main).
- Make an empty commit: git commit --allow-empty -m "P2-16b: start"
- Push it: git push -u origin HEAD
- Open a DRAFT pull request right away: gh pr create --draft --title "P2-16b: AI driver personalities" --body "Refs #122. Work in progress."
- From then on, git push after EVERY commit. Small commits, often.
- If git push or gh fails with an auth error, do NOT ask for a token and do NOT try to log in: keep committing locally and say so clearly at the top of your final message.

FILES:
- You own: new src/game/ai-personality.ts (the table lookup and the difficulty shift), new tests/ai-personality.test.ts.
- Shared, keep edits small and list each one in the PR under "Touched outside my files": src/game/characters.ts (the personality fields only), src/game/ai-brain.ts, src/game/engine/platformer.ts (where difficulty is read and the Sense is built only).
- Do not touch: classic (non-platformer) AI code paths, physics constants, src/net/*, tests/engine-checksum.test.ts and its golden file.

TESTS, EXACTLY THESE:
- Run after every commit: npx tsc --noEmit -p .
- Run after every commit: node --import tsx --test tests/ai-personality.test.ts tests/ai-brain.test.ts tests/platformer.test.ts tests/platformer-routes.test.ts tests/engine-checksum.test.ts
- DO NOT RUN tests/browser.test.ts (slow Playwright suite) and DO NOT RUN scripts/e2e-mp.mjs (multiplayer end-to-end). The reviewer runs those. Do not run the whole tests/ folder either.
- tests/engine-checksum.test.ts must pass UNCHANGED (classic races must not change). Never edit it or its golden file.
- tests/platformer.test.ts and tests/platformer-routes.test.ts must keep passing: the whole AI field still finishes every official course (at least as many finishers as today).
- Your new tests must cover: every rival has a personality in range; an aggressive driver fires offence skills more often than a cautious one over the same race; a cautious driver jumps earlier; skill 5 beats skill 1 on average over several seeds on the same course; the same seed gives the same finishing order twice.

HARD RULES:
- No extra forces or speed for the AI: the same steer, jump and Magic Engine rules as a human (src/game/controls.ts).
- Never use localStorage or sessionStorage. Physics stays vector shapes.
- Do not change any multiplayer message. If you find you must, bump PROTOCOL_VERSION in src/net/protocol.ts and say why.
- Do not deploy (no rundot deploy), do not merge, do not edit rundot/ config.
- Keep the same code style as the files around you.

FINISH:
1. git fetch origin && git rebase origin/main, fix conflicts, re-run the tests above, push.
2. Mark the PR Ready for review (gh pr ready) and set its body to four short sections: What changed / How to try it / Known gaps / Touched outside my files. Keep "Refs #122" in the body. Include a small table of each rival's personality.
3. Your final message: the PR link, the test output (pass/fail counts), and anything you could not do.
```
