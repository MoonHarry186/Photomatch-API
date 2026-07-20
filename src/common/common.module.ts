import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccessTokenGuard } from './access-token.guard';
import { FeatureAccessService } from './feature-access.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [MetricsController],
  providers: [
    FeatureAccessService,
    MetricsService,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
  exports: [FeatureAccessService, MetricsService, JwtModule],
})
export class CommonModule {}
