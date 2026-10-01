# Voice (P2-03)

Voice-over for the tutorial (P2-13), the story (P2-14) and the Workshop tour (P2-15), on RUN.world TTS.
Everything here is **data**: a casting table, one text manifest per set, and the generated-audio map the
player reads. The code lives in `src/game/voice.ts` (player), `src/components/VoiceSubtitles.tsx` (captions)
and `scripts/voice/*` (the generator).

```
src/voice/cast.json                 speaker → { name, voiceId, stability, speed, style }
src/voice/manifests/<set>.json      [{ id, speaker, text }]            ← the only file a writer edits
src/voice/generated/<set>.json      id → { file, hash, durationSec }   ← written by the generator
src/assets/voice/<set>/<id>.mp3     the audio itself                   ← written by the generator
```

The player **always** saves the subtitle text in the manifest and optionally plays audio for it, so a set
with no generated audio yet still works: the caption strip runs the line for an estimated reading time.

## Casting

Eleven spokesgoblins and a narrator. Preview any of them with:

```bash
node scripts/voice/previews.mjs          # markdown sheet with preview URLs (needs `rundot`)
node scripts/voice/previews.mjs --json   # the same as data
```

| Speaker | Character | Voice (ElevenLabs name) | Voice id | Notes |
|---|---|---|---|---|
| `narrator` | Narrator | British Football Announcer | `gU0LNdkMOQCOrPrwtbee` | tutorial + how-to-play + race intros |
| `sprocket` | Sprocket | Goofy Cartoon Kid *(fallback)* | `BRruTxiLM2nszrcCIpz1` | **wants a designed voice** — see below |
| `old-smokey` | Old Smokey | Grampa Werthers – Old & Cranky | `MKlLqCItoCkvdhrxgtLv` | |
| `zapp-gutwrench` | Zapp Gutwrench | Dr. Quibble – Nerdy Cartoon Scientist | `RDSy0QN68yhrjuOgqzQ4` | also the Workshop guide (P2-15) |
| `duchess-vex` | Duchess Vex | Clara – Wicked Villain | `YC9NjC58jpXEqLpIxUeA` | |
| `the-hood` | The Hood | calm, mysterious, serious | `AyUV5TrQjlUkoKURhcfz` | |
| `ace-spadegrin` | Ace Spadegrin | Callum – Husky Trickster | `N2lVS1w4EtoT3dr4eOWO` | |
| `big-grubba` | Big Grubba | Azgar the Cursed – The Orc Troll | `3VkFsBHdRPqWKsitgYhJ` | |
| `knuckles-blau` | Knuckles Blau | Garrison – Rugged and Stoic | `xHxp1c5pQOzhWjBqV78M` | |
| `scorch` | Scorch | Harry – Fierce Warrior | `SOYHLrjzK2X1ezoPC6cr` | |
| `red-morrigan` | Red Morrigan | Ember – Energetic Confident Protagonist | `WtA85syCrJwasGeHGH2p` | |

Not cast yet (add when a content ticket needs them): Rivet Rex, Lucky Thirteen, Violetta Voltz,
Barrelbeard, Jinx, Skullcap Morg, Grimbolt.

### Sprocket's designed voice

The ticket asks for a designed voice — *"young cheeky goblin, high-pitched, fast-talking, scrappy"* — and
this checkout could not run the CLI, so he is on the documented fallback. On a machine with `rundot`:

```bash
rundot generate design-voice --description "young cheeky goblin, high-pitched, fast-talking, scrappy" --name "Sprocket" --json
rundot generate save-voice --json                 # note the voice id it prints
# put that id in src/voice/cast.json → sprocket.voiceId, then:
node scripts/voice/generate.mjs --set samples --force sprocket-hello --dry-run
```

The one-line hashes in `src/voice/generated/*.json` change when the voice changes, so the next real run
regenerates only the lines that need it.

## Generating audio

```bash
node scripts/voice/generate.mjs --set samples --dry-run   # line count + credit estimate, writes nothing
node scripts/voice/generate.mjs --set samples             # synthesize, convert, record hashes
node scripts/voice/generate.mjs --set samples --force sprocket-hello
node scripts/voice/generate.mjs --list
```

| Flag | What it does |
|---|---|
| `--set <name>` | manifest set (repeatable, `a,b`, or `all`) |
| `--dry-run` | print the plan and the cost; touch nothing |
| `--force <id>` | regenerate one line (`all` for everything) |
| `--remote` | record the hosted URL instead of the mp3 (see below) |
| `--model <id>` | TTS model, default `eleven_v3` |
| `--cap <credits>` | refuse a run whose estimate exceeds it (**default 1000**; `0` disables) |
| `--max-mb <mb>` | bundled-audio budget for all sets, default **8** |
| `--cli <path>` | the `rundot` binary (default: `rundot` on `PATH`) |
| `--root <dir>` | repo root, for tests |

