import {
  CatalogStatus,
  LegalDocumentType,
  Prisma,
  PrismaClient,
  RoleCode,
  RoleStatus,
} from '@prisma/client';

const prisma = new PrismaClient();
type DatabaseClient = PrismaClient | Prisma.TransactionClient;

const ids = {
  roles: {
    customer: '10000000-0000-4000-8000-000000000001',
    photographer: '10000000-0000-4000-8000-000000000002',
    admin: '10000000-0000-4000-8000-000000000003',
  },
  cities: {
    hanoi: '20000000-0000-4000-8000-000000000001',
    hochiminh: '20000000-0000-4000-8000-000000000002',
    danang: '20000000-0000-4000-8000-000000000003',
  },
  fields: {
    portrait: '30000000-0000-4000-8000-000000000001',
    wedding: '30000000-0000-4000-8000-000000000002',
    family: '30000000-0000-4000-8000-000000000003',
    event: '30000000-0000-4000-8000-000000000004',
    fashion: '30000000-0000-4000-8000-000000000005',
    product: '30000000-0000-4000-8000-000000000006',
    food: '30000000-0000-4000-8000-000000000007',
    realEstate: '30000000-0000-4000-8000-000000000008',
    corporate: '30000000-0000-4000-8000-000000000009',
    pet: '30000000-0000-4000-8000-000000000010',
    sports: '30000000-0000-4000-8000-000000000011',
    travel: '30000000-0000-4000-8000-000000000012',
  },
};

const activityFields = [
  {
    id: ids.fields.portrait,
    code: 'PORTRAIT',
    name: 'Chụp chân dung',
    description: 'Chân dung cá nhân, hồ sơ nghề nghiệp và ảnh nghệ thuật.',
  },
  {
    id: ids.fields.wedding,
    code: 'WEDDING',
    name: 'Chụp cưới',
    description: 'Ảnh cưới, lễ đính hôn và các khoảnh khắc trong ngày cưới.',
  },
  {
    id: ids.fields.family,
    code: 'FAMILY',
    name: 'Gia đình và trẻ em',
    description: 'Ảnh gia đình, mẹ bầu, sơ sinh và trẻ em.',
  },
  {
    id: ids.fields.event,
    code: 'EVENT',
    name: 'Chụp sự kiện',
    description: 'Sự kiện cá nhân, cộng đồng và doanh nghiệp.',
  },
  {
    id: ids.fields.fashion,
    code: 'FASHION',
    name: 'Chụp thời trang',
    description: 'Lookbook, editorial và nội dung thời trang.',
  },
  {
    id: ids.fields.product,
    code: 'PRODUCT',
    name: 'Sản phẩm và quảng cáo',
    description: 'Ảnh sản phẩm, thương mại điện tử và chiến dịch quảng cáo.',
  },
  {
    id: ids.fields.food,
    code: 'FOOD',
    name: 'Chụp ẩm thực',
    description: 'Ảnh món ăn, thực đơn và nội dung nhà hàng.',
  },
  {
    id: ids.fields.realEstate,
    code: 'REAL_ESTATE',
    name: 'Kiến trúc và bất động sản',
    description: 'Ảnh nội thất, ngoại thất, kiến trúc và không gian.',
  },
  {
    id: ids.fields.corporate,
    code: 'CORPORATE',
    name: 'Doanh nghiệp và thương hiệu',
    description: 'Ảnh doanh nghiệp, đội ngũ và nội dung nhận diện thương hiệu.',
  },
  {
    id: ids.fields.pet,
    code: 'PET',
    name: 'Chụp thú cưng',
    description: 'Chân dung thú cưng và khoảnh khắc cùng chủ nuôi.',
  },
  {
    id: ids.fields.sports,
    code: 'SPORTS',
    name: 'Chụp thể thao',
    description: 'Thi đấu, luyện tập và các hoạt động ngoài trời.',
  },
  {
    id: ids.fields.travel,
    code: 'TRAVEL',
    name: 'Du lịch và phong cảnh',
    description: 'Ảnh du lịch, điểm đến, phong cảnh và trải nghiệm.',
  },
] as const;

