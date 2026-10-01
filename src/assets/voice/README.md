# Voice audio (generated)

`<set>/<id>.mp3` files here are **generated**, not hand-made:

```bash
node scripts/voice/generate.mjs --set samples
```

They come from `src/voice/manifests/<set>.json` (the script) and `src/voice/cast.json` (the voice), and the
generator records what it produced in `src/voice/generated/<set>.json`. See `src/voice/README.md`.

* Don't edit or rename an mp3 by hand — the hash in `generated/<set>.json` will no longer match, the player
  will fall back to the caption, and `tests/voice.test.ts` will fail.
* Don't add audio that has no manifest line: the generator reports it as an orphan and keeps it, but nothing
  in the game can play it.
* **Budget: all voice together ≤ 8 MB.** The game builds into one html file, so every mp3 is inlined as
  base64 (≈ 4/3 of its size on disk). The generator converts to mono 48 kbps and fails a run that would go
  over `--max-mb` (default 8).
* The player imports these lazily (`import.meta.glob`, not eager), so the audio is not decoded at startup.
