import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('grows and then stays at the last delay', () => {
    expect([0, 1, 2, 3, 4, 50].map(backoffDelay)).toEqual([1_000, 2_000, 5_000, 10_000, 10_000, 10_000]);
  });

  it('treats odd input as the first attempt', () => {
    expect(backoffDelay(-1)).toBe(1_000);
  });
});
