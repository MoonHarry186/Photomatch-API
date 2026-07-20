import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { MessagingGateway } from '../messaging/messaging.gateway';
import { EVENT_CHANNEL } from './queue.config';

interface PublishedEvent {
  eventType: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class EventSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    config: ConfigService,
    private readonly gateway: MessagingGateway,
  ) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), { lazyConnect: true });
  }

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
    await this.redis.subscribe(EVENT_CHANNEL);
    this.redis.on('message', (_channel, message) => this.publish(message));
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private publish(message: string): void {
    let event: PublishedEvent;
    try {
      event = JSON.parse(message) as PublishedEvent;
    } catch {
      return;
    }
    const conversationId = event.payload.conversationId;
    if (typeof conversationId === 'string') {
      this.gateway.publishToConversation(conversationId, event.eventType, event.payload);
    }
    const recipients = new Set<string>();
    if (typeof event.payload.recipientUserId === 'string')
      recipients.add(event.payload.recipientUserId);
    if (Array.isArray(event.payload.userIds)) {
      for (const userId of event.payload.userIds)
        if (typeof userId === 'string') recipients.add(userId);
    }
    if (recipients.size)
      this.gateway.publishToUsers([...recipients], event.eventType, event.payload);
  }
}
