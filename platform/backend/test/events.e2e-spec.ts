import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import {
  CONNECTOR_FACTORY,
  ConnectorManager,
} from '../src/connectors/connector-manager.service';
import type {
  ConnectorFactory,
  ConnectorSink,
  TelemetrySample,
} from '../src/connectors/connector.types';
import { DEVICE_TEMPLATES } from '../src/devices/device-config.schema';
import type { EventDto } from '../src/events/event-types';
import { EventsService } from '../src/events/events.service';
import { EventSeverity, LineState, Role } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { type LiveStream, openStream } from './live-stream';

const PASSWORD = 'correct-horse-battery';

// Connectors do nothing on their own; the tests drive them through their sink.
const sinks = new Map<string, ConnectorSink>();
const capturingConnectorFactory: ConnectorFactory = (
  _config,
  sink,
  { tag },
) => {
  sinks.set(tag, sink);
  return { start: () => undefined, stop: () => Promise.resolve() };
};

const modbusDevice = (name = 'Line 1') => ({
  name,
  protocol: 'MODBUS',
  config: { ...DEVICE_TEMPLATES.MODBUS, host: '127.0.0.1' },
});

const sample = (
  state: LineState = LineState.RUNNING,
  motorTempC = 60,
): TelemetrySample => ({
  ts: new Date(),
  productionCount: 1,
  scrapCount: 0,
  motorTempC,
  motorCurrentA: 12,
  state,
});

