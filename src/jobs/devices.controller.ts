import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/auth-context';
import type { AuthenticatedUser } from '../common/auth-context';
import { RegisterDeviceDto } from './devices.dto';
import { DevicesService } from './devices.service';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.devices.register(user.userId, dto);
  }

  @Delete(':deviceId')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('deviceId') deviceId: string) {
    return this.devices.remove(user.userId, deviceId);
  }
}
