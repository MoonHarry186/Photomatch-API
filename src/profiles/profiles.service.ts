import { Injectable } from '@nestjs/common';
import {
  CatalogStatus,
  Prisma,
  ProfileStatus,
  ReviewStatus,
  RoleCode,
  RoleStatus,
  ServiceMode,
  UploadPurpose,
} from '@prisma/client';
import { ApiError } from '../common/api-error';
import { CursorPageDto, decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  CreatePortfolioItemDto,
  ReorderPortfolioDto,
  ReplaceFieldsDto,
  ReplaceServicesDto,
  UpdatePhotographerProfileDto,
  UpdatePortfolioItemDto,
  UpdateProfileDto,
  UpdateSettingsDto,
} from './profiles.dto';
import { EligibilityService } from './eligibility.service';

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly eligibility: EligibilityService,
  ) {}

  async onboardingProgress(userId: string, currentRoleId?: string) {
    if (!currentRoleId) {
      return {
        userRoleId: null,
        role: null,
        complete: false,
        missing: ['role'],
        discoveryEligible: false,
        discoveryReasons: ['role'],
      };
    }
    const role = await this.ownedRole(userId, currentRoleId);
    const [onboarding, discovery] = await Promise.all([
      this.eligibility.onboarding(userId, role.id),
      this.eligibility.discovery(role.id),
    ]);
    return {
      userRoleId: role.id,
      role: role.role.code,
      complete: onboarding.complete,
      missing: onboarding.missing,
      discoveryEligible: discovery.eligible,
      discoveryReasons: discovery.reasons,
    };
  }

  async self(userId: string) {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: {
        displayName: true,
        dateOfBirth: true,
        bio: true,
        status: true,
        cityId: true,
        avatarAssetId: true,
        city: { select: { id: true, code: true, name: true } },
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!profile) throw ApiError.notFound('Profile');
    return profile;
  }

  async updateSelf(userId: string, currentRoleId: string | undefined, dto: UpdateProfileDto) {
    if (dto.cityId) {
      const city = await this.prisma.city.findFirst({
        where: { id: dto.cityId, status: CatalogStatus.ACTIVE },
      });
      if (!city) throw ApiError.notFound('City');
    }
    if (dto.dateOfBirth) {
      const birth = new Date(dto.dateOfBirth);
      const age = new Date().getUTCFullYear() - birth.getUTCFullYear();
      if (age < 18) throw new ApiError('AGE_REQUIREMENT', 'User must be at least 18 years old');
    }
    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
        status: ProfileStatus.ACTIVE,
      },
    });
    await this.recalculateOnboarding(userId, currentRoleId);
    return this.self(userId);
  }

  async publicProfile(userRoleId: string) {
    const role = await this.prisma.userRole.findFirst({
      where: { id: userRoleId, status: RoleStatus.ACTIVE },
      include: {
        role: true,
        user: {
          select: {
            id: true,
            identityVerificationStatus: true,
            profile: {
              select: {
                displayName: true,
                bio: true,
                avatarAssetId: true,
                city: { select: { id: true, name: true } },
                status: true,
              },
            },
          },
        },
        photographerProfile: true,
        selectedFields: { include: { activityField: true } },
        selectedServices: { where: { isActive: true }, include: { service: true } },
      },
    });
    if (!role?.user.profile || role.user.profile.status !== ProfileStatus.ACTIVE) {
      throw ApiError.notFound('Profile');
    }
    const rating =
      role.role.code === RoleCode.PHOTOGRAPHER
        ? await this.prisma.review.aggregate({
            where: { revieweeUserId: role.userId, status: ReviewStatus.PUBLISHED },
            _avg: { rating: true },
            _count: { rating: true },
          })
        : undefined;
    return {
      userRoleId: role.id,
      role: role.role.code,
      displayName: role.user.profile.displayName,
      bio: role.user.profile.bio,
      avatarAssetId: role.user.profile.avatarAssetId,
      city: role.user.profile.city,
      identityVerificationStatus: role.user.identityVerificationStatus,
      photographerProfile: role.photographerProfile
        ? {
            headline: role.photographerProfile.headline,
            yearsExperience: role.photographerProfile.yearsExperience,
            availabilityStatus: role.photographerProfile.availabilityStatus,
          }
        : null,
      activityFields: role.selectedFields.map(({ activityField }) => ({
        id: activityField.id,
        code: activityField.code,
        name: activityField.name,
      })),
      services: role.selectedServices.map(({ service, ...selection }) => ({
        id: service.id,
        code: service.code,
        name: service.name,
        serviceMode: selection.serviceMode,
        minPrice: selection.minPrice,
        maxPrice: selection.maxPrice,
        currency: selection.currency,
        priceUnit: selection.priceUnit,
      })),
      rating: rating
        ? { average: rating._avg.rating ?? 0, count: rating._count.rating }
        : undefined,
    };
  }

  async attachAvatar(userId: string, currentRoleId: string | undefined, assetId: string) {
    await this.uploads.assertUsableOwnedAsset(userId, assetId, [UploadPurpose.AVATAR]);
    await this.prisma.transaction(async (tx) => {
      const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
      await tx.userProfile.update({ where: { userId }, data: { avatarAssetId: assetId } });
      await tx.uploadAsset.update({ where: { id: assetId }, data: { attachedAt: new Date() } });
      if (profile.avatarAssetId && profile.avatarAssetId !== assetId) {
        await tx.uploadAsset.update({
          where: { id: profile.avatarAssetId },
          data: { attachedAt: null },
        });
      }
    });
    await this.recalculateOnboarding(userId, currentRoleId);
    return this.self(userId);
  }

  async deleteAvatar(userId: string, currentRoleId: string | undefined) {
    await this.prisma.transaction(async (tx) => {
      const profile = await tx.userProfile.findUniqueOrThrow({ where: { userId } });
      await tx.userProfile.update({ where: { userId }, data: { avatarAssetId: null } });
      if (profile.avatarAssetId) {
        await tx.uploadAsset.update({
          where: { id: profile.avatarAssetId },
          data: { attachedAt: null },
        });
      }
    });
    await this.recalculateOnboarding(userId, currentRoleId);
    return { status: 'deleted' };
  }

  async fields(userId: string, userRoleId: string) {
    await this.ownedRole(userId, userRoleId);
    return this.prisma.userRoleField.findMany({
      where: { userRoleId },
      include: { activityField: true },
      orderBy: { activityField: { name: 'asc' } },
    });
  }

  async replaceFields(userId: string, userRoleId: string, dto: ReplaceFieldsDto) {
    const role = await this.ownedRole(userId, userRoleId);
    const allowed = await this.prisma.activityField.findMany({
      where: {
        id: { in: dto.activityFieldIds },
        status: CatalogStatus.ACTIVE,
        roleMappings: { some: { roleId: role.roleId } },
      },
      select: { id: true },
    });
    if (allowed.length !== dto.activityFieldIds.length) {
      throw new ApiError(
        'INVALID_ACTIVITY_FIELD',
        'One or more activity fields are inactive or incompatible',
      );
    }
    await this.prisma.transaction(async (tx) => {
      await tx.userRoleField.deleteMany({ where: { userRoleId } });
      if (dto.activityFieldIds.length) {
        await tx.userRoleField.createMany({
          data: dto.activityFieldIds.map((activityFieldId) => ({ userRoleId, activityFieldId })),
        });
        await tx.userRoleService.deleteMany({
          where: {
            userRoleId,
            service: { activityFieldId: { notIn: dto.activityFieldIds } },
          },
        });
      } else {
        await tx.userRoleService.deleteMany({ where: { userRoleId } });
      }
    });
    await this.recalculateOnboarding(userId, userRoleId);
    return this.fields(userId, userRoleId);
  }

  async services(userId: string, userRoleId: string) {
    await this.ownedRole(userId, userRoleId);
    return this.prisma.userRoleService.findMany({
      where: { userRoleId, isActive: true },
      include: { service: true },
      orderBy: { service: { name: 'asc' } },
    });
  }

  async replaceServices(userId: string, userRoleId: string, dto: ReplaceServicesDto) {
    const role = await this.ownedRole(userId, userRoleId);
    const keys = new Set(dto.services.map((item) => `${item.serviceId}:${item.serviceMode}`));
    if (keys.size !== dto.services.length) {
      throw new ApiError('DUPLICATE_SERVICE', 'Each service and mode pair must be unique');
    }
    for (const item of dto.services) {
      if (
        item.minPrice !== undefined &&
        item.maxPrice !== undefined &&
        item.minPrice > item.maxPrice
      ) {
        throw new ApiError('INVALID_PRICE_RANGE', 'Minimum price must not exceed maximum price');
      }
      if (role.role.code === RoleCode.PHOTOGRAPHER && item.serviceMode !== ServiceMode.OFFERED) {
        throw new ApiError(
          'INVALID_SERVICE_MODE',
          'Photographers can only configure offered services',
        );
      }
      if (
        item.serviceMode === ServiceMode.OFFERED &&
        (item.minPrice === undefined || item.maxPrice === undefined)
      ) {
        throw new ApiError(
          'PRICE_REQUIRED',
          'Offered services require minimum and maximum VND prices',
        );
      }
    }
    const services = await this.prisma.service.findMany({
      where: {
        id: { in: dto.services.map((item) => item.serviceId) },
        status: CatalogStatus.ACTIVE,
      },
      select: { id: true, activityFieldId: true },
    });
    if (services.length !== new Set(dto.services.map((item) => item.serviceId)).size) {
      throw new ApiError('INVALID_SERVICE', 'One or more services are inactive or invalid');
    }
    const selectedFields = await this.prisma.userRoleField.findMany({
      where: { userRoleId },
      select: { activityFieldId: true },
    });
    const fieldIds = new Set(selectedFields.map((item) => item.activityFieldId));
    if (services.some((service) => !fieldIds.has(service.activityFieldId))) {
      throw new ApiError(
        'SERVICE_FIELD_REQUIRED',
        'Service must belong to a selected activity field',
      );
    }
    await this.prisma.transaction(async (tx) => {
      await tx.userRoleService.deleteMany({ where: { userRoleId } });
      if (dto.services.length) {
        await tx.userRoleService.createMany({
          data: dto.services.map((item) => ({
            userRoleId,
            serviceId: item.serviceId,
            serviceMode: item.serviceMode,
            minPrice: item.minPrice,
            maxPrice: item.maxPrice,
            currency: 'VND',
            priceUnit: item.priceUnit,
          })),
        });
      }
    });
    await this.recalculateOnboarding(userId, userRoleId);
    return this.services(userId, userRoleId);
  }

  async consents(userId: string) {
    return this.prisma.userConsent.findMany({
      where: { userId },
      include: { legalDocument: true },
      orderBy: { acceptedAt: 'desc' },
    });
  }

  async consent(userId: string, legalDocumentId: string, ipAddress?: string) {
    const legal = await this.prisma.legalDocument.findFirst({
      where: {
        id: legalDocumentId,
        status: CatalogStatus.ACTIVE,
        effectiveAt: { lte: new Date() },
      },
    });
    if (!legal)
      throw new ApiError('STALE_LEGAL_VERSION', 'Legal document is not the current active version');
    return this.prisma.userConsent.upsert({
      where: { userId_legalDocumentId: { userId, legalDocumentId } },
      create: { userId, legalDocumentId, ipAddress },
      update: {},
      include: { legalDocument: true },
    });
  }

  async photographerSelf(userId: string) {
    const role = await this.prisma.userRole.findFirst({
      where: { userId, role: { code: RoleCode.PHOTOGRAPHER } },
      include: { photographerProfile: true },
    });
    if (!role?.photographerProfile) throw ApiError.notFound('Photographer profile');
    return role.photographerProfile;
  }

  async updatePhotographer(userId: string, dto: UpdatePhotographerProfileDto) {
    const role = await this.prisma.userRole.findFirst({
      where: { userId, role: { code: RoleCode.PHOTOGRAPHER }, status: RoleStatus.ACTIVE },
    });
    if (!role)
      throw ApiError.forbidden('PHOTOGRAPHER_ROLE_REQUIRED', 'Photographer role is required');
    return this.prisma.photographerProfile.upsert({
      where: { userRoleId: role.id },
      create: { userRoleId: role.id, ...dto },
      update: dto,
    });
  }

  async portfolio(userId: string, userRoleId: string) {
    await this.ownedPhotographerRole(userId, userRoleId);
    return this.prisma.portfolioItem.findMany({
      where: { userRoleId, deletedAt: null },
      select: this.portfolioProjection(),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createPortfolio(userId: string, userRoleId: string, dto: CreatePortfolioItemDto) {
    await this.ownedPhotographerRole(userId, userRoleId);
    await this.uploads.assertUsableOwnedAsset(userId, dto.assetId, [UploadPurpose.PORTFOLIO]);
    if (dto.serviceId) await this.assertOfferedService(userRoleId, dto.serviceId);
    const max = await this.prisma.portfolioItem.aggregate({
      where: { userRoleId, deletedAt: null },
      _max: { sortOrder: true },
    });
    const item = await this.prisma.transaction(async (tx) => {
      const item = await tx.portfolioItem.create({
        data: { userRoleId, sortOrder: (max._max.sortOrder ?? -1) + 1, ...dto },
        select: this.portfolioProjection(),
      });
      await tx.uploadAsset.update({ where: { id: dto.assetId }, data: { attachedAt: new Date() } });
      return item;
    });
    await this.recalculateOnboarding(userId, userRoleId);
    return item;
  }

  async portfolioDetail(userId: string, userRoleId: string, itemId: string) {
    await this.ownedPhotographerRole(userId, userRoleId);
    const item = await this.prisma.portfolioItem.findFirst({
      where: { id: itemId, userRoleId, deletedAt: null },
      select: this.portfolioProjection(),
    });
    if (!item) throw ApiError.notFound('Portfolio item');
    return item;
  }

  async updatePortfolio(
    userId: string,
    userRoleId: string,
    itemId: string,
    dto: UpdatePortfolioItemDto,
  ) {
    await this.portfolioDetail(userId, userRoleId, itemId);
    if (dto.serviceId) await this.assertOfferedService(userRoleId, dto.serviceId);
    return this.prisma.portfolioItem.update({
      where: { id: itemId },
      data: dto,
      select: this.portfolioProjection(),
    });
  }

  async reorderPortfolio(userId: string, userRoleId: string, dto: ReorderPortfolioDto) {
    await this.ownedPhotographerRole(userId, userRoleId);
    const count = await this.prisma.portfolioItem.count({
      where: { userRoleId, deletedAt: null, id: { in: dto.items.map((item) => item.id) } },
    });
    if (count !== dto.items.length)
      throw new ApiError('INVALID_PORTFOLIO_ORDER', 'Portfolio order contains invalid items');
    await this.prisma.transaction(async (tx) => {
      for (const item of dto.items) {
        await tx.portfolioItem.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        });
      }
    });
    return this.portfolio(userId, userRoleId);
  }

  async deletePortfolio(userId: string, userRoleId: string, itemId: string) {
    const item = await this.portfolioDetail(userId, userRoleId, itemId);
    await this.prisma.transaction(async (tx) => {
      await tx.portfolioItem.update({ where: { id: itemId }, data: { deletedAt: new Date() } });
      await tx.uploadAsset.update({ where: { id: item.assetId }, data: { attachedAt: null } });
    });
    await this.recalculateOnboarding(userId, userRoleId);
    return { status: 'deleted' };
  }

  async publicPortfolio(userRoleId: string, query: CursorPageDto) {
    const cursor = decodeCursor<{ sortOrder: number; id: string }>(query.cursor);
    const items = await this.prisma.portfolioItem.findMany({
      where: {
        userRoleId,
        deletedAt: null,
        ...(cursor
          ? {
              OR: [
                { sortOrder: { gt: cursor.sortOrder } },
                { sortOrder: cursor.sortOrder, id: { gt: cursor.id } },
              ],
            }
          : {}),
        userRole: {
          role: { code: RoleCode.PHOTOGRAPHER },
          user: { profile: { status: ProfileStatus.ACTIVE } },
        },
      },
      select: this.portfolioProjection(),
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
    });
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor: hasMore && last ? encodeCursor({ sortOrder: last.sortOrder, id: last.id }) : null,
    };
  }

  settings(userId: string) {
    return this.prisma.userSettings.findUniqueOrThrow({ where: { userId } });
  }

  updateSettings(userId: string, dto: UpdateSettingsDto) {
    return this.prisma.userSettings.update({ where: { userId }, data: dto });
  }

  private ownedRole(userId: string, userRoleId: string) {
    return this.prisma.userRole.findFirstOrThrow({
      where: { id: userRoleId, userId, status: RoleStatus.ACTIVE },
      include: { role: true },
    });
  }

  private async ownedPhotographerRole(userId: string, userRoleId: string) {
    const role = await this.prisma.userRole.findFirst({
      where: {
        id: userRoleId,
        userId,
        status: RoleStatus.ACTIVE,
        role: { code: RoleCode.PHOTOGRAPHER },
      },
    });
    if (!role)
      throw ApiError.forbidden(
        'PORTFOLIO_OWNERSHIP_REQUIRED',
        'Photographer portfolio is not owned by actor',
      );
    return role;
  }

  private async assertOfferedService(userRoleId: string, serviceId: string) {
    const selection = await this.prisma.userRoleService.findFirst({
      where: { userRoleId, serviceId, serviceMode: ServiceMode.OFFERED, isActive: true },
    });
    if (!selection)
      throw new ApiError('SERVICE_NOT_OFFERED', 'Portfolio service is not offered by photographer');
  }

  private portfolioProjection(): Prisma.PortfolioItemSelect {
    return {
      id: true,
      userRoleId: true,
      serviceId: true,
      assetId: true,
      title: true,
      description: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      service: { select: { id: true, name: true, code: true } },
    };
  }

  private async recalculateOnboarding(userId: string, userRoleId?: string) {
    if (!userRoleId) return;
    const progress = await this.eligibility.onboarding(userId, userRoleId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: progress.complete ? new Date() : null },
    });
  }
}
