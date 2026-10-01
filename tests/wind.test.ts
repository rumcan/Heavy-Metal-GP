// P2-02 (#108): an Updraft (wind piece) must push the ball the way its arrows point.
// Bug: the Workshop's rotate tool stores the turn in the generic `rot` field. The renderer turns the
// art by `rot`, but the physics only reads `dir`, so a vent drawn blowing sideways still blows up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTrackFromDef } from '../src/game/trackdef';
import type { TrackDef, WindPiece } from '../src/game/trackdef';
import { meta } from '../src/game/track';

/** A minimal circuit holding one wind piece. */
function trackWith(wind: Partial<WindPiece>): TrackDef {
  const piece: WindPiece = { t: 'wind', a: [340, 1000], b: [560, 1260], dir: 270, str: 0.34, pulse: 0, phase: 0, ...wind };
  return { v: 1, name: 'wind test', theme: 'classic', height: 3000, pieces: [piece] } as TrackDef;
}

/** The (ux, uy) push direction the physics will apply for this def. */
function push(def: TrackDef): { ux: number; uy: number } {
  const track = buildTrackFromDef(def);
  const body = track.bodies.find((b) => meta(b)?.kind === 'wind');
  assert.ok(body, 'the def builds a wind field');
  const w = meta(body).wind!;
  return { ux: w.ux, uy: w.uy };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

test('wind: dir alone points the push (0 = right, 90 = down, 180 = left, 270 = up)', () => {
  for (const [dir, ux, uy] of [[0, 1, 0], [90, 0, 1], [180, -1, 0], [270, 0, -1]] as const) {
    const p = push(trackWith({ dir }));
    assert.ok(near(p.ux, ux) && near(p.uy, uy), `dir ${dir}: got (${p.ux.toFixed(3)}, ${p.uy.toFixed(3)})`);
  }
});

test('wind: a Workshop rotation (rot) turns the push exactly like it turns the art', () => {
  // An upward vent (270°) turned 90° clockwise on screen must blow RIGHT (0°).
  const p = push(trackWith({ dir: 270, rot: 90 }));
  assert.ok(near(p.ux, 1) && near(p.uy, 0), `dir 270 + rot 90 should blow right, got (${p.ux.toFixed(3)}, ${p.uy.toFixed(3)})`);
  // And 270 + 180 blows down.
  const q = push(trackWith({ dir: 270, rot: 180 }));
  assert.ok(near(q.ux, 0) && near(q.uy, 1), `dir 270 + rot 180 should blow down, got (${q.ux.toFixed(3)}, ${q.uy.toFixed(3)})`);
});

test('wind: a rotated vent pushes inside the rotated area, not the original one', () => {
  // A tall 220×260 vent turned 90° becomes a wide 260×220 field around the same centre.
  const track = buildTrackFromDef(trackWith({ dir: 270, rot: 90 }));
  const w = meta(track.bodies.find((b) => meta(b)?.kind === 'wind')!).wind!;
  assert.ok(near(w.box.w, 260) && near(w.box.h, 220), `box ${w.box.w}×${w.box.h}`);
  assert.ok(near(w.box.x + w.box.w / 2, 450) && near(w.box.y + w.box.h / 2, 1130), 'same centre');
});
