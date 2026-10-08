// The ground a lane stands on at a world x, as one continuous function. The Infinity camera stands on it (render.ts
// trackLineY) and so does the layer of trees between the tracks (betweenTrees). Pure, so the tests can walk a course.
import { floorAt } from './course';
import type { CoursePlan, Floor, Lane } from './course';

const laneFloors = new WeakMap<CoursePlan, Floor[][]>();
function lanesOf(plan: CoursePlan): Floor[][] {
  let lists = laneFloors.get(plan);
  if (!lists) {
    lists = [0, 1, 2].map((l) => plan.floors.filter((f) => f.lane === l).sort((a, b) => a.x0 - b.x0));
    laneFloors.set(plan, lists);
  }
  return lists;
}

/** The last floor starting at or before x, and the first one starting after it (either may be missing). */
function floorsEitherSide(list: Floor[], x: number): { left: Floor | null; right: Floor | null } {
  let lo = 0, hi = list.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].x0 <= x) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return { left: at >= 0 ? list[at] : null, right: at + 1 < list.length ? list[at + 1] : null };
}

/**
 * The lane's ground at world x: the floor under it (floorAt, rope bridges included). Over a chasm, the straight line
 * between the floor it leaves and the one it reaches, so the ground has no jump at a chasm's edge (the camera used to
 * switch to a smoothed average there, and the whole picture jumped by the difference). Beyond the course's ends, the
 * nearest floor's height. null where the lane has no floor at all.
 */
export function laneGroundAt(plan: CoursePlan, lane: Lane, x: number): number | null {
  const y = floorAt(plan, lane, x);
  if (y !== null) return y;
  const { left, right } = floorsEitherSide(lanesOf(plan)[lane], x);
  if (left && right) {
    const t = (x - left.x1) / Math.max(1e-6, right.x0 - left.x1);
    return left.y1 + t * (right.y0 - left.y1);
  }
  if (left) return left.y1;
  if (right) return right.y0;
  return null;
}
