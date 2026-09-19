import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const cwd = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(new URL('../tests/artifacts/', import.meta.url), { recursive: true });
const commands = [
  ['node_modules/typescript/bin/tsc', '--noEmit'],
  ['--import', 'tsx', '--test', '--test-concurrency=3', '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=tap', '--test-reporter-destination=tests/artifacts/latest-test-run.tap', 'tests/physics.test.ts', 'tests/economy.test.ts', 'tests/multiplayer.test.ts', 'tests/protocol.test.ts', 'tests/room.test.ts', 'tests/host.test.ts', 'tests/guest.test.ts', 'tests/lobby.test.ts', 'tests/session.test.ts', 'tests/matchmake.test.ts', 'tests/presence.test.ts', 'tests/lobby-ui.test.ts', 'tests/browser.test.ts',
    // Story mode (ST-01..ST-08): schema, engine and chapter modifiers. Pure node — they stub their own DOM.
    'tests/story-schema.test.ts', 'tests/story-engine.test.ts', 'tests/story-modifiers.test.ts',
    // Map builder (MB-01): the track definition format — recording, rebuild identity, validation.
    'tests/trackdef.test.ts',
    // Map builder (MB-02): the editor shell — the camera's maths, the palette, and what the shell paints.
    'tests/editor-ui.test.ts', 'tests/editor-templates.test.ts', 'tests/map-builder-audit.test.ts', 'tests/editor-bounds.test.ts', 'tests/map-elements-runtime.test.ts', 'tests/mb10e.test.ts', 'tests/mb10f.test.ts',
    // Ranked racing (RK-01): multi-player Elo, tiers, the stored file and the wire. Pure — no SDK, no DOM.
    'tests/rating.test.ts',
    // Ranked racing (RK-02): where a rating lives — RUN player storage, the once-only guard, the ladder.
    'tests/rankstore.test.ts',
    // Ranked racing (RK-03): the rated wire — the room's board, one result per room, the
    // leaver's DNF, and the headless proof that every seat computes the same deltas.
    'tests/rank-runtime.test.ts',
    // Ranked racing (RK-05): the rank surfaces' view models — the chip's tier and
    // number, and what the results screen may say about a race. Pure, no DOM.
    'tests/rank-view.test.ts',
    // MP-CHAT: driver talk — the line, the log, the cooldown and the speaker
    // (pure), and the two surfaces that paint it (lobby-ui.tsx).
    'tests/chat.test.ts'],
];

for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', timeout: 3600000 });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
