// P2-01 (#107): the race key map. Matched by KeyboardEvent.code (the PHYSICAL key), so Q W E R / A S D F
// sit in the same place on AZERTY and QWERTZ keyboards too.

/** Skill slots 0..7: top row Q W E R, bottom row A S D F. */
export const SKILL_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyA', 'KeyS', 'KeyD', 'KeyF'] as const;

export type KeyAction =
  | { kind: 'skill'; slot: number }
  | { kind: 'steer'; dir: -1 | 1 }
  | { kind: 'jump' }
  | { kind: 'engine' };

/** What a key does in a race, or null when the race screen uses it for something else (or nothing). */
export function actionForKey(code: string): KeyAction | null {
  const slot = (SKILL_KEYS as readonly string[]).indexOf(code);
  if (slot >= 0) return { kind: 'skill', slot };
  const digit = /^(?:Digit|Numpad)([1-8])$/.exec(code);
  if (digit) return { kind: 'skill', slot: Number(digit[1]) - 1 };
  switch (code) {
    case 'ArrowLeft': return { kind: 'steer', dir: -1 };
    case 'ArrowRight': return { kind: 'steer', dir: 1 };
    case 'ArrowUp':
    case 'Space': return { kind: 'jump' };
    case 'ArrowDown': return { kind: 'engine' };
    default: return null;
  }
}

/** The letter printed on a slot. */
export function slotKeyLabel(slot: number): string {
  const code = SKILL_KEYS[slot];
  return code ? code.slice(3) : '';
}

/** Up to 8 slots as two rows of four. */
export function skillRows<T>(slots: readonly T[]): [T[], T[]] {
  return [slots.slice(0, 4), slots.slice(4, 8)];
}
