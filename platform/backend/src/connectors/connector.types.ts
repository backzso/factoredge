import type { DeviceConfig } from '../devices/device-config.schema';
import type { LineState } from '../generated/prisma/client';

// The contract between protocol connectors and the rest of the platform.
// Connectors only know their config and a sink: no Prisma, no SSE, no Nest DI.
// Persistence, lastSeenAt and realtime fan-out live in telemetry/ and device-health/.

export interface TelemetrySample {
  /** When the value was measured (Modbus: response received; MQTT: payload ts). */
  ts: Date;
  productionCount: number;
  scrapCount: number;
  motorTempC: number;
  motorCurrentA: number;
  state: LineState;
}

export type ConnectionEvent =
  | { type: 'connecting' }
  | { type: 'connected' }
  | { type: 'disconnected'; error?: string };

export interface ConnectorSink {
  onTelemetry(sample: TelemetrySample): void;
  onConnection(event: ConnectionEvent): void;
}

export interface Connector {
  /** Returns immediately; connecting and retrying happen in the background. */
  start(): void;
  /** Never throws and is bounded by a timeout. */
  stop(): Promise<void>;
}

export interface ConnectorOptions {
  /**
   * Opaque label used only for the MQTT client id and log prefixes.
   * Connectors must not treat it as a device key.
   */
  tag: string;
}

export type ConnectorFactory = (
  config: DeviceConfig,
  sink: ConnectorSink,
  options: ConnectorOptions,
) => Connector;
