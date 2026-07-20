import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Idempotent } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { CursorPageDto } from '../common/pagination';
import {
  BookingQueryDto,
  BookingStatusDto,
  CreateBookingDto,
  CreateReviewDto,
  UpdateBookingDto,
} from './bookings.dto';
import { BookingsService } from './bookings.service';
import { ReviewsService } from './reviews.service';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller()
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get('bookings')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: BookingQueryDto) {
    return this.bookings.list(user.userId, query);
  }

  @Post('bookings')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Idempotent()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user.userId, user.currentRoleId, dto);
  }

  @Get('bookings/:bookingId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    return this.bookings.detail(user.userId, bookingId);
  }

  @Patch('bookings/:bookingId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: UpdateBookingDto,
  ) {
    return this.bookings.update(user.userId, bookingId, dto);
  }

  @Post('bookings/:bookingId/status')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: BookingStatusDto,
  ) {
    return this.bookings.transition(user.userId, bookingId, dto);
  }

  @Post('bookings/:bookingId/review')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  createReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(user.userId, bookingId, dto);
  }

  @Get('bookings/:bookingId/review')
  bookingReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    return this.reviews.bookingReview(user.userId, bookingId);
  }

  @Get('photographers/:photographerRoleId/reviews')
  photographerReviews(
    @Param('photographerRoleId', ParseUUIDPipe) photographerRoleId: string,
    @Query() query: CursorPageDto,
  ) {
    return this.reviews.photographerReviews(photographerRoleId, query);
  }
}
