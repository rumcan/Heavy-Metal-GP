// ══════════════════════════════════════════════════════════════════════════
// MB-02 — the Workshop's shell.
//
// The ticket's acceptance is two claims about a screen: opening the editor on
// a copy of Marblehurst shows that circuit, and pan/zoom stay smooth. Neither
// can be settled by a unit test, so this file settles what genuinely can be
// settled without a browser, and is honest about the rest:
//
//   1. THE CAMERA, AS MATHS (the "smooth" half that is provable): pan
//      clamps its window to the circuit, a zoom keeps the point under the
//      pointer pinned, and the snap lattice always steps in whole 25-unit
//      multiples whatever the zoom. These are the functions the pointer
//      handlers call; if they hold, a drag cannot escape the circuit and a
//      pinch cannot run away.
//   2. THE SHELL PAINTS: the editor, the palette and the course map rendered
//      to static markup through vite's SSR pipeline (as `tests/lobby-ui.test.ts`
//      does) — the palette's four groups with real sprite art, the name field
//      and theme picker, the canvas, the status readouts, a course map with a
//      camera window in it.
//   3. THE SHELL'S RULES, BY SOURCE SCAN: the editor is a shell — it never
//      steps the simulation (that is MB-04's test drive), it drops a game's
//      static chunk cache when the circuit changes, and it touches neither
//      `localStorage` nor `Math.random()` (epic rules).
//
// What is NOT here: the feel of a drag under a finger, and that the canvas
// really draws the race. Those are played by hand (`npm run dev` → Workshop)
// and, for the pixels, by the browser suite (`tests/browser.test.ts`).
// ══════════════════════════════════════════════════════════════════════════
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

// The RUN SDK singleton reads `window` on import, and the component tree
// reaches it through the game modules. The same two stubs the lobby's UI test
// uses — enough to import, not a DOM.
const stubs = globalThis as unknown as { window?: unknown; document?: unknown };
stubs.window ??= {
  location: { href: 'http://localhost:5173/', origin: 'http://localhost:5173' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
};
stubs.document ??= {
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} }, body: { appendChild() {} },
  querySelector: () => null, addEventListener() {},
};

import { MAX_ZOOM, MIN_WORK_SCALE, PAD_X, PAD_Y, SNAP, clampCamera, fitScale, formatUnits, gridStep, newRig, openScale, rigCenter, rigFit, rigOpen, rigZoom, rulerStep, snapPoint, snapValue, viewWindowOf, worldAt, zoomAbout } from '../src/components/editor/camera';
import type { CameraRig, EditorCamera } from '../src/components/editor/camera';
import { PALETTE, TILES, tileFor } from '../src/components/editor/palette';
import { W } from '../src/game/track';
import { CALENDAR } from '../src/game/season';
import { THEME_LABELS, themeIdFor } from '../src/game/types';
import { MAX_NAME, TRACKDEF_VERSION, buildTrackFromDef, generateTrackDef, validateTrackDef } from '../src/game/trackdef';

// ── vite's SSR pipeline: the components import CSS and use `import.meta.glob` ──
const { createServer } = await import('vite');
const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement } = await import('react');

const server = await createServer({
  configFile: false, // not this app's config: that boots the SDK's room sidecar
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  esbuild: { jsx: 'automatic' },
  // This app's PostCSS config is a build gate; the test does not need it.
  css: { postcss: { plugins: [] } },
});
after(() => server.close());

const TrackEditor = (await server.ssrLoadModule('/src/components/TrackEditor.tsx')).default;
const PiecePalette = (await server.ssrLoadModule('/src/components/editor/PiecePalette.tsx')).default;
const EditorMap = (await server.ssrLoadModule('/src/components/editor/EditorMap.tsx')).default;

const MARBLEHURST = CALENDAR[0];
const DRIVER = { id: 0, name: 'You', color: '#d63e2e', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true };

// ══════════════════════════════════════════════════════════════════════════
// 1. The camera: pan, zoom, snap.
// ══════════════════════════════════════════════════════════════════════════

