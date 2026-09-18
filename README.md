# Heavy metal GP

A 2D Matter.js racer with ten marbles, procedural circuits, deployable items,
Peggle-inspired sectors, and a six-event championship.

## Play

- Start a championship, or select a circuit and choose Quick Race.
- Weight, speed and bounce share a 15-point budget.
- Use A/D or the arrow keys to nudge, keys 1-8 (or a toolbar click) to deploy an item,
  Space to repeat your last selection, and P to pause.
- Touch controls are available on smaller screens.
- Each Grand Prix has three heats on the same seeded track. Setups lock between heats.
- Finishing points are 25/18/15/12/10/8/6/4/2/1. DNFs earn zero.
- The fastest heat of a completed Grand Prix earns one bonus point.
- Your season saves locally as soon as a heat finishes. No account or server is needed.

## Story mode

*Down We Go*: six chapters of three heats each, raced over the same six Grands Prix as the
championship — but with a fixed grid, a script, and objectives that steer it.

- Garage → **Story** button → the story hub. Cleared chapters can be replayed from chapter
  select; a replay never writes to the save.
- The story keeps its own save (`heavy-metal-gp:story`) and its own championship season.
  The garage championship save and the story never touch each other. Credits are shared
  with the wallet, and every chapter banks one cosmetic unlock (livery or portrait) on the
  story save.
- Flow per chapter: act banner (acts I–III) and the chapter plaque slam in, then intro
  scenes; per heat, pre-race dialogue → loading screen → race → post-race dialogue;
  then the chapter outro. Chapter 6 closes in one of three endings by final championship
  position: P1 champion, P2–3 bittersweet, anything else heartbreak.
- Dialogue advances on tap or Space/Enter, fast-forwards while held, skips on Esc, and can
  run itself with the Auto toggle. `prefers-reduced-motion` drops the slide-ins and the
  typewriter.
- Chapter objectives appear as chips in the race HUD and as mid-race speech bubbles. Failing
  one never blocks the chapter — it only changes which lines you get. Chapters 4–6 also
  script hazards (oil slicks, tremors, extra wrecking balls) and AI grudges through the
  additive `GameOptions.story` hook seam in the engine.
- Everything in a run derives from the story save's seed: same seed, same grid, circuits and
  scripted events. Story code never calls `Math.random()`.
- Scene preview for writing and checks: `npm run dev`, then `/?story=<sceneId>` (or
  `/?story=list`) mounts any scene full screen. Dev builds only; the bundler drops it from
  published games.
- All story art lives in `src/assets/story/` and is reached through the typed helpers in
  `src/game/story/assets.ts`.

## Multiplayer (in progress)

The transport layer is in. `src/net/transport.ts` is the **only** client module
that talks to RUN.world's realtime API (room create/join by code, quick match,
room-code helpers, the per-player active-match memo); everything else imports
its wrappers, and `tests/multiplayer.test.ts` fails the moment another file
reaches for the SDK's realtime client. The room itself is registered in
`rundot/realtime.config.json` (`hmgp-race`, six seats) and is now the **thin
validating relay** (`src/rooms/RaceRoom.ts`): it mints the seed, names the host,
keeps the seat table (player → grid slot), relays host state to everyone and
guest intents to the host only, drops a guest-forged frame or one the protocol
refuses, locks the room once the lights go out, and ends the race for everyone
when the host leaves mid-heat. It never simulates.

**Guests render** (`src/net/guest.ts`): the guest builds the identical circuit
from the seed, then only ever MOVES bodies — no `Engine.update` anywhere. State
frames land in a 100 ms interpolation buffer and the picture is played out on
the guest's own clock, which is allowed to run 25 % fast to absorb a hole but
never snaps the buffer in one frame. Events change what there is to see (a
popped peg, a broken wall, a slick, a freeze, a finish) and are held until the
picture reaches the frame they belong to, so they are drawn in step with the
state they describe. The host says every batch twice: a state frame is
absolute, so one the network eats heals itself, but an events frame is the
only copy of "that peg popped", so each publish repeats the one before it and
the guest ignores a sequence it has already drawn. The local marble leans the moment a key goes down and the
next frame corrects it — a render-only lie the simulation never sees. A frame
or two may go missing (every frame carries every marble, so the buffer steps
over the hole); a bigger hole costs one `resync` and the world comes back
whole.

