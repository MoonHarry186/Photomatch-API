import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { RelationshipsModule } from '../relationships/relationships.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [RelationshipsModule, ProfilesModule],
  controllers: [BookingsController],
  providers: [BookingsService, ReviewsService],
  exports: [BookingsService, ReviewsService],
})
export class BookingsModule {}