const rig = (width: number, height: number, trackHeight: number): CameraRig => {
  const r = newRig();
  r.width = width; r.height = height; r.trackHeight = trackHeight; r.startY = 116;
  return r;
};

test('Editor camera: a zoom keeps the point under the pointer exactly where it is', () => {
  const camera: EditorCamera = { x: 700, y: 5000, scale: 0.8 };
  for (const [sx, sy] of [[0, 0], [300, 200], [900, 700], [1200, 60]]) {
    const before = worldAt(camera, sx, sy, 1200, 800);
    const zoomed = zoomAbout(camera, camera.scale * 2.5, sx, sy, 1200, 800);
    const after = worldAt(zoomed, sx, sy, 1200, 800);
    assert.ok(Math.abs(after.x - before.x) < 1e-9, `anchor x moved: ${before.x} → ${after.x}`);
    assert.ok(Math.abs(after.y - before.y) < 1e-9, `anchor y moved: ${before.y} → ${after.y}`);
    assert.equal(zoomed.scale, camera.scale * 2.5);
  }
});

test('Editor camera: a zoom about the middle moves nothing but the scale', () => {
  const r = rig(1200, 800, 20_000);
  rigFit(r);
  const x = r.camera.x;
  rigCenter(r, 8000);
  const centred = r.camera.y;
  assert.equal(centred, 8000, 'the camera could not be centred on the middle of the circuit');
  rigZoom(r, 1.25);
  // Zooming about the centre keeps the centre: neither axis moves while the clamp has room.
  assert.equal(r.camera.x, x, 'a centre zoom shifted the camera sideways');
  assert.equal(r.camera.y, centred, 'a centre zoom shifted the camera down the circuit');
  assert.equal(r.camera.scale, fitScale(1200, 800) * 1.25);
});

test('Editor camera: panning cannot leave the circuit', () => {
  const trackHeight = 16_324;
  for (const [width, height] of [[1200, 800], [900, 600], [420, 800], [2200, 1100]]) {
    const r = rig(width, height, trackHeight);
    rigFit(r);
    const win = viewWindowOf(r.camera, width, height);
    assert.ok(win.right - win.left >= W, `${width}×${height}: the fit view is narrower than the pipe`);
    // Drag hard in every direction. A viewport wide enough to hold the pipe plus its margins is centred on
    // it — it cannot be dragged off; a tighter one stops with the pipe's edge `PAD_X` from the frame.
    for (const [dx, dy] of [[-99_999, -99_999], [99_999, 99_999], [-99_999, 99_999], [99_999, -99_999]]) {
      rigFit(r);
      const scale = r.camera.scale;
      r.camera = clampCamera({ ...r.camera, x: r.camera.x + dx, y: r.camera.y + dy }, width, height, trackHeight);
      const clamped = viewWindowOf(r.camera, width, height);
      const label = `${width}×${height} @${scale.toFixed(2)}×`;
      if (width / 2 / scale >= W / 2 + PAD_X) assert.equal(r.camera.x, W / 2, `${label}: a wide viewport should centre the pipe, not hang off it`);
      else assert.ok(clamped.left >= -PAD_X - 1e-6 && clamped.right <= W + PAD_X + 1e-6, `${label}: dragged past the pipe's working margin (${clamped.left}..${clamped.right})`);
      if (height / 2 / scale >= trackHeight / 2 + PAD_Y) assert.equal(r.camera.y, trackHeight / 2, `${label}: a tall viewport should centre the circuit`);
      else assert.ok(clamped.top >= -PAD_Y - 1e-6 && clamped.bottom <= trackHeight + PAD_Y + 1e-6, `${label}: dragged past the circuit's end (${clamped.top}..${clamped.bottom})`);
      // An empty window would mean the marble can be out of view with the camera pinned on a wall.
      assert.ok(clamped.bottom - clamped.top > 40, `${label}: the clamped window collapsed`);
    }
    // A viewport too wide to overflow centres on the pipe instead of pinning to a side.
    const wide = clampCamera({ x: -50_000, y: 100, scale: 0.2 }, 4000, 800, trackHeight);
    assert.ok(Math.abs(wide.x - W / 2) < 1e-9, `a viewport wider than the pipe should centre it, got x=${wide.x}`);
  }
});

