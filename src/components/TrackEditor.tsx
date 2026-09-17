/**
 * MB-02. The Workshop: the editor's shell.
 *
 * Opens on a copy of the circuit the garage is showing — for the default seed, Marblehurst — recorded as a
 * `TrackDef` (MB-01) and rebuilt on every change, so the canvas is the race's own renderer drawing the race's
 * own `Track`. This ticket is the frame a player builds inside: the camera, the snap grid, the ruler, the piece
 * palette, the course map and the track's name and theme. Placing, selecting and moving pieces is MB-03, and a
 * test drive is MB-04.
 *
 * Two rules from the epic are visible here and nowhere else:
 *  - the editor never simulates. It builds a `Game` so `render()` has a track to paint, but never steps it.
 *  - a track edit rebuilds the circuit and drops the game's static chunk cache, so no frame is ever drawn from
 *    an out-of-date bake.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpToLine, CircleHelp, Flag, Grid3x3, LayoutGrid, Ruler, ScanSearch, X, ZoomIn, ZoomOut } from 'lucide-react';
import Brand from './Brand';
import RulesDialog from './RulesDialog';
import EditorCanvas from './editor/EditorCanvas';
import EditorMap from './editor/EditorMap';
import PiecePalette from './editor/PiecePalette';
import { SNAP, formatUnits, formatZoom, newRig, rigCenter, rigFit, rigZoom } from './editor/camera';
import type { CameraRig } from './editor/camera';
import type { EditorStatus } from './editor/EditorCanvas';
import { tileFor } from './editor/palette';
import type { PieceType } from './editor/palette';
import { MAX_NAME, TrackDefError, buildTrackFromDef, generateTrackDef } from '../game/trackdef';
import type { TrackDef } from '../game/trackdef';
import { Game } from '../game/engine';
import { clearStaticChunks } from '../game/render';
import { THEME_IDS } from '../game/types';
import type { MarbleInfo, ThemeId, TrackProfile } from '../game/types';
import '../editor.css';

interface Props {
  /** The garage's current circuit seed, profile and name: what the editor opens on. */
  seed: number;
  profile: TrackProfile;
  name: string;
  /** The player's marble, parked on the start grid so the canvas reads at a glance. */
  driver: MarbleInfo;
  onExit: () => void;
}

interface Circuit { def: TrackDef; /** Bumped by every edit that changes what is drawn; a rename is not one. */ build: number }

