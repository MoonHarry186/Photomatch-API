import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SwipeDirection, SwipeSource } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SwipeDto {
  @ApiProperty()
  @IsUUID()
  targetUserRoleId!: string;

  @ApiProperty({ enum: [SwipeDirection.LEFT, SwipeDirection.RIGHT] })
  @IsEnum(SwipeDirection)
  direction!: SwipeDirection;

  @ApiProperty({ enum: SwipeSource })
  @IsEnum(SwipeSource)
  source!: SwipeSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  discoveryFilterId?: string;
}

export class InterestDecisionDto {
  @ApiProperty({ enum: [SwipeDirection.ACCEPT, SwipeDirection.REJECT] })
  @IsEnum(SwipeDirection)
  decision!: SwipeDirection;
}

export class UnmatchDto {
  @ApiProperty()
  @IsString()
  @MaxLength(500)
  reason!: string;
}