**The host simulates** (`src/net/host.ts`): one browser runs the Matter.js
`Game` for all ten marbles and publishes `state` at 20 Hz, an `events` batch
whenever something happened, a chunked snapshot on join/resync and the
`results` once. Guests never step physics. The host applies a guest's intents at the next step,
pacing nudges to 30 a second and holding items to the same `canUseItem` rule
its own hands obey, and it owns the race clock: the lights go out at a
wall-clock instant every tab was told about in advance. `Game` itself now takes
N human seats (`humanInput`), so the AI keeps its hands off a guest who has
joined but not touched a control, and offline play is unchanged.

The **race protocol** (`src/net/protocol.ts`) is the wire both ends speak:
`welcome`/`lobby`/`ready`/`start`, a 20 Hz `state` frame (ten marbles packed
into 21 bytes each — five float32 plus a flag byte — and base64'd, ~330 bytes
a frame), `events` (pegs, crates, boxes, items, oil, freeze, shock, finishes
and sound cues), a chunked `snapshot` for join and resync, `intent` (analog
nudge or item), `resync`, `results` and presence. `validateMessage` is the one
door: it refuses an unknown type as malformed, an out-of-domain value as forged
(a nudge past ±1, an item the game does not have, a body index no circuit has),
a frame past the 16 KiB cap as oversized, and a welcome from another build with
the reload message rather than a silent desync. The module is pure — no SDK, no
DOM, no Matter.js — so the room bundle can import it and relay with the same
code the client validates with.

**The lobby ships in MP-06.** The garage's bottom bar has an **Online** mode
next to Championship and Quick race: **Host game**, **Join with code** (the
six-character code your host is showing) and **Quick race** (MP-07), which pairs
you with anybody else who pressed the same button — no code typed by either
side. The lobby (`src/components/OnlineLobby.tsx`) shows the code
big enough to read across a room, with a copy button; the ten-slot grid (drivers
with a portrait, livery and tune, the rest marked AI, and a kick button for the
host); and, for the host, the circuit pick and the Start button, which lights up
when two drivers are in and everybody is ready. Start arms the lights six
seconds out — long enough for both browsers to build a ten-marble world from the
seed — and `RaceScreen` runs the race through a `RaceSession`
(`src/net/session.ts`), which is either the host's simulation or the guest's
picture of it. The same screen, the same HUD, one prop's difference.

**Quick race is a loop, not a request.** The SDK's `matchmakeRoom` is a bounded
window: it waits, and when the window closes it rejects and drops the ticket.
`src/net/matchmake.ts` is the "keep looking" part — it asks again after a pause,
counts the windows it has burned through for the "still looking" line, lets the
player cancel (the in-flight request can still land, so a room that arrives after
a cancel is left rather than left holding a seat), and passes a real failure —
access denied, no room server — straight to the player instead of spinning on it.
Since RK-04 it also asks for a WIDER rank each time a window closes; the ladder
it walks is under [Ranked racing](#ranked-racing).
Whoever the platform pairs first is the host. A quick lobby has no Ready button
and no Start button: everybody is ready by sitting down, the host takes the
circuit from the room's seed (never `Math.random()` — a republished lobby must
not move the race to another track), and the lights go out twenty seconds after
the second driver arrives, or the instant a sixth one does.

**A dropped socket is not a dropped driver** (MP-08). The platform holds a seat
for `reconnectTimeout` and flips `player.connected`, and the ROOM is the only
end that sees both sides, so it is the room that speaks — one poll a second, and
the two transitions go out as `peerStatus` with the hold window. What the two
ends do with that frame is `src/net/presence.ts`, and the rule it exists to
enforce is: **a race does not wait on a socket.** Three seconds without a driver
and the AI has the marble (`humanInput` is what makes a marble a human's, so
releasing one is a `delete`); the SEAT is still theirs until the room gives it
up, and coming back inside the window hands it back with the world (`resync` →
snapshot) rather than a shrug. A driver who never comes back is evicted when the
window closes. A driver whose page REFRESHED is the same player asking for the
same marble: the room re-greets them mid-race instead of refusing them, the host
answers that greeting with the real grid (the room's welcome is only a seating
plan — it does not know a livery from a tune), and their screen joins the race
already in progress instead of waiting for a Start that already happened. The
host is the one case with no way back: the host IS the simulation, so a host who
drops ends the race for everyone — an overlay says so, the grid goes back to the
garage, and the unfinished race pays nothing.

