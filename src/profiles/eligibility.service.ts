import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  CatalogStatus,
  PenaltyStatus,
  ProfileStatus,
  RoleCode,
  ServiceMode,
  UploadAssetStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class EligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async onboarding(userId: string, userRoleId: string) {
    const role = await this.prisma.userRole.findFirst({
      where: { id: userRoleId, userId },
      include: {
        role: true,
        user: {
          include: {
            profile: true,
            locations: { where: { isCurrent: true, deletedAt: null }, take: 1 },
          },
        },
        selectedFields: true,
        selectedServices: { where: { isActive: true } },
        portfolioItems: { where: { deletedAt: null, asset: { status: UploadAssetStatus.USABLE } } },
      },
    });
    if (!role) return { complete: false, missing: ['role'] };
    const missing: string[] = [];
    const profile = role.user.profile;
    if (!profile?.displayName) missing.push('displayName');
    if (!profile?.dateOfBirth) missing.push('dateOfBirth');
    if (!profile?.cityId) missing.push('city');
    if (!profile?.avatarAssetId) missing.push('avatar');
    if (role.user.locations.length === 0) missing.push('location');
    if (role.selectedFields.length === 0) missing.push('activityFields');
    if (role.selectedServices.length === 0) missing.push('services');
    if (role.role.code === RoleCode.PHOTOGRAPHER && role.portfolioItems.length < 6) {
      missing.push('portfolioImages');
    }
    return { complete: missing.length === 0, missing };
  }

  async discovery(userRoleId: string) {
    const role = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
      include: {
        role: true,
        user: { include: { profile: true, settings: true } },
        photographerProfile: true,
        selectedServices: {
          where: {
            isActive: true,
            serviceMode: ServiceMode.OFFERED,
            service: { status: CatalogStatus.ACTIVE },
          },
        },
        portfolioItems: { where: { deletedAt: null, asset: { status: UploadAssetStatus.USABLE } } },
      },
    });
    const reasons: string[] = [];
    if (!role || role.user.accountStatus !== AccountStatus.ACTIVE) reasons.push('account');
    if (!role?.user.profile || role.user.profile.status !== ProfileStatus.ACTIVE)
      reasons.push('profile');
    if (!role?.user.settings?.profileVisibilityEnabled) reasons.push('visibility');
    if (role?.role.code === RoleCode.PHOTOGRAPHER) {
      if (!role.photographerProfile) reasons.push('photographerProfile');
      if (role.selectedServices.length === 0) reasons.push('offeredServices');
      if (role.portfolioItems.length < 6) reasons.push('portfolioImages');
      if (
        role.selectedServices.some(
          (service) =>
            service.minPrice === null || service.maxPrice === null || service.currency !== 'VND',
        )
      ) {
        reasons.push('servicePricing');
      }
    }
    const activePenalty = role
      ? await this.prisma.accountPenalty.count({
          where: {
            userId: role.userId,
            status: PenaltyStatus.ACTIVE,
            startsAt: { lte: new Date() },
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
        })
      : 0;
    if (activePenalty) reasons.push('penalty');
    return { eligible: reasons.length === 0, reasons };
  }
}
