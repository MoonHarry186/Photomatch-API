import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { LocationRepository } from './location.repository';

@Module({
  imports: [ProfilesModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, LocationRepository],
  exports: [DiscoveryService, LocationRepository],
})
export class DiscoveryModule {}
