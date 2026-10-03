// Builds src/voice/manifests/story.json from the story script. Run: node --import tsx scripts/voice/story-manifest.mjs
// Then: node scripts/voice/generate.mjs --set story --dry-run
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCENES } from '../../src/game/story/outline.ts';
import { storyVoiceManifest } from '../../src/game/story/voice-lines.ts';

const lines = storyVoiceManifest(SCENES);
const file = fileURLToPath(new URL('../../src/voice/manifests/story.json', import.meta.url));
writeFileSync(file, `${JSON.stringify(lines, null, 2)}\n`);
console.log(`story.json: ${lines.length} lines, ${lines.reduce((n, l) => n + l.text.length, 0)} characters`);
