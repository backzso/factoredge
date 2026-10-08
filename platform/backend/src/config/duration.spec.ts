import { durationToSeconds } from './duration';

describe('durationToSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['8h', 28_800],
    ['1d', 86_400],
  ])('converts %s to %d seconds', (input, expected) => {
    expect(durationToSeconds(input)).toBe(expected);
  });

  it.each(['', '0h', '8', '8 h', '1w', '-5m'])('rejects %j', (input) => {
    expect(() => durationToSeconds(input)).toThrow();
  });
});
