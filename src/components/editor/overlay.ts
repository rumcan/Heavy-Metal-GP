/**
 * MB-02. The two things the Workshop draws on top of the race's own renderer: the 25-unit snap grid, and the
 * ruler down the left edge.
 *
 * Both are plain canvas work against the camera — the track's art is untouched beneath them, and because the
 * grid depends on the zoom (a 25-unit lattice is a grey smear at 20 %) it steps up to 100, 500 … units as the
 * camera pulls back. Everything here is a function of an explicit view, so the drawing can be reasoned about
 * (and its maths tested) without a browser.
 */
import { W } from '../../game/track';
import { RULER_W, formatUnits, gridStep, rulerStep, viewWindowOf } from './camera';
import type { EditorCamera, Point } from './camera';

export interface OverlayView {
  camera: EditorCamera;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
  /** World y of the finish, so the ruler can name it. */
  finishY: number;
  /** Total height of the circuit being edited. */
  trackHeight: number;
  /** Where the pointer is, in world units, or null while it is off the canvas. */
  cursor: Point | null;
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/** The world rectangle the camera currently shows. */
export function viewWindow(view: Pick<OverlayView, 'camera' | 'width' | 'height'>) {
  return viewWindowOf(view.camera, view.width, view.height);
}

/** World → screen, for the canvas the view describes. */
function screenOf(view: OverlayView) {
  const { camera, width, height } = view;
  return {
    x: (worldX: number) => (worldX - camera.x) * camera.scale + width / 2,
    y: (worldY: number) => (worldY - camera.y) * camera.scale + height / 2,
  };
}

/**
 * The snap grid, clipped to the pipe: lines every `gridStep().minor` world units with a heavier line every
 * fourth, so the lattice always reads as "25 units" whatever the zoom.
 */
export function drawGrid(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const { camera, width, height } = view;
  const at = screenOf(view);
  const win = viewWindow(view);
  const left = Math.max(0, at.x(0));
  const right = Math.min(width, at.x(W));
  if (right - left < 4) return;
  const { minor, major } = gridStep(camera.scale);

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, 0, right - left, height);
  ctx.clip();
  ctx.lineWidth = 1;

  // Two passes so the heavier lattice sits on top of the fine one.
  for (const heavy of [false, true]) {
    ctx.beginPath();
    for (let wx = 0; wx <= W; wx += minor) {
      if (isMajor(wx, major) !== heavy) continue;
      const x = Math.round(at.x(wx)) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let wy = Math.floor(win.top / minor) * minor; wy <= win.bottom + minor; wy += minor) {
      if (isMajor(wy, major) !== heavy) continue;
      const y = Math.round(at.y(wy)) + 0.5;
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.strokeStyle = heavy ? 'rgba(178,205,226,0.30)' : 'rgba(158,190,211,0.13)';
    ctx.stroke();
  }

  // The playfield's edges, so the wall the grid stops at is never a surprise.
  ctx.strokeStyle = 'rgba(214,62,46,0.35)';
  ctx.beginPath();
  for (const wx of [0, W]) {
    const x = Math.round(at.x(wx)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  ctx.stroke();
  ctx.restore();
}

const isMajor = (value: number, step: number) => Math.abs(value % step) < 1e-6;

/**
 * The ruler: labelled heights in world units down the left edge, the camera's own height marked in the accent
 * colour, and START/FINISH named where they fall. It is the tape measure the palette places against.
 */
export function drawRuler(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  const { camera, height, trackHeight, finishY } = view;
  const at = screenOf(view);
  const win = viewWindow(view);

  ctx.save();
  ctx.fillStyle = 'rgba(9,15,24,0.86)';
  ctx.fillRect(0, 0, RULER_W, height);
  ctx.strokeStyle = 'rgba(52,71,88,0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(RULER_W + 0.5, 0);
  ctx.lineTo(RULER_W + 0.5, height);
  ctx.stroke();

  const step = rulerStep(camera.scale);
  ctx.font = `8px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let wy = Math.floor(win.top / step) * step; wy <= win.bottom + step; wy += step) {
    if (wy < 0 || wy > trackHeight) continue;
    const y = Math.round(at.y(wy)) + 0.5;
    if (y < 9 || y > height - 9) continue;
    const heavy = isMajor(wy, step * 2);
    ctx.strokeStyle = heavy ? 'rgba(160,184,206,0.75)' : 'rgba(130,156,178,0.45)';
    ctx.beginPath();
    ctx.moveTo(RULER_W - (heavy ? 11 : 7), y);
    ctx.lineTo(RULER_W - 1, y);
    ctx.stroke();
    ctx.fillStyle = heavy ? '#c3d4e2' : '#8298ac';
    ctx.fillText(formatUnits(wy), RULER_W - 13, y);
  }

  ctx.font = `bold 7px ${MONO}`;
  ctx.textAlign = 'left';
  for (const [worldY, label, color] of [[0, 'START', '#b6cb99'], [finishY, 'FINISH', '#f2f5fa']] as [number, string, string][]) {
    const y = at.y(worldY);
    if (y < 14 || y > height - 14) continue;
    ctx.fillStyle = color;
    ctx.fillText(label, 4, y);
  }

  // Where the camera is, in the accent colour: the ruler's only moving part.
  const centre = Math.round(at.y(camera.y)) + 0.5;
  ctx.strokeStyle = 'rgba(214,62,46,0.85)';
  ctx.beginPath();
  ctx.moveTo(0, centre);
  ctx.lineTo(RULER_W, centre);
  ctx.stroke();
  ctx.fillStyle = '#d63e2e';
  ctx.beginPath();
  ctx.moveTo(RULER_W - 5, centre - 4);
  ctx.lineTo(RULER_W, centre);
  ctx.lineTo(RULER_W - 5, centre + 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** A crosshair on the pointer, drawn on the lattice when the snap grid is armed. */
export function drawCursorMark(ctx: CanvasRenderingContext2D, view: OverlayView): void {
  if (!view.cursor) return;
  const at = screenOf(view);
  const x = Math.round(at.x(view.cursor.x)) + 0.5;
  const y = Math.round(at.y(view.cursor.y)) + 0.5;
  ctx.save();
  ctx.strokeStyle = 'rgba(214,62,46,0.8)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 9, y);
  ctx.lineTo(x - 3, y);
  ctx.moveTo(x + 3, y);
  ctx.lineTo(x + 9, y);
  ctx.moveTo(x, y - 9);
  ctx.lineTo(x, y - 3);
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x, y + 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fillStyle = '#d63e2e';
  ctx.fill();
  ctx.restore();
}
