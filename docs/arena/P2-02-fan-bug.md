# Arena battle pack: P2-02 (#108) Updraft fan blows the wrong way

**Battles:** 1. **Files the battle writes:** `src/game/wind-rotation.ts` (only).
**Gate in our repo:** `npx tsc --noEmit -p .` + `node --import tsx --test tests/wind-rotation.test.ts tests/wind.test.ts tests/mb10e.test.ts tests/engine-checksum.test.ts`.
**Wiring Claude does after copying the file in (not part of the battle):**
1. `src/game/trackdef.ts` `replayPiece()`: `piece = bakeWindRotation(bakeLineRotation(piece));`
2. `src/components/editor/rotate.ts`: remove `'wind'` from `ROT_TYPES` (its own `case 'wind'` already turns `a`, `b` and `dir`).

---

## Message 1 (paste as-is)

````text
You are helping fix a bug in a TypeScript game (a 2D marble racer built with Vite + Matter.js). Read everything below. Do NOT write any code yet.

THE BUG
A wind field ("Updraft vent") pushes marbles along `dir` (degrees: 0 = right, 90 = down, 180 = left, 270 = up; y grows downwards). The level editor has a generic rotate tool that stores a turn in a separate field `rot` (degrees, clockwise on screen). The renderer turns the vent's art by `rot`, but the physics only reads `dir` and the box corners `a`/`b`. So a vent rotated to point sideways still blows the marble up.

THE FIX YOU WILL WRITE
One small pure function, in a new file `src/game/wind-rotation.ts`, that "bakes" `rot` into the geometry before the level is built:

  export function bakeWindRotation<P extends WindLike>(piece: P): P

