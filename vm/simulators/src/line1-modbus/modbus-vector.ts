// Service vector for modbus-serial's ServerTCP: range checks, write
// validation and Modbus exception codes. No sockets here, so it is testable.

import { LineState } from '../shared/line-physics';
import { codeToState, HOLDING_REGISTER_COUNT, INPUT_REGISTER_COUNT, RegisterBank, STATE_OFFSET } from './register-map';

export const ILLEGAL_FUNCTION = 0x01;
export const ILLEGAL_DATA_ADDRESS = 0x02;
export const ILLEGAL_DATA_VALUE = 0x03;

/** modbus-serial turns `modbusErrorCode` on a thrown error into an exception response. */
export class ModbusException extends Error {
  constructor(
    readonly modbusErrorCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ModbusException';
  }
}

export interface ServiceVectorOptions {
  getBank: () => RegisterBank;
  onStateWrite: (state: LineState) => void;
}

export interface ServiceVector {
  getInputRegister(addr: number): number;
  getMultipleInputRegisters(addr: number, length: number): number[];
  getHoldingRegister(addr: number): number;
  getMultipleHoldingRegisters(addr: number, length: number): number[];
  setRegister(addr: number, value: number): void;
  setRegisterArray(addr: number, values: number[]): void;
  getCoil(addr: number): boolean;
  getDiscreteInput(addr: number): boolean;
  setCoil(addr: number, value: boolean): void;
}

export function createServiceVector({ getBank, onStateWrite }: ServiceVectorOptions): ServiceVector {
  // The library calls the single getters for length 1 and the multiple getters
  // only for length > 1, so both must exist. Each request reads one bank
  // reference, so it never mixes words from two ticks.
  const readInput = (addr: number, length: number): number[] =>
    readRange(getBank().input, INPUT_REGISTER_COUNT, addr, length, 'input');
  const readHolding = (addr: number, length: number): number[] =>
    readRange(getBank().holding, HOLDING_REGISTER_COUNT, addr, length, 'holding');

  return {
    getInputRegister: (addr) => readInput(addr, 1)[0],
    getMultipleInputRegisters: (addr, length) => readInput(addr, length),
    getHoldingRegister: (addr) => readHolding(addr, 1)[0],
    getMultipleHoldingRegisters: (addr, length) => readHolding(addr, length),

    // FC06 (and FC16 would fall back to this if setRegisterArray were missing).
    setRegister: (addr, value) => {
      if (addr !== STATE_OFFSET) {
        throw new ModbusException(ILLEGAL_DATA_ADDRESS, `holding offset ${addr} is not writable`);
      }
      const state = codeToState(value);
      if (state === undefined) {
        throw new ModbusException(ILLEGAL_DATA_VALUE, `invalid state code ${value}`);
      }
      onStateWrite(state);
    },

    // Defined only to reject FC16 explicitly instead of routing it to setRegister.
    setRegisterArray: () => unsupported('FC16 write multiple registers'),

    // Without these the library never answers coil requests and clients time out.
    getCoil: () => unsupported('FC01 read coils'),
    getDiscreteInput: () => unsupported('FC02 read discrete inputs'),
    setCoil: () => unsupported('FC05/FC15 write coils'),
  };
}

function readRange(registers: number[], count: number, addr: number, length: number, table: string): number[] {
  if (length < 1 || addr < 0 || addr + length > count) {
    throw new ModbusException(
      ILLEGAL_DATA_ADDRESS,
      `${table} range ${addr}..${addr + length - 1} outside 0..${count - 1}`,
    );
  }
  return registers.slice(addr, addr + length);
}

function unsupported(what: string): never {
  throw new ModbusException(ILLEGAL_FUNCTION, `${what} not supported`);
}
