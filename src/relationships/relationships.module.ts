import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { PairOrchestrationService } from './pair-orchestration.service';
import { RelationshipsController } from './relationships.controller';
import { RelationshipsService } from './relationships.service';

@Module({
  imports: [ProfilesModule],
  controllers: [RelationshipsController],
  providers: [PairOrchestrationService, RelationshipsService],
  exports: [PairOrchestrationService, RelationshipsService],
})
export class RelationshipsModule {}
