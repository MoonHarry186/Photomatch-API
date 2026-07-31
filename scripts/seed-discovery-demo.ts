import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  AccountStatus,
  CatalogStatus,
  IdentityVerificationStatus,
  PhotographerAvailabilityStatus,
  Prisma,
  PrismaClient,
  ProfileStatus,
  RoleCode,
  RoleStatus,
  ServiceMode,
  UploadAssetStatus,
  UploadIntentStatus,
  UploadPurpose,
} from '@prisma/client';

const DEMO_EMAIL_SUFFIX = '@discovery-demo.photomatch.test';
const PORTFOLIO_ITEMS_PER_PHOTOGRAPHER = 6;
const PORTFOLIO_PLACEHOLDER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const idGroups = {
  user: '92000000',
  profile: '92000001',
  customerRole: '92000002',
  photographerRole: '92000003',
  photographerProfile: '92000004',
  serviceSelection: '92000005',
  uploadIntent: '92000006',
  uploadAsset: '92000007',
  portfolioItem: '92000008',
  presence: '92000009',
} as const;

export const discoveryDemoFixtures = [
  {
    displayName: 'Minh Anh',
    headline: 'Nhiếp ảnh cưới và chân dung giàu cảm xúc',
    bio: 'Theo đuổi phong cách tự nhiên, tinh tế và ưu tiên những khoảnh khắc chân thật.',
    cityCode: 'HO_CHI_MINH',
    serviceCodes: ['PRE_WEDDING', 'PERSONAL_PORTRAIT'],
    minPrice: 1_500_000,
    maxPrice: 6_000_000,
    latitude: 10.7769,
    longitude: 106.7009,
    yearsExperience: 7,
  },
  {
    displayName: 'Quang Huy',
    headline: 'Chân dung cá nhân và hồ sơ chuyên nghiệp',
    bio: 'Studio portrait, personal branding và headshot dành cho cá nhân, đội ngũ.',
    cityCode: 'HO_CHI_MINH',
    serviceCodes: ['PERSONAL_PORTRAIT', 'PROFESSIONAL_HEADSHOT'],
    minPrice: 900_000,
    maxPrice: 3_500_000,
    latitude: 10.782,
    longitude: 106.693,
    yearsExperience: 5,
  },
  {
    displayName: 'Lan Chi',
    headline: 'Ảnh gia đình, mẹ bầu và trẻ nhỏ',
    bio: 'Không gian chụp nhẹ nhàng, thân thiện với trẻ em và gia đình nhiều thế hệ.',
    cityCode: 'HO_CHI_MINH',
    serviceCodes: ['FAMILY_SESSION', 'MATERNITY_NEWBORN'],
    minPrice: 1_200_000,
    maxPrice: 4_500_000,
    latitude: 10.801,
    longitude: 106.711,
    yearsExperience: 6,
  },
  {
    displayName: 'Gia Bảo',
    headline: 'Food và product photography cho thương hiệu',
    bio: 'Tập trung hình ảnh thương mại, menu nhà hàng và sản phẩm thương mại điện tử.',
    cityCode: 'HO_CHI_MINH',
    serviceCodes: ['FOOD_MENU', 'PRODUCT_STUDIO'],
    minPrice: 2_000_000,
    maxPrice: 8_000_000,
    latitude: 10.758,
    longitude: 106.704,
    yearsExperience: 8,
  },
  {
    displayName: 'Thanh Hà',
    headline: 'Fashion editorial và lookbook hiện đại',
    bio: 'Đồng hành cùng local brand từ concept, ánh sáng đến hậu kỳ hình ảnh.',
    cityCode: 'HO_CHI_MINH',
    serviceCodes: ['FASHION_EDITORIAL', 'FASHION_LOOKBOOK'],
    minPrice: 2_500_000,
    maxPrice: 10_000_000,
    latitude: 10.789,
    longitude: 106.721,
    yearsExperience: 9,
  },
  {
    displayName: 'Khánh Linh',
    headline: 'Phóng sự cưới tự nhiên và gần gũi',
    bio: 'Kể câu chuyện ngày cưới bằng những khoảnh khắc đời thường và giàu cảm xúc.',
    cityCode: 'HO_CHI_MINH',
    serviceCodes: ['WEDDING_DAY', 'PRE_WEDDING'],
    minPrice: 4_000_000,
    maxPrice: 18_000_000,
    latitude: 10.77,
    longitude: 106.68,
    yearsExperience: 10,
  },
  {
    displayName: 'Hoàng Nam',
    headline: 'Kiến trúc, nội thất và hồ sơ doanh nghiệp',
    bio: 'Hình ảnh rõ ràng, chính xác dành cho dự án kiến trúc và truyền thông doanh nghiệp.',
    cityCode: 'HA_NOI',
    serviceCodes: ['REAL_ESTATE_INTERIOR', 'CORPORATE_PROFILE'],
    minPrice: 2_200_000,
    maxPrice: 9_000_000,
    latitude: 21.0278,
    longitude: 105.8342,
    yearsExperience: 8,
  },
  {
    displayName: 'Mai Phương',
    headline: 'Lifestyle, du lịch và câu chuyện điểm đến',
    bio: 'Yêu ánh sáng tự nhiên, không gian ngoài trời và những câu chuyện địa phương.',
    cityCode: 'HA_NOI',
    serviceCodes: ['TRAVEL_LIFESTYLE', 'PERSONAL_PORTRAIT'],
    minPrice: 1_800_000,
    maxPrice: 7_000_000,
    latitude: 21.034,
    longitude: 105.842,
    yearsExperience: 6,
  },
] as const;

