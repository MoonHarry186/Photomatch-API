import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  BookingStatus,
  CatalogStatus,
  MatchStatus,
  PenaltyStatus,
  ReportStatus,
  ReviewStatus,
  RoleCode,
  Prisma,
} from '@prisma/client';
import { ApiError } from '../common/api-error';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { AdminReportStatusDto, CreatePenaltyDto, ResolveReportDto } from '../trust/trust.dto';
import { TrustService } from '../trust/trust.service';
import {
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
  ModerateReviewDto,
  UpdateActivityFieldDto,
  UpdateLegalDocumentDto,
  UpdateServiceDto,
  UserStatusActionDto,
} from './admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trust: TrustService,
  ) {}

  async dashboard() {
    const [
      activeUsers,
      photographers,
      activeMatches,
      pendingBookings,
      openReports,
      activePenalties,
    ] = await Promise.all([
      this.prisma.user.count({
        where: { deletedAt: null, accountStatus: AccountStatus.ACTIVE },
      }),
      this.prisma.userRole.count({
        where: {
          status: 'ACTIVE',
          role: { code: RoleCode.PHOTOGRAPHER },
          user: { deletedAt: null, accountStatus: AccountStatus.ACTIVE },
        },
      }),
      this.prisma.match.count({ where: { status: MatchStatus.ACTIVE } }),
      this.prisma.booking.count({ where: { status: BookingStatus.PENDING } }),
      this.prisma.userReport.count({
        where: { status: { in: [ReportStatus.OPEN, ReportStatus.IN_REVIEW] } },
      }),
      this.prisma.accountPenalty.count({ where: { status: PenaltyStatus.ACTIVE } }),
    ]);
    return {
      activeUsers,
      photographers,
      activeMatches,
      pendingBookings,
      openReports,
      activePenalties,
      // Backward-compatible aliases for the original MVP summary contract.
      users: activeUsers,
      matches: activeMatches,
      bookings: pendingBookings,
    };
  }

  async users(query: AdminUserQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { accountStatus: query.status } : {}),
        ...(query.verificationStatus
          ? { identityVerificationStatus: query.verificationStatus }
          : {}),
        ...(query.cityId ? { profile: { cityId: query.cityId } } : {}),
        ...(query.role ? { roles: { some: { role: { code: query.role } } } } : {}),
        ...(query.search
          ? {
              OR: [
                { email: { contains: query.search, mode: 'insensitive' } },
                { profile: { displayName: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        phone: true,
        accountStatus: true,
        identityVerificationStatus: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        profile: {
          select: {
            displayName: true,
            avatarAssetId: true,
            cityId: true,
            city: { select: { id: true, code: true, name: true } },
            status: true,
          },
        },
        roles: { select: { id: true, status: true, role: { select: { code: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  async userDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        accountStatus: true,
        identityVerificationStatus: true,
        emailVerified: true,
        phoneVerified: true,
        onboardingCompletedAt: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        profile: { include: { city: true } },
        settings: true,
        roles: {
          select: {
            id: true,
            status: true,
            role: { select: { code: true, name: true } },
            photographerProfile: true,
            selectedServices: { include: { service: true } },
            locationsPresence: {
              select: {
                isVisible: true,
                visibleUntil: true,
                publicRadiusMeters: true,
                updatedAt: true,
              },
            },
          },
        },
        penaltiesReceived: {
          select: {
            id: true,
            penaltyType: true,
            featureCode: true,
            reason: true,
            status: true,
            startsAt: true,
            endsAt: true,
            revokedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        _count: {
          select: {
            reportsCreated: true,
            reportsReceived: true,
            createdBookings: true,
            reviewsWritten: true,
            reviewsReceived: true,
          },
        },
      },
    });
    if (!user) throw ApiError.notFound('User');
    return user;
  }

  async userStatus(adminUserId: string, userId: string, dto: UserStatusActionDto) {
    if (!dto.reason.trim()) throw new ApiError('REASON_REQUIRED', 'Reason is required');
    if (adminUserId === userId)
      throw ApiError.forbidden('SELF_STATUS_ACTION_DENIED', 'Admin cannot change own status');
    if (
      dto.status !== AccountStatus.ACTIVE &&
      dto.status !== AccountStatus.SUSPENDED &&
      dto.status !== AccountStatus.BANNED
    ) {
      throw new ApiError('INVALID_ACCOUNT_STATUS', 'Status must be ACTIVE, SUSPENDED, or BANNED');
    }
    return this.prisma.transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { accountStatus: true },
      });
      if (!current) throw ApiError.notFound('User');
      if (current.accountStatus === AccountStatus.DELETED) {
        throw ApiError.conflict(
          'DELETED_ACCOUNT_STATUS_IMMUTABLE',
          'Deleted account status cannot be changed directly',
        );
      }
      if (current.accountStatus === dto.status) {
        throw ApiError.conflict(
          'ACCOUNT_STATUS_UNCHANGED',
          'Account already has the requested status',
          { currentStatus: current.accountStatus },
        );
      }
      const updated = await tx.user.updateMany({
        where: { id: userId, accountStatus: current.accountStatus },
        data: { accountStatus: dto.status },
      });
      if (updated.count !== 1) {
        const latest = await tx.user.findUnique({
          where: { id: userId },
          select: { accountStatus: true },
        });
        if (!latest) throw ApiError.notFound('User');
        throw ApiError.conflict(
          'ACCOUNT_STATUS_CHANGED',
          'Account status no longer permits this action',
          {
            previousStatus: current.accountStatus,
            currentStatus: latest.accountStatus,
            requestedStatus: dto.status,
          },
        );
      }
      if (dto.status !== AccountStatus.ACTIVE) {
        await tx.authSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'user',
          aggregateId: userId,
          eventType: 'admin.user_status.changed',
          payload: {
            userId,
            previousStatus: current.accountStatus,
            newStatus: dto.status,
            reason: dto.reason,
            adminUserId,
          },
        },
      });
      return tx.user.findUniqueOrThrow({ where: { id: userId } });
    });
  }

  async photographers(query: AdminPhotographerQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.userRole.findMany({
      where: {
        role: { code: RoleCode.PHOTOGRAPHER },
        ...(query.status ? { status: query.status } : {}),
        ...(query.availabilityStatus
          ? { photographerProfile: { availabilityStatus: query.availabilityStatus } }
          : {}),
        ...(query.activityFieldId
          ? { selectedFields: { some: { activityFieldId: query.activityFieldId } } }
          : {}),
        ...(query.serviceId
          ? {
              selectedServices: {
                some: { serviceId: query.serviceId, isActive: true },
              },
            }
          : {}),
        user: {
          deletedAt: null,
          ...(query.accountStatus ? { accountStatus: query.accountStatus } : {}),
          ...(query.verificationStatus
            ? { identityVerificationStatus: query.verificationStatus }
            : {}),
          ...(query.profileStatus || query.cityId || query.search
            ? {
                profile: {
                  ...(query.profileStatus ? { status: query.profileStatus } : {}),
                  ...(query.cityId ? { cityId: query.cityId } : {}),
                  ...(query.search
                    ? { displayName: { contains: query.search, mode: 'insensitive' as const } }
                    : {}),
                },
              }
            : {}),
        },
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        photographerProfile: true,
        user: {
          select: {
            id: true,
            accountStatus: true,
            identityVerificationStatus: true,
            profile: {
              select: {
                displayName: true,
                avatarAssetId: true,
                cityId: true,
                city: { select: { id: true, code: true, name: true } },
                status: true,
              },
            },
          },
        },
        selectedFields: { include: { activityField: true } },
        selectedServices: { where: { isActive: true }, include: { service: true } },
        _count: { select: { portfolioItems: true, photographerBookings: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  async photographerDetail(userRoleId: string) {
    const item = await this.prisma.userRole.findFirst({
      where: { id: userRoleId, role: { code: RoleCode.PHOTOGRAPHER } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        photographerProfile: true,
        user: {
          select: {
            id: true,
            email: true,
            accountStatus: true,
            identityVerificationStatus: true,
            profile: { include: { city: true } },
            penaltiesReceived: {
              select: {
                id: true,
                penaltyType: true,
                featureCode: true,
                reason: true,
                status: true,
                startsAt: true,
                endsAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
            _count: { select: { reportsReceived: true, reviewsReceived: true } },
          },
        },
        selectedFields: { include: { activityField: true } },
        selectedServices: { include: { service: { include: { activityField: true } } } },
        portfolioItems: {
          where: { deletedAt: null },
          select: {
            id: true,
            assetId: true,
            serviceId: true,
            title: true,
            description: true,
            sortOrder: true,
            createdAt: true,
            asset: {
              select: { id: true, mimeType: true, status: true, isPublic: true, updatedAt: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        _count: { select: { portfolioItems: true, photographerBookings: true } },
      },
    });
    if (!item) throw ApiError.notFound('Photographer');
    return item;
  }

  async reviews(query: AdminReviewQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const createdAt = this.dateRange(query.dateFrom, query.dateTo);
    const items = await this.prisma.review.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.rating ? { rating: query.rating } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(query.reviewerUserId ? { reviewerUserId: query.reviewerUserId } : {}),
        ...(query.revieweeUserId ? { revieweeUserId: query.revieweeUserId } : {}),
        ...(query.search
          ? {
              OR: [
                { comment: { contains: query.search, mode: 'insensitive' } },
                {
                  reviewer: {
                    profile: { displayName: { contains: query.search, mode: 'insensitive' } },
                  },
                },
                {
                  reviewee: {
                    profile: { displayName: { contains: query.search, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
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
        reviewer: { select: { id: true, profile: true } },
        reviewee: { select: { id: true, profile: true } },
        moderatedBy: { select: { id: true, email: true, profile: true } },
        booking: { select: { id: true, status: true, serviceId: true, completedAt: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  async reviewDetail(reviewId: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        reviewer: { select: { id: true, profile: true } },
        reviewee: { select: { id: true, profile: true } },
        moderatedBy: { select: { id: true, email: true, profile: true } },
        booking: { include: { service: true } },
      },
    });
    if (!review) throw ApiError.notFound('Review');
    return review;
  }

  async moderateReview(adminUserId: string, reviewId: string, dto: ModerateReviewDto) {
    if (![ReviewStatus.PUBLISHED, ReviewStatus.HIDDEN, ReviewStatus.REMOVED].includes(dto.status)) {
      throw new ApiError('INVALID_REVIEW_STATUS', 'Review moderation status is invalid');
    }
    if (!dto.reason.trim()) throw new ApiError('REASON_REQUIRED', 'Moderation reason is required');
    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        status: dto.status,
        moderatedByUserId: adminUserId,
        moderationReason: dto.reason.trim(),
        moderatedAt: new Date(),
      },
    });
  }

  async reports(query: AdminReportQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const createdAt = this.dateRange(query.dateFrom, query.dateTo);
    const items = await this.prisma.userReport.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.reasonCode ? { reasonCode: query.reasonCode } : {}),
        ...(query.reporterUserId ? { reporterUserId: query.reporterUserId } : {}),
        ...(query.reportedUserId ? { reportedUserId: query.reportedUserId } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...this.reportContextWhere(query.contextType),
        ...(query.search
          ? {
              OR: [
                { description: { contains: query.search, mode: 'insensitive' } },
                {
                  reporter: {
                    profile: { displayName: { contains: query.search, mode: 'insensitive' } },
                  },
                },
                {
                  reportedUser: {
                    profile: { displayName: { contains: query.search, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        reporterUserId: true,
        reportedUserId: true,
        reasonCode: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        reporter: { select: { id: true, profile: { select: { displayName: true } } } },
        reportedUser: { select: { id: true, profile: { select: { displayName: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  async reportDetail(reportId: string) {
    const report = await this.prisma.userReport.findUnique({
      where: { id: reportId },
      include: {
        reporter: { select: { id: true, profile: true } },
        reportedUser: { select: { id: true, profile: true } },
        resolvedBy: { select: { id: true, email: true, profile: true } },
        match: { select: { id: true, status: true, createdAt: true, endedAt: true } },
        conversation: { select: { id: true, status: true, createdAt: true, lastMessageAt: true } },
        message: {
          select: { id: true, messageType: true, content: true, sentAt: true, senderUserId: true },
        },
        booking: {
          select: {
            id: true,
            status: true,
            serviceId: true,
            scheduledStart: true,
            scheduledEnd: true,
            agreedPrice: true,
            currency: true,
          },
        },
        evidence: {
          select: {
            assetId: true,
            asset: {
              select: { mimeType: true, status: true, sizeBytes: true, createdAt: true },
            },
          },
        },
        penalties: true,
      },
    });
    if (!report) throw ApiError.notFound('Report');
    return {
      ...report,
      evidence: report.evidence.map((item) => ({
        ...item,
        asset: {
          ...item.asset,
          sizeBytes: item.asset.sizeBytes.toString(),
        },
      })),
    };
  }

  resolveReport(adminUserId: string, reportId: string, dto: ResolveReportDto) {
    return this.trust.resolveReport(adminUserId, reportId, dto);
  }

  reportStatus(adminUserId: string, reportId: string, dto: AdminReportStatusDto) {
    return this.trust.updateReportStatus(adminUserId, reportId, dto);
  }

  async penalties(query: AdminPenaltyQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.accountPenalty.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.penaltyType ? { penaltyType: query.penaltyType } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.effectiveFrom
          ? {
              OR: [{ endsAt: null }, { endsAt: { gte: new Date(query.effectiveFrom) } }],
            }
          : {}),
        ...(query.effectiveTo ? { startsAt: { lte: new Date(query.effectiveTo) } } : {}),
        ...(query.search
          ? {
              OR: [
                { reason: { contains: query.search, mode: 'insensitive' } },
                { user: { email: { contains: query.search, mode: 'insensitive' } } },
                {
                  user: {
                    profile: { displayName: { contains: query.search, mode: 'insensitive' } },
                  },
                },
              ],
            }
          : {}),
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
        user: { select: { id: true, email: true, profile: true } },
        report: { select: { id: true, reasonCode: true, status: true } },
        imposedBy: { select: { id: true, email: true, profile: true } },
        revokedBy: { select: { id: true, email: true, profile: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  async penaltyDetail(penaltyId: string) {
    const penalty = await this.prisma.accountPenalty.findUnique({
      where: { id: penaltyId },
      include: {
        user: { select: { id: true, email: true, profile: true } },
        report: { select: { id: true, reasonCode: true, status: true, resolution: true } },
        imposedBy: { select: { id: true, email: true, profile: true } },
        revokedBy: { select: { id: true, email: true, profile: true } },
      },
    });
    if (!penalty) throw ApiError.notFound('Penalty');
    return penalty;
  }

  createPenalty(adminUserId: string, dto: CreatePenaltyDto) {
    return this.trust.createPenalty(adminUserId, dto);
  }

  revokePenalty(adminUserId: string, penaltyId: string, reason: string) {
    return this.trust.revokePenalty(adminUserId, penaltyId, reason);
  }

  async bookings(query: AdminBookingQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const status = query.status ?? query.bookingStatus;
    const scheduledStart = this.dateRange(query.dateFrom, query.dateTo);
    const items = await this.prisma.booking.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(scheduledStart ? { scheduledStart } : {}),
        ...(query.customerUserId ? { customerRole: { userId: query.customerUserId } } : {}),
        ...(query.photographerUserId
          ? { photographerRole: { userId: query.photographerUserId } }
          : {}),
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        ...(query.search
          ? {
              OR: [
                {
                  customerRole: {
                    user: {
                      profile: { displayName: { contains: query.search, mode: 'insensitive' } },
                    },
                  },
                },
                {
                  photographerRole: {
                    user: {
                      profile: { displayName: { contains: query.search, mode: 'insensitive' } },
                    },
                  },
                },
              ],
            }
          : {}),
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
        service: true,
        customerRole: {
          select: { id: true, user: { select: { id: true, email: true, profile: true } } },
        },
        photographerRole: {
          select: { id: true, user: { select: { id: true, email: true, profile: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  async bookingDetail(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        service: true,
        customerRole: {
          select: { id: true, user: { select: { id: true, email: true, profile: true } } },
        },
        photographerRole: {
          select: { id: true, user: { select: { id: true, email: true, profile: true } } },
        },
        conversation: { select: { id: true, status: true, createdAt: true, lastMessageAt: true } },
        history: {
          include: { changedBy: { select: { id: true, email: true, profile: true } } },
          orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
        },
        reports: { select: { id: true, status: true, reasonCode: true, createdAt: true } },
      },
    });
    if (!booking) throw ApiError.notFound('Booking');
    return booking;
  }

  async activityFields(query: AdminActivityFieldQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.activityField.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
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
        roleMappings: { include: { role: true } },
        _count: { select: { services: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  async createActivityField(dto: CreateActivityFieldDto) {
    this.assertNoAdminRole(dto.allowedRoles);
    const roles = await this.prisma.role.findMany({ where: { code: { in: dto.allowedRoles } } });
    if (roles.length !== dto.allowedRoles.length)
      throw new ApiError('INVALID_ROLE_MAPPING', 'Role mapping is invalid');
    return this.prisma.activityField.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description?.trim(),
        roleMappings: { create: roles.map((role) => ({ roleId: role.id })) },
      },
      include: { roleMappings: { include: { role: true } } },
    });
  }

  activityField(id: string) {
    return this.prisma.activityField.findUniqueOrThrow({
      where: { id },
      include: { roleMappings: { include: { role: true } }, services: true },
    });
  }

  async updateActivityField(id: string, dto: UpdateActivityFieldDto) {
    if (dto.allowedRoles) this.assertNoAdminRole(dto.allowedRoles);
    if (dto.status === CatalogStatus.ARCHIVED) {
      const activeServiceCount = await this.prisma.service.count({
        where: { activityFieldId: id, status: { not: CatalogStatus.ARCHIVED } },
      });
      if (activeServiceCount > 0) {
        throw ApiError.conflict(
          'ACTIVITY_FIELD_HAS_SERVICES',
          'Archive child services before archiving the activity field',
          { activeServiceCount },
        );
      }
    }
    return this.prisma.transaction(async (tx) => {
      await tx.activityField.update({
        where: { id },
        data: { name: dto.name?.trim(), description: dto.description?.trim(), status: dto.status },
      });
      if (dto.allowedRoles) {
        const roles = await tx.role.findMany({ where: { code: { in: dto.allowedRoles } } });
        if (roles.length !== dto.allowedRoles.length)
          throw new ApiError('INVALID_ROLE_MAPPING', 'Role mapping is invalid');
        await tx.roleActivityField.deleteMany({ where: { activityFieldId: id } });
        await tx.roleActivityField.createMany({
          data: roles.map((role) => ({ roleId: role.id, activityFieldId: id })),
        });
      }
      return tx.activityField.findUniqueOrThrow({
        where: { id },
        include: { roleMappings: { include: { role: true } } },
      });
    });
  }

  async services(query: AdminServiceQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.service.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.activityFieldId ? { activityFieldId: query.activityFieldId } : {}),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { activityField: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  async createService(dto: CreateServiceDto) {
    const activityField = await this.prisma.activityField.findFirst({
      where: { id: dto.activityFieldId, status: CatalogStatus.ACTIVE },
      select: { id: true },
    });
    if (!activityField) {
      throw new ApiError(
        'INVALID_ACTIVITY_FIELD',
        'Service must belong to an active activity field',
      );
    }
    return this.prisma.service.create({
      data: {
        activityFieldId: dto.activityFieldId,
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        description: dto.description?.trim(),
      },
      include: { activityField: true },
    });
  }

  service(id: string) {
    return this.prisma.service.findUniqueOrThrow({
      where: { id },
      include: { activityField: true },
    });
  }

  async updateService(id: string, dto: UpdateServiceDto) {
    const current = await this.prisma.service.findUnique({
      where: { id },
      select: {
        activityFieldId: true,
        _count: {
          select: {
            userSelections: true,
            portfolioItems: true,
            filterSelections: true,
            shootRequests: true,
            bookings: true,
          },
        },
      },
    });
    if (!current) throw ApiError.notFound('Service');

    if (dto.activityFieldId && dto.activityFieldId !== current.activityFieldId) {
      const activityField = await this.prisma.activityField.findFirst({
        where: { id: dto.activityFieldId, status: CatalogStatus.ACTIVE },
        select: { id: true },
      });
      if (!activityField) {
        throw new ApiError(
          'INVALID_ACTIVITY_FIELD',
          'Service must belong to an active activity field',
        );
      }
      const referenceCount = Object.values(current._count).reduce(
        (total, count) => total + count,
        0,
      );
      if (referenceCount > 0) {
        throw ApiError.conflict(
          'SERVICE_FIELD_LOCKED',
          'A referenced service cannot be moved to another activity field',
          { referenceCount },
        );
      }
    }

    return this.prisma.service.update({
      where: { id },
      data: {
        activityFieldId: dto.activityFieldId,
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        status: dto.status,
      },
      include: { activityField: true },
    });
  }

  async legalDocuments(query: AdminLegalDocumentQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.legalDocument.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.documentType ? { documentType: query.documentType } : {}),
        ...(query.search ? { version: { contains: query.search, mode: 'insensitive' } } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    return this.cursorPage(items, query.limit);
  }

  createLegalDocument(dto: CreateLegalDocumentDto) {
    return this.prisma.legalDocument.create({
      data: {
        documentType: dto.documentType,
        version: dto.version.trim(),
        contentUrl: dto.contentUrl.trim(),
        effectiveAt: new Date(dto.effectiveAt),
      },
    });
  }

  legalDocument(id: string) {
    return this.prisma.legalDocument.findUniqueOrThrow({ where: { id } });
  }

  async updateLegalDocument(id: string, dto: UpdateLegalDocumentDto) {
    const document = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!document) throw ApiError.notFound('Legal document');
    if (document.status !== CatalogStatus.INACTIVE) {
      throw ApiError.conflict(
        'LEGAL_DOCUMENT_IMMUTABLE',
        'Only inactive legal versions can be edited',
      );
    }
    return this.prisma.legalDocument.update({
      where: { id },
      data: {
        contentUrl: dto.contentUrl?.trim(),
        effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : undefined,
      },
    });
  }

  async legalStatus(id: string, action: 'ACTIVATE' | 'ARCHIVE') {
    return this.prisma.transaction(async (tx) => {
      const document = await tx.legalDocument.findUnique({ where: { id } });
      if (!document) throw ApiError.notFound('Legal document');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`legal:${document.documentType}`}, 0))`;
      if (action === 'ACTIVATE') {
        await tx.legalDocument.updateMany({
          where: {
            documentType: document.documentType,
            status: CatalogStatus.ACTIVE,
            id: { not: id },
          },
          data: { status: CatalogStatus.ARCHIVED, activeTypeKey: null },
        });
        return tx.legalDocument.update({
          where: { id },
          data: { status: CatalogStatus.ACTIVE, activeTypeKey: document.documentType },
        });
      }
      if (action === 'ARCHIVE') {
        return tx.legalDocument.update({
          where: { id },
          data: { status: CatalogStatus.ARCHIVED, activeTypeKey: null },
        });
      }
      throw new ApiError('INVALID_LEGAL_ACTION', 'Legal document action is invalid');
    });
  }

  private cursorPage<T extends { id: string; createdAt: Date }>(items: T[], limit: number) {
    const hasMore = items.length > limit;
    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  private dateRange(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined {
    if (!dateFrom && !dateTo) return undefined;
    const from = dateFrom ? new Date(dateFrom) : undefined;
    const to = dateTo ? new Date(dateTo) : undefined;
    if (from && to && from > to) {
      throw new ApiError('INVALID_DATE_RANGE', 'Date from must not be later than date to');
    }
    return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  private reportContextWhere(
    contextType?: AdminReportQueryDto['contextType'],
  ): Prisma.UserReportWhereInput {
    switch (contextType) {
      case 'MATCH':
        return { matchId: { not: null } };
      case 'CONVERSATION':
        return { conversationId: { not: null } };
      case 'MESSAGE':
        return { messageId: { not: null } };
      case 'BOOKING':
        return { bookingId: { not: null } };
      case 'USER':
        return { matchId: null, conversationId: null, messageId: null, bookingId: null };
      default:
        return {};
    }
  }

  private assertNoAdminRole(roles: RoleCode[]): void {
    if (roles.includes(RoleCode.ADMIN)) {
      throw new ApiError(
        'INVALID_ROLE_MAPPING',
        'Admin role cannot be mapped to public catalog fields',
      );
    }
  }
}
