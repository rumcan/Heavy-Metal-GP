/**
 * MB-02. The Workshop's camera, and the lattice the editor works on.
 *
 * The camera is a plain object inside a mutable `CameraRig`: pointer handlers write to it, the render loop
 * reads it every frame, and a drag therefore never waits for a React render. Everything in here is a pure
 * function of the rig, the viewport and the circuit's height — no React, no canvas, no DOM — so the feel of
 * pan and zoom, the fit, and the 25-unit snap grid the palette will place pieces on (MB-03) are checked
 * without a browser in `tests/editor-ui.test.ts`.
 */
import { W } from '../../game/track';

export interface EditorCamera {
  /** World x under the middle of the canvas. */
  x: number;
  /** World y under the middle of the canvas. */
  y: number;
  /** Screen pixels per world unit. */
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The lattice pieces snap to, in world units — the ticket's snap grid. */
export const SNAP = 25;
/** How far the camera may travel past the pipe's sides and the circuit's ends. Edits near a wall stay reachable. */
export const PAD_X = 150;
export const PAD_Y = 90;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;
/** Width of the ruler strip down the canvas's left edge, in CSS pixels. */
export const RULER_W = 52;
/** World units of height one screen shows when the editor opens: the same view the race screens start on. */
export const FIT_HEIGHT = 900;
/**
 * The smallest scale the Workshop *opens* at, however narrow the screen. Fitting the pipe's full 900-unit
 * width into a phone (about 330px of canvas) would put the lattice 7px apart, which is no way to place a
 * piece — so a narrow canvas opens zoomed in far enough to work and pans sideways to the walls, exactly as a
 * race on a phone does. `Fit` still fits.
 */
export const MIN_WORK_SCALE = 0.5;

/**
 * The editor's camera plus the measurements it is clamped against. The canvas keeps `width`/`height` current on
 * resize and the editor keeps `trackHeight`/`startY` current as the circuit is built, so the toolbar and the
 * course map can move the camera without knowing about the canvas or the DOM.
 */
export interface CameraRig {
  camera: EditorCamera;
  width: number;
  height: number;
  trackHeight: number;
  startY: number;
}

export function newRig(): CameraRig {
  return { camera: { x: W / 2, y: 0, scale: 1 }, width: 0, height: 0, trackHeight: 0, startY: 0 };
}

export const clampZoom = (scale: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));

/** The scale that fits the whole pipe across the canvas, and a race screen of track down it. */
export function fitScale(width: number, height: number): number {
  if (width < 1 || height < 1) return 1;
  return clampZoom(Math.min((width - RULER_W - 8) / (W + 90), height / FIT_HEIGHT));
}

/** The scale the Workshop opens at: the fit, unless the canvas is too narrow to work at. */
export function openScale(width: number, height: number): number {
  if (width < 1 || height < 1) return 1;
  return clampZoom(Math.max(fitScale(width, height), Math.min(height / FIT_HEIGHT, MIN_WORK_SCALE)));
}

/** Keeps the camera inside the circuit: the pipe's sides, and past its ends only by the working margin. */
export function clampCamera(camera: EditorCamera, width: number, height: number, trackHeight: number): EditorCamera {
  const scale = clampZoom(camera.scale);
  const halfW = width / 2 / scale;
  const halfH = height / 2 / scale;
  // Too wide (or too tall) to overflow: centre that axis instead of pinning it to an edge.
  const x = halfW >= W / 2 + PAD_X ? W / 2 : Math.max(halfW - PAD_X, Math.min(W - halfW + PAD_X, camera.x));
  const span = Math.max(1, trackHeight);
  const y = halfH >= span / 2 + PAD_Y ? span / 2 : Math.max(halfH - PAD_Y, Math.min(span - halfH + PAD_Y, camera.y));
  return { x, y, scale };
}

