import { test } from 'node:test';
import { regressionChecks } from '../src/game/regressions';

for (const check of regressionChecks) {
  test(`${check.category}: ${check.name}`, { timeout: 360000 }, async (context) => {
    context.diagnostic(await check.run());
  });
}