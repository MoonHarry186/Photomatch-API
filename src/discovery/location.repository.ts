import { Injectable } from '@nestjs/common';
import { Prisma, RoleCode } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { decodeCursor, encodeCursor } from '../common/pagination';
import { PrismaService } from '../database/prisma.service';
import { DiscoveryQueryDto, PutLocationDto } from './discovery.dto';

interface ExactCoordinate {
  latitude: number;
  longitude: number;
}

interface NearbyRow {
  userRoleId: string;
  userId: string;
  displayName: string | null;
  avatarAssetId: string | null;
  headline: string | null;
  availabilityStatus: string | null;
  identityVerificationStatus: string;
  distanceMeters: number;
}

interface DiscoveryRow extends Omit<NearbyRow, 'distanceMeters'> {
  updatedAt: Date;
}

@Injectable()
export class LocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async replaceExact(userId: string, dto: PutLocationDto): Promise<void> {
    await this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`UPDATE user_locations SET is_current = false, deleted_at = NOW() WHERE user_id = ${userId}::uuid AND is_current = true`;
      await tx.$executeRaw`
        INSERT INTO user_locations (
          id, user_id, exact_point, accuracy_meters, is_current, captured_at, created_at
        ) VALUES (
          ${randomUUID()}::uuid,
          ${userId}::uuid,
          ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography,
          ${dto.accuracyMeters ?? null},
          true,
          ${dto.capturedAt ? new Date(dto.capturedAt) : new Date()},
          NOW()
        )
      `;
    });
  }

  async currentExact(userId: string): Promise<ExactCoordinate | null> {
    const rows = await this.prisma.$queryRaw<ExactCoordinate[]>`
      SELECT
        ST_Y(exact_point::geometry)::double precision AS latitude,
        ST_X(exact_point::geometry)::double precision AS longitude
      FROM user_locations
      WHERE user_id = ${userId}::uuid AND is_current = true AND deleted_at IS NULL
      ORDER BY captured_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async upsertPresence(
    userRoleId: string,
    point: ExactCoordinate,
    noiseMeters: number,
    visibleUntil: Date,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO discovery_presence (
        id, user_role_id, public_point, public_radius_meters, location_noise_meters,
        is_visible, visible_until, created_at, updated_at
      ) VALUES (
        ${randomUUID()}::uuid,
        ${userRoleId}::uuid,
        ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)::geography,
        ${noiseMeters}, ${noiseMeters}, true, ${visibleUntil}, NOW(), NOW()
      )
      ON CONFLICT (user_role_id) DO UPDATE SET
        public_point = EXCLUDED.public_point,
        public_radius_meters = EXCLUDED.public_radius_meters,
        location_noise_meters = EXCLUDED.location_noise_meters,
        is_visible = true,
        visible_until = EXCLUDED.visible_until,
        updated_at = NOW()
    `;
  }

  async nearby(
    actorUserId: string,
    actorRoleId: string,
    query: DiscoveryQueryDto,
    maxRadiusKm: number,
  ) {
    const origin = await this.currentExact(actorUserId);
    if (!origin) return { items: [], nextCursor: null };
    const radiusKm = Math.min(query.radiusKm ?? 20, maxRadiusKm);
    const cursor = decodeCursor<{ distanceMeters: number; userRoleId: string }>(query.cursor);
    const roleFilter = Prisma.sql`r.code = ${query.targetRole}::"RoleCode"`;
    const serviceMode = query.targetRole === RoleCode.PHOTOGRAPHER ? 'OFFERED' : 'WANTED';
    const serviceFilter = query.serviceIds?.length
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM user_role_services urs
          WHERE urs.user_role_id = ur.id AND urs.service_id IN (${Prisma.join(query.serviceIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND urs.is_active = true
          AND urs.service_mode = ${serviceMode}::"ServiceMode"
        )`
      : Prisma.empty;
    const priceFilter = Prisma.sql`
      ${query.minPrice === undefined ? Prisma.empty : Prisma.sql`AND EXISTS (SELECT 1 FROM user_role_services pmin WHERE pmin.user_role_id = ur.id AND pmin.is_active = true AND pmin.service_mode = ${serviceMode}::"ServiceMode" AND pmin.max_price >= ${query.minPrice})`}
      ${query.maxPrice === undefined ? Prisma.empty : Prisma.sql`AND EXISTS (SELECT 1 FROM user_role_services pmax WHERE pmax.user_role_id = ur.id AND pmax.is_active = true AND pmax.service_mode = ${serviceMode}::"ServiceMode" AND pmax.min_price <= ${query.maxPrice})`}
    `;
    const availabilityFilter = query.availableOnly
      ? Prisma.sql`AND pp.availability_status = 'AVAILABLE'::"PhotographerAvailabilityStatus"`
      : Prisma.empty;
    const verificationFilter = query.verifiedOnly
      ? Prisma.sql`AND u.identity_verification_status = 'VERIFIED'::"IdentityVerificationStatus"`
      : Prisma.empty;
    const cursorFilter = cursor
      ? Prisma.sql`AND (
          ST_Distance(dp.public_point, ST_SetSRID(ST_MakePoint(${origin.longitude}, ${origin.latitude}), 4326)::geography) > ${cursor.distanceMeters}
          OR (
            ST_Distance(dp.public_point, ST_SetSRID(ST_MakePoint(${origin.longitude}, ${origin.latitude}), 4326)::geography) = ${cursor.distanceMeters}
            AND ur.id > ${cursor.userRoleId}::uuid
          )
        )`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<NearbyRow[]>(Prisma.sql`
      SELECT
        ur.id AS "userRoleId",
        u.id AS "userId",
        up.display_name AS "displayName",
        up.avatar_asset_id AS "avatarAssetId",
        pp.headline,
        pp.availability_status::text AS "availabilityStatus",
        u.identity_verification_status::text AS "identityVerificationStatus",
        ST_Distance(
          dp.public_point,
          ST_SetSRID(ST_MakePoint(${origin.longitude}, ${origin.latitude}), 4326)::geography
        )::double precision AS "distanceMeters"
      FROM discovery_presence dp
      JOIN user_roles ur ON ur.id = dp.user_role_id
      JOIN roles r ON r.id = ur.role_id
      JOIN users u ON u.id = ur.user_id
      JOIN user_profiles up ON up.user_id = u.id
      LEFT JOIN photographer_profiles pp ON pp.user_role_id = ur.id
      WHERE ${roleFilter}
        AND ur.id <> ${actorRoleId}::uuid
        AND ur.status = 'ACTIVE'::"RoleStatus"
        AND u.account_status = 'ACTIVE'::"AccountStatus"
        AND up.status = 'ACTIVE'::"ProfileStatus"
        AND dp.is_visible = true
        AND dp.visible_until > NOW()
        AND ST_DWithin(
          dp.public_point,
          ST_SetSRID(ST_MakePoint(${origin.longitude}, ${origin.latitude}), 4326)::geography,
          ${radiusKm * 1000}
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_user_id = ${actorUserId}::uuid AND ub.blocked_user_id = u.id)
             OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ${actorUserId}::uuid)
        )
        AND NOT EXISTS (
          SELECT 1 FROM swipes s
          WHERE s.actor_user_role_id = ${actorRoleId}::uuid
            AND s.target_user_role_id = ur.id
            AND s.direction IN ('LEFT'::"SwipeDirection", 'REJECT'::"SwipeDirection")
            AND s.effective_until > NOW()
        )
        ${serviceFilter}
        ${priceFilter}
        ${availabilityFilter}
        ${verificationFilter}
        ${cursorFilter}
      ORDER BY "distanceMeters" ASC, ur.id ASC
      LIMIT ${query.limit + 1}
    `);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        userRoleId: row.userRoleId,
        displayName: row.displayName,
        avatarAssetId: row.avatarAssetId,
        headline: row.headline,
        availabilityStatus: row.availabilityStatus,
        identityVerificationStatus: row.identityVerificationStatus,
        distance: distanceBucket(row.distanceMeters),
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({ distanceMeters: last.distanceMeters, userRoleId: last.userRoleId })
          : null,
    };
  }

  async discover(actorUserId: string, actorRoleId: string, query: DiscoveryQueryDto) {
    const cursor = decodeCursor<{ updatedAt: string; userRoleId: string }>(query.cursor);
    const roleFilter = Prisma.sql`r.code = ${query.targetRole}::"RoleCode"`;
    const serviceMode = query.targetRole === RoleCode.PHOTOGRAPHER ? 'OFFERED' : 'WANTED';
    const serviceFilter = query.serviceIds?.length
      ? Prisma.sql`AND EXISTS (
          SELECT 1
          FROM user_role_services urs
          JOIN services service_filter_catalog ON service_filter_catalog.id = urs.service_id
          WHERE urs.user_role_id = ur.id
            AND urs.service_id IN (${Prisma.join(query.serviceIds.map((id) => Prisma.sql`${id}::uuid`))})
            AND urs.is_active = true
            AND urs.service_mode = ${serviceMode}::"ServiceMode"
            AND service_filter_catalog.status = 'ACTIVE'::"CatalogStatus"
        )`
      : Prisma.empty;
    const priceFilter = Prisma.sql`
      ${
        query.minPrice === undefined
          ? Prisma.empty
          : Prisma.sql`AND EXISTS (
              SELECT 1 FROM user_role_services pmin
              WHERE pmin.user_role_id = ur.id
                AND pmin.is_active = true
                AND pmin.service_mode = ${serviceMode}::"ServiceMode"
                AND pmin.max_price >= ${query.minPrice}
            )`
      }
      ${
        query.maxPrice === undefined
          ? Prisma.empty
          : Prisma.sql`AND EXISTS (
              SELECT 1 FROM user_role_services pmax
              WHERE pmax.user_role_id = ur.id
                AND pmax.is_active = true
                AND pmax.service_mode = ${serviceMode}::"ServiceMode"
                AND pmax.min_price <= ${query.maxPrice}
            )`
      }
    `;
    const availabilityFilter = query.availableOnly
      ? Prisma.sql`AND pp.availability_status = 'AVAILABLE'::"PhotographerAvailabilityStatus"`
      : Prisma.empty;
    const verificationFilter = query.verifiedOnly
      ? Prisma.sql`AND u.identity_verification_status = 'VERIFIED'::"IdentityVerificationStatus"`
      : Prisma.empty;
    const photographerEligibilityFilter =
      query.targetRole === RoleCode.PHOTOGRAPHER
        ? Prisma.sql`
            AND pp.user_role_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM user_role_services eligible_service
              JOIN services eligible_catalog ON eligible_catalog.id = eligible_service.service_id
              WHERE eligible_service.user_role_id = ur.id
                AND eligible_service.service_mode = 'OFFERED'::"ServiceMode"
                AND eligible_service.is_active = true
                AND eligible_service.min_price IS NOT NULL
                AND eligible_service.max_price IS NOT NULL
                AND eligible_service.currency = 'VND'
                AND eligible_catalog.status = 'ACTIVE'::"CatalogStatus"
            )
            AND (
              SELECT COUNT(*)
              FROM portfolio_items eligible_portfolio
              JOIN upload_assets eligible_asset ON eligible_asset.id = eligible_portfolio.asset_id
              WHERE eligible_portfolio.user_role_id = ur.id
                AND eligible_portfolio.deleted_at IS NULL
                AND eligible_asset.status = 'USABLE'::"UploadAssetStatus"
            ) >= 6
          `
        : Prisma.empty;
    const cursorFilter = cursor
      ? Prisma.sql`AND (
          up.updated_at < ${new Date(cursor.updatedAt)}
          OR (up.updated_at = ${new Date(cursor.updatedAt)} AND ur.id > ${cursor.userRoleId}::uuid)
        )`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<DiscoveryRow[]>(Prisma.sql`
      SELECT
        ur.id AS "userRoleId",
        u.id AS "userId",
        up.display_name AS "displayName",
        up.avatar_asset_id AS "avatarAssetId",
        pp.headline,
        pp.availability_status::text AS "availabilityStatus",
        u.identity_verification_status::text AS "identityVerificationStatus",
        up.updated_at AS "updatedAt"
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN users u ON u.id = ur.user_id
      JOIN user_profiles up ON up.user_id = u.id
      JOIN user_settings settings ON settings.user_id = u.id
      LEFT JOIN photographer_profiles pp ON pp.user_role_id = ur.id
      WHERE ${roleFilter}
        AND ur.id <> ${actorRoleId}::uuid
        AND ur.status = 'ACTIVE'::"RoleStatus"
        AND u.account_status = 'ACTIVE'::"AccountStatus"
        AND up.status = 'ACTIVE'::"ProfileStatus"
        AND settings.profile_visibility_enabled = true
        AND NOT EXISTS (
          SELECT 1 FROM account_penalties penalty
          WHERE penalty.user_id = u.id
            AND penalty.status = 'ACTIVE'::"PenaltyStatus"
            AND penalty.starts_at <= NOW()
            AND (penalty.ends_at IS NULL OR penalty.ends_at > NOW())
        )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_user_id = ${actorUserId}::uuid AND ub.blocked_user_id = u.id)
             OR (ub.blocker_user_id = u.id AND ub.blocked_user_id = ${actorUserId}::uuid)
        )
        AND NOT EXISTS (
          SELECT 1 FROM swipes s
          WHERE s.actor_user_role_id = ${actorRoleId}::uuid
            AND s.target_user_role_id = ur.id
            AND s.direction IN ('LEFT'::"SwipeDirection", 'REJECT'::"SwipeDirection")
            AND s.effective_until > NOW()
        )
        ${photographerEligibilityFilter}
        ${serviceFilter}
        ${priceFilter}
        ${availabilityFilter}
        ${verificationFilter}
        ${cursorFilter}
      ORDER BY up.updated_at DESC, ur.id ASC
      LIMIT ${query.limit + 1}
    `);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        userRoleId: row.userRoleId,
        displayName: row.displayName,
        avatarAssetId: row.avatarAssetId,
        headline: row.headline,
        availabilityStatus: row.availabilityStatus,
        identityVerificationStatus: row.identityVerificationStatus,
        distance: null,
      })),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              updatedAt: last.updatedAt.toISOString(),
              userRoleId: last.userRoleId,
            })
          : null,
    };
  }
}

function distanceBucket(meters: number): string {
  if (meters < 1000) return '<1 km';
  if (meters < 3000) return '1-3 km';
  if (meters < 5000) return '3-5 km';
  if (meters < 10_000) return '5-10 km';
  if (meters < 20_000) return '10-20 km';
  if (meters < 50_000) return '20-50 km';
  return '50+ km';
}
