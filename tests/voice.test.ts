/**
 * P2-03 — voice: the casting data, the generator's cache and the player's fallbacks.
 *
 * Three groups:
 *  1. DATA — the shipped cast and manifests are valid, and every committed generated entry
 *     still matches the hash of the line it was made from (so a text edit can't ship stale audio).
 *  2. GENERATOR — `scripts/voice/generate.mjs`: dry run costs nothing, a real run calls the CLI
 *     once per new line, a second run calls it zero times, `--force` regenerates one line and
 *     the credit cap refuses an expensive run. The CLI is a stub on PATH, so no credits are spent.
 *  3. PLAYER — `src/game/voice.ts` in Node (no DOM): a line with no mp3 still shows its subtitle
 *     and resolves, a newer line interrupts the old one, a mute cuts the audio, and the volume
 *     and on/off switch round-trip through storage.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as generate from '../scripts/voice/generate.mjs';
import { raceAudio } from '../src/game/audio';
import { getItem, removeItem, setItem, STORAGE_KEYS } from '../src/game/storage';
import {
  DEFAULT_VOICE_SETTINGS, VOICE_STORAGE_KEY, currentVoice, getVoiceSettings, holdMsFor, parseVoiceSettings,
  planVoice, playVoice, registerVoiceSet, resetVoiceForTests, setVoiceEnabled, setVoiceVolume, speakerName,
  stopVoice, subscribeVoice, subtitleText, voiceCast, voiceLines,
} from '../src/game/voice';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATE = path.join(ROOT, 'scripts', 'voice', 'generate.mjs');
const CAST = JSON.parse(readFileSync(path.join(ROOT, 'src/voice/cast.json'), 'utf8'));
const MANIFEST_DIR = path.join(ROOT, 'src/voice/manifests');

const readManifest = (set: string) => JSON.parse(readFileSync(path.join(MANIFEST_DIR, `${set}.json`), 'utf8'));
const sets = readdirSync(MANIFEST_DIR).filter((name) => name.endsWith('.json')).map((name) => name.replace(/\.json$/, ''));

// ────────────────────────────── 1. data ──────────────────────────────

test('voice: every speaker in the cast has a voice id and usable settings', () => {
  const speakers = Object.keys(CAST);
  assert.ok(speakers.length >= 11, `${speakers.length} speakers cast`);
  for (const [id, entry] of Object.entries<Record<string, { name: string; voiceId: string; stability: number; speed: number; style: string }>>(CAST)) {
    assert.match(id, /^[a-z0-9-]+$/, `${id} is kebab-case`);
    assert.ok(entry.name?.trim(), `${id} has a display name for the caption strip`);
    assert.ok(entry.voiceId?.trim(), `${id} has a voice id`);
    assert.ok(entry.stability > 0 && entry.stability <= 1, `${id} stability is a 0..1 number`);
    assert.ok(entry.speed >= 0.7 && entry.speed <= 1.2, `${id} speed is in the CLI's range`);
    assert.ok(entry.style?.trim(), `${id} has a performance note`);
  }
});

test('voice: every shipped manifest matches the schema the generator and the player expect', () => {
  assert.ok(sets.length, 'at least one manifest set ships');
  for (const set of sets) {
    const lines = readManifest(set);
    assert.deepEqual(generate.validateManifest(set, lines, CAST), [], `${set} validates`);
    assert.ok(lines.length, `${set} is not empty`);
  }
  assert.ok(sets.includes('samples'), 'the P2-03 sample set ships');
  const samples = readManifest('samples');
  assert.equal(samples.length, 3, 'exactly the 3 sample lines the ticket pays for');
  assert.deepEqual(samples.map((line: { speaker: string }) => line.speaker), ['narrator', 'sprocket', 'duchess-vex']);
});

test('voice: the validator names every way a manifest can be wrong', () => {
  const problems = generate.validateManifest('broken', [
    { id: 'ok', speaker: 'narrator', text: 'fine' },
    { id: 'ok', speaker: 'narrator', text: 'duplicate id' },
    { id: 'Bad Id', speaker: 'narrator', text: 'not kebab-case' },
    { id: 'ghost', speaker: 'nobody', text: 'unknown speaker' },
    { id: 'empty', speaker: 'sprocket', text: '   ' },
    'not an object',
  ], CAST);
  assert.equal(problems.length, 5, problems.join(' | '));
  assert.ok(problems.some((problem: string) => /duplicate/.test(problem)));
  assert.ok(problems.some((problem: string) => /kebab/.test(problem)));
  assert.ok(problems.some((problem: string) => /cast/.test(problem)));
  assert.ok(problems.some((problem: string) => /empty/.test(problem)));
  assert.ok(problems.some((problem: string) => /not an object/.test(problem)));
  assert.deepEqual(generate.validateManifest('broken', { nope: true }, CAST), ['broken: manifest must be an array of { id, speaker, text }']);
});

test('voice: committed audio is never stale — every generated hash matches its manifest line', () => {
  for (const set of sets) {
    const lines = readManifest(set);
    const generated = JSON.parse(readFileSync(path.join(ROOT, 'src/voice/generated', `${set}.json`), 'utf8'));
    for (const line of lines) {
      const entry = generated[line.id];
      if (!entry) continue; // nothing generated yet: the player falls back to the subtitle
      const mode = entry.remote ? { remote: true } : {};
      assert.equal(entry.hash, generate.hashLine(line.text, CAST, line.speaker, mode), `${set}/${line.id} hash is current`);
      if (!entry.remote) {
        assert.ok(entry.file, `${set}/${line.id} names its file`);
        assert.ok(existsSync(path.join(ROOT, 'src/assets/voice', entry.file)), `${set}/${line.id} audio exists at ${entry.file}`);
      }
      assert.ok(entry.durationSec >= 0, `${set}/${line.id} duration`);
    }
    const ids = lines.map((line: { id: string }) => line.id);
    for (const id of Object.keys(generated)) assert.ok(ids.includes(id), `${set}/${id} is still in the manifest`);
  }
});

// ────────────────────────────── 2. generator ──────────────────────────────

test('voice: the same line and settings always hash the same, and anything audible changes the hash', () => {
  const text = readManifest('samples')[0].text;
  const base = generate.hashLine(text, CAST, 'narrator');
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(base, generate.hashLine(text, CAST, 'narrator'), 'stable across calls');
  assert.notEqual(base, generate.hashLine(`${text}!`, CAST, 'narrator'), 'text');
  assert.notEqual(base, generate.hashLine(text, CAST, 'sprocket'), 'speaker');
  assert.notEqual(base, generate.hashLine(text, CAST, 'narrator', { model: 'eleven_multilingual_v2' }), 'model');
  assert.notEqual(base, generate.hashLine(text, CAST, 'narrator', { remote: true }), 'bundled vs remote');
  const slower = { ...CAST, narrator: { ...CAST.narrator, speed: 0.9 } };
  assert.notEqual(base, generate.hashLine(text, slower, 'narrator'), 'a cast setting change');
  assert.equal(generate.estimateCredits('12345', CAST, 'narrator'), 5);
});

test('voice: the dry run prints the line count, the cost estimate and the cap, and writes nothing', () => {
  const before = readFileSync(path.join(ROOT, 'src/voice/generated/samples.json'), 'utf8');
  const run = spawnSync(process.execPath, [GENERATE, '--set', 'samples', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /3 lines in samples, 3 to generate, 0 cached/);
  assert.match(run.stdout, /Estimated cost: ≈\d+ credits for 3 new lines \(cap 1000\)/);
  assert.match(run.stdout, /narrator-welcome\s+narrator/);
  assert.match(run.stdout, /nothing was synthesized and nothing was written/i);
  assert.equal(readFileSync(path.join(ROOT, 'src/voice/generated/samples.json'), 'utf8'), before, 'the generated map is untouched');
  assert.ok(!existsSync(path.join(ROOT, 'src/assets/voice/samples')), 'no audio directory was created');
});

/** A `rundot` stand-in: writes a ~1 KB fake mp3 (its payload varies per call) and prints the CLI's JSON. */
const STUB = `
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2);
const value = (flag) => { const at = argv.indexOf(flag); return at >= 0 ? argv[at + 1] : ''; };
if (argv[0] === 'whoami') { console.log(JSON.stringify({ player: 'voice-test' })); process.exit(0); }
if (argv[0] === 'generate' && argv[1] === 'tts') {
  const counter = process.env.HMGP_VOICE_STUB_COUNT;
  let call = 1;
  if (counter) { appendFileSync(counter, 'x'); call = statSync(counter).size; }
  const out = value('--out');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(900, call % 251)]));
  console.log(JSON.stringify({ url: 'https://example.test/voice/' + path.basename(out), durationSec: 3.2, credits: 41 }));
  process.exit(0);
}
process.exit(2);
`;

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'hmgp-voice-'));
  cpSync(path.join(ROOT, 'src', 'voice'), path.join(root, 'src', 'voice'), { recursive: true });
  mkdirSync(path.join(root, 'src', 'assets', 'voice'), { recursive: true });
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  const stub = path.join(bin, 'rundot-stub.mjs');
  writeFileSync(stub, STUB);
  const cli = process.platform === 'win32' ? path.join(bin, 'rundot.cmd') : path.join(bin, 'rundot');
  if (process.platform === 'win32') writeFileSync(cli, `@echo off\r\nnode "${stub}" %*\r\n`);
  else { writeFileSync(cli, `#!/usr/bin/env node\n${STUB}`); chmodSync(cli, 0o755); }
  const counter = path.join(root, 'calls.txt');
  writeFileSync(counter, '');
  return {
    root, cli, counter,
    calls: () => statSync(counter).size,
    run: (...args: string[]) => spawnSync(process.execPath, [GENERATE, '--root', root, '--cli', cli, ...args], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, HMGP_VOICE_STUB_COUNT: counter },
    }),
    generated: () => JSON.parse(readFileSync(path.join(root, 'src/voice/generated/samples.json'), 'utf8')),
    audio: (id: string) => path.join(root, 'src/assets/voice/samples', `${id}.mp3`),
  };
}

