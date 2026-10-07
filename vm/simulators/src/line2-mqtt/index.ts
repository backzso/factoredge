// Line 2 simulator: publishes line physics as MQTT telemetry and accepts
// state commands for demo control.

import { connect } from 'mqtt';
import { isLineState, LinePhysics, LineSnapshot, LineState } from '../shared/line-physics';
import { loadState, startAutosave } from '../shared/state-store';

const SHUTDOWN_TIMEOUT_MS = 3000;
const RECONNECT_PERIOD_MS = 2000;

interface Config {
  mqttUrl: string;
  topicPrefix: string;
  tickMs: number;
  stateFile: string;
}

function readConfig(): Config {
  const tickRaw = env('TICK_MS', '1000');
  const tickMs = Number(tickRaw);
  if (!Number.isInteger(tickMs) || tickMs <= 0) {
    throw new Error(`TICK_MS must be a positive integer, got "${tickRaw}"`);
  }
  return {
    mqttUrl: env('MQTT_URL', 'mqtt://mosquitto:1883'),
    topicPrefix: env('TOPIC_PREFIX', 'factory/line2'),
    tickMs,
    stateFile: env('STATE_FILE', '/data/line2-state.json'),
  };
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function restorePhysics(stateFile: string): LinePhysics {
  const restored = loadState(stateFile, (raw) => LinePhysics.fromJSON(raw));
  if (restored) {
    const saved = restored.toJSON();
    console.log(`restored: production=${saved.productionCount} scrap=${saved.scrapCount}`);
    return restored;
  }
  console.log('fresh start');
  return new LinePhysics();
}

function toTelemetry(snapshot: LineSnapshot, seq: number) {
  return {
    ts: new Date().toISOString(),
    seq,
    state: snapshot.state,
    productionCount: snapshot.productionCount,
    motorTempC: round2(snapshot.motorTempC),
    motorCurrentA: round2(snapshot.motorCurrentA),
    scrapCount: snapshot.scrapCount,
  };
}

function parseCommand(payload: Buffer): LineState {
  let message: unknown;
  try {
    message = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new Error('payload is not valid JSON');
  }
  if (typeof message !== 'object' || message === null || !('setState' in message)) {
    throw new Error('expected an object with a "setState" field');
  }
  const target = (message as { setState: unknown }).setState;
  if (!isLineState(target)) {
    throw new Error(`unknown setState value: ${JSON.stringify(target)}`);
  }
  return target;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const config = readConfig();
  const telemetryTopic = `${config.topicPrefix}/telemetry`;
  const statusTopic = `${config.topicPrefix}/status`;
  const commandTopic = `${config.topicPrefix}/command`;

  console.log(
    `line2-sim: broker=${config.mqttUrl} prefix=${config.topicPrefix} tick=${config.tickMs}ms state=${config.stateFile}`,
  );

  const physics = restorePhysics(config.stateFile);
  const autosave = startAutosave(config.stateFile, () => physics.toJSON());

  const client = connect(config.mqttUrl, {
    clientId: 'line2-sim',
    reconnectPeriod: RECONNECT_PERIOD_MS,
    connectTimeout: 5000,
    // Published by the broker only if we vanish without a clean DISCONNECT.
    will: { topic: statusTopic, payload: Buffer.from('offline'), qos: 1, retain: true },
  });

  let wasConnected = false;
  let lastError = '';
  let shuttingDown = false;

  client.on('connect', () => {
    wasConnected = true;
    lastError = '';
    console.log(`mqtt: connected to ${config.mqttUrl}`);
    client.publish(statusTopic, 'online', { qos: 1, retain: true }, (err) => {
      if (err) console.error(`mqtt: status publish failed: ${err.message}`);
    });
    // Subscribing on every connect refreshes the subscription after a broker restart.
    client.subscribe(commandTopic, { qos: 1 }, (err) => {
      if (err) console.error(`mqtt: subscribe to ${commandTopic} failed: ${err.message}`);
    });
  });

  client.on('close', () => {
    if (wasConnected && !shuttingDown) {
      wasConnected = false;
      console.log(`mqtt: disconnected, retrying every ${RECONNECT_PERIOD_MS}ms`);
    }
  });

  client.on('error', (err) => {
    // Repeated while the broker is down; log each distinct error once.
    if (err.message !== lastError) {
      lastError = err.message;
      console.error(`mqtt: ${err.message}`);
    }
  });

  client.on('message', (topic, payload) => {
    if (topic !== commandTopic) return;
    try {
      const target = parseCommand(payload);
      console.log(`command: setState=${target}`);
      physics.setState(target);
    } catch (err) {
      console.warn(`command: ignored invalid message (${errorMessage(err)}): ${payload.toString('utf8').slice(0, 200)}`);
    }
  });

  let seq = 0;
  let lastState = physics.state;
  let lastTickAt = performance.now();

  const tickTimer = setInterval(() => {
    const now = performance.now();
    const snapshot = physics.tick((now - lastTickAt) / 1000);
    lastTickAt = now;

    if (snapshot.state !== lastState) {
      console.log(`state: ${lastState} -> ${snapshot.state}`);
      lastState = snapshot.state;
    }

    // No buffering while offline: skipping here also keeps mqtt.js from
    // queueing QoS 1 messages in memory.
    if (!client.connected) return;

    seq += 1;
    client.publish(telemetryTopic, JSON.stringify(toTelemetry(snapshot, seq)), { qos: 1 }, (err) => {
      if (err) console.error(`mqtt: telemetry publish failed: ${err.message}`);
    });
  }, config.tickMs);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`shutdown: ${signal} received`);

    const forceExit = setTimeout(() => {
      console.error('shutdown: timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    clearInterval(tickTimer);
    autosave.stop();
    // Save first so persistence never depends on the broker answering.
    autosave.flush();

    // A clean DISCONNECT suppresses the Last Will, so announce offline ourselves.
    if (client.connected) {
      try {
        await client.publishAsync(statusTopic, 'offline', { qos: 1, retain: true });
      } catch (err) {
        console.error(`shutdown: offline publish failed: ${errorMessage(err)}`);
      }
    }

    await client.endAsync();
    console.log('shutdown: done');
    process.exit(0);
  };

  process.on('SIGTERM', (signal) => void shutdown(signal));
  process.on('SIGINT', (signal) => void shutdown(signal));
}

main().catch((err: unknown) => {
  console.error(`line2-sim: fatal: ${errorMessage(err)}`);
  process.exit(1);
});
