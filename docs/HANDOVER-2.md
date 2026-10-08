# Handover 2 (written 2026-10-03, by the AI that took over from docs/HANDOVER.md)

Read `docs/HANDOVER.md` first (the owner's standing rules still apply), then this file. This one covers what happened since, the **one big correction the owner made just now**, the exact state of every branch and PR, and what to do next in order.

Repo: https://github.com/rumcan/Heavy-Metal-GP · local `C:\Work Admin\PERSONAL\Repos\Heavy-Metal-GP` · Windows, Git Bash + PowerShell · owner: Francois Smit (rumcan).

---

## 0. The correction that changes everything (do this first)

The owner wants the **platformer Workshop to look and work exactly like the existing track builder (`src/components/TrackEditor.tsx`), except that you build sideways and down.** Their words, in order:

1. "we are building the workshop to build platformer tracks to look and work exactly like the existing track builder except for the fact that you are now building sideways and down."
2. After seeing my first attempt (a strip editor, PR #180): **"this will not cut it"**.
3. After I explained a plan: **"it has to look and work exactly like this???"** and they pasted a screenshot of the real Workshop: banner header, left palette with art tiles (RAMP, CURVE, RING RAIL, SCAFFOLD TUNNEL, ICE RAIL, WALL, SIGN, then Features...), toolbar (track name, theme picker, Grid 25 u, Ruler, zoom -/+, Fit, Length -/+, START / FINISH jumps), edit bar (undo, redo, Settings, Duplicate, Group, Template, Mirror, Delete, Clear map, Select [E]), a test bar (Test drive, AI rivals, Watch AI, Set start), the canvas drawn with the **real race art** with a grid overlay and a ruler down the left, a status bar at the bottom (pointer, view, length, pieces) and the **Course map** on the right.

So: **do not build another separate editor.** Make the platformer course a first-class `TrackDef` in a "platformer" mode and run it through the real `TrackEditor` / `EditorCanvas`. Then My tracks, drafts, undo/redo, groups, templates, duplicate, share codes, publishing and thumbnails come for free.

**PR #180 (draft) is the WRONG approach and must not be merged as is.** I put it back to draft. Its commits (the strip editor `PlatformerEditor.tsx`, `CourseLists.tsx`, `courses-store.ts`, `share.ts` pf1 codes, `room.ts`, the `platformerCode` protocol field, the seed-list `def.ts`) are to be replaced. See section 5 for what is reusable and what to delete.

### The design I settled on (not yet built beyond step 1)

Platformer course = `TrackDef` with new optional fields:

- `mode?: 'platformer'` and `width?: number` (how far the course runs to the right, 6,000..60,000). `height` keeps meaning "how deep" (the lowest piece + room; `ensureHeight` already does this).
- `PieceBase.lane?: 0|1|2` (0 back, 1 middle = default, 2 front).
- Reuse the classic piece types wherever they mean the same thing:
  - floor segment = `ramp` (a,b); curved floor = `curve` (a,c,b)
  - spring = `pad` (sheep spring art; platformer spring is 60 px wide)
  - boost pad = `boost`, power-up box = `itembox`, wrecking ball = `wrecker` (identical fields), crate = `block`, rope bridge = `bridge` (a,b,planks,slack; the engine already sags/sways it), loop = `loop` (x,bottom,r)
  - two NEW piece types: `gate` (`kind:'ramp'|'door'`, `to` lane, x, y, w) and `ledge` (x, y, w; one-way)
- A fixed flat start platform (x -200..900, all 3 lanes, at `startY`) and a fixed flat finish run-out are added automatically by the converter (like the classic editor adds start/finish stubs), so the builder only edits the middle.
- Converter `planFromTrackDef(def): { plan: CoursePlan, owners }` turns pieces into the existing `CoursePlan` (floors from ramp/curve, springs from pad, etc.). `y` of floor-bound things is re-snapped to the floor under them after every edit (`settle(def)`, no undo step).
- The editor canvas draws with `renderPlatformer(ctx, stage, {x,y,scale,focus}, w, h, t)` (it already accepts a free camera; `focus` = the lane being edited, other lanes show behind with fog/lift/blur: this is the "depth" look). Add a **working lane picker** (Back / Middle / Front) to the toolbar; only the working lane's pieces are selectable.
- The platformer editor build returns the same shape as `buildEditorTrack`: `{ track, bodyToPiece, pieceBounds, error }`. Idea: add an optional tag callback to `trackFromPlan` so each body is mapped to its owning piece as it is created; compute `pieceBounds` from piece geometry (no bodies needed).
- Course map (right column) becomes a horizontal strip for platformer mode (or move it under the canvas via CSS `data-mode`).
- Test drive in platformer mode: the Workshop calls a new optional `onTestDrivePlatformer(def)` prop; `App.tsx` starts a quick race on the def (registered as a custom course) and returns to the Workshop (I already wrote this flow in PR #180's App changes: `pfEdit`, `testDrive` state, `leaveQuick`; reuse the idea).
- Validation panel: structural problems (readable sentences, see `validatePlatformerDef` in PR #180 `def.ts`, adapt to pieces) + a headless AI race on the plan (needs >= 9 of 10 finishers to share/publish, like classic).
- Saving, drafts, My tracks, share code (`encodeShareCode`), publish (`PublishDialog`) all work on `TrackDef`, so extend `sharecode.ts`: two new piece types appended to `PIECE_TYPES` (append-only), a flag bit 16 + lane byte per piece, and a trailer after the pieces for `mode` + `width` (old codes have no trailer; the decoder currently rejects trailing bytes, so parse the trailer before that check). Bump `PROTOCOL_VERSION` if the wire changes.
- Quick race: "My courses" in the Platformer sub-tab = My tracks entries with `mode === 'platformer'`, registered via `registerCustomCourse` (already exists in `course.ts`) as `my-<savedId>`. The classic "My tracks" list in Quick race and the classic race code must **filter platformer defs out**.
- Online: reuse the existing `customCode` setting. A decoded def with `mode === 'platformer'` is registered as `my-room` and the race uses `platformer: 'my-room'`. Remove the `platformerCode` field I added in PR #180.

### Step 1 of that plan is half done and UNCOMMITTED

`src/game/trackdef.ts` has an uncommitted edit (script `d1.cjs`): `PieceBase.lane`, `GatePiece`, `LedgePiece`, `TrackDef.mode/width`, `xMax()` replacing the literal `-200, W + 200` in every parse call, `PLATFORMER_MIN_WIDTH/MAX_WIDTH`, the `validateTrackDef` wrapper that sets the width for a platformer def, mode/width parsing, lane parsing, and `gate`/`ledge` parse cases. **`npx tsc --noEmit -p .` currently FAILS** (this is useful: TypeScript's exhaustive switches list exactly the places that need `gate`/`ledge` cases):

- `src/game/trackdef.ts(932)` the `body` type needs `lane?: 0|1|2` (declared as `{ flip?, rot?, sc?, grp?, skin? }`), and `pieceYs` (line ~1361) needs `gate` and `ledge` returning `[piece.y]`
- `src/components/editor/extent.ts(22)` `pieceXs`
- `src/components/editor/ghost.ts(222)` ghost outline parts
- `src/components/editor/handles.ts(171)` `handlesFor`, `(500)` `applyHandle`, `(1008)` `mirrorPiece`
- `src/components/editor/rotate.ts(86)` `rotatePiece`

I was about to create `src/components/editor/world.ts` (a tiny module: `editorWorld()`, `worldWidth()`, `setEditorWorld({width}|null)`; classic = `{side:false,width:900,top:0}`, platformer = `{side:true,width,top:-700}`) when the owner interrupted. The plan for it:

- `camera.ts`: `newRig` x, `clampZoom` min (0.2 classic, 0.02 platformer), `fitScale` (fit the whole course width), `openScale`, `clampCamera` (x range = world width; y range = `world.top`..trackHeight), `rigOpen` (open at the start), plus an optional `startX` on `CameraRig`.
- `overlay.ts`: `drawGrid` (clip to world width, iterate only the visible x range), `drawRuler` (add an x ruler along the top in platformer mode and START/FINISH as x positions).
- `translation.ts` (`fitGroupTranslation`), `extent.ts` (`clampDeltaToExtent`), `handles.ts` (`clampX`), `rotate.ts` (`clampX`), `defaults.ts` (`cx` clamp): replace `W` with `worldWidth()`. Leave flip/mirror `W - x` alone (platformer pieces are never flipped; hide the Mirror button in platformer mode).
- `TrackEditor` calls `setEditorWorld(...)` in its render body (before `newRig`), and clears it in an effect cleanup.
- `EditorCanvas.tsx`: add props `mode: 'drop'|'side'`, `lane`, and an `inactive` set (pieces outside the working lane, unselectable, no lock icon); in the render loop call `renderPlatformer` instead of `render` when `mode==='side'`.

---

## 1. State of GitHub (as of writing)

| PR | State | What |
|---|---|---|
| #178 | MERGED (by the owner) | P2-12 scaffold tunnels (10 kits, `skin: 'scaffold'`, Workshop tile, share-code skin flag) |
| #179 | MERGED (by the owner) | P2-21 platformer loops + rope bridges (`src/game/platformer/routes.ts`, planner, engine hooks, AI) |
| #180 | OPEN, **DRAFT**, wrong design | P2-22 first attempt (strip editor). Replace per section 0. |
| #181 | OPEN | docs only: `docs/arena/P2-24-infinity-mode.md` (P2-24 Infinity mode + P2-25 beautiful pass: tickets and agent prompts) |

`main` = `fa356cf` Merge #178 (nothing since v1.30.0 is deployed; **do not deploy or publish until the owner says "push and publish"**).

Local branches that matter:

- `p2-22-platformer-workshop` (this checkout): pushed commits up to `bad41e3` + the **uncommitted** `trackdef.ts` edit above. Tracking `origin/p2-22-platformer-workshop`.
- `p2-23-browser-tests`: **local only, never pushed**, one WIP commit "P2-23 WIP". Contains (a) the 4 browser tests rewritten for the home-tab UI, (b) new Loadout / Talents / Ball customizer tests at 375 px and desktop, (c) two real CSS bug fixes (below). Parked on the owner's instruction ("skip browser tests and game bugs for the end"). It was rebased on nothing (it branched from `main` at `c682335`); rebase it onto `origin/main` before opening its PR.
- `docs-p2-24-infinity` (pushed, PR #181).
- `p2-12-scaffold-tunnels`, `p2-21-platformer-routes`: merged, can be deleted.

## 2. What was done this session

### P2-12 scaffold tunnels (merged, #178)
- `src/game/scaffold-kits.ts`: ten kits (Long Sweeper L/R, S-Bend, U-Turn, Spiral Drop, Hairpin Stack, Funnel-to-Tube, Wave Rider, Half-Pipe Swing, Cliff Drop Chute), each two rails of ordinary `curve` pieces around a centre line, 34 px clear gap (marble 28 px), group id 1.
- **Hard-won fact:** `Builder.curve`/`ramp` draw the *line as the TOP surface of a 26 px slab hanging on the lower side of the span's first chord* (normal flipped to point up at the start of every span, then kept smooth). A rail therefore has to be shifted by the slab's real side per span (`placeSpan`), avoid spans that start near vertical (the side flips on float noise), and keep bend radius >= ~55 px on the centre line. Tests check the marble stays inside the tube.
- `PieceBase.skin` (`'scaffold'`), validated, tagged on bodies (`Meta.skin`), kept in share codes (flag bit 8 + id), drawn in `render.ts` (`drawScaffold`), Workshop palette tile `scaffold` (a variant of `curve`, preset `{skin:'scaffold'}`; the palette test pins tile counts per group: Rails is 7), ghost + group stamp.

### P2-21 loops and rope bridges (merged, #179)
- `src/game/platformer/routes.ts`. Loop = helix ring (R 90, pitch 140): the climb and the return cross near the bottom, so they are on two collision bits (`CAT_LOOP_UP` 0x08, `CAT_LOOP_CLOSE` 0x10); a marble's mask switches when it passes the top (`loopStep` in `engine/platformer.ts`); steering is off while up on the ring (`loopLocked`). Clearing needs about 11 px/step (steering caps at 10), so the planner always puts a boost pad in the run-up. Bridge = classic rope-bridge planks (the engine's sag/sway/sync already work) in one lane.
- Matter velocity units: `setVelocity` is px per 16.67 ms even though the engine steps at 120 Hz; effective gravity ~0.28 px/step^2.
- A marble on a bridge deck was never "grounded" (planks are re-posed every step so contacts never become `collisionActive`): `bridgeGround()` in `engine/platformer.ts` fixes it by proximity.
- AI: `loopAhead` (commit: full push, no hop) and `sensedFloor` (a bridge is a level line, not its sag).
- `planFlow` plans at most 1 loop + 2 bridges (own rng stream `seed ^ 0x2f1d0a3b`, so hills/chasms/gates are unchanged); `FlowTuning.routes:false` turns it off. `trackFromPlan(plan, seed, theme)` is exported from `platformer/build.ts`.
- Full fast suite then: **938 pass, 0 fail**.

### P2-22 (wrong design, see section 0)
Built on PR #180 (draft): `src/game/platformer/{def,courses-store,share,room}.ts`, `src/components/editor/{PlatformerEditor.tsx,platformer-editor.css}`, `src/components/home/CourseLists.tsx`, `community.ts` additions (`publishCourse`, `browseCommunity(..., 'course')`), `protocol.ts` `platformerCode` + `PROTOCOL_VERSION` 11, App/SetupScreen/WorkshopTab/TrackPicker/OnlineLobby wiring, `tests/platformer-def.test.ts` (14 tests). These all passed, but it is not what the owner asked for.

### Docs
- #181: P2-24 Infinity mode + P2-25 beautiful pass tickets (see below).

## 3. Parked work (P2-23, local branch `p2-23-browser-tests`)

- `tests/browser.test.ts` rewritten: added `openTab(page, name)`; the Quick race flow is now tab -> **Race** (footer button) -> loading gate (`dismissGate`); there is no separate "LIGHTS OUT" button any more; the shop is now the **Loadout** dialog (`+1 · price` buttons per slotted skill, locate with `.loadout-slot` filtered by the slot's aria-label `Slot Q: Speed boost,`); after the first championship heat a **LEVEL UP!** dialog blocks the page (click Continue); 6 new tests (Loadout, Talents, Ball customizer at 375 px and 1440 px).
- Two real bugs found by those tests, both fixed on that branch with one-line CSS changes:
  1. `src/powerups.css`: `.race-shell { grid-template-columns: minmax(0, 1fr); ... }` (without it the 4-column skill toolbar widened the shell to 524 px at 390 px wide and the Q/A slots were cut off the left edge).
  2. `src/layout.css`: `.champ-fit .next-event { flex: 1 0 auto; }` (it collapsed to 0 px high at 900x560 because of the new 24-skill loadout preview).
- Verified individually: garage controls, mobile layout, shop/loadout, the long championship heat (about 5 min), and the 6 new tests all pass. **The whole 16-test file was never run end to end** (I killed it when redirected). Run it once (`node --import tsx --test tests/browser.test.ts`, about 10 min) before opening that PR. Files `tests/artifacts/*` are screenshots (git-ignored? check `git status`).

## 4. Remaining work, in order

1. **P2-22, redone properly** (section 0). Suggested commits: (a) trackdef + sharecode + tests, (b) `world.ts` + generalised editor modules with the classic editor tests staying green (`tests/editor-ui.test.ts`, `editor-group`, `editor-templates`, `placement-bounds`, `trackdef`, `engine-checksum`), (c) `planFromTrackDef` + editor build + tests, (d) canvas/TrackEditor platformer mode (lane picker, palette, toolbar, status, course map), (e) entry points (New track dialog option "Platformer course", WorkshopTab, My tracks badge + a horizontal thumbnail, Quick race "My courses", community listing filter), (f) Test drive, validation, online via `customCode`, (g) delete the v1 code. Verify visually in the Browser pane against the screenshot the owner pasted; it must match the classic Workshop's look.
2. **Retarget PR #180**: either force a new branch from `origin/main` for the redo (cleaner) and close #180 with a comment, or rewrite on the same branch. Keep it a draft until it matches the classic Workshop.
3. **P2-24 Infinity mode** and **P2-25** (tickets in `docs/arena/P2-24-infinity-mode.md`, PR #181). The owner said "you can finish all the p2 tickets, don't stop": so build them too (P2-24 first). Key design from the ticket: stateless chunk generator `(seed, chunk)`, continuous chunk joins, `Game.extendTrack/trimTrack` + floating origin, solo, no fail state, a sixth home tab "Infinity", records in `infinity-store.ts`. Note `floorAt` caches per plan in a `WeakMap` (`floorIndex`) that is not invalidated when a plan mutates: add an invalidation for a growing plan.
4. **P2-23**: finish and open the browser-tests PR (section 3).
5. **Game test** (no deploy): phone portrait/landscape + desktop, platformer race, online host + guest, Loadout, Talents, Ball, tutorial, a classic race. Use the Browser pane (`preview_start` name `dev`).
6. **Voice + art** (credits are unlimited per the owner; still do a dry run, `rundot whoami` first): story voice-over #120, tutorial audio (`node scripts/voice/generate.mjs --set tutorial --cap 1500`), Workshop voice tour #121 (after the Workshop is final), 16 skill icons (placeholder glyphs in `src/components/ItemGlyph.tsx`), look-and-feel pass.
7. Only when the owner says: bump version, `rundot deploy`, `rundot game set-public`.

## 5. What to keep and what to delete from PR #180

Keep / adapt: `routes.ts`-style ideas; `validatePlatformerDef`'s readable messages (rewrite over pieces); `registerCustomCourse` / `unregisterCustomCourse` / `customCourseList` and the `course.plan` hook in `platformer/course.ts`; the App test-drive flow (`pfEdit`/`testDrive`/`leaveQuick`, `launchQuickRace(pick, drive)`); `community.ts` filter idea (`isCourseEntry`) is no longer needed if platformer courses are ordinary TrackDefs with `mode`, but then **classic browse/picker lists must filter by mode**.

Delete: `PlatformerEditor.tsx` + `platformer-editor.css`, `CourseLists.tsx` (re-do as "My courses" from My tracks), `courses-store.ts`, `share.ts`, `room.ts`, `def.ts` list model (keep `defFromSeed`'s *idea*: "copy of an official course" as a starter: fit the 40 px floor pieces of a flow plan into `curve` spans, otherwise 3 lanes x 700 pieces blows the 6000-piece cap), the `platformerCode` field and `MAX_PLATFORMER_CODE_CHARS` in `protocol.ts` (and revert `PROTOCOL_VERSION` to 10 unless something else needs 11), `tests/platformer-def.test.ts` (rewrite), the `sharecode.ts` exports I added (`deflateBytes`, ... stay exported only if used).

## 6. Pitfalls (all learned the hard way this session)

- **Merging:** Claude Code's auto-mode classifier blocks `gh pr merge` ("Merge Without Review"). I did not work around it; the owner merged #178 and #179 themselves. Ask them to merge. You can stack a branch on another open PR's branch (`git switch -c x origin/other`) and open the PR with `--base other`.
- **Big heredocs in Bash fail to parse** ("unexpected EOF"). For anything long, use the Write tool (to the scratchpad dir) and run a small `node` script with `fs.readFileSync`.
- **CRLF:** most source files are CRLF. `perl -pi -e 's/...$/'` with `$` and `\n` patterns silently does nothing. I used node scripts that normalise to LF, apply exact `must(s, old, new)` replacements (throws if the text is missing), then convert back. That pattern is reliable.
- `git push` after `git switch -c x origin/main` sets upstream to `origin/main`; the first push must be `git push -u origin x`.
- `taskkill //F //IM node.exe` kills the dev servers but leaves an orphan on **port 9001** (the rundot multiplayer dev room), after which `vite` and `preview_start` fail with EADDRINUSE. Find the PID with `netstat -ano | grep :9001` and kill that one process.
- Background commands: use `run_in_background` plus the Monitor tool with an `until grep ...` loop; do not `sleep` in the foreground.
- `tests/artifacts/` collects screenshots from browser tests.
- Browser pane: close stray tabs (`tabs_close`), `preview_start` name `dev` serves port 5173; `file://` navigations of generated SVGs are cached, add `?v=2`.
- Editor tests that pin counts: `tests/editor-ui.test.ts` pins tiles per palette group and the set of piece types; adding palette tiles or piece types means updating them (and every tile must follow "variant tiles have a preset, plain tiles have none").
- Do not pin `PROTOCOL_VERSION` exactly in tests (`>=`).
- `tests/engine-checksum.test.ts` (golden) must always pass unchanged; classic engine code paths must not change.
- No `localStorage`: `src/game/storage.ts`, register new keys in `STORAGE_KEYS`.

## 7. Key code map for the redo

- `src/components/TrackEditor.tsx` (1483 lines): state (`circuit {def, build}`, `selected`, `armed`, `locked`, `rigRef`, `History`), `commit` / `transact` / `startTransaction` (drags are one undo step), `handlePlace` (calls `placementPieces` in `editor/ghost.ts`, multi-piece stamps via `regroup`), `ensureHeight`, validation/share/save/My tracks handlers, keyboard shortcuts, and the JSX layout (header, banner, `editor-main` with `editor-tools` palette column, `editor-stage` with toolbar / editbar / testbar / canvas / status, and the right-hand `EditorMap`).
- `src/components/editor/EditorCanvas.tsx` (1368 lines): pointer handling (pan, pinch, box select, handle drags, piece drags, placement), selection drawing, ghost drawing, `loop` calling `render(...)`; reads `rig.defPieces`, `track`, `bodyToPiece`, `pieceBounds`, `locked`.
- `src/components/editor/build.ts`: `buildEditorTrack(def)` returns `{ track, bodyToPiece, pieceBounds, error }` (classic Builder replay with a per-piece cache); `hitPieceAt`, `piecesInBox`.
- `camera.ts`, `overlay.ts`, `handles.ts` (handle geometry + `applyHandle`, 1118 lines), `ghost.ts` (`placementPieces`, `ghostPreview`), `palette.ts` (tile data), `PiecePalette.tsx`, `PropertiesPanel.tsx` + `pieceSettings.ts`, `translation.ts`, `rotate.ts`, `group.ts`, `bounds.ts`, `defaults.ts`, `history.ts` (generic over `TrackDef` snapshots), `validate.ts` (headless 10-marble race), `TestDrive.tsx` (classic `Game` + classic `render`, so use the quick-race flow for platformers), `MyTracksPanel.tsx`, `SharePanel.tsx`, `PublishDialog.tsx`, `NewTrackDialog.tsx`, `TrackThumbnail.tsx`/`TrackMap.tsx` (classic vertical drawings).
- Platformer: `src/game/platformer/{course,flow,build,render,coaster,routes}.ts`, `src/game/engine/platformer.ts` (lanes, gates, cannons, `loopStep`, `bridgeGround`, AI `aiDrive`), `src/game/lanes.ts` (`laneCategory` = 0x1000<<lane; `LANE_SWITCH_MS`), `renderPlatformer(ctx, game, cam {x,y,scale,focus}, cw, ch, t, followed)`.
- Wire: `src/net/protocol.ts` `RaceSettings` (`platformer?: string` is a course id matching `^[a-z0-9-]{1,32}$`; `customCode` is a `1-`/`2-` share code <= 12000 chars; frame cap 16 KB).
- Tests: `node --import tsx --test tests/<file>.test.ts` (never run `tests/browser.test.ts` or `scripts/e2e-mp.mjs` in a ticket; the exception is P2-23). Fast suite: `ls tests/*.test.ts | grep -v browser | xargs node --import tsx --test`.

## 8. Cheat sheet

```bash
cd "C:/Work Admin/PERSONAL/Repos/Heavy-Metal-GP"
npx tsc --noEmit -p .
node --import tsx --test tests/editor-ui.test.ts tests/trackdef.test.ts tests/engine-checksum.test.ts
gh pr list --state all --limit 8
gh pr create --draft --base main --title "..." --body-file body.md
```

## 9. Questions for the owner (answer before you spend a lot on them)

1. In the platformer Workshop, should floors be freehand `ramp`/`curve` pieces (my plan, exactly like the classic builder) and is a "start from a copy of Rolling Hills" option wanted in the New track dialog (like the classic "SPA copy")?
2. Should the working-lane model (one lane in front, the others fogged behind) be the editing view, or do they want all three lanes shown at once?
3. Infinity mode: a sixth home tab, no rewards (my assumption in the ticket): confirm.
