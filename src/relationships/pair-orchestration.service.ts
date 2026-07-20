import { Injectable } from '@nestjs/common';
import { ConversationStatus, MatchStatus, RoleStatus } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { PrismaService, TransactionClient } from '../database/prisma.service';

export interface PairResult {
  matchId: string;
  conversationId: string;
  created: boolean;
}

@Injectable()
export class PairOrchestrationService {
  constructor(private readonly prisma: PrismaService) {}

  async ensurePair(roleAId: string, roleBId: string): Promise<PairResult> {
    return this.prisma.transaction((tx) => this.ensurePairInTransaction(tx, roleAId, roleBId));
  }

  async ensurePairInTransaction(
    tx: TransactionClient,
    firstRoleId: string,
    secondRoleId: string,
  ): Promise<PairResult> {
    if (firstRoleId === secondRoleId)
      throw new ApiError('SELF_MATCH_FORBIDDEN', 'A role cannot match itself');
    const roles = await tx.userRole.findMany({
      where: { id: { in: [firstRoleId, secondRoleId] }, status: RoleStatus.ACTIVE },
      select: { id: true, userId: true },
    });
    if (roles.length !== 2) throw ApiError.notFound('Match participant');
    if (roles[0].userId === roles[1].userId)
      throw new ApiError('SELF_MATCH_FORBIDDEN', 'A user cannot match themself');
    const blocked = await tx.userBlock.count({
      where: {
        OR: [
          { blockerUserId: roles[0].userId, blockedUserId: roles[1].userId },
          { blockerUserId: roles[1].userId, blockedUserId: roles[0].userId },
        ],
      },
    });
    if (blocked) throw ApiError.forbidden('RELATIONSHIP_BLOCKED', 'The relationship is blocked');

    const [userRoleAId, userRoleBId] = [firstRoleId, secondRoleId].sort();
    const pairKey = `${userRoleAId}:${userRoleBId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`;
    const existing = await tx.match.findUnique({
      where: { activePairKey: pairKey },
      include: { conversation: true },
    });
    if (existing?.conversation) {
      return { matchId: existing.id, conversationId: existing.conversation.id, created: false };
    }
    const previous = await tx.match.findFirst({
      where: { pairKey, status: { in: [MatchStatus.ENDED, MatchStatus.BLOCKED] } },
      orderBy: { endedAt: 'desc' },
    });
    if (previous?.endedAt && previous.endedAt > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)) {
      throw ApiError.conflict('REMATCH_COOLDOWN', 'This pair is in the 30-day rematch cooldown');
    }
    const match = await tx.match.create({
      data: {
        userRoleAId,
        userRoleBId,
        pairKey,
        activePairKey: pairKey,
        conversation: {
          create: {
            status: ConversationStatus.ACTIVE,
            participants: { create: roles.map((role) => ({ userId: role.userId })) },
          },
        },
      },
      include: { conversation: true },
    });
    if (!match.conversation) throw new Error('Conversation creation failed');
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'match',
        aggregateId: match.id,
        eventType: 'match.created',
        payload: {
          matchId: match.id,
          conversationId: match.conversation.id,
          userIds: roles.map((role) => role.userId),
        },
      },
    });
    return { matchId: match.id, conversationId: match.conversation.id, created: true };
  }
}
