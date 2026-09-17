/**
 * MB-03. Undo/redo stack of `TrackDef` snapshots, capped at 100.
 *
 * Every mutating editor action pushes the *previous* def onto `past` and
 * clears `future`.  `undo` and `redo` swap the current value with the top
 * of the opposite stack.  Snapshots are deep-cloned via JSON so later
 * mutations never alias an entry.
 *
 * The editor keeps exactly one `History` instance per `TrackEditor` (in a
 * ref) so React renders do not lose the stack, and the 100-entry cap keeps
 * memory bounded on a long editing session — a def with 6000 pieces is
 * ~200 kB, 100 of them is the ceiling the validation layer allows.
 */
import type { TrackDef } from '../../game/trackdef';

const CAP = 100;

function clone(def: TrackDef): TrackDef {
  // TrackDef is JSON-safe by construction (MB-01).  JSON round-trips faster
  // than structuredClone and guarantees the epic's "share-code clean" property.
  return JSON.parse(JSON.stringify(def)) as TrackDef;
}

export class History {
  private past: TrackDef[] = [];
  private future: TrackDef[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Push the *previous* def before an edit. Clears redo. */
  push(previous: TrackDef): void {
    this.past.push(clone(previous));
    if (this.past.length > CAP) this.past.shift();
    this.future.length = 0;
  }

  undo(current: TrackDef): TrackDef | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(clone(current));
    return clone(prev);
  }

  redo(current: TrackDef): TrackDef | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(clone(current));
    if (this.past.length > CAP) this.past.shift();
    return clone(next);
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }

  /** For tests: how many entries are retained. */
  get size(): number {
    return this.past.length;
  }
}