The room owns who sits where; the host owns what the grid looks like. A guest's
garage (tune, livery, portrait) reaches the host inside `ready` — the one frame
a guest owns — and the room STAMPS that frame with `from`, because the SDK hands
a client the payload alone, with no sender. A guest cannot forge another seat's
nudges or file another driver's garage.

To try it locally, `npm run dev`, then open **two tabs** (a second window or an
incognito window is the cleanest way to be two players — each tab mints its own
dev identity, and no sign-in is involved) at:

```
http://localhost:5173/
```

In one tab, **Online** → **Host game**; the lobby shows a code. In the other,
**Online** → type the code → **Join with code**. Both drivers press **Ready**,
the host presses **Start the race**, and both screens count down to the same
instant. Or skip both: press **Quick race** in each tab and wait — the pair
lands in one room and the lights come down by themselves. Vite also starts the
room sidecar on port `9001` from
`rundot/realtime.config.json`: that is what makes host and join meet, and it
only exists on `npm run dev` (a built or previewed page mocks rooms instead, and
`src/net/transport.ts` detects that state and says so).

**Coming back:** close a tab mid-race and the garage offers it back — **You were
in a race / ABC123 → Rejoin race**. The memo (`ACTIVE_MATCH_KEY`) is written when
a race is entered and cleared when it is left *through a door this client
controls*, which is exactly why a crash or a closed tab leaves it standing for up
to ten minutes.

**Money and kit are every screen's own business** (MP-09). There is no host
banker: a host that could pay its guests could also simply not pay them. The host
publishes `results` once, and every client settles ITSELF — its own seat out of
that classification, at `ONLINE_PAYOUT_SCALE` (60 %: an online heat costs nothing
to enter and is the easiest race in the game to repeat) — under a race id built
from the room code and the published countdown instant, so the same race can
never be collected twice. A driver who did not finish is paid nothing, and a race
that never reached a classification (the host left, the results never came) calls
nothing at all. Kits work the same way: each driver's items travel with their
garage in `ready` (counts clamped by the wire), the host puts them on that seat's
marble, and a human's kit changing republishes the world — one snapshot per
change — so a guest's toolbar is never lying about what they are holding. Come
home with what you came home with: spent is spent, picked is kept. **Race again**
returns the whole room to the lobby with its seats intact, and the host may pick
another circuit before dropping the lights.

Still to come in the epic: **MP-10**, the two-browser E2E harness — the
acceptance for the reconnect work above is a Playwright test (a guest goes
offline for ten seconds and takes the same marble back), and this repository has
no browser in it yet. Online nudge-vs-simulation parity is also still
hand-checked: the guest leans locally and sends the intent, but the host's
picture of that lean has not been played side by side with the offline game.

Two notes for a browser that is not on the dev machine (a tunnel, a sandbox
preview, a phone on the LAN): the sidecar origin the plugin injects is
`localhost`, so point it at the origin that forwards to port 9001 with
`RUNDOT_DEV_ROOM_URL=https://… npm run dev`. And editing `vite.config.ts` while
the dev server runs makes Vite restart it, which can lose the race for port 9001
and exit with `EADDRINUSE`; restart `npm run dev` if that happens. A deliberate
leave is held for the room's 30-second reconnect grace before the other seat
sees the player leave — that is the platform's seat hold, and the room already
announces the drop (`peerStatus`) with the countdown attached.

## Ranked racing

Quick race matchmaking shipped with MP-07; what ranks the drivers is the
**RK-01..RK-06 epic**, a port of HexMatch's RANK-01 — and **RK-01, the rating,
is in**. `src/net/rating.ts` is the pure half: an Elo number, the tier it
names, and the arithmetic that moves it. It imports nothing at all — no RUN
SDK, no DOM, no clock — so the client, the room and the unit suite can all read
the same answers out of it.

A race is rated as a FIELD, not as a duel. Every two rated HUMANS in it are a
head-to-head result (ahead beats behind), each driver's K is divided by
`(humans − 1)` — so a full six-marble race moves a rating about as much as one
duel, and an even six-driver race pays its winner exactly what an even duel
pays — and every pair cancels, so while a field shares one K its deltas sum to
zero and the ladder does not inflate. AI marbles are never on the board and are
not in the classification the ladder reads: a marble nobody is steering cannot
be farmed for rating.

