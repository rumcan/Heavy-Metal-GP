# Platformer art: what the game needs

**The look:** the owner's reference images. A wooden coaster track (a red-and-white chevron rail on a timber beam) on braced trestles over mossy cliffs, waterfalls and floating islands, with goblin towers, banners, torches, sheep springs, wrecking balls, loops and coin trails. Three depth lanes: the lanes behind you are further tracks in the distance.

Art is a skin only; physics never reads it. Replace a file and keep its **name**. Deliver PNG or WebP, with transparent backgrounds where noted. Painterly style, side view, light from the top left. Draw everything sharp and fully coloured: **the game adds the haze and blur for depth itself.**

## Already in the game (reused, replace if you want)

| File (in `src/assets/game/`) | Used for |
|---|---|
| `rail-chevron.webp` | The track surface: tiled along every slope. The middle 75 % is the repeating part; the ends are iron caps. |
| `rail-wood.webp` | The beam under the rail, and the spur tracks (ledges). |
| `rock-fill.webp` | The cliff mass under the trestles (repeats). |
| `strip-moss.webp` | The mossy top edge of the cliffs. |
| `sheep-spring.webp` | Spring pads. |
| `crate.webp` | Obstacles to jump. |
| `tower-1…3.webp`, `torch.webp`, `banner.webp` | Scenery along the track. |
| `wrecking-ball.webp`, `loop-ring.webp` | Ready for the next pieces (swinging hazard, loops). |

## Wanted from the owner

| What | Size | Tiling | Background | Where it goes |
|---|---|---|---|---|
| **Sky + far background**: sky, clouds, distant floating islands with waterfalls | about 2000 × 900 | Seamless left to right | Opaque | Behind everything; scrolls very slowly. Replaces `platformer/far.webp`. |
| **Middle background**: cliffs, waterfalls, pines, an aqueduct | about 2000 × 900, art in the **bottom 60 %** | Seamless left to right | Transparent top | Over the sky, scrolling a little faster. Replaces `platformer/trees.webp`. |
| **Foreground water** at the bottom of chasms: river, foam, rocks | about 1024 × 256 | Seamless left to right | Transparent top | Drawn at the bottom of every chasm. |
| **Coin** (gold, crown emblem) and its sparkle | 128 × 128 | — | Transparent | Coin trails along the routes. |
| **Rope bridge** (lower alternative route) | about 512 × 96 | Seamless left to right | Transparent | A second, lower route under the main track. |
| **Wrecking-ball gantry**: the timber arm the ball hangs from | about 256 × 384 | — | Transparent | The swinging hazard on the track. |
| **Lane door / tunnel mouth** in the reference style | about 260 × 340 | — | Transparent | Replaces `platformer/door.webp`. Press ↑ to change lane. |
| **Ramp marker**: a post with a red flag and a blank sign board | about 200 × 260 | — | Transparent | Replaces `platformer/sign.webp`. The game writes BACK or FRONT on it. |
| **HUD**: coin counter plate, distance bar with flags and skull marker, round pause button | as in the reference | — | Transparent | The race HUD on platformer courses. |

**One theme is one set of these.** For more themes (a mine, a scrapyard), deliver the same set per theme.

*The block-style courses (Greenhollow, Misty Ridge, Training Grounds) still use the placeholder earth, grass, crate, door, sign, far and trees images in `src/assets/game/platformer/`.*
