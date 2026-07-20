import { Injectable } from '@nestjs/common';
import { BookingStatus, ReviewStatus, RoleCode } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { FeatureAccessService } from '../common/feature-access.service';
import { CursorPageDto, decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { CreateReviewDto } from './bookings.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  async create(userId: string, bookingId: string, dto: CreateReviewDto) {
    await this.featureAccess.assertAllowed(userId, 'REVIEW');
    if (!Number.isInteger(dto.rating) || dto.rating < 1 || dto.rating > 5) {
      throw new ApiError('INVALID_RATING', 'Rating must be an integer from 1 to 5');
    }
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerRole: { userId } },
      include: { customerRole: true, photographerRole: true, review: true },
    });
    if (!booking)
      throw ApiError.forbidden('REVIEW_NOT_ALLOWED', 'Only the booking Customer can review');
    if (booking.status !== BookingStatus.COMPLETED) {
      throw ApiError.conflict(
        'BOOKING_NOT_COMPLETED',
        'Review is available after booking completion',
      );
    }
    if (booking.review) {
      const sameReview =
        booking.review.rating === dto.rating &&
        (booking.review.comment ?? null) === (dto.comment?.trim() || null);
      if (sameReview) return this.serialize(booking.review);
      throw ApiError.conflict('REVIEW_ALREADY_EXISTS', 'This booking already has a review');
    }
    return this.prisma.review
      .create({
        data: {
          bookingId,
          reviewerUserId: userId,
          revieweeUserId: booking.photographerRole.userId,
          rating: dto.rating,
          comment: dto.comment?.trim(),
          status: ReviewStatus.PUBLISHED,
        },
      })
      .then((review) => this.serialize(review));
  }

  async bookingReview(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId },
      include: { customerRole: true, photographerRole: true, review: true },
    });
    if (!booking?.review) throw ApiError.notFound('Review');
    const participant =
      booking.customerRole.userId === userId || booking.photographerRole.userId === userId;
    if (!participant && booking.review.status !== ReviewStatus.PUBLISHED) {
      throw ApiError.forbidden('REVIEW_ACCESS_DENIED', 'Review is not public');
    }
    return this.serialize(booking.review);
  }

  async photographerReviews(photographerRoleId: string, query: CursorPageDto) {
    const role = await this.prisma.userRole.findFirst({
      where: { id: photographerRoleId, role: { code: RoleCode.PHOTOGRAPHER } },
    });
    if (!role) throw ApiError.notFound('Photographer');
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const [reviews, aggregate] = await Promise.all([
      this.prisma.review.findMany({
        where: {
          revieweeUserId: role.userId,
          status: ReviewStatus.PUBLISHED,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        include: {
          reviewer: { select: { profile: { select: { displayName: true, avatarAssetId: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.prisma.review.aggregate({
        where: { revieweeUserId: role.userId, status: ReviewStatus.PUBLISHED },
        _avg: { rating: true },
        _count: { rating: true },
      }),
    ]);
    const hasMore = reviews.length > query.limit;
    const page = reviews.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      summary: { average: aggregate._avg.rating ?? 0, count: aggregate._count.rating },
      items: page.map((review) => ({
        ...this.serialize(review),
        customer: {
          displayName: review.reviewer.profile?.displayName,
          avatarAssetId: review.reviewer.profile?.avatarAssetId,
        },
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  private serialize(review: {
    id: string;
    bookingId: string;
    rating: number;
    comment: string | null;
    status: ReviewStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: review.id,
      bookingId: review.bookingId,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }
}
