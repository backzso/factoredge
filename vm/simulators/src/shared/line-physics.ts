// Protocol-agnostic physics model of a single production line.
// Both the Modbus (line 1) and MQTT (line 2) simulators drive this module;
// it must not know anything about how its values are exposed.

export type LineState = 'running' | 'stopped' | 'fault';

export const LINE_STATES: readonly LineState[] = ['running', 'stopped', 'fault'];

export function isLineState(value: unknown): value is LineState {
  return typeof value === 'string' && (LINE_STATES as readonly string[]).includes(value);
}

export interface LineSnapshot {
  state: LineState;
  productionCount: number;
  scrapCount: number;
  motorTempC: number;
  motorCurrentA: number;
}

export interface LinePhysicsJSON {
  version: 1;
  state: LineState;
  stateRemainingS: number;
  load: number;
  productionAccumulator: number;
  productionCount: number;
  scrapCount: number;
  motorTempC: number;
}

/** Returns a uniformly distributed number in [0, 1), like Math.random. */
export type RandomFn = () => number;

export interface LinePhysicsOptions {
  random?: RandomFn;
}

const AMBIENT_TEMP_C = 25;

// Hidden load factor: slow reflected random walk that drives all signals.
const LOAD_MIN = 0.8;
const LOAD_MAX = 1.2;
const LOAD_INITIAL = 1.0;
const LOAD_STEP_PER_SQRT_S = 0.02;

const BASE_RATE_PER_S = 1.0;
const SCRAP_PROBABILITY = 0.03;
const FAULT_PROBABILITY = 0.15;

// Rate constants (1/s) for the exponential approach to the target temperature.
const K_HEAT = 0.05;
const K_COOL = 0.01;
const K_FAULT = 0.15;

const STATE_DURATION_S: Record<LineState, readonly [number, number]> = {
  running: [60, 120],
  stopped: [15, 30],
  fault: [20, 30],
};

export class LinePhysics {
  private readonly random: RandomFn;
  private currentState: LineState = 'running';
  private stateRemainingS: number;
  private load = LOAD_INITIAL;
  private productionAccumulator = 0;
  private productionCount = 0;
  private scrapCount = 0;
  private motorTempC = AMBIENT_TEMP_C;

  constructor(options: LinePhysicsOptions = {}) {
    this.random = options.random ?? Math.random;
    this.stateRemainingS = this.drawDuration(this.currentState);
  }

  get state(): LineState {
    return this.currentState;
  }

  /**
   * Advances the simulation by dtSeconds and returns the resulting snapshot.
   * The step is split at state boundaries so the outcome does not depend on
   * how the caller slices time into ticks.
   */
  tick(dtSeconds: number): LineSnapshot {
    if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
      throw new RangeError(`dtSeconds must be a finite non-negative number, got ${dtSeconds}`);
    }

    let remainingS = dtSeconds;
    while (remainingS > 0) {
      const stepS = Math.min(remainingS, this.stateRemainingS);
      this.advance(stepS);
      remainingS -= stepS;
      this.stateRemainingS -= stepS;
      if (this.stateRemainingS <= 0) {
        this.enterState(this.nextState());
      }
    }

