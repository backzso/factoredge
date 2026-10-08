import { describe, expect, it } from 'vitest';
import { LineSnapshot } from '../shared/line-physics';
import {
  codeToState,
  encodeSnapshot,
  float32ToWordsCDAB,
  HOLDING_REGISTER_COUNT,
  INPUT_REGISTER_COUNT,
  scaledInt16,
  uint16,
  uint32ToWordsABCD,
} from './register-map';

const GOLDEN: LineSnapshot = {
  state: 'running',
  productionCount: 123456789,
  motorTempC: 72.5,
  motorCurrentA: 12.34,
  scrapCount: 42,
};

describe('encodeSnapshot golden values', () => {
  const { input, holding } = encodeSnapshot(GOLDEN);

  it('has the documented table sizes', () => {
    expect(input).toHaveLength(INPUT_REGISTER_COUNT);
    expect(holding).toHaveLength(HOLDING_REGISTER_COUNT);
  });

  it('encodes productionCount 123456789 as uint32 ABCD at 30001–30002', () => {
    expect(input[0]).toBe(1883); // 0x075B
    expect(input[1]).toBe(52501); // 0xCD15
  });

  it('encodes motorTempC 72.5 as float32 CDAB at 30003–30004', () => {
    expect(input[2]).toBe(0); // 0x0000
    expect(input[3]).toBe(17041); // 0x4291
  });

  it('encodes motorCurrentA 12.34 as int16 x0.01 at 30010', () => {
    expect(input[9]).toBe(1234);
  });

  it('encodes negative motorCurrentA -12.34 as two complement', () => {
    expect(encodeSnapshot({ ...GOLDEN, motorCurrentA: -12.34 }).input[9]).toBe(64302);
  });

  it('encodes scrapCount 42 as uint16 at 30020', () => {
    expect(input[19]).toBe(42);
  });

  it('encodes state at 40001', () => {
    expect(holding[0]).toBe(1);
    expect(encodeSnapshot({ ...GOLDEN, state: 'stopped' }).holding[0]).toBe(0);
    expect(encodeSnapshot({ ...GOLDEN, state: 'fault' }).holding[0]).toBe(2);
  });

  it('leaves every other input register at 0', () => {
    const used = new Set([0, 1, 2, 3, 9, 19]);
    input.forEach((word, index) => {
      if (!used.has(index)) expect(word, `input[${index}]`).toBe(0);
    });
  });

  it('returns new arrays on every call', () => {
    const second = encodeSnapshot(GOLDEN);
    expect(second.input).not.toBe(input);
    expect(second.holding).not.toBe(holding);
  });
});

describe('encoding helpers', () => {
  it('wraps uint32 modulo 2^32', () => {
    expect(uint32ToWordsABCD(0xffffffff)).toEqual([0xffff, 0xffff]);
    expect(uint32ToWordsABCD(2 ** 32)).toEqual([0, 0]);
    expect(uint32ToWordsABCD(2 ** 32 + 5)).toEqual([0, 5]);
  });

  it('wraps uint16 modulo 65536', () => {
    expect(uint16(65535)).toBe(65535);
    expect(uint16(65536)).toBe(0);
    expect(uint16(65537)).toBe(1);
  });

  it('clamps int16 instead of wrapping', () => {
    expect(scaledInt16(327.67, 0.01)).toBe(32767);
    expect(scaledInt16(400, 0.01)).toBe(32767);
    expect(scaledInt16(-400, 0.01)).toBe(0x8000); // -32768
    expect(scaledInt16(0, 0.01)).toBe(0);
  });

  it('swaps float32 words to CDAB', () => {
    // 1.5 = 0x3FC00000 -> AB=0x3FC0, CD=0x0000
    expect(float32ToWordsCDAB(1.5)).toEqual([0x0000, 0x3fc0]);
    // -2.75 = 0xC0300000
    expect(float32ToWordsCDAB(-2.75)).toEqual([0x0000, 0xc030]);
    // 0.1 = 0x3DCCCCCD
    expect(float32ToWordsCDAB(0.1)).toEqual([0xcccd, 0x3dcc]);
  });

  it('maps state codes both ways', () => {
    expect(codeToState(0)).toBe('stopped');
    expect(codeToState(1)).toBe('running');
    expect(codeToState(2)).toBe('fault');
    expect(codeToState(3)).toBeUndefined();
  });
});
