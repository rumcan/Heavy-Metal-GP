/**
 * MB-02 + MB-03. The Workshop's canvas.
 *
 * MB-02 drew the race's own `render()` and the grid/ruler.  MB-03 adds direct
 * manipulation on top of it: hit-testing via body bounds → piece index,
 * handles per type, multi-select / box, drag-to-move, handle drag, placement
 * preview and selection highlights.  Physics is still never stepped here.
 *
 * Interaction uses DOM-mutating refs (the render loop reads the camera, the
 * pointer handlers write it) so a drag stays smooth.  Only the throttled
 * status and the React `selected`/`armed` props go through the store.
 */
import { useEffect, useMemo, useRef } from 'react';
import { render } from '../../game/render';
import type { Game } from '../../game/engine';
import type { Track } from '../../game/track';
import { clampCamera, clampZoom, rigFit, rigOpen, snapPoint, worldAt, zoomAbout } from './camera';
import type { CameraRig, EditorCamera, Point } from './camera';
import { drawCursorMark, drawGrid, drawRuler, viewWindow } from './overlay';
import type { OverlayView } from './overlay';
import { hitPieceAt, piecesInBox } from './build';
import { handlesFor } from './handles';
import { Builder } from '../../game/track';
import { replayPiece } from '../../game/trackdef';
import { getTemplates, placeTemplate } from './templates';
// MB-09 handle knobs — Blizzard style, easily replaceable PNGs

/**
 * Handle icons, drawn in screen space: a red disc with a four-way arrow to move, a parchment disc with a
 * curved arrow to rotate, and a small ringed dot for every other handle (ends, size, radius, direction...).
 */
function drawHandleIcon(ctx: CanvasRenderingContext2D, x: number, y: number, id: string) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  if (id === 'move' || id === 'rot') {
    const r = 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = id === 'move' ? '#d63e2e' : '#ede3c7';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = id === 'move' ? '#fff3dc' : '#1b1510';
    ctx.stroke();
    const ink = id === 'move' ? '#fff3dc' : '#1b1510';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    if (id === 'move') {
      // four-way arrow
      const a = 7.5, head = 3;
      ctx.beginPath();
      ctx.moveTo(x - a, y); ctx.lineTo(x + a, y);
      ctx.moveTo(x, y - a); ctx.lineTo(x, y + a);
      ctx.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const tx = x + dx * a, ty = y + dy * a;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx - dx * head - dy * head, ty - dy * head - dx * head);
        ctx.lineTo(tx - dx * head + dy * head, ty - dy * head + dx * head);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // curved arrow, most of a circle with a head at the end
      const rr = 6;
      const start = -Math.PI * 0.35, end = Math.PI * 1.25;
      ctx.beginPath();
      ctx.arc(x, y, rr, start, end);
      ctx.stroke();
      const ex = x + Math.cos(end) * rr, ey = y + Math.sin(end) * rr;
      const tx = -Math.sin(end), ty = Math.cos(end); // tangent (direction of travel)
      ctx.beginPath();
      ctx.moveTo(ex + tx * 3.5, ey + ty * 3.5);
      ctx.lineTo(ex - ty * 3.2, ey + tx * 3.2);
      ctx.lineTo(ex + ty * 3.2, ey - tx * 3.2);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ede3c7';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#d63e2e';
    ctx.stroke();
  }
  ctx.restore();
}

export interface EditorStatus {
  top: number;
  bottom: number;
  scale: number;
  cursor: Point | null;
}

interface Props {
  game: Game | null;
  rig: CameraRig;
  grid: boolean;
  ruler: boolean;
  onStatus: (status: EditorStatus) => void;
  armed: string | null;
  track: Track | null;
  bodyToPiece: number[];
  pieceBounds: { min: Point; max: Point }[];
  selected: number[];
  onPlace: (world: Point) => void;
  onSelect: (indices: number[], additive: boolean) => void;
  onClear: () => void;
  onMoveSelected: (dx: number, dy: number) => void;
  onHandleChange: (pieceIndex: number, handleId: string, to: Point) => void;
  startTransaction: () => void;
  transact: (mutate: (def: import('../../game/trackdef').TrackDef) => import('../../game/trackdef').TrackDef) => void;
  endTransaction: () => void;
  spawnAt?: Point | null;
  pickingSpawn?: boolean;
  onPickSpawn?: (world: Point) => void;
  validation?: import('./validate').ValidationResult | null;
}