    return {
      state: this.currentState,
      productionCount: this.productionCount,
      scrapCount: this.scrapCount,
      motorTempC: this.motorTempC,
      motorCurrentA: this.motorCurrent(),
    };
  }

  /** Forces a state (demo control). The automatic cycle continues from it. */
  setState(state: LineState): void {
    if (!isLineState(state)) {
      throw new TypeError(`unknown line state: ${String(state)}`);
    }
    this.enterState(state);
  }

  toJSON(): LinePhysicsJSON {
    return {
      version: 1,
      state: this.currentState,
      stateRemainingS: this.stateRemainingS,
      load: this.load,
      productionAccumulator: this.productionAccumulator,
      productionCount: this.productionCount,
      scrapCount: this.scrapCount,
      motorTempC: this.motorTempC,
    };
  }

  /** Rebuilds a model from toJSON() output. Throws if the data is invalid. */
  static fromJSON(raw: unknown, options: LinePhysicsOptions = {}): LinePhysics {
    const data = validateJSON(raw);
    const physics = new LinePhysics(options);
    physics.currentState = data.state;
    physics.stateRemainingS = data.stateRemainingS;
    physics.load = data.load;
    physics.productionAccumulator = data.productionAccumulator;
    physics.productionCount = data.productionCount;
    physics.scrapCount = data.scrapCount;
    physics.motorTempC = data.motorTempC;
    return physics;
  }

  private advance(dtS: number): void {
    if (dtS <= 0) return;
    this.walkLoad(dtS);
    if (this.currentState === 'running') {
      this.produce(dtS);
    }
    this.updateTemperature(dtS);
  }

  private walkLoad(dtS: number): void {
    let load = this.load + LOAD_STEP_PER_SQRT_S * Math.sqrt(dtS) * this.uniform(-1, 1);
    if (load > LOAD_MAX) load = 2 * LOAD_MAX - load;
    if (load < LOAD_MIN) load = 2 * LOAD_MIN - load;
    this.load = Math.min(LOAD_MAX, Math.max(LOAD_MIN, load));
  }

  private produce(dtS: number): void {
    this.productionAccumulator += this.load * BASE_RATE_PER_S * dtS;
    while (this.productionAccumulator >= 1) {
      this.productionAccumulator -= 1;
      this.productionCount += 1;
      // Scrap is a subset of produced parts, so scrapCount <= productionCount.
      if (this.random() < SCRAP_PROBABILITY) {
        this.scrapCount += 1;
      }
    }
  }

  private updateTemperature(dtS: number): void {
    const target = this.targetTemperature();
    let k: number;
    if (this.currentState === 'fault') k = K_FAULT;
    else if (target > this.motorTempC) k = K_HEAT;
    else k = K_COOL;
    this.motorTempC += (target - this.motorTempC) * (1 - Math.exp(-k * dtS));
  }

  private targetTemperature(): number {
    switch (this.currentState) {
      case 'running':
        return 50 + 15 * this.load;
      case 'stopped':
        return AMBIENT_TEMP_C;
      case 'fault':
        return 110;
    }
  }

  private motorCurrent(): number {
    switch (this.currentState) {
      case 'running':
        return 10 + 4 * this.load + this.uniform(-0.3, 0.3);
      case 'stopped':
        return this.uniform(0, 0.05);
      case 'fault':
        return 22 + this.uniform(-0.5, 0.5);
    }
  }

  private nextState(): LineState {
    switch (this.currentState) {
      case 'running':
        return this.random() < FAULT_PROBABILITY ? 'fault' : 'stopped';
      case 'fault':
        return 'stopped';
      case 'stopped':
        return 'running';
    }
  }

  private enterState(state: LineState): void {
    this.currentState = state;
    this.stateRemainingS = this.drawDuration(state);
  }

  private drawDuration(state: LineState): number {
    const [min, max] = STATE_DURATION_S[state];
    return this.uniform(min, max);
  }

  private uniform(min: number, max: number): number {
    return min + (max - min) * this.random();
  }
}

function validateJSON(raw: unknown): LinePhysicsJSON {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('line state must be an object');
  }
  const data = raw as Record<string, unknown>;

  if (data.version !== 1) {
    throw new Error(`unsupported line state version: ${String(data.version)}`);
  }
  if (!isLineState(data.state)) {
    throw new Error(`invalid state: ${String(data.state)}`);
  }

  const stateRemainingS = finiteNumber(data, 'stateRemainingS');
  const load = finiteNumber(data, 'load');
  const productionAccumulator = finiteNumber(data, 'productionAccumulator');
  const productionCount = finiteNumber(data, 'productionCount');
  const scrapCount = finiteNumber(data, 'scrapCount');
  const motorTempC = finiteNumber(data, 'motorTempC');

  if (stateRemainingS < 0) throw new Error('stateRemainingS must be >= 0');
  if (load < LOAD_MIN || load > LOAD_MAX) throw new Error(`load out of range: ${load}`);
  if (productionAccumulator < 0 || productionAccumulator >= 1) {
    throw new Error(`productionAccumulator out of range: ${productionAccumulator}`);
  }
  if (!Number.isInteger(productionCount) || productionCount < 0) {
    throw new Error(`productionCount must be a non-negative integer: ${productionCount}`);
  }
  if (!Number.isInteger(scrapCount) || scrapCount < 0 || scrapCount > productionCount) {
    throw new Error(`scrapCount must be an integer in [0, productionCount]: ${scrapCount}`);
  }

  return {
    version: 1,
    state: data.state,
    stateRemainingS,
    load,
    productionAccumulator,
    productionCount,
    scrapCount,
    motorTempC,
  };
}

function finiteNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}
