import { describe, expect, it } from 'vitest';
import { LineState } from '../shared/line-physics';
import {
  createServiceVector,
  ILLEGAL_DATA_ADDRESS,
  ILLEGAL_DATA_VALUE,
  ILLEGAL_FUNCTION,
  ModbusException,
} from './modbus-vector';
import { RegisterBank } from './register-map';

function setup() {
  let bank: RegisterBank = {
    input: Array.from({ length: 20 }, (_, i) => 100 + i),
    holding: [1],
  };
  const writes: LineState[] = [];
  const vector = createServiceVector({
    getBank: () => bank,
    onStateWrite: (state) => writes.push(state),
  });
  return { vector, writes, swap: (next: RegisterBank) => (bank = next) };
}

function modbusCode(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ModbusException);
    return (err as ModbusException).modbusErrorCode;
  }
  return undefined;
}

describe('createServiceVector', () => {
  it('reads input registers singly and in ranges up to offset 19', () => {
    const { vector } = setup();
    expect(vector.getInputRegister(0)).toBe(100);
    expect(vector.getInputRegister(19)).toBe(119);
    expect(vector.getMultipleInputRegisters(0, 20)).toHaveLength(20);
    expect(vector.getMultipleInputRegisters(2, 2)).toEqual([102, 103]);
  });

  it('rejects input reads outside 0..19 with illegal data address', () => {
    const { vector } = setup();
    expect(modbusCode(() => vector.getInputRegister(20))).toBe(ILLEGAL_DATA_ADDRESS);
    expect(modbusCode(() => vector.getMultipleInputRegisters(19, 2))).toBe(ILLEGAL_DATA_ADDRESS);
    expect(modbusCode(() => vector.getMultipleInputRegisters(0, 21))).toBe(ILLEGAL_DATA_ADDRESS);
  });

  it('reads only holding offset 0', () => {
    const { vector } = setup();
    expect(vector.getHoldingRegister(0)).toBe(1);
    expect(modbusCode(() => vector.getHoldingRegister(1))).toBe(ILLEGAL_DATA_ADDRESS);
    expect(modbusCode(() => vector.getMultipleHoldingRegisters(0, 2))).toBe(ILLEGAL_DATA_ADDRESS);
  });

  it('reads from the bank that is current at request time', () => {
    const { vector, swap } = setup();
    const before = vector.getMultipleInputRegisters(0, 4);
    swap({ input: new Array(20).fill(7), holding: [0] });
    expect(before).toEqual([100, 101, 102, 103]);
    expect(vector.getMultipleInputRegisters(0, 4)).toEqual([7, 7, 7, 7]);
  });

  it('accepts state codes 0/1/2 on holding offset 0', () => {
    const { vector, writes } = setup();
    vector.setRegister(0, 2);
    vector.setRegister(0, 0);
    vector.setRegister(0, 1);
    expect(writes).toEqual(['fault', 'stopped', 'running']);
  });

  it('rejects invalid state values and other addresses', () => {
    const { vector, writes } = setup();
    expect(modbusCode(() => vector.setRegister(0, 3))).toBe(ILLEGAL_DATA_VALUE);
    expect(modbusCode(() => vector.setRegister(1, 1))).toBe(ILLEGAL_DATA_ADDRESS);
    expect(writes).toEqual([]);
  });

  it('rejects FC16 and coil functions with illegal function', () => {
    const { vector, writes } = setup();
    expect(modbusCode(() => vector.setRegisterArray(0, [1]))).toBe(ILLEGAL_FUNCTION);
    expect(modbusCode(() => vector.getCoil(0))).toBe(ILLEGAL_FUNCTION);
    expect(modbusCode(() => vector.getDiscreteInput(0))).toBe(ILLEGAL_FUNCTION);
    expect(modbusCode(() => vector.setCoil(0, true))).toBe(ILLEGAL_FUNCTION);
    expect(writes).toEqual([]);
  });
});
