/**
 * JSON-file persistence of the table state. Writes are debounced and atomic
 * (write to a temporary file, then rename), so a crash never leaves a
 * half-written state.json.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyState } from "../shared/reducer.ts";
import type { TableState } from "../shared/types.ts";

export const STATE_FILE = "state.json";

export class StateStore {
  private readonly file: string;
  private timer: NodeJS.Timeout | null = null;
  private pending: TableState | null = null;

  constructor(
    dataDir: string,
    private readonly delayMs = 200,
  ) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, STATE_FILE);
  }

  /** Loads the saved state, or returns an empty one. A corrupt file is kept aside. */
  load(): TableState {
    if (!existsSync(this.file)) return emptyState();
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as TableState;
      if (!Array.isArray(data.maps) || !Array.isArray(data.tokens) || !Array.isArray(data.templates)) {
        throw new Error("unexpected shape");
      }
      return { ...emptyState(), ...data };
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      renameSync(this.file, backup);
      console.warn(`[malzob] could not read ${this.file} (${(err as Error).message}); moved it to ${backup}`);
      return emptyState();
    }
  }

  /** Schedules a save. Several calls within `delayMs` result in one write. */
  save(state: TableState): void {
    this.pending = state;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Writes any pending state immediately. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.pending, null, 2));
    renameSync(tmp, this.file);
    this.pending = null;
  }
}
