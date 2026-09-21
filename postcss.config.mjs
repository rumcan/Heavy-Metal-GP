import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Quality gate for the supplied build pipeline, without modifying its npm or Vite config.
// No CSS is changed by this config. Dev-server startup does not run the test suite.
if (process.env.npm_lifecycle_event === 'build') {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./scripts/check.mjs', import.meta.url))], {
    stdio: 'inherit',
    timeout: 1800000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('TypeScript or regression tests failed. See the test output above.');
}

export default { plugins: [] };