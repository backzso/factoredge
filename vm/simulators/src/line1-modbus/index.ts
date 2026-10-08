// Line 1 simulator: exposes line physics as a Modbus TCP server.
// SIM_MODE=fixed serves constant golden values to verify encoders/decoders by hand.

import { ServerTCP } from 'modbus-serial';
import { LinePhysics, LineSnapshot, LineState } from '../shared/line-physics';
import { Autosave, loadState, startAutosave } from '../shared/state-store';
import { createServiceVector } from './modbus-vector';
import { encodeSnapshot, RegisterBank } from './register-map';

const SHUTDOWN_TIMEOUT_MS = 3000;
// modbus-serial listens on 127.0.0.1 by default, which is unreachable through a Docker port mapping.
const LISTEN_HOST = '0.0.0.0';

const GOLDEN_SNAPSHOT: LineSnapshot = {
  state: 'running',
  productionCount: 123456789,
  motorTempC: 72.5,
  motorCurrentA: 12.34,
  scrapCount: 42,
};

type SimMode = 'auto' | 'fixed';

interface Config {
  port: number;
  unitId: number;
  tickMs: number;
  simMode: SimMode;
  stateFile: string;
}

function readConfig(): Config {
  const simMode = env('SIM_MODE', 'auto');
  if (simMode !== 'auto' && simMode !== 'fixed') {
    throw new Error(`SIM_MODE must be "auto" or "fixed", got "${simMode}"`);
  }
  return {
    port: intInRange('PORT', '5020', 1, 65535),
    // 0 would make modbus-serial answer every unit id (it treats 0 like 255).
    unitId: intInRange('UNIT_ID', '1', 1, 247),
    tickMs: intInRange('TICK_MS', '1000', 1, Number.MAX_SAFE_INTEGER),
    simMode,
    stateFile: env('STATE_FILE', '/data/line1-state.json'),
  };
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function intInRange(name: string, fallback: string, min: number, max: number): number {
  const raw = env(name, fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got "${raw}"`);
  }
  return value;
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Owns the current snapshot source and the register bank built from it. */
interface Simulation {
  bank(): RegisterBank;
  setState(state: LineState): void;
  stop(): void;
}

function startAutoSimulation(config: Config): Simulation {
  const physics = restorePhysics(config.stateFile);
  const autosave: Autosave = startAutosave(config.stateFile, () => physics.toJSON());

  let lastState = physics.state;
  let lastTickAt = performance.now();
  let bank = encodeSnapshot(physics.tick(0));

  const tick = (): void => {
    const now = performance.now();
    const snapshot = physics.tick((now - lastTickAt) / 1000);
    lastTickAt = now;
    if (snapshot.state !== lastState) {
      console.log(`state: ${lastState} -> ${snapshot.state}`);
      lastState = snapshot.state;
    }
    // Single reference swap: a read sees either the old or the new bank, never a mix.
    bank = encodeSnapshot(snapshot);
  };
  const tickTimer = setInterval(tick, config.tickMs);

  return {
    bank: () => bank,
    setState: (state) => {
      physics.setState(state);
      // Tick right away so a read after the write already sees the new state.
      tick();
    },
    stop: () => {
      clearInterval(tickTimer);
      autosave.stop();
      autosave.flush();
    },
  };
}

function startFixedSimulation(): Simulation {
  console.log(
    `fixed mode: production=${GOLDEN_SNAPSHOT.productionCount} temp=${GOLDEN_SNAPSHOT.motorTempC} ` +
      `current=${GOLDEN_SNAPSHOT.motorCurrentA} scrap=${GOLDEN_SNAPSHOT.scrapCount} (state file not used)`,
  );
  let current = GOLDEN_SNAPSHOT;
  let bank = encodeSnapshot(current);

  return {
    bank: () => bank,
    setState: (state) => {
      if (state !== current.state) {
        console.log(`state: ${current.state} -> ${state}`);
      }
      current = { ...current, state };
      bank = encodeSnapshot(current);
    },
    stop: () => {},
  };
}

async function main(): Promise<void> {
  const config = readConfig();
  console.log(
    `line1-sim: port=${config.port} unit=${config.unitId} mode=${config.simMode} tick=${config.tickMs}ms state=${config.stateFile}`,
  );

  const simulation = config.simMode === 'auto' ? startAutoSimulation(config) : startFixedSimulation();

  const vector = createServiceVector({
    getBank: () => simulation.bank(),
    onStateWrite: (state) => {
      console.log(`write: state=${state}`);
      simulation.setState(state);
    },
  });

  // Requests for any other unit id are dropped silently by modbus-serial (no response).
  const server = new ServerTCP(vector, { host: LISTEN_HOST, port: config.port, unitID: config.unitId });

  server.on('initialized', () => {
    console.log(`modbus: listening on ${LISTEN_HOST}:${config.port}`);
  });
  server.on('serverError', (err) => {
    console.error(`modbus: server error: ${errorMessage(err)}`);
    process.exit(1);
  });
  server.on('socketError', (err) => {
    console.warn(`modbus: socket error: ${errorMessage(err)}`);
  });
  server.on('error', (err) => {
    console.error(`modbus: ${errorMessage(err)}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`shutdown: ${signal} received`);

    const forceExit = setTimeout(() => {
      console.error('shutdown: timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    simulation.stop();
    // close() also destroys open client sockets.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    console.log('shutdown: done');
    process.exit(0);
  };

  process.on('SIGTERM', (signal) => void shutdown(signal));
  process.on('SIGINT', (signal) => void shutdown(signal));
}

main().catch((err: unknown) => {
  console.error(`line1-sim: fatal: ${errorMessage(err)}`);
  process.exit(1);
});
