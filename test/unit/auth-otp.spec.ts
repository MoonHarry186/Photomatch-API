import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiError } from '../../src/common/api-error';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/database/prisma.service';
import { EmailPort, OAuthVerifierPort } from '../../src/integrations/integration.ports';

describe('email verification OTP', () => {
  it('locks a challenge on the fifth incorrect attempt', async () => {
    const challenge = {
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      tokenHash: '0'.repeat(64),
      attemptCount: 4,
      lockedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
    };
    const emailVerificationToken = {
      findUnique: jest.fn().mockResolvedValue(challenge),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ attemptCount: 5, lockedAt: null }),
    };
    const prisma = {
      emailVerificationToken,
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      {} as ConfigService,
      {} as EmailPort,
      {} as OAuthVerifierPort,
    );

    let caught: unknown;
    try {
      await service.verifyEmail(challenge.id, '123456', {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getResponse()).toMatchObject({
      code: 'VERIFICATION_ATTEMPTS_EXCEEDED',
    });
    expect(emailVerificationToken.updateMany).toHaveBeenLastCalledWith({
      where: { id: challenge.id, lockedAt: null },
      data: { lockedAt: expect.any(Date) },
    });
  });
});

describe('password reset OTP', () => {
  it('locks a password reset challenge on the fifth incorrect attempt', async () => {
    const challenge = {
      id: '33333333-3333-4333-8333-333333333333',
      userId: '44444444-4444-4444-8444-444444444444',
      tokenHash: '0'.repeat(64),
      attemptCount: 4,
      lockedAt: null,
      verifiedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      createdAt: new Date(),
    };
    const passwordResetToken = {
      findUnique: jest.fn().mockResolvedValue(challenge),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ attemptCount: 5, lockedAt: null }),
    };
    const prisma = {
      passwordResetToken,
    } as unknown as PrismaService;
    const service = new AuthService(
      prisma,
      {} as JwtService,
      {} as ConfigService,
      {} as EmailPort,
      {} as OAuthVerifierPort,
    );

    let caught: unknown;
    try {
      await service.verifyPasswordResetOtp(challenge.id, '123456');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).getResponse()).toMatchObject({
      code: 'PASSWORD_RESET_ATTEMPTS_EXCEEDED',
    });
    expect(passwordResetToken.updateMany).toHaveBeenLastCalledWith({
      where: { id: challenge.id, lockedAt: null },
      data: { lockedAt: expect.any(Date) },
    });
  });
});