The rules a scoreboard needs: a DNF ranks below every finisher, two DNFs tie at
half a point each, and a driver who LEFT is a DNF however the classification
read — HexMatch's leaver rule, kept, because MP-08 hands a quitter's marble to
the AI and that marble can still roll home, and paying it would be paying
people to quit. Crossing the line and *then* closing the tab is not leaving:
that is a finished race, and the room is what tells the two apart. A driver the
room never heard from is read as a fresh 1000 rather than dropped out of the
arithmetic, so a silent seat cannot quietly turn everyone else's race into a
duel. Provisional drivers (the first ten rated races) move at K=40, established
ones at K=16, the floor is 100 and there is no ceiling. The tiers use
HexMatch's thresholds with this game's names — Scrap, Bronze Bolt, Iron, Steel,
Gold Gear, Heavy Metal — and `unranked` is a state rather than a band until a
driver files their first rated race. `searchBucket` (a rating window as a
matchmaking criterion, since the pool matches by equality) is here too, for
RK-04.

**Where a rating lives (RK-02).** `src/net/rankstore.ts` is the policy around
the arithmetic: the storage keys, the once-only guard that stops a reload from
filing one race twice, and the single call site that writes to the public
ladder. The file is RUN **player storage** (`appStorage`, per-player and
cloud-backed — no other seat can read or write it), reached through
`src/net/transport.ts`, which is still the only module that touches the SDK's
storage and leaderboard: `readPlayerValue`/`writePlayerValue` already existed
for the rejoin memo, and `isLadderAvailable`, `readLadder` and
`submitLadderScore` join them. Every one of them resolves rather than throws,
because a rating read that fails must fall back to a fresh file and a ladder
submit that fails must not take a results screen down with it.

A filed race is guarded by a key built from the **room's own stamp and the
field in finishing order** — stable across both seats and across a reload, and
different for a rematch in the same room. It is written *before* the rating, so
a crash between the two loses a move rather than duplicating one. Reading the
file is equally forgiving: a corrupt, half-written or simply-not-ours record
falls back to a fresh 1000 instead of throwing on a boot path.

Two of HexMatch's decisions are reversed here, on purpose. There is **no
`localStorage` mirror**: RUN.world blocks web storage and everything persistent
in this game already goes through the device cache, so no RUN storage means a
fresh file and an unrated race rather than a rating kept in a bucket the
shipped game cannot read. And an **anonymous driver is not rated at all** —
`ratedRacingAllowed()` is false without a signed-in player and a per-player
bucket, and the rating surfaces show one line (`SIGN_IN_TO_BE_RANKED`) instead
of a number that would evaporate. A signed-out player still races; it just does
not count.

The public ladder is a **keep-best** leaderboard (`rundot/leaderboard.config.json`,
mode `ranked`, bands 100–4000, all-time), so it shows a driver's PEAK rating
while their private file holds where they are now — the two are supposed to
differ, and a lower submission comes back `accepted: false` and changes nothing.
An unreachable board is `null`, and the panel says so in a line rather than
showing an empty table that looks like nobody plays this game.

**The race, rated (RK-03).** Four messages join the wire (`PROTOCOL_VERSION` 3):
a driver publishes **their own** rating (`playerRating` — the relay drops
anything signed by somebody else, and a re-publish must carry the join token
the seat first filed), the room relays the whole board back (`ratingUpdate`,
and in the welcome, so a lobby shows numbers before the lights), the host files
the classification when the flag falls (`resultClaim`), and the room broadcasts
the one result it will ever carry (`result`). No rating NUMBERS travel as
opinions: the result carries the room's board and the room's classification, and
every client recomputes `rateRace` from that pair, so two seats cannot disagree
about what a race did.

`src/rooms/RaceRoom.ts` gained the room's half: the board it has been told, one
result per room (the once-only guard is set *before* the broadcast), and the
fact no client has — **who was still there**. A seat that empties during a live
race is a DNF in the filed classification however the marble finished (MP-08
hands it to the AI, and that AI can roll home), which is HexMatch's leaver rule
carried into a race. A race is **rated only when it was created by matchmaking
and raced without house-rule power-ups**: the host declares the first on its
claim (it is the only seat that knows how the room was opened — the room's own
`metadata` is static config and the matchmaking criteria ride a join ticket the
room never sees) and the room ANDs in the second, the one rule it can watch for
itself as it relays the lobby. The result carries the verdict, so every seat
reads the same flag.

