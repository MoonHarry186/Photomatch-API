import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  ConversationStatus,
  MatchStatus,
  NotificationType,
  PenaltyStatus,
  PenaltyType,
  ReportStatus,
  UploadPurpose,
} from '@prisma/client';
import { ApiError } from '../common/api-error';
import { CursorPageDto, decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService, TransactionClient } from '../database/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateBlockDto, CreatePenaltyDto, CreateReportDto, ResolveReportDto } from './trust.dto';

@Injectable()
export class TrustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
  ) {}

  async blocks(userId: string, query: CursorPageDto) {
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.userBlock.findMany({
      where: {
        blockerUserId: userId,
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
        reason: true,
        createdAt: true,
        blocked: {
          select: { id: true, profile: { select: { displayName: true, avatarAssetId: true } } },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async block(userId: string, dto: CreateBlockDto) {
    if (userId === dto.blockedUserId)
      throw new ApiError('SELF_BLOCK_FORBIDDEN', 'Cannot block own account');
    const target = await this.prisma.user.findUnique({ where: { id: dto.blockedUserId } });
    if (!target) throw ApiError.notFound('User');
    return this.prisma.transaction(async (tx) => {
      const block = await tx.userBlock.upsert({
        where: {
          blockerUserId_blockedUserId: { blockerUserId: userId, blockedUserId: dto.blockedUserId },
        },
        create: {
          blockerUserId: userId,
          blockedUserId: dto.blockedUserId,
          reason: dto.reason?.trim(),
        },
        update: { reason: dto.reason?.trim() },
      });
      const activeMatches = await tx.match.findMany({
        where: {
          status: MatchStatus.ACTIVE,
          OR: [
            { userRoleA: { userId }, userRoleB: { userId: dto.blockedUserId } },
            { userRoleA: { userId: dto.blockedUserId }, userRoleB: { userId } },
          ],
        },
        select: { id: true },
      });
      if (activeMatches.length) {
        const ids = activeMatches.map((match) => match.id);
        await tx.match.updateMany({
          where: { id: { in: ids } },
          data: {
            status: MatchStatus.BLOCKED,
            activePairKey: null,
            endedAt: new Date(),
            endedByUserId: userId,
            endReason: 'USER_BLOCKED',
          },
        });
        await tx.conversation.updateMany({
          where: { matchId: { in: ids } },
          data: { status: ConversationStatus.BLOCKED },
        });
      }
      return block;
    });
  }

  async unblock(userId: string, blockedUserId: string) {
    await this.prisma.userBlock.deleteMany({ where: { blockerUserId: userId, blockedUserId } });
    return { status: 'unblocked' };
  }

  async report(userId: string, dto: CreateReportDto) {
    if (userId === dto.reportedUserId)
      throw new ApiError('SELF_REPORT_FORBIDDEN', 'Cannot report own account');
    await this.assertReportContext(userId, dto);
    for (const assetId of dto.evidenceAssetIds ?? []) {
      await this.uploads.assertUsableOwnedAsset(userId, assetId, [UploadPurpose.REPORT_EVIDENCE]);
    }
    return this.prisma.transaction(async (tx) => {
      const report = await tx.userReport.create({
        data: {
          reporterUserId: userId,
          reportedUserId: dto.reportedUserId,
          reasonCode: dto.reasonCode,
          description: dto.description.trim(),
          matchId: dto.matchId,
          conversationId: dto.conversationId,
          messageId: dto.messageId,
          bookingId: dto.bookingId,
          evidence: dto.evidenceAssetIds?.length
            ? { create: dto.evidenceAssetIds.map((assetId) => ({ assetId })) }
            : undefined,
        },
        select: {
          id: true,
          reportedUserId: true,
          reasonCode: true,
          description: true,
          status: true,
          createdAt: true,
          evidence: { select: { assetId: true } },
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'report',
          aggregateId: report.id,
          eventType: 'report.created',
          payload: { reportId: report.id, reportedUserId: dto.reportedUserId },
        },
      });
      return report;
    });
  }

  restrictions(userId: string) {
    return this.prisma.accountPenalty.findMany({
      where: {
        userId,
        status: PenaltyStatus.ACTIVE,
        startsAt: { lte: new Date() },
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        penaltyType: true,
        featureCode: true,
        reason: true,
        startsAt: true,
        endsAt: true,
      },
      orderBy: { startsAt: 'desc' },
    });
  }

  async createPenalty(adminUserId: string, dto: CreatePenaltyDto, tx?: TransactionClient) {
    this.validatePenalty(dto.penaltyType, dto.featureCode, dto.startsAt, dto.endsAt);
    const client = tx ?? this.prisma;
    const penalty = await client.accountPenalty.create({
      data: {
        userId: dto.userId,
        reportId: dto.reportId,
        imposedByUserId: adminUserId,
        penaltyType: dto.penaltyType,
        featureCode: dto.featureCode,
        reason: dto.reason.trim(),
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      },
    });
    if (dto.penaltyType === PenaltyType.PERMANENT_BAN) {
      await client.user.update({
        where: { id: dto.userId },
        data: { accountStatus: AccountStatus.BANNED },
      });
      await client.authSession.updateMany({
        where: { userId: dto.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else if (dto.penaltyType === PenaltyType.TEMPORARY_SUSPENSION) {
      await client.user.update({
        where: { id: dto.userId },
        data: { accountStatus: AccountStatus.SUSPENDED },
      });
      await client.authSession.updateMany({
        where: { userId: dto.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await client.notification.create({
      data: {
        recipientUserId: dto.userId,
        penaltyId: penalty.id,
        notificationType: NotificationType.ACCOUNT_PENALTY_CREATED,
        payload: { penaltyId: penalty.id, penaltyType: penalty.penaltyType },
      },
    });
    return penalty;
  }

  async revokePenalty(adminUserId: string, penaltyId: string, reason: string) {
    return this.prisma.transaction(async (tx) => {
      const penalty = await tx.accountPenalty.findUnique({ where: { id: penaltyId } });
      if (!penalty) throw ApiError.notFound('Penalty');
      if (penalty.status === PenaltyStatus.REVOKED) return penalty;
      const updated = await tx.accountPenalty.update({
        where: { id: penaltyId },
        data: {
          status: PenaltyStatus.REVOKED,
          revokedByUserId: adminUserId,
          revokeReason: reason.trim(),
          revokedAt: new Date(),
        },
      });
      const remaining = await tx.accountPenalty.count({
        where: {
          userId: penalty.userId,
          status: PenaltyStatus.ACTIVE,
          id: { not: penalty.id },
          penaltyType: { in: [PenaltyType.TEMPORARY_SUSPENSION, PenaltyType.PERMANENT_BAN] },
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
      });
      if (!remaining) {
        await tx.user.update({
          where: { id: penalty.userId },
          data: { accountStatus: AccountStatus.ACTIVE },
        });
      }
      return updated;
    });
  }

  async resolveReport(adminUserId: string, reportId: string, dto: ResolveReportDto) {
    if (dto.status !== ReportStatus.RESOLVED && dto.status !== ReportStatus.REJECTED) {
      throw new ApiError('INVALID_REPORT_STATUS', 'Report can only be resolved or rejected');
    }
    return this.prisma.transaction(async (tx) => {
      const report = await tx.userReport.findUnique({ where: { id: reportId } });
      if (!report) throw ApiError.notFound('Report');
      const resolved = await tx.userReport.update({
        where: { id: reportId },
        data: {
          status: dto.status,
          resolution: dto.resolution.trim(),
          adminNote: dto.adminNote?.trim(),
          resolvedByUserId: adminUserId,
          resolvedAt: new Date(),
        },
      });
      let penalty = null;
      if (dto.penaltyType) {
        penalty = await this.createPenalty(
          adminUserId,
          {
            userId: report.reportedUserId,
            reportId,
            penaltyType: dto.penaltyType,
            featureCode: dto.featureCode,
            reason: dto.resolution,
            endsAt: dto.penaltyEndsAt,
          },
          tx,
        );
      }
      return { report: resolved, penalty };
    });
  }

  private async assertReportContext(userId: string, dto: CreateReportDto) {
    const target = await this.prisma.user.findUnique({ where: { id: dto.reportedUserId } });
    if (!target) throw ApiError.notFound('Reported user');
    if (dto.matchId) {
      const match = await this.prisma.match.findFirst({
        where: { id: dto.matchId, OR: [{ userRoleA: { userId } }, { userRoleB: { userId } }] },
      });
      if (!match)
        throw ApiError.forbidden('REPORT_CONTEXT_DENIED', 'Match context is not accessible');
    }
    if (dto.conversationId) {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: dto.conversationId, participants: { some: { userId } } },
      });
      if (!conversation)
        throw ApiError.forbidden('REPORT_CONTEXT_DENIED', 'Conversation context is not accessible');
    }
    if (dto.messageId) {
      const message = await this.prisma.message.findFirst({
        where: { id: dto.messageId, conversation: { participants: { some: { userId } } } },
      });
      if (!message)
        throw ApiError.forbidden('REPORT_CONTEXT_DENIED', 'Message context is not accessible');
    }
    if (dto.bookingId) {
      const booking = await this.prisma.booking.findFirst({
        where: {
          id: dto.bookingId,
          OR: [{ customerRole: { userId } }, { photographerRole: { userId } }],
        },
      });
      if (!booking)
        throw ApiError.forbidden('REPORT_CONTEXT_DENIED', 'Booking context is not accessible');
    }
  }

  private validatePenalty(
    type: PenaltyType,
    featureCode?: string,
    startsAt?: string,
    endsAt?: string,
  ): void {
    if (type === PenaltyType.FEATURE_RESTRICTION && !featureCode?.trim()) {
      throw new ApiError('FEATURE_CODE_REQUIRED', 'Feature restriction requires feature code');
    }
    if (type !== PenaltyType.FEATURE_RESTRICTION && featureCode) {
      throw new ApiError(
        'FEATURE_CODE_FORBIDDEN',
        'Feature code is only valid for feature restriction',
      );
    }
    if (type === PenaltyType.TEMPORARY_SUSPENSION && !endsAt) {
      throw new ApiError('PENALTY_END_REQUIRED', 'Temporary suspension requires an end time');
    }
    if (endsAt && new Date(endsAt) <= new Date(startsAt ?? Date.now())) {
      throw new ApiError('INVALID_PENALTY_WINDOW', 'Penalty end must be later than start');
    }
  }
}
