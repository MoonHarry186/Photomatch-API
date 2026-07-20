import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Idempotent } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { CompleteUploadDto, PresignUploadDto } from './uploads.dto';
import { UploadsService } from './uploads.service';

@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presign')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  presign(@CurrentUser() user: AuthenticatedUser, @Body() dto: PresignUploadDto) {
    return this.uploads.presign(user.userId, dto);
  }

  @Post(':uploadId/complete')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.uploads.complete(user.userId, uploadId, dto);
  }

  @Get(':assetId/access-url')
  accessUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assetId', ParseUUIDPipe) assetId: string,
  ) {
    return this.uploads.accessUrl(user.userId, assetId);
  }
}