Rules:
1. If `piece.rot` is missing or 0, return the SAME object unchanged.
2. Otherwise return a NEW object (don't mutate the input) where:
   - the turn is `piece.flip ? -rot : rot` (a mirrored piece is drawn mirrored, so its turn reads the other way);
   - `dir` becomes `(dir + turn)` normalised into 0..359 (handle negatives and values over 360);
   - the field area turns about its own centre: take the rectangle with corners `a` and `b`, rotate its four corners by `turn` degrees (clockwise on screen, i.e. standard rotation in y-down coordinates: x' = cx + dx·cos − dy·sin, y' = cy + dx·sin + dy·cos), and set `a` = top-left and `b` = bottom-right of the axis-aligned box around the rotated corners (the physics field is always axis-aligned);
   - round coordinates to 0.1 (Math.round(v * 10) / 10);
   - delete the `rot` key entirely;
   - keep every other field as it was.
3. No imports from other project files. Define the type locally:

  export type Vec = [number, number];
  export interface WindLike { t: 'wind'; a: Vec; b: Vec; dir: number; rot?: number; flip?: boolean }

EXISTING CODE IT MUST MATCH (for reference: same rounding and rotation maths, from src/game/trackdef.ts)

  const LINE_TYPES = new Set<Piece['t']>(['curve', 'conveyor', 'mud', 'bridge']);
  export function bakeLineRotation<P extends Piece>(piece: P): P {
    if (!piece.rot || !LINE_TYPES.has(piece.t)) return piece;
    const p = piece as unknown as { a: Vec; b: Vec; c?: Vec };
    const pts = [p.a, p.b, ...(p.c ? [p.c] : [])];
    const cx = pts.reduce((s, v) => s + v[0], 0) / pts.length;
    const cy = pts.reduce((s, v) => s + v[1], 0) / pts.length;
    const r = (piece.rot * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    const turn = (v: Vec): Vec => {
      const dx = v[0] - cx, dy = v[1] - cy;
      return [Math.round((cx + dx * cos - dy * sin) * 10) / 10, Math.round((cy + dx * sin + dy * cos) * 10) / 10];
    };
    const out = { ...piece, a: turn(p.a), b: turn(p.b), ...(p.c ? { c: turn(p.c) } : {}) } as P;
    delete out.rot;
    return out;
  }

  // How the physics builds the field from dir (src/game/track.ts):
  wind(x1, y1, x2, y2, dirDeg = 270, strength = 0.28, pulseMs = 0, phaseMs = 0) {
    const px1 = this.X(x1), px2 = this.X(x2);            // X() mirrors x when the piece is flipped
    const lx = Math.min(px1, px2), hx = Math.max(px1, px2);
    const ly = Math.min(y1, y2), hy = Math.max(y1, y2);
    const mirrored = this.flip ? ((180 - dirDeg) % 360 + 360) % 360 : dirDeg;
    const fa = (mirrored * Math.PI) / 180;
    // field box = (lx, ly, hx - lx, hy - ly); push = (cos fa, sin fa)
  }

THE TESTS (file `tests/wind-rotation.test.ts`; they must all pass, unchanged)

// P2-02 (#108) battle test: standalone (no other repo imports), so the Arena sandbox can run it as-is.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bakeWindRotation } from '../src/game/wind-rotation';

type Vec = [number, number];
const vent = (over: Partial<{ a: Vec; b: Vec; dir: number; rot: number; flip: boolean }> = {}) =>
  ({ t: 'wind' as const, a: [340, 1000] as Vec, b: [560, 1260] as Vec, dir: 270, str: 0.34, pulse: 0, phase: 0, ...over });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const box = (p: { a: Vec; b: Vec }) => ({
  x: Math.min(p.a[0], p.b[0]), y: Math.min(p.a[1], p.b[1]),
  w: Math.abs(p.b[0] - p.a[0]), h: Math.abs(p.b[1] - p.a[1]),
});

test('no rot: the piece comes back unchanged (same object)', () => {
  const p = vent();
  assert.equal(bakeWindRotation(p), p);
  const zero = vent({ rot: 0 });
  assert.equal(bakeWindRotation(zero), zero);
});

test('rot 90 on an upward vent: blows right, rot removed', () => {
  const out = bakeWindRotation(vent({ dir: 270, rot: 90 }));
  assert.equal(out.dir, 0);
  assert.equal('rot' in out, false, 'rot is baked in and removed');
});

test('rot adds clockwise and wraps into 0..359', () => {
  assert.equal(bakeWindRotation(vent({ dir: 270, rot: 180 })).dir, 90);
  assert.equal(bakeWindRotation(vent({ dir: 10, rot: -30 })).dir, 340);
  assert.equal(bakeWindRotation(vent({ dir: 300, rot: 450 })).dir, 30);
});

test('rot 90 turns the field area about its centre: 220×260 becomes 260×220', () => {
  const b = box(bakeWindRotation(vent({ rot: 90 })));
  assert.ok(near(b.w, 260) && near(b.h, 220), `${b.w}×${b.h}`);
  assert.ok(near(b.x + b.w / 2, 450) && near(b.y + b.h / 2, 1130), 'same centre');
});

test('rot 45: the field becomes the axis-aligned box around the turned rectangle', () => {
  const b = box(bakeWindRotation(vent({ rot: 45 })));
  const side = (220 + 260) * Math.SQRT1_2; // both extents of a 220×260 rectangle turned 45°
  assert.ok(near(b.w, side, 0.2) && near(b.h, side, 0.2), `${b.w.toFixed(2)}×${b.h.toFixed(2)}`);
  assert.ok(near(b.x + b.w / 2, 450, 0.2) && near(b.y + b.h / 2, 1130, 0.2), 'same centre');
});

test('a flipped (mirrored) vent turns the other way on screen', () => {
  // The mirror maps dir d to 180 − d when built, so the stored turn must be negated: 270 − 90 = 180, mirrored → 0 (right).
  assert.equal(bakeWindRotation(vent({ dir: 270, rot: 90, flip: true })).dir, 180);
});

test('other fields are kept', () => {
  const out = bakeWindRotation(vent({ rot: 90 }));
  assert.equal(out.str, 0.34);
  assert.equal(out.t, 'wind');
});

PROJECT SETUP FOR YOUR SANDBOX
A plain Node 22+ TypeScript project: package.json with devDependencies "typescript" and "tsx"; tsconfig with "strict": true, "noUnusedLocals": true, "noUnusedParameters": true, "module": "ESNext", "moduleResolution": "Bundler", "target": "ES2022", "allowImportingTsExtensions": false, "noEmit": true. Test command: node --import tsx --test tests/wind-rotation.test.ts. Type-check: npx tsc --noEmit -p .

Reply with ONLY: Context received.
````

## Message 2 (paste as-is)

````text
Create these files in the project, then install, type-check and run the tests:
- package.json and tsconfig.json as described
- src/game/wind-rotation.ts (the function and its two exported types)
- tests/wind-rotation.test.ts (exactly as given, do not edit it)

Run: npx tsc --noEmit -p .  and  node --import tsx --test tests/wind-rotation.test.ts
Fix until both pass with zero errors. Do not paste code in the chat. Finish by replying with the test summary line only.
````

## Fix round template

````text
In my repo, these fail. Fix ONLY src/game/wind-rotation.ts, keep everything else the same, then re-run the type-check and tests:

<paste the exact failing output>
````
