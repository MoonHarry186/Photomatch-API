import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BookingStatus,
  CatalogStatus,
  LegalDocumentType,
  ReviewStatus,
  RoleCode,
} from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { CursorPageDto } from '../common/pagination';

export class AdminListQueryDto extends CursorPageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

export class AdminBookingQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  bookingStatus?: BookingStatus;
}

export class UserStatusActionDto {
  @ApiProperty({ enum: ['SUSPEND', 'RESTORE'] })
  @IsString()
  action!: 'SUSPEND' | 'RESTORE';

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class ModerateReviewDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status!: ReviewStatus;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class CreateActivityFieldDto {
  @ApiProperty()
  @IsString()
  @MaxLength(60)
  code!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: [RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER], isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(RoleCode, { each: true })
  allowedRoles!: RoleCode[];
}

export class UpdateActivityFieldDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: CatalogStatus })
  @IsOptional()
  @IsEnum(CatalogStatus)
  status?: CatalogStatus;

  @ApiPropertyOptional({ enum: [RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER], isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(RoleCode, { each: true })
  allowedRoles?: RoleCode[];
}

export class CreateServiceDto {
  @ApiProperty()
  @IsUUID()
  activityFieldId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  code!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateServiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: CatalogStatus })
  @IsOptional()
  @IsEnum(CatalogStatus)
  status?: CatalogStatus;
}

export class CreateLegalDocumentDto {
  @ApiProperty({ enum: LegalDocumentType })
  @IsEnum(LegalDocumentType)
  documentType!: LegalDocumentType;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  version!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  contentUrl!: string;

  @ApiProperty()
  @IsDateString()
  effectiveAt!: string;
}

export class UpdateLegalDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  contentUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveAt?: string;
}

export class LegalStatusActionDto {
  @ApiProperty({ enum: ['ACTIVATE', 'ARCHIVE'] })
  @IsString()
  action!: 'ACTIVATE' | 'ARCHIVE';
}
