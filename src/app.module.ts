import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { CommonModule } from './common/common.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuthModule } from './auth/auth.module';
import { UploadsModule } from './uploads/uploads.module';
import { ProfilesModule } from './profiles/profiles.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { RelationshipsModule } from './relationships/relationships.module';
import { MessagingModule } from './messaging/messaging.module';
import { BookingsModule } from './bookings/bookings.module';
import { TrustModule } from './trust/trust.module';
import { JobsModule } from './jobs/jobs.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CommonModule,
    IntegrationsModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    HealthModule,
    AuthModule,
    UploadsModule,
    ProfilesModule,
    DiscoveryModule,
    RelationshipsModule,
    MessagingModule,
    BookingsModule,
    TrustModule,
    JobsModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*splat}');
  }
}
