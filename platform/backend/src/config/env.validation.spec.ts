import 'reflect-metadata';
import { validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
  JWT_EXPIRES_IN: '8h',
};

describe('validateEnv: temperature alarm thresholds', () => {
  it('defaults to raise 90 °C, clear 85 °C', () => {
    const env = validateEnv(base);
    expect(env.TEMP_ALARM_RAISE_C).toBe(90);
    expect(env.TEMP_ALARM_CLEAR_C).toBe(85);
  });

  it('reads numbers from the environment (strings)', () => {
    const env = validateEnv({
      ...base,
      TEMP_ALARM_RAISE_C: '75.5',
      TEMP_ALARM_CLEAR_C: '70',
    });
    expect(env.TEMP_ALARM_RAISE_C).toBe(75.5);
    expect(env.TEMP_ALARM_CLEAR_C).toBe(70);
  });

  it.each([
    ['90', '90'],
    ['80', '85'],
  ])('rejects raise %s with clear %s: clear must be lower', (raise, clear) => {
    expect(() =>
      validateEnv({
        ...base,
        TEMP_ALARM_RAISE_C: raise,
        TEMP_ALARM_CLEAR_C: clear,
      }),
    ).toThrow(/TEMP_ALARM_CLEAR_C must be lower than TEMP_ALARM_RAISE_C/);
  });

  it('rejects a value that is not a number', () => {
    expect(() => validateEnv({ ...base, TEMP_ALARM_RAISE_C: 'hot' })).toThrow(
      /TEMP_ALARM_RAISE_C must be a number/,
    );
  });
});
