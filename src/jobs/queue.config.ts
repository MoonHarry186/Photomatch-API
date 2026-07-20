import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

export const PHOTOMATCH_QUEUE = 'photomatch';
export const EVENT_CHANNEL = 'photomatch.events';
export const WORKER_HEARTBEAT_KEY = 'photomatch:worker:heartbeat';

export function redisOptions(config: ConfigService): RedisOptions {
  const url = new URL(config.getOrThrow<string>('REDIS_URL'));
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}
