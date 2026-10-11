import { describe, expect, it } from 'vitest';
import type { Device, DeviceTemplates, RegisterMapEntry } from '../../api/types';
import {
  knownFieldPaths,
  toDeviceFormPath,
  toDeviceInput,
  toRegisterRows,
  validateDeviceForm,
  valuesFromDevice,
  valuesFromTemplates,
} from './deviceForm';

const LINE1_MAP: RegisterMapEntry[] = [
  { signal: 'productionCount', fc: 4, offset: 0, type: 'uint32', wordOrder: 'ABCD', scale: 1 },
  { signal: 'motorTempC', fc: 4, offset: 2, type: 'float32', wordOrder: 'CDAB', scale: 1 },
  { signal: 'motorCurrentA', fc: 4, offset: 9, type: 'int16', scale: 0.01 },
  { signal: 'scrapCount', fc: 4, offset: 19, type: 'uint16', scale: 1 },
  { signal: 'state', fc: 3, offset: 0, type: 'uint16', scale: 1 },
];

const TEMPLATES: DeviceTemplates = {
  MODBUS: { port: 5020, unitId: 1, pollIntervalMs: 1000, timeoutMs: 1000, registerMap: LINE1_MAP },
  MQTT: { topicPrefix: 'factory/line2', staleAfterMs: 3000 },
};

function modbusDevice(registerMap: RegisterMapEntry[]): Device {
  return {
    id: 'd1',
    name: 'Hat 1',
    enabled: true,
    alarm: null,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    health: { status: 'ONLINE', lastSeenAt: null, lastError: null },
    protocol: 'MODBUS',
    config: { host: '10.0.0.5', port: 5020, unitId: 1, pollIntervalMs: 1000, timeoutMs: 1000, registerMap },
  };
}

describe('register rows', () => {
  it('keeps one row per signal, whatever order the API returns', () => {
    const values = valuesFromDevice(modbusDevice([...LINE1_MAP].reverse()));
    expect(Object.keys(values.config.registerMap)).toEqual([
      'productionCount',
      'motorTempC',
      'motorCurrentA',
      'scrapCount',
      'state',
    ]);
    expect(values.config.registerMap.motorTempC).toEqual({
      fc: '4',
      offset: 2,
      type: 'float32',
      wordOrder: 'CDAB',
      scale: 1,
    });
  });

  it('leaves the offset of a signal the API did not return empty, so the form asks for it', () => {
    const rows = toRegisterRows(LINE1_MAP.filter((e) => e.signal !== 'scrapCount'));
    expect(rows.scrapCount.offset).toBe('');
    const values = { ...valuesFromTemplates(TEMPLATES), name: 'Hat 1' };
    values.config = { ...values.config, host: '10.0.0.5', registerMap: rows };
    expect(validateDeviceForm(values)).toEqual({ 'config.registerMap.scrapCount.offset': 'Gerekli' });
  });

  it('sends every signal exactly once, in a fixed order, without wordOrder on 16-bit types', () => {
    const values = valuesFromDevice(modbusDevice([...LINE1_MAP].reverse()));
    values.config.registerMap.scrapCount = { ...values.config.registerMap.scrapCount, wordOrder: 'ABCD' };
    const input = toDeviceInput(values);
    expect(input.protocol === 'MODBUS' && input.config.registerMap).toEqual(LINE1_MAP);
  });

  it('asks for a word order on 32-bit types only', () => {
    const values = { ...valuesFromTemplates(TEMPLATES), name: 'Hat 1' };
    values.config.host = '10.0.0.5';
    values.config.registerMap.motorTempC = { ...values.config.registerMap.motorTempC, wordOrder: null };
    expect(validateDeviceForm(values)).toEqual({
      'config.registerMap.motorTempC.wordOrder': '32 bit tiplerde gerekli',
    });
  });
});

describe('toDeviceFormPath', () => {
  const sent = [{ signal: 'scrapCount' }, { signal: 'state' }] as const;

  it('finds the row by the signal at the issue index', () => {
    expect(toDeviceFormPath('config.registerMap[1].type', sent)).toBe('config.registerMap.state.type');
    expect(toDeviceFormPath('config.registerMap[0].offset', sent)).toBe('config.registerMap.scrapCount.offset');
  });

  it('leaves other paths and unknown indexes alone', () => {
    expect(toDeviceFormPath('config.host', sent)).toBe('config.host');
    expect(toDeviceFormPath('config.registerMap', sent)).toBe('config.registerMap');
    expect(toDeviceFormPath('config.registerMap[5].offset', sent)).toBe('config.registerMap[5].offset');
  });

  it('only resolves cells that exist on screen', () => {
    const known = knownFieldPaths('MODBUS');
    expect(known.has('config.registerMap.state.wordOrder')).toBe(true);
    // A duplicate-signal issue has no cell now that the signal is fixed per row.
    expect(known.has('config.registerMap.state.signal')).toBe(false);
  });
});
