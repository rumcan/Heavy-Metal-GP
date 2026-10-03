// Run with: node --import tsx --test tests/platformer-lists.test.ts
// P2-22: a platformer course is an ordinary TrackDef, so it shares every list with a circuit — My tracks, the open
// draft, the community store. The rule is that a classic list never shows a course and the Platformer tab never shows
// a circuit. These tests hold that rule in three places: the helpers every list calls, the community store (which
// publishes and browses both kinds), and the two screens that draw the lists, rendered through vite's SSR pipeline.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

// The RUN SDK singleton reads `window` on import, and the component tree reaches it through the game modules. The same
// two stubs the editor's UI test uses — enough to import, not a DOM.
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

import { validateTrackDef } from '../src/game/trackdef';
import type { TrackDef } from '../src/game/trackdef';
import { newPlatformerDef } from '../src/game/platformer/def';
import { circuitsOf, coursesOf, entriesOfKind, isCourseEntry, kindOf, kindOfDef, splitEntries } from '../src/game/platformer/lists';
import type { CommunityTrack } from '../src/game/community';
import { browseCommunity, decodeCommunityTrack, publishTrack } from '../src/game/community';
import type { SavedTrack } from '../src/game/tracks';

// ── vite's SSR pipeline: the components import CSS and use `import.meta.glob` ──
const { createServer } = await import('vite');
const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement } = await import('react');

const server = await createServer({
  configFile: false, // not this app's config: that boots the SDK's room sidecar
  server: { middlewareMode: true, watch: null }, // no file watcher: it outlived server.close() and kept the run alive
  appType: 'custom',
  logLevel: 'error',
  esbuild: { jsx: 'automatic' },
  // This app's PostCSS config is a build gate; the test does not need it.
  css: { postcss: { plugins: [] } },
});
after(() => server.close());

const MyTracksPanel = (await server.ssrLoadModule('/src/components/editor/MyTracksPanel.tsx')).default;
const TrackPicker = (await server.ssrLoadModule('/src/components/home/TrackPicker.tsx')).default;
const WorkshopTab = (await server.ssrLoadModule('/src/components/home/WorkshopTab.tsx')).default;
// The picker and the Workshop tab read My tracks through their own copy of the store (vite's SSR graph is a second
// module registry), so the seed has to be planted there, not in this file's.
const ssrTracks = await server.ssrLoadModule('/src/game/tracks.ts');

// ── the two kinds of entry ────────────────────────────────────────────────────────────────────────────────────────

const classic = (name: string): TrackDef => ({
  v: 1, name, theme: 'classic', height: 3000,
  pieces: [{ t: 'ramp', a: [120, 400], b: [780, 520] }],
});
const course = (name: string): TrackDef => ({
  ...newPlatformerDef(name, 6000),
  pieces: [{ t: 'ramp', a: [900, 800], b: [3000, 900] }],
});

const saved = (def: TrackDef, id: string): SavedTrack => {
  const check = validateTrackDef(def);
  assert.ok(check.ok, check.ok ? '' : check.error);
  return { id, def: check.ok ? check.def : def, createdAt: 1, updatedAt: 1 };
};

test('a course and a circuit are told apart by their def, whatever the list calls them', () => {
  assert.equal(isCourseEntry(saved(course('Hill Course'), 'a')), true);
  assert.equal(isCourseEntry(saved(classic('Screw City'), 'b')), false);
  assert.equal(kindOfDef(course('Hill Course')), 'platformer');
  assert.equal(kindOfDef(classic('Screw City')), 'track');
});

test('splitEntries keeps both lists complete and in order', () => {
  const list = [
    saved(classic('One'), 'a'), saved(course('Two'), 'b'),
    saved(course('Three'), 'c'), saved(classic('Four'), 'd'),
  ];
  const { circuits, courses } = splitEntries(list);
  assert.deepEqual(circuits.map((t) => t.def.name), ['One', 'Four']);
  assert.deepEqual(courses.map((t) => t.def.name), ['Two', 'Three']);
  assert.equal(circuits.length + courses.length, list.length, 'no entry is dropped');
  assert.deepEqual(coursesOf(list).map((t) => t.id), ['b', 'c']);
  assert.deepEqual(circuitsOf(list).map((t) => t.id), ['a', 'd']);
});

test('a classic list never carries a course, and a course list never carries a circuit', () => {
  const list = [saved(classic('One'), 'a'), saved(course('Two'), 'b')];
  for (const entry of circuitsOf(list)) assert.ok(!isCourseEntry(entry), `${entry.def.name} is a course`);
  for (const entry of coursesOf(list)) assert.ok(isCourseEntry(entry), `${entry.def.name} is not a course`);
  assert.deepEqual(circuitsOf([]), []);
  assert.deepEqual(coursesOf([]), []);
});

test('an entry published before courses existed has no kind, and is a circuit', () => {
  const old: CommunityTrack = { id: 'x', name: 'Old Track', author: 'goblin', tags: [], upvotes: 0, upvotedByMe: false, createdAt: 0, code: '1-aaa' };
  assert.equal(kindOf(old), 'track');
  assert.equal(kindOf({ ...old, kind: 'platformer' }), 'platformer');
  assert.equal(kindOf({ ...old, kind: 'track' }), 'track');
  assert.equal(kindOf(null), 'track');
  const mixed = [old, { ...old, id: 'y', kind: 'platformer' as const }, { ...old, id: 'z' }];
  assert.deepEqual(entriesOfKind(mixed, 'track').map((t) => t.id), ['x', 'z']);
  assert.deepEqual(entriesOfKind(mixed, 'platformer').map((t) => t.id), ['y']);
});

// ── the community store carries both, and keeps them apart ────────────────────────────────────────────────────────