**Caching is by hash** of `voiceId + text + model + stability + speed + style + mode`. A cached line never
calls the CLI again, which is what keeps credits from leaking: edit one line of a set of fifty and exactly
one line is re-synthesized. The hash is recorded in `src/voice/generated/<set>.json` and `tests/voice.test.ts`
fails if a manifest edit ever ships stale audio.

`ffmpeg` is used when it is on `PATH`: each mp3 is converted to **mono 48 kbps** and its duration is read
with `ffprobe`. Without ffmpeg the original file is kept and the duration comes from the CLI's JSON (or, as
a last resort, from the mp3 frame headers in `mp3DurationSec`).

### The budget

The game builds to ONE html file, so every mp3 is inlined. **All voice together must stay under 8 MB**
(`--max-mb`); the generator prints the running total and exits non-zero if a run pushes it over. Rough
sizes at 48 kbps mono: 1 second ≈ 6 KB, a 10-second line ≈ 60 KB, so 8 MB is about 22 minutes of speech —
plenty for the tutorial, the Workshop tour and a story with a few hundred lines, but each set should still
be measured with `--dry-run` before a large run.

### Remote mode (`--remote`) — ⚠️ UNVERIFIED inside RUN

`rundot generate tts --json` returns a hosted audio URL. If the game is allowed to play it, nothing needs
to be bundled and the 8 MB budget stops mattering.

**Verified:** the player's remote path works — pointed at an audio file on another origin, the caption ran
for exactly the file's length and cleared on the `ended` event. **Not verified:** whether RUN.world's own
content security policy permits hosted media; the CLI was not available where this was built, so step 3
below is the one nobody has run. Default is bundled, which is known to work.

How to verify it in ten minutes, on a machine with the CLI:

1. `node scripts/voice/generate.mjs --set samples --remote` (3 lines, ~450 credits).
2. `npm run dev`, open the game, press **How to play → Play the 3 voice samples**.
3. With DevTools open, watch the console. A blocked URL reads
   `Refused to load media from 'https://…' because it violates the following Content Security Policy directive: "media-src …"`.
4. Plays = remote mode is viable (document it here and use it for the big story sets). Blocked = keep `--remote`
   for prototyping only, and bundle.

## Writing lines (P2-13 / P2-14 / P2-15)

Add `src/voice/manifests/<set>.json`:

```json
[
  { "id": "workshop-place-piece", "speaker": "zapp-gutwrench", "text": "Pick a piece, drop it on the grid, and squeeze the handles until it fits." }
]
```

* `id` is kebab-case and unique inside the set; it becomes the mp3's file name, so it is also the key a
  screen passes to `playVoice('workshop', 'workshop-place-piece')`.
* `speaker` must exist in `cast.json` (`npm run check`'s `tests/voice.test.ts` fails otherwise).
* `text` is the exact script, and it is also the subtitle. The `eleven_v3` model understands inline audio
  tags — `[whispers]`, `[shouts]`, `[laughs]`, `[sighs]`, `[excited]` — use them sparingly for flavour.
  They are sent to the voice as-is and **stripped from the caption**, so a line of pure stage direction
  shows nothing rather than `[sighs]`.
* Runs of the same set are cheap to grow: only new or edited lines are synthesized.

## The player

```ts
import { playVoice, preloadVoice, stopVoice } from '../game/voice';
import VoiceSubtitles from '../components/VoiceSubtitles';

await playVoice('tutorial', 'steer-01');   // resolves when the line ends OR is skipped
preloadVoice('tutorial', 'steer-02');      // warm the next line while this one talks
stopVoice();                               // skip / the player quit
```

Mount `<VoiceSubtitles />` on the screen (it is a viewport portal and needs no props). One line plays at a
time: a new `playVoice` stops the previous one and resolves its promise.

Settings live in RUN storage under `heavy-metal-gp:voice` (`{ enabled, volume }`) and are edited in the
How to play dialog: **Voice-over** on/off and a **volume** slider. `raceAudio`'s mute (**M**) always wins:
muting cuts the current line and blocks new audio. Captions keep running in both cases, so a muted or
un-voiced line still reads.

Dev-only: the How to play dialog has a **Play the N voice samples** button that runs the `samples` set line
by line, captions and all. With no generated audio yet it demonstrates the subtitle fallback.
