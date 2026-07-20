import { Injectable } from '@nestjs/common';
import {
  ConversationStatus,
  MatchStatus,
  MessageType,
  Prisma,
  UploadPurpose,
} from '@prisma/client';
import { ApiError } from '../common/api-error';
import { FeatureAccessService } from '../common/feature-access.service';
import { CursorPageDto, decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService, TransactionClient } from '../database/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { ReceiptDto, SendMessageDto } from './messaging.dto';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  async conversations(userId: string, query: CursorPageDto) {
    const cursor = decodeCursor<{ lastActivity: string; id: string }>(query.cursor);
    const items = await this.prisma.conversation.findMany({
      where: {
        participants: { some: { userId, leftAt: null } },
        ...(cursor
          ? {
              OR: [
                { lastMessageAt: { lt: new Date(cursor.lastActivity) } },
                { lastMessageAt: new Date(cursor.lastActivity), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        match: {
          include: {
            userRoleA: { include: { user: { include: { profile: true } }, role: true } },
            userRoleB: { include: { user: { include: { profile: true } }, role: true } },
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, messageType: true, content: true, sentAt: true, senderUserId: true },
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((conversation) => {
        const counterpart =
          conversation.match.userRoleA.userId === userId
            ? conversation.match.userRoleB
            : conversation.match.userRoleA;
        return {
          id: conversation.id,
          status: conversation.status,
          lastMessageAt: conversation.lastMessageAt,
          lastMessage: conversation.messages[0] ?? null,
          counterpart: {
            userRoleId: counterpart.id,
            role: counterpart.role.code,
            displayName: counterpart.user.profile?.displayName,
            avatarAssetId: counterpart.user.profile?.avatarAssetId,
          },
        };
      }),
      nextCursor:
        hasMore && last && last.lastMessageAt
          ? encodeCursor({ lastActivity: last.lastMessageAt.toISOString(), id: last.id })
          : null,
    };
  }

  async conversation(userId: string, conversationId: string) {
    await this.assertParticipant(this.prisma, userId, conversationId, false);
    return this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: {
        id: true,
        matchId: true,
        status: true,
        lastMessageAt: true,
        createdAt: true,
        participants: {
          select: {
            userId: true,
            joinedAt: true,
            leftAt: true,
            user: { select: { profile: { select: { displayName: true, avatarAssetId: true } } } },
          },
        },
      },
    });
  }

  async messages(userId: string, conversationId: string, query: CursorPageDto) {
    await this.assertParticipant(this.prisma, userId, conversationId, false);
    const cursor = decodeCursor<{ sentAt: string; id: string }>(query.cursor);
    const items = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(cursor
          ? {
              OR: [
                { sentAt: { lt: new Date(cursor.sentAt) } },
                { sentAt: new Date(cursor.sentAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: this.messageProjection(),
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor:
        hasMore && last ? encodeCursor({ sentAt: last.sentAt.toISOString(), id: last.id }) : null,
    };
  }

  async send(userId: string, conversationId: string, dto: SendMessageDto) {
    await this.featureAccess.assertAllowed(userId, 'CHAT');
    this.validatePayload(dto);
    if (dto.assetId) {
      await this.uploads.assertUsableOwnedAsset(
        userId,
        dto.assetId,
        dto.messageType === MessageType.IMAGE
          ? [UploadPurpose.CHAT_IMAGE]
          : [UploadPurpose.CHAT_FILE],
      );
    }
    return this.prisma.transaction(async (tx) => {
      const conversation = await this.assertParticipant(tx, userId, conversationId, true);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${dto.clientMessageId}`}, 0))`;
      const existing = await tx.message.findUnique({
        where: {
          senderUserId_clientMessageId: {
            senderUserId: userId,
            clientMessageId: dto.clientMessageId,
          },
        },
        select: this.messageProjection(),
      });
      if (existing) return existing;
      if (dto.replyToMessageId) {
        const reply = await tx.message.findFirst({
          where: { id: dto.replyToMessageId, conversationId },
        });
        if (!reply)
          throw new ApiError('INVALID_REPLY_TARGET', 'Reply target is not in this conversation');
      }
      const message = await tx.message.create({
        data: {
          conversationId,
          senderUserId: userId,
          clientMessageId: dto.clientMessageId,
          messageType: dto.messageType,
          content: dto.content?.trim() || null,
          assetId: dto.assetId,
          replyToMessageId: dto.replyToMessageId,
          receipts: {
            create: conversation.participants
              .filter((participant) => participant.userId !== userId)
              .map((participant) => ({ userId: participant.userId })),
          },
        },
        select: this.messageProjection(),
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: message.sentAt },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'conversation',
          aggregateId: conversationId,
          eventType: 'conversation.message.created',
          payload: { conversationId, messageId: message.id, senderUserId: userId },
        },
      });
      return message;
    });
  }

  async receipt(userId: string, conversationId: string, messageId: string, dto: ReceiptDto) {
    await this.assertParticipant(this.prisma, userId, conversationId, false);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId },
    });
    if (!message) throw ApiError.notFound('Message');
    if (message.senderUserId === userId)
      throw new ApiError('SELF_RECEIPT_FORBIDDEN', 'Sender cannot receipt own message');
    if (dto.type === 'read') {
      const settings = await this.prisma.userSettings.findUniqueOrThrow({ where: { userId } });
      if (!settings.readReceiptsEnabled) return { messageId, readReceiptShared: false };
    }
    const now = new Date();
    const receipt = await this.prisma.messageReceipt.upsert({
      where: { messageId_userId: { messageId, userId } },
      create: {
        messageId,
        userId,
        deliveredAt: now,
        readAt: dto.type === 'read' ? now : undefined,
      },
      update: dto.type === 'read' ? { deliveredAt: now, readAt: now } : { deliveredAt: now },
    });
    await this.prisma.outboxEvent.create({
      data: {
        aggregateType: 'message',
        aggregateId: messageId,
        eventType: dto.type === 'read' ? 'message.read' : 'message.delivered',
        payload: { conversationId, messageId, userId, at: now.toISOString() },
      },
    });
    return receipt;
  }

  async canJoin(userId: string, conversationId: string): Promise<boolean> {
    try {
      await this.assertParticipant(this.prisma, userId, conversationId, false);
      return true;
    } catch {
      return false;
    }
  }

  private validatePayload(dto: SendMessageDto): void {
    if (dto.messageType === MessageType.SYSTEM) {
      throw ApiError.forbidden(
        'SYSTEM_MESSAGE_FORBIDDEN',
        'System messages cannot be created by clients',
      );
    }
    if (dto.messageType === MessageType.TEXT && (!dto.content?.trim() || dto.assetId)) {
      throw new ApiError(
        'INVALID_MESSAGE_PAYLOAD',
        'Text messages require content and cannot have an asset',
      );
    }
    if (
      (dto.messageType === MessageType.IMAGE || dto.messageType === MessageType.FILE) &&
      !dto.assetId
    ) {
      throw new ApiError(
        'INVALID_MESSAGE_PAYLOAD',
        'Image and file messages require one verified asset',
      );
    }
  }

  private async assertParticipant(
    client: PrismaService | TransactionClient,
    userId: string,
    conversationId: string,
    requireActive: boolean,
  ) {
    const conversation = await client.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { some: { userId, leftAt: null } },
        ...(requireActive
          ? { status: ConversationStatus.ACTIVE, match: { status: MatchStatus.ACTIVE } }
          : {}),
      },
      include: {
        participants: { where: { leftAt: null }, select: { userId: true } },
        match: {
          select: {
            status: true,
            userRoleA: { select: { userId: true } },
            userRoleB: { select: { userId: true } },
          },
        },
      },
    });
    if (!conversation)
      throw ApiError.forbidden('CONVERSATION_ACCESS_DENIED', 'Conversation access denied');
    if (requireActive) {
      const counterpartId =
        conversation.match.userRoleA.userId === userId
          ? conversation.match.userRoleB.userId
          : conversation.match.userRoleA.userId;
      const blocked = await client.userBlock.count({
        where: {
          OR: [
            { blockerUserId: userId, blockedUserId: counterpartId },
            { blockerUserId: counterpartId, blockedUserId: userId },
          ],
        },
      });
      if (blocked) throw ApiError.forbidden('CONVERSATION_BLOCKED', 'Conversation is blocked');
    }
    return conversation;
  }

  private messageProjection(): Prisma.MessageSelect {
    return {
      id: true,
      conversationId: true,
      senderUserId: true,
      replyToMessageId: true,
      clientMessageId: true,
      messageType: true,
      content: true,
      assetId: true,
      status: true,
      sentAt: true,
      receipts: { select: { userId: true, deliveredAt: true, readAt: true } },
    };
  }
}