test('voice generator: a real run makes the 3 samples, a second run calls the CLI zero times', () => {
  const test_ = fixture();
  try {
    const first = test_.run('--set', 'samples');
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(test_.calls(), 3, 'one CLI call per new line');
    for (const id of ['narrator-welcome', 'sprocket-hello', 'vex-taunt']) assert.ok(existsSync(test_.audio(id)), `${id}.mp3 exists`);

    const map = test_.generated();
    assert.deepEqual(Object.keys(map), ['narrator-welcome', 'sprocket-hello', 'vex-taunt'], 'manifest order');
    for (const [id, entry] of Object.entries<{ file: string; hash: string; durationSec: number }>(map)) {
      assert.equal(entry.file, `samples/${id}.mp3`);
      assert.equal(entry.hash, generate.hashLine(readManifest('samples').find((line: { id: string }) => line.id === id).text, CAST, id === 'vex-taunt' ? 'duchess-vex' : id === 'sprocket-hello' ? 'sprocket' : 'narrator'));
      assert.equal(entry.durationSec, 3.2, 'the CLI duration is kept for the caption timer');
      assert.ok(statSync(test_.audio(id)).size > 4);
    }
    assert.match(first.stdout, /Synthesized 3 lines — ≈123 credits/);

    const before = ['narrator-welcome', 'sprocket-hello', 'vex-taunt'].map((id) => readFileSync(test_.audio(id)));
    const second = test_.run('--set', 'samples');
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(test_.calls(), 3, 'the cache stopped every call');
    assert.match(second.stdout, /3 lines in samples are cached|Nothing to do/);
    assert.deepEqual(['narrator-welcome', 'sprocket-hello', 'vex-taunt'].map((id) => readFileSync(test_.audio(id))), before, 'nothing was rewritten');
  } finally { rmSync(test_.root, { recursive: true, force: true }); }
});

