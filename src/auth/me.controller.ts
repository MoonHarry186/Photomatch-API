import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { PrismaService } from '../database/prisma.service';
import { AddRoleDto, SwitchRoleDto } from './auth.dto';
import { RolesService } from './roles.service';

@ApiTags('identity')
@ApiBearerAuth()
@Controller()
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RolesService,
  ) {}

  @Get('me')
  async me(@CurrentUser() current: AuthenticatedUser) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: current.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        accountStatus: true,
        identityVerificationStatus: true,
        emailVerified: true,
        currentRoleId: true,
        onboardingCompletedAt: true,
        createdAt: true,
        profile: {
          select: { displayName: true, bio: true, status: true, cityId: true, avatarAssetId: true },
        },
        roles: {
          select: { id: true, status: true, role: { select: { code: true, name: true } } },
        },
      },
    });
  }

  @Get('roles/available')
  availableRoles() {
    return this.roles.available();
  }

  @Post('me/roles')
  addRole(@CurrentUser() current: AuthenticatedUser, @Body() dto: AddRoleDto) {
    return this.roles.add(current.userId, dto.role);
  }

  @Put('me/current-role')
  switchRole(@CurrentUser() current: AuthenticatedUser, @Body() dto: SwitchRoleDto) {
    return this.roles.switch(current.userId, dto.userRoleId);
  }
}