/** The world rectangle a camera shows on a canvas of this size. */
export function viewWindowOf(camera: EditorCamera, width: number, height: number) {
  return {
    left: camera.x - width / 2 / camera.scale,
    right: camera.x + width / 2 / camera.scale,
    top: camera.y - height / 2 / camera.scale,
    bottom: camera.y + height / 2 / camera.scale,
  };
}

/** Where a point on the canvas lands in the world. */
export function worldAt(camera: EditorCamera, screenX: number, screenY: number, width: number, height: number): Point {
  return { x: camera.x + (screenX - width / 2) / camera.scale, y: camera.y + (screenY - height / 2) / camera.scale };
}

/** Zooms to `scale`, keeping the world point under (screenX, screenY) exactly where it is on screen. */
export function zoomAbout(camera: EditorCamera, scale: number, screenX: number, screenY: number, width: number, height: number): EditorCamera {
  const next = clampZoom(scale);
  const anchor = worldAt(camera, screenX, screenY, width, height);
  return { x: anchor.x - (screenX - width / 2) / next, y: anchor.y - (screenY - height / 2) / next, scale: next };
}

/** Snaps a world coordinate onto the lattice. */
export const snapValue = (value: number, step = SNAP) => Math.round(value / step) * step;
export const snapPoint = (point: Point, step = SNAP): Point => ({ x: snapValue(point.x, step), y: snapValue(point.y, step) });

/**
 * The drawing pitch of the lattice, in world units: always a multiple of the 25-unit snap step, always far
 * enough apart to read at the current zoom. `major` is where the heavier lines (and nothing else) go.
 */
export function gridStep(scale: number, minGap = 12): { minor: number; major: number } {
  const minor = [SNAP, SNAP * 2, SNAP * 4, SNAP * 20, SNAP * 80, SNAP * 400].find((step) => step * scale >= minGap) ?? SNAP * 400;
  return { minor, major: minor * 4 };
}

/** Spacing of the ruler's labelled ticks, in world units, so labels never collide. */
export function rulerStep(scale: number, minGap = 46): number {
  return [SNAP, SNAP * 2, SNAP * 4, SNAP * 10, SNAP * 20, SNAP * 100, SNAP * 200].find((step) => step * scale >= minGap) ?? SNAP * 200;
}

/** World units the way the HUD writes them: 16324 → "16 324". */
export function formatUnits(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Percentage for the zoom readout. */
export const formatZoom = (scale: number) => `${Math.round(scale * 100)}%`;

// ---------------------------------------------------------------- rig actions

/** The canvas area a rig can actually draw into — the ruler covers the left edge of it. */
const drawWidth = (rig: CameraRig) => Math.max(1, rig.width);

/** Puts the camera at a scale, keeping the middle of the canvas where it is. */
export function rigScale(rig: CameraRig, scale: number): void {
  const { camera, width, height, trackHeight } = rig;
  rig.camera = clampCamera(zoomAbout(camera, scale, drawWidth(rig) / 2, height / 2, width, height), width, height, trackHeight);
}

/** Zooms about the middle of the canvas (what the toolbar's +/− do). */
export function rigZoom(rig: CameraRig, factor: number): void {
  rigScale(rig, rig.camera.scale * factor);
}

/** Puts a world height in the middle of the canvas (what the course map and the jump buttons do). */
export function rigCenter(rig: CameraRig, worldY: number): void {
  const { camera, width, height, trackHeight } = rig;
  rig.camera = clampCamera({ ...camera, y: worldY }, width, height, trackHeight);
}

/** Fits the whole pipe across the canvas (what the toolbar's Fit does). */
export function rigFit(rig: CameraRig): void {
  rig.camera = clampCamera({ ...rig.camera, scale: fitScale(rig.width, rig.height) }, rig.width, rig.height, rig.trackHeight);
}

/** Opens on the start grid at the working scale — the picture a race begins with. */
export function rigOpen(rig: CameraRig): void {
  const { width, height, trackHeight, startY } = rig;
  rig.camera = clampCamera({ x: W / 2, y: startY + 115, scale: openScale(width, height) }, width, height, trackHeight);
}
