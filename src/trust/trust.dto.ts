import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PenaltyType, ReportReasonCode, ReportStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateBlockDto {
  @ApiProperty()
  @IsUUID()
  blockedUserId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateReportDto {
  @ApiProperty()
  @IsUUID()
  reportedUserId!: string;

  @ApiProperty({ enum: ReportReasonCode })
  @IsEnum(ReportReasonCode)
  reasonCode!: ReportReasonCode;

  @ApiProperty()
  @IsString()
  @MaxLength(3000)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  matchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  messageId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bookingId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  evidenceAssetIds?: string[];
}

export class ResolveReportDto {
  @ApiProperty({ enum: [ReportStatus.RESOLVED, ReportStatus.REJECTED] })
  @IsEnum(ReportStatus)
  status!: ReportStatus;

  @ApiProperty()
  @IsString()
  @MaxLength(3000)
  resolution!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyUser?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  adminNote?: string;

  @ApiPropertyOptional({ enum: PenaltyType })
  @IsOptional()
  @IsEnum(PenaltyType)
  penaltyType?: PenaltyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  featureCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  penaltyEndsAt?: string;
}

export class AdminReportStatusDto {
  @ApiProperty({ enum: [ReportStatus.IN_REVIEW, ReportStatus.RESOLVED, ReportStatus.REJECTED] })
  @IsIn([ReportStatus.IN_REVIEW, ReportStatus.RESOLVED, ReportStatus.REJECTED])
  status!: ReportStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  resolution?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  adminNote?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notifyUser = true;

  @ApiPropertyOptional({ enum: PenaltyType })
  @IsOptional()
  @IsEnum(PenaltyType)
  penaltyType?: PenaltyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  featureCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  penaltyEndsAt?: string;
}

export class CreatePenaltyDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reportId?: string;

  @ApiProperty({ enum: PenaltyType })
  @IsEnum(PenaltyType)
  penaltyType!: PenaltyType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  featureCode?: string;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class RevokePenaltyDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
