// Persists simulator state to a JSON file, like a PLC's retentive memory,
// so counters continue where they left off after a restart.

import * as fs from 'node:fs';

/**
 * Reads and parses the state file. Returns undefined (never throws) when the
 * file is missing, unreadable, not valid JSON, or rejected by `parse`.
 */
export function loadState<T>(filePath: string, parse: (raw: unknown) => T): T | undefined {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`state: cannot read ${filePath}: ${errorMessage(err)}`);
    }
    return undefined;
  }

  try {
    return parse(JSON.parse(text));
  } catch (err) {
    console.warn(`state: ignoring invalid state file ${filePath}: ${errorMessage(err)}`);
    return undefined;
  }
}

/** Writes atomically: temp file + fsync, then rename over the target. */
export function saveState(filePath: string, data: unknown): void {
  const tmpPath = `${filePath}.tmp`;
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

export interface Autosave {
  /** Saves immediately. Errors are logged, not thrown. */
  flush(): void;
  stop(): void;
}

export function startAutosave(filePath: string, getData: () => unknown, intervalMs = 5000): Autosave {
  const save = (): void => {
    try {
      saveState(filePath, getData());
    } catch (err) {
      console.error(`state: save to ${filePath} failed: ${errorMessage(err)}`);
    }
  };
  const timer = setInterval(save, intervalMs);
  return {
    flush: save,
    stop: () => clearInterval(timer),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
