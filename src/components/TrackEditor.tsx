/**
 * MB-02 + MB-03 + MB-04. The Workshop: editor shell plus direct manipulation
 * and test drive.
 *
 * Opens on a copy of the circuit the garage is showing (MB-01 def).  MB-02
 * provided the shell (camera, grid, palette, map).  MB-03 adds placing via
 * palette, selection via body bounds → piece index, handles per type,
 * multi-select/box/duplicate/delete/nudge/mirror and an undo/redo stack of
 * exact def snapshots plus a properties panel for numeric editing.  MB-04
 * adds a test drive that runs the real `Game` on the def-built track with
 * a minimal HUD, ghost field toggle and a live trail, returning to the
 * editor with def and camera unchanged.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpToLine,
  Check,
  CircleHelp,
  Copy,
  Crosshair,
  Flag,
  Grid3x3,
  LayoutGrid,
  Pause,
  Play,
  Redo2,
  Ruler,
  ScanSearch,
  Save,
  Share2,
  Target,
  Trash2,
  Undo2,
  Users,
  X,
  ZoomIn,
  ZoomOut,
  FlipHorizontal,
} from 'lucide-react';
import Brand from './Brand';
import RulesDialog from './RulesDialog';
import EditorCanvas from './editor/EditorCanvas';
import type { EditorStatus } from './editor/EditorCanvas';
import EditorMap from './editor/EditorMap';
import PiecePalette from './editor/PiecePalette';
import PropertiesPanel from './editor/PropertiesPanel';
import { SNAP, clampCamera, formatUnits, formatZoom, newRig, rigCenter, rigFit, rigZoom } from './editor/camera';
import type { CameraRig, Point } from './editor/camera';
import { tileFor } from './editor/palette';
import type { PieceType } from './editor/palette';
import { defaultPiece } from './editor/defaults';
import { History } from './editor/history';
import { buildEditorTrack } from './editor/build';
import { applyHandle, movePiece, mirrorPiece } from './editor/handles';
import type { Piece, TrackDef } from '../game/trackdef';
import { MAX_NAME } from '../game/trackdef';
import { generateTrackDef } from '../game/trackdef';
import { Game } from '../game/engine';
import { clearStaticChunks } from '../game/render';
import { THEME_IDS } from '../game/types';
import type { MarbleInfo, ThemeId, TrackProfile } from '../game/types';
import TestDrive from './editor/TestDrive';
import ValidationPanel from './editor/ValidationPanel';
import { validateTrackAsync } from './editor/validate';
import type { ValidationResult } from './editor/validate';
import MyTracksPanel from './editor/MyTracksPanel';
import SharePanel from './editor/SharePanel';
import { loadTracksSync, loadTracks, loadDraftSync, saveDraft, createTrack, updateTrack, deleteTrack as deleteSavedTrack, duplicateTrack as duplicateSavedTrack, renameTrack as renameSavedTrack } from '../game/tracks';
import type { SavedTrack } from '../game/tracks';
import { encodeShareCode } from '../game/sharecode';
import '../editor.css';

interface Props {
  seed: number;
  profile: TrackProfile;
  name: string;
  driver: MarbleInfo;
  onExit: () => void;
}

interface Circuit {
  def: TrackDef;
  build: number;
}

function cloneDef(def: TrackDef): TrackDef {
  return JSON.parse(JSON.stringify(def)) as TrackDef;
}

function ensureHeight(def: TrackDef): TrackDef {
  // Height must contain every piece's y and still leave room for the finish stub.
  // Validation rejects a piece whose y exceeds height, so after adding/moving we
  // grow the circuit if needed.
  let maxY = def.height;
  for (const p of def.pieces) {
    let y = 0;
    switch (p.t) {
      case 'ramp':
      case 'ice':
      case 'curve':
        y = Math.max(p.a[1], p.b[1], p.t === 'curve' ? p.c[1] : -1e9);
        break;
      case 'loop':
        y = p.bottom;
        break;
      case 'hoop':
      case 'spinner':
      case 'breakable':
      case 'peg':
      case 'ppeg':
      case 'itembox':
      case 'wall':
      case 'block':
      case 'pad':
      case 'boost':
        y = (p as { y: number }).y;
        break;
      case 'wrecker':
        y = p.pivot[1] + p.chain;
        break;
      case 'bucket':
        y = p.y;
        break;
    }
    if (y > maxY - 300) maxY = y + 400;
  }
  if (maxY !== def.height) return { ...def, height: Math.max(def.height, maxY) };
  return def;
}

export default function TrackEditor({ seed, profile, name, driver, onExit }: Props) {
  const [circuit, setCircuit] = useState<Circuit>(() => {
    const draft = loadDraftSync();
    if (draft) return { def: draft, build: 0 };
    return { def: generateTrackDef(seed, profile, name), build: 0 };
  });
  // MB-06: My tracks + open draft persistence
  const [savedTracks, setSavedTracks] = useState<SavedTrack[]>(() => loadTracksSync());
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [stage, setStage] = useState<Game | null>(null);
  const [grid, setGrid] = useState(true);
  const [ruler, setRuler] = useState(true);
  const [armed, setArmed] = useState<PieceType | null>(null);
  const [rules, setRules] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [status, setStatus] = useState<EditorStatus>({ top: 0, bottom: 0, scale: 1, cursor: null });
  const [selected, setSelected] = useState<number[]>([]);
  // MB-04: test drive state — def and camera are preserved across the round-trip
  const [testing, setTesting] = useState(false);
  const [ghost, setGhost] = useState(false);
  const [spawnAt, setSpawnAt] = useState<Point | null>(null);
  const [pickSpawn, setPickSpawn] = useState(false);
  // MB-05: validation + share/draft gating
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const rigRef = useRef<CameraRig | null>(null);
  if (!rigRef.current) rigRef.current = newRig();
  const rig = rigRef.current;
  const driverRef = useRef(driver);
  driverRef.current = driver;

  // Undo/redo of exact def snapshots, cap 100 (MB-03).
  const historyRef = useRef<History | null>(null);
  if (!historyRef.current) historyRef.current = new History();
  const history = historyRef.current;
  const [, forceTick] = useState(0);
  const bumpHistory = useCallback(() => forceTick((n) => n + 1), []);

  const built = useMemo(() => buildEditorTrack(circuit.def), [circuit.def, circuit.build]);
  const track = built.track;
  const bodyToPiece = built.bodyToPiece;
  const buildError = built.error;

  // Keep the canvas's handle hit-test in sync without adding def to the canvas prop list.
  useEffect(() => {
    (rig as unknown as { defPieces?: Piece[] }).defPieces = circuit.def.pieces;
  }, [circuit.def.pieces, rig]);

  useEffect(() => {
    if (!track) {
      setStage(null);
      return;
    }
    const game = new Game(track.seed, [driverRef.current], { track, effects: false, aiItems: false, recovery: false });
    setStage(game);
    return () => {
      clearStaticChunks(game);
      game.destroy();
    };
  }, [track]);

  // Keep selection in range after deletions / undo.
  useEffect(() => {
    setSelected((prev) => prev.filter((i) => i >= 0 && i < circuit.def.pieces.length));
  }, [circuit.def.pieces.length]);

  // MB-06: hydrate My tracks from cloud (device cache is sync, cloud is async)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cloud = await loadTracks();
      if (!cancelled && cloud.length !== savedTracks.length) setSavedTracks(cloud);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // MB-06: autosave open draft every 10 s and on page hide / before unload + on exit
  useEffect(() => {
    const id = window.setInterval(() => {
      try { saveDraft(circuit.def); } catch { /* ignore */ }
    }, 10_000);
    const onHide = () => { try { saveDraft(circuit.def); } catch { /* ignore */ } };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });
    return () => {
      window.clearInterval(id);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      document.removeEventListener('visibilitychange', onHide as EventListener);
    };
  }, [circuit.def]);

  // Also persist draft immediately on every circuit change (debounced via autosave interval would be enough,
  // but immediate write keeps "reload restores open draft" instant for tests)
  useEffect(() => {
    try { saveDraft(circuit.def); } catch { /* ignore */ }
  }, [circuit.def]);

  // MB-07: handle ?share=CODE link — decode and offer import
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('share');
      if (!code) return;
      void (async () => {
        try {
          const { decodeShareCode } = await import('../game/sharecode');
          const def = await decodeShareCode(code);
          // Auto-import to My tracks and load
          const res = createTrack(def);
          if (!('error' in res)) {
            setSavedTracks(loadTracksSync());
            history.push(circuit.def);
            setCircuit({ def: cloneDef((res as SavedTrack).def), build: 0 });
            setActiveTrackId((res as SavedTrack).id);
            setDraftMsg(`Imported shared track “${def.name}”`);
            setTimeout(() => setDraftMsg(null), 4000);
          } else {
            setDraftMsg(`Share link valid but could not save: ${(res as { error: string }).error}`);
          }
          // clean URL
          params.delete('share');
          const next = params.toString();
          try { window.history.replaceState(null, '', window.location.pathname + (next ? `?${next}` : '') + window.location.hash); } catch { /* ignore */ }
        } catch (e) {
          setDraftMsg(e instanceof Error ? e.message : String(e));
          setTimeout(() => setDraftMsg(null), 4000);
        }
      })();
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pushHistory = useCallback(() => {
    history.push(circuit.def);
    bumpHistory();
  }, [circuit.def, history, bumpHistory]);

  const commit = useCallback(
    (mutate: (def: TrackDef) => TrackDef, opts?: { push?: boolean; select?: number[] }) => {
      const shouldPush = opts?.push !== false;
      setCircuit((cur) => {
        if (shouldPush) history.push(cur.def);
        let next = mutate(cloneDef(cur.def));
        next = ensureHeight(next);
        if (opts?.select !== undefined) setSelected(opts.select);
        // Force history tick for toolbar enabled state when pushing
        if (shouldPush) setTimeout(bumpHistory, 0);
        return { def: next, build: cur.build + 1 };
      });
    },
    [history, bumpHistory],
  );

  // Transaction for continuous drags: one push at start, many silent commits, no push during updates.
  const transactionRef = useRef(false);
  const startTransaction = useCallback(() => {
    if (transactionRef.current) return;
    transactionRef.current = true;
    history.push(circuit.def);
    bumpHistory();
  }, [circuit.def, history, bumpHistory]);
  const transact = useCallback(
    (mutate: (def: TrackDef) => TrackDef) => {
      setCircuit((cur) => {
        let next = mutate(cloneDef(cur.def));
        next = ensureHeight(next);
        return { def: next, build: cur.build + 1 };
      });
    },
    [],
  );
  const endTransaction = useCallback(() => {
    transactionRef.current = false;
  }, []);

  const handlePlace = useCallback(
    (world: { x: number; y: number }) => {
      if (!armed) return;
      const piece = defaultPiece(armed, world, grid);
      commit(
        (def) => {
          def.pieces.push(piece);
          return def;
        },
        { select: [circuit.def.pieces.length] },
      );
    },
    [armed, grid, commit, circuit.def.pieces.length],
  );

  const handleSelect = useCallback(
    (indices: number[], additive: boolean) => {
      if (additive) {
        setSelected((prev) => {
          const set = new Set(prev);
          for (const i of indices) if (set.has(i)) set.delete(i);
          else set.add(i);
          return [...set].sort((a, b) => a - b);
        });
      } else {
        setSelected(indices);
      }
    },
    [],
  );

  const handleClear = useCallback(() => setSelected([]), []);

  const handleMoveSelected = useCallback(
    (dx: number, dy: number, opts?: { push?: boolean }) => {
      if (selected.length === 0) return;
      if (opts?.push) pushHistory();
      transact((def) => {
        for (const idx of selected) {
          const p = def.pieces[idx];
          if (!p) continue;
          def.pieces[idx] = movePiece(p, dx, dy);
        }
        return def;
      });
    },
    [selected, transact, pushHistory],
  );

  const applyHandleChange = useCallback(
    (pieceIndex: number, handleId: string, to: { x: number; y: number }) => {
      transact((def) => {
        const p = def.pieces[pieceIndex];
        if (!p) return def;
        def.pieces[pieceIndex] = applyHandle(p, handleId, to, grid);
        return def;
      });
    },
    [transact, grid],
  );

  const handleDelete = useCallback(() => {
    if (selected.length === 0) return;
    pushHistory();
    setCircuit((cur) => {
      const set = new Set(selected);
      const pieces = cur.def.pieces.filter((_, i) => !set.has(i));
      setSelected([]);
      return { def: ensureHeight({ ...cloneDef(cur.def), pieces }), build: cur.build + 1 };
    });
  }, [selected, pushHistory]);

  const handleDuplicate = useCallback(() => {
    if (selected.length === 0) return;
    pushHistory();
    const offset = grid ? 25 : 12;
    setCircuit((cur) => {
      const toAdd: Piece[] = [];
      const startLen = cur.def.pieces.length;
      for (const idx of selected) {
        const p = cur.def.pieces[idx];
        if (!p) continue;
        const cloned = JSON.parse(JSON.stringify(p)) as Piece;
        toAdd.push(movePiece(cloned, offset, offset));
      }
      const newIndices = toAdd.map((_, i) => startLen + i);
      const nextDef = cloneDef(cur.def);
      nextDef.pieces.push(...toAdd);
      setSelected(newIndices);
      return { def: ensureHeight(nextDef), build: cur.build + 1 };
    });
  }, [selected, grid, pushHistory]);

  const handleMirror = useCallback(() => {
    if (selected.length === 0) return;
    pushHistory();
    setCircuit((cur) => {
      const next = cloneDef(cur.def);
      for (const idx of selected) {
        const p = next.pieces[idx];
        if (!p) continue;
        next.pieces[idx] = mirrorPiece(p);
      }
      return { def: ensureHeight(next), build: cur.build + 1 };
    });
  }, [selected, pushHistory]);

  const handleNudge = useCallback(
    (dx: number, dy: number) => {
      if (selected.length === 0) return;
      pushHistory();
      setCircuit((cur) => {
        const next = cloneDef(cur.def);
        for (const idx of selected) {
          const p = next.pieces[idx];
          if (!p) continue;
          next.pieces[idx] = movePiece(p, dx, dy);
        }
        return { def: ensureHeight(next), build: cur.build + 1 };
      });
    },
    [selected, pushHistory],
  );

  const handleUndo = useCallback(() => {
    const prev = history.undo(circuit.def);
    if (!prev) return;
    setCircuit((cur) => ({ def: prev, build: cur.build + 1 }));
    setSelected((s) => s.filter((i) => i < prev.pieces.length));
    bumpHistory();
  }, [circuit.def, history, bumpHistory]);

  const handleRedo = useCallback(() => {
    const next = history.redo(circuit.def);
    if (!next) return;
    setCircuit((cur) => ({ def: next, build: cur.build + 1 }));
    setSelected((s) => s.filter((i) => i < next.pieces.length));
    bumpHistory();
  }, [circuit.def, history, bumpHistory]);

  const handlePropChange = useCallback(
    (index: number, nextPiece: Piece) => {
      pushHistory();
      setCircuit((cur) => {
        const nd = cloneDef(cur.def);
        nd.pieces[index] = nextPiece;
        return { def: ensureHeight(nd), build: cur.build + 1 };
      });
    },
    [pushHistory],
  );

  const handleBulkChange = useCallback(
    (_indices: number[], _updater: (p: Piece) => Piece) => {
      // Placeholder for bulk property edits (not needed for single-select inspector).
    },
    [],
  );

  // MB-04: test drive handlers — def and camera preserved on round-trip
  const handlePickSpawn = useCallback((world: Point) => {
    setSpawnAt(world);
    setPickSpawn(false);
  }, []);
  const enterTest = useCallback(() => setTesting(true), []);
  const exitTest = useCallback(() => setTesting(false), []);

  // MB-05: validation, draft saving and share gating
  const handleValidate = useCallback(async () => {
    setValidating(true);
    setDraftMsg(null);
    setShareMsg(null);
    try {
      const result = await validateTrackAsync(circuit.def);
      setValidation(result);
    } finally {
      setValidating(false);
    }
  }, [circuit.def]);

  const handleValidationJump = useCallback((pos: Point) => {
    rigCenter(rig, pos.y);
    try {
      rig.camera = clampCamera({ ...rig.camera, x: pos.x }, rig.width, rig.height, rig.trackHeight);
    } catch {
      // fallback: only y jump
    }
  }, [rig]);

  const handleSaveDraft = useCallback(() => {
    try {
      saveDraft(circuit.def);
      setDraftMsg(`Draft “${circuit.def.name}” saved. Drafts always save — validation not required.`);
      setTimeout(() => setDraftMsg(null), 3500);
    } catch {
      setDraftMsg('Draft saved (storage unavailable).');
    }
  }, [circuit.def]);

  const handleShare = useCallback(async () => {
    let result = validation;
    if (!result || validating) {
      setValidating(true);
      result = await validateTrackAsync(circuit.def);
      setValidation(result);
      setValidating(false);
    }
    if (!result.canShare) {
      setShareMsg(result.issues.filter((i) => i.severity === 'error').map((i) => i.message).slice(0, 2).join(' — ') || 'Fix errors before sharing. Need ≥9/10 finishers and no hard errors.');
      return;
    }
    try {
      const code = await encodeShareCode(circuit.def);
      await navigator.clipboard.writeText(code);
      setShareMsg(`Share code copied (${code.slice(0, 24)}…${code.slice(-12)}). Paste to race online.`);
      setTimeout(() => setShareMsg(null), 4500);
    } catch (e) {
      setShareMsg(e instanceof Error ? e.message : String(e));
    }
  }, [circuit.def, validation, validating]);

  // MB-06: My tracks — save current, load, rename, duplicate, delete + exit autosave
  const handleSaveCurrent = useCallback(() => {
    if (activeTrackId) {
      const res = updateTrack(activeTrackId, circuit.def);
      if ('error' in res) {
        setDraftMsg(res.error);
        setTimeout(() => setDraftMsg(null), 3500);
        return;
      }
      setSavedTracks(loadTracksSync());
      setDraftMsg(`Updated “${circuit.def.name}” in My tracks.`);
      setTimeout(() => setDraftMsg(null), 3000);
    } else {
      const res = createTrack(circuit.def);
      if ('error' in res) {
        setDraftMsg(res.error);
        setTimeout(() => setDraftMsg(null), 3500);
        return;
      }
      setSavedTracks(loadTracksSync());
      setActiveTrackId((res as SavedTrack).id);
      setDraftMsg(`Saved “${circuit.def.name}” to My tracks.`);
      setTimeout(() => setDraftMsg(null), 3000);
    }
  }, [circuit.def, activeTrackId]);

  const handleLoadTrack = useCallback((id: string) => {
    const tracks = loadTracksSync();
    const found = tracks.find((t) => t.id === id);
    if (!found) return;
    // autosave current draft before switching
    try { saveDraft(circuit.def); } catch { /* ignore */ }
    history.push(circuit.def);
    setCircuit({ def: cloneDef(found.def), build: 0 });
    setActiveTrackId(id);
    setSelected([]);
    setValidation(null);
    bumpHistory();
  }, [circuit.def, history, bumpHistory]);

  const handleRenameTrack = useCallback((id: string, name: string): string | null => {
    const res = renameSavedTrack(id, name);
    if ('error' in res) return res.error;
    setSavedTracks(loadTracksSync());
    // if renaming the active track, also update circuit name
    if (id === activeTrackId) {
      setCircuit((cur) => ({ def: { ...cur.def, name: name.trim().slice(0, MAX_NAME) }, build: cur.build }));
    }
    return null;
  }, [activeTrackId]);

  const handleDuplicateTrack = useCallback((id: string) => {
    const res = duplicateSavedTrack(id);
    if ('error' in res) {
      setDraftMsg((res as { error: string }).error);
      setTimeout(() => setDraftMsg(null), 3000);
      return;
    }
    setSavedTracks(loadTracksSync());
    setDraftMsg(`Duplicated “${(res as SavedTrack).def.name}”.`);
    setTimeout(() => setDraftMsg(null), 3000);
  }, []);

  const handleDeleteTrack = useCallback((id: string) => {
    const ok = deleteSavedTrack(id);
    if (!ok) return;
    setSavedTracks(loadTracksSync());
    if (id === activeTrackId) setActiveTrackId(null);
    setDraftMsg('Track deleted.');
    setTimeout(() => setDraftMsg(null), 2500);
  }, [activeTrackId]);

  const handleImportTrack = useCallback((def: TrackDef) => {
    const res = createTrack(def);
    if ('error' in res) {
      setDraftMsg((res as { error: string }).error);
      setTimeout(() => setDraftMsg(null), 3500);
      return;
    }
    setSavedTracks(loadTracksSync());
    // auto-load the imported track
    history.push(circuit.def);
    setCircuit({ def: cloneDef((res as SavedTrack).def), build: 0 });
    setActiveTrackId((res as SavedTrack).id);
    setSelected([]);
    setValidation(null);
    bumpHistory();
    setDraftMsg(`Imported “${def.name}” to My tracks.`);
    setTimeout(() => setDraftMsg(null), 3000);
  }, [circuit.def, history, bumpHistory]);

  const handleExit = useCallback(() => {
    try { saveDraft(circuit.def); } catch { /* ignore */ }
    onExit();
  }, [circuit.def, onExit]);

  // Keyboard: delete, duplicate, undo/redo, nudge, mirror, escape clears selection / disarms
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (testing) {
        // While test drive is active its own canvas owns Esc.  We only
        // handle Esc here as a fallback if the test canvas lost focus.
        if (e.key === 'Escape') {
          e.preventDefault();
          setTesting(false);
        }
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicate();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.length) {
          e.preventDefault();
          handleDelete();
        }
        return;
      }
      if (e.key === 'Escape') {
        setSelected([]);
        setArmed(null);
        return;
      }
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (selected.length) {
          e.preventDefault();
          handleMirror();
        }
        return;
      }
      // Arrow nudge: 1 unit, Shift = SNAP, grid already snaps on handle but nudge respects grid
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (selected.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? SNAP : 1;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        handleNudge(dx, dy);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [testing, selected, handleDelete, handleDuplicate, handleMirror, handleNudge, handleUndo, handleRedo]);

  const editName = useCallback(
    (value: string) => {
      setCircuit((cur) => ({ def: { ...cur.def, name: value.slice(0, MAX_NAME) }, build: cur.build }));
    },
    [],
  );
  const editTheme = useCallback(
    (theme: ThemeId) => {
      commit((def) => ({ ...def, theme }), { push: true });
    },
    [commit],
  );

  const cursor = status.cursor;
  const cursorText = cursor ? `x ${formatUnits(cursor.x)} u · y ${formatUnits(cursor.y)} u${grid ? ' · SNAPPED' : ''}` : 'POINTER OFF THE CIRCUIT';
  const canUndo = history.canUndo;
  const canRedo = history.canRedo;

  return (
    <div className="app-shell editor-shell" data-drawer={drawer ? 'open' : 'closed'}>
      <header className="app-header">
        <Brand />
        <nav className="main-nav" aria-label="Main navigation">
          <button onClick={handleExit}>Garage</button>
          <button className="active" aria-current="page">Workshop</button>
          <button onClick={() => setRules(true)}>How to play</button>
        </nav>
        <div className="header-tools">
          <span className="editor-seed">SEED <b>{seed.toString(16).slice(0, 6).toUpperCase()}</b></span>
          <button className="icon-button mobile-only" onClick={() => setRules(true)} aria-label="How to play">
            <CircleHelp size={17} />
          </button>
          <button className="icon-button mobile-only" onClick={handleExit} aria-label="Back to the garage">
            <ArrowLeft size={17} />
          </button>
        </div>
      </header>

      <main className="editor-main">
        <section className="editor-tools" aria-label="Piece palette">
          <header className="editor-tools-head">
            <span className="eyebrow"><b>01</b> PIECES</span>
            <button className="icon-button editor-drawer-close" onClick={() => setDrawer(false)} aria-label="Close the palette">
              <X size={15} />
            </button>
          </header>
          <PiecePalette active={armed} onPick={(t) => setArmed((cur) => (cur === t ? null : t))} />
          <div className="editor-inspector">
            <header className="eyebrow"><b>02</b> PROPERTIES</header>
            <PropertiesPanel selected={selected} pieces={circuit.def.pieces} onChange={handlePropChange} onChangeMany={handleBulkChange} />
          </div>
          <p className="palette-note" style={{ marginTop: 8 }}>
            MB-03: click a palette piece then the canvas to place. Drag pieces or their handles to edit. Shift+click / drag a box to multi-select.
          </p>
          <ValidationPanel result={validation} validating={validating} onJump={handleValidationJump} onValidate={handleValidate} />
          <MyTracksPanel
            tracks={savedTracks}
            activeId={activeTrackId}
            currentDef={circuit.def}
            onLoad={handleLoadTrack}
            onRename={handleRenameTrack}
            onDuplicate={handleDuplicateTrack}
            onDelete={handleDeleteTrack}
            onSaveCurrent={handleSaveCurrent}
          />
          <SharePanel def={circuit.def} validation={validation} validating={validating} onImport={handleImportTrack} />
          <div className="editor-savebar" role="toolbar" aria-label="Save and share">
            <button className="button-secondary" onClick={handleSaveDraft} title="Save as draft — always allowed, even with errors">
              <Save size={13} /> Save draft
            </button>
            <button
              className={`button-primary ${validation?.canShare ? '' : 'is-disabled'}`}
              onClick={handleShare}
              aria-disabled={!validation?.canShare}
              title={validation?.canShare ? 'Copy share code — track passed validation (≥9/10, no hard errors)' : 'Share requires validation pass (≥9/10 finishers, no hard errors) — run Validate first'}
            >
              <Share2 size={13} /> Share
            </button>
            {draftMsg && <span className="editor-save-msg is-draft"><Check size={11} />{draftMsg}</span>}
            {shareMsg && <span className="editor-save-msg is-share">{shareMsg}</span>}
            {!validation && !shareMsg && <span className="editor-save-hint">Validate to share · drafts always save</span>}
          </div>
        </section>

        <section className="editor-stage">
          <div className="editor-toolbar">
            <label className="editor-field editor-name">
              <span className="eyebrow">Track name</span>
              <input value={circuit.def.name} maxLength={MAX_NAME} aria-label="Track name" onChange={(e) => editName(e.target.value)} />
            </label>
            <label className="editor-field editor-theme">
              <span className="eyebrow">Theme</span>
              <select value={circuit.def.theme} aria-label="Track theme" onChange={(e) => editTheme(e.target.value as ThemeId)}>
                {THEME_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id[0].toUpperCase() + id.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <div className="editor-toggles">
              <button
                type="button"
                className={`editor-toggle ${grid ? 'on' : ''}`}
                aria-pressed={grid}
                onClick={() => setGrid((v) => !v)}
                title={`Snap every piece to a ${SNAP}-unit grid`}
              >
                <Grid3x3 size={13} />Grid {SNAP} u
              </button>
              <button type="button" className={`editor-toggle ${ruler ? 'on' : ''}`} aria-pressed={ruler} onClick={() => setRuler((v) => !v)} title="Height ruler">
                <Ruler size={13} />Ruler
              </button>
            </div>
            <div className="editor-zoom">
              <button className="icon-button" onClick={() => rigZoom(rig, 1 / 1.25)} aria-label="Zoom out">
                <ZoomOut size={15} />
              </button>
              <span className="editor-zoom-level">{formatZoom(status.scale)}</span>
              <button className="icon-button" onClick={() => rigZoom(rig, 1.25)} aria-label="Zoom in">
                <ZoomIn size={15} />
              </button>
              <button className="text-button" onClick={() => rigFit(rig)} title="Fit the whole pipe">
                <ScanSearch size={13} />Fit
              </button>
            </div>
            <div className="editor-jumps">
              <button className="text-button" onClick={() => rigCenter(rig, 0)}>
                <ArrowUpToLine size={13} />Start
              </button>
              <button className="text-button" onClick={() => rigCenter(rig, track?.finishY ?? 0)}>
                Finish<Flag size={13} />
              </button>
            </div>
            <button className="editor-toggle editor-palette-toggle mobile-only" aria-expanded={drawer} onClick={() => setDrawer((v) => !v)}>
              <LayoutGrid size={13} />Pieces
            </button>
          </div>

          <div className="editor-editbar">
            <button className="icon-button" onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
              <Undo2 size={14} />
            </button>
            <button className="icon-button" onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
              <Redo2 size={14} />
            </button>
            <span className="editbar-sep" />
            <button className="text-button" onClick={handleDuplicate} disabled={selected.length === 0} title="Duplicate (Ctrl+D)">
              <Copy size={13} />Duplicate
            </button>
            <button className="text-button" onClick={handleMirror} disabled={selected.length === 0} title="Mirror horizontally (M)">
              <FlipHorizontal size={13} />Mirror
            </button>
            <button className="text-button" onClick={handleDelete} disabled={selected.length === 0} title="Delete">
              <Trash2 size={13} />Delete
            </button>
            <span className="editor-chip" style={{ marginLeft: 'auto' }}>
              {selected.length ? `${selected.length} SELECTED` : armed ? `ARMED · ${(tileFor(armed)?.label ?? armed).toUpperCase()}` : 'NO PIECE ARMED'}
            </span>
          </div>

          <div className="editor-testbar">
            <button
              className={`button-primary editor-testdrive ${testing ? 'is-testing' : ''}`}
              onClick={testing ? exitTest : enterTest}
              aria-pressed={testing}
              disabled={!!buildError && !testing}
              title={buildError ? `Cannot test: ${buildError}` : testing ? 'Stop test and return to editor (Esc)' : 'Test drive this circuit — Esc returns, camera preserved'}
            >
              {testing ? <Pause size={14} /> : <Play size={14} />}
              {testing ? 'Stop test' : 'Test drive'}
            </button>
            <button
              type="button"
              className={`editor-toggle ${ghost ? 'on' : ''}`}
              aria-pressed={ghost}
              onClick={() => setGhost((v) => !v)}
              title="Ghost field: 10 marbles with AI (toggle before or after starting test, trail shows player)"
            >
              <Users size={13} /> Ghost field
            </button>
            <button
              type="button"
              className={`editor-toggle ${pickSpawn ? 'on' : ''} ${spawnAt ? 'has-spawn' : ''}`}
              aria-pressed={pickSpawn}
              onClick={() => setPickSpawn((v) => !v)}
              title={spawnAt ? `Start at ${Math.round(spawnAt.x)}, ${Math.round(spawnAt.y)} — click to re-pick` : 'Pick a start point on the canvas (or leave at grid)'}
            >
              <Crosshair size={13} />
              {spawnAt ? `Start ${Math.round(spawnAt.x)},${Math.round(spawnAt.y)}` : pickSpawn ? 'Click track…' : 'Set start'}
            </button>
            {spawnAt && (
              <button className="text-button" onClick={() => setSpawnAt(null)} title="Clear custom start — next test starts at grid">
                <Target size={13} /> Clear start
              </button>
            )}
            <span className={`editor-chip ${testing ? 'is-testing' : 'is-muted'}`} style={{ marginLeft: 'auto' }}>
              {testing ? 'TESTING · Esc to return · Def & camera preserved' : pickSpawn ? 'PICK A POINT ON THE CIRCUIT' : ghost ? '10 MARBLES ON TEST' : 'SOLO TEST · A/D nudge · Trail live'}
            </span>
          </div>

          {testing ? (
            <TestDrive def={circuit.def} driver={driver} seed={seed} ghost={ghost} spawnAt={spawnAt} onExit={exitTest} />
          ) : (
            <>
              {buildError && (
                <p className="editor-error" role="alert">
                  This circuit cannot be built: {buildError}
                </p>
              )}

              <EditorCanvas
                game={stage}
                rig={rig}
                grid={grid}
                ruler={ruler}
                onStatus={setStatus}
                armed={armed}
                track={track}
                bodyToPiece={bodyToPiece}
                selected={selected}
                onPlace={handlePlace}
                onSelect={handleSelect}
                onClear={handleClear}
                onMoveSelected={handleMoveSelected}
                onHandleChange={applyHandleChange}
                startTransaction={startTransaction}
                transact={transact}
                endTransaction={endTransaction}
                spawnAt={spawnAt}
                pickingSpawn={pickSpawn}
                onPickSpawn={handlePickSpawn}
                validation={validation}
              />

              <footer className="editor-status">
                <span className={`editor-chip ${cursor ? '' : 'is-muted'}`}>{cursorText}</span>
                <span className="editor-chip">VIEW {formatUnits(status.top)} – {formatUnits(status.bottom)} u</span>
                <span className="editor-chip">LENGTH {track ? formatUnits(track.height) : '—'} u</span>
                <span className="editor-chip">{circuit.def.pieces.length} PIECES</span>
                <span className={`editor-chip ${selected.length ? '' : 'is-muted'}`}>
                  {selected.length ? `${selected.length} selected` : armed ? 'ARMED' : 'NO SELECTION'}
                </span>
              </footer>
            </>
          )}
        </section>

        <EditorMap track={track} top={status.top} bottom={status.bottom} onJump={(worldY) => rigCenter(rig, worldY)} />
      </main>

      {rules && <RulesDialog onClose={() => setRules(false)} />}
    </div>
  );
}
