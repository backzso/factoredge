import net from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { CONNECTOR_FACTORY } from '../src/connectors/connector-manager.service';
import type { ConnectorFactory } from '../src/connectors/connector.types';
import { Role } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'correct-horse-battery';

const noopConnectorFactory: ConnectorFactory = () => ({
  start: () => undefined,
  stop: () => Promise.resolve(),
});

/** Resolves with how long `promise` took, or rejects once `limitMs` has passed. */
async function timed(
  promise: Promise<unknown>,
  limitMs: number,
): Promise<number> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`still not finished after ${limitMs} ms`)),
      limitMs,
    );
  });
  try {
    await Promise.race([promise, limit]);
    return Date.now() - started;
  } finally {
    clearTimeout(timer);
  }
}

describe('Graceful shutdown (e2e)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let closed: boolean;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONNECTOR_FACTORY)
      .useValue(noopConnectorFactory)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    closed = false;

    const prisma = app.get(PrismaService);
    await prisma.$executeRaw`TRUNCATE TABLE "events", "readings", "devices", "users" CASCADE`;
    await prisma.user.create({
      data: {
        username: 'watcher',
        role: Role.VIEWER,
        passwordHash: await hashPassword(PASSWORD),
      },
    });
  });

  afterEach(async () => {
    // A failed test leaves the app open; do not let it hang the run.
    if (!closed) {
      await timed(app.close(), 10_000).catch(() => undefined);
    }
  });

  async function loginCookie(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'watcher', password: PASSWORD })
      .expect(200);
    return (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  }

  it('closes within a bounded time while an SSE client is connected, ending the stream cleanly', async () => {
    const response = await fetch(`${baseUrl}/api/stream`, {
      headers: { cookie: await loginCookie() },
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: snapshot');

    // Read until the server ends the stream; an error means it was cut off.
    const streamEnd = (async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) return 'completed';
      }
    })().catch(() => 'cut off');

    const elapsed = await timed(app.close(), 5_000);
    closed = true;

    expect(elapsed).toBeLessThan(2_000);
    await expect(streamEnd).resolves.toBe('completed');
  }, 15_000);

  it('force-closes a connection that never finishes its request (safety net)', async () => {
    const { port } = new URL(baseUrl);
    const requestArrived = new Promise<void>((resolve) =>
      app.getHttpServer().once('request', () => resolve()),
    );
    const socket = net.connect(Number(port), '127.0.0.1');
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    // Headers complete, body announced but never sent: the request is in
    // progress, so server.close() alone waits for it (Node's requestTimeout is 5 min).
    socket.write(
      'POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\n' +
        'Content-Type: application/json\r\nContent-Length: 100\r\n\r\n{',
    );
    socket.on('error', () => undefined);
    // The server must be inside the request, or close() would see an idle connection.
    await timed(requestArrived, 2_000);
    const socketClosed = new Promise<void>((resolve) =>
      socket.once('close', () => resolve()),
    );

    const elapsed = await timed(app.close(), 8_000);
    closed = true;

    expect(elapsed).toBeLessThan(5_000);
    await timed(socketClosed, 1_000);
  }, 15_000);
});
