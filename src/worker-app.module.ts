import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { OutboxProcessor } from './jobs/outbox.processor';
import { PHOTOMATCH_QUEUE, redisOptions } from './jobs/queue.config';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    IntegrationsModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ connection: redisOptions(config) }),
    }),
    BullModule.registerQueue({ name: PHOTOMATCH_QUEUE }),
  ],
  providers: [OutboxProcessor],
})
export class WorkerAppModule {}
