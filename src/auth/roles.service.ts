import { Injectable } from '@nestjs/common';
import { RoleCode, RoleStatus } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  available() {
    return this.prisma.role.findMany({
      where: {
        status: RoleStatus.ACTIVE,
        code: { in: [RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER] },
      },
      select: { id: true, code: true, name: true, description: true },
      orderBy: { code: 'asc' },
    });
  }

  async add(userId: string, roleCode: RoleCode) {
    if (roleCode === RoleCode.ADMIN)
      throw ApiError.forbidden('ADMIN_ROLE_FORBIDDEN', 'Admin role cannot be selected');
    const role = await this.prisma.role.findFirst({
      where: { code: roleCode, status: RoleStatus.ACTIVE },
    });
    if (!role) throw ApiError.notFound('Role');
    const existing = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId: role.id } },
    });
    if (existing) return existing;
    const nonAdminCount = await this.prisma.userRole.count({
      where: { userId, role: { code: { in: [RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER] } } },
    });
    if (nonAdminCount >= 2) {
      throw ApiError.conflict(
        'ROLE_SELECTION_IMMUTABLE',
        'The additional role was already selected',
      );
    }
    return this.prisma.userRole.create({
      data: {
        userId,
        roleId: role.id,
        isInitialAdditionalRole: true,
        ...(roleCode === RoleCode.PHOTOGRAPHER ? { photographerProfile: { create: {} } } : {}),
      },
      include: { role: true },
    });
  }

  async switch(userId: string, userRoleId: string) {
    const userRole = await this.prisma.userRole.findFirst({
      where: { id: userRoleId, userId, status: RoleStatus.ACTIVE },
      include: { role: true },
    });
    if (!userRole || userRole.role.code === RoleCode.ADMIN) {
      throw ApiError.forbidden('ROLE_SWITCH_FORBIDDEN', 'Role is not available for mobile use');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { currentRoleId: userRoleId } });
    return {
      currentRoleId: userRoleId,
      role: userRole.role.code,
      accessTokenRefreshRequired: true,
    };
  }
}
