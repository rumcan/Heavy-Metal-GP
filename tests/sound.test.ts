// Run with: node --import tsx --test tests/sound.test.ts
// The owner's sound pass: generated music on a radio that follows the game, recorded sound effects (with the synth as
// the fallback), a race announcer. The manifest is the one list of every generated sound: the code may only ask for
// sounds that are in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import manifest from '../src/game/sound/manifest.json';
import { PREWARM, RECORDED, UI_FILE } from '../src/game/audio';
import { ITEM_TYPES } from '../src/game/types';
import { audioUrl } from '../src/game/sound/bank';
import { DIAL, RADIO_DEFAULTS, SCENE_STATION, STATIONS, playlistFor, readRadioSettings, stationFor, stepDial } from '../src/game/sound/radio';
import { GAP_MS, TAKES, decide, newAnnouncerMemory, pickTake } from '../src/game/sound/announcer';
import type { RaceFrame } from '../src/game/sound/announcer';

const sfx = new Set(manifest.sfx.map((s) => s.id));

test('manifest: unique ids, every sound has a prompt and a duration the CLI accepts', () => {
  const all = [...manifest.music, ...manifest.stingers, ...manifest.sfx].map((e) => e.id);
  assert.equal(new Set(all).size, all.length);
  for (const m of manifest.music) assert.ok(m.prompt.length > 40 && m.duration >= 3 && m.duration <= 300, m.id);
  for (const s of manifest.stingers) assert.ok(s.duration >= 3 && s.duration <= 300, s.id);
  for (const s of manifest.sfx) assert.ok(s.duration >= 0.5 && s.duration <= 30, s.id);
});

test('every recorded sound the engine asks for is in the manifest', () => {
  for (const [type, r] of Object.entries(RECORDED)) for (const id of r!.ids) assert.ok(sfx.has(id), `${type}: ${id}`);
  for (const id of PREWARM) assert.ok(sfx.has(id), id);
  for (const [ui, f] of Object.entries(UI_FILE)) assert.ok(sfx.has(f.id), `${ui}: ${f.id}`);
  for (const id of ['land-soft', 'land-hard', 'roll-loop', 'wind-loop', 'engine-loop', 'crowd-loop', 'amb-forest', 'amb-night', 'amb-sky']) assert.ok(sfx.has(id), id);
});

test('every skill has its own sound', () => {
  for (const item of ITEM_TYPES) assert.ok(sfx.has(`skill-${item}`), item);
});

test('the radio: four stations with music, Auto follows the scene, a held station stays everywhere', () => {
  assert.deepEqual(STATIONS.map((s) => s.id), ['grid', 'infinity', 'pit', 'story']);
  for (const s of STATIONS) assert.ok(s.tracks.length >= 3, `${s.id} has tracks`);
  assert.equal(stationFor({ ...RADIO_DEFAULTS }, 'race'), 'grid');
  assert.equal(stationFor({ ...RADIO_DEFAULTS }, 'infinity'), 'infinity');
  assert.equal(stationFor({ ...RADIO_DEFAULTS }, 'menu'), 'pit');
  assert.equal(stationFor({ ...RADIO_DEFAULTS, station: 'grid' }, 'menu'), 'grid');
  for (const scene of Object.keys(SCENE_STATION) as (keyof typeof SCENE_STATION)[]) assert.ok(STATIONS.some((s) => s.id === SCENE_STATION[scene]));
  assert.equal(stepDial('auto', 1), DIAL[1]);
  assert.equal(stepDial('auto', -1), DIAL[DIAL.length - 1]);
  assert.ok(playlistFor('infinity', true).every((t) => t.mood === 'night') && playlistFor('infinity', true).length > 0);
  assert.ok(playlistFor('infinity', false).every((t) => t.mood === 'day') && playlistFor('infinity', false).length > 0);
  // Infinity by day follows the biome: every biome with a track of its own gets only those
  assert.ok(playlistFor('infinity', false, 'snow').every((t) => t.biomes?.includes('snow')));
  assert.deepEqual(playlistFor('infinity', true, 'snow'), playlistFor('infinity', true), 'the night tracks after dark, whatever the biome');
  assert.ok(playlistFor('infinity', false, 'no-such-biome').length >= 4, 'an untagged biome plays any day track');
    assert.ok(STATIONS[0].tracks[0].url.endsWith(`audio/music/${STATIONS[0].tracks[0].id}.mp3`));
});

