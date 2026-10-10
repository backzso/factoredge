import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { CONNECTOR_FACTORY } from '../src/connectors/connector-manager.service';
import type { ConnectorFactory } from '../src/connectors/connector.types';
import { DEVICE_TEMPLATES } from '../src/devices/device-config.schema';
import { Role } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'correct-horse-battery';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

// No real network connections from the e2e tests.
const noopConnectorFactory: ConnectorFactory = () => ({
  start: () => undefined,
  stop: () => Promise.resolve(),
});

const modbusDevice = (name = 'Line 1') => ({
  name,
  protocol: 'MODBUS',
  config: { ...DEVICE_TEMPLATES.MODBUS, host: '127.0.0.1' },
});

const mqttDevice = (name = 'Line 2') => ({
  name,
  protocol: 'MQTT',
  config: { brokerUrl: 'mqtt://127.0.0.1:1883', topicPrefix: 'factory/line2' },
});

describe('Devices, readings and stream (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONNECTOR_FACTORY)
      .useValue(noopConnectorFactory)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    // Listening on a real port so the SSE test can use fetch and read the stream.
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "events", "readings", "devices", "users" CASCADE`;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const passwordHash = hashPassword(PASSWORD);

  async function loginAs(username: string, role: Role): Promise<string> {
    await prisma.user.create({
      data: { username, role, passwordHash: await passwordHash },
    });
    const res = await http()
      .post('/api/auth/login')
      .send({ username, password: PASSWORD })
      .expect(200);
    const header = res.headers['set-cookie'] as unknown as string[];
    return header[0].split(';')[0];
  }

  describe('authentication', () => {
    it('requires a login for devices, readings and the stream', async () => {
      await http().get('/api/devices').expect(401);
      await http().get(`/api/devices/${UNKNOWN_ID}/readings`).expect(401);
      await http().get('/api/stream').expect(401);
    });

    it('does not send X-Powered-By', async () => {
      const res = await http().get('/api/health').expect(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('as VIEWER', () => {
    let viewer: string;

    beforeEach(async () => {
      viewer = await loginAs('viewer', Role.VIEWER);
    });

    it('can read devices and templates', async () => {
      await http().get('/api/devices').set('Cookie', viewer).expect(200, []);
      const templates = await http()
        .get('/api/devices/templates')
        .set('Cookie', viewer)
        .expect(200);
      expect(templates.body.MODBUS.port).toBe(5020);
      expect(templates.body.MODBUS.registerMap).toHaveLength(5);
      expect(templates.body.MQTT.staleAfterMs).toBe(3000);
    });

    it('gets 403 for POST, PATCH and DELETE', async () => {
      const device = await prisma.device.create({
        data: {
          name: 'Line 1',
          protocol: 'MODBUS',
          config: modbusDevice().config,
        },
      });

      await http()
        .post('/api/devices')
        .set('Cookie', viewer)
        .send(modbusDevice('Other'))
        .expect(403);
      await http()
        .patch(`/api/devices/${device.id}`)
        .set('Cookie', viewer)
        .send({ name: 'Renamed' })
        .expect(403);
      await http()
        .delete(`/api/devices/${device.id}`)
        .set('Cookie', viewer)
        .expect(403);
      expect(await prisma.device.count()).toBe(1);
    });
  });

  describe('as ADMIN', () => {
    let admin: string;

    beforeEach(async () => {
      admin = await loginAs('admin', Role.ADMIN);
    });

    it('creates a device with defaults filled in and reports it CONNECTING', async () => {
      const res = await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send(mqttDevice())
        .expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        name: 'Line 2',
        protocol: 'MQTT',
        enabled: true,
        config: {
          brokerUrl: 'mqtt://127.0.0.1:1883',
          topicPrefix: 'factory/line2',
          staleAfterMs: 3000,
        },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        health: { status: 'CONNECTING', lastSeenAt: null, lastError: null },
      });

      const list = await http().get('/api/devices').set('Cookie', admin);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].health.status).toBe('CONNECTING');
      await http()
        .get(`/api/devices/${res.body.id}`)
        .set('Cookie', admin)
        .expect(200);
    });

    it('reports a disabled device as DISABLED', async () => {
      const res = await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send({ ...mqttDevice(), enabled: false })
        .expect(201);
      expect(res.body.health.status).toBe('DISABLED');
    });

    it('returns 400 with readable issues for an invalid config', async () => {
      const config = {
        ...modbusDevice().config,
        port: 0,
        registerMap: DEVICE_TEMPLATES.MODBUS.registerMap.slice(0, 4),
      };

      const res = await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send({ ...modbusDevice(), config })
        .expect(400);

      expect(res.body.message).toBe('Invalid device config');
      expect(res.body.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'config.port' }),
          {
            path: 'config.registerMap',
            message: 'signal "state" is missing',
          },
        ]),
      );
      expect(await prisma.device.count()).toBe(0);
    });

    it('rejects a missing config, an unknown protocol and unknown fields', async () => {
      await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send({ name: 'x', protocol: 'MODBUS' })
        .expect(400);
      await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send({ ...mqttDevice(), protocol: 'OPCUA' })
        .expect(400);
      await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send({ ...mqttDevice(), owner: 'me' })
        .expect(400);
    });

    it('returns 409 for a duplicate name on create and on rename', async () => {
      await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send(mqttDevice('Line 2'))
        .expect(201);
      const other = await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send(modbusDevice('Line 1'))
        .expect(201);

      await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send(modbusDevice('Line 2'))
        .expect(409);
      await http()
        .patch(`/api/devices/${other.body.id}`)
        .set('Cookie', admin)
        .send({ name: 'Line 2' })
        .expect(409);
    });

    it('updates name, enabled and config, but never the protocol', async () => {
      const created = await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send(mqttDevice())
        .expect(201);
      const id = created.body.id as string;

      const protocolChange = await http()
        .patch(`/api/devices/${id}`)
        .set('Cookie', admin)
        .send({ protocol: 'MODBUS' })
        .expect(400);
      expect(JSON.stringify(protocolChange.body)).toContain(
        'protocol cannot be changed',
      );

      await http()
        .patch(`/api/devices/${id}`)
        .set('Cookie', admin)
        .send({})
        .expect(400);

      // A config is validated against the existing protocol.
      await http()
        .patch(`/api/devices/${id}`)
        .set('Cookie', admin)
        .send({ config: modbusDevice().config })
        .expect(400);

      const updated = await http()
        .patch(`/api/devices/${id}`)
        .set('Cookie', admin)
        .send({
          name: 'Line 2b',
          enabled: false,
          config: { ...mqttDevice().config, staleAfterMs: 5000 },
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        name: 'Line 2b',
        enabled: false,
        protocol: 'MQTT',
        config: { staleAfterMs: 5000 },
        health: { status: 'DISABLED' },
      });
    });

    it('returns 404 for unknown devices and 400 for malformed ids', async () => {
      await http()
        .get(`/api/devices/${UNKNOWN_ID}`)
        .set('Cookie', admin)
        .expect(404);
      await http()
        .patch(`/api/devices/${UNKNOWN_ID}`)
        .set('Cookie', admin)
        .send({ name: 'x' })
        .expect(404);
      await http()
        .delete(`/api/devices/${UNKNOWN_ID}`)
        .set('Cookie', admin)
        .expect(404);
      await http()
        .get('/api/devices/not-a-uuid')
        .set('Cookie', admin)
        .expect(400);
    });

    it('deletes a device together with its readings', async () => {
      const created = await http()
        .post('/api/devices')
        .set('Cookie', admin)
        .send(mqttDevice())
        .expect(201);
      const id = created.body.id as string;
      await prisma.reading.create({
        data: {
          deviceId: id,
          ts: new Date(),
          productionCount: 1n,
          scrapCount: 0n,
          motorTempC: 70,
          motorCurrentA: 12,
          state: 'RUNNING',
        },
      });

      await http()
        .delete(`/api/devices/${id}`)
        .set('Cookie', admin)
        .expect(204);

      expect(await prisma.reading.count()).toBe(0);
      await http().get(`/api/devices/${id}`).set('Cookie', admin).expect(404);
    });
  });

  describe('readings', () => {
    let viewer: string;
    let deviceId: string;

    beforeEach(async () => {
      viewer = await loginAs('viewer', Role.VIEWER);
      const device = await prisma.device.create({
        data: { name: 'Line 2', protocol: 'MQTT', config: mqttDevice().config },
      });
      deviceId = device.id;
    });

    const reading = (minutesAgo: number, productionCount: bigint) => ({
      deviceId,
      ts: new Date(Date.now() - minutesAgo * 60_000),
      productionCount,
      scrapCount: 0n,
      motorTempC: 70,
      motorCurrentA: 12,
      state: 'RUNNING' as const,
    });

    it('returns the readings of the window in ascending ts order, as numbers', async () => {
      await prisma.reading.createMany({
        data: [reading(5, 300n), reading(90, 100n), reading(30, 200n)],
      });

      const res = await http()
        .get(`/api/devices/${deviceId}/readings`)
        .set('Cookie', viewer)
        .expect(200);
      const body = res.body as Array<{ productionCount: number }>;
      expect(body.map((r) => r.productionCount)).toEqual([200, 300]);

      const wide = await http()
        .get(`/api/devices/${deviceId}/readings?minutes=120`)
        .set('Cookie', viewer)
        .expect(200);
      expect(wide.body).toHaveLength(3);
      expect(wide.body[0]).toEqual({
        ts: expect.any(String),
        receivedAt: expect.any(String),
        productionCount: 100,
        scrapCount: 0,
        motorTempC: 70,
        motorCurrentA: 12,
        state: 'RUNNING',
      });
    });

    it('validates minutes and the device', async () => {
      for (const minutes of ['0', '1441', 'abc', '1.5']) {
        await http()
          .get(`/api/devices/${deviceId}/readings?minutes=${minutes}`)
          .set('Cookie', viewer)
          .expect(400);
      }
      await http()
        .get(`/api/devices/${UNKNOWN_ID}/readings`)
        .set('Cookie', viewer)
        .expect(404);
    });
  });

  describe('stream', () => {
    it('sends a typed snapshot event first', async () => {
      const viewer = await loginAs('viewer', Role.VIEWER);
      const controller = new AbortController();

      const res = await fetch(`${baseUrl}/api/stream`, {
        headers: { Cookie: viewer },
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const reader = res.body!.getReader();
      let text = '';
      // Nest writes a leading newline before the first event.
      while (!/event: \w+\n[\s\S]*\n\n/.test(text)) {
        const { value } = await reader.read();
        text += new TextDecoder().decode(value);
      }
      controller.abort();

      expect(text.trimStart()).toMatch(/^event: snapshot\n/);
      expect(text).toContain('data: {"devices":[');
    });
  });
});
