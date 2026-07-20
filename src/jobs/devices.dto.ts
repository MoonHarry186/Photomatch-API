import { ApiProperty } from '@nestjs/swagger';
import { DeviceProvider } from '@prisma/client';
import { IsEnum, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  deviceId!: string;

  @ApiProperty({ enum: DeviceProvider })
  @IsEnum(DeviceProvider)
  provider!: DeviceProvider;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  token!: string;
}
