// P2-25: the Infinity look and sound. Biomes blend slowly (no jumps in the colour grade), the day drifts smoothly,
// the music only ever picks notes from the biome's scale, and the particle budget stays bounded and shrinks for
// Reduce motion and slow frames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIOMES, BIOME_KM, BLEND_KM, biomeAt, dayAt, gradeAt, particleBudget, particlesAt, startOffset } from '../src/game/infinity-look';
import { emptyRecords, normalizeRecords } from '../src/game/infinity-store';

test('biomes: at least five, unique, each with a scale and a particle kind', () => {
  assert.ok(BIOMES.length >= 5);
  assert.equal(new Set(BIOMES.map((b) => b.id)).size, BIOMES.length);
  for (const b of BIOMES) {
    assert.ok(b.scale.length >= 5 && b.scale[0] === 0, b.id);
    assert.ok(b.tintAmount >= 0 && b.tintAmount <= 0.6 && b.glowAmount >= 0 && b.glowAmount <= 0.3, b.id);
  }
});

test('biomes: 10 km shows at least five different biomes, and the seed changes where a run starts', () => {
  const seen = new Set<string>();
  for (let km = 0; km <= 10; km += 0.05) seen.add(biomeAt(km, 1).from.id);
  assert.ok(seen.size >= 5, `${seen.size} biomes in 10 km`);
  const starts = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => biomeAt(0, s).from.id));
  assert.ok(starts.size >= 3, 'different seeds open in different places');
  assert.equal(startOffset(9), startOffset(9));
});

test('biomes: the blend never jumps: the grade moves by a hair per 10 m, and a biome holds still outside its blend', () => {
  for (const seed of [1, 42, 977]) {
    let prev = gradeAt(0, 0, seed);
    for (let km = 0.01; km <= 30; km += 0.01) {
      const g = gradeAt(km, 0, seed);
      const step = Math.max(...g.tint.map((c, i) => Math.abs(c - prev.tint[i])), ...g.glow.map((c, i) => Math.abs(c - prev.glow[i])));
      assert.ok(step < 4, `seed ${seed}: the grade jumped by ${step.toFixed(1)} at ${km.toFixed(2)} km`);
      assert.ok(Math.abs(g.tintAlpha - prev.tintAlpha) < 0.02 && Math.abs(g.night - prev.night) < 0.02);
      prev = g;
    }
  }
  const settled = biomeAt(BIOME_KM - BLEND_KM - 0.1, 3);
  assert.equal(settled.t, 0, 'before the blend starts, a biome is itself');
  assert.equal(biomeAt(BIOME_KM - 0.0001, 3).t > 0.99, true, 'the blend finishes as the biome ends');
});

test('time of day: dawn, noon, dusk and midnight come round, smoothly, and the night has stars', () => {
  const noon = dayAt(9 * 0.25, 0);
  const midnight = dayAt(9 * 0.75, 0);
  const dusk = dayAt(9 * 0.5, 0);
  assert.ok(noon.dark < 0.05 && noon.stars === 0, 'noon is bright');
  assert.ok(midnight.dark > 0.9 && midnight.stars > 0.9, 'midnight is dark and starry');
  assert.ok(dusk.warm > 0.5, 'dusk is warm');
  let prev = dayAt(0, 0);
  for (let km = 0.01; km < 14; km += 0.01) {
    const d = dayAt(km, 0);
    assert.ok(Math.abs(d.dark - prev.dark) < 0.02 && Math.abs(d.warm - prev.warm) < 0.03, `the day jumped at ${km.toFixed(2)} km`);
    prev = d;
  }
  assert.ok(dayAt(0, 3 * 60 * 1000).phase > dayAt(0, 0).phase, 'standing still, the day still drifts slowly');
});

test('particles: the blend shows both kinds; the budget is bounded, smaller for Reduce motion and slow frames', () => {
  const blending = particlesAt(BIOME_KM - BLEND_KM / 2, 1);
  assert.equal(blending.length, 2);
  assert.ok(particlesAt(0.5, 1).length === 1);
  const desk = particleBudget(1920, 1080, 16, false);
  assert.ok(desk > 0 && desk <= 260);
  assert.ok(particleBudget(375, 812, 16, false) < desk, 'a phone draws fewer');
  assert.ok(particleBudget(1920, 1080, 16, true) <= desk * 0.3, 'Reduce motion draws far fewer');
  assert.ok(particleBudget(1920, 1080, 60, false) < desk / 2, 'slow frames cut the count');
  assert.equal(particleBudget(0, 0, 16, false), 0);
});

test('records: Reduce motion is remembered and old records read as off', () => {
  assert.equal(emptyRecords().reduceMotion, false);
  assert.equal(normalizeRecords({ bestKm: 2 }).reduceMotion, false);
  assert.equal(normalizeRecords({ reduceMotion: true }).reduceMotion, true);
  assert.equal(normalizeRecords({ reduceMotion: 'yes' }).reduceMotion, false);
});
