import { OutboxStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxRelayService } from '../../src/jobs/outbox-relay.service';

const EVENT_ID = '99500000-0000-4000-8000-000000000001';
const AGGREGATE_ID = '99500000-0000-4000-8000-000000000002';

describe('outbox relay concurrency (integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { id: EVENT_ID } });
    await prisma.$disconnect();
  });

  it('claims and enqueues one delivery when two relays race', async () => {
    await prisma.outboxEvent.deleteMany({ where: { id: EVENT_ID } });
    await prisma.outboxEvent.create({
      data: {
        id: EVENT_ID,
        aggregateType: 'concurrency-test',
        aggregateId: AGGREGATE_ID,
        eventType: 'concurrency.test',
        payload: { aggregateId: AGGREGATE_ID },
      },
    });
    const add = jest.fn().mockResolvedValue({ id: `outbox-${EVENT_ID}` });
    const relay = new OutboxRelayService(prisma, { add } as unknown as Queue);

    await Promise.all([relay.relay(), relay.relay()]);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'outbox.dispatch',
      { outboxEventId: EVENT_ID },
      expect.objectContaining({ jobId: `outbox-${EVENT_ID}`, attempts: 6 }),
    );
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: EVENT_ID } }),
    ).resolves.toEqual(expect.objectContaining({ status: OutboxStatus.PROCESSING, attempts: 1 }));
  });
});
