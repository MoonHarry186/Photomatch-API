import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AccountStatus,
  BookingStatus,
  CatalogStatus,
  IdentityVerificationStatus,
  LegalDocumentType,
  PenaltyStatus,
  PenaltyType,
  PhotographerAvailabilityStatus,
  ProfileStatus,
  ReportReasonCode,
  ReportStatus,
  ReviewStatus,
  RoleCode,
  RoleStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CursorPageDto } from '../common/pagination';
import { FEATURE_RESTRICTION_CODES } from '../common/feature-codes';

export const ADMIN_FEATURE_CODES = FEATURE_RESTRICTION_CODES;

export const ADMIN_REPORT_CONTEXT_TYPES = [
  'USER',
  'MATCH',
  'CONVERSATION',
  'MESSAGE',
  'BOOKING',
] as const;

export type AdminReportContextType = (typeof ADMIN_REPORT_CONTEXT_TYPES)[number];

export class AdminSearchQueryDto extends CursorPageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AdminUserQueryDto extends AdminSearchQueryDto {
  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({ enum: RoleCode })
  @IsOptional()
  @IsEnum(RoleCode)
  role?: RoleCode;

  @ApiPropertyOptional({ enum: IdentityVerificationStatus })
  @IsOptional()
  @IsEnum(IdentityVerificationStatus)
  verificationStatus?: IdentityVerificationStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cityId?: string;
}

export class AdminPhotographerQueryDto extends AdminSearchQueryDto {
  @ApiPropertyOptional({ enum: RoleStatus })
  @IsOptional()
  @IsEnum(RoleStatus)
  status?: RoleStatus;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;

  @ApiPropertyOptional({ enum: ProfileStatus })
  @IsOptional()
  @IsEnum(ProfileStatus)
  profileStatus?: ProfileStatus;

  @ApiPropertyOptional({ enum: IdentityVerificationStatus })
  @IsOptional()
  @IsEnum(IdentityVerificationStatus)
  verificationStatus?: IdentityVerificationStatus;

  @ApiPropertyOptional({ enum: PhotographerAvailabilityStatus })
  @IsOptional()
  @IsEnum(PhotographerAvailabilityStatus)
  availabilityStatus?: PhotographerAvailabilityStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  activityFieldId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

export class AdminReviewQueryDto extends AdminSearchQueryDto {
  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  reviewerUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  revieweeUserId?: string;
}

export class AdminReportQueryDto extends AdminSearchQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportReasonCode })
  @IsOptional()
  @IsEnum(ReportReasonCode)
  reasonCode?: ReportReasonCode;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  reporterUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  reportedUserId?: string;

  @ApiPropertyOptional({ enum: ADMIN_REPORT_CONTEXT_TYPES })
  @IsOptional()
  @IsIn(ADMIN_REPORT_CONTEXT_TYPES)
  contextType?: AdminReportContextType;
}

export class AdminPenaltyQueryDto extends AdminSearchQueryDto {
  @ApiPropertyOptional({ enum: PenaltyStatus })
  @IsOptional()
  @IsEnum(PenaltyStatus)
  status?: PenaltyStatus;

  @ApiPropertyOptional({ enum: PenaltyType })
  @IsOptional()
  @IsEnum(PenaltyType)
  penaltyType?: PenaltyType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class AdminBookingQueryDto extends AdminSearchQueryDto {
  @ApiPropertyOptional({ enum: BookingStatus })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({ enum: BookingStatus, deprecated: true })
  @IsOptional()
  @IsEnum(BookingStatus)
  bookingStatus?: BookingStatus;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  customerUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  photographerUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  serviceId?: string;
}

export class AdminActivityFieldQueryDto extends AdminSearchQueryDto {
  @ApiPropertyOptional({ enum: CatalogStatus })
  @IsOptional()
  @IsEnum(CatalogStatus)
  status?: CatalogStatus;
}

export class AdminServiceQueryDto extends AdminActivityFieldQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  activityFieldId?: string;
}

export class AdminLegalDocumentQueryDto extends AdminSearchQueryDto {
  @ApiPropertyOptional({ enum: CatalogStatus })
  @IsOptional()
  @IsEnum(CatalogStatus)
  status?: CatalogStatus;

  @ApiPropertyOptional({ enum: LegalDocumentType })
  @IsOptional()
  @IsEnum(LegalDocumentType)
  documentType?: LegalDocumentType;
}

export class UserStatusActionDto {
  @ApiProperty({
    enum: [AccountStatus.ACTIVE, AccountStatus.SUSPENDED, AccountStatus.BANNED],
  })
  @IsIn([AccountStatus.ACTIVE, AccountStatus.SUSPENDED, AccountStatus.BANNED])
  status!: AccountStatus;

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
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  activityFieldId?: string;

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
