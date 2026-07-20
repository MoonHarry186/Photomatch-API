import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthProvider, RoleCode } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length, MinLength } from 'class-validator';

export class SignUpDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  password!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @Length(32, 512)
  token!: string;
}

export class EmailDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ChangePendingEmailDto {
  @ApiProperty()
  @IsEmail()
  currentEmail!: string;

  @ApiProperty()
  @IsEmail()
  newEmail!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class SignInDto extends EmailDto {
  @ApiProperty()
  @IsString()
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class ResetPasswordDto extends VerifyEmailDto {
  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12)
  newPassword!: string;
}

export class OAuthSignInDto {
  @ApiProperty({ enum: [AuthProvider.GOOGLE, AuthProvider.APPLE] })
  @IsEnum(AuthProvider)
  provider!: AuthProvider;

  @ApiProperty()
  @IsString()
  idToken!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nonce?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceId?: string;
}

export class AddRoleDto {
  @ApiProperty({ enum: [RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER] })
  @IsEnum(RoleCode)
  role!: RoleCode;
}

export class SwitchRoleDto {
  @ApiProperty()
  @IsUUID()
  userRoleId!: string;
}
