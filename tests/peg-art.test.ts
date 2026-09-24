/** Peg art: every premade picture is roomy enough for marbles, fits the track, and places as one valid group. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pegArts, choosePegArt } from '../src/game/peg-art';
import { placementPieces } from '../src/components/editor/ghost';
import { validateTrackDef } from '../src/game/trackdef';
import { blankTemplate } from '../src/game/templates';
import { W } from '../src/game/track';

test('peg art: a good number of pictures, each with a unique id', () => {
  const arts = pegArts();
  assert.ok(arts.length >= 15, `${arts.length} pictures`);
  assert.equal(new Set(arts.map((a) => a.id)).size, arts.length);
});

for (const art of pegArts()) {
  test(`peg art "${art.name}": marbles fit between pegs, it fits the track and places as one group`, () => {
    assert.ok(art.dots.length >= 30, `${art.dots.length} pegs is not much of a picture`);
    for (let i = 0; i < art.dots.length; i++) for (let j = i + 1; j < art.dots.length; j++) {
      const a = art.dots[i], b = art.dots[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 22, `pegs ${i} and ${j} are too close`);
    }
    const width = Math.max(...art.dots.map((d) => d.x)) - Math.min(...art.dots.map((d) => d.x));
    assert.ok(width < W - 100, `${width} wide`);
    choosePegArt(art.id);
    const pieces = placementPieces('pegart', { x: 450, y: 1500 }, true)!;
    assert.equal(pieces.length, art.dots.length);
    assert.ok(pieces.every((p) => p.t === 'ppeg' && p.grp === pieces[0].grp), 'one group');
    const check = validateTrackDef({ ...blankTemplate(), height: 3000, pieces });
    assert.ok(check.ok, check.ok ? '' : check.error);
  });
}