/**
 * The community store reaches RUN.world's SDK as soon as `window` exists, which is what the stub above is for. Lifting
 * it for these two calls sends them to the device-only store instead — the same place a local publish lands, and the
 * only store a test can read back from.
 */
async function withoutWindow<T>(fn: () => Promise<T>): Promise<T> {
  const had = stubs.window;
  delete stubs.window;
  try { return await fn(); } finally { stubs.window = had; }
}

test('a published course is listed as a course and decodes back into a platformer def', async () => {
  const published = await withoutWindow(() => publishTrack(course('Ridge Run'), []));
  assert.equal(published.kind, 'platformer');
  assert.equal(kindOf(published), 'platformer');
  const page = await withoutWindow(() => browseCommunity('new'));
  const found = page.tracks.find((t) => t.id === published.id);
  assert.ok(found, 'the published course is not in the browse list');
  assert.equal(kindOf(found), 'platformer', 'the kind does not survive the store');
  assert.deepEqual(entriesOfKind(page.tracks, 'platformer').map((t) => t.id), [published.id]);
  assert.ok(entriesOfKind(page.tracks, 'track').every((t) => t.id !== published.id), 'a course showed up in the track list');
  const def = await withoutWindow(() => decodeCommunityTrack(found!));
  assert.equal(def.mode, 'platformer');
  assert.equal(def.name, 'Ridge Run');
});

test('a published circuit is listed as a track, next to the courses, and neither list mixes', async () => {
  const circuit = await withoutWindow(() => publishTrack(classic('Bolt Works'), []));
  assert.equal(circuit.kind, 'track');
  const page = await withoutWindow(() => browseCommunity('new'));
  assert.ok(entriesOfKind(page.tracks, 'track').some((t) => t.id === circuit.id));
  assert.ok(entriesOfKind(page.tracks, 'platformer').every((t) => t.id !== circuit.id));
  const def = await withoutWindow(() => decodeCommunityTrack(circuit));
  assert.notEqual(def.mode, 'platformer');
});

// ── the screens that draw the lists ───────────────────────────────────────────────────────────────────────────────

const noop = () => {};
const rows = [saved(classic('Screw City'), 'classic-1'), saved(course('Hill Course'), 'course-1')];
const myTracksMarkup = () => renderToStaticMarkup(createElement(MyTracksPanel, {
  tracks: rows, activeId: null, currentDef: classic('Screw City'),
  onLoad: noop, onRename: () => null, onDuplicate: noop, onDelete: noop,
  onSaveCurrent: noop, onSaveNew: noop,
}));

test('My tracks marks a course with a badge and draws its strip sideways', () => {
  const html = myTracksMarkup();
  assert.ok(html.includes('Hill Course'), 'the course is missing from My tracks');
  assert.ok(html.includes('Screw City'), 'the circuit is missing from My tracks');
  assert.ok(html.includes('is-platformer'), 'the course row is not marked as one');
  assert.ok(html.includes('>PLATFORMER<'), 'the course has no badge');
  assert.equal(html.split('my-track-strip').length - 1, 1, 'only the course gets a strip');
  assert.equal(html.split('track-thumb is-wide').length - 1, 1, 'the strip is not drawn wide');
  assert.ok(html.includes('6k long'), 'the course does not say how long it is');
  assert.ok(html.includes('2 saved · 1 course'), 'the header does not count the courses');
});

/** Put one circuit and one course in the store the SSR-rendered screens read. */
let seeded = false;
const seedStore = () => {
  if (seeded) return;
  for (const row of rows) {
    const res = ssrTracks.createTrack(row.def);
    assert.ok(!('error' in res), 'error' in res ? res.error : '');
  }
  seeded = true;
};

test('Quick race: My tracks lists circuits only, the Platformer tab lists courses only', () => {
  // The picker reads My tracks itself, so seed the store it reads.
  seedStore();
  const props = {
    onSub: noop, circuitIndex: 0, onCircuit: noop, seed: 11, onNewSeed: noop,
    roster: [{ id: 0, name: 'You', color: '#d63e2e', stats: { weight: 5, speed: 5, bounce: 5 }, isPlayer: true }],
    customTrackId: null, onSelectCustom: noop, onWorkshop: noop,
  };
  const mine = renderToStaticMarkup(createElement(TrackPicker, { ...props, sub: 'mine' }));
  assert.ok(mine.includes('Screw City'), 'the circuit is missing from My tracks');
  assert.ok(!mine.includes('Hill Course'), 'a course showed up in the classic My tracks list');

  const platformer = renderToStaticMarkup(createElement(TrackPicker, { ...props, sub: 'platformer' }));
  assert.ok(platformer.includes('Hill Course'), 'My courses is missing from the Platformer tab');
  assert.ok(!platformer.includes('Screw City'), 'a circuit showed up in the Platformer tab');
  assert.ok(platformer.includes('Community courses'), 'the community courses are not listed on the Platformer tab');
});

test('the Workshop landing page counts circuits and courses apart, and badges the courses', () => {
  seedStore();
  const html = renderToStaticMarkup(createElement(WorkshopTab, {
    onOpenEditor: noop, onBrowseCommunity: noop, newTrackOpen: false, onNewTrackClose: noop,
  }));
  assert.ok(html.includes('1 CIRCUIT • 1 COURSE'), 'the header does not count circuits and courses');
  assert.ok(html.includes('Hill Course'), 'the course is missing from the Workshop list');
  assert.ok(html.includes('Screw City'), 'the circuit is missing from the Workshop list');
  assert.ok(html.includes('>PLATFORMER<'), 'the course has no badge');
  assert.ok(html.includes('workshop-kind-filter'), 'the list cannot be narrowed to one kind');
});
