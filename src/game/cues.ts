// ══════════════════════════════════════════════════════════════════════════
// The race's SOUND-CUE vocabulary — the NAMES the wire speaks.
//
// The host's `events` frame carries cues, because a peg that pops off-screen
// still has to be HEARD on a guest that never simulates. A wire vocabulary
// nobody owns drifts into two lists the moment somebody writes the second one,
// so the list lives here and both ends import it.
//
// This module is PURE — no SDK, no DOM, no imports, nothing at module scope but
// a frozen array. That is not tidiness: `src/net/protocol.ts` imports it, and
// the room bundle imports `src/net/protocol.ts`, so anything stateful here
// would boot inside the room worker. Keep it that way.
//
// It is deliberately NOT `src/game/audio.ts`: that one is the mixer — an
// AudioContext, a mute preference in storage, and a `SoundEvent` that carries
// where the noise happened. The wire only ever needs the name; the mixer turns
// the name into noise and decides how loud.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Every cue a race can ask for.
 *
 *   gate      — the trapdoor drops and the heat starts
 *   countdown — one beep of the lights-out count
 *   peg       — a peg lit up / popped (orange pegs score)
 *   crate     — a breakable wall took damage or broke open
 *   box       — an item box was taken
 *   item      — a marble deployed an item
 *   oil       — an oil slick hit the track
 *   freeze    — a freeze ray landed
 *   shock     — a shockwave went off
 *   pad       — a bounce pad launched someone
 *   bucket    — a Peggle bucket gave a free ball
 *   boost     — a booster strip pushed someone along
 *   finish    — a marble crossed the line
 *   cheer     — MB-10A: the crowd roars as a NO ENTRY barricade splinters
 *   rumble    — MB-10A: a marble rumbles through a cliff tunnel (or a wall gives)
 *   creak     — MB-10A: a trapdoor swings on its hinge
 *   click     — MB-10A: a track-switch lever trips over
 *   shriek    — MB-10B: a swinging blade catches a marble
 *   grind     — MB-10B: a saw bites and throws a marble up
 *   slam      — MB-10B: a crusher piston docks at floor level
 *   splash    — MB-10C: a water wheel bucket dunks or tips a marble out
 *   groan     — MB-10C: a seesaw or rope bridge takes real load
 *   whirr     — MB-10C: an Archimedes screw swallows a marble for the climb
 *   bang      — MB-10D: a cannon spits its marble out of the muzzle
 *   twang     — MB-10D: a slingshot band snaps back behind a marble
 *   snap      — MB-10D: a flipper bat swats
 *   boing     — MB-10D: a scoop kicks its marble back out
 */
export const SOUND_EVENTS = [
  'gate',
  'countdown',
  'peg',
  'crate',
  'box',
  'item',
  'oil',
  'freeze',
  'shock',
  'pad',
  'bucket',
  'boost',
  'finish',
  'cheer',
  'rumble',
  'creak',
  'click',
  'shriek',
  'grind',
  'slam',
  'splash',
  'groan',
  'whirr',
  'bang',
  'twang',
  'snap',
  'boing',
] as const;

/** One named cue. The wire carries these, so the list is the contract. */
export type SoundEvent = (typeof SOUND_EVENTS)[number];

/** True when `value` is a cue this build knows how to name. */
export function isSoundEvent(value: unknown): value is SoundEvent {
  return typeof value === 'string' && (SOUND_EVENTS as readonly string[]).includes(value);
}
