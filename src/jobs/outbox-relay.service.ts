import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OutboxStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { PHOTOMATCH_QUEUE } from './queue.config';

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(PHOTOMATCH_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.relay(), 1000);
    this.timer.unref();
    void this.scheduleMaintenance();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async relay(): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: {
        status: OutboxStatus.PROCESSING,
        updatedAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
      data: { status: OutboxStatus.PENDING, availableAt: new Date() },
    });
    const claimed = await this.prisma.transaction(async (tx) => {
      const ids = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM outbox_events
        WHERE status = 'PENDING'::"OutboxStatus" AND available_at <= NOW()
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      `;
      if (!ids.length) return [];
      await tx.outboxEvent.updateMany({
        where: { id: { in: ids.map((item) => item.id) } },
        data: { status: OutboxStatus.PROCESSING, attempts: { increment: 1 } },
      });
      return tx.outboxEvent.findMany({ where: { id: { in: ids.map((item) => item.id) } } });
    });
    for (const event of claimed) {
      try {
        await this.queue.add(
          'outbox.dispatch',
          { outboxEventId: event.id },
          {
            jobId: `outbox-${event.id}`,
            attempts: 6,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        );
      } catch (error) {
        this.logger.error(`Could not enqueue outbox event ${event.id}`);
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: OutboxStatus.PENDING,
            availableAt: new Date(Date.now() + 5000),
            lastError: error instanceof Error ? error.message.slice(0, 3000) : 'Queue error',
          },
        });
      }
    }
  }

  private async scheduleMaintenance(): Promise<void> {
    const jobs = [
      ['maintenance.presence-expiration', 60_000],
      ['maintenance.penalty-expiration', 60_000],
      ['maintenance.orphan-media', 60 * 60_000],
    ] as const;
    for (const [name, every] of jobs) {
      await this.queue.add(name, {}, { jobId: name.replaceAll('.', '-'), repeat: { every } });
    }
  }
}
