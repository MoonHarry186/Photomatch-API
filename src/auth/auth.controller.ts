import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Public } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import {
  EmailDto,
  OAuthSignInDto,
  RefreshDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
  VerifyEmailDto,
  VerifyPasswordResetOtpDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('sign-up')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signUp(@Body() dto: SignUpDto, @Req() request: Request) {
    return this.auth.signUp(dto, request.ip);
  }

  @Public()
  @Post('verify-email')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() request: Request) {
    return this.auth.verifyEmail(dto.challengeId, dto.otp, {
      ...this.sessionContext(request),
      deviceId: dto.deviceId ?? request.header('x-device-id'),
    });
  }

  @Public()
  @Post('resend-verification')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resend(@Body() dto: EmailDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Public()
  @Post('sign-in')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  signIn(@Body() dto: SignInDto, @Req() request: Request) {
    return this.auth.signIn(dto, this.sessionContext(request));
  }

  @Public()
  @Post('oauth')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  oauthSignIn(@Body() dto: OAuthSignInDto, @Req() request: Request) {
    return this.auth.oauthSignIn(dto, this.sessionContext(request));
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    return this.auth.refresh(dto.refreshToken, this.sessionContext(request));
  }

  @Public()
  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  forgotPassword(@Body() dto: EmailDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('verify-password-reset-otp')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verifyPasswordResetOtp(@Body() dto: VerifyPasswordResetOtpDto) {
    return this.auth.verifyPasswordResetOtp(dto.challengeId, dto.otp);
  }

  @Public()
  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.resetToken, dto.newPassword);
  }

  @ApiBearerAuth()
  @Post('sign-out')
  signOut(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.signOut(user);
  }

  private sessionContext(request: Request) {
    return {
      userAgent: request.header('user-agent'),
      ipAddress: request.ip,
      deviceId: request.header('x-device-id'),
    };
  }
}
