import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { OutboxStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { WORKER_HEARTBEAT_KEY } from '../jobs/queue.config';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();
  private readonly requests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });
  private readonly latency = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  private readonly outboxFailures = new Gauge({
    name: 'photomatch_outbox_failed_total',
    help: 'Current terminal outbox failure count',
    registers: [this.registry],
  });
  private readonly workerHeartbeat = new Gauge({
    name: 'photomatch_worker_heartbeat_timestamp_seconds',
    help: 'Last worker heartbeat as Unix timestamp',
    registers: [this.registry],
  });
  private readonly redis: Redis;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    collectDefaultMetrics({ register: this.registry, prefix: 'photomatch_' });
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), { lazyConnect: true });
  }

  observe(method: string, route: string, status: number, durationMs: number): void {
    const labels = { method, route, status: String(status) };
    this.requests.inc(labels);
    this.latency.observe(labels, durationMs / 1000);
  }

  async render(): Promise<string> {
    if (this.redis.status === 'wait') await this.redis.connect();
    const [failed, heartbeat] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: OutboxStatus.FAILED } }),
      this.redis.get(WORKER_HEARTBEAT_KEY),
    ]);
    this.outboxFailures.set(failed);
    this.workerHeartbeat.set(heartbeat ? new Date(heartbeat).getTime() / 1000 : 0);
    return this.registry.metrics();
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
