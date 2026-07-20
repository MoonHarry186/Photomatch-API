import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { EligibilityService } from './eligibility.service';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [UploadsModule],
  controllers: [CatalogController, ProfilesController],
  providers: [CatalogService, EligibilityService, ProfilesService],
  exports: [CatalogService, EligibilityService, ProfilesService],
})
export class ProfilesModule {}
