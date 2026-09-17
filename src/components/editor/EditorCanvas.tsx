/**
 * MB-02. The Workshop's canvas.
 *
 * It draws a `Game` with the race's own `render()` — so the circuit is painted by exactly the code that paints
 * a race, static chunk cache and all — and then lays the editor's overlay (snap grid, ruler, cursor mark) on
 * top of it in screen space. Nothing in here touches physics: the game is stepped only by a race (MB-04).
 *
 * Interaction is deliberately DOM-mutating rather than React state: a drag writes the camera the render loop
 * reads on the next frame, so panning and pinching stay smooth however busy the editor's React tree is. The
 * one thing that does go back to React is a throttled status (visible window + snapped cursor) for the course
 * map and the readouts.
 */
import { useEffect, useRef } from 'react';
import { render } from '../../game/render';
import type { Game } from '../../game/engine';
import { clampCamera, clampZoom, rigFit, rigOpen, snapPoint, worldAt, zoomAbout } from './camera';
import type { CameraRig, EditorCamera, Point } from './camera';
import { drawCursorMark, drawGrid, drawRuler, viewWindow } from './overlay';
import type { OverlayView } from './overlay';

export interface EditorStatus {
  /** The world window the canvas shows — the course map draws it as the camera window. */
  top: number;
  bottom: number;
  scale: number;
  /** Where the pointer is in world units (snapped when the grid is armed), or null while it is away. */
  cursor: Point | null;
}

interface Props {
  game: Game | null;
  rig: CameraRig;
  grid: boolean;
  ruler: boolean;
  onStatus: (status: EditorStatus) => void;
}

/** How often the canvas tells React where it is looking. Fast enough to feel live, slow enough to be free. */
const STATUS_MS = 90;
/** Screen pixels of drag before a press counts as a pan rather than a click. */
const DRAG_SLOP = 3;