const services = [
  ['PERSONAL_PORTRAIT', 'Chân dung cá nhân', ids.fields.portrait],
  ['PROFESSIONAL_HEADSHOT', 'Ảnh hồ sơ chuyên nghiệp', ids.fields.portrait],
  ['PRE_WEDDING', 'Ảnh cưới ngoại cảnh', ids.fields.wedding],
  ['WEDDING_DAY', 'Phóng sự ngày cưới', ids.fields.wedding],
  ['FAMILY_SESSION', 'Ảnh gia đình', ids.fields.family],
  ['MATERNITY_NEWBORN', 'Ảnh mẹ bầu và sơ sinh', ids.fields.family],
  ['PRIVATE_EVENT', 'Sự kiện cá nhân', ids.fields.event],
  ['CORPORATE_EVENT', 'Sự kiện doanh nghiệp', ids.fields.event],
  ['FASHION_EDITORIAL', 'Ảnh thời trang editorial', ids.fields.fashion],
  ['FASHION_LOOKBOOK', 'Ảnh lookbook', ids.fields.fashion],
  ['PRODUCT_STUDIO', 'Ảnh sản phẩm studio', ids.fields.product],
  ['ECOMMERCE_PRODUCT', 'Ảnh sản phẩm thương mại điện tử', ids.fields.product],
  ['FOOD_MENU', 'Ảnh món ăn và thực đơn', ids.fields.food],
  ['RESTAURANT_CONTENT', 'Nội dung hình ảnh nhà hàng', ids.fields.food],
  ['REAL_ESTATE_INTERIOR', 'Ảnh nội thất bất động sản', ids.fields.realEstate],
  ['ARCHITECTURE', 'Ảnh kiến trúc và ngoại thất', ids.fields.realEstate],
  ['CORPORATE_PROFILE', 'Ảnh hồ sơ doanh nghiệp', ids.fields.corporate],
  ['BRAND_CONTENT', 'Nội dung hình ảnh thương hiệu', ids.fields.corporate],
  ['PET_PORTRAIT', 'Chân dung thú cưng', ids.fields.pet],
  ['PET_LIFESTYLE', 'Ảnh thú cưng cùng chủ', ids.fields.pet],
  ['SPORTS_EVENT', 'Sự kiện thể thao', ids.fields.sports],
  ['ATHLETE_PORTRAIT', 'Chân dung vận động viên', ids.fields.sports],
  ['TRAVEL_LIFESTYLE', 'Ảnh du lịch và trải nghiệm', ids.fields.travel],
  ['LANDSCAPE', 'Ảnh phong cảnh', ids.fields.travel],
] as const;

async function seedRoles(db: DatabaseClient = prisma) {
  const roles = [
    { id: ids.roles.customer, code: RoleCode.CUSTOMER, name: 'Customer' },
    { id: ids.roles.photographer, code: RoleCode.PHOTOGRAPHER, name: 'Photographer' },
    { id: ids.roles.admin, code: RoleCode.ADMIN, name: 'Admin' },
  ];

  for (const role of roles) {
    await db.role.upsert({
      where: { code: role.code },
      create: { ...role, status: RoleStatus.ACTIVE },
      update: { name: role.name, status: RoleStatus.ACTIVE },
    });
  }
}

async function seedCatalog(db: DatabaseClient = prisma) {
  const cities = [
    { id: ids.cities.hanoi, code: 'HA_NOI', name: 'Ha Noi' },
    { id: ids.cities.hochiminh, code: 'HO_CHI_MINH', name: 'Ho Chi Minh' },
    { id: ids.cities.danang, code: 'DA_NANG', name: 'Da Nang' },
  ];
  for (const city of cities) {
    await db.city.upsert({
      where: { code: city.code },
      create: { ...city, status: CatalogStatus.ACTIVE },
      update: { name: city.name, status: CatalogStatus.ACTIVE },
    });
  }

  for (const field of activityFields) {
    const persistedField = await db.activityField.upsert({
      where: { code: field.code },
      create: { ...field, status: CatalogStatus.ACTIVE },
      update: {
        name: field.name,
        description: field.description,
        status: CatalogStatus.ACTIVE,
      },
    });
    await db.roleActivityField.upsert({
      where: {
        roleId_activityFieldId: {
          roleId: ids.roles.photographer,
          activityFieldId: persistedField.id,
        },
      },
      create: {
        roleId: ids.roles.photographer,
        activityFieldId: persistedField.id,
      },
      update: {},
    });
    await db.roleActivityField.upsert({
      where: {
        roleId_activityFieldId: {
          roleId: ids.roles.customer,
          activityFieldId: persistedField.id,
        },
      },
      create: {
        roleId: ids.roles.customer,
        activityFieldId: persistedField.id,
      },
      update: {},
    });
  }

  for (const [code, name, activityFieldId] of services) {
    await db.service.upsert({
      where: { code },
      create: { code, name, activityFieldId, status: CatalogStatus.ACTIVE },
      update: { name, activityFieldId, status: CatalogStatus.ACTIVE },
    });
  }
}

