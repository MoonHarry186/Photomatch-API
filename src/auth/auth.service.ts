import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AccountStatus,
  AuthProvider,
  CatalogStatus,
  Prisma,
  PenaltyStatus,
  RoleCode,
  RoleStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/auth-context';
import { PrismaService, TransactionClient } from '../database/prisma.service';
import { EmailPort, OAuthVerifierPort } from '../integrations/integration.ports';
import { OAuthSignInDto, SignInDto, SignUpDto } from './auth.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
}

interface SessionContext {
  deviceId?: string;
  userAgent?: string;
  ipAddress?: string;
}

const EMAIL_OTP_TTL_SECONDS = 10 * 60;
const EMAIL_OTP_RESEND_SECONDS = 60;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_OTP_TTL_SECONDS = 10 * 60;
const PASSWORD_RESET_OTP_RESEND_SECONDS = 60;
const PASSWORD_RESET_OTP_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_GRANT_TTL_SECONDS = 10 * 60;

export interface VerificationChallengeResponse {
  challengeId: string;
  expiresIn: number;
  resendAfter: number;
}

export interface VerificationRequiredResponse extends VerificationChallengeResponse {
  status: 'verification_required';
}

export interface VerificationAcceptedResponse extends VerificationChallengeResponse {
  status: 'accepted';
}

