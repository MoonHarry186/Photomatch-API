import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RoleCode } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { EmailPort } from '../../src/integrations/integration.ports';

const EMAIL = 'auth-lifecycle@photomatch.test';
const PENDING_EMAIL = 'auth-pending@photomatch.test';
const CHANGED_EMAIL = 'auth-changed@photomatch.test';
const PASSWORD = 'AuthLifecycle!123';

describe('authentication lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: EmailPort & { drain(): Array<{ text: string }> };
  let verificationToken: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    email = app.get(EmailPort) as EmailPort & { drain(): Array<{ text: string }> };
    await cleanup(prisma);
    email.drain();
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  it('registers an Argon2 account and denies sign-in before verification', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('verification_required'));

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
      include: { authIdentities: true, roles: { include: { role: true } } },
    });
    expect(user.currentRoleId).toBe(user.roles[0].id);
    expect(user.roles.map((item) => item.role.code)).toEqual([RoleCode.CUSTOMER]);
    expect(user.authIdentities[0].passwordHash).toMatch(/^\$argon2id\$/);
    verificationToken = tokenFrom(email.drain());

    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_VERIFICATION_REQUIRED'));
  });

  it('enforces resend cooldown, invalidates the old token, and verifies once', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: EMAIL })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('accepted'));
    expect(email.drain()).toHaveLength(0);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: EMAIL })
      .expect(201);
    const replacementToken = tokenFrom(email.drain());

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: verificationToken })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VERIFICATION_TOKEN_INVALID'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: replacementToken })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('verified'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: replacementToken })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VERIFICATION_TOKEN_INVALID'));

    await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: EMAIL })
      .expect(201);
    expect(email.drain()).toHaveLength(0);
    await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: EMAIL })
      .expect(429);
  });

  it('rejects expired tokens and verifies the replacement after a pending email change', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({ email: PENDING_EMAIL, password: PASSWORD })
      .expect(201);
    const expiredToken = tokenFrom(email.drain());
    const pending = await prisma.user.findUniqueOrThrow({ where: { email: PENDING_EMAIL } });
    await prisma.emailVerificationToken.updateMany({
      where: { userId: pending.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: expiredToken })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VERIFICATION_TOKEN_INVALID'));

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-pending-email')
      .send({ currentEmail: PENDING_EMAIL, newEmail: CHANGED_EMAIL, password: PASSWORD })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('verification_required'));
    const replacementToken = tokenFrom(email.drain());
    await expect(prisma.user.findUnique({ where: { email: PENDING_EMAIL } })).resolves.toBeNull();
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: replacementToken })
      .expect(201);
    await expect(prisma.user.findUnique({ where: { email: CHANGED_EMAIL } })).resolves.toEqual(
      expect.objectContaining({ emailVerified: true }),
    );
  });

  it('rotates refresh tokens and revokes the family on replay', async () => {
    const signedIn = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email: EMAIL, password: PASSWORD, deviceId: 'auth-e2e' })
      .expect(201);
    accessToken = signedIn.body.accessToken as string;
    refreshToken = signedIn.body.refreshToken as string;

    const rotated = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(201);
    const nextRefreshToken = rotated.body.refreshToken as string;
    expect(nextRefreshToken).not.toBe(refreshToken);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('REFRESH_TOKEN_REUSED'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: nextRefreshToken })
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('REFRESH_TOKEN_REUSED'));
  });

  it('revokes the token family when the same refresh token rotates concurrently', async () => {
    const signedIn = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email: EMAIL, password: PASSWORD, deviceId: 'auth-concurrency-e2e' })
      .expect(201);
    const concurrentRefreshToken = signedIn.body.refreshToken as string;
    const attempts = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: concurrentRefreshToken }),
      ),
    );
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 401]);
    expect(attempts.find((attempt) => attempt.status === 401)?.body.code).toBe(
      'REFRESH_TOKEN_REUSED',
    );
    const winner = attempts.find((attempt) => attempt.status === 201);
    if (!winner) throw new Error('Concurrent refresh did not produce one winner');
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${winner.body.accessToken as string}`)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
  });

  it('keeps role selection immutable and denies mobile access to admin routes', async () => {
    const signedIn = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201);
    accessToken = signedIn.body.accessToken as string;

    const available = await request(app.getHttpServer())
      .get('/api/v1/roles/available')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(available.body.map((item: { code: RoleCode }) => item.code)).toEqual(
      expect.arrayContaining([RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER]),
    );
    expect(available.body.map((item: { code: RoleCode }) => item.code)).not.toContain(
      RoleCode.ADMIN,
    );

    const first = await request(app.getHttpServer())
      .post('/api/v1/me/roles')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ role: RoleCode.PHOTOGRAPHER })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/me/roles')
      .set('authorization', `Bearer ${accessToken}`)
      .send({ role: RoleCode.PHOTOGRAPHER })
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    await expect(prisma.userRole.count({ where: { user: { email: EMAIL } } })).resolves.toBe(2);

    await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard/summary')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ROLE_FORBIDDEN'));
  });

  it('revokes the current device session on sign-out', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-out')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('signed_out'));
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));
  });
});

function tokenFrom(messages: Array<{ text: string }>): string {
  expect(messages).toHaveLength(1);
  const token = messages[0].text.split(': ').at(-1);
  if (!token) throw new Error('Verification email did not contain a token');
  return token;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { in: [EMAIL, PENDING_EMAIL, CHANGED_EMAIL] } } });
}
