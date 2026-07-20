import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { RoleCode } from '@prisma/client';
import type { Request } from 'express';

export const PUBLIC_ROUTE = 'publicRoute';
export const REQUIRED_ROLES = 'requiredRoles';
export const IDEMPOTENT_ROUTE = 'idempotentRoute';

export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  currentRoleId?: string;
  roles: RoleCode[];
  audience: 'mobile' | 'admin';
}

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
  requestId?: string;
};

export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: RoleCode[]) => SetMetadata(REQUIRED_ROLES, roles);
export const Idempotent = () => SetMetadata(IDEMPOTENT_ROUTE, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new Error('CurrentUser used without authentication');
    return request.user;
  },
);
