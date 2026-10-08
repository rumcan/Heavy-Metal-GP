// The warm-up (the owner: add optimisation and preloading images so the game runs as smooth as possible). After the
// app has started, in the browser's idle moments: every canvas picture is decoded (art.ts registers them), then each
// module's own warm-up runs (render.ts builds the foreground pines' looks). So the first time a picture is drawn in a
// race it is ready, instead of being decoded right then (a hitch).
import { registeredArt } from './art';

type Idle = (fn: () => void) => void;
const idle: Idle = (fn) => {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 400 });
  else setTimeout(fn, 16);
};

/** How many pictures decode at once (each decode runs off the main thread; a few at a time keeps memory calm). */
const AT_ONCE = 3;

const after: (() => boolean)[] = [];
/**
 * A warm-up step to run once the pictures are decoded: called in idle moments until it returns true (done). Each call
 * should do one small piece of work (one canvas, say), so no idle moment runs long.
 */
export function afterArt(step: () => boolean): void { after.push(step); if (finished) runSteps(); }

let started = false, finished = false, stepping = false;

/** Start the warm-up (once; later calls do nothing). */
export function preloadArt(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const queue = registeredArt();
  let active = 0;
  const pump = () => {
    while (active < AT_ONCE && queue.length) {
      const img = queue.shift()!;
      active++;
      const done = () => { active--; idle(pump); };
      // decode() runs off the main thread and keeps the decoded picture ready; an image that fails to load is skipped
      if (typeof img.decode === 'function') img.decode().then(done, done);
      else done();
    }
    if (!active && !queue.length && !finished) { finished = true; runSteps(); }
  };
  idle(pump);
}

function runSteps(): void {
  if (stepping) return;
  stepping = true;
  const next = () => {
    const step = after[0];
    if (!step) { stepping = false; return; }
    let done = true;
    try { done = step(); } catch { done = true; }
    if (done) after.shift();
    idle(next);
  };
  idle(next);
}
