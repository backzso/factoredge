import { describe, expect, it } from 'vitest';
import { LinePhysics, LineSnapshot, RandomFn } from './line-physics';

// Small seeded PRNG so tests are reproducible.
function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(physics: LinePhysics, seconds: number, dtSeconds = 1): LineSnapshot[] {
  const snapshots: LineSnapshot[] = [];
  for (let t = 0; t < seconds; t += dtSeconds) {
    snapshots.push(physics.tick(dtSeconds));
  }
  return snapshots;
}

describe('LinePhysics', () => {
  it.each(['stopped', 'fault'] as const)('does not count production or scrap while %s', (state) => {
    const physics = new LinePhysics({ random: mulberry32(1) });
    const before = run(physics, 50).at(-1)!;
    expect(before.productionCount).toBeGreaterThan(0);

    physics.setState(state);
    // Shorter than the minimum duration of both states (15 s / 20 s).
    const during = run(physics, 14, 0.5);

    for (const snapshot of during) {
      expect(snapshot.state).toBe(state);
      expect(snapshot.productionCount).toBe(before.productionCount);
      expect(snapshot.scrapCount).toBe(before.scrapCount);
    }
  });

  it('heats towards the target while running and cools while stopped', () => {
    const physics = new LinePhysics({ random: mulberry32(2) });

    // First 40 s of running from ambient: strictly increasing, below the target band.
    const heating = run(physics, 40);
    expect(heating[0].motorTempC).toBeGreaterThan(25);
    for (let i = 1; i < heating.length; i++) {
      expect(heating[i].state).toBe('running');
      expect(heating[i].motorTempC).toBeGreaterThan(heating[i - 1].motorTempC);
    }

    // Keep it running long enough to settle: target is 50 + 15 * L with L in [0.8, 1.2].
    for (let i = 0; i < 5; i++) {
      physics.setState('running');
      run(physics, 50);
    }
    const settled = physics.tick(1);
    expect(settled.motorTempC).toBeGreaterThan(61);
    expect(settled.motorTempC).toBeLessThan(68.5);

    physics.setState('stopped');
    const cooling = run(physics, 14);
    let previous = settled.motorTempC;
    for (const snapshot of cooling) {
      expect(snapshot.state).toBe('stopped');
      expect(snapshot.motorTempC).toBeLessThan(previous);
      previous = snapshot.motorTempC;
    }
  });

  it('never reports more scrap than production', () => {
    const physics = new LinePhysics({ random: mulberry32(3) });
    const snapshots = run(physics, 4 * 3600);
    for (const snapshot of snapshots) {
      expect(snapshot.scrapCount).toBeLessThanOrEqual(snapshot.productionCount);
    }
    expect(snapshots.at(-1)!.scrapCount).toBeGreaterThan(0);

    // Worst case: every random draw is 0, so every produced part is scrap.
    const allScrap = new LinePhysics({ random: () => 0 });
    for (const snapshot of run(allScrap, 600)) {
      expect(snapshot.scrapCount).toBe(snapshot.productionCount);
    }
  });

  it('preserves counters through toJSON -> fromJSON', () => {
    const physics = new LinePhysics({ random: mulberry32(4) });
    run(physics, 300);
    const saved = physics.toJSON();

    const restored = LinePhysics.fromJSON(JSON.parse(JSON.stringify(saved)));

    expect(restored.toJSON()).toEqual(saved);
    expect(restored.state).toBe(saved.state);
    const next = restored.tick(0);
    expect(next.productionCount).toBe(saved.productionCount);
    expect(next.scrapCount).toBe(saved.scrapCount);
  });

  it('rejects invalid serialized state', () => {
    const valid = new LinePhysics({ random: mulberry32(5) }).toJSON();
    expect(() => LinePhysics.fromJSON(null)).toThrow();
    expect(() => LinePhysics.fromJSON({ ...valid, version: 2 })).toThrow();
    expect(() => LinePhysics.fromJSON({ ...valid, state: 'paused' })).toThrow();
    expect(() => LinePhysics.fromJSON({ ...valid, productionCount: '10' })).toThrow();
    expect(() => LinePhysics.fromJSON({ ...valid, productionCount: 5, scrapCount: 6 })).toThrow();
  });

  it('is deterministic with an injected random source', () => {
    const dts = Array.from({ length: 500 }, (_, i) => 0.25 + (i % 7) * 0.5);
    const simulate = () => {
      const physics = new LinePhysics({ random: mulberry32(42) });
      return dts.map((dt) => physics.tick(dt));
    };
    const first = simulate();
    expect(simulate()).toEqual(first);
    expect(new Set(first.map((s) => s.state)).size).toBeGreaterThan(1);
  });

  it('cycles running -> fault -> stopped -> running and resumes after setState', () => {
    // random() = 0 gives minimum durations and always picks fault after running.
    const physics = new LinePhysics({ random: () => 0 });
    expect(physics.tick(59).state).toBe('running');
    expect(physics.tick(1).state).toBe('fault');
    expect(physics.tick(20).state).toBe('stopped');
    expect(physics.tick(15).state).toBe('running');

    physics.setState('fault');
    expect(physics.tick(19).state).toBe('fault');
    expect(physics.tick(1).state).toBe('stopped');
  });
});
