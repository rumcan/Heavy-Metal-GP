# Workshop template coordinates

Templates remain stored under `heavy-metal-templates`. They are not TrackDefs:
local positional coordinates can be negative or outside the world bounds.

- **Unversioned / version 1:** legacy files retain their original pieces and
  first-piece anchor (`x/y`, otherwise `a`, otherwise zero for each axis).
  Loading does not migrate or recenter these files. Already-clamped geometry
  cannot be recovered; resave from the original track to create a corrected v2
  template.
- **Version 2:** the selected group's visual-bounds centre is the local origin
  `(0, 0)`. Saving snapshots the pieces when the dialog opens. Placement translates
  that origin to the snapped click, without subtracting the first piece again.
  A `flip` still means `worldX = 900 - storedX`, just as in a TrackDef; therefore
  flipped local stored coordinates can be greater than 900. Directions, dimensions, angles and
  timing values are unchanged. (#99 retired the scoop: templates saved with one simply leave it
  out on placement.)
- **Buckets:** the Piece format has no bucket x coordinate; the builder owns its
  horizontal route. V2 groups containing buckets carry `fixedOriginX`, pinning
  the entire group horizontally to its saved position so relative spacing cannot
  change. Vertical placement still follows the click.
- **Unknown versions:** placement is refused, not treated as a legacy template.

`translatePiece` in `editor/translation.ts` does not clamp. It handles all authored
position fields and translates in on-screen space, accounting for flip.
`fitGroupTranslation` clamps one shared horizontal delta against all authored
coordinates, including paths and exits. Sprite/physics overhang is not itself an
invalid authored coordinate. A group wider than the track is refused rather than
compressed. These helpers can also support the movement fixes in issue #71;
existing non-template movement is intentionally unchanged here.

Both ghost preview and insertion call `placeTemplate`. The preview draws replayed
physics outlines of the resulting pieces; an X marks refused placement.

Focused regression commands:

```sh
node --import tsx --test tests/editor-templates.test.ts
node --import tsx --test --test-name-pattern='template dialog blocks' tests/browser.test.ts
npx tsc --noEmit
```
