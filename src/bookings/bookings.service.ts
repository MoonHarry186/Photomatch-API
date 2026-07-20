import { Injectable } from '@nestjs/common';
import {
  BookingStatus,
  CatalogStatus,
  ConversationStatus,
  MatchStatus,
  NotificationType,
  Prisma,
  RoleCode,
  RoleStatus,
  ServiceMode,
} from '@prisma/client';
import { ApiError } from '../common/api-error';
import { FeatureAccessService } from '../common/feature-access.service';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService, TransactionClient } from '../database/prisma.service';
import { EligibilityService } from '../profiles/eligibility.service';
import { PairOrchestrationService } from '../relationships/pair-orchestration.service';
import {
  BookingQueryDto,
  BookingStatusDto,
  CreateBookingDto,
  UpdateBookingDto,
} from './bookings.dto';
import { assertBookingTransition } from './booking-state-machine';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pairs: PairOrchestrationService,
    private readonly eligibility: EligibilityService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  async create(userId: string, currentRoleId: string | undefined, dto: CreateBookingDto) {
    await this.featureAccess.assertAllowed(userId, 'BOOKING');
    const creatorRole = await this.currentRole(userId, currentRoleId);
    const roles = await this.resolveParties(creatorRole, dto);
    this.validateTerms(dto.scheduledStart, dto.scheduledEnd, dto.currency, dto.agreedPrice);
    await this.assertBookableService(dto.photographerUserRoleId, dto.serviceId);
    await this.assertNoBlock(roles.customer.userId, roles.photographer.userId);
    if (creatorRole.role.code === RoleCode.CUSTOMER) {
      const targetEligibility = await this.eligibility.discovery(roles.photographer.id);
      if (!targetEligibility.eligible) {
        throw ApiError.forbidden(
          'PHOTOGRAPHER_INELIGIBLE',
          'Photographer is not eligible for booking',
        );
      }
    }

    return this.prisma.transaction(async (tx) => {
      let pair;
      if (creatorRole.role.code === RoleCode.CUSTOMER) {
        pair = await this.pairs.ensurePairInTransaction(
          tx,
          roles.customer.id,
          roles.photographer.id,
        );
      } else {
        pair = await this.existingPair(
          tx,
          roles.customer.id,
          roles.photographer.id,
          dto.conversationId,
        );
      }
      const booking = await tx.booking.create({
        data: {
          matchId: pair.matchId,
          conversationId: pair.conversationId,
          customerUserRoleId: roles.customer.id,
          photographerUserRoleId: roles.photographer.id,
          serviceId: dto.serviceId,
          creatorUserId: userId,
          status: BookingStatus.PENDING,
          agreedPrice: dto.agreedPrice,
          currency: dto.currency.toUpperCase(),
          scheduledStart: new Date(dto.scheduledStart),
          scheduledEnd: new Date(dto.scheduledEnd),
          address: dto.address.trim(),
          note: dto.note?.trim(),
          history: {
            create: {
              changedByUserId: userId,
              previousStatus: null,
              newStatus: BookingStatus.PENDING,
              note: 'Booking created',
            },
          },
        },
        select: this.detailProjection(),
      });
      const recipientUserId =
        userId === roles.customer.userId ? roles.photographer.userId : roles.customer.userId;
      await tx.notification.create({
        data: {
          recipientUserId,
          actorUserId: userId,
          matchId: pair.matchId,
          bookingId: booking.id,
          notificationType: NotificationType.BOOKING_CREATED,
          payload: { bookingId: booking.id, deepLink: `photomatch://bookings/${booking.id}` },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'booking',
          aggregateId: booking.id,
          eventType: 'booking.created',
          payload: {
            bookingId: booking.id,
            status: BookingStatus.PENDING,
            conversationId: pair.conversationId,
            recipientUserId,
            matchCreatedByBooking: pair.created,
          },
        },
      });
      return booking;
    });
  }

  async list(userId: string, query: BookingQueryDto) {
    const cursor = decodeCursor<{ scheduledStart: string; id: string }>(query.cursor);
    const items = await this.prisma.booking.findMany({
      where: {
        OR: [{ customerRole: { userId } }, { photographerRole: { userId } }],
        ...(query.status ? { status: query.status } : {}),
        scheduledStart: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
        },
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { scheduledStart: { gt: new Date(cursor.scheduledStart) } },
                    { scheduledStart: new Date(cursor.scheduledStart), id: { gt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: {
        customerRole: {
          include: {
            role: true,
            user: { include: { profile: true } },
          },
        },
        photographerRole: {
          include: {
            role: true,
            user: { include: { profile: true } },
          },
        },
        service: true,
      },
      orderBy: [{ scheduledStart: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((item) => ({
        ...item,
        counterpart:
          item.customerRole.userId === userId
            ? this.roleSummary(item.photographerRole)
            : this.roleSummary(item.customerRole),
        customerRole: undefined,
        photographerRole: undefined,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ scheduledStart: last.scheduledStart.toISOString(), id: last.id })
          : null,
    };
  }

  async detail(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        OR: [{ customerRole: { userId } }, { photographerRole: { userId } }],
      },
      select: this.detailProjection(),
    });
    if (!booking) throw ApiError.notFound('Booking');
    return booking;
  }

  async update(userId: string, bookingId: string, dto: UpdateBookingDto) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, creatorUserId: userId },
    });
    if (!booking)
      throw ApiError.forbidden('BOOKING_UPDATE_DENIED', 'Only the booking creator may update it');
    if (booking.status !== BookingStatus.PENDING) {
      throw ApiError.conflict(
        'BOOKING_NOT_EDITABLE',
        'Core terms can only be changed while booking is pending',
      );
    }
    if (dto.serviceId)
      await this.assertBookableService(booking.photographerUserRoleId, dto.serviceId);
    const start = dto.scheduledStart ?? booking.scheduledStart.toISOString();
    const end = dto.scheduledEnd ?? booking.scheduledEnd.toISOString();
    this.validateTerms(
      start,
      end,
      booking.currency,
      dto.agreedPrice ?? Number(booking.agreedPrice),
    );
    const materialChanged = Boolean(
      dto.serviceId ||
        dto.agreedPrice !== undefined ||
        dto.scheduledStart ||
        dto.scheduledEnd ||
        dto.address,
    );
    return this.prisma.transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: {
          serviceId: dto.serviceId,
          agreedPrice: dto.agreedPrice,
          scheduledStart: dto.scheduledStart ? new Date(dto.scheduledStart) : undefined,
          scheduledEnd: dto.scheduledEnd ? new Date(dto.scheduledEnd) : undefined,
          address: dto.address?.trim(),
          note: dto.note?.trim(),
        },
        select: this.detailProjection(),
      });
      if (materialChanged) {
        const recipientUserId =
          updated.customerRole.userId === userId
            ? updated.photographerRole.userId
            : updated.customerRole.userId;
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'booking',
            aggregateId: bookingId,
            eventType: 'booking.updated',
            payload: { bookingId, recipientUserId, materialChanged: true },
          },
        });
      }
      return updated;
    });
  }

  async transition(userId: string, bookingId: string, dto: BookingStatusDto) {
    await this.featureAccess.assertAllowed(userId, 'BOOKING');
    return this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${bookingId}`}, 0))`;
      const booking = await tx.booking.findFirst({
        where: {
          id: bookingId,
          OR: [{ customerRole: { userId } }, { photographerRole: { userId } }],
        },
        include: { customerRole: true, photographerRole: true },
      });
      if (!booking) throw ApiError.notFound('Booking');
      if (booking.status === dto.status) return this.detailInTransaction(tx, userId, bookingId);
      assertBookingTransition(
        {
          status: booking.status,
          creatorUserId: booking.creatorUserId,
          scheduledStart: booking.scheduledStart,
          customerUserId: booking.customerRole.userId,
          photographerUserId: booking.photographerRole.userId,
        },
        userId,
        dto.status,
        dto.reason,
      );
      const now = new Date();
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: dto.status,
          completedAt: dto.status === BookingStatus.COMPLETED ? now : undefined,
          cancellationReason:
            dto.status === BookingStatus.CANCELLED || dto.status === BookingStatus.REJECTED
              ? dto.reason
              : undefined,
        },
      });
      await tx.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          changedByUserId: userId,
          previousStatus: booking.status,
          newStatus: dto.status,
          note: dto.reason,
        },
      });
      const recipientUserId =
        booking.customerRole.userId === userId
          ? booking.photographerRole.userId
          : booking.customerRole.userId;
      await tx.notification.create({
        data: {
          recipientUserId,
          actorUserId: userId,
          bookingId: booking.id,
          matchId: booking.matchId,
          notificationType: NotificationType.BOOKING_STATUS_CHANGED,
          payload: {
            bookingId: booking.id,
            status: dto.status,
            deepLink: `photomatch://bookings/${booking.id}`,
          },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'booking',
          aggregateId: booking.id,
          eventType: 'booking.status_changed',
          payload: {
            bookingId: booking.id,
            conversationId: booking.conversationId,
            previousStatus: booking.status,
            newStatus: dto.status,
            recipientUserId,
          },
        },
      });
      return this.detailInTransaction(tx, userId, bookingId);
    });
  }

  private async resolveParties(
    creatorRole: Awaited<ReturnType<BookingsService['currentRole']>>,
    dto: CreateBookingDto,
  ) {
    if (
      creatorRole.role.code !== RoleCode.CUSTOMER &&
      creatorRole.role.code !== RoleCode.PHOTOGRAPHER
    ) {
      throw ApiError.forbidden('BOOKING_ROLE_FORBIDDEN', 'Current role cannot create a booking');
    }
    const customerRoleId =
      creatorRole.role.code === RoleCode.CUSTOMER ? creatorRole.id : dto.customerUserRoleId;
    if (!customerRoleId) throw new ApiError('CUSTOMER_REQUIRED', 'Customer role is required');
    if (
      creatorRole.role.code === RoleCode.PHOTOGRAPHER &&
      creatorRole.id !== dto.photographerUserRoleId
    ) {
      throw ApiError.forbidden(
        'PHOTOGRAPHER_OWNERSHIP_REQUIRED',
        'Photographer may only book as current role',
      );
    }
    const [customer, photographer] = await Promise.all([
      this.prisma.userRole.findFirst({
        where: { id: customerRoleId, status: RoleStatus.ACTIVE, role: { code: RoleCode.CUSTOMER } },
      }),
      this.prisma.userRole.findFirst({
        where: {
          id: dto.photographerUserRoleId,
          status: RoleStatus.ACTIVE,
          role: { code: RoleCode.PHOTOGRAPHER },
        },
      }),
    ]);
    if (!customer || !photographer) throw ApiError.notFound('Booking participant');
    return { customer, photographer };
  }

  private currentRole(userId: string, currentRoleId?: string) {
    if (!currentRoleId) throw new ApiError('CURRENT_ROLE_REQUIRED', 'Select a current role first');
    return this.prisma.userRole.findFirstOrThrow({
      where: { id: currentRoleId, userId, status: RoleStatus.ACTIVE },
      include: { role: true },
    });
  }

  private async assertBookableService(photographerUserRoleId: string, serviceId: string) {
    const offered = await this.prisma.userRoleService.findFirst({
      where: {
        userRoleId: photographerUserRoleId,
        serviceId,
        serviceMode: ServiceMode.OFFERED,
        isActive: true,
        service: { status: CatalogStatus.ACTIVE },
      },
    });
    if (!offered)
      throw new ApiError('SERVICE_NOT_OFFERED', 'Service is not actively offered by photographer');
  }

  private validateTerms(startInput: string, endInput: string, currency: string, price: number) {
    const start = new Date(startInput);
    const end = new Date(endInput);
    if (end <= start)
      throw new ApiError('INVALID_BOOKING_SCHEDULE', 'Scheduled end must be later than start');
    if (start <= new Date())
      throw new ApiError('INVALID_BOOKING_SCHEDULE', 'Booking must start in the future');
    if (currency.toUpperCase() !== 'VND')
      throw new ApiError('INVALID_CURRENCY', 'MVP bookings use VND');
    if (price < 0) throw new ApiError('INVALID_PRICE', 'Agreed price must be non-negative');
  }

  private async assertNoBlock(firstUserId: string, secondUserId: string) {
    const blocked = await this.prisma.userBlock.count({
      where: {
        OR: [
          { blockerUserId: firstUserId, blockedUserId: secondUserId },
          { blockerUserId: secondUserId, blockedUserId: firstUserId },
        ],
      },
    });
    if (blocked) throw ApiError.forbidden('RELATIONSHIP_BLOCKED', 'The relationship is blocked');
  }

  private async existingPair(
    tx: TransactionClient,
    customerRoleId: string,
    photographerRoleId: string,
    conversationId?: string,
  ) {
    if (!conversationId) {
      throw ApiError.forbidden(
        'ACTIVE_CONVERSATION_REQUIRED',
        'Photographer booking requires an active conversation',
      );
    }
    const pair = await tx.conversation.findFirst({
      where: {
        id: conversationId,
        status: ConversationStatus.ACTIVE,
        match: {
          status: MatchStatus.ACTIVE,
          OR: [
            { userRoleAId: customerRoleId, userRoleBId: photographerRoleId },
            { userRoleAId: photographerRoleId, userRoleBId: customerRoleId },
          ],
        },
      },
      select: { id: true, matchId: true },
    });
    if (!pair)
      throw ApiError.forbidden(
        'ACTIVE_CONVERSATION_REQUIRED',
        'Photographer booking requires an active match',
      );
    return { matchId: pair.matchId, conversationId: pair.id, created: false };
  }

  private detailInTransaction(tx: TransactionClient, userId: string, bookingId: string) {
    return tx.booking.findFirstOrThrow({
      where: {
        id: bookingId,
        OR: [{ customerRole: { userId } }, { photographerRole: { userId } }],
      },
      select: this.detailProjection(),
    });
  }

  private listProjection(): Prisma.BookingSelect {
    return {
      id: true,
      status: true,
      serviceId: true,
      agreedPrice: true,
      currency: true,
      scheduledStart: true,
      scheduledEnd: true,
      address: true,
      conversationId: true,
      createdAt: true,
      customerRole: { select: this.participantProjection() },
      photographerRole: { select: this.participantProjection() },
      service: { select: { id: true, code: true, name: true } },
    };
  }

  private detailProjection(): Prisma.BookingSelect {
    return {
      ...this.listProjection(),
      matchId: true,
      creatorUserId: true,
      note: true,
      cancellationReason: true,
      completedAt: true,
      updatedAt: true,
      history: {
        select: {
          id: true,
          changedByUserId: true,
          previousStatus: true,
          newStatus: true,
          note: true,
          changedAt: true,
        },
        orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
      },
    };
  }

  private participantProjection(): Prisma.UserRoleSelect {
    return {
      id: true,
      userId: true,
      role: { select: { code: true } },
      user: { select: { profile: { select: { displayName: true, avatarAssetId: true } } } },
    };
  }

  private roleSummary(role: {
    id: string;
    role: { code: RoleCode };
    user: { profile: { displayName: string | null; avatarAssetId: string | null } | null };
  }) {
    return {
      userRoleId: role.id,
      role: role.role.code,
      displayName: role.user.profile?.displayName,
      avatarAssetId: role.user.profile?.avatarAssetId,
    };
  }
}
