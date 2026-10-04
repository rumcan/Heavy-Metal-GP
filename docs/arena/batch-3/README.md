# Agent batch 3

Batch 2 (browser tests, story voice, Workshop tour, skill icons, Infinity beautiful pass) is all merged (PRs #186-#189, #191, #199, #200).

These three are what the open GitHub issues still ask for. Each file holds ONE self-contained prompt: copy everything inside its box into a new Arena agent run. They touch different files, so all three can run at the same time.

| File | Issue | What |
|---|---|---|
| 01-ko-spectate-and-points.md | #113 | Camera follows your killer after a KO; +2 championship points per KO; KO column in results |
| 02-pre-race-loadout.md | #116 | The loadout screen before every race, with "Same as last time" and "Don't ask" |
| 03-ai-personalities.md | #122 | Each rival drives like themselves (skill, aggression, caution) |

When an agent says its PR is ready, tell Claude the PR number: it reviews (tsc, the ticket's tests, engine-checksum, the browser suite for UI changes) and merges.
