import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RoleCode } from '@prisma/client';
import { CurrentUser, Idempotent, Roles } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import {
  AdminReportStatusDto,
  CreatePenaltyDto,
  ResolveReportDto,
  RevokePenaltyDto,
} from '../trust/trust.dto';
import {
  ADMIN_FEATURE_CODES,
  AdminActivityFieldQueryDto,
  AdminBookingQueryDto,
  AdminLegalDocumentQueryDto,
  AdminPenaltyQueryDto,
  AdminPhotographerQueryDto,
  AdminReportQueryDto,
  AdminReviewQueryDto,
  AdminServiceQueryDto,
  AdminUserQueryDto,
  CreateActivityFieldDto,
  CreateLegalDocumentDto,
  CreateServiceDto,
  LegalStatusActionDto,
  ModerateReviewDto,
  UpdateActivityFieldDto,
  UpdateLegalDocumentDto,
  UpdateServiceDto,
  UserStatusActionDto,
} from './admin.dto';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(RoleCode.ADMIN)
@Controller('admin')
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard/summary')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('feature-codes')
  featureCodes() {
    return { version: '1.0.0', items: ADMIN_FEATURE_CODES };
  }

  @Get('users')
  users(@Query() query: AdminUserQueryDto) {
    return this.admin.users(query);
  }

  @Get('users/:userId')
  userDetail(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.admin.userDetail(userId);
  }

  @Post('users/:userId/status')
  @Idempotent()
  userStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UserStatusActionDto,
  ) {
    return this.admin.userStatus(user.userId, userId, dto);
  }

  @Get('photographers')
  photographers(@Query() query: AdminPhotographerQueryDto) {
    return this.admin.photographers(query);
  }

  @Get('photographers/:userRoleId')
  photographerDetail(@Param('userRoleId', ParseUUIDPipe) userRoleId: string) {
    return this.admin.photographerDetail(userRoleId);
  }

  @Get('reviews')
  reviews(@Query() query: AdminReviewQueryDto) {
    return this.admin.reviews(query);
  }

  @Get('reviews/:reviewId')
  reviewDetail(@Param('reviewId', ParseUUIDPipe) reviewId: string) {
    return this.admin.reviewDetail(reviewId);
  }

  @Post('reviews/:reviewId/status')
  @Idempotent()
  moderateReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.admin.moderateReview(user.userId, reviewId, dto);
  }

  @Get('reports')
  reports(@Query() query: AdminReportQueryDto) {
    return this.admin.reports(query);
  }

  @Get('reports/:reportId')
  reportDetail(@Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.admin.reportDetail(reportId);
  }

  @Post('reports/:reportId/status')
  @Idempotent()
  reportStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: AdminReportStatusDto,
  ) {
    return this.admin.reportStatus(user.userId, reportId, dto);
  }

  @Post('reports/:reportId/resolve')
  @Idempotent()
  resolveReport(
    @CurrentUser() user: AuthenticatedUser,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.admin.resolveReport(user.userId, reportId, dto);
  }

  @Get('penalties')
  penalties(@Query() query: AdminPenaltyQueryDto) {
    return this.admin.penalties(query);
  }

  @Post('penalties')
  @Idempotent()
  createPenalty(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePenaltyDto) {
    return this.admin.createPenalty(user.userId, dto);
  }

  @Get('penalties/:penaltyId')
  penaltyDetail(@Param('penaltyId', ParseUUIDPipe) penaltyId: string) {
    return this.admin.penaltyDetail(penaltyId);
  }

  @Post('penalties/:penaltyId/revoke')
  @Idempotent()
  revokePenalty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('penaltyId', ParseUUIDPipe) penaltyId: string,
    @Body() dto: RevokePenaltyDto,
  ) {
    return this.admin.revokePenalty(user.userId, penaltyId, dto.reason);
  }

  @Get('bookings')
  bookings(@Query() query: AdminBookingQueryDto) {
    return this.admin.bookings(query);
  }

  @Get('bookings/:bookingId')
  bookingDetail(@Param('bookingId', ParseUUIDPipe) bookingId: string) {
    return this.admin.bookingDetail(bookingId);
  }

  @Get('activity-fields')
  activityFields(@Query() query: AdminActivityFieldQueryDto) {
    return this.admin.activityFields(query);
  }

  @Post('activity-fields')
  createActivityField(@Body() dto: CreateActivityFieldDto) {
    return this.admin.createActivityField(dto);
  }

  @Get('activity-fields/:id')
  activityField(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.activityField(id);
  }

  @Patch('activity-fields/:id')
  updateActivityField(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateActivityFieldDto) {
    return this.admin.updateActivityField(id, dto);
  }

  @Get('services')
  services(@Query() query: AdminServiceQueryDto) {
    return this.admin.services(query);
  }

  @Post('services')
  createService(@Body() dto: CreateServiceDto) {
    return this.admin.createService(dto);
  }

  @Get('services/:id')
  service(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.service(id);
  }

  @Patch('services/:id')
  updateService(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceDto) {
    return this.admin.updateService(id, dto);
  }

  @Get('legal-documents')
  legalDocuments(@Query() query: AdminLegalDocumentQueryDto) {
    return this.admin.legalDocuments(query);
  }

  @Post('legal-documents')
  createLegalDocument(@Body() dto: CreateLegalDocumentDto) {
    return this.admin.createLegalDocument(dto);
  }

  @Get('legal-documents/:id')
  legalDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.legalDocument(id);
  }

  @Patch('legal-documents/:id')
  updateLegalDocument(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLegalDocumentDto) {
    return this.admin.updateLegalDocument(id, dto);
  }

  @Post('legal-documents/:id/status')
  @Idempotent()
  legalStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LegalStatusActionDto) {
    return this.admin.legalStatus(id, dto.action);
  }
}
