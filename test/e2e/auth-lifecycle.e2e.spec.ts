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
const RECOVERY_EMAIL = 'auth-verification-recovery@photomatch.test';
const RESET_EMAIL = 'auth-password-reset@photomatch.test';
const PASSWORD = 'AuthLifecycle!123';
const NEW_PASSWORD = 'AuthLifecycle!456';

describe('authentication lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let email: EmailPort & { drain(): Array<{ text: string }> };
  let verificationChallengeId: string;
  let verificationOtp: string;
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
    const signUp = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('verification_required'));
    verificationChallengeId = signUp.body.challengeId as string;
    expect(signUp.body).toEqual(
      expect.objectContaining({
        expiresIn: expect.any(Number),
        resendAfter: expect.any(Number),
      }),
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: EMAIL },
      include: { authIdentities: true, roles: { include: { role: true } } },
    });
    expect(user.currentRoleId).toBe(user.roles[0].id);
    expect(user.roles.map((item) => item.role.code)).toEqual([RoleCode.CUSTOMER]);
    expect(user.authIdentities[0].passwordHash).toMatch(/^\$argon2id\$/);
    verificationOtp = otpFrom(email.drain());

    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('EMAIL_VERIFICATION_REQUIRED'));
  });

  it('enforces resend cooldown, invalidates the old token, and verifies once', async () => {
    const cooldown = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: EMAIL })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('accepted'));
    expect(cooldown.body.challengeId).toBe(verificationChallengeId);
    expect(email.drain()).toHaveLength(0);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { createdAt: new Date(Date.now() - 61_000) },
    });
    const replacement = await request(app.getHttpServer())
      .post('/api/v1/auth/resend-verification')
      .send({ email: EMAIL })
      .expect(201);
    const replacementChallengeId = replacement.body.challengeId as string;
    const replacementOtp = otpFrom(email.drain());

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ challengeId: verificationChallengeId, otp: verificationOtp })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VERIFICATION_CODE_INVALID'));
    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({
        challengeId: replacementChallengeId,
        otp: replacementOtp,
        deviceId: 'auth-verification-e2e',
      })
      .expect(201);
    expect(verified.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: expect.any(Number),
        tokenType: 'Bearer',
        user: expect.objectContaining({ id: user.id }),
      }),
    );
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${verified.body.accessToken as string}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ challengeId: replacementChallengeId, otp: replacementOtp })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VERIFICATION_CODE_INVALID'));

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

  it('rejects expired verification codes', async () => {
    const pendingSignUp = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({ email: PENDING_EMAIL, password: PASSWORD })
      .expect(201);
    const expiredChallengeId = pendingSignUp.body.challengeId as string;
    const expiredOtp = otpFrom(email.drain());
    const pending = await prisma.user.findUniqueOrThrow({ where: { email: PENDING_EMAIL } });
    await prisma.emailVerificationToken.updateMany({
      where: { userId: pending.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ challengeId: expiredChallengeId, otp: expiredOtp })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VERIFICATION_CODE_EXPIRED'));
  });

  it('rolls back OTP consumption and activation when session creation fails', async () => {
    const signUp = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({ email: RECOVERY_EMAIL, password: PASSWORD })
      .expect(201);
    const challengeId = signUp.body.challengeId as string;
    const otp = otpFrom(email.drain());

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ challengeId, otp, deviceId: 'x'.repeat(256) })
      .expect(500);

    const pending = await prisma.user.findUniqueOrThrow({ where: { email: RECOVERY_EMAIL } });
    const challenge = await prisma.emailVerificationToken.findUniqueOrThrow({
      where: { id: challengeId },
    });
    expect(pending).toEqual(
      expect.objectContaining({
        emailVerified: false,
        accountStatus: 'PENDING_VERIFICATION',
      }),
    );
    expect(challenge.consumedAt).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ challengeId, otp, deviceId: 'auth-verification-recovery-e2e' })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            accessToken: expect.any(String),
            refreshToken: expect.any(String),
            user: expect.objectContaining({ id: pending.id }),
          }),
        );
      });
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
    expect(rotated.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: expect.any(Number),
        tokenType: 'Bearer',
        user: expect.objectContaining({
          id: expect.any(String),
          email: EMAIL,
        }),
      }),
    );
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

  it('resets an email password through a six-digit OTP and one-time grant', async () => {
    const signUp = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up')
      .send({ email: RESET_EMAIL, password: PASSWORD })
      .expect(201);
    const signupOtp = otpFrom(email.drain());
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ challengeId: signUp.body.challengeId, otp: signupOtp })
      .expect(201);

    const signedIn = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email: RESET_EMAIL, password: PASSWORD })
      .expect(201);
    const previousAccessToken = signedIn.body.accessToken as string;

    const forgot = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: RESET_EMAIL })
      .expect(201);
    expect(forgot.body).toEqual(
      expect.objectContaining({
        status: 'accepted',
        challengeId: expect.any(String),
        expiresIn: expect.any(Number),
        resendAfter: expect.any(Number),
      }),
    );
    const resetOtp = otpFrom(email.drain());

    const cooldown = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: RESET_EMAIL })
      .expect(201);
    expect(cooldown.body.challengeId).toBe(forgot.body.challengeId);
    expect(email.drain()).toHaveLength(0);

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-password-reset-otp')
      .send({
        challengeId: forgot.body.challengeId,
        otp: `${resetOtp[0] === '0' ? '1' : '0'}${resetOtp.slice(1)}`,
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('PASSWORD_RESET_CODE_INVALID'));

    const verified = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-password-reset-otp')
      .send({ challengeId: forgot.body.challengeId, otp: resetOtp })
      .expect(201);
    expect(verified.body).toEqual(
      expect.objectContaining({
        status: 'verified',
        resetToken: expect.any(String),
        expiresIn: expect.any(Number),
      }),
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ resetToken: verified.body.resetToken, newPassword: NEW_PASSWORD })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('password_reset'));

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ resetToken: verified.body.resetToken, newPassword: PASSWORD })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('RESET_TOKEN_INVALID'));
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email: RESET_EMAIL, password: PASSWORD })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in')
      .send({ email: RESET_EMAIL, password: NEW_PASSWORD })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${previousAccessToken}`)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));

    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'unknown-password-reset@photomatch.test' })
      .expect(201);
    expect(unknown.body).toEqual(
      expect.objectContaining({
        status: 'accepted',
        challengeId: expect.any(String),
      }),
    );
    expect(email.drain()).toHaveLength(0);
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

function otpFrom(messages: Array<{ text: string }>): string {
  expect(messages).toHaveLength(1);
  const otp = messages[0].text.match(/\b\d{6}\b/)?.[0];
  if (!otp) throw new Error('Verification email did not contain a six-digit OTP');
  return otp;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.user.deleteMany({
    where: { email: { in: [EMAIL, PENDING_EMAIL, RECOVERY_EMAIL, RESET_EMAIL] } },
  });
}
