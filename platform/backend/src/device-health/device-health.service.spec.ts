import {
  type RealtimeEvent,
  RealtimeService,
} from '../realtime/realtime.service';
import { DeviceHealthService } from './device-health.service';

const DEVICE_ID = 'device-1';

describe('DeviceHealthService', () => {
  let health: DeviceHealthService;
  let statuses: string[];

  beforeEach(() => {
    const realtime = new RealtimeService();
    statuses = [];
    realtime.events$.subscribe((event: RealtimeEvent) => {
      if (event.type === 'status') statuses.push(event.data.status);
    });
    health = new DeviceHealthService(realtime);
  });

  it('publishes no status flaps while a connector keeps retrying', () => {
    health.reset(DEVICE_ID, 3_000);
    health.onConnection(DEVICE_ID, { type: 'connecting' });
    health.onConnection(DEVICE_ID, {
      type: 'disconnected',
      error: 'connect ECONNREFUSED',
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      health.onConnection(DEVICE_ID, { type: 'connecting' });
      health.onConnection(DEVICE_ID, {
        type: 'disconnected',
        error: 'connect ECONNREFUSED',
      });
    }
    health.onConnection(DEVICE_ID, { type: 'connecting' });

    expect(statuses).toEqual(['CONNECTING', 'OFFLINE']);
    expect(health.get(DEVICE_ID)).toEqual({
      status: 'OFFLINE',
      lastSeenAt: null,
      lastError: 'connect ECONNREFUSED',
    });

    health.onConnection(DEVICE_ID, { type: 'connected' });
    health.recordData(DEVICE_ID, new Date());

    expect(statuses).toEqual(['CONNECTING', 'OFFLINE', 'CONNECTING', 'ONLINE']);
    expect(health.get(DEVICE_ID)?.lastError).toBeNull();
  });

  it('starts every (re)started connector in CONNECTING, even after OFFLINE', () => {
    health.reset(DEVICE_ID, 3_000);
    health.onConnection(DEVICE_ID, { type: 'disconnected', error: 'down' });

    health.reset(DEVICE_ID, 3_000);

    expect(statuses).toEqual(['CONNECTING', 'OFFLINE', 'CONNECTING']);
    expect(health.get(DEVICE_ID)?.lastError).toBeNull();
  });
});