export default function TrackEditor({ seed, profile, name, driver, onExit }: Props) {
  const [circuit, setCircuit] = useState<Circuit>(() => ({ def: generateTrackDef(seed, profile, name), build: 0 }));
  const [stage, setStage] = useState<Game | null>(null);
  const [grid, setGrid] = useState(true);
  const [ruler, setRuler] = useState(true);
  const [armed, setArmed] = useState<PieceType | null>(null);
  const [rules, setRules] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [status, setStatus] = useState<EditorStatus>({ top: 0, bottom: 0, scale: 1, cursor: null });
  const rigRef = useRef<CameraRig | null>(null);
  if (!rigRef.current) rigRef.current = newRig();
  const rig = rigRef.current;
  /** Read at build time only: the parked marble is a scale reference, not editor state. */
  const driverRef = useRef(driver);
  driverRef.current = driver;

  /**
   * The circuit as the canvas sees it. Keyed on `build` rather than on the def object: renaming a track must
   * not rebuild a thousand physics bodies, so `build` — and this memo — is what "an edit" means. A def that
   * cannot be built leaves the canvas empty and the reason on screen instead of taking the editor down.
   */
  const built = useMemo(() => {
    try {
      return { track: buildTrackFromDef(circuit.def), error: null };
    } catch (error) {
      return { track: null, error: error instanceof TrackDefError ? error.message : String(error) };
    }
  }, [circuit.build]);

  useEffect(() => {
    if (!built.track) {
      setStage(null);
      return;
    }
    // The engine is never stepped here: it exists so `render()` has a game to draw. `track` rather than `def`
    // because the def is already validated and built above.
    const game = new Game(built.track.seed, [driverRef.current], { track: built.track, effects: false, aiItems: false, recovery: false });
    setStage(game);
    return () => {
      // Drop the bake with the game (MB-03 calls the same hook after an edit keeps a game alive).
      clearStaticChunks(game);
      game.destroy();
    };
  }, [built.track]);

  const edit = useCallback((mutate: (def: TrackDef) => TrackDef, rebuild = true) => {
    setCircuit((current) => ({ def: mutate(current.def), build: current.build + (rebuild ? 1 : 0) }));
  }, []);

  const track = built.track;
  const cursor = status.cursor;
  const cursorText = cursor
    ? `x ${formatUnits(cursor.x)} u · y ${formatUnits(cursor.y)} u${grid ? ' · SNAPPED' : ''}`
    : 'POINTER OFF THE CIRCUIT';

  return <div className="app-shell editor-shell" data-drawer={drawer ? 'open' : 'closed'}>
    <header className="app-header">
      <Brand />
      <nav className="main-nav" aria-label="Main navigation">
        <button onClick={onExit}>Garage</button>
        <button className="active" aria-current="page">Workshop</button>
        <button onClick={() => setRules(true)}>How to play</button>
      </nav>
      <div className="header-tools">
        <span className="editor-seed">SEED <b>{seed.toString(16).slice(0, 6).toUpperCase()}</b></span>
        <button className="icon-button mobile-only" onClick={() => setRules(true)} aria-label="How to play"><CircleHelp size={17} /></button>
        <button className="icon-button mobile-only" onClick={onExit} aria-label="Back to the garage"><ArrowLeft size={17} /></button>
      </div>
    </header>

    <main className="editor-main">
      <section className="editor-tools" aria-label="Piece palette">
        <header className="editor-tools-head">
          <span className="eyebrow"><b>01</b> PIECES</span>
          <button className="icon-button editor-drawer-close" onClick={() => setDrawer(false)} aria-label="Close the palette"><X size={15} /></button>
        </header>
        <PiecePalette active={armed} onPick={(t) => setArmed((current) => (current === t ? null : t))} />
      </section>

      <section className="editor-stage">
        <div className="editor-toolbar">
          <label className="editor-field editor-name">
            <span className="eyebrow">Track name</span>
            <input
              value={circuit.def.name}
              maxLength={MAX_NAME}
              aria-label="Track name"
              onChange={(event) => edit((def) => ({ ...def, name: event.target.value.slice(0, MAX_NAME) }), false)}
            />
          </label>
          <label className="editor-field editor-theme">
            <span className="eyebrow">Theme</span>
            <select value={circuit.def.theme} aria-label="Track theme" onChange={(event) => edit((def) => ({ ...def, theme: event.target.value as ThemeId }))}>
              {THEME_IDS.map((id) => <option key={id} value={id}>{id[0].toUpperCase() + id.slice(1)}</option>)}
            </select>
          </label>
          <div className="editor-toggles">
            <button type="button" className={`editor-toggle ${grid ? 'on' : ''}`} aria-pressed={grid} onClick={() => setGrid((value) => !value)} title={`Snap every piece to a ${SNAP}-unit grid`}><Grid3x3 size={13} />Grid {SNAP} u</button>
            <button type="button" className={`editor-toggle ${ruler ? 'on' : ''}`} aria-pressed={ruler} onClick={() => setRuler((value) => !value)} title="Height ruler down the left edge"><Ruler size={13} />Ruler</button>
          </div>
          <div className="editor-zoom">
            <button className="icon-button" onClick={() => rigZoom(rig, 1 / 1.25)} aria-label="Zoom out"><ZoomOut size={15} /></button>
            <span className="editor-zoom-level">{formatZoom(status.scale)}</span>
            <button className="icon-button" onClick={() => rigZoom(rig, 1.25)} aria-label="Zoom in"><ZoomIn size={15} /></button>
            <button className="text-button" onClick={() => rigFit(rig)} title="Fit the whole pipe on screen"><ScanSearch size={13} />Fit</button>
          </div>
          <div className="editor-jumps">
            <button className="text-button" onClick={() => rigCenter(rig, 0)}><ArrowUpToLine size={13} />Start</button>
            <button className="text-button" onClick={() => rigCenter(rig, track?.finishY ?? 0)}>Finish<Flag size={13} /></button>
          </div>
          <button className="editor-toggle editor-palette-toggle mobile-only" aria-expanded={drawer} onClick={() => setDrawer((value) => !value)}><LayoutGrid size={13} />Pieces</button>
        </div>

        {built.error && <p className="editor-error" role="alert">This circuit cannot be built: {built.error}</p>}

        <EditorCanvas game={stage} rig={rig} grid={grid} ruler={ruler} onStatus={setStatus} />

        <footer className="editor-status">
          <span className={`editor-chip ${cursor ? '' : 'is-muted'}`}>{cursorText}</span>
          <span className="editor-chip">VIEW {formatUnits(status.top)} – {formatUnits(status.bottom)} u</span>
          <span className="editor-chip">LENGTH {track ? formatUnits(track.height) : '—'} u</span>
          <span className="editor-chip">{circuit.def.pieces.length} PIECES</span>
          <span className={`editor-chip ${armed ? 'is-armed' : 'is-muted'}`}>{armed ? `ARMED · ${(tileFor(armed)?.label ?? armed).toUpperCase()}` : 'NO PIECE ARMED'}</span>
        </footer>
      </section>

      <EditorMap track={track} top={status.top} bottom={status.bottom} onJump={(worldY) => rigCenter(rig, worldY)} />
    </main>

    {rules && <RulesDialog onClose={() => setRules(false)} />}
  </div>;
}
