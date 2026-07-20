import {
  AccountStatus,
  PhotographerAvailabilityStatus,
  Prisma,
  ProfileStatus,
  RoleCode,
} from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { PrismaService } from '../../src/database/prisma.service';
import { DiscoveryQueryDto } from '../../src/discovery/discovery.dto';
import { LocationRepository } from '../../src/discovery/location.repository';

const ACTOR_USER_ID = '98000000-0000-4000-8000-000000000001';
const ACTOR_ROLE_ID = '98100000-0000-4000-8000-000000000001';
const PERFORMANCE_EMAIL_SUFFIX = '@discovery-performance.test';
const CANDIDATE_COUNT = 1_000;

describe('discovery spatial query plan and performance (integration)', () => {
  let prisma: PrismaService;
  let locations: LocationRepository;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    locations = new LocationRepository(prisma);
    await cleanup(prisma);
    await seedVolume(prisma);
  }, 60_000);

  afterAll(async () => {
    await cleanup(prisma);
    await prisma.$disconnect();
  }, 60_000);

  it('uses the public-point GiST index for representative radius filtering', async () => {
    const planRows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<Array<Record<'QUERY PLAN', string>>>(Prisma.sql`
        EXPLAIN (FORMAT TEXT)
        SELECT dp.user_role_id
        FROM discovery_presence dp
        WHERE dp.is_visible = true
          AND dp.visible_until > NOW()
          AND ST_DWithin(
            dp.public_point,
            ST_SetSRID(ST_MakePoint(105.8342, 21.0278), 4326)::geography,
            20000
          )
        ORDER BY ST_Distance(
          dp.public_point,
          ST_SetSRID(ST_MakePoint(105.8342, 21.0278), 4326)::geography
        )
        LIMIT 51
      `);
    });
    const plan = planRows.map((row) => row['QUERY PLAN']).join('\n');
    expect(plan).toContain('discovery_presence_public_point_gist_idx');
  });

  it('keeps privacy-safe discovery P95 below one second at seeded MVP volume', async () => {
    const query: DiscoveryQueryDto = {
      targetRole: RoleCode.PHOTOGRAPHER,
      radiusKm: 20,
      limit: 50,
      availableOnly: true,
    };
    for (let index = 0; index < 3; index += 1) {
      await locations.nearby(ACTOR_USER_ID, ACTOR_ROLE_ID, query, 100);
    }

    const durations: number[] = [];
    let lastResult: Awaited<ReturnType<LocationRepository['nearby']>> | undefined;
    for (let index = 0; index < 30; index += 1) {
      const startedAt = performance.now();
      lastResult = await locations.nearby(ACTOR_USER_ID, ACTOR_ROLE_ID, query, 100);
      durations.push(performance.now() - startedAt);
    }
    const p95 = percentile(durations, 0.95);
    expect(lastResult?.items).toHaveLength(50);
    expect(lastResult?.nextCursor).not.toBeNull();
    for (const item of lastResult?.items ?? []) {
      expect(item).not.toHaveProperty('latitude');
      expect(item).not.toHaveProperty('longitude');
      expect(item).not.toHaveProperty('accuracyMeters');
      expect(item).not.toHaveProperty('locationId');
      expect(item.distance).toMatch(/^(<1 km|1-3 km|3-5 km|5-10 km|10-20 km|20-50 km|50\+ km)$/);
    }
    expect(p95).toBeLessThan(1_000);
  }, 15_000);
});

async function seedVolume(prisma: PrismaService): Promise<void> {
  const customerRole = await prisma.role.findUniqueOrThrow({ where: { code: RoleCode.CUSTOMER } });
  const photographerRole = await prisma.role.findUniqueOrThrow({
    where: { code: RoleCode.PHOTOGRAPHER },
  });
  const candidates = Array.from({ length: CANDIDATE_COUNT }, (_, index) => ({
    userId: candidateId('98000000', index + 2),
    userRoleId: candidateId('98100000', index + 2),
    profileId: candidateId('98200000', index + 2),
    presenceId: candidateId('98300000', index + 2),
    email: `candidate-${index + 1}${PERFORMANCE_EMAIL_SUFFIX}`,
  }));

  await prisma.user.createMany({
    data: [
      {
        id: ACTOR_USER_ID,
        email: `actor${PERFORMANCE_EMAIL_SUFFIX}`,
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      ...candidates.map((candidate) => ({
        id: candidate.userId,
        email: candidate.email,
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
      })),
    ],
  });
  await prisma.userProfile.createMany({
    data: [
      {
        id: '98200000-0000-4000-8000-000000000001',
        userId: ACTOR_USER_ID,
        displayName: 'Performance Actor',
        status: ProfileStatus.ACTIVE,
      },
      ...candidates.map((candidate, index) => ({
        id: candidate.profileId,
        userId: candidate.userId,
        displayName: `Performance Photographer ${index + 1}`,
        status: ProfileStatus.ACTIVE,
      })),
    ],
  });
  await prisma.userRole.createMany({
    data: [
      { id: ACTOR_ROLE_ID, userId: ACTOR_USER_ID, roleId: customerRole.id },
      ...candidates.map((candidate) => ({
        id: candidate.userRoleId,
        userId: candidate.userId,
        roleId: photographerRole.id,
      })),
    ],
  });
  await prisma.user.update({
    where: { id: ACTOR_USER_ID },
    data: { currentRoleId: ACTOR_ROLE_ID },
  });
  await prisma.photographerProfile.createMany({
    data: candidates.map((candidate) => ({
      userRoleId: candidate.userRoleId,
      availabilityStatus: PhotographerAvailabilityStatus.AVAILABLE,
    })),
  });
  await prisma.$executeRaw`
    INSERT INTO user_locations
      (id, user_id, exact_point, accuracy_meters, is_current, captured_at, created_at)
    VALUES
      ('98400000-0000-4000-8000-000000000001'::uuid, ${ACTOR_USER_ID}::uuid,
       ST_SetSRID(ST_MakePoint(105.8342, 21.0278), 4326)::geography,
       5, true, NOW(), NOW())
  `;
  const presenceRows = candidates.map((candidate, index) => {
    const latitude = 21.0278 + (index % 25) * 0.001;
    const longitude = 105.8342 + (Math.floor(index / 25) % 40) * 0.001;
    return Prisma.sql`(
      ${candidate.presenceId}::uuid,
      ${candidate.userRoleId}::uuid,
      ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
      500,
      500,
      true,
      NOW() + INTERVAL '24 hours',
      NOW(),
      NOW()
    )`;
  });
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO discovery_presence (
      id, user_role_id, public_point, public_radius_meters, location_noise_meters,
      is_visible, visible_until, created_at, updated_at
    ) VALUES ${Prisma.join(presenceRows)}
  `);
}

function candidateId(prefix: string, sequence: number): string {
  return `${prefix}-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

function percentile(values: number[], percentileValue: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * percentileValue) - 1)];
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.user.deleteMany({
    where: { email: { endsWith: PERFORMANCE_EMAIL_SUFFIX } },
  });
}
