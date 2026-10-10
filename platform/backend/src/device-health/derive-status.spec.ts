import { deriveStatus, type StatusInput } from './derive-status';

const STALE_AFTER = 3_000;
const T0 = new Date('2026-10-08T12:00:00.000Z').getTime();

/** Fake clock: milliseconds after T0. */
const at = (ms: number) => new Date(T0 + ms);

function status(input: Partial<StatusInput>, nowMs: number) {
  return deriveStatus(
    { connection: 'connected', staleAfterMs: STALE_AFTER, ...input },
    at(nowMs),
  );
}

describe('deriveStatus', () => {
  it('connecting → CONNECTING, even with recent data', () => {
    expect(status({ connection: 'connecting' }, 0)).toBe('CONNECTING');
    expect(status({ connection: 'connecting', lastSeenAt: at(0) }, 100)).toBe(
      'CONNECTING',
    );
  });

  describe('retrying after a disconnect', () => {
    it('stays OFFLINE when a reconnect attempt starts (no OFFLINE → CONNECTING flap)', () => {
      expect(
        status({ connection: 'connecting', previousStatus: 'OFFLINE' }, 0),
      ).toBe('OFFLINE');
    });

    it('leaves OFFLINE only once connected, then goes ONLINE with data', () => {
      const connected = {
        connectedAt: at(0),
        previousStatus: 'OFFLINE' as const,
      };
      expect(status(connected, 100)).toBe('CONNECTING');
      expect(status({ ...connected, lastSeenAt: at(200) }, 200)).toBe('ONLINE');
    });

    it('goes back to OFFLINE when a connected device drops again', () => {
      expect(
        status({ connection: 'disconnected', previousStatus: 'CONNECTING' }, 0),
      ).toBe('OFFLINE');
    });

    it('keeps the initial CONNECTING of a fresh connector', () => {
      expect(status({ connection: 'connecting' }, 0)).toBe('CONNECTING');
      expect(
        status({ connection: 'connecting', previousStatus: 'CONNECTING' }, 0),
      ).toBe('CONNECTING');
    });

    it.each(['ONLINE', 'STALE'] as const)(
      'connecting after %s is CONNECTING (only OFFLINE is sticky)',
      (previousStatus) => {
        expect(status({ connection: 'connecting', previousStatus }, 0)).toBe(
          'CONNECTING',
        );
      },
    );
  });

  it('disconnected → OFFLINE, even with recent data', () => {
    expect(status({ connection: 'disconnected', lastSeenAt: at(0) }, 100)).toBe(
      'OFFLINE',
    );
  });

  describe('connected', () => {
    it('is CONNECTING during the grace period before the first sample', () => {
      expect(status({ connectedAt: at(0) }, 0)).toBe('CONNECTING');
      expect(status({ connectedAt: at(0) }, STALE_AFTER)).toBe('CONNECTING');
    });

    it('becomes STALE when no sample arrived within the grace period', () => {
      expect(status({ connectedAt: at(0) }, STALE_AFTER + 1)).toBe('STALE');
    });

    it('is ONLINE while the last sample is fresh (boundary inclusive)', () => {
      const input = { connectedAt: at(0), lastSeenAt: at(1_000) };
      expect(status(input, 1_000)).toBe('ONLINE');
      expect(status(input, 1_000 + STALE_AFTER)).toBe('ONLINE');
    });

    it('goes ONLINE → STALE when samples stop', () => {
      const input = { connectedAt: at(0), lastSeenAt: at(1_000) };
      expect(status(input, 1_000 + STALE_AFTER + 1)).toBe('STALE');
    });

    it('goes STALE → ONLINE when samples resume', () => {
      expect(status({ connectedAt: at(0), lastSeenAt: at(500) }, 10_000)).toBe(
        'STALE',
      );
      expect(
        status({ connectedAt: at(0), lastSeenAt: at(10_000) }, 10_000),
      ).toBe('ONLINE');
    });

    it('uses the grace period again after a reconnect with old data', () => {
      const input = { connectedAt: at(20_000), lastSeenAt: at(1_000) };
      expect(status(input, 21_000)).toBe('CONNECTING');
      expect(status(input, 20_000 + STALE_AFTER + 1)).toBe('STALE');
    });

    it('is STALE without connectedAt or data', () => {
      expect(status({}, 0)).toBe('STALE');
    });
  });
});
