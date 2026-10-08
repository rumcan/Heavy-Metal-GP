// Run with: node --import tsx --test tests/camera-smooth.test.ts
// The motion the camera follows (issue #282, part A):
// - the frame time the motion runs on is smoothed, so uneven browser frames do not judder the picture, and over any
//   stretch it still adds up to the real time (frame-clock.ts);
// - the ground the camera stands on has no jump at a chasm's edge (ground.ts laneGroundAt), so the whole picture no
//   longer leaps when the camera passes one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoothFrameMs } from '../src/game/frame-clock';
import { laneGroundAt } from '../src/game/platformer/ground';
import { floorAt } from '../src/game/platformer/course';
import type { CoursePlan, Floor } from '../src/game/platformer/course';
import { chunkTracks, infinityChunk } from '../src/game/platformer/infinity';
import { newTrackCamera, trackCameraY } from '../src/game/platformer/camera-y';

const FRAME = 1000 / 60;
/** A small deterministic generator (the jitter must be the same every run). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const sd = (a: number[]) => { const m = a.reduce((t, x) => t + x, 0) / a.length; return Math.sqrt(a.reduce((t, x) => t + (x - m) ** 2, 0) / a.length); };

test('a steady 60 Hz frame is taken as it is', () => {
  let m: number | null = null;
  for (let i = 0; i < 300; i++) { m = smoothFrameMs(m, FRAME); assert.ok(Math.abs(m - FRAME) < 1e-9, `frame ${i}: ${m}`); }
});

test('uneven frames (+-2 ms of jitter) are evened out: the picture moves by ~a third as much from frame to frame', () => {
  const r = rng(11);
  const raw: number[] = [], smooth: number[] = [];
  let m: number | null = null;
  for (let i = 0; i < 2000; i++) {
    const f = FRAME + (r() - 0.5) * 4;
    raw.push(f);
    m = smoothFrameMs(m, f);
    smooth.push(m);
  }
  const steps = (a: number[]) => a.slice(1).map((x, i) => x - a[i]);
  const before = sd(steps(raw)), after = sd(steps(smooth));
  assert.ok(after <= before / 2.5, `frame-to-frame sd ${before.toFixed(3)} ms raw, ${after.toFixed(3)} ms smoothed`);
});

test('over a stretch the smoothed frame time adds up to the real time (the filter only spreads the jitter)', () => {
  const r = rng(29);
  let m: number | null = null, sumRaw = 0, sumSmooth = 0;
  for (let i = 0; i < 3000; i++) {
    const f = 8 + r() * 25; // a wide spread of frame times, 8 to 33 ms
    sumRaw += f;
    m = smoothFrameMs(m, f);
    sumSmooth += m;
  }
  // the only difference left is the filter's residual at the end (about a frame): no drift, however long the run
  assert.ok(Math.abs(sumSmooth - sumRaw) < 2 * 33, `${(sumSmooth - sumRaw).toFixed(2)} ms apart over ${(sumRaw / 1000).toFixed(1)} s`);
});

test('a stall (a frame far off the last one) is real time, taken as it is; the frame after it is back at the frame rate, with no lag', () => {
  const m = smoothFrameMs(null, FRAME);
  assert.equal(smoothFrameMs(m, 100), 100, 'the stall is not smoothed away');
  assert.equal(smoothFrameMs(100, FRAME), FRAME, 'the next frame is not dragged out by the stall');
  assert.equal(smoothFrameMs(null, 42), 42, 'the first frame is its own');
});

// ------------------------------------------------------------------ the ground under the camera

/** A plan of just these floors (lane 0), with no rope bridges. */
function planOf(floors: Floor[]): CoursePlan {
  return { floors, bridges: [] } as unknown as CoursePlan;
}
const floor = (lane: number, x0: number, y0: number, x1: number, y1: number): Floor => ({ lane, x0, y0, x1, y1 } as Floor);