`src/net/rank-runtime.ts` is the client half, ported from HexMatch's
`RankRuntime`: hold the file, publish it, turn the host's `results` frame into
the claim (`claimFinish` — human seats only, in the simulation's order, a DNF
below every finisher), fold the room's `result` back into the driver's own file
through `rankstore.fileResult`, and give the screen a `RaceVerdict` plus the
`FiledOutcome` that says whether anything was written. A driver who walks out
before the flag files **their own** DNF locally (`fileOwnForfeit`, `localOnly`:
no ladder line — the ladder is written from a result the room witnessed), while
the survivors' numbers come from the room's own filing. Wiring this into the
lobby, the HUD and the results screen is RK-05; the store, the room and the
runtime are done and covered end to end.

**The quick race is a ranked queue (RK-04).** `src/net/matchmake.ts` grew the
ladder HexMatch's RANK-01 walks: `RANK_SEARCH_STEPS` are the windows a
similar-rank search widens through — 75 points for six seconds, then 200, then
400, then Any rank at eight seconds each — and `rankRungs(rating)` turns each
span into the one thing the pool understands, a bucket index (`searchBucket`).
One rung is one `quickMatch({ rankBucket, matchmakeTimeoutMs })` — the SDK call
behind the transport seam — and `src/net/ranked-queue.ts` is the whole wiring,
whose one caller is the Online panel's Auto Match Making: the rating comes off
the driver's own file (a fresh 1000 for a driver who has never raced, signed in
or not), the rungs are computed once, and the room that lands is a MATCHMADE
room, which is the fact RK-03's rated wire hangs off.

Widening is safe because of an asymmetry in the pool's criteria rule, kept
verbatim from HexMatch's comment: the pool requires a room to satisfy every key
a request asks for, not to match exactly — so a plain search sees ANY waiting
room, including a ranked one's, while a ranked search only sees rooms tagged
with its own bucket. That is why the ladder's LAST rung asks for no rank at all:
a driver who has waited out the tight windows can see, and be seen by, everyone.
The ladder is walked ONCE — after it the search stays at Any rank for as long as
the driver leaves it running, because a window closing means widen and look
again, never "no rival found". Cancel is the only exit: it bumps the token the
loop checks after every await, and a pair that lands anyway is left rather than
sat in.

Two facts about the dev sidecar are worth knowing before reading the tests: its
`matchmake` action falls through to `joinOrCreate`, so it answers every request
instantly with a room — a lone searcher is never left waiting on a window, and
no browser spec here can watch one close. So the WIDENING is proven against a
pool model in `tests/matchmake.test.ts` (two drivers 600 points apart, each
widening rung by rung until the Any-rank search joins the other's still-narrow
room), and the two-browser spec proves the other half: a seeded rank file
reaches the wire, two ratings that round into one bucket are paired into one
lobby with no code typed, and two a tier apart are not.

Still to come in this epic: **RK-05** (badges, the lobby's rated line and the
ladder panel, which reads `rankStore().loadLadder()` and the runtime's
`outcome`, plus the panel's ranked/friendly labels) and **RK-06** (the ranked
E2E sweep: a matchmade race whose seats show matching deltas, and the
mid-race-leaver room test in a three-human race).

## Credits And The Pit Shop

Your first account receives 400 welcome credits. Every completed quick race or
championship heat pays 500/350/275/220/180/150/120/100/80/60 credits by placement,
plus 5 credits per orange peg collected. DNFs and abandoned heats pay nothing.
Results include a winnings breakdown and a shortcut to the shop.

Buy speed boosts, jumps, oil slicks, shockwaves, temporary triple mass,
95% drag reduction, freeze rays and ghost mode. Every purchase adds one charge
to the same inventory used by glowing-peg and mystery-box pickups. All eight
slots are visible in the bottom toolbar, with counts, hotkeys and effect timers.
Timed items cannot be spent again while active. An invalid freeze target does
not consume a charge. A shared 450ms deployment cooldown prevents double taps.

Credits and inventory persist locally across seasons and quick races. Used items
are saved immediately, including if you quit or reload; unused items and pickups
carry over. Up to nine charges of each type may be stored. `src/game/economy.ts`
validates saves and records race IDs so the same result cannot pay twice.

