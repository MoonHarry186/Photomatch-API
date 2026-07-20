import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Idempotent } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { CursorPageDto } from '../common/pagination';
import { CreateBlockDto, CreateReportDto } from './trust.dto';
import { TrustService } from './trust.service';

@ApiTags('trust-safety')
@ApiBearerAuth()
@Controller()
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  @Get('blocks')
  blocks(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorPageDto) {
    return this.trust.blocks(user.userId, query);
  }

  @Post('blocks')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Idempotent()
  block(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBlockDto) {
    return this.trust.block(user.userId, dto);
  }

  @Delete('blocks/:blockedUserId')
  unblock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('blockedUserId', ParseUUIDPipe) blockedUserId: string,
  ) {
    return this.trust.unblock(user.userId, blockedUserId);
  }

  @Post('reports')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Idempotent()
  report(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReportDto) {
    return this.trust.report(user.userId, dto);
  }

  @Get('me/restrictions')
  restrictions(@CurrentUser() user: AuthenticatedUser) {
    return this.trust.restrictions(user.userId);
  }
}
