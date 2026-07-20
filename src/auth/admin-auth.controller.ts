import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RoleCode } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser, Public, Roles } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { SignInDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('sign-in')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  signIn(@Body() dto: SignInDto, @Req() request: Request) {
    return this.auth.signIn(
      dto,
      {
        userAgent: request.header('user-agent'),
        ipAddress: request.ip,
        deviceId: dto.deviceId ?? request.header('x-device-id'),
      },
      'admin',
    );
  }

  @Post('sign-out')
  @ApiBearerAuth()
  @Roles(RoleCode.ADMIN)
  signOut(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.signOut(user);
  }
}
