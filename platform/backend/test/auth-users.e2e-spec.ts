import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { Role } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'correct-horse-battery';

describe('Auth and user management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "events", "readings", "devices", "users" CASCADE`;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // Hashed once: bcrypt at cost 12 is deliberately slow.
  const passwordHash = hashPassword(PASSWORD);

  async function createUser(username: string, role: Role) {
    return prisma.user.create({
      data: { username, role, passwordHash: await passwordHash },
    });
  }

  /** Logs in and returns the Set-Cookie header, ready to send back as Cookie. */
  async function login(username: string, password = PASSWORD) {
    const res = await http()
      .post('/api/auth/login')
      .send({ username, password })
      .expect(200);
    return setCookies(res)[0].split(';')[0];
  }

  function setCookies(res: request.Response): string[] {
    const header = res.headers['set-cookie'] as unknown;
    return Array.isArray(header) ? (header as string[]) : [];
  }

  describe('authentication', () => {
    it('returns 401 for GET /api/users without a token', async () => {
      await http().get('/api/users').expect(401);
    });

    it('returns 401 for an invalid token', async () => {
      await http()
        .get('/api/auth/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('login sets an httpOnly SameSite=Strict cookie and returns the user without the token', async () => {
      const user = await createUser('alice', Role.VIEWER);

      const res = await http()
        .post('/api/auth/login')
        .send({ username: 'alice', password: PASSWORD })
        .expect(200);

      expect(res.body).toEqual({
        user: { id: user.id, username: 'alice', role: Role.VIEWER },
      });
      const [cookie] = setCookies(res);
      expect(cookie).toMatch(/^access_token=[^;]+;/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
      expect(cookie).not.toContain('Secure');
      expect(JSON.stringify(res.body)).not.toContain(
        cookie.split(';')[0].split('=')[1],
      );
    });

    it('gives the same 401 for an unknown user and a wrong password', async () => {
      await createUser('alice', Role.VIEWER);

      const unknownUser = await http()
        .post('/api/auth/login')
        .send({ username: 'nobody', password: PASSWORD })
        .expect(401);
      const wrongPassword = await http()
        .post('/api/auth/login')
        .send({ username: 'alice', password: 'wrong-password' })
        .expect(401);

      expect(unknownUser.body).toEqual(wrongPassword.body);
    });

    it('accepts the token from the cookie or from the Bearer header', async () => {
      await createUser('alice', Role.VIEWER);
      const cookie = await login('alice');
      const token = cookie.split('=')[1];

      const viaCookie = await http()
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      const viaHeader = await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(viaCookie.body).toEqual(viaHeader.body);
      expect(viaCookie.body.user.username).toBe('alice');
    });

    it('logout clears the cookie', async () => {
      await createUser('alice', Role.VIEWER);
      const cookie = await login('alice');

      const res = await http()
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(204);

      const [cleared] = setCookies(res);
      expect(cleared).toMatch(/^access_token=;/);
      expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
      expect(cleared).toContain('Path=/');
    });

    it("rejects a deleted user's token with 401", async () => {
      await createUser('admin', Role.ADMIN);
      const viewer = await createUser('viewer', Role.VIEWER);
      const adminCookie = await login('admin');
      const viewerCookie = await login('viewer');

      await http().get('/api/auth/me').set('Cookie', viewerCookie).expect(200);
      await http()
        .delete(`/api/users/${viewer.id}`)
        .set('Cookie', adminCookie)
        .expect(204);
      await http().get('/api/auth/me').set('Cookie', viewerCookie).expect(401);
    });

    it("uses the current role from the database, not the token's", async () => {
      await createUser('admin', Role.ADMIN);
      const second = await createUser('second', Role.ADMIN);
      const adminCookie = await login('admin');
      const secondCookie = await login('second');

      await http()
        .patch(`/api/users/${second.id}`)
        .set('Cookie', adminCookie)
        .send({ role: Role.VIEWER })
        .expect(200);
      await http().get('/api/users').set('Cookie', secondCookie).expect(403);
    });
  });

  describe('authorization', () => {
    it('returns 403 for a VIEWER on GET and POST /api/users', async () => {
      await createUser('viewer', Role.VIEWER);
      const cookie = await login('viewer');

      await http().get('/api/users').set('Cookie', cookie).expect(403);
      await http()
        .post('/api/users')
        .set('Cookie', cookie)
        .send({ username: 'bob', password: PASSWORD, role: Role.VIEWER })
        .expect(403);
    });

    it('serves public routes without a token', async () => {
      const res = await http().get('/api/health').expect(200);
      expect(res.body).toEqual({ status: 'ok', db: 'up' });
    });
  });

  describe('user management (ADMIN)', () => {
    let adminId: string;
    let adminCookie: string;

    beforeEach(async () => {
      adminId = (await createUser('admin', Role.ADMIN)).id;
      adminCookie = await login('admin');
    });

    it('creates a user and never returns passwordHash', async () => {
      const created = await http()
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({ username: 'bob', password: PASSWORD, role: Role.VIEWER })
        .expect(201);

      expect(created.body).toEqual({
        id: expect.any(String),
        username: 'bob',
        role: Role.VIEWER,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const list = await http()
        .get('/api/users')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(JSON.stringify(list.body)).not.toMatch(/password/i);
      expect(list.body).toHaveLength(2);

      // The new user can log in with the given password.
      await login('bob');
    });

    it('rejects unknown fields and invalid input with 400', async () => {
      await http()
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({
          username: 'bob',
          password: PASSWORD,
          role: Role.VIEWER,
          isRoot: true,
        })
        .expect(400);
      await http()
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({ username: 'b', password: 'short', role: 'OWNER' })
        .expect(400);
      await http()
        .patch('/api/users/not-a-uuid')
        .set('Cookie', adminCookie)
        .send({ role: Role.VIEWER })
        .expect(400);
    });

    it('returns 409 for a duplicate username', async () => {
      await http()
        .post('/api/users')
        .set('Cookie', adminCookie)
        .send({ username: 'admin', password: PASSWORD, role: Role.VIEWER })
        .expect(409);
    });

    it('changes the password with PATCH', async () => {
      const bob = await createUser('bob', Role.VIEWER);

      const res = await http()
        .patch(`/api/users/${bob.id}`)
        .set('Cookie', adminCookie)
        .send({ password: 'a-brand-new-password' })
        .expect(200);

      expect(res.body).not.toHaveProperty('passwordHash');
      await login('bob', 'a-brand-new-password');
      await http()
        .post('/api/auth/login')
        .send({ username: 'bob', password: PASSWORD })
        .expect(401);
    });

    it('does not let an admin delete their own account', async () => {
      await http()
        .delete(`/api/users/${adminId}`)
        .set('Cookie', adminCookie)
        .expect(400);
    });

    it('does not let the last admin be demoted', async () => {
      await http()
        .patch(`/api/users/${adminId}`)
        .set('Cookie', adminCookie)
        .send({ role: Role.VIEWER })
        .expect(409);
      expect(await prisma.user.count({ where: { role: Role.ADMIN } })).toBe(1);
    });

    it('never leaves zero admins when two admins delete each other concurrently', async () => {
      const allowed = [204, 401, 409];

      for (let round = 0; round < 10; round++) {
        await prisma.$executeRaw`TRUNCATE TABLE "users" CASCADE`;
        const [first, second] = await Promise.all([
          createUser('first', Role.ADMIN),
          createUser('second', Role.ADMIN),
        ]);
        const [firstCookie, secondCookie] = await Promise.all([
          login('first'),
          login('second'),
        ]);

        const results = await Promise.all([
          http().delete(`/api/users/${second.id}`).set('Cookie', firstCookie),
          http().delete(`/api/users/${first.id}`).set('Cookie', secondCookie),
        ]);

        // 204 = deleted, 409 = last admin (the loser waited on the row lock),
        // 401 = the actor was deleted before its request was authenticated.
        const statuses = results.map((res) => res.status);
        expect(statuses.every((status) => allowed.includes(status))).toBe(true);
        expect(statuses.filter((status) => status === 204)).toHaveLength(1);
        expect(await prisma.user.count({ where: { role: Role.ADMIN } })).toBe(
          1,
        );
      }
    }, 60_000);

    it('allows deleting an admin while another admin remains', async () => {
      const second = await createUser('second', Role.ADMIN);

      await http()
        .delete(`/api/users/${second.id}`)
        .set('Cookie', adminCookie)
        .expect(204);
      await http()
        .delete(`/api/users/${second.id}`)
        .set('Cookie', adminCookie)
        .expect(404);
    });
  });
});
