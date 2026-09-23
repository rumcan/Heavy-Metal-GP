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
import { handlesFor, baseBoxHandles, lockHandlePoint, orderHandlePoints } from './handles';
import { ghostPreview } from './ghost';
import type { GhostPreview } from './ghost';
import { getTemplates } from './templates';
// MB-09 handle knobs — Blizzard style, easily replaceable PNGs

/**
 * Handle icons, drawn in screen space: a red disc with a four-way arrow to move, a parchment disc with a
 * curved arrow to rotate, and a small ringed dot for every other handle (ends, size, radius, direction...).
 */
function drawHandleIcon(ctx: CanvasRenderingContext2D, x: number, y: number, id: string, hover: boolean = false) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;

  if (id === 'settings') {
    ctx.shadowColor = hover ? 'rgba(96,165,250,0.8)' : 'transparent';
    ctx.shadowBlur = hover ? 8 : 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = hover ? '#ffffff' : '#94a3b8';
    ctx.stroke();
    // gear inside
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 4.5, y + Math.sin(a) * 4.5);
      ctx.lineTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
      ctx.stroke();
    }
  } else if (id === 'front' || id === 'back') {
    // Layer order: two stacked squares, the one on top filled for "front", the one underneath for "back".
    const ink = hover ? '#ffffff' : '#94a3b8';
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    const under = { x: x - 6, y: y - 6 }, over = { x: x - 2, y: y - 2 };
    if (id === 'front') {
      ctx.strokeRect(under.x, under.y, 8, 8);
      ctx.fillRect(over.x, over.y, 8, 8);
    } else {
      ctx.fillRect(under.x, under.y, 8, 8);
      ctx.fillStyle = 'rgba(15,23,42,1)';
      ctx.fillRect(over.x, over.y, 8, 8);
      ctx.strokeRect(over.x, over.y, 8, 8);
    }
  } else if (id === 'lock') {
    // #99 padlock: shackle arc over a body, steel-blue like the settings cog.
    ctx.shadowColor = hover ? 'rgba(96,165,250,0.8)' : 'transparent';
    ctx.shadowBlur = hover ? 8 : 0;
    const ink = hover ? '#ffffff' : '#94a3b8';
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y - 2.5, 4.2, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(x - 6, y - 2.5, 12, 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(15,23,42,0.9)';
    ctx.beginPath();
    ctx.arc(x, y + 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 'move' || id === 'rot' || id === 'box-rot') {
    const r = 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = id === 'move' ? (hover ? '#fb923c' : '#d63e2e') : (hover ? '#ffffff' : '#ede3c7');
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
    const r = 8;
    ctx.beginPath();
    ctx.arc(x, y, hover ? r + 1 : r, 0, Math.PI * 2);
    ctx.fillStyle = hover ? '#60a5fa' : '#1e3a8a';
    ctx.fill();
    ctx.lineWidth = hover ? 2.5 : 2;
    ctx.strokeStyle = hover ? '#ffffff' : '#93c5fd';
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
  onHandleChange: (pieceIndex: number, handleId: string, to: Point, initialPiece?: any, resizeAnchor?: { min: Point; max: Point }) => void;
  onOpenSettings: (pieceIndex: number) => void;
  /** #99: locked pieces (by index) — unselectable; hovering shows a lock and clicking it unlocks. */
  locked?: ReadonlySet<number>;
  onToggleLock?: (pieceIndex: number) => void;
  /** Layer order: 'front' draws the piece over everything, 'back' under everything. */
  onReorder?: (pieceIndex: number, dir: 'front' | 'back') => void;
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
  const onSettingsRef = useRef(props.onOpenSettings);
  const lockedRef = useRef(props.locked);
  const onLockRef = useRef(props.onToggleLock);
  const onOrderRef = useRef(props.onReorder);
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
  onSettingsRef.current = props.onOpenSettings;
  lockedRef.current = props.locked;
  onLockRef.current = props.onToggleLock;
  onOrderRef.current = props.onReorder;
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
    type HandleDrag = { pieceIndex: number; handleId: string; initialPiece?: any; resizeAnchor?: { min: Point; max: Point }; cursor?: string };
    type PieceDrag = { startWorld: Point; lastWorld: Point };
    type BoxDrag = { startWorld: Point; curWorld: Point };
    let handleDrag: HandleDrag | null = null;
    let pendingSettingsClick: HandleDrag | null = null;
    let pendingOrderClick: { index: number; dir: 'front' | 'back' } | null = null;
    let pendingLockClick: number | null = null;
    let pieceDrag: PieceDrag | null = null;
    let boxDrag: BoxDrag | null = null;
    let pendingPlace: Point | null = null;
    let downPoint: Point | null = null;
    let hoveredHandle: HandleDrag | null = null;
    let hoveredLocked: number | null = null;


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

    /** #101: the locked piece whose lock icon is under `world` — the ONLY way to unlock a piece. */
    const hitLockIcon = (world: Point): number | null => {
      const locked = lockedRef.current;
      if (!locked?.size) return null;
      const radiusWorld = HANDLE_SCREEN / camera().scale;
      let best: number | null = null;
      let bestDist = radiusWorld;
      for (const i of locked) {
        const bounds = pbRef.current[i];
        if (!bounds) continue;
        const lk = lockHandlePoint(bounds);
        const d = Math.hypot(lk.x - world.x, lk.y - world.y);
        if (d <= bestDist) { best = i; bestDist = d; }
      }
      return best;
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
      const bounds = pbRef.current[idx];
      if (bounds) {
        // #99 base overlay: shared by every item — source of truth is `baseBoxHandles`.
        handles.push(...baseBoxHandles(piece, bounds));
        const lk = lockHandlePoint(bounds);
        handles.push({ id: 'lock', x: lk.x, y: lk.y, cursor: 'pointer', label: 'Lock' });
        const od = orderHandlePoints(bounds);
        handles.push({ id: 'front', ...od.front, cursor: 'pointer', label: 'Bring to front' }, { id: 'back', ...od.back, cursor: 'pointer', label: 'Send to back' });
      }

      const camScale = camera().scale;
      const radiusWorld = HANDLE_SCREEN / camScale;
      let best: HandleDrag | null = null;
      let bestDist = Infinity;
      for (const h of handles) {
        const d = Math.hypot(h.x - world.x, h.y - world.y);
        if (d <= radiusWorld * 1.6 && d < bestDist) {
          bestDist = d;
          best = { pieceIndex: idx, handleId: h.id, initialPiece: piece, resizeAnchor: bounds, cursor: h.cursor };
        }
      }
      return best;
    };

    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const local = localPoint(event.clientX, event.clientY);
      const worldRaw = toWorldRaw(local);
      const world = toWorld(local);
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
          // #101: a click on a locked piece's lock icon unlocks it (and does nothing else).
          const lockHit = hitLockIcon(worldRaw);
          if (lockHit !== null) {
            pendingLockClick = lockHit;
            return;
          }
          const h = hitHandleReal(worldRaw);
          if (h) {
            if (h.handleId === 'settings') {
              pendingSettingsClick = h;
              return;
            }
            if (h.handleId === 'lock') {
              pendingLockClick = h.pieceIndex;
              return;
            }
            if (h.handleId === 'front' || h.handleId === 'back') {
              pendingOrderClick = { index: h.pieceIndex, dir: h.handleId };
              return;
            }
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
          // #101: locked pieces are invisible to clicks — the click passes through to what is under them.
          hit = hitPieceAt(worldRaw, curTrack, b2p, pbRef.current, lockedRef.current);
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
        hoveredHandle = null;

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
      cursor = world;

      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pinch && pointers.size >= 2) {
        const middle = localPoint(middleOf().x, middleOf().y);
        const scale = clampZoom(pinch.scale * (spreadOf() / pinch.spread));
        const newCam = { x: pinch.world.x - (middle.x - width / 2) / scale, y: pinch.world.y - (middle.y - height / 2) / scale, scale };
        rig.camera = clampCamera(newCam, width, height, trackHeight());
        return;
      }

      if (!handleDrag && !pieceDrag && !boxDrag && !pan && !armedRef.current && !pendingPlace) {
        hoveredHandle = hitHandleReal(worldRaw);
        // #99: hovering a locked item shows its lock icon (no other interaction).
        hoveredLocked = null;
        let onLockIcon = false;
        if (!hoveredHandle && lockedRef.current?.size) {
          const iconHit = hitLockIcon(worldRaw);
          if (iconHit !== null) { hoveredLocked = iconHit; onLockIcon = true; }
          const curTrack = trackRef.current;
          if (hoveredLocked === null && curTrack && b2pRef.current.length) {
            const hp = hitPieceAt(worldRaw, curTrack, b2pRef.current, pbRef.current);
            if (hp !== null && lockedRef.current.has(hp)) hoveredLocked = hp;
          }
        }
        canvas.style.cursor = hoveredHandle ? (hoveredHandle.cursor ?? 'pointer') : onLockIcon ? 'pointer' : 'crosshair';
      } else {
        hoveredHandle = null;
        hoveredLocked = null;
        if (!pan) canvas.style.cursor = 'crosshair';
      }

      if (handleDrag) {
        // Drag handle to new world (snapped)
        onHandleRef.current(handleDrag.pieceIndex, handleDrag.handleId, world, handleDrag.initialPiece, handleDrag.resizeAnchor);
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
      const wasPendingSettingsClick = pendingSettingsClick;
      const wasPendingLockClick = pendingLockClick;
      pendingSettingsClick = null;
      pendingLockClick = null;
      const wasPendingOrderClick = pendingOrderClick;
      pendingOrderClick = null;

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
              const hitSet = piecesInBox({ minX, minY, maxX, maxY }, curTrack, b2p, pbRef.current, lockedRef.current ?? undefined);
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
      } else if (wasPendingSettingsClick && isClick) {
        onSettingsRef.current(wasPendingSettingsClick.pieceIndex);
      } else if (wasPendingLockClick !== null && isClick) {
        onLockRef.current?.(wasPendingLockClick);
      } else if (wasPendingOrderClick && isClick) {
        onOrderRef.current?.(wasPendingOrderClick.index, wasPendingOrderClick.dir);
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

      cursor = world;
    };

    const pointerLeave = () => {
      if (!pointers.size) {
        cursor = null;
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
    // #99: hovering a locked item shows only its lock icon — click it to unlock.
    const drawHoverLock = (ctx: CanvasRenderingContext2D, overlay: OverlayView) => {
      if (hoveredLocked === null) return;
      const bounds = pbRef.current[hoveredLocked];
      if (!bounds) return;
      const cam = overlay.camera;
      const toScreen = (w: Point): Point => ({ x: (w.x - cam.x) * cam.scale + overlay.width / 2, y: (w.y - cam.y) * cam.scale + overlay.height / 2 });
      const sMin = toScreen(bounds.min);
      const sMax = toScreen(bounds.max);
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sMin.x, sMin.y, sMax.x - sMin.x, sMax.y - sMin.y);
      ctx.setLineDash([]);
      ctx.restore();
      const lk = toScreen(lockHandlePoint(bounds));
      drawHandleIcon(ctx, lk.x, lk.y, 'lock', true);
    };

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
        const bounds = pb[idx];
        if (bounds) {
          // #99 base overlay: every item shows the same box controls; source is `baseBoxHandles`.
          handles.push(...baseBoxHandles(piece, bounds));
          const lk = lockHandlePoint(bounds);
          handles.push({ id: 'lock', x: lk.x, y: lk.y, cursor: 'pointer', label: 'Lock' });
          const od = orderHandlePoints(bounds);
          handles.push({ id: 'front', ...od.front, cursor: 'pointer', label: 'Bring to front' }, { id: 'back', ...od.back, cursor: 'pointer', label: 'Send to back' });
        }
        // Rotate handle: a stalk from the box edge to the rotate pad, drawn under the knobs.
        const rot = handles.find((h) => h.id === 'box-rot') ?? handles.find((h) => h.id === 'rot');
        const centre = handles[0];
        if (rot && centre) {
          const sc = bounds ? toScreen({ x: (bounds.min.x + bounds.max.x) / 2, y: bounds.min.y }) : toScreen(centre);
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
          const isHover = hoveredHandle?.pieceIndex === idx && hoveredHandle?.handleId === h.id;
          drawHandleIcon(ctx, s.x, s.y, h.id, isHover);
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
        
        // Link lines for pairs of handles like a/b for saw, or similar path start/end points
        const ha = handles.find((h) => h.id === 'a');
        const hb = handles.find((h) => h.id === 'b');
        if (ha && hb) {
          const sA = toScreen(ha);
          const sB = toScreen(hb);
          ctx.save();
          ctx.strokeStyle = 'rgba(255,209,138,0.85)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(sA.x, sA.y);
          ctx.lineTo(sB.x, sB.y);
          ctx.stroke();
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

    // ---- placement ghost -------------------------------------------------------------
    // The preview is the piece a click actually commits: `placementPieces` is shared with
    // `TrackEditor.handlePlace`, so a variant tile's preset, a trapdoor hinge or a whole saved
    // template group reads from the placement geometry instead of a second copy of the defaults.
    // Cached against the cursor because resolving it walks the palette and the stored templates.
    let ghostKey = '';
    let ghostCache: GhostPreview | null = null;

    const drawGhost = (ctx: CanvasRenderingContext2D, overlay: OverlayView) => {
      const armedT = armedRef.current;
      const cur = cursor;
      // Only show ghost when not dragging handles/pieces
      if (!armedT || !cur || handleDrag || pieceDrag || boxDrag) return;
      const cam = overlay.camera;
      const sc = cam.scale;
      const toScreen = (w: Point): Point => ({ x: (w.x - cam.x) * sc + overlay.width / 2, y: (w.y - cam.y) * sc + overlay.height / 2 });
      const at = (p: { x: number; y: number }): Point => toScreen({ x: p.x, y: p.y });
      const atVec = (p: readonly [number, number]): Point => toScreen({ x: p[0], y: p[1] });

      const key = `${armedT}|${cur.x}|${cur.y}|${gridRef.current ? 1 : 0}`;
      if (key !== ghostKey) {
        ghostKey = key;
        // The template list is read from the memo rather than storage: this runs on every cursor
        // move, and `armed` is the only thing that can change which template is meant.
        ghostCache = ghostPreview(armedT, cur, gridRef.current, templateRef.current ? [templateRef.current] : []);
      }
      const preview = ghostCache;
      if (!preview) return;

      if (preview.invalid) {
        // A template group wider than the track is refused instead of squashed (#74), so the ghost
        // marks the refusal rather than previewing a placement the click would not make.
        const no = toScreen(cur);
        ctx.save();
        ctx.strokeStyle = '#d63e2e';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(no.x - 10, no.y - 10); ctx.lineTo(no.x + 10, no.y + 10);
        ctx.moveTo(no.x + 10, no.y - 10); ctx.lineTo(no.x - 10, no.y + 10);
        ctx.stroke();
        ctx.restore();
        return;
      }

      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const ghost of preview.pieces) {
        // Variants that differ only by colour keep their own tint, so an orange peg reads orange.
        const accent = ghost.tint ?? '#d63e2e';
        ctx.strokeStyle = accent;
        ctx.fillStyle = accent;
        for (const part of ghost.parts) {
          ctx.globalAlpha = 0.72;
          ctx.lineWidth = part.kind === 'path' ? part.width ?? 2 : 2;
          switch (part.kind) {
            case 'box': {
              const s = at(part);
              const w = part.w * sc;
              const h = part.h * sc;
              ctx.globalAlpha = 0.14;
              ctx.fillRect(s.x - w / 2, s.y - h / 2, w, h);
              ctx.globalAlpha = 0.72;
              ctx.strokeRect(s.x - w / 2, s.y - h / 2, w, h);
              break;
            }
            case 'ring': {
              const s = at(part);
              ctx.beginPath();
              ctx.arc(s.x, s.y, Math.max(2, part.r * sc), 0, Math.PI * 2);
              if (part.fill) {
                ctx.globalAlpha = 0.55;
                ctx.fill();
              } else {
                ctx.globalAlpha = 0.14;
                ctx.fill();
                ctx.globalAlpha = 0.72;
                ctx.stroke();
              }
              break;
            }
            case 'path': {
              ctx.beginPath();
              part.pts.forEach(([wx, wy], i) => {
                const s = toScreen({ x: wx, y: wy });
                if (i) ctx.lineTo(s.x, s.y);
                else ctx.moveTo(s.x, s.y);
              });
              if (part.close) {
                ctx.closePath();
                ctx.globalAlpha = 0.14;
                ctx.fill();
                ctx.globalAlpha = 0.72;
              }
              ctx.stroke();
              break;
            }
            case 'arrow': {
              const a = atVec(part.from);
              const b = atVec(part.to);
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              const ang = Math.atan2(b.y - a.y, b.x - a.x);
              for (const side of [-1, 1]) {
                ctx.moveTo(b.x, b.y);
                ctx.lineTo(b.x + Math.cos(ang + side * 2.5) * 8, b.y + Math.sin(ang + side * 2.5) * 8);
              }
              ctx.stroke();
              break;
            }
          }
        }
        // The grab points the placed piece will expose — route ends, orientation, size handles —
        // so a piece can be reshaped in one move from the ghost.
        ctx.globalAlpha = 0.85;
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        for (const h of ghost.handles) {
          const s = at(h);
          ctx.beginPath();
          ctx.rect(s.x - 3.5, s.y - 3.5, 7, 7);
          ctx.stroke();
        }
        ctx.setLineDash([6, 4]);
      }

      // Name the armed tile or template once, under the cursor.
      const s = toScreen(cur);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.fillStyle = '#f2f5fa';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(preview.label.toUpperCase(), s.x, s.y - 16);
      ctx.restore();
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
      render(ctx, stage, rig.camera, width, height, now, { minimap: false, shake: false, workshopPreview: true });
      if (gridRef.current) drawGrid(ctx, overlayView);
      if (rulerRef.current) drawRuler(ctx, overlayView);
      drawCursorMark(ctx, overlayView);
      drawSelection(ctx, overlayView);
      drawHoverLock(ctx, overlayView);
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
