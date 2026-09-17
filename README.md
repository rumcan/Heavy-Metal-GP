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
six-character code your host is showing) and **Quick race**, which waits for
MP-07's matchmaking. The lobby (`src/components/OnlineLobby.tsx`) shows the code
big enough to read across a room, with a copy button; the ten-slot grid (drivers
with a portrait, livery and tune, the rest marked AI, and a kick button for the
host); and, for the host, the circuit pick and the Start button, which lights up
when two drivers are in and everybody is ready. Start arms the lights six
seconds out — long enough for both browsers to build a ten-marble world from the
seed — and `RaceScreen` runs the race through a `RaceSession`
(`src/net/session.ts`), which is either the host's simulation or the guest's
picture of it. The same screen, the same HUD, one prop's difference.

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

In the garage, pick **Online** → **Host game**; the lobby shows a code. In the
other tab, **Online** → type the code → **Join with code**. Both drivers press
**Ready**, the host presses **Start the race**, and both screens count down to
the same instant. Vite also starts the room sidecar on port `9001` from
`rundot/realtime.config.json`: that is what makes host and join meet, and it
only exists on `npm run dev` (a built or previewed page mocks rooms instead, and
`src/net/transport.ts` detects that state and says so).

Still to come in the epic: **MP-07** quick match, **MP-08** presence,
reconnect and the rejoin offer (the active-match memo is already written when a
race is entered and cleared when it is left), and **MP-09** results and payouts
— an online race pays nothing yet, and online items wait for that ticket too.

Two notes for a browser that is not on the dev machine (a tunnel, a sandbox
preview, a phone on the LAN): the sidecar origin the plugin injects is
`localhost`, so point it at the origin that forwards to port 9001 with
`RUNDOT_DEV_ROOM_URL=https://… npm run dev`. And editing `vite.config.ts` while
the dev server runs makes Vite restart it, which can lose the race for port 9001
and exit with `EADDRINUSE`; restart `npm run dev` if that happens. A deliberate
leave is held for the room's 30-second reconnect grace before the other seat
sees the player leave — that is the platform's seat hold, and the room already
announces the drop (`peerStatus`) with the countdown attached.

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
`tests/multiplayer.test.ts` covers the transport seam: that exactly one client
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