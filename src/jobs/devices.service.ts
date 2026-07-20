import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RegisterDeviceDto } from './devices.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, dto: RegisterDeviceDto) {
    await this.prisma.deviceRegistration.updateMany({
      where: { token: dto.token, userId: { not: userId } },
      data: { isActive: false },
    });
    return this.prisma.deviceRegistration.upsert({
      where: {
        userId_deviceId_provider: {
          userId,
          deviceId: dto.deviceId,
          provider: dto.provider,
        },
      },
      create: { userId, ...dto },
      update: { token: dto.token, isActive: true, lastSeenAt: new Date() },
      select: {
        id: true,
        deviceId: true,
        provider: true,
        isActive: true,
        lastSeenAt: true,
      },
    });
  }

  async remove(userId: string, deviceId: string) {
    await this.prisma.deviceRegistration.updateMany({
      where: { userId, deviceId },
      data: { isActive: false },
    });
    return { status: 'removed' };
  }
}
