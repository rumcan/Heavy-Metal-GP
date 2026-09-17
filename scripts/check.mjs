import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(new URL('../tests/artifacts/', import.meta.url), { recursive: true });
const commands = [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['--import', 'tsx', '--test', '--test-concurrency=3', '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=tap', '--test-reporter-destination=tests/artifacts/latest-test-run.tap', 'tests/physics.test.ts', 'tests/economy.test.ts', 'tests/multiplayer.test.ts', 'tests/browser.test.ts',
    // Story mode (ST-01..ST-08): schema, engine and chapter modifiers. Pure node — they stub their own DOM.
    'tests/story-schema.test.ts', 'tests/story-engine.test.ts', 'tests/story-modifiers.test.ts',
    // Map builder (MB-01): the track definition format — recording, rebuild identity, validation.
    'tests/trackdef.test.ts'],
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', timeout: 420000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}