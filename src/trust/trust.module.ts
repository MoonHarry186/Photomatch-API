import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { TrustController } from './trust.controller';
import { TrustService } from './trust.service';

@Module({
  imports: [UploadsModule],
  controllers: [TrustController],
  providers: [TrustService],
  exports: [TrustService],
})
export class TrustModule {}
