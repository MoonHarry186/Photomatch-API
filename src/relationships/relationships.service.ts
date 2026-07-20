import { Injectable } from '@nestjs/common';
import {
  ConversationStatus,
  MatchStatus,
  RoleCode,
  RoleStatus,
  SwipeDirection,
} from '@prisma/client';
import { ApiError } from '../common/api-error';
import { CursorPageDto, decodeCursor, encodeCursor } from '../common/pagination';
import { FeatureAccessService } from '../common/feature-access.service';
import { PrismaService } from '../database/prisma.service';
import { EligibilityService } from '../profiles/eligibility.service';
import { PairOrchestrationService } from './pair-orchestration.service';
import { InterestDecisionDto, SwipeDto } from './relationships.dto';

@Injectable()
export class RelationshipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pairs: PairOrchestrationService,
    private readonly eligibility: EligibilityService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  async swipe(userId: string, currentRoleId: string | undefined, dto: SwipeDto) {
    await this.featureAccess.assertAllowed(userId, 'SWIPE');
    const actor = await this.currentRole(userId, currentRoleId);
    if (actor.id === dto.targetUserRoleId)
      throw new ApiError('SELF_SWIPE_FORBIDDEN', 'Cannot swipe own role');
    if (dto.direction === SwipeDirection.RIGHT && actor.role.code === RoleCode.PHOTOGRAPHER) {
      throw ApiError.forbidden(
        'FEATURE_NOT_AVAILABLE',
        'Photographer-initiated interest is outside MVP scope',
      );
    }
    if (dto.direction !== SwipeDirection.LEFT && dto.direction !== SwipeDirection.RIGHT) {
      throw new ApiError('INVALID_SWIPE_DECISION', 'Swipe only accepts LEFT or RIGHT');
    }
    const target = await this.prisma.userRole.findFirst({
      where: { id: dto.targetUserRoleId, status: RoleStatus.ACTIVE },
      include: { role: true },
    });
    if (!target) throw ApiError.notFound('Candidate');
    const eligible = await this.eligibility.discovery(target.id);
    if (!eligible.eligible)
      throw ApiError.forbidden('CANDIDATE_INELIGIBLE', 'Candidate is not eligible');
    await this.assertNotBlocked(userId, target.userId);
    const unresolved = await this.prisma.swipe.findFirst({
      where: {
        actorUserRoleId: actor.id,
        targetUserRoleId: target.id,
        direction: dto.direction,
        resolvedAt: null,
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (unresolved) return unresolved;
    return this.prisma.swipe.create({
      data: {
        actorUserRoleId: actor.id,
        targetUserRoleId: target.id,
        discoveryFilterId: dto.discoveryFilterId,
        direction: dto.direction,
        source: dto.source,
        effectiveUntil:
          dto.direction === SwipeDirection.LEFT
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            : undefined,
      },
    });
  }

  async incoming(userId: string, currentRoleId: string | undefined, query: CursorPageDto) {
    const role = await this.currentRole(userId, currentRoleId);
    if (role.role.code !== RoleCode.PHOTOGRAPHER) {
      throw ApiError.forbidden('PHOTOGRAPHER_ROLE_REQUIRED', 'Photographer role is required');
    }
    const cursor = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
    const items = await this.prisma.swipe.findMany({
      where: {
        targetUserRoleId: role.id,
        direction: SwipeDirection.RIGHT,
        resolvedAt: null,
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
        actorRole: {
          select: {
            id: true,
            user: {
              select: {
                identityVerificationStatus: true,
                profile: { select: { displayName: true, avatarAssetId: true, city: true } },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        source: item.source,
        customer: {
          userRoleId: item.actorRole.id,
          displayName: item.actorRole.user.profile?.displayName,
          avatarAssetId: item.actorRole.user.profile?.avatarAssetId,
          city: item.actorRole.user.profile?.city,
          identityVerificationStatus: item.actorRole.user.identityVerificationStatus,
        },
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async decide(
    userId: string,
    currentRoleId: string | undefined,
    interestId: string,
    dto: InterestDecisionDto,
  ) {
    const role = await this.currentRole(userId, currentRoleId);
    if (role.role.code !== RoleCode.PHOTOGRAPHER) {
      throw ApiError.forbidden('PHOTOGRAPHER_ROLE_REQUIRED', 'Photographer role is required');
    }
    if (dto.decision !== SwipeDirection.ACCEPT && dto.decision !== SwipeDirection.REJECT) {
      throw new ApiError('INVALID_INTEREST_DECISION', 'Decision must be ACCEPT or REJECT');
    }
    return this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interest:${interestId}`}, 0))`;
      const interest = await tx.swipe.findFirst({
        where: {
          id: interestId,
          targetUserRoleId: role.id,
          direction: SwipeDirection.RIGHT,
        },
      });
      if (!interest) throw ApiError.notFound('Interest');
      const existingDecision = await tx.swipe.findFirst({
        where: {
          actorUserRoleId: role.id,
          targetUserRoleId: interest.actorUserRoleId,
          direction: { in: [SwipeDirection.ACCEPT, SwipeDirection.REJECT] },
          createdAt: { gte: interest.createdAt },
        },
      });
      if (existingDecision) {
        const match =
          existingDecision.direction === SwipeDirection.ACCEPT
            ? await tx.match.findUnique({
                where: { activePairKey: this.pairKey(role.id, interest.actorUserRoleId) },
                include: { conversation: true },
              })
            : null;
        return {
          decision: existingDecision.direction,
          matchId: match?.id ?? null,
          conversationId: match?.conversation?.id ?? null,
          created: false,
        };
      }
      if (interest.resolvedAt)
        throw ApiError.conflict('INTEREST_ALREADY_RESOLVED', 'Interest is already resolved');
      await tx.swipe.update({ where: { id: interest.id }, data: { resolvedAt: new Date() } });
      const decision = await tx.swipe.create({
        data: {
          actorUserRoleId: role.id,
          targetUserRoleId: interest.actorUserRoleId,
          direction: dto.decision,
          source: interest.source,
          effectiveUntil:
            dto.decision === SwipeDirection.REJECT
              ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
              : undefined,
          resolvedAt: new Date(),
        },
      });
      if (dto.decision === SwipeDirection.REJECT)
        return { decision: decision.direction, matchId: null };
      const pair = await this.pairs.ensurePairInTransaction(tx, role.id, interest.actorUserRoleId);
      return { decision: decision.direction, ...pair };
    });
  }

  async matches(userId: string, currentRoleId: string | undefined, query: CursorPageDto) {
    const role = await this.currentRole(userId, currentRoleId);
    const cursor = decodeCursor<{ matchedAt: string; id: string }>(query.cursor);
    const items = await this.prisma.match.findMany({
      where: {
        OR: [{ userRoleAId: role.id }, { userRoleBId: role.id }],
        ...(cursor
          ? {
              AND: [
                {
                  OR: [
                    { matchedAt: { lt: new Date(cursor.matchedAt) } },
                    { matchedAt: new Date(cursor.matchedAt), id: { lt: cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: {
        userRoleA: { include: { role: true, user: { include: { profile: true } } } },
        userRoleB: { include: { role: true, user: { include: { profile: true } } } },
        conversation: { select: { id: true, status: true, lastMessageAt: true } },
      },
      orderBy: [{ matchedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((match) => this.serializeMatch(match, role.id)),
      nextCursor:
        hasMore && last
          ? encodeCursor({ matchedAt: last.matchedAt.toISOString(), id: last.id })
          : null,
    };
  }

  async matchDetail(userId: string, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        OR: [{ userRoleA: { userId } }, { userRoleB: { userId } }],
      },
      include: {
        userRoleA: { include: { role: true, user: { include: { profile: true } } } },
        userRoleB: { include: { role: true, user: { include: { profile: true } } } },
        conversation: { select: { id: true, status: true, lastMessageAt: true } },
      },
    });
    if (!match) throw ApiError.notFound('Match');
    const actorRole = match.userRoleA.userId === userId ? match.userRoleAId : match.userRoleBId;
    return this.serializeMatch(match, actorRole);
  }

  async unmatch(userId: string, matchId: string, reason: string) {
    return this.prisma.transaction(async (tx) => {
      const match = await tx.match.findFirst({
        where: { id: matchId, OR: [{ userRoleA: { userId } }, { userRoleB: { userId } }] },
      });
      if (!match) throw ApiError.notFound('Match');
      if (match.status !== MatchStatus.ACTIVE)
        return { id: match.id, status: match.status, endedAt: match.endedAt };
      const endedAt = new Date();
      await tx.match.update({
        where: { id: match.id },
        data: {
          status: MatchStatus.ENDED,
          activePairKey: null,
          endedAt,
          endedByUserId: userId,
          endReason: reason,
        },
      });
      await tx.conversation.updateMany({
        where: { matchId: match.id },
        data: { status: ConversationStatus.CLOSED },
      });
      return { id: match.id, status: MatchStatus.ENDED, endedAt };
    });
  }

  private currentRole(userId: string, currentRoleId?: string) {
    if (!currentRoleId) throw new ApiError('CURRENT_ROLE_REQUIRED', 'Select a current role first');
    return this.prisma.userRole.findFirstOrThrow({
      where: { id: currentRoleId, userId, status: RoleStatus.ACTIVE },
      include: { role: true },
    });
  }

  private async assertNotBlocked(firstUserId: string, secondUserId: string) {
    const block = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerUserId: firstUserId, blockedUserId: secondUserId },
          { blockerUserId: secondUserId, blockedUserId: firstUserId },
        ],
      },
    });
    if (block) throw ApiError.forbidden('RELATIONSHIP_BLOCKED', 'The relationship is blocked');
  }

  private pairKey(first: string, second: string) {
    return [first, second].sort().join(':');
  }

  private serializeMatch(match: any, actorRoleId: string) {
    const counterpart = match.userRoleAId === actorRoleId ? match.userRoleB : match.userRoleA;
    return {
      id: match.id,
      status: match.status,
      matchedAt: match.matchedAt,
      endedAt: match.endedAt,
      conversation: match.conversation,
      counterpart: {
        userRoleId: counterpart.id,
        role: counterpart.role.code,
        displayName: counterpart.user.profile?.displayName,
        avatarAssetId: counterpart.user.profile?.avatarAssetId,
      },
    };
  }
}
