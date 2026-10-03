// P2-14: story voice-over. Every story line maps to a voice id, the manifest on disk matches the script, every
// speaker is in the voice cast, and moods become performance tags that the caption strips again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENES } from '../src/game/story/outline';
import { storyVoiceId, storyVoiceManifest, storyVoiceSpeaker } from '../src/game/story/voice-lines';
import { subtitleText } from '../src/game/voice';

const cast = JSON.parse(readFileSync(new URL('../src/voice/cast.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const onDisk = JSON.parse(readFileSync(new URL('../src/voice/manifests/story.json', import.meta.url), 'utf8')) as unknown[];

test('every story speaker has a voice in the cast', () => {
  const missing = new Set<string>();
  for (const scene of SCENES) for (const line of scene.lines) {
    const speaker = storyVoiceSpeaker(line.who);
    if (!speaker || !cast[speaker]) missing.add(line.who);
  }
  assert.deepEqual([...missing], []);
});

test('voice ids are kebab-case and unique', () => {
  const ids = storyVoiceManifest(SCENES).map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  assert.equal(storyVoiceId('Ch1_Intro', 3), 'ch1-intro-3');
});

test('story.json is up to date with the script (run scripts/voice/story-manifest.mjs)', () => {
  assert.deepEqual(onDisk, storyVoiceManifest(SCENES));
});

test('mood tags never reach the caption: the caption of every voiced line is the script line', () => {
  const texts = SCENES.flatMap((scene) => scene.lines.map((line) => line.text.trim()));
  for (const entry of storyVoiceManifest(SCENES)) assert.ok(texts.includes(subtitleText(entry.text)), entry.id);
});
