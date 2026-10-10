import type { DeviceInput } from '../../api/devices';
import type {
  Device,
  DeviceTemplates,
  FunctionCode,
  Protocol,
  RegisterMapEntry,
  RegisterType,
  Signal,
  WordOrder,
} from '../../api/types';

// Form values mirror the API body ({ name, protocol, enabled, config: {...} }),
// so backend issue paths ("config.registerMap[3].offset") map onto form paths
// ("config.registerMap.3.offset") one to one.

type NumberField = number | '';

export interface RegisterRow {
  /** React list key only; never sent. */
  key: string;
  signal: Signal;
  fc: `${FunctionCode}`;
  offset: NumberField;
  type: RegisterType;
  wordOrder: WordOrder | null;
  scale: NumberField;
}

/** Fields of both protocols; only the selected protocol's ones are sent. */
export interface ConfigValues {
  host: string;
  port: NumberField;
  unitId: NumberField;
  pollIntervalMs: NumberField;
  timeoutMs: NumberField;
  registerMap: RegisterRow[];
  brokerUrl: string;
  topicPrefix: string;
  staleAfterMs: NumberField;
}

export interface DeviceFormValues {
  name: string;
  protocol: Protocol;
  enabled: boolean;
  config: ConfigValues;
}

export const MODBUS_FIELDS = ['host', 'port', 'unitId', 'pollIntervalMs', 'timeoutMs'] as const;
export const MQTT_FIELDS = ['brokerUrl', 'topicPrefix', 'staleAfterMs'] as const;
export const REGISTER_COLUMNS = ['signal', 'fc', 'offset', 'type', 'wordOrder', 'scale'] as const;

export function is32Bit(type: RegisterType): boolean {
  return type === 'uint32' || type === 'float32';
}

let rowCounter = 0;
export function newRowKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

export function toRow(entry: RegisterMapEntry): RegisterRow {
  return {
    key: newRowKey(),
    signal: entry.signal,
    fc: `${entry.fc}`,
    offset: entry.offset,
    type: entry.type,
    wordOrder: entry.wordOrder ?? null,
    scale: entry.scale,
  };
}

export function emptyRow(): RegisterRow {
  return {
    key: newRowKey(),
    signal: 'productionCount',
    fc: '4',
    offset: '',
    type: 'uint16',
    wordOrder: null,
    scale: 1,
  };
}

/** New device: both protocols pre-filled from /api/devices/templates; host and broker left empty. */
export function valuesFromTemplates(templates: DeviceTemplates): DeviceFormValues {
  return {
    name: '',
    protocol: 'MODBUS',
    enabled: true,
    config: {
      host: '',
      port: templates.MODBUS.port,
      unitId: templates.MODBUS.unitId,
      pollIntervalMs: templates.MODBUS.pollIntervalMs,
      timeoutMs: templates.MODBUS.timeoutMs,
      registerMap: templates.MODBUS.registerMap.map(toRow),
      brokerUrl: '',
      topicPrefix: templates.MQTT.topicPrefix,
      staleAfterMs: templates.MQTT.staleAfterMs,
    },
  };
}

const EMPTY_CONFIG: ConfigValues = {
  host: '',
  port: '',
  unitId: '',
  pollIntervalMs: '',
  timeoutMs: '',
  registerMap: [],
  brokerUrl: '',
  topicPrefix: '',
  staleAfterMs: '',
};

export function valuesFromDevice(device: Device): DeviceFormValues {
  const config: ConfigValues =
    device.protocol === 'MODBUS'
      ? {
          ...EMPTY_CONFIG,
          ...device.config,
          registerMap: device.config.registerMap.map(toRow),
        }
      : { ...EMPTY_CONFIG, ...device.config };
  return {
    name: device.name,
    protocol: device.protocol,
    enabled: device.enabled,
    config,
  };
}

/**
 * Builds the API body for the selected protocol. Empty numbers are sent as
 * they are (client validation stops them first); wordOrder is dropped for
 * 16-bit types, where the backend forbids it.
 */
export function toDeviceInput(values: DeviceFormValues): DeviceInput {
  const name = values.name.trim();
  const c = values.config;
  if (values.protocol === 'MQTT') {
    return {
      name,
      protocol: 'MQTT',
      enabled: values.enabled,
      config: {
        brokerUrl: c.brokerUrl.trim(),
        topicPrefix: c.topicPrefix.trim(),
        staleAfterMs: c.staleAfterMs as number,
      },
    };
  }
  return {
    name,
    protocol: 'MODBUS',
    enabled: values.enabled,
    config: {
      host: c.host.trim(),
      port: c.port as number,
      unitId: c.unitId as number,
      pollIntervalMs: c.pollIntervalMs as number,
      timeoutMs: c.timeoutMs as number,
      registerMap: c.registerMap.map((row) => ({
        signal: row.signal,
        fc: Number(row.fc) as FunctionCode,
        offset: row.offset as number,
        type: row.type,
        ...(is32Bit(row.type) && row.wordOrder ? { wordOrder: row.wordOrder } : {}),
        scale: row.scale as number,
      })),
    },
  };
}

/** Form paths that have a place on screen for the given protocol and register rows. */
export function knownFieldPaths(protocol: Protocol, registerRows: number): Set<string> {
  const paths = new Set<string>(['name', 'enabled', 'protocol']);
  if (protocol === 'MQTT') {
    MQTT_FIELDS.forEach((f) => paths.add(`config.${f}`));
    return paths;
  }
  MODBUS_FIELDS.forEach((f) => paths.add(`config.${f}`));
  // Array-level issues (missing signal, range too wide) are shown above the table.
  paths.add('config.registerMap');
  for (let i = 0; i < registerRows; i++) {
    REGISTER_COLUMNS.forEach((col) => paths.add(`config.registerMap.${i}.${col}`));
  }
  return paths;
}

const REQUIRED = 'Gerekli';

/** Client-side checks for empty fields only; the backend validates the rest. */
export function validateDeviceForm(values: DeviceFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const c = values.config;
  const requireNumber = (path: string, value: NumberField) => {
    if (value === '') errors[path] = REQUIRED;
  };
  if (!values.name.trim()) errors.name = 'Ad gerekli';
  if (values.protocol === 'MODBUS') {
    if (!c.host.trim()) errors['config.host'] = 'Host gerekli';
    requireNumber('config.port', c.port);
    requireNumber('config.unitId', c.unitId);
    requireNumber('config.pollIntervalMs', c.pollIntervalMs);
    requireNumber('config.timeoutMs', c.timeoutMs);
    c.registerMap.forEach((row, i) => {
      requireNumber(`config.registerMap.${i}.offset`, row.offset);
      requireNumber(`config.registerMap.${i}.scale`, row.scale);
      if (is32Bit(row.type) && !row.wordOrder) {
        errors[`config.registerMap.${i}.wordOrder`] = '32 bit tiplerde gerekli';
      }
    });
  } else {
    if (!c.brokerUrl.trim()) errors['config.brokerUrl'] = 'Broker adresi gerekli';
    if (!c.topicPrefix.trim()) errors['config.topicPrefix'] = 'Topic öneki gerekli';
    requireNumber('config.staleAfterMs', c.staleAfterMs);
  }
  return errors;
}
