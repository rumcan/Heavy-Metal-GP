// Builds src/voice/manifests/workshop.json from the Workshop tour. Run: node --import tsx scripts/voice/workshop-manifest.mjs
// Then: node scripts/voice/generate.mjs --set workshop --dry-run
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tourVoiceManifest } from '../../src/components/editor/tour/steps.ts';

const lines = tourVoiceManifest();
const file = fileURLToPath(new URL('../../src/voice/manifests/workshop.json', import.meta.url));
writeFileSync(file, `${JSON.stringify(lines, null, 2)}\n`);
console.log(`workshop.json: ${lines.length} lines, ${lines.reduce((n, l) => n + l.text.length, 0)} characters`);
