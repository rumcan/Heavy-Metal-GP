import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENES } from '../src/game/story/outline.js';
import { CAST } from '../src/game/story/cast.js';
import { CALENDAR } from '../src/game/season.js';

// Known gaps where the story currently breaks the introduction rules.
// Add offending speaker IDs or chapter numbers here to skip them until fixed.
let KNOWN_GAPS = {
  characters: [] as string[], // CastId
  tracks: [] as number[],     // Chapter number (1-based)
};

function normalizeName(name: string): string {
  let n = name.trim();
  if (n.toLowerCase().startsWith('the ')) {
    n = n.slice(4);
  }
  const words = n.split(/\s+/);
  return words[words.length - 1].toLowerCase();
}

function wordsMatch(text: string, target: string): boolean {
  const t = text.toLowerCase();
  const targets = target.toLowerCase().split(/\s+/);
  return targets.some(w => t.includes(w));
}

function getCastName(castId: string): string | undefined {
  if (castId === 'hood-revealed') return CAST['hood']?.name;
  return CAST[castId as keyof typeof CAST]?.name;
}

test('story-intros: characters are introduced in the scene where they first speak (or earlier)', () => {
  // A name counts when its distinctive word appears ('Gutwrench', 'Grubba', 'Hood'), never 'the' or 'old'.
  const scenes = [...SCENES].filter((s) => !s.ending).sort((a, b) => a.chapter - b.chapter);
  const seen = new Set<string>();
  let story = '';
  for (const scene of scenes) {
    const sceneText = scene.lines.map((l) => l.text).join(' ').toLowerCase();
    for (const line of scene.lines) {
      const who = line.who === 'hood-revealed' ? 'hood' : line.who;
      if (seen.has(who)) continue;
      seen.add(who);
      const castName = getCastName(who);
      if (!castName || KNOWN_GAPS.characters.includes(who)) continue;
      const key = normalizeName(castName);
      assert.ok(
        story.includes(key) || sceneText.includes(key),
        `${castName} speaks in ${scene.id} but '${key}' is never said there or earlier.`,
      );
    }
    story += ` ${sceneText}`;
  }
});

test('story-intros: tracks are named before they are raced', () => {
  for (let chapter = 1; chapter <= 6; chapter++) {
    const track = CALENDAR[chapter - 1];
    if (!track) continue;

    if (KNOWN_GAPS.tracks.includes(chapter)) continue;

    const relevantScenes = SCENES.filter(s => {
      if (s.ending) return false;
      if (s.chapter === chapter && (s.trigger === 'intro' || s.trigger === 'pre-race')) return true;
      if (s.chapter === chapter - 1 && s.trigger === 'outro') return true;
      return false;
    });

    const combinedText = relevantScenes.flatMap(s => s.lines).map(l => l.text).join(' ');

    assert(
      wordsMatch(combinedText, track.short.split(' ')[0]),
      `Track '${track.short}' (${track.name}) for chapter ${chapter} is not named in its intro/pre-race or previous outro scenes.`
    );
  }
});