## Extended Circuits

All six circuits now have three times their original sector count (30-42 sectors).
They are longer courses, not stretched ramps or three repeated laps. Each has
hundreds of disappearing pegs, at least one Peggle board per five sectors, and
glowing item pegs with a marked, deterministic drop. Hit pegs bounce normally,
then shrink and disappear after 150ms. Clearances around scattered pegs preserve
rolling paths and the anti-stall recovery remains in place.

The minimap shows the full circuit, peg sectors, racers, camera window, finish
and completion percentage. Its collapse button works on desktop and mobile.
Only nearby course geometry is loaded into the physics solver, while the
renderer and minimap retain the full map.

## Track Definitions (Map Builder, MB-01)

Every circuit is a list of `Builder` calls, and `src/game/trackdef.ts` can now record that list as a
versioned, JSON-safe `TrackDef` — so a procedural circuit becomes data a player can edit, save and share
(the rest of the map-builder epic builds on this).

- `generateTrackDef(seed, profile)` records a circuit; `buildTrackFromDef(def)` rebuilds it;
  `validateTrackDef(value)` is the untrusted-input boundary (share codes, saves, the network) and answers
  with a readable reason instead of throwing.
- The rebuild is exact — body count, kinds, positions, angles, vertices, ramp surfaces, peg colours,
  dropped items, wrecking-ball phases, spinner angles, decor and the sectors all compare equal, and two
  engines running the same heat step for step over 12,625 ticks stay on identical coordinates. A def is
  therefore a recording of the builder calls (`flip` mirrors a piece about the centre line) rather than a
  translation of them, which is what keeps procedural output untouched.
- Start grid, gate and the finish stub are never stored: the loader always synthesises them, so every
  track starts and ends the same way and a def only describes what a player designs.
- `Game` accepts a def through `GameOptions.def`; a malformed one never throws mid-race — the race falls
  back to the procedural circuit and `Game.trackDefError` says why.

## The Workshop (Map Builder, MB-02)

**Workshop** in the garage header opens the track editor on a copy of the circuit the garage is showing —
for the default seed, Marblehurst — recorded as a `TrackDef` and rebuilt on every change. This ticket is
the shell a player builds inside; placing, moving and rotating pieces comes with MB-03, and a test drive
with MB-04.

- The canvas is the race's own renderer drawing the race's own track (`render()` over a `Game` built from
  the current def), so nothing about the look is a second implementation. The editor never steps the
  simulation — `Game` exists there to be drawn.
- Camera: drag or scroll to pan, pinch or ⌘/ctrl + scroll to zoom (or the toolbar's +/− and `0`, as in a
  race), with `Home`/`End` jumping to the ends. The camera is clamped to the pipe's sides and the
  circuit's ends, so a drag cannot lose the track.
- A 25-unit snap grid (toggleable; the lattice steps up to 100, 500 … units as you pull out) and a height
  ruler down the left edge, which also marks START and FINISH and the camera's own height.
- The course map on the right is the race minimap's data — sectors, rail surfaces, the finish — drawn as a
  scrollbar: drag it to move the camera, and the red window is what the canvas is showing.
- The piece palette groups the fifteen pieces a `TrackDef` can store, each tile showing the sprite the race
  draws it with; arming a tile is the shell's whole canvas interaction for now.
- An edit rebuilds the circuit and drops the game's baked static chunks (`clearStaticChunks`), so no frame
  is ever drawn from an out-of-date bake.
- On a phone the palette collapses into a bottom drawer, and the header carries a Workshop button.

## Physics And Recovery

`src/game/physics.ts` contains the shared 120 Hz step, high-resolution marble
colliders, consistent ramp geometry and slope-only rolling assistance.
Acceleration is continuous rather than an instant minimum-speed kick. Free-fall
starts from rest under gravity; flat floors do not generate speed.

`src/game/engine.ts` monitors displacement and downhill progress, not just velocity.
After approximately 1.3 seconds without movement, a gentle nudge frees balanced
marbles. A marble still trapped after repeated nudges receives a collision-checked
local marshal reset. Jittering without descent is detected separately. This is
applied equally to player and AI, is never allowed to reset past the finish, and
does not cancel freeze or oil penalties. Recovery clears trails so reset positions
do not draw lines across the circuit.