test('radio settings: defaults, a broken save, and a volume out of range', () => {
  assert.deepEqual(readRadioSettings(null), RADIO_DEFAULTS);
  assert.deepEqual(readRadioSettings('not json'), RADIO_DEFAULTS);
  assert.deepEqual(readRadioSettings(JSON.stringify({ enabled: false, volume: 4, station: 'nope' })), { enabled: false, volume: 1, station: 'auto' });
  assert.equal(readRadioSettings(JSON.stringify({ station: 'infinity' })).station, 'infinity');
});

test('sounds ship next to the page (relative urls, never inlined)', () => {
  assert.ok(/(^|\/)audio\/sfx\/ui-click\.mp3$/.test(audioUrl('sfx', 'ui-click')));
});

const frame = (f: Partial<RaceFrame>): RaceFrame => ({ time: 0, started: false, rank: 5, field: 10, progress: 0, kos: 0, hp: 100, maxHp: 100, healthOn: true, finished: false, dnf: false, airMs: 0, pickup: false, ...f });

test('announcer: the start, taking the lead (not in the opening shuffle), and a pause between calls', () => {
  const mem = newAnnouncerMemory();
  assert.equal(decide(mem, frame({})), null, 'the first frame only sets the scene');
  assert.equal(decide(mem, frame({ started: true, time: 100 })), 'start');
  assert.equal(decide(mem, frame({ started: true, time: 1500, rank: 1 })), null, 'the grid is still sorting itself out');
  decide(mem, frame({ started: true, time: 5000, rank: 2 }));
  assert.equal(decide(mem, frame({ started: true, time: 5200, rank: 1 })), 'lead');
  decide(mem, frame({ started: true, time: 5300, rank: 2 }));
  assert.equal(decide(mem, frame({ started: true, time: 5400, rank: 2, progress: 0.5 })), null, `quiet for ${GAP_MS} ms after a call`);
  assert.equal(decide(mem, frame({ started: true, time: 9500, rank: 2, progress: 0.86 })), 'final');
});

test('announcer: a finish and a knock-out cut in at once; each is called once', () => {
  const mem = newAnnouncerMemory();
  decide(mem, frame({ started: true, time: 10000 }));
  assert.equal(decide(mem, frame({ started: true, time: 10100, kos: 1 })), 'ko');
  assert.equal(decide(mem, frame({ started: true, time: 10200, kos: 1, finished: true, rank: 2 })), 'podium', 'a finish cuts in');
  assert.equal(decide(mem, frame({ started: true, time: 30000, kos: 1, finished: true, rank: 2 })), null);
  const out = newAnnouncerMemory();
  decide(out, frame({ started: true, time: 1000 }));
  assert.equal(decide(out, frame({ started: true, time: 1100, dnf: true })), 'out');
});

test('announcer takes: every call has one, and a call never repeats the take it just used', () => {
  for (const call of ['start', 'lead', 'overtaken', 'half', 'final', 'ko', 'out', 'lowhp', 'win', 'podium', 'finish', 'air', 'trial'] as const) {
    assert.ok((TAKES[call]?.length ?? 0) > 0, call);
    for (const id of TAKES[call]) assert.ok((manifest as { announcer: { id: string }[] }).announcer.some((l) => l.id === id));
  }
  const first = pickTake('start', null, () => 0)!;
  for (let i = 0; i < 20; i++) assert.notEqual(pickTake('start', first, Math.random), first);
});
