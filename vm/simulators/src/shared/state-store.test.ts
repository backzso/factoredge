import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadState, saveState } from './state-store';

describe('state-store', () => {
  let dir: string;
  let file: string;
  const identity = (raw: unknown) => raw;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-store-'));
    file = path.join(dir, 'state.json');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when the file does not exist', () => {
    expect(loadState(file, identity)).toBeUndefined();
  });

  it('returns undefined instead of throwing on corrupt JSON', () => {
    fs.writeFileSync(file, '{"productionCount": 12');
    expect(loadState(file, identity)).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns undefined when the parser rejects the content', () => {
    fs.writeFileSync(file, '{"version": 99}');
    const reject = () => {
      throw new Error('bad version');
    };
    expect(loadState(file, reject)).toBeUndefined();
  });

  it('round-trips data and leaves no temp file behind', () => {
    saveState(file, { productionCount: 1 });
    saveState(file, { productionCount: 5821, scrapCount: 172 });

    expect(loadState(file, identity)).toEqual({ productionCount: 5821, scrapCount: 172 });
    expect(fs.readdirSync(dir)).toEqual(['state.json']);
  });
});
