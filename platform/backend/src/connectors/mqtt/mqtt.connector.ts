import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { connect, type MqttClient } from 'mqtt';
import { summarizeZodError } from '../../common/zod-issues';
import type { MqttConfig } from '../../devices/device-config.schema';
import { errorMessage } from '../../common/error-message';
import { LogThrottle } from '../../common/log-throttle';
import { withTimeout } from '../async-utils';
import type {
  ConnectionEvent,
  Connector,
  ConnectorOptions,
  ConnectorSink,
} from '../connector.types';
import {
  payloadToSample,
  telemetryPayloadSchema,
} from './telemetry-payload.schema';

const STOP_TIMEOUT_MS = 2_000;
// Telemetry messages are ~200 bytes; anything far larger is not ours.
const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Subscribes to <topicPrefix>/telemetry. Reconnecting is left to mqtt.js
 * (reconnectPeriod); source health is inferred from the broker connection plus
 * telemetry freshness, so the status topic / LWT is not used here.
 */
export class MqttConnector implements Connector {
  private readonly logger: Logger;
  private readonly throttle: LogThrottle;
  private readonly topic: string;
  private readonly clientId: string;

  private client: MqttClient | undefined;
  private lastError: string | undefined;
  private lastEventKey: string | undefined;

  constructor(
    private readonly config: MqttConfig,
    private readonly sink: ConnectorSink,
    options: ConnectorOptions,
  ) {
    this.logger = new Logger(`MqttConnector ${options.tag}`);
    this.throttle = new LogThrottle(this.logger);
    this.topic = `${config.topicPrefix}/telemetry`;
    // Unique per run: two clients with the same id would keep kicking each other off the broker.
    this.clientId = `factoredge-${options.tag}-${randomBytes(3).toString('hex')}`;
  }

  start(): void {
    if (this.client) {
      return;
    }
    this.emit({ type: 'connecting' });

    let client: MqttClient;
    try {
      // Returns immediately; the connection is established in the background.
      client = connect(this.config.brokerUrl, {
        clientId: this.clientId,
        keepalive: 5,
        reconnectPeriod: 2_000,
        connectTimeout: 5_000,
        clean: true,
      });
    } catch (error) {
      this.emit({ type: 'disconnected', error: errorMessage(error) });
      return;
    }
    this.client = client;

    // Every handler checks that its client is still the current one, so events
    // that arrive after stop() are ignored. The 'error' listener stays attached
    // for the client's whole life: an unhandled 'error' event would crash the process.
    const isCurrent = () => this.client === client;

    client.on('connect', () => {
      if (!isCurrent()) return;
      this.lastError = undefined;
      this.emit({ type: 'connected' });
      // Subscribing on every connect refreshes the subscription after a reconnect.
      client.subscribe(this.topic, { qos: 0 }, (error, granted) => {
        if (!isCurrent()) return;
        const refused = granted?.some((grant) => grant.qos === 128);
        if (error || refused) {
          this.lastError = `subscribe to ${this.topic} failed: ${error ? errorMessage(error) : 'refused by broker'}`;
          this.throttle.warn(this.lastError);
        }
      });
    });
    client.on('reconnect', () => {
      if (isCurrent()) this.emit({ type: 'connecting' });
    });
    client.on('close', () => {
      if (isCurrent())
        this.emit({ type: 'disconnected', error: this.lastError });
    });
    client.on('offline', () => {
      if (isCurrent())
        this.emit({ type: 'disconnected', error: this.lastError });
    });
    client.on('error', (error) => {
      if (!isCurrent()) return;
      this.lastError = errorMessage(error);
      this.throttle.warn(this.lastError);
    });
    client.on('message', (topic, payload) => {
      if (isCurrent() && topic === this.topic) this.handlePayload(payload);
    });
  }

  async stop(): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    this.client = undefined;
    try {
      await withTimeout(
        client.endAsync(true),
        STOP_TIMEOUT_MS,
        `MQTT client did not close within ${STOP_TIMEOUT_MS} ms`,
      );
    } catch (error) {
      this.logger.warn(errorMessage(error));
    }
  }

  private handlePayload(payload: Buffer): void {
    if (payload.length > MAX_PAYLOAD_BYTES) {
      this.throttle.warn(
        `invalid payload dropped: larger than ${MAX_PAYLOAD_BYTES} bytes`,
      );
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      this.throttle.warn('invalid payload dropped: not valid JSON');
      return;
    }
    const result = telemetryPayloadSchema.safeParse(json);
    if (!result.success) {
      this.throttle.warn(
        `invalid payload dropped: ${summarizeZodError(result.error)}`,
      );
      return;
    }
    this.sink.onTelemetry(payloadToSample(result.data));
  }

  /** mqtt.js fires 'offline' and 'close' back to back; report each change once. */
  private emit(event: ConnectionEvent): void {
    const key = JSON.stringify(event);
    if (key === this.lastEventKey) {
      return;
    }
    this.lastEventKey = key;
    this.sink.onConnection(event);
  }
}
