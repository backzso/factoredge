import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { knownFieldPaths } from '../features/devices/deviceForm';
import { issuesFromError, issuesFromMessages, mapIssuesToForm, toFormPath } from './issueMapping';

describe('toFormPath', () => {
  it('turns array indexes into dot segments', () => {
    expect(toFormPath('config.registerMap[3].offset')).toBe('config.registerMap.3.offset');
    expect(toFormPath('config.registerMap[12].signal')).toBe('config.registerMap.12.signal');
    expect(toFormPath('config.host')).toBe('config.host');
    expect(toFormPath('')).toBe('');
  });
});

describe('mapIssuesToForm (device form)', () => {
  const modbus = knownFieldPaths('MODBUS', 5);
  const isModbusField = (p: string) => modbus.has(p);

  it('puts issues under their fields and keeps validation messages as sent', () => {
    const result = mapIssuesToForm(
      [
        { path: 'config.port', message: 'Too big: expected number to be <=65535' },
        { path: 'config.registerMap[1].wordOrder', message: 'wordOrder (ABCD or CDAB) is required for float32' },
      ],
      isModbusField,
    );
    expect(result).toEqual({
      fieldErrors: {
        'config.port': 'Too big: expected number to be <=65535',
        'config.registerMap.1.wordOrder': 'wordOrder (ABCD or CDAB) is required for float32',
      },
      formErrors: [],
    });
  });

  it('shows array-level register map issues at the table', () => {
    const result = mapIssuesToForm(
      [{ path: 'config.registerMap', message: 'signal "scrapCount" is missing' }],
      isModbusField,
    );
    expect(result.fieldErrors).toEqual({ 'config.registerMap': 'signal "scrapCount" is missing' });
  });

  it('joins several messages for the same field', () => {
    const result = mapIssuesToForm(
      [
        { path: 'config.registerMap', message: 'signal "state" is missing' },
        { path: 'config.registerMap', message: 'FC4 offsets 0..125 span 126 registers' },
      ],
      isModbusField,
    );
    expect(result.fieldErrors['config.registerMap']).toBe(
      'signal "state" is missing\nFC4 offsets 0..125 span 126 registers',
    );
  });

  it('lists issues without a field above the form, with their path', () => {
    const result = mapIssuesToForm(
      [
        { path: 'config', message: 'Unrecognized key: "pollInteval"' },
        { path: 'config.registerMap[7].offset', message: 'Invalid input' },
        { path: '', message: 'Invalid input' },
      ],
      isModbusField,
    );
    expect(result.fieldErrors).toEqual({});
    expect(result.formErrors).toEqual([
      'config: Unrecognized key: "pollInteval"',
      'config.registerMap[7].offset: Invalid input',
      'Invalid input',
    ]);
  });

  it('does not map Modbus fields on an MQTT form', () => {
    const mqtt = knownFieldPaths('MQTT', 0);
    const result = mapIssuesToForm(
      [
        { path: 'config.brokerUrl', message: 'brokerUrl must be a valid URL starting with mqtt://' },
        { path: 'config.host', message: 'Invalid input' },
      ],
      (p) => mqtt.has(p),
    );
    expect(Object.keys(result.fieldErrors)).toEqual(['config.brokerUrl']);
    expect(result.formErrors).toEqual(['config.host: Invalid input']);
  });

  it('translates business-rule messages only', () => {
    const result = mapIssuesToForm(
      [{ path: 'protocol', message: 'protocol cannot be changed; delete and recreate the device' }],
      isModbusField,
    );
    expect(result.fieldErrors.protocol).toBe('Protokol değiştirilemez; cihazı silip yeniden oluşturun.');
  });
});

describe('class-validator messages', () => {
  const fields = ['username', 'password', 'role'];

  it('attaches a message to the field named by its first word', () => {
    expect(
      issuesFromMessages(
        [
          'username must be 3-32 characters of letters, digits, "_", "." or "-"',
          'password must be 8-72 bytes long',
          'property foo should not exist',
        ],
        fields,
      ),
    ).toEqual([
      { path: 'username', message: 'username must be 3-32 characters of letters, digits, "_", "." or "-"' },
      { path: 'password', message: 'password must be 8-72 bytes long' },
      { path: '', message: 'property foo should not exist' },
    ]);
  });

  it('prefers zod issues over messages', () => {
    const error = new ApiError(400, 'Invalid device config', [{ path: 'config.host', message: 'x' }], ['name y']);
    expect(issuesFromError(error, ['name'])).toEqual([{ path: 'config.host', message: 'x' }]);
  });

  it('falls back to messages, and to nothing', () => {
    const error = new ApiError(400, 'name must be shorter', undefined, ['name must be shorter']);
    expect(issuesFromError(error, ['name'])).toEqual([{ path: 'name', message: 'name must be shorter' }]);
    expect(issuesFromError(new ApiError(400, 'Bad Request'), ['name'])).toEqual([]);
  });
});
