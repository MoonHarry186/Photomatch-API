import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  CatalogStatus,
  PenaltyStatus,
  ReportStatus,
  ReviewStatus,
  RoleCode,
} from '@prisma/client';
import { ApiError } from '../common/api-error';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { CreatePenaltyDto, ResolveReportDto } from '../trust/trust.dto';
import { TrustService } from '../trust/trust.service';
import {
  AdminBookingQueryDto,
  AdminListQueryDto,
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
    const [users, photographers, matches, bookings, openReports, activePenalties] =
      await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.userRole.count({ where: { role: { code: RoleCode.PHOTOGRAPHER } } }),
        this.prisma.match.count(),
        this.prisma.booking.count(),
        this.prisma.userReport.count({
          where: { status: { in: [ReportStatus.OPEN, ReportStatus.IN_REVIEW] } },
        }),
        this.prisma.accountPenalty.count({ where: { status: PenaltyStatus.ACTIVE } }),
      ]);
    return { users, photographers, matches, bookings, openReports, activePenalties };
  }

  async users(query: AdminListQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const accountStatus = this.enumValue(AccountStatus, query.status);
    const items = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(accountStatus ? { accountStatus } : {}),
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
        createdAt: true,
        profile: { select: { displayName: true, avatarAssetId: true, city: true, status: true } },
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
        profile: true,
        settings: true,
        roles: {
          select: {
            id: true,
            status: true,
            role: { select: { code: true, name: true } },
            photographerProfile: true,
            selectedServices: { include: { service: true } },
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
    if (dto.action !== 'SUSPEND' && dto.action !== 'RESTORE') {
      throw new ApiError('INVALID_STATUS_ACTION', 'Action must be SUSPEND or RESTORE');
    }
    return this.prisma.transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw ApiError.notFound('User');
      const accountStatus =
        dto.action === 'SUSPEND' ? AccountStatus.SUSPENDED : AccountStatus.ACTIVE;
      const updated = await tx.user.update({ where: { id: userId }, data: { accountStatus } });
      if (dto.action === 'SUSPEND') {
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
            previousStatus: user.accountStatus,
            newStatus: accountStatus,
            reason: dto.reason,
            adminUserId,
          },
        },
      });
      return updated;
    });
  }

  async photographers(query: AdminListQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.userRole.findMany({
      where: {
        role: { code: RoleCode.PHOTOGRAPHER },
        ...(query.search
          ? { user: { profile: { displayName: { contains: query.search, mode: 'insensitive' } } } }
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
        status: true,
        createdAt: true,
        photographerProfile: true,
        user: {
          select: {
            id: true,
            accountStatus: true,
            identityVerificationStatus: true,
            profile: {
              select: { displayName: true, avatarAssetId: true, city: true, status: true },
            },
          },
        },
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
            profile: true,
          },
        },
        selectedFields: { include: { activityField: true } },
        selectedServices: { include: { service: true } },
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
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!item) throw ApiError.notFound('Photographer');
    return item;
  }

  async reviews(query: AdminListQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const status = this.enumValue(ReviewStatus, query.status);
    const items = await this.prisma.review.findMany({
      where: {
        ...(status ? { status } : {}),
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
        booking: true,
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

  async reports(query: AdminListQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const status = this.enumValue(ReportStatus, query.status);
    const items = await this.prisma.userReport.findMany({
      where: {
        ...(status ? { status } : {}),
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
        resolvedAt: true,
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
        evidence: {
          select: { assetId: true, asset: { select: { mimeType: true, status: true } } },
        },
        penalties: true,
      },
    });
    if (!report) throw ApiError.notFound('Report');
    return report;
  }

  resolveReport(adminUserId: string, reportId: string, dto: ResolveReportDto) {
    return this.trust.resolveReport(adminUserId, reportId, dto);
  }

  async penalties(query: AdminListQueryDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const status = this.enumValue(PenaltyStatus, query.status);
    const items = await this.prisma.accountPenalty.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: { user: { select: { id: true, email: true, profile: true } } },
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
    const items = await this.prisma.booking.findMany({
      where: {
        ...(query.bookingStatus ? { status: query.bookingStatus } : {}),
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
        customerRole: { include: { user: { include: { profile: true } } } },
        photographerRole: { include: { user: { include: { profile: true } } } },
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
        customerRole: { include: { user: { include: { profile: true } } } },
        photographerRole: { include: { user: { include: { profile: true } } } },
        history: { orderBy: [{ changedAt: 'asc' }, { id: 'asc' }] },
        reports: { select: { id: true, status: true, reasonCode: true, createdAt: true } },
      },
    });
    if (!booking) throw ApiError.notFound('Booking');
    return booking;
  }

  activityFields(query: AdminListQueryDto) {
    return this.prisma.activityField.findMany({
      where: query.status
        ? { status: this.enumValue(CatalogStatus, query.status) ?? undefined }
        : {},
      include: {
        roleMappings: { include: { role: true } },
        _count: { select: { services: true } },
      },
      orderBy: { name: 'asc' },
      take: query.limit,
    });
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

  services(query: AdminListQueryDto) {
    return this.prisma.service.findMany({
      where: query.status
        ? { status: this.enumValue(CatalogStatus, query.status) ?? undefined }
        : {},
      include: { activityField: true },
      orderBy: { name: 'asc' },
      take: query.limit,
    });
  }

  createService(dto: CreateServiceDto) {
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

  updateService(id: string, dto: UpdateServiceDto) {
    return this.prisma.service.update({
      where: { id },
      data: { name: dto.name?.trim(), description: dto.description?.trim(), status: dto.status },
      include: { activityField: true },
    });
  }

  legalDocuments(query: AdminListQueryDto) {
    return this.prisma.legalDocument.findMany({
      where: query.status
        ? { status: this.enumValue(CatalogStatus, query.status) ?? undefined }
        : {},
      orderBy: [{ documentType: 'asc' }, { effectiveAt: 'desc' }],
      take: query.limit,
    });
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

  private enumValue<T extends Record<string, string>>(
    values: T,
    input?: string,
  ): T[keyof T] | undefined {
    if (!input) return undefined;
    return Object.values(values).includes(input) ? (input as T[keyof T]) : undefined;
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
