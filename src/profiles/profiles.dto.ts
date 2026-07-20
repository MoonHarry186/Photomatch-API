import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LanguageCode,
  MapType,
  PhotographerAvailabilityStatus,
  ServiceMode,
  ThemePreference,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cityId?: string;
}

export class AttachAvatarDto {
  @ApiProperty()
  @IsUUID()
  assetId!: string;
}

export class ReplaceFieldsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  activityFieldIds!: string[];
}

export class ServiceSelectionDto {
  @ApiProperty()
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ enum: ServiceMode })
  @IsEnum(ServiceMode)
  serviceMode!: ServiceMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  priceUnit?: string;
}

export class ReplaceServicesDto {
  @ApiProperty({ type: [ServiceSelectionDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ServiceSelectionDto)
  services!: ServiceSelectionDto[];
}

export class ConsentDto {
  @ApiProperty()
  @IsUUID()
  legalDocumentId!: string;
}

export class UpdatePhotographerProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsExperience?: number;

  @ApiPropertyOptional({ enum: PhotographerAvailabilityStatus })
  @IsOptional()
  @IsEnum(PhotographerAvailabilityStatus)
  availabilityStatus?: PhotographerAvailabilityStatus;
}

export class CreatePortfolioItemDto {
  @ApiProperty()
  @IsUUID()
  assetId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdatePortfolioItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class PortfolioOrderItemDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class ReorderPortfolioDto {
  @ApiProperty({ type: [PortfolioOrderItemDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PortfolioOrderItemDto)
  items!: PortfolioOrderItemDto[];
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ enum: LanguageCode })
  @IsOptional()
  @IsEnum(LanguageCode)
  language?: LanguageCode;

  @ApiPropertyOptional({ enum: ThemePreference })
  @IsOptional()
  @IsEnum(ThemePreference)
  theme?: ThemePreference;

  @ApiPropertyOptional({ enum: MapType })
  @IsOptional()
  @IsEnum(MapType)
  mapType?: MapType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  matchNotificationsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  bookingNotificationsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  readReceiptsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  profileVisibilityEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  locationVisibilityDurationHours?: number;
}
