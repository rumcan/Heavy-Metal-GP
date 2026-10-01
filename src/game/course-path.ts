export interface Pt {
  x: number;
  y: number;
}

export interface CoursePath {
  points: Pt[];
  cum: number[];
  length: number;
}

export function makePath(points: Pt[]): CoursePath {
  const cleanPoints: Pt[] = [];

  for (const point of points) {
    const previous = cleanPoints[cleanPoints.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y) {
      cleanPoints.push(point);
    }
  }

  if (cleanPoints.length < 2) {
    throw new Error('A course path requires at least two points');
  }

  const cum = [0];
  for (let i = 1; i < cleanPoints.length; i += 1) {
    const previous = cleanPoints[i - 1];
    const current = cleanPoints[i];
    cum.push(cum[i - 1] + Math.hypot(current.x - previous.x, current.y - previous.y));
  }

  return {
    points: cleanPoints,
    cum,
    length: cum[cum.length - 1],
  };
}

export function progressAlong(path: CoursePath, p: Pt, hint?: number): number {
  let segments: number[] = [];

  if (hint !== undefined) {
    const minProgress = hint - 400;
    const maxProgress = hint + 400;
    for (let i = 0; i < path.points.length - 1; i += 1) {
      if (path.cum[i + 1] >= minProgress && path.cum[i] <= maxProgress) {
        segments.push(i);
      }
    }
  }

  if (segments.length === 0) {
    segments = Array.from({ length: path.points.length - 1 }, (_, i) => i);
  }

  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestProgress = 0;

  for (const i of segments) {
    const start = path.points[i];
    const end = path.points[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const segmentLengthSquared = dx * dx + dy * dy;
    const projection = ((p.x - start.x) * dx + (p.y - start.y) * dy) / segmentLengthSquared;
    const t = Math.max(0, Math.min(1, projection));
    const projectedX = start.x + t * dx;
    const projectedY = start.y + t * dy;
    const offsetX = p.x - projectedX;
    const offsetY = p.y - projectedY;
    const distanceSquared = offsetX * offsetX + offsetY * offsetY;

    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestProgress = path.cum[i] + t * Math.sqrt(segmentLengthSquared);
    }
  }

  return Math.max(0, Math.min(path.length, bestProgress));
}

export function pointAt(path: CoursePath, d: number): Pt {
  const distance = Math.max(0, Math.min(path.length, d));

  for (let i = 0; i < path.points.length - 1; i += 1) {
    if (distance <= path.cum[i + 1]) {
      const start = path.points[i];
      const end = path.points[i + 1];
      const segmentLength = path.cum[i + 1] - path.cum[i];
      const t = (distance - path.cum[i]) / segmentLength;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }
  }

  return { ...path.points[path.points.length - 1] };
}

export function rankByProgress(
  entries: { id: number; progress: number; finishedAt: number | null }[],
): number[] {
  return entries
    .slice()
    .sort((a, b) => {
      if (a.finishedAt !== null && b.finishedAt !== null) {
        return a.finishedAt - b.finishedAt || a.id - b.id;
      }
      if (a.finishedAt !== null) return -1;
      if (b.finishedAt !== null) return 1;
      return b.progress - a.progress || a.id - b.id;
    })
    .map((entry) => entry.id);
}