Races continue until all ten finish, with a nine-minute safety limit for the longer circuits. Once the
player finishes, the camera follows the remaining field and offers 2x spectating.
The final classification is an immutable snapshot and the simulation stops.

## Tests

Run the complete check with `node scripts/check.mjs`.

Run physics and championship tests only with
`node --import tsx --test tests/physics.test.ts`.

Run browser tests with `node --import tsx --test tests/browser.test.ts`.

The simulation's import tree is deliberately free of the SDK — `season.ts`
hands its device cache to `storage.ts` at boot (`bindStorage`) rather than
importing it, because the SDK builds its API object at module scope and reads
`window` doing it. That is what lets a node test construct a `Game` at all.

The build automatically runs type checking and the regression suites. A small
PostCSS configuration provides this build gate without changing the supplied
npm scripts or Vite configuration. It does not transform CSS or run tests when
starting the development server.

Physics coverage includes 2/5/10-degree slopes in both directions, extreme stat
builds, flat-floor momentum, level starts, gravity, high-speed collisions, dense
funnels, traps, out-of-bounds recovery, freeze/oil timing, anvil mass, stat budgets,
18 full-length races across the six circuits, procedural features, item pickups,
inventory consumption, effect expiry and championship points. Economy tests in
`tests/economy.test.ts` cover purchases, insufficient funds, capped inventory,
corrupt saves, payout amounts and duplicate-payout prevention.
`tests/rating.test.ts` covers the rating (RK-01): HexMatch's RANK-01 tests
ported to a race, plus the two claims the epic's acceptance names outright — a
two-human race equals a duel exactly, pair for pair, and a six-driver race's
deltas sum to zero apart from rounding. It also sweeps every finishing place to
show that finishing higher never pays less; checks that a DNF ranks below every
finisher, that two DNFs tie, and that a leaver counts as a DNF even when the
classification lists them as a finisher; keeps AI seats off the board and files
nothing for a solo race; round-trips the stored file, clamps a hostile record
and refuses somebody else's JSON; checks the wire's clamping and its
fresh-1000 default for a driver the room never heard from; and pins the tier
table — contiguous bands, the top one open-ended, HexMatch's thresholds.
`tests/rank-runtime.test.ts` covers the rated race (RK-03) end to end, with no
mocks in the middle: the real room (`tests/room-harness.ts`) between the real
`RankRuntime` and the real `createRankStore(io)` — one store per seat. It pins
the acceptance list: a rating published for another driver is dropped, a
re-publish must carry the seat's own join token, the host's claim is filed once
and only after the lights, a guest cannot claim, a claim cannot invent a driver,
a driver who walked out is a DNF in the room's own filed classification,
house-rule power-ups make a race unrated, and a race the room did not rate
writes nothing at all. Its headline test is the epic's second acceptance: three
seats, three histories, one room — including a guest that never saw a board —
and every driver's own row is exactly the row the other two seats were shown.
The leaver case is closed the same way: a survivor's verdict shows the driver
who walked out as a DNF with a negative delta, and no ladder line, because the
room witnessed the abandonment and the quitter did not.
`tests/matchmake.test.ts` covers the matchmaking loop (MP-07) and, since RK-04,
the ladder: a pool model with RUN's criteria rule, two drivers of a similar
rating matched on the tightest rung, two of very different ratings widening rung
by rung until the Any-rank search joins the other's room, and the ladder walked
once — after the last rung the search stays at Any rank for as long as it takes.
The browser half is `tests/e2e-mp/mp-ranked.e2e.spec.ts`: it seeds each player's
rating file (a dev page's mock `appStorage` is a namespaced corner of
`localStorage`, which is what the harness writes) and watches the pairing with a
real room in the middle.
`tests/rankstore.test.ts` covers where a rating lives (RK-02) by driving the
real chain — `rankstore` → `transport` → the RUN SDK's own in-memory backends,
with the browser globals stubbed the way `tests/multiplayer.test.ts` stubs them.
No module mocking: a rating file round-trips through `appStorage`; a corrupt,
half-written or foreign record falls back to a fresh 1000; a bucket that refuses
the write loses the number and says so (`stored: false`) without wedging the
session; an anonymous driver is refused rating and given the sign-in line; a win
files, writes and publishes, and a loss writes through; one race counts once
however many times the result arrives, while a rematch is a new key; a race that
was not rated is a no-op; a leaver's own seat files locally with no ladder write
and no guard key; an unreachable ladder, and a keep-best refusal, both leave the
race end intact; and `rundot/leaderboard.config.json` is checked against the
fields the SDK's own board config requires, so a typo fails here rather than at
deploy. `tests/multiplayer.test.ts` covers the transport seam: that exactly one client
module may import the SDK's realtime API (and one server module the room
server), that the room registration and the transport agree on the room type,
criteria and capacity, and the room-code, matchmaking-expiry and access-denied
helpers. `tests/protocol.test.ts` covers the race wire: that every message
validates, that unknown, oversized and forged frames are refused with the code
that says which, that a version mismatch produces the reload message, that a
ten-marble `state` frame stays far under 4 KiB, that chunked snapshots
reassemble (out of order, and after a newer transfer supersedes an older one)
and are dropped when they do not describe a world, and that the protocol module
keeps the imports the room bundle can live with. `tests/room.test.ts` drives the
relay through the SDK's own dispatch with a fake room protocol: the seed is
minted from the room id, guest-forged state is dropped while the host's is
broadcast, intents reach the host and nobody else, the seventh player is
refused, `start` locks the door, the host leaving mid-race ends the race for
everyone, and a dropped socket is announced with its reconnect window.
`tests/host.test.ts` runs a whole race through the host on a clock the test
moves by hand: the gate opens on the countdown and not before, the lights ride
out in the frames, publishing holds 20 Hz, every frame the host emits survives
`validateMessage`, guest intents steer their marble while the AI leaves human
seats alone, nudges are pacing-limited and items held to `canUseItem`, a
snapshot reassembles into the world, and — the acceptance — a guest replaying
the frame stream (it has the seed, so it has the track, so it can tell a
scoring peg from a dud) classifies the race exactly as the host's `results`
frame does. It also times the publishing against a frame budget.
`tests/guest.test.ts` stands a host and a guest either side of a fake network —
a queue with a delivery time and a seeded coin for loss — and plays a whole
race across 150 ms and 2 % loss: the picture never teleports, the guest asks
for at most one resync, and its world agrees with the host's. It also covers a
snapshot handing over the whole world, a twenty-frame blackout costing exactly
one resync, late/duplicate/out-of-order/garbage frames, every event kind, a
forged body index being ignored rather than crashed on, and the optimistic
lean being bounded and corrected.

