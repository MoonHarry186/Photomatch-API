import { ApiProperty } from '@nestjs/swagger';
import { UploadPurpose } from '@prisma/client';
import { IsEnum, IsInt, IsString, MaxLength, Min } from 'class-validator';

export class PresignUploadDto {
  @ApiProperty({ enum: UploadPurpose })
  @IsEnum(UploadPurpose)
  purpose!: UploadPurpose;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  mimeType!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  extension!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class CompleteUploadDto {
  @ApiProperty()
  @IsString()
  checksum?: string;
}
