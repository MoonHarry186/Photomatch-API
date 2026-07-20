import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingModule } from '../messaging/messaging.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { EventSubscriberService } from './event-subscriber.service';
import { OutboxRelayService } from './outbox-relay.service';
import { PHOTOMATCH_QUEUE, redisOptions } from './queue.config';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ connection: redisOptions(config) }),
    }),
    BullModule.registerQueue({ name: PHOTOMATCH_QUEUE }),
    MessagingModule,
  ],
  controllers: [DevicesController],
  providers: [DevicesService, EventSubscriberService, OutboxRelayService],
  exports: [DevicesService, OutboxRelayService],
})
export class JobsModule {}