describe('Event log (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let events: EventsService;
  let baseUrl: string;
  const streams: LiveStream[] = [];

  const passwordHash = hashPassword(PASSWORD);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONNECTOR_FACTORY)
      .useValue(capturingConnectorFactory)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    events = app.get(EventsService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "events", "readings", "devices", "users" CASCADE`;
    sinks.clear();
  });

  afterEach(() => {
    streams.splice(0).forEach((stream) => stream.close());
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function loginAs(username: string, role: Role) {
    const user = await prisma.user.create({
      data: { username, role, passwordHash: await passwordHash },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ username, password: PASSWORD })
      .expect(200);
    const header = res.headers['set-cookie'] as unknown as string[];
    return { id: user.id, cookie: header[0].split(';')[0] };
  }

  async function streamAs(cookie: string): Promise<LiveStream> {
    const stream = await openStream(baseUrl, { Cookie: cookie });
    streams.push(stream);
    return stream;
  }

  async function listEvents(cookie: string, query = ''): Promise<EventDto[]> {
    await events.flush();
    const res = await http()
      .get(`/api/events${query}`)
      .set('Cookie', cookie)
      .expect(200);
    return res.body.items as EventDto[];
  }

  async function createDevice(cookie: string, name = 'Line 1') {
    const res = await http()
      .post('/api/devices')
      .set('Cookie', cookie)
      .send(modbusDevice(name))
      .expect(201);
    const id = res.body.id as string;
    await app.get(ConnectorManager).whenIdle(id);
    return { id, sink: sinks.get(id.slice(0, 8))! };
  }

  describe('admin actions', () => {
    it('records device create, update and delete with the actor; events outlive the device', async () => {
      const admin = await loginAs('admin', Role.ADMIN);
      const { id } = await createDevice(admin.cookie);
      await http()
        .patch(`/api/devices/${id}`)
        .set('Cookie', admin.cookie)
        .send({ name: 'Line 1b', enabled: false })
        .expect(200);
      // Same values again: nothing changed, nothing recorded.
      await http()
        .patch(`/api/devices/${id}`)
        .set('Cookie', admin.cookie)
        .send({ name: 'Line 1b' })
        .expect(200);

      const before = await listEvents(admin.cookie, `?deviceId=${id}`);
      expect(
        before.filter((e) => e.type.startsWith('device.')).map((e) => e.type),
      ).toEqual(['device.updated', 'device.created']);
      expect(before.find((e) => e.type === 'device.updated')).toMatchObject({
        severity: EventSeverity.INFO,
        deviceId: id,
        data: {
          deviceName: 'Line 1b',
          previousName: 'Line 1',
          changes: ['name', 'enabled'],
          enabled: false,
          actorUsername: 'admin',
        },
      });

      await http()
        .delete(`/api/devices/${id}`)
        .set('Cookie', admin.cookie)
        .expect(204);

      const after = await listEvents(admin.cookie);
      expect(after[0]).toMatchObject({
        type: 'device.deleted',
        deviceId: null,
        data: {
          deviceName: 'Line 1b',
          protocol: 'MODBUS',
          actorUsername: 'admin',
        },
      });
      // The earlier events stay, detached from the deleted device, names intact.
      const created = after.find((e) => e.type === 'device.created');
      expect(created).toMatchObject({
        deviceId: null,
        data: { deviceName: 'Line 1', actorUsername: 'admin' },
      });
      expect(
        await prisma.event.count({ where: { deviceId: { not: null } } }),
      ).toBe(0);
    });

    it('shows user.* events to ADMIN only', async () => {
      const admin = await loginAs('admin', Role.ADMIN);
      const viewer = await loginAs('viewer', Role.VIEWER);
      const engineer = await loginAs('engineer', Role.ENGINEER);

      const created = await http()
        .post('/api/users')
        .set('Cookie', admin.cookie)
        .send({ username: 'alice', password: PASSWORD, role: Role.VIEWER })
        .expect(201);
      await http()
        .patch(`/api/users/${created.body.id}`)
        .set('Cookie', admin.cookie)
        .send({ role: Role.ENGINEER, password: 'another-long-password' })
        .expect(200);
      await http()
        .delete(`/api/users/${created.body.id}`)
        .set('Cookie', admin.cookie)
        .expect(204);
      await createDevice(admin.cookie);

      const adminView = await listEvents(admin.cookie);
      expect(adminView.map((e) => e.type)).toEqual([
        'device.created',
        'user.deleted',
        'user.password_reset',
        'user.role_changed',
        'user.created',
      ]);
      expect(
        adminView.find((e) => e.type === 'user.role_changed')?.data,
      ).toEqual({
        targetUsername: 'alice',
        previousRole: 'VIEWER',
        role: 'ENGINEER',
        actorUsername: 'admin',
      });
      // The actor is stored as user_id.
      expect(await prisma.event.count({ where: { userId: admin.id } })).toBe(5);

      for (const cookie of [viewer.cookie, engineer.cookie]) {
        expect((await listEvents(cookie)).map((e) => e.type)).toEqual([
          'device.created',
        ]);
      }
    });
  });

  describe('live changes', () => {
    it('records health and fault transitions with the device name, not the startup noise', async () => {
      const admin = await loginAs('admin', Role.ADMIN);
      const { id, sink } = await createDevice(admin.cookie, 'Press');

      sink.onConnection({ type: 'connected' });
      sink.onTelemetry(sample(LineState.RUNNING));
      sink.onTelemetry(sample(LineState.STOPPED));
      sink.onTelemetry(sample(LineState.FAULT));
      sink.onTelemetry(sample(LineState.STOPPED));
      sink.onConnection({ type: 'disconnected', error: 'ECONNRESET' });
      sink.onConnection({ type: 'connecting' });
      sink.onConnection({ type: 'connected' });
      sink.onTelemetry(sample(LineState.RUNNING));

      const items = await listEvents(admin.cookie, `?deviceId=${id}`);
      expect(
        items
          .filter((e) => e.type !== 'device.created')
          .reverse()
          .map((e) => [e.type, e.severity, e.data]),
      ).toEqual([
        [
          'line.fault_started',
          EventSeverity.CRITICAL,
          { deviceName: 'Press', previousState: 'STOPPED' },
        ],
        [
          'line.fault_cleared',
          EventSeverity.INFO,
          { deviceName: 'Press', state: 'STOPPED' },
        ],
        [
          'device.status_changed',
          EventSeverity.WARNING,
          {
            deviceName: 'Press',
            from: 'ONLINE',
            to: 'OFFLINE',
            error: 'ECONNRESET',
          },
        ],
        [
          'device.status_changed',
          EventSeverity.INFO,
          { deviceName: 'Press', from: 'OFFLINE', to: 'ONLINE' },
        ],
      ]);
    });
  });

  describe('temperature alarm', () => {
    it('raises at 90 °C, stays open above 85 °C, clears at 85 °C, with events and live state', async () => {
      const admin = await loginAs('admin', Role.ADMIN);
      const { id, sink } = await createDevice(admin.cookie, 'Oven');
      sink.onConnection({ type: 'connected' });

      sink.onTelemetry(sample(LineState.RUNNING, 70));
      sink.onTelemetry(sample(LineState.FAULT, 95));
      sink.onTelemetry(sample(LineState.FAULT, 101.5));
      sink.onTelemetry(sample(LineState.STOPPED, 88)); // between the thresholds: still open

      const device = await http()
        .get(`/api/devices/${id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(device.body.alarm).toEqual({
        signal: 'motorTempC',
        raisedAt: expect.any(String),
        peakC: 101.5,
        raiseC: 90,
        clearC: 85,
      });
      // A stream opened now gets the open alarm in its snapshot.
      const tab = await streamAs(admin.cookie);
      const snapshot = tab.events[0].data as {
        devices: Array<{ deviceId: string; alarm: unknown }>;
      };
      expect(snapshot.devices.find((d) => d.deviceId === id)?.alarm).toEqual(
        device.body.alarm,
      );

      sink.onTelemetry(sample(LineState.STOPPED, 85));
      // The clearing sample carries the cleared alarm.
      const cleared = await tab.waitFor('telemetry');
      expect(cleared.data).toMatchObject({
        deviceId: id,
        reading: { motorTempC: 85 },
        alarm: null,
      });

      const alarmEvents = (await listEvents(admin.cookie, `?deviceId=${id}`))
        .filter((e) => e.type.startsWith('alarm.'))
        .reverse();
      expect(alarmEvents.map((e) => [e.type, e.severity, e.data])).toEqual([
        [
          'alarm.raised',
          EventSeverity.CRITICAL,
          {
            deviceName: 'Oven',
            signal: 'motorTempC',
            valueC: 95,
            raiseC: 90,
            clearC: 85,
          },
        ],
        [
          'alarm.cleared',
          EventSeverity.INFO,
          {
            deviceName: 'Oven',
            signal: 'motorTempC',
            valueC: 85,
            peakC: 101.5,
            clearC: 85,
            raisedAt: device.body.alarm.raisedAt,
          },
        ],
      ]);
      const after = await http()
        .get(`/api/devices/${id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(after.body.alarm).toBeNull();
    });
    it('never lets a client see a reading above the peak it knows: each telemetry message is consistent on its own', async () => {
      const admin = await loginAs('admin', Role.ADMIN);
      const { id, sink } = await createDevice(admin.cookie, 'Kiln');
      sink.onConnection({ type: 'connected' });
      const tab = await streamAs(admin.cookie);

      const temps = [70, 95, 101.5, 104.2, 106.4, 99, 88, 84];
      for (const temp of temps) {
        sink.onTelemetry(sample(LineState.FAULT, temp));
      }
      // Wait for the last sample's telemetry, then a moment for anything
      // published right after it (publishing is synchronous per sample).
      const deadline = Date.now() + 3_000;
      while (
        !tab.events.some(
          (e) =>
            e.type === 'telemetry' &&
            (e.data as { reading: { motorTempC: number } }).reading
              .motorTempC === 84,
        )
      ) {
        if (Date.now() > deadline) throw new Error('last sample not streamed');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Replay the stream as the browser applies it, one message at a time.
      // The UI may render between any two messages.
      let peak: number | null = null;
      const seen: number[] = [];
      for (const event of tab.events) {
        const data = event.data as {
          deviceId?: string;
          reading?: { motorTempC: number };
          alarm?: { peakC: number } | null;
        };
        if (data?.deviceId !== id) continue;
        if ('alarm' in data) peak = data.alarm?.peakC ?? null;
        if (event.type === 'telemetry') {
          const temp = data.reading!.motorTempC;
          seen.push(temp);
          if (temp >= 90) {
            expect({ temp, peak }).toEqual({ temp, peak: expect.any(Number) });
          }
          if (peak !== null) {
            expect({ temp, peakAtLeastTemp: peak >= temp }).toEqual({
              temp,
              peakAtLeastTemp: true,
            });
          }
        }
      }
      expect(seen).toEqual(temps);
      expect(peak).toBeNull();
    });
  });

  describe('live stream', () => {
    it('sends user.* events only to admins, following a role change', async () => {
      const admin = await loginAs('admin', Role.ADMIN);
      const viewer = await loginAs('viewer', Role.VIEWER);
      const adminTab = await streamAs(admin.cookie);
      const viewerTab = await streamAs(viewer.cookie);

      await http()
        .post('/api/users')
        .set('Cookie', admin.cookie)
        .send({ username: 'alice', password: PASSWORD, role: Role.VIEWER })
        .expect(201);
      // An event everyone sees, recorded after the user event: once it has
      // arrived, the user event would have arrived before it.
      await createDevice(admin.cookie);
      await events.flush();

      const eventTypes = (tab: LiveStream) =>
        tab.events
          .filter((e) => e.type === 'event')
          .map((e) => (e.data as EventDto).type);
      await viewerTab.waitFor('event');
      await adminTab.waitFor('event');
      expect(eventTypes(viewerTab)).toEqual(['device.created']);
      expect(eventTypes(adminTab)).toEqual(['user.created', 'device.created']);

      // Promoted: the same open stream now gets user.* events, starting with
      // the one about the promotion itself.
      await http()
        .patch(`/api/users/${viewer.id}`)
        .set('Cookie', admin.cookie)
        .send({ role: Role.ADMIN })
        .expect(200);
      await viewerTab.waitFor('session-changed');
      await events.flush();
      const changedAt = viewerTab.events.findIndex(
        (e) => e.type === 'session-changed',
      );
      await viewerTab.waitFor('event', 2_000, changedAt);
      expect(eventTypes(viewerTab)).toEqual([
        'device.created',
        'user.role_changed',
      ]);
    });
  });

  describe('GET /api/events', () => {
    async function seed(deviceId: string | null, count: number, ts: Date) {
      await prisma.event.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          type: 'device.status_changed',
          severity: EventSeverity.INFO,
          deviceId,
          data: { n: i },
          message: 'seeded',
          ts,
        })),
      });
    }

    it('pages newest first with a cursor, also across equal timestamps', async () => {
      const admin = await loginAs('admin', Role.ADMIN);
      // 3 events share one timestamp: the id breaks the tie.
      await seed(null, 3, new Date('2026-10-11T10:00:00.000Z'));
      await seed(null, 2, new Date('2026-10-11T09:00:00.000Z'));

      const seen: EventDto[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = cursor
          ? `?limit=2&before=${encodeURIComponent(cursor)}`
          : '?limit=2';
        const res = await http()
          .get(`/api/events${query}`)
          .set('Cookie', admin.cookie)
          .expect(200);
        seen.push(...(res.body.items as EventDto[]));
        cursor = res.body.nextCursor as string | null;
        pages += 1;
      } while (cursor);

      expect(pages).toBe(3);
      expect(new Set(seen.map((e) => e.id)).size).toBe(5);
      const order = seen.map((e) => `${e.ts}|${e.id}`);
      expect(order).toEqual([...order].sort().reverse());
    });

    it('filters by device and validates the query', async () => {
      const admin = await loginAs('admin', Role.ADMIN);
      const { id } = await createDevice(admin.cookie);
      await seed(id, 2, new Date());
      await seed(null, 3, new Date());

      const items = await listEvents(admin.cookie, `?deviceId=${id}`);
      expect(items.every((e) => e.deviceId === id)).toBe(true);
      expect(items).toHaveLength(3); // 2 seeded + device.created

      for (const query of [
        '?limit=0',
        '?limit=201',
        '?deviceId=nope',
        '?before=not-a-cursor',
        '?unknown=1',
      ]) {
        await http()
          .get(`/api/events${query}`)
          .set('Cookie', admin.cookie)
          .expect(400);
      }
      await http().get('/api/events').expect(401);
    });
  });
});
