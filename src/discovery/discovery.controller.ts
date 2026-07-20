import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { DiscoveryQueryDto, PutLocationDto, PutPresenceDto } from './discovery.dto';
import { DiscoveryService } from './discovery.service';

@ApiTags('discovery')
@ApiBearerAuth()
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Put('me/location')
  putLocation(@CurrentUser() user: AuthenticatedUser, @Body() dto: PutLocationDto) {
    return this.discovery.putLocation(user.userId, dto);
  }

  @Delete('me/location')
  deleteLocation(@CurrentUser() user: AuthenticatedUser) {
    return this.discovery.deleteLocation(user.userId);
  }

  @Get('me/discovery-presence')
  presence(@CurrentUser() user: AuthenticatedUser) {
    return this.discovery.presence(user.userId, user.currentRoleId);
  }

  @Put('me/discovery-presence')
  putPresence(@CurrentUser() user: AuthenticatedUser, @Body() dto: PutPresenceDto) {
    return this.discovery.enable(user.userId, dto);
  }

  @Get('discovery/candidates')
  candidates(@CurrentUser() user: AuthenticatedUser, @Query() query: DiscoveryQueryDto) {
    return this.discovery.candidates(user.userId, user.currentRoleId, query);
  }

  @Get('nearby')
  nearby(@CurrentUser() user: AuthenticatedUser, @Query() query: DiscoveryQueryDto) {
    return this.discovery.candidates(user.userId, user.currentRoleId, query);
  }
}
