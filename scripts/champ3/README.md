# CHAMP-04 authoring harness (`Spa-Francoroll` as *Emerald Oxbow*, issue #88)

Dev-only tooling used to author and gate `src/game/official-tracks/champ-3.json`. Nothing here is
imported by the game.

| file | purpose |
| --- | --- |
| `def.mjs` | the authored circuit: one `buildDef()` returning a TrackDef built piece by piece, plus the header ledger of every deviation from the ticket and why. |
| `map.mjs` | local builder helpers (`floorChain`, `railChain`, `lane`, `arclen`/`offsetChain`, …) shared by the authorship scripts. |
| `emit.mjs` | validates `def.mjs` and writes `champ-3.json` (1-space JSON, the repo's official-track format). `--check` compares without writing. |
| `audit.mjs` | layout law: corridor widths, floors vs rails, stacked-branch headroom, slab intrusions, geometry bounds. |
| `pack.mjs` | the shipping gate: reads the *emitted JSON*, `validateTrackDef`, ticket limits (pieces/height/name/theme/seed), then the 10-marble headless pack (`validateTrack`). |
| `free.mjs` | one unsteered marble per archetype build: finish time + recovery spots. |
| `sim.mjs` | steered route runs with checkpoint marks (`TRACE=BUILD:route` prints a frame trace). |
| `timing.mjs` | branch **entry → rejoin** timings measured from real ten-marble races, per build. |
| `branch.mjs` | branch runs from a fixed spawn state (isolates build physics); needs the marble seated with `Matter.Body.setPosition/setVelocity`. |
| `capture.mjs` | draws every collision body to `champ-3-overview.svg` for the PR. |
| `where.mjs`, `ls.mjs`, `probe.mjs`, `dbg.mjs` | diagnostics: bodies near a point, piece table, path helpers. |

Run it all:

```bash
node --import tsx scripts/champ3/emit.mjs            # def -> JSON
node --import tsx scripts/champ3/audit.mjs           # layout law
node --import tsx scripts/champ3/pack.mjs            # shipping gate (JSON in, 10-marble pack)
node --import tsx scripts/champ3/free.mjs            # per-build solo laps
node --import tsx scripts/champ3/sim.mjs             # directed route runs
node --import tsx scripts/champ3/timing.mjs          # branch entry -> rejoin times
node --import tsx scripts/champ3/capture.mjs         # PR overview drawing
```

`pack.mjs` and `timing.mjs` read the emitted JSON, so always re-run `emit.mjs` after editing `def.mjs`.
