/**
 * Championship circuits are the archived official tracks (src/game/official-tracks/champ-*.json),
 * not runtime generation. These checks pin the contract the rest of the game leans on:
 *
 * - every calendar round has a valid, buildable archive (a missing round would silently
 *   fall back to the seeded generator — exactly what this change removes);
 * - `roundTrack` prefers the player's swap-in and returns the archive otherwise, so the
 *   menu demo and the heats race the same saved layout;
 * - the archives are what they claim: the calendar Grand Prix names and themes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALENDAR, newSeason, roundTrack, setRoundTrack, canChangeRoundTrack } from '../src/game/season';
import { OFFICIAL_TRACKS, officialTrack } from '../src/game/official-tracks';
import { buildTrackFromDef } from '../src/game/trackdef';
import { themeIdFor } from '../src/game/types';
import type { TrackDef } from '../src/game/trackdef';
import type { MarbleInfo } from '../src/game/types';

function roster(): MarbleInfo[] {
  return Array.from({ length: 10 }, (_, id) => ({
    id,
    name: `Driver ${id}`,
    color: '#d63e2e',
    stats: { weight: 5, speed: 5, bounce: 5 },
    isPlayer: id === 0,
    character: 0,
  }));
}

test('every calendar round has a valid archived official circuit', () => {
  assert.equal(OFFICIAL_TRACKS.length, CALENDAR.length, 'an archive file was added or removed without updating the loader');
  for (const gp of CALENDAR) {
    const def = officialTrack(gp.id);
    assert.ok(def, `round ${gp.id} (${gp.name}) has no usable archive — it would silently generate at race time`);
    assert.ok(def.pieces.length > 0, `round ${gp.id}'s archive is empty`);
    assert.equal(def.name, gp.name, `round ${gp.id}'s archive is named "${def.name}", not the Grand Prix name`);
    assert.equal(def.theme, themeIdFor(gp.profile.theme), `round ${gp.id}'s archive theme does not match the calendar`);
    // The archive must rebuild: this is the very call the menu demo and every heat make.
    const track = buildTrackFromDef(def);
    assert.ok(track.bodies.length > 0);
    assert.ok(track.gate, `round ${gp.id}'s archive builds without a start gate`);
    assert.ok(track.segments.length >= 3, `round ${gp.id}'s archive builds without start/finish sectors`);
  }
});

test('roundTrack races the archive, and the player swap-in still wins', () => {
  const season = newSeason(roster());
  for (const gp of CALENDAR) {
    assert.deepEqual(roundTrack(season, gp.id), officialTrack(gp.id), `round ${gp.id} does not race its archive`);
  }

  const mine: TrackDef = {
    v: 1,
    name: 'My workshop fix',
    seed: 7,
    theme: 'classic',
    height: 2000,
    pieces: [{ t: 'ramp', a: [100, 600], b: [700, 900] }],
  };
  assert.ok(canChangeRoundTrack(season, 2));
  const swapped = setRoundTrack(season, 2, mine);
  assert.equal(roundTrack(swapped, 2)?.name, 'My workshop fix', 'the player swap-in must beat the archive');
  assert.deepEqual(roundTrack(swapped, 0), officialTrack(0), 'other rounds keep their archive');

  const restored = setRoundTrack(swapped, 2, null);
  assert.deepEqual(roundTrack(restored, 2), officialTrack(2), 'dropping the swap-in returns to the archive');
  // The swap-in is a copy: later edits to the source def cannot change a saved season.
  mine.name = 'Edited later';
  assert.equal(roundTrack(swapped, 2)?.name, 'My workshop fix');
});

test('a refused archive falls back to null, never to a wrong round', () => {
  assert.equal(officialTrack(-1), null);
  assert.equal(officialTrack(CALENDAR.length + 40), null);
});
