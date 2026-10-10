import type { DeviceConfig } from '../devices/device-config.schema';
import type { ConnectorFactory } from './connector.types';
import { ModbusConnector } from './modbus/modbus.connector';
import { MqttConnector } from './mqtt/mqtt.connector';

// The only place that lists protocols on the connector side. Adding a protocol
// means a new connector class, a config schema and one case in each switch below.

export const createConnector: ConnectorFactory = (config, sink, options) => {
  switch (config.protocol) {
    case 'MODBUS':
      return new ModbusConnector(config.config, sink, options);
    case 'MQTT':
      return new MqttConnector(config.config, sink, options);
    default:
      return assertNever(config);
  }
};

/** How long a connected device may go without data before it counts as STALE. */
export function staleAfterMs(config: DeviceConfig): number {
  switch (config.protocol) {
    case 'MODBUS':
      return config.config.pollIntervalMs * 3;
    case 'MQTT':
      return config.config.staleAfterMs;
    default:
      return assertNever(config);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported protocol: ${JSON.stringify(value)}`);
}