const STATUS_MS = 90;
const DRAG_SLOP = 3;
const HANDLE_SCREEN = 10;

export default function EditorCanvas(props: Props) {
  const { game, rig, grid, ruler, onStatus, armed, track, bodyToPiece, pieceBounds, selected, onPlace, onSelect, onClear, onMoveSelected, onHandleChange, startTransaction, endTransaction, spawnAt, pickingSpawn, onPickSpawn, validation } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const gameRef = useRef(game);
  const gridRef = useRef(grid);
  const rulerRef = useRef(ruler);
  const statusRef = useRef(onStatus);
  const armedRef = useRef(armed);
  const armedTemplate = useMemo(() => getTemplates().find(t => t.id === armed), [armed]);
  const templateRef = useRef(armedTemplate);
  templateRef.current = armedTemplate;
  const trackRef = useRef(track);
  const b2pRef = useRef(bodyToPiece);
  const pbRef = useRef(pieceBounds);
  const selectedRef = useRef(selected);
  const onPlaceRef = useRef(onPlace);
  const onSelectRef = useRef(onSelect);
  const onClearRef = useRef(onClear);
  const onMoveRef = useRef(onMoveSelected);
  const onHandleRef = useRef(onHandleChange);
  const startTxRef = useRef(startTransaction);
  const endTxRef = useRef(endTransaction);
  const spawnAtRef = useRef(spawnAt);
  const pickingSpawnRef = useRef(pickingSpawn);
  const onPickSpawnRef = useRef(onPickSpawn);
  const validationRef = useRef(validation);
  gameRef.current = game;
  gridRef.current = grid;
  rulerRef.current = ruler;
  statusRef.current = onStatus;
  armedRef.current = armed;
  trackRef.current = track;
  b2pRef.current = bodyToPiece;
  pbRef.current = pieceBounds;
  selectedRef.current = selected;
  onPlaceRef.current = onPlace;
  onSelectRef.current = onSelect;
  onClearRef.current = onClear;
  onMoveRef.current = onMoveSelected;
  onHandleRef.current = onHandleChange;
  startTxRef.current = startTransaction;
  endTxRef.current = endTransaction;
  spawnAtRef.current = spawnAt;
  pickingSpawnRef.current = pickingSpawn;
  onPickSpawnRef.current = onPickSpawn;
  validationRef.current = validation;

  // Def access for transact moves: we need to keep the transaction helpers stable.
  // They are passed from TrackEditor and already capture def via closure.

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let width = 0;
    let height = 0;
    let raf = 0;
    let lastStatus = 0;
    let fitted = false;
    let cursor: Point | null = null;
    // For handle hit testing we need raw world (unsnapped) separate from snapped.
    let cursorRaw: Point | null = null;

    const localPoint = (clientX: number, clientY: number): Point => {
      const rect = canvas.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const trackHeight = () => gameRef.current?.track.height ?? 1e6;
    const camera = () => rig.camera;
    const setCamera = (next: EditorCamera) => {
      rig.camera = clampCamera(next, width, height, trackHeight());
    };
    const toWorldRaw = (p: Point): Point => worldAt(camera(), p.x, p.y, width, height);
    const toWorld = (p: Point): Point => {
      const w = toWorldRaw(p);
      return gridRef.current ? snapPoint(w) : w;
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

    // --- interaction state ----------------------------------------------------
    const pointers = new Map<number, Point>();
    let pan: { from: Point; camX: number; camY: number } | null = null;
    let pinch: { spread: number; world: Point; scale: number } | null = null;

    // drag modes
    type HandleDrag = { pieceIndex: number; handleId: string };
    type PieceDrag = { startWorld: Point; lastWorld: Point };
    type BoxDrag = { startWorld: Point; curWorld: Point };
    let handleDrag: HandleDrag | null = null;
    let pieceDrag: PieceDrag | null = null;
    let boxDrag: BoxDrag | null = null;
    let pendingPlace: Point | null = null;
    let downPoint: Point | null = null;

    const spreadOf = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    const middleOf = (): Point => {
      const [a, b] = [...pointers.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    // We keep def pieces in a ref that TrackEditor updates via a side effect.
    // To avoid adding a new prop, we read from a global attached to rig.
    // Rig will carry last def pieces as (rig as unknown).defPieces.
    const getDefPieces = (): import('../../game/trackdef').Piece[] | null => {
      return (rig as unknown as { defPieces?: import('../../game/trackdef').Piece[] }).defPieces ?? null;
    };

    const hitHandleReal = (world: Point): HandleDrag | null => {
      const pieces = getDefPieces();
      if (!pieces) return null;
      const sel = selectedRef.current;
      if (sel.length !== 1) return null;
      const idx = sel[0];
      const piece = pieces[idx];
      if (!piece) return null;
      const handles = handlesFor(piece);
      const camScale = camera().scale;
      const radiusWorld = HANDLE_SCREEN / camScale;
      let best: HandleDrag | null = null;
      let bestDist = Infinity;
      for (const h of handles) {
        const d = Math.hypot(h.x - world.x, h.y - world.y);
        if (d <= radiusWorld * 1.6 && d < bestDist) {
          bestDist = d;
          best = { pieceIndex: idx, handleId: h.id };
        }
      }
      return best;
    };

    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const local = localPoint(event.clientX, event.clientY);
      const worldRaw = toWorldRaw(local);
      const world = toWorld(local);
      cursorRaw = worldRaw;
      cursor = world;
      // MB-04: picking spawn point has priority over all editor interactions
      if (pickingSpawnRef.current) {
        onPickSpawnRef.current?.(world);
        return;
      }
      // Two-pointer pinch
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        // Single pointer down — decide mode
        downPoint = { x: event.clientX, y: event.clientY };
        pendingPlace = null;
        // If armed, placement preview takes precedence — but we still allow
        // handle/piece interaction? Spec says click palette tile then click canvas
        // to place. We'll treat armed + no shift as placement on click, not drag.
        // However if user clicks on a handle while armed, they probably want to place,
        // not handle. So we only check handles when not armed.
        if (!armedRef.current) {
          const h = hitHandleReal(worldRaw);
          if (h) {
            handleDrag = h;
            startTxRef.current();
            // Prevent pan
            pan = null;
            return;
          }
        }

        const curTrack = trackRef.current;
        const b2p = b2pRef.current;
        let hit: number | null = null;
        // While placing, a click always drops a piece, even on top of another one: select mode (E) edits pieces.
        if (curTrack && b2p.length && !armedRef.current) {
          hit = hitPieceAt(worldRaw, curTrack, b2p, pbRef.current);
        }

        if (hit !== null) {
          const sel = selectedRef.current;
          const isSelected = sel.includes(hit);
          const additive = event.shiftKey;
          if (!isSelected) {
            if (additive) onSelectRef.current([hit], true);
            else onSelectRef.current([hit], false);
            // After selecting, the drag should move the (new) selection which now includes hit.
            // For simplicity, we update selectedRef synchronously? React state will lag,
            // so we treat the drag as moving [hit] plus previous selection if additive.
            // To keep it simple, we will start piece drag with the hit + previous set.
            const nextSel = additive ? [...new Set([...sel, hit])] : [hit];
            // Store for drag: we will move nextSel.
            // Since selectedRef is stale until next render, we keep a local for this drag.
            // We'll set pieceDrag to move those.
            handlePieceDragStart(nextSel, world);
            return;
          } else {
            // Already selected — start moving the whole selection
            handlePieceDragStart(sel, world);
            return;
          }
        }

        // Miss
        if (event.button === 1 || event.button === 2) {
          pan = { from: { x: event.clientX, y: event.clientY }, camX: camera().x, camY: camera().y };
          return;
        }

        if (armedRef.current) {
          pendingPlace = world;
          return;
        }

        // Left click empty space: Box select
        boxDrag = { startWorld: worldRaw, curWorld: worldRaw };
      } else if (pointers.size === 2) {
        // Pinch start
        // Cancel other drags
        handleDrag = null;
        pieceDrag = null;
        boxDrag = null;
        pendingPlace = null;
        pan = null;
        const middle = localPoint(middleOf().x, middleOf().y);
        pinch = { spread: spreadOf(), world: worldAt(camera(), middle.x, middle.y, width, height), scale: camera().scale };
      }
    };

    const handlePieceDragStart = (indices: number[], world: Point) => {
      pieceDrag = { startWorld: world, lastWorld: world };
      startTxRef.current();
      // Prevent pan
      pan = null;
      // Store indices for drag in a closure variable to avoid stale selectedRef
      (pieceDrag as unknown as { indices: number[] }).indices = indices;
    };

    const pointerMove = (event: PointerEvent) => {
      const local = localPoint(event.clientX, event.clientY);
      const worldRaw = toWorldRaw(local);
      const world = toWorld(local);
      cursorRaw = worldRaw;
      cursor = world;

      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pinch && pointers.size >= 2) {
        const middle = localPoint(middleOf().x, middleOf().y);
        const scale = clampZoom(pinch.scale * (spreadOf() / pinch.spread));
        const newCam = { x: pinch.world.x - (middle.x - width / 2) / scale, y: pinch.world.y - (middle.y - height / 2) / scale, scale };
        rig.camera = clampCamera(newCam, width, height, trackHeight());
        return;
      }

      if (handleDrag) {
        // Drag handle to new world (snapped)
        onHandleRef.current(handleDrag.pieceIndex, handleDrag.handleId, world);
        return;
      }

      if (pieceDrag) {
        const last = pieceDrag.lastWorld;
        const dx = world.x - last.x;
        const dy = world.y - last.y;
        if (dx !== 0 || dy !== 0) {
          onMoveRef.current(dx, dy);
          pieceDrag.lastWorld = world;
        }
        return;
      }

      if (boxDrag) {
        boxDrag.curWorld = worldRaw;
        // Update selection live? We can select on move for preview, but actual selection on up.
        // For ghost preview, we will draw the rect; selection happens on up.
        return;
      }

      if (pan) {
        const dx = event.clientX - pan.from.x;
        const dy = event.clientY - pan.from.y;
        if (Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) canvas.classList.add('is-panning');
        // If armed and we started pan on empty miss, we should allow pan to override pendingPlace
        if (pendingPlace && Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) pendingPlace = null;
        setCamera({ x: pan.camX - dx / camera().scale, y: pan.camY - dy / camera().scale, scale: camera().scale });
        return;
      }

      // If pendingPlace and still within slop, no camera move
      if (pendingPlace) {
        // Check if we moved beyond slop — then turn into pan
        if (downPoint && Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y) > DRAG_SLOP) {
          // Convert pendingPlace to pan
          pendingPlace = null;
          pan = { from: downPoint, camX: camera().x, camY: camera().y };
          const dx = event.clientX - pan.from.x;
          const dy = event.clientY - pan.from.y;
          setCamera({ x: pan.camX - dx / camera().scale, y: pan.camY - dy / camera().scale, scale: camera().scale });
        }
      }
    };

    const pointerUp = (event: PointerEvent) => {
      const local = localPoint(event.clientX, event.clientY);
      const worldRaw = toWorldRaw(local);
      const world = toWorld(local);
      const wasHandle = handleDrag;
      const wasPiece = pieceDrag;
      const wasBox = boxDrag;
      const wasPan = pan;
      const wasPendingPlace = pendingPlace;
      const down = downPoint;
      const isClick = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) <= DRAG_SLOP;

      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;

      if (wasHandle) {
        handleDrag = null;
        endTxRef.current();
      }
      if (wasPiece) {
        pieceDrag = null;
        endTxRef.current();
      }
      if (wasBox) {
        // Box select commit
        const curTrack = trackRef.current;
        const b2p = b2pRef.current;
        if (curTrack && b2p.length) {
          const minX = Math.min(wasBox.startWorld.x, wasBox.curWorld.x);
          const maxX = Math.max(wasBox.startWorld.x, wasBox.curWorld.x);
          const minY = Math.min(wasBox.startWorld.y, wasBox.curWorld.y);
          const maxY = Math.max(wasBox.startWorld.y, wasBox.curWorld.y);
          // Small box = click without drag? If box small, treat as clear or no-op.
          if (Math.abs(maxX - minX) > 8 || Math.abs(maxY - minY) > 8) {
            if (curTrack && b2p.length && pbRef.current.length) {
              const hitSet = piecesInBox({ minX, minY, maxX, maxY }, curTrack, b2p, pbRef.current);
              const indices = [...hitSet].sort((a, b) => a - b);
              if (indices.length) {
                const additive = event.shiftKey;
                onSelectRef.current(indices, additive);
              } else if (!event.shiftKey) {
                onClearRef.current();
              }
            }
          } else if (!event.shiftKey) {
            // Tiny box = simple click on empty space — clear selection
            onClearRef.current();
          }
        }
        boxDrag = null;
      }
      if (wasPan) {
        pan = null;
        canvas.classList.remove('is-panning');
      }
      if (wasPendingPlace && isClick) {
        onPlaceRef.current(world);
      } else if (!wasHandle && !wasPiece && !wasBox && !wasPan && isClick) {
        // Empty click (no handle/piece/box/pan/place)
        // If hit nothing and not armed, clear selection
        const curTrack = trackRef.current;
        const b2p = b2pRef.current;
        const pb = pbRef.current;
        let hit: number | null = null;
        if (curTrack && b2p.length && pb.length) {
          hit = hitPieceAt(worldRaw, curTrack, b2p, pb);
        }
        if (hit === null && !event.shiftKey) {
          // Miss on empty space clears selection (unless shift)
          onClearRef.current();
        }
      }

      if (pointers.size === 0) {
        pendingPlace = null;
        downPoint = null;
      }

      cursorRaw = worldRaw;
      cursor = world;
    };

    const pointerLeave = () => {
      if (!pointers.size) {
        cursor = null;
        cursorRaw = null;
      }
    };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event.clientX, event.clientY);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      if (event.ctrlKey || event.metaKey) {
        setCamera(zoomAbout(camera(), camera().scale * Math.exp(-event.deltaY * unit * 0.0022), point.x, point.y, width, height));
        return;
      }
      setCamera({ x: camera().x + (event.deltaX * unit) / camera().scale, y: camera().y + (event.deltaY * unit) / camera().scale, scale: camera().scale });
    };

    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const page = Math.max(80, height / camera().scale) * 0.9;
      const scrollBy = (dx: number, dy: number) => setCamera({ x: camera().x + dx / camera().scale, y: camera().y + dy / camera().scale, scale: camera().scale });
      const rigZoomAbout = (factor: number) => setCamera(zoomAbout(camera(), camera().scale * factor, width / 2, height / 2, width, height));
      const centerOn = (worldY: number) => setCamera({ ...camera(), y: worldY });
      const rigFitHere = () => {
        rig.trackHeight = trackHeight();
        rig.startY = gameRef.current?.track.startY ?? 0;
        rigFit(rig);
      };
      switch (event.code) {
        case 'Equal':
        case 'NumpadAdd':
          rigZoomAbout(1.25);
          break;
        case 'Minus':
        case 'NumpadSubtract':
          rigZoomAbout(1 / 1.25);
          break;
        case 'Digit0':
        case 'Numpad0':
          rigFitHere();
          break;
        case 'ArrowUp':
        case 'KeyW':
          // Let TrackEditor handle nudge when pieces selected, otherwise pan
          if (selectedRef.current.length === 0) scrollBy(0, -80);
          else return;
          break;
        case 'ArrowDown':
        case 'KeyS':
          if (selectedRef.current.length === 0) scrollBy(0, 80);
          else return;
          break;
        case 'PageUp':
          scrollBy(0, -page);
          break;
        case 'PageDown':
          scrollBy(0, page);
          break;
        case 'Home':
          centerOn(0);
          break;
        case 'End':
          centerOn(trackHeight());
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    const preventContext = (e: Event) => e.preventDefault();

    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('pointerleave', pointerLeave);
    canvas.addEventListener('contextmenu', preventContext);
    window.addEventListener('keydown', onKey);

    // ---- render loop --------------------------------------------------------
    const drawSelection = (ctx: CanvasRenderingContext2D, overlay: OverlayView) => {
      const curTrack = trackRef.current;
      const sel = selectedRef.current;
      const pieces = getDefPieces();
      if (!curTrack || !pieces || sel.length === 0) return;
      const cam = overlay.camera;
      const toScreen = (w: Point): Point => ({ x: (w.x - cam.x) * cam.scale + overlay.width / 2, y: (w.y - cam.y) * cam.scale + overlay.height / 2 });
      // Compute bounds and highlights per selected piece
      const b2p = b2pRef.current;
      const pb = pbRef.current;
      for (const idx of sel) {
        // Draw green transparent highlight over physics bodies
        ctx.save();
        ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
        for (let bi = 0; bi < curTrack.bodies.length; bi++) {
          if (b2p[bi] !== idx) continue;
          const b = curTrack.bodies[bi];
          if (!b.bounds) continue;
          const sMin = toScreen(b.bounds.min);
          const sMax = toScreen(b.bounds.max);
          ctx.fillRect(sMin.x, sMin.y, sMax.x - sMin.x, sMax.y - sMin.y);
        }
        ctx.restore();

        // Draw red dashed selection box using pieceBounds
        const bounds = pb[idx];
        if (!bounds) continue;
        
        const sMin = toScreen(bounds.min);
        const sMax = toScreen(bounds.max);
        const rw = sMax.x - sMin.x;
        const rh = sMax.y - sMin.y;
        
        ctx.save();
        ctx.strokeStyle = '#d63e2e';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(sMin.x, sMin.y, rw, rh);
        ctx.setLineDash([]);
        // Fill with translucent red
        ctx.fillStyle = 'rgba(214,62,46,0.08)';
        ctx.fillRect(sMin.x, sMin.y, rw, rh);
        ctx.restore();
      }

      // Handles only for single selection
      if (sel.length === 1) {
        const idx = sel[0];
        const piece = pieces[idx];
        if (!piece) return;
        const handles = handlesFor(piece);
        // Rotate handle: a stalk from the centre with a curved arrow, drawn under the knobs.
        const rot = handles.find((h) => h.id === 'rot');
        const centre = handles[0];
        if (rot && centre) {
          const sc = toScreen(centre);
          const sr = toScreen(rot);
          ctx.save();
          ctx.strokeStyle = 'rgba(255,209,138,0.85)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(sc.x, sc.y);
          ctx.lineTo(sr.x, sr.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
        for (const h of handles) {
          const s = toScreen(h);
          drawHandleIcon(ctx, s.x, s.y, h.id);
        }
        // Direction arrows for pad/boost/hoop etc: draw line from move handle to dir handle
        const move = handles.find((h) => h.id === 'move');
        const dir = handles.find((h) => h.id === 'dir');
        if (move && dir) {
          const sMove = toScreen(move);
          const sDir = toScreen(dir);
          ctx.save();
          ctx.strokeStyle = 'rgba(214,62,46,0.9)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sMove.x, sMove.y);
          ctx.lineTo(sDir.x, sDir.y);
          ctx.stroke();
          // Arrow head
          const ang = Math.atan2(sDir.y - sMove.y, sDir.x - sMove.x);
          ctx.fillStyle = '#d63e2e';
          ctx.beginPath();
          ctx.moveTo(sDir.x, sDir.y);
          ctx.lineTo(sDir.x - Math.cos(ang - 0.5) * 10, sDir.y - Math.sin(ang - 0.5) * 10);
          ctx.lineTo(sDir.x - Math.cos(ang + 0.5) * 10, sDir.y - Math.sin(ang + 0.5) * 10);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    };

    const drawBox = (ctx: CanvasRenderingContext2D, overlay: OverlayView) => {
      if (!boxDrag) return;
      const cam = overlay.camera;
      const toScreen = (w: Point): Point => ({ x: (w.x - cam.x) * cam.scale + overlay.width / 2, y: (w.y - cam.y) * cam.scale + overlay.height / 2 });
      const s0 = toScreen(boxDrag.startWorld);
      const s1 = toScreen(boxDrag.curWorld);
      const rx = Math.min(s0.x, s1.x);
      const ry = Math.min(s0.y, s1.y);
      const rw = Math.abs(s1.x - s0.x);
      const rh = Math.abs(s1.y - s0.y);
      ctx.save();
      ctx.fillStyle = 'rgba(59,130,246,0.12)';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    };

    let templateGhost: { key: string; bodies: Track['bodies'] | null } | null = null;
    const drawGhost = (ctx: CanvasRenderingContext2D, overlay: OverlayView) => {
      const armedT = armedRef.current;
      const cur = cursor;
      const curRaw = cursorRaw;
      if (!armedT || !cur) return;
      // Only show ghost when not dragging handles/pieces
      if (handleDrag || pieceDrag || boxDrag) return;
      // Ghost position is cursor (snapped). Draw simple preview.
      const cam = overlay.camera;
      const toScreen = (w: Point): Point => ({ x: (w.x - cam.x) * cam.scale + overlay.width / 2, y: (w.y - cam.y) * cam.scale + overlay.height / 2 });
      // Use world snapped pos
      const worldPos = cur;
      // For each type draw appropriate ghost
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#d63e2e';
      ctx.fillStyle = 'rgba(214,62,46,0.18)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const s = toScreen(worldPos);
      const sc = overlay.camera.scale;
      if (armedT.startsWith('template-')) {
        const template = templateRef.current;
        const key = `${armedT}:${cur.x}:${cur.y}:${gridRef.current}`;
        if (templateGhost?.key !== key) {
          const pieces = template ? placeTemplate(template, cur, gridRef.current) : null;
          const builder = new Builder(0);
          if (pieces) for (const piece of pieces) replayPiece(builder, piece);
          templateGhost = { key, bodies: pieces ? builder.bodies : null };
        }
        if (templateGhost.bodies) {
          for (const body of templateGhost.bodies) {
            ctx.beginPath();
            body.vertices.forEach((vertex, index) => {
              const p = toScreen(vertex);
              if (index === 0) ctx.moveTo(p.x, p.y);
              else ctx.lineTo(p.x, p.y);
            });
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        } else {
          // Explicit invalid-placement marker for groups wider than the track.
          ctx.beginPath();
          ctx.moveTo(s.x - 10, s.y - 10); ctx.lineTo(s.x + 10, s.y + 10);
          ctx.moveTo(s.x + 10, s.y - 10); ctx.lineTo(s.x - 10, s.y + 10);
          ctx.stroke();
        }
        ctx.restore();
        return;
      }
      switch (armedT) {
        case 'ramp':
        case 'ice': {
          const len = 300 * sc;
          const ang = (12 * Math.PI) / 180;
          const dx = Math.cos(ang) * len / 2;
          const dy = Math.sin(ang) * len / 2;
          ctx.beginPath();
          ctx.moveTo(s.x - dx, s.y - dy);
          ctx.lineTo(s.x + dx, s.y + dy);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(s.x - dx, s.y - dy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(s.x + dx, s.y + dy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case 'loop': {
          const r = 95 * sc;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fill();
          break;
        }
        case 'peg': {
          const r = 11 * sc;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case 'ppeg': {
          const r = 10 * sc;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
        }
        case 'wall':
        case 'block': {
          const w = (armedT === 'wall' ? 120 : 60) * sc;
          const h = (armedT === 'wall' ? 24 : 32) * sc;
          ctx.fillRect(s.x - w / 2, s.y - h / 2, w, h);
          ctx.strokeRect(s.x - w / 2, s.y - h / 2, w, h);
          break;
        }
        case 'breakable': {
          const w = 30 * sc;
          const h = 92 * sc;
          ctx.fillRect(s.x - w / 2, s.y - h / 2, w, h);
          ctx.strokeRect(s.x - w / 2, s.y - h / 2, w, h);
          break;
        }
        case 'hoop':
        case 'itembox':
        case 'pad':
        case 'boost':
        case 'spinner':
        case 'wrecker':
        case 'bucket':
        case 'curve':
        case 'trampoline':
        case 'turnstile':
        case 'targets':
        case 'vortex':
        case 'platform':
        case 'wheel':
        case 'screw':
        case 'conveyor':
        case 'seesaw':
        case 'bridge':
        case 'cannon':
        case 'catapult':
        case 'flipper':
        case 'sling':
        case 'scoop':
        case 'wind':
        case 'magnet':
        case 'mud':
        case 'pool':
        case 'geyser':
        case 'blade':
        case 'saw':
        case 'crusher':
        case 'boulder':
        case 'mace':
        case 'barricade':
        case 'crumble':
        case 'tunnel':
        case 'switch': {
          // Generic dot + label
          ctx.beginPath();
          ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = `10px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(armedT, s.x, s.y - 14);
          break;
        }
        case 'trapdoor': {
          const w = 110 * sc;
          const h2 = -1; // Default hinge
          const h = { x: s.x + h2 * w / 2, y: s.y };
          const otherX = s.x - h2 * w / 2;
          
          ctx.beginPath();
          ctx.arc(h.x, h.y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          
          ctx.beginPath();
          ctx.moveTo(h.x, h.y);
          ctx.lineTo(otherX, h.y);
          ctx.lineWidth = 4 * sc;
          ctx.strokeStyle = '#4f5a6a';
          ctx.stroke();
          ctx.lineWidth = 1;
          
          ctx.fillStyle = '#fff';
          ctx.font = `10px system-ui`;
          ctx.textAlign = 'center';
          ctx.fillText(armedT, h.x, h.y - 14);
          break;
        }
        default:
          ctx.beginPath();
          ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
      }
      ctx.restore();
      void curRaw;
    };

    const drawSpawn = (ctx: CanvasRenderingContext2D, overlay: OverlayView) => {
      const spawn = spawnAtRef.current;
      const picking = pickingSpawnRef.current;
      if (!spawn && !picking) return;
      const cam = overlay.camera;
      const toScreen = (w: Point): Point => ({ x: (w.x - cam.x) * cam.scale + overlay.width / 2, y: (w.y - cam.y) * cam.scale + overlay.height / 2 });
      if (spawn) {
        const s = toScreen(spawn);
        ctx.save();
        ctx.strokeStyle = '#16c8ff';
        ctx.fillStyle = 'rgba(22,200,255,0.18)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 10, s.y);
        ctx.lineTo(s.x + 10, s.y);
        ctx.moveTo(s.x, s.y - 10);
        ctx.lineTo(s.x, s.y + 10);
        ctx.stroke();
        ctx.fillStyle = '#16c8ff';
        ctx.font = '9px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('START', s.x, s.y - 18);
        ctx.restore();
      }
      if (picking && cursor) {
        const s = toScreen(cursor);
        ctx.save();
        ctx.strokeStyle = 'rgba(22,200,255,0.65)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(22,200,255,0.9)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    const drawValidation = (ctx: CanvasRenderingContext2D, overlay: OverlayView) => {
      const res = validationRef.current;
      if (!res || !res.issues.length) return;
      const cam = overlay.camera;
      const toScreen = (w: Point): Point => ({ x: (w.x - cam.x) * cam.scale + overlay.width / 2, y: (w.y - cam.y) * cam.scale + overlay.height / 2 });
      for (const iss of res.issues) {
        if (!iss.pos) continue;
        const s = toScreen(iss.pos);
        // cull off-screen by a margin
        if (s.x < -40 || s.x > overlay.width + 40 || s.y < -40 || s.y > overlay.height + 40) continue;
        const isError = iss.severity === 'error';
        ctx.save();
        ctx.strokeStyle = isError ? '#ef4444' : '#f59e0b';
        ctx.fillStyle = isError ? 'rgba(239,68,68,0.22)' : 'rgba(245,158,11,0.18)';
        ctx.lineWidth = isError ? 2 : 1.6;
        ctx.beginPath();
        ctx.arc(s.x, s.y, isError ? 12 : 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // inner dot
        ctx.fillStyle = isError ? '#ef4444' : '#f59e0b';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();
        // exclamation
        ctx.fillStyle = '#fff';
        ctx.font = isError ? '10px system-ui' : '9px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', s.x, s.y - 20);
        ctx.restore();
      }
      // also highlight headless stuck spots separately as trap markers
      if (res.headless.stuckSpots.length) {
        for (const spot of res.headless.stuckSpots) {
          const s = toScreen(spot);
          if (s.x < -40 || s.x > overlay.width + 40 || s.y < -40 || s.y > overlay.height + 40) continue;
          ctx.save();
          ctx.strokeStyle = 'rgba(214,62,46,0.9)';
          ctx.fillStyle = 'rgba(214,62,46,0.18)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 16, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const stage = gameRef.current;
      if (width < 1 || height < 1) return;
      if (!stage) {
        ctx.clearRect(0, 0, width, height);
        return;
      }
      if (!fitted) {
        fitted = true;
        rig.trackHeight = stage.track.height;
        rig.startY = stage.track.startY;
        rigOpen(rig);
      }
      rig.camera = clampCamera(rig.camera, width, height, stage.track.height);
      const overlayView: OverlayView = {
        camera: rig.camera,
        width,
        height,
        finishY: stage.track.finishY,
        trackHeight: stage.track.height,
        cursor,
      };
      // Preserve def pieces on rig for handle hit testing
      // (TrackEditor writes rig.defPieces each render)
      render(ctx, stage, rig.camera, width, height, now, { minimap: false, shake: false });
      if (gridRef.current) drawGrid(ctx, overlayView);
      if (rulerRef.current) drawRuler(ctx, overlayView);
      drawCursorMark(ctx, overlayView);
      drawSelection(ctx, overlayView);
      drawBox(ctx, overlayView);
      drawGhost(ctx, overlayView);
      drawSpawn(ctx, overlayView);
      drawValidation(ctx, overlayView);

      if (now - lastStatus > STATUS_MS) {
        lastStatus = now;
        const win = viewWindow(overlayView);
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
      canvas.removeEventListener('contextmenu', preventContext);
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
        <span>SHIFT+DRAG · BOX SELECT</span>
      </div>
    </div>
  );
}
