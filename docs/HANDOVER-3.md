# Handover 3 (2026-10-06): owner bug-bash, Infinity + races

## How we work
- Owner play-tests http://localhost:5173 (main checkout, keep it on origin/main after every merge) and **5180** (live view of whatever worktree is being edited: `ui` config in `.claude/launch.json` runs `node %TEMP%/perf/serve.mjs <worktree> 5180`; repoint + restart it per worktree).
- Branch per fix in `.wt/<name>` (junction node_modules), PR, merge yourself, no waiting. Deploy only on "push and publish".
- During bug-bash: tsc + targeted tests only; full unit + browser suites once at the end.

## Open owner requests (newest first)
1. Infinity exit: arcade ring count-up (rings fly from the stack into the driver portrait on the Infinity tab Records area, distance bonus, total -> credits into the header balance).
2. Ghost balls: "I am duplicated, AIs on other tracks, AIs roll under the track". Cause: `src/game/render.ts drawBodies` draws ALL marbles/effects at its end; `platformer/render.ts` calls it per lane for classic pieces (and in the static lane cache). Add a pieces-only option; draw effects once.
3. Swinging mace KO moved player somewhere random, then DNF; the YOU tag covers the health bar. Hide the YOU tag 2 s into a race.
4. Goblin stands vanish (km 4/8/12...): `coaster.ts crowds()` uses LOCAL km index; Infinity shifts origin by 40,000 px. Add `plan.originX` (Infinity planOf), use absolute km, explicit stand spots per chunk. Same local-x problem in clearance/trestle/torches/treeGroups.
5. Km checkered flags (`flag-race.webp`), hot air balloons in the platformer sky (`airship.webp`).
6. Infinity pieces: fire hoops, smash crates (no resistance, satisfying break; art cut in `.wt/pieces/src/assets/game/smash-crate*.webp` + `scripts/assets/smash-crate.mjs`, uncommitted), updraft + geyser vents (classic pieces via plan.extras; make `engine/fields.ts` lane-aware).
7. Foreground pines slide sideways when zooming: scroll is screen px mod tile width; anchor tiles at screen centre in tile units.
8. Loadout: "+1" is not a buy button: show a clear Buy with price.
9. Race UI: fast-forward hidden behind the floating skill bar; skill bar full width + tappable on phones/portrait tablets; remove numbers on the podium; track-name tabs overlap (responsive).
10. GP courses (e.g. Misty Ridge) have almost no Workshop pieces/pegs: add classic extras + gold rings to normal maps.
11. Workshop lanes (owner chose): lane tabs in one course, a course has 1, 2 (middle + back) or 3 lanes, removing a lane deletes its pieces (Undo). Design notes: research journal of workflow wf_af9cabb5-363.