`tests/editor-ui.test.ts` covers the editor shell (MB-02): the camera's maths
(clamping, anchor-preserving zoom, the 25-unit lattice at every zoom), the
palette's groups and art, and the shell painted to static markup — canvas,
name and theme, readouts, and a course map with the camera window in it. It
also scans the editor's sources for the rules the epic sets: a shell that never
steps the simulation, no `localStorage`, no `Math.random()`.

`tests/trackdef.test.ts` covers the track definition format (MB-01): 28
recordings across the six circuits and the default profile rebuild body for
body, a full heat on a def-built circuit races the procedural one step for step
to the same classification and times, malformed defs are refused with a
readable reason and fall back safely inside `Game`, and defs survive JSON —
including a hand-written circuit with no recorded phases.

Story coverage: `tests/story-schema.test.ts` enforces the script/art contract — every scene
id in the outline exists, every speaker resolves to a portrait mood that was drawn, every
background and prop exists, The Hood stays faceless until the chapter 5 reveal, and each
ending has its base, flag variants and season-2 teaser. `tests/story-engine.test.ts` walks
scripted all-win, all-loss, mixed and all-DNF seasons to their expected endings and checks
save→reload restores chapter, flags and seen scenes. `tests/story-modifiers.test.ts` checks
that a race with `GameOptions.story` unset is identical to today's engine, that the chapter
counters, sabotage events and AI targeting fire as scripted, and that chapter weight merges
stay deterministic.

Browser coverage checks desktop/mobile layouts, real control interactions, pause,
result contrast, long-race completion, season persistence, setup locking,
purchases, keyboard deployment, pause-safe timers, quitting and the minimap. It
uses Playwright with bundled Linux Chromium and libraries, so no system Chrome
installation is needed on Linux x64. Screenshots are written to `tests/artifacts/`.
The fixtures and browser dependencies are not included in the shipped client bundle.

The garage's **Physics lab** runs the same simulation checks interactively. It
shows actual pass/fail results only after each check executes. Randomized-map
coverage is sampled, not a mathematical guarantee for every possible seed.