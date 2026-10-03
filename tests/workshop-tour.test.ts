// P2-15: the Workshop tour. Nine steps in the ticket's order, each pointing at a control the Workshop really has,
// voiced by Zapp from a manifest that matches the steps, captions without voice tags, and action steps move on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOUR_SPEAKER, TOUR_STEPS, tourAutoAdvance, tourCaption, tourVoiceManifest } from '../src/components/editor/tour/steps';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the tour covers the ticket in order', () => {
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), ['new', 'palette', 'edit', 'settings', 'test', 'validate', 'save', 'publish', 'play']);
});

test('every spotlight target exists in the Workshop', () => {
  const editor = read('../src/components/TrackEditor.tsx');
  for (const step of TOUR_STEPS) {
    for (const target of step.target?.split(' ') ?? []) assert.ok(editor.includes(`data-coach="${target}"`), `${step.id}: no data-coach="${target}"`);
  }
});

test('workshop.json matches the steps and Zapp is in the voice cast', () => {
  assert.deepEqual(JSON.parse(read('../src/voice/manifests/workshop.json')), tourVoiceManifest());
  assert.ok(JSON.parse(read('../src/voice/cast.json'))[TOUR_SPEAKER]);
  const chars = tourVoiceManifest().reduce((n, l) => n + l.text.length, 0);
  assert.ok(chars < 2000, `${chars} characters is over the 2,000 credit cap`);
});

test('captions drop the voice tags and stay short enough for a phone card', () => {
  for (const step of TOUR_STEPS) {
    const caption = tourCaption(step);
    assert.ok(!caption.includes('['), step.id);
    assert.ok(caption.length <= 220, `${step.id} caption is ${caption.length} characters`);
  }
});

test('test drive and a passing validation move the tour on; other steps wait for Next', () => {
  const at = (id: string) => TOUR_STEPS.findIndex((s) => s.id === id);
  assert.equal(tourAutoAdvance(at('test'), { testing: true, valid: false }), at('test') + 1);
  assert.equal(tourAutoAdvance(at('test'), { testing: false, valid: true }), at('test'));
  assert.equal(tourAutoAdvance(at('validate'), { testing: false, valid: true }), at('validate') + 1);
  assert.equal(tourAutoAdvance(at('palette'), { testing: true, valid: true }), at('palette'));
});
