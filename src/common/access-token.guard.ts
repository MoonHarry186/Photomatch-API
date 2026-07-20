import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, PenaltyStatus, PenaltyType, RoleCode } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ApiError } from './api-error';
import {
  AuthenticatedRequest,
  AuthenticatedUser,
  PUBLIC_ROUTE,
  REQUIRED_ROLES,
} from './auth-context';
import { PrismaService } from '../database/prisma.service';

interface AccessClaims {
  sub: string;
  sid: string;
  roleId?: string;
  roles?: RoleCode[];
  aud?: string | string[];
  typ: 'access';
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.bearer(request.headers.authorization);
    if (!token)
      throw new ApiError('AUTH_REQUIRED', 'Authentication is required', HttpStatus.UNAUTHORIZED);

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new ApiError(
        'INVALID_ACCESS_TOKEN',
        'Access token is invalid or expired',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (claims.typ !== 'access' || !claims.sub || !claims.sid) {
      throw new ApiError(
        'INVALID_ACCESS_TOKEN',
        'Access token has invalid claims',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const [user, session, activePenalty] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { accountStatus: true, currentRoleId: true },
      }),
      this.prisma.authSession.findUnique({
        where: { id: claims.sid },
        select: { revokedAt: true, expiresAt: true },
      }),
      this.prisma.accountPenalty.findFirst({
        where: {
          userId: claims.sub,
          status: PenaltyStatus.ACTIVE,
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          penaltyType: { in: [PenaltyType.TEMPORARY_SUSPENSION, PenaltyType.PERMANENT_BAN] },
        },
        select: { id: true, penaltyType: true, endsAt: true },
      }),
    ]);
    if (!user || !session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new ApiError('SESSION_REVOKED', 'Session is no longer active', HttpStatus.UNAUTHORIZED);
    }
    if (user.accountStatus !== AccountStatus.ACTIVE || activePenalty) {
      throw new ApiError(
        'ACCOUNT_RESTRICTED',
        'Account is not allowed to perform this action',
        HttpStatus.FORBIDDEN,
        activePenalty ?? { accountStatus: user.accountStatus },
      );
    }

    const audience = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    const authenticated: AuthenticatedUser = {
      userId: claims.sub,
      sessionId: claims.sid,
      currentRoleId: user.currentRoleId ?? claims.roleId,
      roles: claims.roles ?? [],
      audience: audience === 'admin' ? 'admin' : 'mobile',
    };
    const requiredRoles = this.reflector.getAllAndOverride<RoleCode[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (
      requiredRoles?.length &&
      !requiredRoles.some((role) => authenticated.roles.includes(role))
    ) {
      throw ApiError.forbidden(
        'ROLE_FORBIDDEN',
        'The active account does not have the required role',
      );
    }
    if (requiredRoles?.includes(RoleCode.ADMIN) && authenticated.audience !== 'admin') {
      throw ApiError.forbidden(
        'ADMIN_AUDIENCE_REQUIRED',
        'Use an admin session for this operation',
      );
    }
    request.user = authenticated;
    return true;
  }

  private bearer(header?: string): string | undefined {
    if (!header?.startsWith('Bearer ')) return undefined;
    return header.slice('Bearer '.length).trim() || undefined;
  }
}
