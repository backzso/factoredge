import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { JwtPayload } from '../src/auth/auth.types';
import { hashPassword } from '../src/auth/password';
import { CONNECTOR_FACTORY } from '../src/connectors/connector-manager.service';
import type { ConnectorFactory } from '../src/connectors/connector.types';
import { Role } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { SessionWatchService } from '../src/realtime/session-watch.service';
import { type LiveStream, openStream } from './live-stream';

const PASSWORD = 'correct-horse-battery';

const noopConnectorFactory: ConnectorFactory = () => ({
  start: () => undefined,
  stop: () => Promise.resolve(),
});

/** Resolves with `promise`, or rejects once `limitMs` has passed. */
async function within<T>(promise: Promise<T>, limitMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`still not settled after ${limitMs} ms`)),
      limitMs,
    );
  });
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}

describe('Targeted session events on the live stream (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let realtime: RealtimeService;
  let baseUrl: string;
  const streams: LiveStream[] = [];

  // Hashed once: bcrypt at cost 12 is deliberately slow.
  const passwordHash = hashPassword(PASSWORD);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONNECTOR_FACTORY)
      .useValue(noopConnectorFactory)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    realtime = app.get(RealtimeService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "events", "readings", "devices", "users" CASCADE`;
  });

  afterEach(() => {
    streams.splice(0).forEach((stream) => stream.close());
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function createUser(username: string, role: Role) {
    return prisma.user.create({
      data: { username, role, passwordHash: await passwordHash },
    });
  }

  async function login(username: string): Promise<string> {
    const res = await http()
      .post('/api/auth/login')
      .send({ username, password: PASSWORD })
      .expect(200);
    return (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  }

  async function streamAs(cookie: string): Promise<LiveStream> {
    const stream = await openStream(baseUrl, { cookie });
    streams.push(stream);
    return stream;
  }

  it('deleting a user ends all of their open streams with session-ended; other users keep theirs', async () => {
    await createUser('admin', Role.ADMIN);
    const alice = await createUser('alice', Role.VIEWER);
    await createUser('bob', Role.VIEWER);
    const adminCookie = await login('admin');
    const aliceCookie = await login('alice');
    // Two tabs of alice, one of bob.
    const aliceTab1 = await streamAs(aliceCookie);
    const aliceTab2 = await streamAs(aliceCookie);
    const bobTab = await streamAs(await login('bob'));

    await http()
      .delete(`/api/users/${alice.id}`)
      .set('Cookie', adminCookie)
      .expect(204);

    for (const tab of [aliceTab1, aliceTab2]) {
      const ended = await tab.waitFor('session-ended');
      expect(ended.data).toEqual({ reason: 'deleted' });
      await expect(within(tab.ended, 1_000)).resolves.toBe('completed');
      // session-ended is the last event.
      expect(tab.events.at(-1)?.type).toBe('session-ended');
    }
    expect(realtime.connectedUserIds()).not.toContain(alice.id);

    // Bob's stream is untouched and keeps receiving heartbeats.
    const seen = bobTab.events.length;
    await bobTab.waitFor('heartbeat', 6_000, seen);
    expect(bobTab.events.map((e) => e.type)).not.toContain('session-ended');
  }, 15_000);

  it('a role change sends session-changed to that user only, and the stream stays open', async () => {
    await createUser('admin', Role.ADMIN);
    const boss = await createUser('boss', Role.ADMIN);
    const adminCookie = await login('admin');
    const bossCookie = await login('boss');
    const bossTab = await streamAs(bossCookie);
    const adminTab = await streamAs(adminCookie);

    await http()
      .patch(`/api/users/${boss.id}`)
      .set('Cookie', adminCookie)
      .send({ role: Role.VIEWER })
      .expect(200);

    const changed = await bossTab.waitFor('session-changed');
    expect(changed.data).toEqual({ changes: ['role'], role: Role.VIEWER });

    // Still open: the client reloads /auth/me and carries on with the new role.
    const seen = bossTab.events.length;
    await bossTab.waitFor('heartbeat', 6_000, seen);
    const me = await http()
      .get('/api/auth/me')
      .set('Cookie', bossCookie)
      .expect(200);
    expect(me.body.user.role).toBe(Role.VIEWER);
    expect(adminTab.events.map((e) => e.type)).not.toContain('session-changed');
  }, 15_000);

  it('a password reset sends session-changed; setting the same role sends nothing', async () => {
    await createUser('admin', Role.ADMIN);
    const alice = await createUser('alice', Role.VIEWER);
    const adminCookie = await login('admin');
    const aliceTab = await streamAs(await login('alice'));

    await http()
      .patch(`/api/users/${alice.id}`)
      .set('Cookie', adminCookie)
      .send({ role: Role.VIEWER })
      .expect(200);
    await http()
      .patch(`/api/users/${alice.id}`)
      .set('Cookie', adminCookie)
      .send({ password: 'another-long-password' })
      .expect(200);

    const changed = await aliceTab.waitFor('session-changed');
    expect(changed.data).toEqual({
      changes: ['password'],
      role: Role.VIEWER,
    });
    expect(
      aliceTab.events.filter((e) => e.type === 'session-changed'),
    ).toHaveLength(1);
  });

  it('safety net: a user deleted behind the API is found by the periodic check and their stream ends', async () => {
    const alice = await createUser('alice', Role.VIEWER);
    await createUser('bob', Role.VIEWER);
    const aliceTab = await streamAs(await login('alice'));
    const bobTab = await streamAs(await login('bob'));

    // Straight in the database: the users service announces nothing.
    await prisma.user.delete({ where: { id: alice.id } });
    // The 30 s timer would do this; run one check now.
    await app.get(SessionWatchService).sweep();

    const ended = await aliceTab.waitFor('session-ended');
    expect(ended.data).toEqual({ reason: 'deleted' });
    await expect(within(aliceTab.ended, 1_000)).resolves.toBe('completed');
    expect(bobTab.events.map((e) => e.type)).not.toContain('session-ended');
  });

  it('ends the stream with session-ended when the token expires', async () => {
    const alice = await createUser('alice', Role.VIEWER);
    const payload: JwtPayload = { sub: alice.id, role: alice.role };
    const token = await app
      .get(JwtService)
      .signAsync(payload, { expiresIn: 1 });
    const stream = await openStream(baseUrl, {
      authorization: `Bearer ${token}`,
    });
    streams.push(stream);

    // Checked with each heartbeat (every 5 s).
    const ended = await stream.waitFor('session-ended', 7_000);
    expect(ended.data).toEqual({ reason: 'expired' });
    await expect(within(stream.ended, 1_000)).resolves.toBe('completed');
  }, 15_000);

  it('unregisters a stream when the client disconnects', async () => {
    const alice = await createUser('alice', Role.VIEWER);
    const aliceTab = await streamAs(await login('alice'));
    expect(realtime.connectedUserIds()).toEqual([alice.id]);

    aliceTab.close();

    const deadline = Date.now() + 2_000;
    while (realtime.connectedUserIds().length > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(realtime.connectedUserIds()).toEqual([]);
  });
});
