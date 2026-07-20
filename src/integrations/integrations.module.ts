import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeEmailAdapter, SmtpEmailAdapter } from './email.adapters';
import { EmailPort, OAuthVerifierPort, PushPort } from './integration.ports';
import { FakeOAuthVerifier, ProductionOAuthVerifier } from './oauth.adapters';
import { FakePushAdapter, ProductionPushAdapter } from './push.adapters';
import { ObjectStoragePort } from './object-storage.port';
import { R2Adapter } from './r2.adapter';

@Global()
@Module({
  providers: [
    FakeEmailAdapter,
    SmtpEmailAdapter,
    FakeOAuthVerifier,
    ProductionOAuthVerifier,
    FakePushAdapter,
    ProductionPushAdapter,
    R2Adapter,
    { provide: ObjectStoragePort, useExisting: R2Adapter },
    {
      provide: EmailPort,
      inject: [ConfigService, FakeEmailAdapter, SmtpEmailAdapter],
      useFactory: (config: ConfigService, fake: FakeEmailAdapter, smtp: SmtpEmailAdapter) =>
        config.get('EMAIL_ADAPTER') === 'smtp' ? smtp : fake,
    },
    {
      provide: OAuthVerifierPort,
      inject: [ConfigService, FakeOAuthVerifier, ProductionOAuthVerifier],
      useFactory: (
        config: ConfigService,
        fake: FakeOAuthVerifier,
        production: ProductionOAuthVerifier,
      ) => (config.get('OAUTH_ADAPTER') === 'production' ? production : fake),
    },
    {
      provide: PushPort,
      inject: [ConfigService, FakePushAdapter, ProductionPushAdapter],
      useFactory: (
        config: ConfigService,
        fake: FakePushAdapter,
        production: ProductionPushAdapter,
      ) => (config.get('PUSH_ADAPTER') === 'production' ? production : fake),
    },
  ],
  exports: [EmailPort, OAuthVerifierPort, PushPort, ObjectStoragePort, FakeEmailAdapter],
})
export class IntegrationsModule {}
