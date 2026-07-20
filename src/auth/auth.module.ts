import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [AuthController, AdminAuthController, MeController],
  providers: [AuthService, RolesService],
  exports: [AuthService, RolesService],
})
export class AuthModule {}