async function resetPhotoCatalog(db: Prisma.TransactionClient) {
  assertLocalDatabase();

  const [nonDemoBookings, shootRequests] = await Promise.all([
    db.booking.count({
      where: {
        service: {
          code: { not: { startsWith: 'ADMIN_DEMO_SERVICE_' } },
        },
      },
    }),
    db.shootRequest.count(),
  ]);

  if (nonDemoBookings > 0 || shootRequests > 0) {
    throw new Error(
      `Refusing to reset catalog: found ${nonDemoBookings} non-demo bookings and ${shootRequests} shoot requests`,
    );
  }

  const reviews = await db.review.deleteMany({
    where: {
      booking: {
        service: { code: { startsWith: 'ADMIN_DEMO_SERVICE_' } },
      },
    },
  });
  const bookings = await db.booking.deleteMany({
    where: {
      service: { code: { startsWith: 'ADMIN_DEMO_SERVICE_' } },
    },
  });
  await db.discoveryFilterService.deleteMany();
  const serviceSelections = await db.userRoleService.deleteMany();
  const removedServices = await db.service.deleteMany();
  const fieldSelections = await db.userRoleField.deleteMany();
  await db.roleActivityField.deleteMany();
  const removedFields = await db.activityField.deleteMany();

  return {
    removedFields: removedFields.count,
    removedServices: removedServices.count,
    removedFieldSelections: fieldSelections.count,
    removedServiceSelections: serviceSelections.count,
    removedDemoBookings: bookings.count,
    removedDemoReviews: reviews.count,
  };
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const host = new URL(databaseUrl).hostname;
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
  if (!localHosts.has(host)) {
    throw new Error(`Catalog reset is only allowed on a local database; received host "${host}"`);
  }
}

async function seedLegalDocuments(db: DatabaseClient = prisma) {
  const documents = [
    {
      documentType: LegalDocumentType.TERMS_OF_SERVICE,
      version: '1.0.0',
      contentUrl: 'https://photomatch.local/legal/terms/1.0.0',
      activeTypeKey: LegalDocumentType.TERMS_OF_SERVICE,
    },
    {
      documentType: LegalDocumentType.PRIVACY_POLICY,
      version: '1.0.0',
      contentUrl: 'https://photomatch.local/legal/privacy/1.0.0',
      activeTypeKey: LegalDocumentType.PRIVACY_POLICY,
    },
  ];
  for (const document of documents) {
    await db.legalDocument.upsert({
      where: {
        documentType_version: {
          documentType: document.documentType,
          version: document.version,
        },
      },
      create: {
        ...document,
        status: CatalogStatus.ACTIVE,
        effectiveAt: new Date('2026-07-20T00:00:00.000Z'),
      },
      update: {
        contentUrl: document.contentUrl,
        activeTypeKey: document.activeTypeKey,
        status: CatalogStatus.ACTIVE,
      },
    });
  }
}

async function main() {
  await seedRoles();
  if (process.argv.includes('--reset-photo-catalog')) {
    const resetSummary = await prisma.$transaction(
      async (tx) => {
        const summary = await resetPhotoCatalog(tx);
        await seedCatalog(tx);
        return summary;
      },
      { timeout: 30_000 },
    );
    console.log('Photo catalog reset completed:', resetSummary);
    return;
  }

  await seedCatalog();
  await seedLegalDocuments();
}

main()
  .catch((error) => {
    process.stderr.write(
      `Seed failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
