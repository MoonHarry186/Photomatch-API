import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  OutboxStatus,
  PenaltyStatus,
  PenaltyType,
  Prisma,
  UploadAssetStatus,
} from '@prisma/client';
import type { Job } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import { PushPort } from '../integrations/integration.ports';
import { ObjectStoragePort } from '../integrations/object-storage.port';
import { UPLOAD_POLICIES } from '../uploads/upload-policy';
import { EVENT_CHANNEL, PHOTOMATCH_QUEUE, WORKER_HEARTBEAT_KEY } from './queue.config';

@Processor(PHOTOMATCH_QUEUE, { concurrency: 10 })
export class OutboxProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private readonly redis: Redis;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly push: PushPort,
    private readonly storage: ObjectStoragePort,
  ) {
    super();
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'));
  }

  async process(job: Job<{ outboxEventId?: string }>): Promise<unknown> {
    await this.redis.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'EX', 90);
    if (job.name === 'outbox.dispatch' && job.data.outboxEventId) {
      return this.dispatch(job, job.data.outboxEventId);
    }
    if (job.name === 'maintenance.presence-expiration') return this.expirePresence();
    if (job.name === 'maintenance.penalty-expiration') return this.expirePenalties();
    if (job.name === 'maintenance.orphan-media') return this.cleanOrphanMedia();
    return undefined;
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private async dispatch(job: Job, outboxEventId: string): Promise<void> {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: outboxEventId } });
    if (!event || event.status === OutboxStatus.PUBLISHED) return;
    try {
      const payload = asObject(event.payload);
      await this.redis.publish(
        EVENT_CHANNEL,
        JSON.stringify({ eventType: event.eventType, payload }),
      );
      await this.deliverPush(event.id, event.eventType, payload);
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxStatus.PUBLISHED, publishedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const terminal = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: terminal ? OutboxStatus.FAILED : OutboxStatus.PROCESSING,
          lastError: error instanceof Error ? error.message.slice(0, 3000) : 'Delivery failed',
        },
      });
      throw error;
    }
  }

  private async deliverPush(eventId: string, eventType: string, payload: Record<string, unknown>) {
    let recipientUserIds: string[] = [];
    let preference: 'matchNotificationsEnabled' | 'bookingNotificationsEnabled' | null = null;
    let title = 'Photomatch';
    let body = 'You have an update';
    if (eventType === 'match.created') {
      const matchId = payload.matchId;
      if (typeof matchId === 'string') {
        const createdByBooking = await this.prisma.booking.count({ where: { matchId } });
        if (createdByBooking) return;
      }
      recipientUserIds = stringArray(payload.userIds);
      preference = 'matchNotificationsEnabled';
      title = 'New match';
      body = 'You can now start a conversation.';
    } else if (eventType.startsWith('booking.')) {
      if (typeof payload.recipientUserId === 'string') recipientUserIds = [payload.recipientUserId];
      preference = 'bookingNotificationsEnabled';
      title = eventType === 'booking.created' ? 'New booking request' : 'Booking updated';
      body = 'Open Photomatch to view the booking.';
    }
    if (!preference || !recipientUserIds.length) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: recipientUserIds } },
      select: {
        id: true,
        settings: {
          select: { matchNotificationsEnabled: true, bookingNotificationsEnabled: true },
        },
        devices: { where: { isActive: true }, select: { id: true, token: true, provider: true } },
      },
    });
    for (const user of users) {
      if (!user.settings?.[preference]) continue;
      for (const device of user.devices) {
        const deliveryKey = `${eventId}:${device.id}`;
        const delivered = await this.prisma.deliveryDeduplication.findUnique({
          where: { channel_deliveryKey: { channel: 'push', deliveryKey } },
        });
        if (delivered) continue;
        const result = await this.push.send({
          provider: device.provider,
          token: device.token,
          title,
          body,
          data: Object.fromEntries(
            Object.entries(payload)
              .filter((entry): entry is [string, string | number | boolean] =>
                ['string', 'number', 'boolean'].includes(typeof entry[1]),
              )
              .map(([key, value]) => [key, String(value)]),
          ),
        });
        if (result.invalidToken) {
          await this.prisma.deviceRegistration.update({
            where: { id: device.id },
            data: { isActive: false },
          });
          continue;
        }
        await this.prisma.deliveryDeduplication.create({
          data: { channel: 'push', deliveryKey },
        });
      }
    }
  }

  private expirePresence() {
    return this.prisma.discoveryPresence.updateMany({
      where: { isVisible: true, visibleUntil: { lte: new Date() } },
      data: { isVisible: false },
    });
  }

  private async expirePenalties() {
    const expired = await this.prisma.accountPenalty.findMany({
      where: { status: PenaltyStatus.ACTIVE, endsAt: { lte: new Date() } },
      select: { id: true, userId: true },
    });
    if (!expired.length) return { count: 0 };
    await this.prisma.accountPenalty.updateMany({
      where: { id: { in: expired.map((item) => item.id) } },
      data: { status: PenaltyStatus.EXPIRED },
    });
    for (const userId of new Set(expired.map((item) => item.userId))) {
      const remaining = await this.prisma.accountPenalty.count({
        where: {
          userId,
          status: PenaltyStatus.ACTIVE,
          penaltyType: { in: [PenaltyType.TEMPORARY_SUSPENSION, PenaltyType.PERMANENT_BAN] },
          startsAt: { lte: new Date() },
          OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        },
      });
      if (!remaining) {
        await this.prisma.user.updateMany({
          where: { id: userId, accountStatus: AccountStatus.SUSPENDED },
          data: { accountStatus: AccountStatus.ACTIVE },
        });
      }
    }
    return { count: expired.length };
  }

  private async cleanOrphanMedia() {
    const assets = await this.prisma.uploadAsset.findMany({
      where: { status: UploadAssetStatus.USABLE, attachedAt: null },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
    let removed = 0;
    for (const asset of assets) {
      const retention = UPLOAD_POLICIES[asset.purpose].retentionDaysAfterOrphaned;
      if (asset.createdAt > new Date(Date.now() - retention * 24 * 60 * 60 * 1000)) continue;
      try {
        await this.storage.remove(asset.objectKey);
        await this.prisma.uploadAsset.update({
          where: { id: asset.id },
          data: { status: UploadAssetStatus.REMOVED, removedAt: new Date() },
        });
        removed += 1;
      } catch (error) {
        this.logger.warn(`Orphan media cleanup failed for asset ${asset.id}`);
      }
    }
    return { removed };
  }
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
