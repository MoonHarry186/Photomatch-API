import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Idempotent } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { CursorPageDto } from '../common/pagination';
import { InterestDecisionDto, SwipeDto, UnmatchDto } from './relationships.dto';
import { RelationshipsService } from './relationships.service';

@ApiTags('relationships')
@ApiBearerAuth()
@Controller()
export class RelationshipsController {
  constructor(private readonly relationships: RelationshipsService) {}

  @Post('swipes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  swipe(@CurrentUser() user: AuthenticatedUser, @Body() dto: SwipeDto) {
    return this.relationships.swipe(user.userId, user.currentRoleId, dto);
  }

  @Get('interests/incoming')
  incoming(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorPageDto) {
    return this.relationships.incoming(user.userId, user.currentRoleId, query);
  }

  @Post('interests/:interestId/decision')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('interestId', ParseUUIDPipe) interestId: string,
    @Body() dto: InterestDecisionDto,
  ) {
    return this.relationships.decide(user.userId, user.currentRoleId, interestId, dto);
  }

  @Get('matches')
  matches(@CurrentUser() user: AuthenticatedUser, @Query() query: CursorPageDto) {
    return this.relationships.matches(user.userId, user.currentRoleId, query);
  }

  @Get('matches/:matchId')
  matchDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId', ParseUUIDPipe) matchId: string,
  ) {
    return this.relationships.matchDetail(user.userId, matchId);
  }

  @Post('matches/:matchId/unmatch')
  @Idempotent()
  unmatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() dto: UnmatchDto,
  ) {
    return this.relationships.unmatch(user.userId, matchId, dto.reason);
  }
}