export function discoveryDemoId(group: keyof typeof idGroups, sequence: number): string {
  return `${idGroups[group]}-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

async function main() {
  assertLocalDependencies();
  const prisma = new PrismaClient();
  try {
    const catalog = await loadCatalog(prisma);
    await uploadPortfolioPlaceholders();
    await prisma.$transaction(
      async (tx) => {
        for (const [fixtureIndex, fixture] of discoveryDemoFixtures.entries()) {
          await seedPhotographer(tx, catalog, fixtureIndex + 1, fixture);
        }
      },
      { timeout: 60_000 },
    );
    const summary = await verifySeed(prisma);
    console.log('Discovery demo seed completed:', summary);
  } finally {
    await prisma.$disconnect();
  }
}

type Catalog = Awaited<ReturnType<typeof loadCatalog>>;
type DiscoveryFixture = (typeof discoveryDemoFixtures)[number];

async function loadCatalog(prisma: PrismaClient) {
  const serviceCodes = [...new Set(discoveryDemoFixtures.flatMap((item) => item.serviceCodes))];
  const cityCodes = [...new Set(discoveryDemoFixtures.map((item) => item.cityCode))];
  const [customerRole, photographerRole, services, cities] = await Promise.all([
    prisma.role.findUnique({ where: { code: RoleCode.CUSTOMER } }),
    prisma.role.findUnique({ where: { code: RoleCode.PHOTOGRAPHER } }),
    prisma.service.findMany({
      where: { code: { in: serviceCodes }, status: CatalogStatus.ACTIVE },
      include: { activityField: true },
    }),
    prisma.city.findMany({
      where: { code: { in: cityCodes }, status: CatalogStatus.ACTIVE },
    }),
  ]);
  if (!customerRole || !photographerRole) {
    throw new Error('Baseline roles are missing. Run `npm run seed` first.');
  }
  if (services.length !== serviceCodes.length) {
    const found = new Set(services.map((service) => service.code));
    throw new Error(
      `Missing active services: ${serviceCodes.filter((code) => !found.has(code)).join(', ')}`,
    );
  }
  if (cities.length !== cityCodes.length) {
    const found = new Set(cities.map((city) => city.code));
    throw new Error(
      `Missing active cities: ${cityCodes.filter((code) => !found.has(code)).join(', ')}`,
    );
  }
  return {
    customerRole,
    photographerRole,
    servicesByCode: new Map(services.map((service) => [service.code, service])),
    citiesByCode: new Map(cities.map((city) => [city.code, city])),
  };
}

async function seedPhotographer(
  tx: Prisma.TransactionClient,
  catalog: Catalog,
  sequence: number,
  fixture: DiscoveryFixture,
) {
  const now = new Date();
  const userId = discoveryDemoId('user', sequence);
  const profileId = discoveryDemoId('profile', sequence);
  const customerRoleId = discoveryDemoId('customerRole', sequence);
  const photographerRoleId = discoveryDemoId('photographerRole', sequence);
  const city = catalog.citiesByCode.get(fixture.cityCode)!;
  const email = `photographer-${String(sequence).padStart(2, '0')}${DEMO_EMAIL_SUFFIX}`;

  await tx.user.upsert({
    where: { email },
    create: {
      id: userId,
      email,
      accountStatus: AccountStatus.ACTIVE,
      identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
      emailVerified: true,
      onboardingCompletedAt: now,
    },
    update: {
      accountStatus: AccountStatus.ACTIVE,
      identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
      emailVerified: true,
      onboardingCompletedAt: now,
      deletedAt: null,
    },
  });
  await tx.userProfile.upsert({
    where: { userId },
    create: {
      id: profileId,
      userId,
      cityId: city.id,
      displayName: fixture.displayName,
      dateOfBirth: new Date(Date.UTC(1990 + (sequence % 8), sequence % 12, 10 + sequence)),
      bio: fixture.bio,
      status: ProfileStatus.ACTIVE,
    },
    update: {
      cityId: city.id,
      displayName: fixture.displayName,
      dateOfBirth: new Date(Date.UTC(1990 + (sequence % 8), sequence % 12, 10 + sequence)),
      bio: fixture.bio,
      status: ProfileStatus.ACTIVE,
    },
  });
  await tx.userSettings.upsert({
    where: { userId },
    create: { userId, profileVisibilityEnabled: true },
    update: { profileVisibilityEnabled: true },
  });
  await tx.userRole.upsert({
    where: { userId_roleId: { userId, roleId: catalog.customerRole.id } },
    create: {
      id: customerRoleId,
      userId,
      roleId: catalog.customerRole.id,
      status: RoleStatus.ACTIVE,
    },
    update: { status: RoleStatus.ACTIVE },
  });
  await tx.userRole.upsert({
    where: { userId_roleId: { userId, roleId: catalog.photographerRole.id } },
    create: {
      id: photographerRoleId,
      userId,
      roleId: catalog.photographerRole.id,
      status: RoleStatus.ACTIVE,
      isInitialAdditionalRole: true,
    },
    update: { status: RoleStatus.ACTIVE, isInitialAdditionalRole: true },
  });
  await tx.user.update({
    where: { id: userId },
    data: { currentRoleId: photographerRoleId },
  });
  await tx.photographerProfile.upsert({
    where: { userRoleId: photographerRoleId },
    create: {
      id: discoveryDemoId('photographerProfile', sequence),
      userRoleId: photographerRoleId,
      availabilityStatus: PhotographerAvailabilityStatus.AVAILABLE,
      headline: fixture.headline,
      yearsExperience: fixture.yearsExperience,
    },
    update: {
      availabilityStatus: PhotographerAvailabilityStatus.AVAILABLE,
      headline: fixture.headline,
      yearsExperience: fixture.yearsExperience,
    },
  });

  for (const [serviceIndex, serviceCode] of fixture.serviceCodes.entries()) {
    const service = catalog.servicesByCode.get(serviceCode)!;
    await tx.userRoleField.upsert({
      where: {
        userRoleId_activityFieldId: {
          userRoleId: photographerRoleId,
          activityFieldId: service.activityFieldId,
        },
      },
      create: {
        userRoleId: photographerRoleId,
        activityFieldId: service.activityFieldId,
      },
      update: {},
    });
    await tx.userRoleService.upsert({
      where: {
        userRoleId_serviceId_serviceMode: {
          userRoleId: photographerRoleId,
          serviceId: service.id,
          serviceMode: ServiceMode.OFFERED,
        },
      },
      create: {
        id: discoveryDemoId('serviceSelection', sequence * 10 + serviceIndex + 1),
        userRoleId: photographerRoleId,
        serviceId: service.id,
        serviceMode: ServiceMode.OFFERED,
        minPrice: fixture.minPrice,
        maxPrice: fixture.maxPrice,
        currency: 'VND',
        priceUnit: 'buổi',
        isActive: true,
      },
      update: {
        minPrice: fixture.minPrice,
        maxPrice: fixture.maxPrice,
        currency: 'VND',
        priceUnit: 'buổi',
        isActive: true,
      },
    });
  }

  const primaryService = catalog.servicesByCode.get(fixture.serviceCodes[0])!;
  for (let index = 1; index <= PORTFOLIO_ITEMS_PER_PHOTOGRAPHER; index += 1) {
    const childSequence = sequence * 100 + index;
    const objectKey = portfolioObjectKey(sequence, index);
    const uploadIntentId = discoveryDemoId('uploadIntent', childSequence);
    const assetId = discoveryDemoId('uploadAsset', childSequence);
    await tx.uploadIntent.upsert({
      where: { id: uploadIntentId },
      create: {
        id: uploadIntentId,
        ownerUserId: userId,
        purpose: UploadPurpose.PORTFOLIO,
        objectKey,
        mimeType: 'image/png',
        extension: 'png',
        expectedSizeBytes: BigInt(PORTFOLIO_PLACEHOLDER.length),
        status: UploadIntentStatus.COMPLETED,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        completedAt: now,
      },
      update: {
        status: UploadIntentStatus.COMPLETED,
        completedAt: now,
      },
    });
    await tx.uploadAsset.upsert({
      where: { id: assetId },
      create: {
        id: assetId,
        uploadIntentId,
        ownerUserId: userId,
        purpose: UploadPurpose.PORTFOLIO,
        objectKey,
        mimeType: 'image/png',
        sizeBytes: BigInt(PORTFOLIO_PLACEHOLDER.length),
        status: UploadAssetStatus.USABLE,
        isPublic: true,
        attachedAt: now,
      },
      update: {
        status: UploadAssetStatus.USABLE,
        isPublic: true,
        attachedAt: now,
        removedAt: null,
      },
    });
    await tx.portfolioItem.upsert({
      where: { id: discoveryDemoId('portfolioItem', childSequence) },
      create: {
        id: discoveryDemoId('portfolioItem', childSequence),
        userRoleId: photographerRoleId,
        serviceId: primaryService.id,
        assetId,
        title: `${fixture.displayName} · Portfolio ${index}`,
        description: 'Dữ liệu minh họa cho luồng Discovery local.',
        sortOrder: index - 1,
      },
      update: {
        serviceId: primaryService.id,
        title: `${fixture.displayName} · Portfolio ${index}`,
        description: 'Dữ liệu minh họa cho luồng Discovery local.',
        sortOrder: index - 1,
        deletedAt: null,
      },
    });
  }

  const visibleUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  await tx.$executeRaw`
    INSERT INTO discovery_presence (
      id, user_role_id, public_point, public_radius_meters, location_noise_meters,
      is_visible, visible_until, created_at, updated_at
    ) VALUES (
      ${discoveryDemoId('presence', sequence)}::uuid,
      ${photographerRoleId}::uuid,
      ST_SetSRID(ST_MakePoint(${fixture.longitude}, ${fixture.latitude}), 4326)::geography,
      500, 500, true, ${visibleUntil}, NOW(), NOW()
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

async function uploadPortfolioPlaceholders() {
  const endpoint = process.env.R2_ENDPOINT!;
  const client = new S3Client({
    endpoint,
    region: process.env.R2_REGION!,
    forcePathStyle: process.env.R2_FORCE_PATH_STYLE === 'true',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const bucket = process.env.R2_BUCKET!;
  await Promise.all(
    discoveryDemoFixtures.flatMap((_fixture, fixtureIndex) =>
      Array.from({ length: PORTFOLIO_ITEMS_PER_PHOTOGRAPHER }, (_, portfolioIndex) =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: portfolioObjectKey(fixtureIndex + 1, portfolioIndex + 1),
            Body: PORTFOLIO_PLACEHOLDER,
            ContentType: 'image/png',
          }),
        ),
      ),
    ),
  );
}

async function verifySeed(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ eligibleCount: bigint }[]>`
    SELECT COUNT(*)::bigint AS "eligibleCount"
    FROM user_roles ur
    JOIN roles role_catalog ON role_catalog.id = ur.role_id
    JOIN users users_seeded ON users_seeded.id = ur.user_id
    JOIN user_profiles profile_seeded ON profile_seeded.user_id = users_seeded.id
    JOIN user_settings settings_seeded ON settings_seeded.user_id = users_seeded.id
    JOIN photographer_profiles photographer_seeded ON photographer_seeded.user_role_id = ur.id
    WHERE users_seeded.email LIKE ${`%${DEMO_EMAIL_SUFFIX}`}
      AND role_catalog.code = 'PHOTOGRAPHER'::"RoleCode"
      AND ur.status = 'ACTIVE'::"RoleStatus"
      AND users_seeded.account_status = 'ACTIVE'::"AccountStatus"
      AND profile_seeded.status = 'ACTIVE'::"ProfileStatus"
      AND settings_seeded.profile_visibility_enabled = true
      AND EXISTS (
        SELECT 1
        FROM user_role_services service_seeded
        WHERE service_seeded.user_role_id = ur.id
          AND service_seeded.service_mode = 'OFFERED'::"ServiceMode"
          AND service_seeded.is_active = true
          AND service_seeded.min_price IS NOT NULL
          AND service_seeded.max_price IS NOT NULL
          AND service_seeded.currency = 'VND'
      )
      AND (
        SELECT COUNT(*)
        FROM portfolio_items portfolio_seeded
        JOIN upload_assets asset_seeded ON asset_seeded.id = portfolio_seeded.asset_id
        WHERE portfolio_seeded.user_role_id = ur.id
          AND portfolio_seeded.deleted_at IS NULL
          AND asset_seeded.status = 'USABLE'::"UploadAssetStatus"
      ) >= ${PORTFOLIO_ITEMS_PER_PHOTOGRAPHER}
  `;
  const eligiblePhotographers = Number(rows[0]?.eligibleCount ?? 0);
  if (eligiblePhotographers !== discoveryDemoFixtures.length) {
    throw new Error(
      `Discovery seed verification found ${eligiblePhotographers}/${discoveryDemoFixtures.length} eligible photographers.`,
    );
  }
  return {
    eligiblePhotographers,
    portfolioItems: eligiblePhotographers * PORTFOLIO_ITEMS_PER_PHOTOGRAPHER,
    cities: [...new Set(discoveryDemoFixtures.map((fixture) => fixture.cityCode))],
  };
}

function portfolioObjectKey(sequence: number, portfolioIndex: number): string {
  return `discovery-demo/photographer-${String(sequence).padStart(2, '0')}/portfolio-${portfolioIndex}.png`;
}

function assertLocalDependencies() {
  for (const name of [
    'DATABASE_URL',
    'R2_ENDPOINT',
    'R2_REGION',
    'R2_BUCKET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ]) {
    if (!process.env[name]) throw new Error(`${name} is required`);
  }
  assertLocalUrl('DATABASE_URL', process.env.DATABASE_URL!);
  assertLocalUrl('R2_ENDPOINT', process.env.R2_ENDPOINT!);
}

function assertLocalUrl(name: string, value: string) {
  const host = new URL(value).hostname;
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'minio']);
  if (!localHosts.has(host)) {
    throw new Error(`${name} must target a local service; received host "${host}"`);
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(
      `Discovery demo seed failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  });
}