test('laneGroundAt is the floor where there is one, and the straight line across a chasm', () => {
  const plan = planOf([floor(0, 0, 100, 100, 100), floor(0, 300, 200, 400, 200)]);
  assert.equal(laneGroundAt(plan, 0, 50), 100);
  assert.equal(laneGroundAt(plan, 0, 350), 200);
  assert.equal(laneGroundAt(plan, 0, 200), 150, 'halfway across the chasm: halfway between its two edges');
  // continuous at both edges of the chasm
  assert.ok(Math.abs(laneGroundAt(plan, 0, 100 - 1e-6)! - laneGroundAt(plan, 0, 100 + 1e-6)!) < 1e-3);
  assert.ok(Math.abs(laneGroundAt(plan, 0, 300 - 1e-6)! - laneGroundAt(plan, 0, 300 + 1e-6)!) < 1e-3);
  // beyond the course's ends: the nearest floor's height
  assert.equal(laneGroundAt(plan, 0, -50), 100);
  assert.equal(laneGroundAt(plan, 0, 900), 200);
  assert.equal(laneGroundAt(planOf([]), 0, 10), null, 'a lane with no floor at all');
});

test('over Infinity land the camera’s ground has no jump anywhere (the picture never leaps at a chasm)', () => {
  const seed = 23364627; // the daily seed's land
  const chunks = Array.from({ length: 14 }, (_, i) => infinityChunk(seed, i));
  const plan = { floors: chunks.flatMap((c) => c.floors), bridges: chunks.flatMap((c) => c.bridges), ...chunkTracks(chunks) } as unknown as CoursePlan;
  let worst = 0, samples = 0, gaps = 0;
  for (const lane of [0, 1, 2] as const) {
    let prev: number | null = null;
    for (let x = 0; x < 19_000; x += 2) {
      const y = laneGroundAt(plan, lane, x);
      if (floorAt(plan, lane, x) === null) gaps++;
      if (y !== null && prev !== null) worst = Math.max(worst, Math.abs(y - prev) / 2);
      if (y !== null) { samples++; prev = y; }
    }
  }
  console.log(`# Infinity ground: ${samples} samples, ${gaps} over a gap, the steepest 2 px step ${worst.toFixed(3)} px per px`);
  assert.ok(samples > 25_000 && gaps > 0, 'the land has chasms to bridge');
  // a steep floor is about 1.2 px per px (infinity.ts): a jump would show as a step of many px in 2 px
  assert.ok(worst <= 1.3, `the ground steps ${worst.toFixed(2)} px per px somewhere`);
});

// ------------------------------------------------------------------ the camera's height (Infinity and the races)

test('the camera holds still on the track while the ball bobs over it (nothing bobs with the bumps)', () => {
  const st = newTrackCamera();
  const ys: number[] = [];
  const r = rng(5);
  for (let i = 0; i < 300; i++) {
    const ballY = 600 + (r() - 0.5) * 60; // a bobbing ball, well inside the room
    ys.push(trackCameraY(st, { ground: 600, ballY, height: 720, scale: 1, dtMs: FRAME, framed: i > 0 }));
  }
  for (const y of ys.slice(1)) assert.ok(Math.abs(y - (600 - 15)) < 1e-9, `the camera moved to ${y}`);
});

test('on a steady slope the camera follows the track exactly (no lag behind it)', () => {
  const st = newTrackCamera();
  for (let i = 0; i < 300; i++) {
    const ground = 600 + 0.8 * i * 16; // a grade of 0.8 px per px travelled, 16 px a frame
    const y = trackCameraY(st, { ground, ballY: ground, height: 720, scale: 1, dtMs: FRAME, framed: i > 0 });
    if (i > 0) assert.ok(Math.abs(y - (ground - 15)) < 1e-6, `frame ${i}: ${y} vs ${ground - 15}`);
  }
});

test('a ball high in the air lifts the camera (eased) to keep it on screen, and it comes back down when it lands', () => {
  const st = newTrackCamera();
  trackCameraY(st, { ground: 600, ballY: 600, height: 720, scale: 1, dtMs: FRAME, framed: false });
  const room = 720 * 0.38;
  let y = 0;
  for (let i = 0; i < 120; i++) y = trackCameraY(st, { ground: 600, ballY: 600 - room - 200, height: 720, scale: 1, dtMs: FRAME, framed: true });
  assert.ok(y < 600 - 15 - 150, `the camera lifted to ${y}`);
  for (let i = 0; i < 300; i++) y = trackCameraY(st, { ground: 600, ballY: 600, height: 720, scale: 1, dtMs: FRAME, framed: true });
  assert.ok(Math.abs(y - (600 - 15)) < 0.5, `back on the track: ${y}`);
});