export default function EditorCanvas({ game, rig, grid, ruler, onStatus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read through refs inside the loop: the animation frame is started once and outlives every prop change.
  const gameRef = useRef(game);
  const gridRef = useRef(grid);
  const rulerRef = useRef(ruler);
  const statusRef = useRef(onStatus);
  gameRef.current = game;
  gridRef.current = grid;
  rulerRef.current = ruler;
  statusRef.current = onStatus;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let width = 0;
    let height = 0;
    let raf = 0;
    let lastStatus = 0;
    let fitted = false;
    /** The pointer, in world units; null when it is not over the canvas. */
    let cursor: Point | null = null;

    const localPoint = (clientX: number, clientY: number): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const trackHeight = () => gameRef.current?.track.height ?? 1e6;
    const camera = () => rig.camera;
    const setCamera = (next: EditorCamera) => {
      rig.camera = clampCamera(next, width, height, trackHeight());
    };
    const toWorld = (point: Point): Point => {
      const world = worldAt(camera(), point.x, point.y, width, height);
      return gridRef.current ? snapPoint(world) : world;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      rig.width = width;
      rig.height = height;
      const dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // ---- pointer: drag to pan, two fingers to pan + pinch-zoom -------------
    const pointers = new Map<number, Point>();
    let pan: { from: Point; camX: number; camY: number } | null = null;
    let pinch: { spread: number; world: Point; scale: number } | null = null;
    const spreadOf = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    const middleOf = (): Point => {
      const [a, b] = [...pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        pan = { from: { x: event.clientX, y: event.clientY }, camX: camera().x, camY: camera().y };
      } else if (pointers.size === 2) {
        pan = null;
        const middle = localPoint(middleOf().x, middleOf().y);
        pinch = { spread: spreadOf(), world: worldAt(camera(), middle.x, middle.y, width, height), scale: camera().scale };
      }
      cursor = toWorld(localPoint(event.clientX, event.clientY));
    };

    const pointerMove = (event: PointerEvent) => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch && pointers.size >= 2) {
        // Zoom about the midpoint of the two fingers and let that midpoint drag the circuit with it.
        const middle = localPoint(middleOf().x, middleOf().y);
        const scale = clampZoom(pinch.scale * (spreadOf() / pinch.spread));
        setCamera({ x: pinch.world.x - (middle.x - width / 2) / scale, y: pinch.world.y - (middle.y - height / 2) / scale, scale });
      } else if (pan) {
        const dx = event.clientX - pan.from.x;
        const dy = event.clientY - pan.from.y;
        if (Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) canvas.classList.add('is-panning');
        setCamera({ x: pan.camX - dx / camera().scale, y: pan.camY - dy / camera().scale, scale: camera().scale });
      }
      cursor = toWorld(localPoint(event.clientX, event.clientY));
    };

    const pointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        pan = null;
        canvas.classList.remove('is-panning');
      }
    };
    const pointerLeave = () => { if (!pointers.size) cursor = null; };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event.clientX, event.clientY);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      if (event.ctrlKey || event.metaKey) {
        // A trackpad pinch arrives as a ctrl-wheel; so does the deliberate ⌘/ctrl + wheel zoom.
        setCamera(zoomAbout(camera(), camera().scale * Math.exp(-event.deltaY * unit * 0.0022), point.x, point.y, width, height));
        return;
      }
      // Otherwise the wheel is a scroll: pan the circuit, as the ticket asks.
      setCamera({ x: camera().x + (event.deltaX * unit) / camera().scale, y: camera().y + (event.deltaY * unit) / camera().scale, scale: camera().scale });
    };

    // ---- keyboard: the race screens' zoom keys, plus scrolling --------------
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const page = Math.max(80, height / camera().scale) * 0.9;
      switch (event.code) {
        case 'Equal': case 'NumpadAdd': rigZoomAbout(1.25); break;
        case 'Minus': case 'NumpadSubtract': rigZoomAbout(1 / 1.25); break;
        case 'Digit0': case 'Numpad0': rigFitHere(); break;
        case 'ArrowUp': case 'KeyW': scrollBy(0, -80); break;
        case 'ArrowDown': case 'KeyS': scrollBy(0, 80); break;
        case 'PageUp': scrollBy(0, -page); break;
        case 'PageDown': scrollBy(0, page); break;
        case 'Home': centerOn(0); break;
        case 'End': centerOn(trackHeight()); break;
        default: return;
      }
      event.preventDefault();
    };
    const scrollBy = (dx: number, dy: number) => {
      setCamera({ x: camera().x + dx / camera().scale, y: camera().y + dy / camera().scale, scale: camera().scale });
    };
    const rigZoomAbout = (factor: number) => setCamera(zoomAbout(camera(), camera().scale * factor, width / 2, height / 2, width, height));
    const centerOn = (worldY: number) => setCamera({ ...camera(), y: worldY });
    const rigFitHere = () => {
      rig.trackHeight = trackHeight();
      rig.startY = gameRef.current?.track.startY ?? 0;
      rigFit(rig);
    };

    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('pointerleave', pointerLeave);
    window.addEventListener('keydown', onKey);

    // ---- the loop ----------------------------------------------------------
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const stage = gameRef.current;
      if (width < 1 || height < 1) return;
      if (!stage) {
        ctx.clearRect(0, 0, width, height);
        return;
      }
      if (!fitted) {
        // First real frame: open on the start grid, at the scale a race screen would show.
        fitted = true;
        rig.trackHeight = stage.track.height;
        rig.startY = stage.track.startY;
        rigOpen(rig);
      }
      rig.camera = clampCamera(rig.camera, width, height, stage.track.height);
      const overlay: OverlayView = {
        camera: rig.camera,
        width,
        height,
        finishY: stage.track.finishY,
        trackHeight: stage.track.height,
        cursor,
      };
      render(ctx, stage, rig.camera, width, height, now, { minimap: false, shake: false });
      if (gridRef.current) drawGrid(ctx, overlay);
      if (rulerRef.current) drawRuler(ctx, overlay);
      drawCursorMark(ctx, overlay);

      if (now - lastStatus > STATUS_MS) {
        lastStatus = now;
        const win = viewWindow(overlay);
        statusRef.current({ top: win.top, bottom: win.bottom, scale: rig.camera.scale, cursor });
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('pointerleave', pointerLeave);
      window.removeEventListener('keydown', onKey);
    };
  }, [rig]);

  return (
    <div className="editor-canvas-wrap">
      <canvas ref={canvasRef} className="editor-canvas" aria-label="Circuit canvas — pan with drag or scroll, zoom with pinch or ctrl/⌘ + scroll" />
      {!game && <p className="editor-loading">Building the circuit…</p>}
      <div className="editor-help" aria-hidden="true">
        <span>DRAG / SCROLL · PAN</span>
        <span>PINCH / ⌘·CTRL + SCROLL · ZOOM</span>
        <span>+ − 0 · ZOOM · HOME / END · ENDS</span>
      </div>
    </div>
  );
}