test('Editor camera: zoom is bounded; Fit fits the pipe, opening stays workable', () => {
  const r = rig(1440, 900, 16_324);
  rigFit(r);
  assert.equal(r.camera.scale, fitScale(1440, 900));
  const win = viewWindowOf(r.camera, 1440, 900);
  assert.ok(win.left <= 0 && win.right >= W, `Fit crops the pipe: ${win.left}..${win.right}`);
  for (let i = 0; i < 40; i++) rigZoom(r, 1.25);
  assert.ok(r.camera.scale <= MAX_ZOOM + 1e-9, `zoomed past the ceiling: ${r.camera.scale}`);
  for (let i = 0; i < 80; i++) rigZoom(r, 1 / 1.25);
  assert.ok(r.camera.scale >= 0.2 - 1e-9, `zoomed past the floor: ${r.camera.scale}`);

  // A phone's canvas cannot fit 900 units of pipe at a legible scale, so the editor opens zoomed in far
  // enough to place a piece, and Fit still means fit.
  const phone = rig(334, 760, 16_324);
  rigOpen(phone);
  assert.ok(phone.camera.scale >= MIN_WORK_SCALE, `opened too small to work at: ${phone.camera.scale}`);
  assert.ok(phone.camera.scale > fitScale(334, 760), 'on a phone the opening view should be closer than a bare fit');
  assert.ok(openScale(1440, 900) === fitScale(1440, 900), 'a desktop canvas should open on the whole pipe');
  rigFit(phone);
  const phoneFit = viewWindowOf(phone.camera, 334, 760);
  assert.ok(phoneFit.right - phoneFit.left >= W, 'Fit stopped fitting on a phone');
});