export interface PasswordResetVerifiedResponse {
  status: 'verified';
  resetToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailPort,
    private readonly oauth: OAuthVerifierPort,
  ) {}

  async signUp(dto: SignUpDto, ipAddress?: string): Promise<VerificationRequiredResponse> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, accountStatus: true, emailVerified: true },
    });
    if (existing) {
      if (
        !existing.emailVerified &&
        existing.accountStatus === AccountStatus.PENDING_VERIFICATION
      ) {
        const active = await this.activeVerificationChallenge(existing.id);
        if (active) return this.requiredChallenge(active);
        const issued = await this.prisma.transaction((tx) =>
          this.createVerificationChallenge(tx, existing.id),
        );
        await this.sendVerification(email, issued.otp);
        return this.requiredChallenge(issued.record);
      }
      return this.dummyRequiredChallenge();
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const issued = await this.prisma.transaction(async (tx) => {
      const customer = await tx.role.findUnique({ where: { code: RoleCode.CUSTOMER } });
      if (!customer || customer.status !== RoleStatus.ACTIVE)
        throw ApiError.notFound('Customer role');
      const user = await tx.user.create({
        data: {
          email,
          authIdentities: {
            create: { provider: AuthProvider.EMAIL, email, passwordHash },
          },
          profile: { create: {} },
          settings: { create: {} },
          roles: { create: { roleId: customer.id } },
        },
        include: { roles: true },
      });
      await tx.user.update({ where: { id: user.id }, data: { currentRoleId: user.roles[0].id } });
      await this.recordCurrentLegalConsents(tx, user.id, ipAddress);
      return this.createVerificationChallenge(tx, user.id);
    });
    await this.sendVerification(email, issued.otp);
    return this.requiredChallenge(issued.record);
  }

  async verifyEmail(challengeId: string, otp: string, context: SessionContext) {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { id: challengeId },
    });
    if (!record || record.consumedAt) this.invalidVerificationCode();
    if (record.expiresAt <= new Date()) {
      throw new ApiError('VERIFICATION_CODE_EXPIRED', 'Verification code has expired');
    }
    if (record.lockedAt || record.attemptCount >= EMAIL_OTP_MAX_ATTEMPTS) {
      throw new ApiError(
        'VERIFICATION_ATTEMPTS_EXCEEDED',
        'Too many incorrect verification attempts',
      );
    }
    const expectedHash = this.hashVerificationCode(record.id, otp);
    if (!this.safeHashEquals(record.tokenHash, expectedHash)) {
      await this.prisma.emailVerificationToken.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          lockedAt: null,
          attemptCount: { lt: EMAIL_OTP_MAX_ATTEMPTS },
          expiresAt: { gt: new Date() },
        },
        data: { attemptCount: { increment: 1 } },
      });
      const failed = await this.prisma.emailVerificationToken.findUniqueOrThrow({
        where: { id: record.id },
        select: { attemptCount: true, lockedAt: true },
      });
      if (failed.lockedAt || failed.attemptCount >= EMAIL_OTP_MAX_ATTEMPTS) {
        await this.prisma.emailVerificationToken.updateMany({
          where: { id: record.id, lockedAt: null },
          data: { lockedAt: new Date() },
        });
        throw new ApiError(
          'VERIFICATION_ATTEMPTS_EXCEEDED',
          'Too many incorrect verification attempts',
        );
      }
      this.invalidVerificationCode();
    }
    const authenticated = await this.prisma.transaction(async (tx) => {
      const consumed = await tx.emailVerificationToken.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          lockedAt: null,
          attemptCount: { lt: EMAIL_OTP_MAX_ATTEMPTS },
          expiresAt: { gt: new Date() },
          tokenHash: expectedHash,
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) this.invalidVerificationCode();
      await tx.emailVerificationToken.updateMany({
        where: { userId: record.userId, consumedAt: null, id: { not: record.id } },
        data: { consumedAt: new Date() },
      });
      const user = await tx.user.update({
        where: { id: record.userId },
        data: { emailVerified: true, accountStatus: AccountStatus.ACTIVE },
        include: { roles: { include: { role: true } } },
      });
      const roles = user.roles.map((item) => item.role.code);
      const tokens = await this.createSession(
        user.id,
        roles,
        user.currentRoleId,
        'mobile',
        context,
        tx,
      );
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      return { tokens, user, roles };
    });
    return this.authSessionResponse(authenticated.tokens, authenticated.user, authenticated.roles);
  }

  async resendVerification(emailInput: string): Promise<VerificationAcceptedResponse> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerified || user.accountStatus !== AccountStatus.PENDING_VERIFICATION) {
      return this.dummyAcceptedChallenge();
    }
    const latest = await this.prisma.emailVerificationToken.findFirst({
      where: {
        userId: user.id,
        consumedAt: null,
        lockedAt: null,
        attemptCount: { lt: EMAIL_OTP_MAX_ATTEMPTS },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && latest.createdAt > new Date(Date.now() - EMAIL_OTP_RESEND_SECONDS * 1000)) {
      return this.acceptedChallenge(latest);
    }
    const issued = await this.prisma.transaction((tx) =>
      this.createVerificationChallenge(tx, user.id),
    );
    await this.sendVerification(email, issued.otp);
    return this.acceptedChallenge(issued.record);
  }

  async signIn(dto: SignInDto, context: SessionContext, audience: 'mobile' | 'admin' = 'mobile') {
    const email = dto.email.trim().toLowerCase();
    const identity = await this.prisma.authIdentity.findFirst({
      where: { provider: AuthProvider.EMAIL, email },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    if (!identity?.passwordHash || !(await argon2.verify(identity.passwordHash, dto.password))) {
      throw new ApiError(
        'INVALID_CREDENTIALS',
        'Email or password is incorrect',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const roles = identity.user.roles.map((item) => item.role.code);
    if (!identity.user.emailVerified) {
      throw ApiError.forbidden(
        'EMAIL_VERIFICATION_REQUIRED',
        'Verify the email address before signing in',
      );
    }
    await this.assertAccountAccess(identity.user.id, identity.user.accountStatus);
    this.assertSignInAllowed(
      identity.user.accountStatus,
      identity.user.emailVerified,
      roles,
      audience,
    );
    await this.recordCurrentLegalConsents(this.prisma, identity.user.id, context.ipAddress);
    const tokens = await this.createSession(
      identity.user.id,
      roles,
      identity.user.currentRoleId,
      audience,
      {
        ...context,
        deviceId: dto.deviceId ?? context.deviceId,
      },
    );
    await this.prisma.user.update({
      where: { id: identity.user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.authSessionResponse(tokens, identity.user, roles);
  }

  async oauthSignIn(dto: OAuthSignInDto, context: SessionContext) {
    const oauth = await this.oauth.verify(dto.provider, dto.idToken, dto.nonce);
    if (!oauth.emailVerified) {
      throw ApiError.forbidden(
        'OAUTH_EMAIL_UNVERIFIED',
        'OAuth provider did not verify the email address',
      );
    }
    const user = await this.prisma.transaction(async (tx) => {
      const identity = await tx.authIdentity.findUnique({
        where: {
          provider_providerSubject: { provider: dto.provider, providerSubject: oauth.subject },
        },
        include: { user: { include: { roles: { include: { role: true } } } } },
      });
      if (identity) return identity.user;
      const existingUser = await tx.user.findUnique({ where: { email: oauth.email } });
      if (existingUser) {
        await tx.authIdentity.create({
          data: {
            userId: existingUser.id,
            provider: dto.provider,
            providerSubject: oauth.subject,
            email: oauth.email,
          },
        });
        return tx.user.findUniqueOrThrow({
          where: { id: existingUser.id },
          include: { roles: { include: { role: true } } },
        });
      }
      const customer = await tx.role.findUniqueOrThrow({ where: { code: RoleCode.CUSTOMER } });
      const created = await tx.user.create({
        data: {
          email: oauth.email,
          emailVerified: true,
          accountStatus: AccountStatus.ACTIVE,
          authIdentities: {
            create: {
              provider: dto.provider,
              providerSubject: oauth.subject,
              email: oauth.email,
            },
          },
          profile: { create: {} },
          settings: { create: {} },
          roles: { create: { roleId: customer.id } },
        },
        include: { roles: { include: { role: true } } },
      });
      await tx.user.update({
        where: { id: created.id },
        data: { currentRoleId: created.roles[0].id },
      });
      return { ...created, currentRoleId: created.roles[0].id };
    });
    const roles = user.roles.map((item) => item.role.code);
    await this.assertAccountAccess(user.id, user.accountStatus);
    this.assertSignInAllowed(user.accountStatus, user.emailVerified, roles, 'mobile');
    await this.recordCurrentLegalConsents(this.prisma, user.id, context.ipAddress);
    const tokens = await this.createSession(user.id, roles, user.currentRoleId, 'mobile', {
      ...context,
      deviceId: dto.deviceId ?? context.deviceId,
    });
    return this.authSessionResponse(tokens, user, roles);
  }

  async refresh(refreshToken: string, context: SessionContext) {
    let claims: { sub: string; sid: string; fid: string; aud: 'mobile' | 'admin'; typ: string };
    try {
      claims = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new ApiError(
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (claims.typ !== 'refresh') {
      throw new ApiError(
        'INVALID_REFRESH_TOKEN',
        'Refresh token has invalid claims',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.prisma.authSession.findUnique({
      where: { id: claims.sid },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    if (!session || session.tokenFamilyId !== claims.fid || session.expiresAt <= new Date()) {
      throw new ApiError(
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (session.revokedAt) {
      await this.prisma.authSession.updateMany({
        where: { tokenFamilyId: session.tokenFamilyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new ApiError(
        'REFRESH_TOKEN_REUSED',
        'Refresh token reuse was detected',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (!(await argon2.verify(session.refreshTokenHash, refreshToken))) {
      throw new ApiError(
        'INVALID_REFRESH_TOKEN',
        'Refresh token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const roles = session.user.roles.map((item) => item.role.code);
    const tokens = await this.rotateSession(
      session.id,
      session.tokenFamilyId,
      session.userId,
      roles,
      session.user.currentRoleId,
      claims.aud,
      context,
    );
    return this.authSessionResponse(tokens, session.user, roles);
  }

  async signOut(user: AuthenticatedUser): Promise<{ status: 'signed_out' }> {
    await this.prisma.authSession.updateMany({
      where: { id: user.sessionId, userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { status: 'signed_out' };
  }

  async forgotPassword(emailInput: string): Promise<VerificationAcceptedResponse> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        authIdentities: {
          where: { provider: AuthProvider.EMAIL },
          select: { id: true },
        },
      },
    });
    if (!user || !user.emailVerified || !user.authIdentities.length) {
      return this.dummyPasswordResetChallenge();
    }
    const latest = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        consumedAt: null,
        verifiedAt: null,
        lockedAt: null,
        attemptCount: { lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (
      latest &&
      latest.createdAt > new Date(Date.now() - PASSWORD_RESET_OTP_RESEND_SECONDS * 1000)
    ) {
      return this.passwordResetChallenge(latest);
    }
    const issued = await this.prisma.transaction((tx) =>
      this.createPasswordResetChallenge(tx, user.id),
    );
    try {
      await this.email.send({
        to: email,
        subject: 'Photomatch password reset code',
        text: `Your Photomatch password reset code is: ${issued.otp}. It expires in 10 minutes.`,
      });
    } catch (error) {
      await this.prisma.passwordResetToken.updateMany({
        where: { id: issued.record.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      throw error;
    }
    return this.passwordResetChallenge(issued.record);
  }

  async verifyPasswordResetOtp(
    challengeId: string,
    otp: string,
  ): Promise<PasswordResetVerifiedResponse> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { id: challengeId },
    });
    if (!record || record.consumedAt || record.verifiedAt) this.invalidPasswordResetCode();
    if (record.expiresAt <= new Date()) {
      throw new ApiError('PASSWORD_RESET_CODE_EXPIRED', 'Password reset code has expired');
    }
    if (record.lockedAt || record.attemptCount >= PASSWORD_RESET_OTP_MAX_ATTEMPTS) {
      throw new ApiError(
        'PASSWORD_RESET_ATTEMPTS_EXCEEDED',
        'Too many incorrect password reset attempts',
      );
    }
    const expectedHash = this.hashVerificationCode(record.id, otp);
    if (!this.safeHashEquals(record.tokenHash, expectedHash)) {
      await this.prisma.passwordResetToken.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          verifiedAt: null,
          lockedAt: null,
          attemptCount: { lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
          expiresAt: { gt: new Date() },
        },
        data: { attemptCount: { increment: 1 } },
      });
      const failed = await this.prisma.passwordResetToken.findUniqueOrThrow({
        where: { id: record.id },
        select: { attemptCount: true, lockedAt: true },
      });
      if (failed.lockedAt || failed.attemptCount >= PASSWORD_RESET_OTP_MAX_ATTEMPTS) {
        await this.prisma.passwordResetToken.updateMany({
          where: { id: record.id, lockedAt: null },
          data: { lockedAt: new Date() },
        });
        throw new ApiError(
          'PASSWORD_RESET_ATTEMPTS_EXCEEDED',
          'Too many incorrect password reset attempts',
        );
      }
      this.invalidPasswordResetCode();
    }
    const resetToken = this.randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_GRANT_TTL_SECONDS * 1000);
    const verified = await this.prisma.passwordResetToken.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        verifiedAt: null,
        lockedAt: null,
        attemptCount: { lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
        expiresAt: { gt: now },
        tokenHash: expectedHash,
      },
      data: {
        verifiedAt: now,
        expiresAt,
        tokenHash: this.hashToken(resetToken),
      },
    });
    if (verified.count !== 1) this.invalidPasswordResetCode();
    return {
      status: 'verified',
      resetToken,
      expiresIn: PASSWORD_RESET_GRANT_TTL_SECONDS,
    };
  }

  private async recordCurrentLegalConsents(
    tx: TransactionClient,
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    const currentDocuments = await tx.legalDocument.findMany({
      where: { status: CatalogStatus.ACTIVE, effectiveAt: { lte: new Date() } },
      select: { id: true },
    });
    if (!currentDocuments.length) return;
    await tx.userConsent.createMany({
      data: currentDocuments.map((document) => ({
        userId,
        legalDocumentId: document.id,
        ipAddress,
      })),
      skipDuplicates: true,
    });
  }

  async resetPassword(
    resetToken: string,
    newPassword: string,
  ): Promise<{ status: 'password_reset' }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(resetToken) },
    });
    if (!record || !record.verifiedAt || record.consumedAt || record.expiresAt <= new Date()) {
      throw new ApiError('RESET_TOKEN_INVALID', 'Reset token is invalid or expired');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          id: record.id,
          tokenHash: this.hashToken(resetToken),
          verifiedAt: { not: null },
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new ApiError('RESET_TOKEN_INVALID', 'Reset token is invalid or expired');
      }
      await tx.authIdentity.updateMany({
        where: { userId: record.userId, provider: AuthProvider.EMAIL },
        data: { passwordHash },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, consumedAt: null, id: { not: record.id } },
        data: { consumedAt: new Date() },
      });
      await tx.authSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return { status: 'password_reset' };
  }

  private async createSession(
    userId: string,
    roles: RoleCode[],
    currentRoleId: string | null,
    audience: 'mobile' | 'admin',
    context: SessionContext,
    db: TransactionClient = this.prisma,
  ): Promise<TokenPair> {
    return this.createSessionWithFamily(
      userId,
      roles,
      currentRoleId,
      audience,
      context,
      randomUUID(),
      db,
    );
  }

  private async rotateSession(
    oldSessionId: string,
    familyId: string,
    userId: string,
    roles: RoleCode[],
    currentRoleId: string | null,
    audience: 'mobile' | 'admin',
    context: SessionContext,
  ): Promise<TokenPair> {
    const sessionId = randomUUID();
    const pair = await this.buildTokens(
      userId,
      sessionId,
      familyId,
      roles,
      currentRoleId,
      audience,
    );
    const refreshHash = await argon2.hash(pair.refreshToken, { type: argon2.argon2id });
    const rotated = await this.prisma.transaction(async (tx) => {
      const updated = await tx.authSession.updateMany({
        where: { id: oldSessionId, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: sessionId },
      });
      if (updated.count !== 1) return false;
      await tx.authSession.create({
        data: this.sessionData(
          sessionId,
          userId,
          familyId,
          refreshHash,
          context,
          pair.refreshTokenExpiresIn,
        ),
      });
      return true;
    });
    if (!rotated) {
      await this.prisma.authSession.updateMany({
        where: { tokenFamilyId: familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new ApiError(
        'REFRESH_TOKEN_REUSED',
        'Refresh token reuse was detected',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return pair;
  }

  private async createSessionWithFamily(
    userId: string,
    roles: RoleCode[],
    currentRoleId: string | null,
    audience: 'mobile' | 'admin',
    context: SessionContext,
    familyId: string,
    db: TransactionClient = this.prisma,
  ): Promise<TokenPair> {
    const sessionId = randomUUID();
    const pair = await this.buildTokens(
      userId,
      sessionId,
      familyId,
      roles,
      currentRoleId,
      audience,
    );
    const refreshHash = await argon2.hash(pair.refreshToken, { type: argon2.argon2id });
    await db.authSession.create({
      data: this.sessionData(
        sessionId,
        userId,
        familyId,
        refreshHash,
        context,
        pair.refreshTokenExpiresIn,
      ),
    });
    return pair;
  }

  private async buildTokens(
    userId: string,
    sessionId: string,
    familyId: string,
    roles: RoleCode[],
    currentRoleId: string | null,
    audience: 'mobile' | 'admin',
  ): Promise<TokenPair> {
    const accessTokenExpiresIn = this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS');
    const refreshTokenExpiresIn = this.config.getOrThrow<number>('JWT_REFRESH_TTL_SECONDS');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: userId, sid: sessionId, roleId: currentRoleId ?? undefined, roles, typ: 'access' },
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          audience,
          expiresIn: accessTokenExpiresIn,
        },
      ),
      this.jwt.signAsync(
        { sub: userId, sid: sessionId, fid: familyId, typ: 'refresh' },
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          audience,
          expiresIn: refreshTokenExpiresIn,
        },
      ),
    ]);
    return { accessToken, refreshToken, accessTokenExpiresIn, refreshTokenExpiresIn };
  }

  private sessionData(
    id: string,
    userId: string,
    familyId: string,
    refreshTokenHash: string,
    context: SessionContext,
    ttl: number,
  ): Prisma.AuthSessionUncheckedCreateInput {
    return {
      id,
      userId,
      tokenFamilyId: familyId,
      refreshTokenHash,
      deviceId: context.deviceId,
      userAgent: context.userAgent?.slice(0, 512),
      ipAddress: context.ipAddress,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  private assertSignInAllowed(
    accountStatus: AccountStatus,
    emailVerified: boolean,
    roles: RoleCode[],
    audience: 'mobile' | 'admin',
  ): void {
    if (!emailVerified) {
      throw ApiError.forbidden(
        'EMAIL_VERIFICATION_REQUIRED',
        'Verify the email address before signing in',
      );
    }
    if (accountStatus !== AccountStatus.ACTIVE) {
      throw ApiError.forbidden('ACCOUNT_RESTRICTED', 'Account is not active');
    }
    if (audience === 'admin' && !roles.includes(RoleCode.ADMIN)) {
      throw ApiError.forbidden('ADMIN_ROLE_REQUIRED', 'This account is not an administrator');
    }
    if (audience === 'mobile' && roles.length === 1 && roles[0] === RoleCode.ADMIN) {
      throw ApiError.forbidden(
        'MOBILE_ROLE_REQUIRED',
        'Administrator-only accounts cannot use mobile sign-in',
      );
    }
  }

  private async assertAccountAccess(userId: string, accountStatus: AccountStatus): Promise<void> {
    if (accountStatus === AccountStatus.ACTIVE) return;
    const restrictions = await this.prisma.accountPenalty.findMany({
      where: {
        userId,
        status: PenaltyStatus.ACTIVE,
        startsAt: { lte: new Date() },
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        penaltyType: true,
        featureCode: true,
        reason: true,
        startsAt: true,
        endsAt: true,
      },
      orderBy: { startsAt: 'desc' },
    });
    throw new ApiError('ACCOUNT_RESTRICTED', 'Account is not active', HttpStatus.FORBIDDEN, {
      accountStatus,
      restrictions,
    });
  }

  private async activeVerificationChallenge(userId: string) {
    return this.prisma.emailVerificationToken.findFirst({
      where: {
        userId,
        consumedAt: null,
        lockedAt: null,
        attemptCount: { lt: EMAIL_OTP_MAX_ATTEMPTS },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async createVerificationChallenge(tx: TransactionClient, userId: string) {
    const id = randomUUID();
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_SECONDS * 1000);
    await tx.emailVerificationToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const record = await tx.emailVerificationToken.create({
      data: {
        id,
        userId,
        tokenHash: this.hashVerificationCode(id, otp),
        expiresAt,
      },
    });
    return { record, otp };
  }

  private async createPasswordResetChallenge(tx: TransactionClient, userId: string) {
    const id = randomUUID();
    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_TTL_SECONDS * 1000);
    await tx.passwordResetToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const record = await tx.passwordResetToken.create({
      data: {
        id,
        userId,
        tokenHash: this.hashVerificationCode(id, otp),
        expiresAt,
      },
    });
    return { record, otp };
  }

  private async sendVerification(email: string, otp: string): Promise<void> {
    await this.email.send({
      to: email,
      subject: 'Verify your Photomatch account',
      text: `Your Photomatch verification code is: ${otp}. It expires in 10 minutes.`,
    });
  }

  private requiredChallenge(record: {
    id: string;
    expiresAt: Date;
    createdAt: Date;
  }): VerificationRequiredResponse {
    return { status: 'verification_required', ...this.challengeMetadata(record) };
  }

  private acceptedChallenge(record: {
    id: string;
    expiresAt: Date;
    createdAt: Date;
  }): VerificationAcceptedResponse {
    return { status: 'accepted', ...this.challengeMetadata(record) };
  }

  private challengeMetadata(record: {
    id: string;
    expiresAt: Date;
    createdAt: Date;
  }): VerificationChallengeResponse {
    return {
      challengeId: record.id,
      expiresIn: Math.max(0, Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000)),
      resendAfter: Math.max(
        0,
        Math.ceil(
          (record.createdAt.getTime() + EMAIL_OTP_RESEND_SECONDS * 1000 - Date.now()) / 1000,
        ),
      ),
    };
  }

  private dummyRequiredChallenge(): VerificationRequiredResponse {
    return {
      status: 'verification_required',
      challengeId: randomUUID(),
      expiresIn: EMAIL_OTP_TTL_SECONDS,
      resendAfter: EMAIL_OTP_RESEND_SECONDS,
    };
  }

  private dummyAcceptedChallenge(): VerificationAcceptedResponse {
    return {
      status: 'accepted',
      challengeId: randomUUID(),
      expiresIn: EMAIL_OTP_TTL_SECONDS,
      resendAfter: EMAIL_OTP_RESEND_SECONDS,
    };
  }

  private passwordResetChallenge(record: {
    id: string;
    expiresAt: Date;
    createdAt: Date;
  }): VerificationAcceptedResponse {
    return {
      status: 'accepted',
      challengeId: record.id,
      expiresIn: Math.max(0, Math.ceil((record.expiresAt.getTime() - Date.now()) / 1000)),
      resendAfter: Math.max(
        0,
        Math.ceil(
          (record.createdAt.getTime() + PASSWORD_RESET_OTP_RESEND_SECONDS * 1000 - Date.now()) /
            1000,
        ),
      ),
    };
  }

  private dummyPasswordResetChallenge(): VerificationAcceptedResponse {
    return {
      status: 'accepted',
      challengeId: randomUUID(),
      expiresIn: PASSWORD_RESET_OTP_TTL_SECONDS,
      resendAfter: PASSWORD_RESET_OTP_RESEND_SECONDS,
    };
  }

  private hashVerificationCode(challengeId: string, otp: string): string {
    return this.hashToken(`${challengeId}:${otp}`);
  }

  private safeHashEquals(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return (
      actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private invalidVerificationCode(): never {
    throw new ApiError('VERIFICATION_CODE_INVALID', 'Verification code is invalid');
  }

  private invalidPasswordResetCode(): never {
    throw new ApiError('PASSWORD_RESET_CODE_INVALID', 'Password reset code is invalid');
  }

  private userSummary(
    user: {
      id: string;
      email: string | null;
      currentRoleId: string | null;
      onboardingCompletedAt: Date | null;
    },
    roles: RoleCode[],
  ) {
    return {
      id: user.id,
      email: user.email,
      currentRoleId: user.currentRoleId,
      roles,
      onboardingCompleted: Boolean(user.onboardingCompletedAt),
    };
  }

  private authSessionResponse(
    tokens: TokenPair,
    user: {
      id: string;
      email: string | null;
      currentRoleId: string | null;
      onboardingCompletedAt: Date | null;
    },
    roles: RoleCode[],
  ) {
    return {
      ...tokens,
      expiresIn: tokens.accessTokenExpiresIn,
      tokenType: 'Bearer' as const,
      user: this.userSummary(user, roles),
    };
  }

  private randomToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
