import { catapultAngle, flipperAngle, type Meta } from './track';

/** Preview copies never arm a real launcher or mutate the workshop's physics. */
export function flipperArtAngle(fl: NonNullable<Meta['flipper']>, gameTime: number, previewTime?: number): number {
  if (previewTime === undefined) return flipperAngle(fl, gameTime);
  const period = Math.max(fl.periodMs || 1800, fl.swingMs + fl.dropMs);
  const age = ((previewTime + fl.phaseMs) % period + period) % period;
  return flipperAngle({ ...fl, firedAt: previewTime - age }, previewTime);
}

export function catapultArtAngle(ct: NonNullable<Meta['catapult']>, gameTime: number, previewTime?: number): number {
  if (previewTime === undefined) return catapultAngle(ct, gameTime);
  const period = ct.reloadMs + ct.swingMs + ct.dropMs + 700;
  return catapultAngle({ ...ct, loadedAt: previewTime - previewTime % period, firedAt: null }, previewTime);
}

// Source-image coordinates: the bolt and cup centre, not the transparent frame.
export const CATAPULT_ARM = { width: 407, height: 205, pivotX: 14, pivotY: 25, tipX: 312, tipY: 109 };
export const CATAPULT_BASE = { width: 648, height: 283, pivotX: 378, pivotY: 68 };
export const CATAPULT_ARM_AXIS = Math.atan2(CATAPULT_ARM.tipY - CATAPULT_ARM.pivotY, CATAPULT_ARM.tipX - CATAPULT_ARM.pivotX);
export const CATAPULT_ARM_LENGTH = Math.hypot(CATAPULT_ARM.tipX - CATAPULT_ARM.pivotX, CATAPULT_ARM.tipY - CATAPULT_ARM.pivotY);

export function flipperArtRect(len: number) {
  const w = len / 0.875, h = w * 96 / 320;
  return { x: w * (0.5 - 0.105), y: 0, w, h };
}
