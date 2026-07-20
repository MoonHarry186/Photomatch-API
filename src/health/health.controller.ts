import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Public } from '../common/auth-context';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import { WORKER_HEARTBEAT_KEY } from '../jobs/queue.config';

@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('live')
  live(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; dependencies: Record<string, 'up'> }> {
    const redis = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      connectTimeout: 1000,
    });
    try {
      const [, , heartbeat] = await Promise.all([
        this.prisma.$queryRaw`SELECT 1`,
        redis.connect().then(() => redis.ping()),
        redis.get(WORKER_HEARTBEAT_KEY),
      ]);
      if (!heartbeat || Date.now() - new Date(heartbeat).getTime() > 90_000)
        throw new Error('worker');
      return { status: 'ok', dependencies: { database: 'up', redis: 'up', worker: 'up' } };
    } catch {
      throw new ApiError(
        'DEPENDENCY_UNAVAILABLE',
        'One or more required dependencies are unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      redis.disconnect();
    }
  }
}
