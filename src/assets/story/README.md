# Story mode art

Game-ready story art for the **Story mode epic (#22)**. Everything is sliced, resized and converted to WebP. The high-resolution sources are in `assets/story/` (don't import from there).

**Use `src/game/story/assets.ts` instead of paths.** It exposes typed helpers, so a wrong name is a type error:

```ts
import { storyPortrait, portraitFacing, storyBackground, storyEnding, actBanner, chapterPlaque, storyProp } from '../game/story/assets';

storyPortrait('old-smokey', 'sad');           // string URL
storyPortrait('the-hood-hidden', 'smirk');    // before the reveal
storyBackground('vex-gilded-office');
storyEnding('heartbreak-ending');
actBanner(2); chapterPlaque(5);
storyProp('contract-scroll');
```

`_preview.jpg` in this folder shows every image with its name.

Budget: 68 files, about 3.8 MB. The game builds to one inlined HTML file, so only import `assets.ts` from story code. Don't add more images without resizing them the same way.

## backgrounds/ (1280×720, full background)
Dialogue scenes. Each keeps the lower third calm for the dialogue box. Use `object-fit: cover` for phones.

| Name | Scene / suggested use |
|---|---|
| `scrapyard-at-dusk` | Sprocket's home. Intro, Act I opening |
| `apex-racing-garage` | Team garage. Pre-race briefings |
| `grandstand-race-day` | Paddock and grandstand. Pre-race banter, rival confrontations |
| `old-smokey-training-shack` | Old Smokey's shack. Mentor scenes, training montage |
| `vex-gilded-office` | Duchess Vex's office. The deal (Act II) |
| `pit-lane-at-night` | After the sabotage and crash. Midpoint low (Act II) |
| `mine-control-room` | Vex's rig in the mine. Villain reveal (Act III) |
| `finale-podium` | Finale podium, night. Pre-finale and results |

## endings/ (1280×960, full background)
| Name | Characters shown |
|---|---|
| `champion-ending` | Sprocket (1st, trophy), Old Smokey, Ace Spadegrin (2nd), The Hood, Duchess Vex (background) |
| `bittersweet-ending` | Ace (1st), The Hood (2nd), Sprocket (3rd), Old Smokey |
| `heartbreak-ending` | Sprocket with a cracked marble, Old Smokey with an umbrella, Zapp Gutwrench (background) |

## portraits/ (256×256, transparent, head-and-shoulders)
Named `<character>_<mood>.webp`. They face **right** unless noted, and share the bottom-aligned bust framing of the race portraits.

| Character | Moods |
|---|---|
| `sprocket` | happy\*, sad, smug, shocked |
| `ace-spadegrin` | angry, happy, surprised, sad, smug, shocked |
| `duchess-vex` | angry, happy, surprised, sad, smug, shocked |
| `old-smokey` | angry, happy, surprised, sad, smug, shocked |
| `zapp-gutwrench` | angry, happy, surprised, sad, smug, shocked |
| `the-hood-hidden` | stern (faces **left**), smirk, snarl, grimace (faces **left**). Face in shadow; use **before** the chapter 5 reveal |
| `the-hood-revealed` | ashamed, angry, determined, relieved. Use **only after** the reveal |

\* `sprocket_happy` is garage driver 1's portrait. It has the square painted background of the player sheet, unlike the transparent ones. Show it inside the ring frame (`Portrait` / `.kit-portrait`) so the background is hidden.

`angry`, `happy` and `surprised` for the rivals are the same art the race uses (`src/assets/portraits/rNN_*.webp`), copied here under readable names.

## titles/ (transparent, lettering included)
| Name | Text |
|---|---|
| `act-1-the-rookie` | ACT I: THE ROOKIE |
| `act-2-the-rise-and-the-fall` | ACT II: THE RISE AND THE FALL |
| `act-3-down-we-go` | ACT III: DOWN WE GO |
| `chapter-1-the-scrapyard-kid` | Chapter 1, Marblehurst GP |
| `chapter-2-street-smarts` | Chapter 2, Monte Pipo |
| `chapter-3-old-smokeys-lessons` | Chapter 3, Silverpeg |
| `chapter-4-the-deal` | Chapter 4, Spa-Francoroll |
| `chapter-5-the-hood` | Chapter 5, Suzuka Spiral |
| `chapter-6-down-we-go` | Chapter 6, Yas Marble finale |

## props/ (≤320 px, transparent)
Pop-up items for scenes ("Vex slides the contract across…"):
`contract-scroll`, `wrench-and-bolt`, `cracked-marble`, `folded-hood`, `iron-trophy`, `gold-coin-bag`, `mine-blueprint`, `old-racing-helmet`, `framed-photo` (two old racers, faces unclear; suggested use: young Old Smokey and The Hood), `dynamite-bundle`, `lantern`, `checkered-flag`.
