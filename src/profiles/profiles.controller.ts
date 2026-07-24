import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { CursorPageDto } from '../common/pagination';
import {
  AttachAvatarDto,
  ConsentDto,
  CreatePortfolioItemDto,
  ReorderPortfolioDto,
  ReplaceFieldsDto,
  ReplaceServicesDto,
  UpdatePhotographerProfileDto,
  UpdatePortfolioItemDto,
  UpdateProfileDto,
  UpdateSettingsDto,
} from './profiles.dto';
import { ProfilesService } from './profiles.service';

@ApiTags('profiles')
@ApiBearerAuth()
@Controller()
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('me/onboarding/progress')
  onboardingProgress(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.onboardingProgress(user.userId, user.currentRoleId);
  }

  @Get('me/profile')
  self(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.self(user.userId);
  }

  @Patch('me/profile')
  updateSelf(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.profiles.updateSelf(user.userId, user.currentRoleId, dto);
  }

  @Get('profiles/:userRoleId')
  publicProfile(@Param('userRoleId', ParseUUIDPipe) userRoleId: string) {
    return this.profiles.publicProfile(userRoleId);
  }

  @Put('me/profile/avatar')
  attachAvatar(@CurrentUser() user: AuthenticatedUser, @Body() dto: AttachAvatarDto) {
    return this.profiles.attachAvatar(user.userId, user.currentRoleId, dto.assetId);
  }

  @Delete('me/profile/avatar')
  deleteAvatar(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.deleteAvatar(user.userId, user.currentRoleId);
  }

  @Get('me/roles/:userRoleId/activity-fields')
  fields(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
  ) {
    return this.profiles.fields(user.userId, userRoleId);
  }

  @Put('me/roles/:userRoleId/activity-fields')
  replaceFields(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
    @Body() dto: ReplaceFieldsDto,
  ) {
    return this.profiles.replaceFields(user.userId, userRoleId, dto);
  }

  @Get('me/roles/:userRoleId/services')
  services(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
  ) {
    return this.profiles.services(user.userId, userRoleId);
  }

  @Put('me/roles/:userRoleId/services')
  replaceServices(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
    @Body() dto: ReplaceServicesDto,
  ) {
    return this.profiles.replaceServices(user.userId, userRoleId, dto);
  }

  @Get('me/consents')
  consents(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.consents(user.userId);
  }

  @Post('me/consents')
  consent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConsentDto,
    @Req() request: Request,
  ) {
    return this.profiles.consent(user.userId, dto.legalDocumentId, request.ip);
  }

  @Get('me/photographer-profile')
  photographerSelf(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.photographerSelf(user.userId);
  }

  @Patch('me/photographer-profile')
  updatePhotographer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePhotographerProfileDto,
  ) {
    return this.profiles.updatePhotographer(user.userId, dto);
  }

  @Get('me/roles/:userRoleId/portfolio')
  portfolio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
  ) {
    return this.profiles.portfolio(user.userId, userRoleId);
  }

  @Post('me/roles/:userRoleId/portfolio')
  createPortfolio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
    @Body() dto: CreatePortfolioItemDto,
  ) {
    return this.profiles.createPortfolio(user.userId, userRoleId, dto);
  }

  @Get('me/roles/:userRoleId/portfolio/:itemId')
  portfolioDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.profiles.portfolioDetail(user.userId, userRoleId, itemId);
  }

  @Patch('me/roles/:userRoleId/portfolio/:itemId')
  updatePortfolio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdatePortfolioItemDto,
  ) {
    return this.profiles.updatePortfolio(user.userId, userRoleId, itemId, dto);
  }

  @Put('me/roles/:userRoleId/portfolio/reorder')
  reorderPortfolio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
    @Body() dto: ReorderPortfolioDto,
  ) {
    return this.profiles.reorderPortfolio(user.userId, userRoleId, dto);
  }

  @Delete('me/roles/:userRoleId/portfolio/:itemId')
  deletePortfolio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userRoleId', ParseUUIDPipe) userRoleId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.profiles.deletePortfolio(user.userId, userRoleId, itemId);
  }

  @Get('photographers/:photographerRoleId/portfolio')
  publicPortfolio(
    @Param('photographerRoleId', ParseUUIDPipe) photographerRoleId: string,
    @Query() query: CursorPageDto,
  ) {
    return this.profiles.publicPortfolio(photographerRoleId, query);
  }

  @Get('me/settings')
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.settings(user.userId);
  }

  @Patch('me/settings')
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSettingsDto) {
    return this.profiles.updateSettings(user.userId, dto);
  }
}
