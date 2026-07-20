import { Module } from '@nestjs/common';
import { TrustModule } from '../trust/trust.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [TrustModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
