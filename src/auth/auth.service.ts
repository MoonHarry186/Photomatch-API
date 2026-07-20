import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AccountStatus,
  AuthProvider,
  Prisma,
  PenaltyStatus,
  RoleCode,
  RoleStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../common/api-error';
import { AuthenticatedUser } from '../common/auth-context';
import { PrismaService, TransactionClient } from '../database/prisma.service';
import { EmailPort, OAuthVerifierPort } from '../integrations/integration.ports';
import { ChangePendingEmailDto, OAuthSignInDto, SignInDto, SignUpDto } from './auth.dto';

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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailPort,
    private readonly oauth: OAuthVerifierPort,
  ) {}

  async signUp(dto: SignUpDto): Promise<{ status: 'verification_required' }> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return { status: 'verification_required' };
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const token = this.randomToken();
    await this.prisma.transaction(async (tx) => {
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
      await this.storeVerificationToken(tx, user.id, token);
    });
    await this.sendVerification(email, token);
    return { status: 'verification_required' };
  }

  async verifyEmail(token: string): Promise<{ status: 'verified' }> {
    const tokenHash = this.hashToken(token);
    await this.prisma.transaction(async (tx) => {
      const record = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!record || record.consumedAt || record.expiresAt <= new Date()) {
        throw new ApiError(
          'VERIFICATION_TOKEN_INVALID',
          'Verification token is invalid or expired',
        );
      }
      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: record.userId, consumedAt: null, id: { not: record.id } },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerified: true, accountStatus: AccountStatus.ACTIVE },
      });
    });
    return { status: 'verified' };
  }

  async resendVerification(emailInput: string): Promise<{ status: 'accepted' }> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerified || user.accountStatus !== AccountStatus.PENDING_VERIFICATION) {
      return { status: 'accepted' };
    }
    const latest = await this.prisma.emailVerificationToken.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && latest.createdAt > new Date(Date.now() - 60_000)) return { status: 'accepted' };
    const token = this.randomToken();
    await this.prisma.transaction(async (tx) => this.storeVerificationToken(tx, user.id, token));
    await this.sendVerification(email, token);
    return { status: 'accepted' };
  }

  async changePendingEmail(
    dto: ChangePendingEmailDto,
  ): Promise<{ status: 'verification_required' }> {
    const currentEmail = dto.currentEmail.trim().toLowerCase();
    const newEmail = dto.newEmail.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: currentEmail },
      include: { authIdentities: { where: { provider: AuthProvider.EMAIL } } },
    });
    if (
      !user?.email ||
      user.emailVerified ||
      user.accountStatus !== AccountStatus.PENDING_VERIFICATION ||
      !user.authIdentities[0]?.passwordHash
    ) {
      throw new ApiError('PENDING_ACCOUNT_NOT_FOUND', 'Pending account could not be verified');
    }
    if (!(await argon2.verify(user.authIdentities[0].passwordHash, dto.password))) {
      throw new ApiError(
        'INVALID_CREDENTIALS',
        'Email or password is incorrect',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const token = this.randomToken();
    await this.prisma.transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { email: newEmail } });
      await tx.authIdentity.update({
        where: { id: user.authIdentities[0].id },
        data: { email: newEmail },
      });
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await this.storeVerificationToken(tx, user.id, token);
    });
    await this.sendVerification(newEmail, token);
    return { status: 'verification_required' };
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
    return {
      ...tokens,
      user: this.userSummary(identity.user, roles),
    };
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
    const tokens = await this.createSession(user.id, roles, user.currentRoleId, 'mobile', {
      ...context,
      deviceId: dto.deviceId ?? context.deviceId,
    });
    return { ...tokens, user: this.userSummary(user, roles) };
  }

  async refresh(refreshToken: string, context: SessionContext): Promise<TokenPair> {
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
    return this.rotateSession(
      session.id,
      session.tokenFamilyId,
      session.userId,
      roles,
      session.user.currentRoleId,
      claims.aud,
      context,
    );
  }

  async signOut(user: AuthenticatedUser): Promise<{ status: 'signed_out' }> {
    await this.prisma.authSession.updateMany({
      where: { id: user.sessionId, userId: user.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { status: 'signed_out' };
  }

  async forgotPassword(emailInput: string): Promise<{ status: 'accepted' }> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.emailVerified) return { status: 'accepted' };
    const token = this.randomToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    await this.email.send({
      to: email,
      subject: 'Reset your Photomatch password',
      text: `Use this single-use token to reset your password: ${token}`,
    });
    return { status: 'accepted' };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ status: 'password_reset' }> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(token) },
    });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      throw new ApiError('RESET_TOKEN_INVALID', 'Reset token is invalid or expired');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.transaction(async (tx) => {
      await tx.authIdentity.updateMany({
        where: { userId: record.userId, provider: AuthProvider.EMAIL },
        data: { passwordHash },
      });
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
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
  ): Promise<TokenPair> {
    return this.createSessionWithFamily(
      userId,
      roles,
      currentRoleId,
      audience,
      context,
      randomUUID(),
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
    await this.prisma.authSession.create({
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

  private async storeVerificationToken(
    tx: TransactionClient,
    userId: string,
    token: string,
  ): Promise<void> {
    await tx.emailVerificationToken.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  private async sendVerification(email: string, token: string): Promise<void> {
    await this.email.send({
      to: email,
      subject: 'Verify your Photomatch account',
      text: `Use this single-use token to verify your account: ${token}`,
    });
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

  private randomToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
