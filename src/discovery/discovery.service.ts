import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoleStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { ApiError } from '../common/api-error';
import { FeatureAccessService } from '../common/feature-access.service';
import { PrismaService } from '../database/prisma.service';
import { EligibilityService } from '../profiles/eligibility.service';
import { DiscoveryQueryDto, PutLocationDto, PutPresenceDto } from './discovery.dto';
import { LocationRepository } from './location.repository';

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationRepository,
    private readonly config: ConfigService,
    private readonly eligibility: EligibilityService,
    private readonly featureAccess: FeatureAccessService,
  ) {}

  async putLocation(userId: string, dto: PutLocationDto) {
    await this.featureAccess.assertAllowed(userId, 'LOCATION');
    await this.locations.replaceExact(userId, dto);
    const visible = await this.prisma.discoveryPresence.findMany({
      where: { isVisible: true, visibleUntil: { gt: new Date() }, userRole: { userId } },
      include: { userRole: true },
    });
    for (const presence of visible) {
      await this.enable(userId, {
        userRoleId: presence.userRoleId,
        enabled: true,
        visibilityHours: Math.max(
          1,
          Math.ceil(((presence.visibleUntil?.getTime() ?? Date.now()) - Date.now()) / 3_600_000),
        ),
      });
    }
    await this.recalculateOnboarding(userId);
    return { status: 'updated' };
  }

  async deleteLocation(userId: string) {
    await this.prisma.transaction(async (tx) => {
      await tx.userLocation.updateMany({
        where: { userId, isCurrent: true, deletedAt: null },
        data: { isCurrent: false, deletedAt: new Date() },
      });
      await tx.discoveryPresence.updateMany({
        where: { userRole: { userId } },
        data: { isVisible: false, visibleUntil: null },
      });
    });
    await this.recalculateOnboarding(userId);
    return { status: 'deleted', discoveryPresenceEnabled: false };
  }

  async presence(userId: string, currentRoleId?: string) {
    if (!currentRoleId) throw new ApiError('CURRENT_ROLE_REQUIRED', 'Select a current role first');
    const role = await this.ownedRole(userId, currentRoleId);
    const presence = await this.prisma.discoveryPresence.findUnique({
      where: { userRoleId: role.id },
      select: {
        userRoleId: true,
        isVisible: true,
        visibleUntil: true,
        publicRadiusMeters: true,
        updatedAt: true,
      },
    });
    return (
      presence ?? {
        userRoleId: role.id,
        isVisible: false,
        visibleUntil: null,
        publicRadiusMeters: null,
        updatedAt: null,
      }
    );
  }

  async enable(userId: string, dto: PutPresenceDto) {
    await this.featureAccess.assertAllowed(userId, 'DISCOVERY');
    const role = await this.ownedRole(userId, dto.userRoleId);
    if (!dto.enabled) {
      await this.prisma.discoveryPresence.updateMany({
        where: { userRoleId: role.id },
        data: { isVisible: false, visibleUntil: null },
      });
      return this.presence(userId, role.id);
    }
    const eligibility = await this.eligibility.discovery(role.id);
    if (!eligibility.eligible) {
      throw ApiError.forbidden('DISCOVERY_INELIGIBLE', 'Profile is not eligible for discovery');
    }
    const exact = await this.locations.currentExact(userId);
    if (!exact)
      throw new ApiError('LOCATION_REQUIRED', 'Current location is required to enable discovery');
    const settings = await this.prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    const hours = dto.visibilityHours ?? settings.locationVisibilityDurationHours;
    const visibleUntil = new Date(Date.now() + hours * 3_600_000);
    const offset = this.stableOffset(role.id, hours, exact.latitude);
    await this.locations.upsertPresence(
      role.id,
      {
        latitude: exact.latitude + offset.latitudeDelta,
        longitude: exact.longitude + offset.longitudeDelta,
      },
      offset.noiseMeters,
      visibleUntil,
    );
    return this.presence(userId, role.id);
  }

  async candidates(userId: string, currentRoleId: string | undefined, query: DiscoveryQueryDto) {
    await this.featureAccess.assertAllowed(userId, 'DISCOVERY');
    if (!currentRoleId) throw new ApiError('CURRENT_ROLE_REQUIRED', 'Select a current role first');
    await this.ownedRole(userId, currentRoleId);
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new ApiError('INVALID_PRICE_RANGE', 'Minimum price must not exceed maximum price');
    }
    return this.locations.nearby(
      userId,
      currentRoleId,
      query,
      this.config.getOrThrow<number>('LOCATION_MAX_RADIUS_KM'),
    );
  }

  private ownedRole(userId: string, userRoleId: string) {
    return this.prisma.userRole.findFirstOrThrow({
      where: { id: userRoleId, userId, status: RoleStatus.ACTIVE },
    });
  }

  private async recalculateOnboarding(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currentRoleId: true },
    });
    if (!user?.currentRoleId) return;
    const progress = await this.eligibility.onboarding(userId, user.currentRoleId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: progress.complete ? new Date() : null },
    });
  }

  private stableOffset(userRoleId: string, visibilityHours: number, latitude: number) {
    const windowMs = visibilityHours * 3_600_000;
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const digest = createHmac('sha256', this.config.getOrThrow<string>('JWT_ACCESS_SECRET'))
      .update(`${userRoleId}:${windowStart}`)
      .digest();
    const unitRadius = digest.readUInt32BE(0) / 0xffffffff;
    const angle = (digest.readUInt32BE(4) / 0xffffffff) * Math.PI * 2;
    const minimum = this.config.getOrThrow<number>('LOCATION_NOISE_MIN_METERS');
    const maximum = this.config.getOrThrow<number>('LOCATION_NOISE_MAX_METERS');
    const noiseMeters = Math.round(minimum + (maximum - minimum) * unitRadius);
    return {
      noiseMeters,
      latitudeDelta: (noiseMeters * Math.sin(angle)) / 110_540,
      longitudeDelta:
        (noiseMeters * Math.cos(angle)) /
        Math.max(1, 111_320 * Math.cos((latitude * Math.PI) / 180)),
    };
  }
}