test('voice generator: --force regenerates exactly one line, and a text edit invalidates it again', () => {
  const test_ = fixture();
  try {
    assert.equal(test_.run('--set', 'samples').status, 0);
    const untouched = readFileSync(test_.audio('narrator-welcome'));
    assert.equal(test_.run('--set', 'samples', '--force', 'sprocket-hello').status, 0);
    assert.equal(test_.calls(), 4, 'only the forced line was re-synthesized');
    assert.equal(readFileSync(test_.audio('narrator-welcome')).equals(untouched), true, 'the other lines were not touched');

    const manifestFile = path.join(test_.root, 'src/voice/manifests/samples.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    manifest.find((line: { id: string }) => line.id === 'vex-taunt').text = 'A different taunt, darling.';
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    const edited = test_.run('--set', 'samples');
    assert.equal(test_.calls(), 5, 'an edited line is new again — its hash changed');
    assert.match(edited.stdout, /Synthesized 1 line/);
  } finally { rmSync(test_.root, { recursive: true, force: true }); }
});

test('voice generator: --remote records the hosted url instead of an mp3', () => {
  const test_ = fixture();
  try {
    const run = test_.run('--set', 'samples', '--remote');
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const map = test_.generated();
    for (const entry of Object.values<{ file?: string; remote?: string }>(map)) {
      assert.match(entry.remote ?? '', /^https:\/\/example\.test\/voice\//);
      assert.equal(entry.file, undefined, 'remote mode bundles nothing');
    }
    assert.ok(!existsSync(test_.audio('narrator-welcome')), 'no mp3 on disk in remote mode');

    // Switching modes changes the hash, so the bundle is built properly later: the cache is per mode.
    assert.equal(test_.run('--set', 'samples').status, 0);
    assert.equal(test_.calls(), 6, '3 remote + 3 bundled');
    assert.ok(existsSync(test_.audio('narrator-welcome')));
  } finally { rmSync(test_.root, { recursive: true, force: true }); }
});

test('voice generator: the credit cap refuses a run before it spends anything', () => {
  const test_ = fixture();
  try {
    const run = test_.run('--set', 'samples', '--cap', '10');
    assert.notEqual(run.status, 0);
    assert.match(`${run.stdout}${run.stderr}`, /refusing to spend/);
    assert.equal(test_.calls(), 0, 'the CLI was never asked to synthesize');
    assert.ok(!existsSync(test_.audio('narrator-welcome')));
  } finally { rmSync(test_.root, { recursive: true, force: true }); }
});

test('voice generator: unknown sets and flags fail loudly', () => {
  const missing = spawnSync(process.execPath, [GENERATE, '--set', 'nope'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(`${missing.stdout}${missing.stderr}`, /no manifest/);
  const unknown = spawnSync(process.execPath, [GENERATE, '--set', 'samples', '--wat'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(unknown.status, 0);
  assert.match(`${unknown.stdout}${unknown.stderr}`, /unknown option/);
});

// ────────────────────────────── 3. player ──────────────────────────────

const line = (id: string, text = 'Roll on, goblin.') => ({ id, speaker: 'sprocket', text });

beforeEach(() => {
  resetVoiceForTests();
  raceAudio.setMuted(false);
  removeItem(VOICE_STORAGE_KEY);                       // each test starts from the defaults
});
after(() => { resetVoiceForTests(); raceAudio.setMuted(false); });

test('voice player: the cast names the caption, and unknown speakers are not a crash', () => {
  assert.equal(speakerName('sprocket'), 'Sprocket');
  assert.equal(speakerName('duchess-vex'), 'Duchess Vex');
  assert.equal(speakerName('someone-new'), 'someone-new');
});

test('voice player: performance tags direct the voice but never reach the caption', () => {
  assert.equal(subtitleText('[excited] Ten goblins. One mine shaft.'), 'Ten goblins. One mine shaft.');
  assert.equal(subtitleText('Oi! [laughs] Let us roll.'), 'Oi! Let us roll.');
  assert.equal(subtitleText('[dramatic pause] ...as foretold.'), '...as foretold.');
  assert.equal(subtitleText('Nothing bracketed here.'), 'Nothing bracketed here.');
  assert.equal(subtitleText('[a]'), '[a]', 'a lone bracketed word is left alone rather than blanked');
});

test('voice player: a line with no audio plays as a subtitle only, and still resolves', async () => {
  registerVoiceSet('unit', [line('no-audio', 'Hi.')]);
  assert.equal(planVoice('unit', 'no-audio')?.source, null, 'no generated entry → no source');
  const subscriber = [];
  const unsubscribe = subscribeVoice(() => subscriber.push(currentVoice().line?.id ?? null));

  const played = playVoice('unit', 'no-audio');
  assert.equal(currentVoice().line?.id, 'no-audio');
  assert.equal(currentVoice().name, 'Sprocket');
  assert.equal(currentVoice().active, true);
  await played;                                        // resolves on its own after the reading time
  assert.equal(currentVoice().line, null, 'the caption clears');
  assert.deepEqual(subscriber, ['no-audio', null]);
  unsubscribe();
});

test('voice player: audio is only requested when a source exists, a newer line cuts the old one', async () => {
  let loads = 0;
  registerVoiceSet('unit', [line('first'), line('second')], {
    generated: { first: { file: 'unit/first.mp3' }, second: { remote: 'https://example.test/second.mp3' } },
    audio: { first: async () => { loads++; return 'data:audio/mpeg;base64,AAAA'; } },
  });
  assert.equal(planVoice('unit', 'first')?.source?.kind, 'local');
  assert.equal(planVoice('unit', 'second')?.source?.kind, 'remote');
  assert.equal(planVoice('unit', 'ghost'), null, 'an unknown line has no plan');

  const first = playVoice('unit', 'first');
  assert.equal(currentVoice().line?.id, 'first');
  const second = playVoice('unit', 'second');
  assert.equal(currentVoice().line?.id, 'second', 'the new line took over');
  await first;                                         // the interrupted line resolves, it does not hang
  assert.equal(loads, 1, 'the first line did ask for its audio');
  stopVoice();
  await second;
  assert.equal(currentVoice().line, null);
});

test('voice player: a muted game (M) cuts the line and never loads the audio', async () => {
  let loads = 0;
  registerVoiceSet('unit', [line('muted-line', 'Hi.')], {
    generated: { 'muted-line': { file: 'unit/muted-line.mp3' } },
    audio: { 'muted-line': async () => { loads++; return 'data:audio/mpeg;base64,AAAA'; } },
  });
  raceAudio.setMuted(true);
  const played = playVoice('unit', 'muted-line');
  assert.equal(currentVoice().line?.id, 'muted-line', 'the caption still plays');
  await played;
  assert.equal(loads, 0, 'nothing was fetched while muted');
  raceAudio.setMuted(false);
  const audible = playVoice('unit', 'muted-line');
  assert.equal(loads, 1, 'unmuting brings the audio back');
  await audible;
});

test('voice player: voice off is a setting, not an error', async () => {
  setVoiceEnabled(false);
  assert.equal(getVoiceSettings().enabled, false);
  assert.equal(JSON.parse(getItem(VOICE_STORAGE_KEY) ?? '{}').enabled, false);
  let loads = 0;
  registerVoiceSet('unit', [line('off', 'Hi.')], {
    generated: { off: { file: 'unit/off.mp3' } },
    audio: { off: async () => { loads++; return 'data:audio/mpeg;base64,AAAA'; } },
  });
  await playVoice('unit', 'off');
  assert.equal(loads, 0, 'switched off means no audio');
  setVoiceEnabled(true);
  assert.equal(getVoiceSettings().enabled, true);
});

test('voice player: volume and on/off round-trip through RUN storage', () => {
  assert.deepEqual(getVoiceSettings(), DEFAULT_VOICE_SETTINGS);
  setVoiceVolume(0.25);
  assert.equal(getVoiceSettings().volume, 0.25);
  assert.equal(JSON.parse(getItem(VOICE_STORAGE_KEY) ?? '{}').volume, 0.25);
  setVoiceVolume(2);                                   // clamped, never a broken element volume
  assert.equal(getVoiceSettings().volume, 1);
  assert.deepEqual(parseVoiceSettings('not json'), DEFAULT_VOICE_SETTINGS);
  assert.deepEqual(parseVoiceSettings('{"volume":-4,"enabled":"nope"}'), { enabled: true, volume: 0 });
  assert.ok(STORAGE_KEYS.includes(VOICE_STORAGE_KEY), 'the key is registered for boot preload');
  setItem(VOICE_STORAGE_KEY, '');
  assert.equal(parseVoiceSettings(getItem(VOICE_STORAGE_KEY)).volume, DEFAULT_VOICE_SETTINGS.volume);
});

test('voice player: the caption hold is the audio duration when there is one, a reading time otherwise', () => {
  assert.equal(holdMsFor('whatever', 3.2), 3200);
  assert.ok(holdMsFor('Hi.') >= 900, 'a one-word line still gets a readable beat');
  assert.ok(holdMsFor('x'.repeat(400)) <= 15_000, 'a broken manifest cannot hold a promise open forever');
  assert.ok(holdMsFor('x'.repeat(140)) > holdMsFor('x'.repeat(20)), 'longer text, longer hold');
});

test('voice player: the shipped sample set reaches the player through the manifest registry', () => {
  registerVoiceSet('samples', readManifest('samples'), { generated: {} });
  assert.equal(voiceLines('samples').length, 3);
  assert.equal(planVoice('samples', 'vex-taunt')?.name, 'Duchess Vex');
  assert.equal(planVoice('samples', 'vex-taunt')?.source, null, 'generated/ is still empty: the caption is the fallback');
});
