# Sound: music, effects and the announcer

Everything we play is generated for the game with RUN credits (`rundot generate music | sfx | tts`) and listed in one
file, `src/game/sound/manifest.json`. Nothing third-party, nothing streamed.

## Making the sounds

```bash
node scripts/audio/generate.mjs --dry-run   # what is missing and the credit estimate
node scripts/audio/generate.mjs             # make every missing file (music first, then stingers, announcer, effects)
node scripts/audio/generate.mjs --id ui-buy # remake one (delete the file first)
```

- Files land in `public/audio/{music,stingers,voice,sfx}/<id>.mp3`. Vite copies `public/` next to `index.html`, so they
  ship as files beside the single-file build and are **never inlined** (the html is already ~22 MB).
- RUN rate-limits generation to about one file a minute; the script waits as told and retries.
- The CLI is .NET and parses `0.5` with the machine's number format: the script runs it in the invariant culture.
- Approximate cost: a 3-minute track 675 credits, a 2-minute one 450, a sound effect 2-12, an announcer line ~6.

## The radio (`src/game/sound/radio.ts`, `src/components/RadioPill.tsx`)

Ported from HexMatch's MUSIC-1 / RADIO-2 player: the pill with ‹ station ›, play, skip and a volume slider, a phone
mode that is just the play key (long press shows the line), the station dial, the duck under voice lines.

The difference: the music follows the game. On **Auto** (the default) each part of the game tunes its station:

| Where | Station | What |
| --- | --- | --- |
| Menus, garage, shop, lobbies, results, the Workshop | Pit Lane Radio | Funk-rock, tavern folk, lofi, blues |
| A race (quick, championship, online, story races, test drives) | Grid Metal FM | Six heavy metal racing anthems |
| Infinity | Infinity Skies | Cinematic travel music: eight day tracks made for the biomes (meadow, valley, pine forest, autumn, lake, snow) and three night tracks. The biome and the sky choose the next track; a playing one is never cut off |
| Story scenes | Storybook | Three story themes, quiet under dialogue |

Picking a station on the pill holds it everywhere until Auto is picked again. Tracks crossfade; a station shuffles its
tracks and never repeats the last one straight away. The play key turns the radio off and on (remembered, in
`storage.ts`). The game's mute (M) silences it; a hidden tab silences it; voice lines and stingers duck it to 25 %.

**Stingers** (short music over the radio): a win fanfare, a podium jingle, a finish jingle, a knock-out sad trombone,
level-up, chapter complete, the championship trophy.

## Effects (`src/game/audio.ts`, `src/game/sound/bank.ts`)

The old synth recipes stay as the fallback: a sound whose recording is missing, still loading or undecodable plays its
synth, silently. Recordings play through the same master (mute and the compressor cover them); rivals are quieter and
only audible on screen, as before; each take is picked at random from its variations with a little pitch drift.

Recorded now: the start lights and the go horn, the cannons, jumps, soft and hard landings, lane hops, the sheep spring,
item boxes, the Tab trial pickup, rings, smash crates, marble clacks, fire rings, geysers, the loop, the finish line,
damage hits and knock-outs, wrecking balls, boost pads, the Magic Engine overheating, a sticky bomb going off, and
**every one of the 24 skills** with its own sound.

Loops for the ball the camera follows (`raceAudio.setDrive`): rolling (level and pitch follow the speed on the
ground), wind (follows the speed, louder in the air), the Magic Engine while it pushes, and the crowd along the finish
straight. Ambience beds under the music: the forest by day, crickets by night, high wind.

Menu sounds (`raceAudio.ui`): every button press clicks and tabs tick (a delegated listener in `App.tsx`; a button
opts out with `data-sound="none"`), the shop's till, an error buzz, the unlock reveal, and the Workshop's place,
delete and undo.

## The announcer (`src/game/sound/announcer.ts`)

The Narrator (the cast's booming announcer voice) calls your race: the start, taking and losing the lead, halfway,
the final stretch, your knock-outs, being knocked out, low health, big air, a mystery skill in the Tab slot, and your
finish. `decide()` is pure and tested: at most one call at a time with a pause between calls; the finish and a
knock-out cut in. The lines ship as files (`public/audio/voice/`), not in the inlined voice sets, and have no caption
strip. Story and tutorial races keep him quiet; the voice setting (on/off, volume) covers him.

## Tests

`tests/sound.test.ts`: the manifest (unique ids, durations the CLI accepts, every sound the code asks for is in it,
every skill has a sound), the radio's station logic and settings, the announcer's rules and takes.
