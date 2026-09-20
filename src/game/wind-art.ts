/** Shared visual geometry; the wind field and its forces remain unchanged. */
interface WindField {
  ux: number;
  uy: number;
  box: { x: number; y: number; w: number; h: number };
}

export const WIND_FAN_ART = { x: 0, y: 0, w: 112, h: 80 };

function halfRun(wind: WindField): number {
  return Math.min(
    Math.abs(wind.ux) > 1e-8 ? wind.box.w / (2 * Math.abs(wind.ux)) : Infinity,
    Math.abs(wind.uy) > 1e-8 ? wind.box.h / (2 * Math.abs(wind.uy)) : Infinity,
  );
}

/** Centre the machine on the upwind edge so the dust grows out of its vent. */
export function windFanAnchor(wind: WindField) {
  const run = Math.max(0, halfRun(wind) - 12);
  return {
    x: wind.box.x + wind.box.w / 2 - wind.ux * run,
    y: wind.box.y + wind.box.h / 2 - wind.uy * run,
  };
}

/** Source vortex points up, with its narrow tip at the machine. Clip it to the field. */
export function windDustPose(wind: WindField) {
  const half = halfRun(wind);
  return {
    angle: Math.atan2(wind.uy, wind.ux) + Math.PI / 2,
    width: Math.abs(wind.uy) * wind.box.w + Math.abs(wind.ux) * wind.box.h,
    height: Math.max(1, half + Math.max(0, half - 12)),
  };
}
