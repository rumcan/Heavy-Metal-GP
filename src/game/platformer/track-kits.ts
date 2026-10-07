// Workshop track kits for side-scrolling courses: ready-made shapes built from ordinary ramps and curves, joined end to
// end in ride order, so they stay editable piece by piece. Every kit is placed around (x, y): y is the floor line.
import type { Piece } from '../trackdef';

/** The loop's radius. The Loop piece rides at 90; keep the kit close to it (it must be ridable at a normal run-up speed). */
export const KIT_R = 100;
/** Half the gap between the way into a loop and the way out (the two cross at the bottom). */
export const KIT_HALF_PITCH = 60;
/** Run-up and run-out length. */
export const KIT_RUN = 500;

type V = [number, number];
const ramp = (a: V, b: V): Piece => ({ t: 'ramp', a, b, cliff: false });
const curve = (a: V, c: V, b: V): Piece => ({ t: 'curve', a, c, b, n: 12, cliff: false });

/** The four quarter curves of a loop standing on the floor line y at x (entry at x - H, exit at x + H). */
export function loopCurves(x: number, y: number, R = KIT_R, H = KIT_HALF_PITCH): Piece[] {
  return [
    curve([x - H, y], [x + R, y], [x + R, y - R]),            // along the floor and up the far side
    curve([x + R, y - R], [x + R, y - 2 * R], [x, y - 2 * R]), // over the top (upside down)
    curve([x, y - 2 * R], [x - R, y - 2 * R], [x - R, y - R]), // down the near side
    curve([x - R, y - R], [x - R, y], [x + H, y]),             // back to the floor, crossing the way in
  ];
}

/** A loop with its run-up and run-out: 6 pieces, joined end to end. */
export function loopKit(x: number, y: number): Piece[] {
  const H = KIT_HALF_PITCH;
  return [ramp([x - KIT_RUN, y], [x - H, y]), ...loopCurves(x, y), ramp([x + H, y], [x + KIT_RUN, y])].map((p) => ({ ...p, grp: 1 }));
}

/** Two loops one after the other, joined by a straight. */
export function doubleLoopKit(x: number, y: number): Piece[] {
  const H = KIT_HALF_PITCH, gap = 2 * KIT_R + 2 * H + 200;
  const x1 = x - gap / 2, x2 = x + gap / 2;
  return [
    ramp([x1 - KIT_RUN, y], [x1 - H, y]), ...loopCurves(x1, y), ramp([x1 + H, y], [x2 - H, y]), ...loopCurves(x2, y), ramp([x2 + H, y], [x2 + KIT_RUN, y]),
  ].map((p) => ({ ...p, grp: 1 }));
}

/** An overpass: a flat track and a steep one diving across it. The one placed later (the dive) is in front. */
export function overpassKit(x: number, y: number): Piece[] {
  return [ramp([x - 500, y], [x + 500, y]), ramp([x - 400, y - 200], [x + 400, y + 200])].map((p) => ({ ...p, grp: 1 }));
}