test('Editor grid: every snap is a whole 25 units, and the lattice keeps up with the zoom', () => {
  for (const value of [-33.7, 0, 12.4, 12.6, 449.9, 16_323.9]) {
    const snapped = snapValue(value);
    assert.equal(Math.abs(snapped % SNAP), 0, `${value} snapped to ${snapped}, which is not a multiple of ${SNAP}`);
    assert.ok(Math.abs(snapped - value) <= SNAP / 2, `${value} snapped to ${snapped}, more than half a cell away`);
  }
  assert.deepEqual(snapPoint({ x: 462.5, y: 1301.2 }), { x: 475, y: 1300 });
  // The drawn lattice is always a multiple of the snap step, and never denser than the minimum gap.
  for (const scale of [0.2, 0.29, 0.5, 0.83, 1, 1.6, 2.5]) {
    const { minor, major } = gridStep(scale);
    assert.equal(minor % SNAP, 0, `minor step ${minor} at ${scale}× is not a multiple of the snap grid`);
    assert.equal(major % minor, 0, `major step ${major} is not a multiple of the minor ${minor}`);
    assert.ok(minor * scale >= 12, `minor step ${minor} is only ${(minor * scale).toFixed(1)}px apart at ${scale}×`);
    assert.ok(rulerStep(scale) * scale >= 40, `ruler labels collide at ${scale}×`);
  }
  assert.equal(formatUnits(16_324.4), '16 324');
  assert.equal(formatUnits(-1234), '-1 234');
  assert.equal(formatUnits(900), '900');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. The shell paints: palette, canvas, toolbar, course map.
// ══════════════════════════════════════════════════════════════════════════

test('Palette: the ticket\'s groups, every piece a def can store, and the race art', () => {
  assert.deepEqual(PALETTE.map((g) => g.label), ['Rails', 'Features', 'Pegs', 'Walls', 'Secrets', 'Danger', 'Movers', 'Launchers', 'Fields & surfaces', 'Big set pieces']);
  // Rails 6 (with the ring rail and the sign) · Features 7 · Pegs 5 · Walls 2 · Secrets 6 · Danger 5 · Movers 6 · Launchers 5 ·
  // Fields 4 · Set pieces 5. Counts are tiles, not types: Pegs/Secrets/Movers/Launchers carry a
  // second variant each (orange and item pegs, the tough barricade and the weight trapdoor, the
  // reversed belt, the right-hand flipper). Danger has no variant — five kinds, five tiles.
  // #99 retired three tiles: the track switch lever (Secrets), the scoop (Launchers) and the
  // skipping pond (Fields). The line below is the one that matters: every type the def format
  // can store is in the palette.
  assert.deepEqual(PALETTE.map((g) => g.tiles.length), [6, 7, 6, 2, 6, 5, 6, 5, 4, 5]);
  const types = [...new Set(TILES.map((tile) => tile.t))].sort();
  // #99: pool, scoop and switch are retired — the palette covers exactly the def format's remaining placeable pieces.
  assert.deepEqual(types, ['barricade', 'blade', 'block', 'boost', 'boulder', 'breakable', 'bridge', 'bucket', 'cannon', 'catapult', 'conveyor', 'crumble', 'crusher', 'curve', 'flipper', 'geyser', 'hoop', 'ice', 'itembox', 'loop', 'mace', 'magnet', 'mud', 'pad', 'peg', 'platform', 'ppeg', 'ramp', 'ring', 'saw', 'screw', 'seesaw', 'sign', 'sling', 'spinner', 'targets', 'trampoline', 'trapdoor', 'tunnel', 'turnstile', 'vortex', 'wall', 'wheel', 'wind', 'wrecker'], 'the palette should cover exactly the def format\'s placeable pieces');
  const ids = TILES.map((tile) => tile.id);
  assert.equal(new Set(ids).size, ids.length, 'two tiles share an id');
  // A piece type may have variants (the Peggle peg colours): the plain tile's id is the bare type and it has no
  // preset; every variant has its own id and a preset.
  for (const type of types) assert.equal(TILES.filter((tile) => tile.id === type).length, 1, `${type} has no plain tile`);
  for (const tile of TILES) assert.equal(tile.id === tile.t, tile.preset === undefined, `${tile.id}: variants need a preset, plain tiles must not have one`);
  // The fourth is Peg art: premade pictures stamped as a group of Peggle pegs.
  assert.deepEqual(TILES.filter((tile) => tile.t === 'ppeg').map((tile) => tile.preset?.color ?? 'blue'), ['blue', 'orange', 'green', 'blue']);
  for (const tile of TILES) {
    assert.ok(tile.label && tile.hint, `${tile.t} needs a label and a hint`);
    assert.ok(tile.sprite === null || /^[a-z0-9-]+$/.test(tile.sprite), `${tile.t} names art that cannot exist: ${tile.sprite}`);
  }
  assert.equal(tileFor('wrecker')?.label, 'Wrecking ball');

  const markup = renderToStaticMarkup(createElement(PiecePalette, { active: 'spinner', onPick() {} }));
  for (const group of PALETTE) assert.ok(markup.includes(`>${group.label.replace('&', '&amp;')}<`), `the ${group.label} group is missing from the palette`);
  assert.equal((markup.match(/class="palette-tile[ "]/g) ?? []).length, TILES.length, 'a tile did not render');
  assert.equal((markup.match(/<img/g) ?? []).length, TILES.filter((tile) => tile.sprite).length, 'every tile with art should show it');
  assert.ok(markup.includes('class="palette-tile armed" aria-pressed="true"'), 'the armed tile does not announce itself');
  assert.equal((markup.match(/aria-pressed="true"/g) ?? []).length, 1, 'only one tile may be armed');
});

test('Workshop: the shell renders the canvas, the toolbar, the readouts and the course map', () => {
  const markup = renderToStaticMarkup(createElement(TrackEditor, {
    seed: 230946, profile: MARBLEHURST.profile, name: MARBLEHURST.name, driver: DRIVER, onExit() {},
  }));
  // The garage's header nav, with the Workshop as the current page.
  assert.ok(markup.includes('>Garage</button>') && markup.includes('Workshop'));
  assert.ok(markup.includes('aria-current="page">Workshop'), 'the Workshop is not marked as the current screen');
  // The canvas the race's renderer paints into.
  assert.ok(markup.includes('class="editor-canvas"'), 'no canvas');
  assert.ok(markup.includes('Circuit canvas'), 'the canvas is not described to a screen reader');
  // Name and theme, from the def the editor opened on.
  assert.ok(markup.includes(`value="${MARBLEHURST.name}"`), 'the track name field does not hold the def\'s name');
  assert.ok(new RegExp(`maxlength="${MAX_NAME}"`, 'i').test(markup), `the name field ignores the ${MAX_NAME}-character limit`);
  // The theme picker names the def's theme; its cards (incl. the Dwarven Forge and Worg Canyon art themes) open on click.
  assert.ok(markup.includes('class="theme-picker-button"'), 'no theme picker');
  assert.ok(markup.includes(`Track theme: ${THEME_LABELS[themeIdFor(MARBLEHURST.profile.theme)]}`), 'the theme picker does not name the track theme');
  // The grid and the ruler, armed by default.
  assert.ok(markup.includes(`Grid ${SNAP} u`), 'the snap-grid toggle does not name its step');
  assert.ok(markup.includes('>Ruler</button>'), 'no ruler toggle');
  // Both toggles start armed: the grid and the ruler are what a player builds against.
  assert.equal((markup.match(/class="editor-toggle on"/g) ?? []).length, 2, 'the grid and the ruler should start on');
  // Readouts: where the pointer is, what the window shows, how long the circuit is.
  for (const chip of ['POINTER OFF THE CIRCUIT', 'VIEW ', 'LENGTH ', 'PIECES', 'NO PIECE ARMED']) assert.ok(markup.includes(chip), `the status bar is missing "${chip}"`);
  assert.ok(markup.includes('>Fit</button>'), 'no fit-to-circuit control');
  // Every palette group came along with the shell.
  for (const group of PALETTE) assert.ok(markup.includes(`>${group.label.replace('&', '&amp;')}<`), `the ${group.label} group is missing`);
});

test('Workshop: the course map shows the circuit and the camera window', () => {
  // The map is drawn from the built track, so it is rendered through a def of the same shape the editor opens on.
  const def = generateTrackDef(230946, MARBLEHURST.profile, MARBLEHURST.name);
  assert.ok(validateTrackDef(def).ok, 'the editor could not open on a valid circuit');
  const track = buildTrackFromDef(def);
  const markup = renderToStaticMarkup(createElement(EditorMap, { track, top: 1000, bottom: 1900, onJump() {} }));
  assert.ok(markup.includes('COURSE MAP'));
  assert.ok(markup.includes('preserveAspectRatio="none"'), 'the map must map world height onto the strip linearly');
  assert.ok(markup.includes(`viewBox="0 0 104 ${track.height}"`), 'the map is not scaled to the circuit\'s own height');
  assert.ok(markup.includes('editor-map-window'), 'the map does not show where the camera is');
  assert.ok(markup.includes(formatUnits(track.height)), 'the map does not report the circuit length');
  // Every sector of the circuit, and every rail the map draws, is on the strip.
  assert.equal((markup.match(/editor-map-sector/g) ?? []).length, track.segments.length, 'a sector is missing from the map');
  assert.equal((markup.match(/editor-map-rail/g) ?? []).length, track.ramps.length, 'a rail is missing from the map');
  // And with no circuit yet, it says so rather than drawing nothing.
  assert.ok(renderToStaticMarkup(createElement(EditorMap, { track: null, top: 0, bottom: 0, onJump() {} })).includes('No circuit yet'));
});

// ══════════════════════════════════════════════════════════════════════════
// 3. The shell's rules.
// ══════════════════════════════════════════════════════════════════════════

const EDITOR_FILES = [
  'src/components/TrackEditor.tsx',
  'src/components/editor/EditorCanvas.tsx',
  'src/components/editor/EditorMap.tsx',
  'src/components/editor/PiecePalette.tsx',
  'src/components/editor/camera.ts',
  'src/components/editor/overlay.ts',
  'src/components/editor/palette.ts',
];

test('Workshop is a shell: it never steps the simulation, and it rebakes the static layer', () => {
  for (const file of EDITOR_FILES) {
    const source = read(file);
    // MB-04 owns the test drive. Until then the editor builds a world to draw and never advances it.
    assert.ok(!/\.step\(/.test(source), `${file} steps the simulation: a test drive is MB-04, not this ticket`);
    assert.ok(!/PHYSICS_STEP/.test(source), `${file} references the physics tick`);
    // Epic rules: no web storage (RUN.world blocks it) and no unseeded randomness.
    assert.ok(!/localStorage|sessionStorage/.test(source), `${file} touches web storage; use src/game/storage.ts`);
    assert.ok(!/Math\.random\(/.test(source), `${file} uses Math.random()`);
  }
  // An edit drops the game's bake: the one change to render.ts this ticket is allowed.
  assert.ok(read('src/components/TrackEditor.tsx').includes('clearStaticChunks('), 'the editor does not clear the static chunk cache after an edit');
  assert.ok(read('src/game/render.ts').includes('export function clearStaticChunks('), 'render.ts no longer offers the cache hook');
});

test('Workshop is reachable from the garage header, not the garage bottom bar', () => {
  const setup = read('src/components/SetupScreen.tsx');
  assert.ok(/<button onClick=\{onWorkshop\}>Workshop<\/button>/.test(setup), 'the Workshop is not in the garage header nav');
  // The bottom bar is the phone's pane switcher (Circuit / Driver / Grid) — MP-06 and ST-08 own what goes in it.
  const panes = /const PANES = \[([\s\S]*?)\] as const;/.exec(setup);
  assert.ok(panes, 'the garage no longer declares its panes');
  assert.ok(!panes[1].includes('Workshop'), 'the Workshop must not become a garage pane tab');
  // And the app routes to it with the circuit the garage is showing.
  const app = read('src/App.tsx');
  assert.ok(app.includes("import TrackEditor from './components/TrackEditor'"), 'App does not import the Workshop');
  assert.ok(/phase === 'editor'/.test(app) && /<TrackEditor/.test(app), 'App never shows the Workshop');
  assert.ok(/onWorkshop=\{\(\) => setPhase\('editor'\)\}/.test(app), 'the garage cannot open the Workshop');
  assert.ok(/seed=\{seed\}/.test(app) && /profile=\{gp\.profile\}/.test(app) && /name=\{gp\.name\}/.test(app), 'the Workshop does not open on the garage\'s circuit');
});

test('Workshop: the def it opens on is version 1 and JSON-clean', () => {
  const def = generateTrackDef(230946, MARBLEHURST.profile, MARBLEHURST.name);
  assert.equal(def.v, TRACKDEF_VERSION);
  assert.equal(def.theme, 'classic', 'Marblehurst runs the classic skin');
  assert.deepEqual(JSON.parse(JSON.stringify(def)), def, 'the editor\'s working def does not survive a JSON round trip');
});


test('Workshop: a trapdoor swaps its settings with its mode', async () => {
  // #99: this used to be the scoop's kickback/subway toggle; the trapdoor exercises the same
  // conditional-settings pattern (timer fields vs weight fields).
  const PropertiesPanel = (await server.ssrLoadModule('/src/components/editor/PropertiesPanel.tsx')).default;
  const piece = { t: 'trapdoor', x: 450, y: 1500, w: 160, hinge: 1 as const, mode: 'weight' as const, open: 400, closed: 1600, phase: 0, kg: 2.5, hold: 800 };
  const markup = renderToStaticMarkup(createElement(PropertiesPanel, { selected: [0], pieces: [piece], onChange() {} }));
  assert.match(markup, /<option value="weight"[^>]*>Scale \(weight\)<\/option>/);
  assert.ok(markup.includes('Needs (kg)'), 'weight mode shows the scale settings');
  const timed = renderToStaticMarkup(createElement(PropertiesPanel, { selected: [0], pieces: [{ ...piece, mode: 'timer' as const }], onChange() {} }));
  assert.ok(timed.includes('Open (ms)') && timed.includes('Closed (ms)'), 'timer mode shows the clock settings');
  assert.ok(!timed.includes('Needs (kg)'));
});
