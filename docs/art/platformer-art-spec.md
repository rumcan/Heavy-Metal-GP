# Platformer art: what the game needs

Every platformer course (the block courses and the rolling-slope courses) is drawn from the images below. Physics never reads them: they are a skin over plain shapes. Replace a file and the game uses the new one; keep the **same file name**.

**Where:** `src/assets/game/platformer/`

**Format:** WebP (PNG is fine to hand over; I convert it). Transparent background wherever it says "transparent". The whole set should stay under about 4 MB.

**Today's files are placeholders** (generated). Yours replace them one for one.

| File | What it is | Size to deliver | Tiling | Background | How the game uses it |
|---|---|---|---|---|---|
| `earth.webp` | The inside of the ground: soil, stones, roots | 512 × 512 | **Seamless** both ways | Opaque | Fills every floor and slope below the surface, repeated. The game darkens it toward the bottom. |
| `grass.webp` | The top edge of the ground: the grass lip and a thin soil band | about 800 × 340 (wide strip) | **Seamless** left to right | Transparent above and below | Laid along every floor top and bent along slopes. The top edge of the ground sits about 40 % down the strip. |
| `crate.webp` | A crate you jump over | 256 × 256 | — | Transparent | The obstacles in every lane (stretched to each crate's size; wide ones repeat it). |
| `door.webp` | A lane door (press ↑ inside to change lane) | about 260 × 340 | — | Transparent | Stands on the floor. The game adds a glow and an "↑ IN / ↑ OUT" label. |
| `sign.webp` | The ramp signpost | about 200 × 260, with a **blank board** in the top half | — | Transparent | Stands just before each ramp. The game writes "↗ BACK" or "↘ FRONT" on the board. |
| `far.webp` | The distant background: mountains or sky line | about 1600 × 700 | **Seamless** left to right | Opaque (it includes the sky) | Fills the screen behind everything and scrolls very slowly. |
| `trees.webp` | A closer background band (a tree line, hills, ruins…) | about 1600 × 700, art in the **bottom half** | **Seamless** left to right | Transparent top | Drawn over `far.webp`, scrolling a little faster. |

## Things to know when drawing

- **Depth is done by the game.** Lanes behind you are drawn smaller, higher, hazier and blurred, so draw everything **sharp and fully coloured**. Don't add haze yourself.
- **Side view, light from the top left.** Everything is seen from the side, like a classic platformer.
- **One theme is one set of these seven files.** For more themes (e.g. a mine, a scrapyard), deliver the same seven per theme and I'll add a theme switch.
- **Nice to have later:** a finish arch (about 400 × 400, transparent), ball trail and dust puffs, and background props (rocks, ruins, flags) to scatter along the slopes.
