import {
  CatalogStatus,
  LegalDocumentType,
  PrismaClient,
  RoleCode,
  RoleStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

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
    commercial: '30000000-0000-4000-8000-000000000003',
  },
};

async function seedRoles() {
  const roles = [
    { id: ids.roles.customer, code: RoleCode.CUSTOMER, name: 'Customer' },
    { id: ids.roles.photographer, code: RoleCode.PHOTOGRAPHER, name: 'Photographer' },
    { id: ids.roles.admin, code: RoleCode.ADMIN, name: 'Admin' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      create: { ...role, status: RoleStatus.ACTIVE },
      update: { name: role.name, status: RoleStatus.ACTIVE },
    });
  }
}

async function seedCatalog() {
  const cities = [
    { id: ids.cities.hanoi, code: 'HA_NOI', name: 'Ha Noi' },
    { id: ids.cities.hochiminh, code: 'HO_CHI_MINH', name: 'Ho Chi Minh' },
    { id: ids.cities.danang, code: 'DA_NANG', name: 'Da Nang' },
  ];
  for (const city of cities) {
    await prisma.city.upsert({
      where: { code: city.code },
      create: { ...city, status: CatalogStatus.ACTIVE },
      update: { name: city.name, status: CatalogStatus.ACTIVE },
    });
  }

  const fields = [
    { id: ids.fields.portrait, code: 'PORTRAIT', name: 'Chan dung' },
    { id: ids.fields.wedding, code: 'WEDDING', name: 'Cuoi hoi' },
    { id: ids.fields.commercial, code: 'COMMERCIAL', name: 'Thuong mai' },
  ];
  for (const field of fields) {
    await prisma.activityField.upsert({
      where: { code: field.code },
      create: { ...field, status: CatalogStatus.ACTIVE },
      update: { name: field.name, status: CatalogStatus.ACTIVE },
    });
    await prisma.roleActivityField.upsert({
      where: {
        roleId_activityFieldId: {
          roleId: ids.roles.photographer,
          activityFieldId: field.id,
        },
      },
      create: { roleId: ids.roles.photographer, activityFieldId: field.id },
      update: {},
    });
    await prisma.roleActivityField.upsert({
      where: {
        roleId_activityFieldId: {
          roleId: ids.roles.customer,
          activityFieldId: field.id,
        },
      },
      create: { roleId: ids.roles.customer, activityFieldId: field.id },
      update: {},
    });
  }

  const services = [
    ['PORTRAIT_SESSION', 'Chup chan dung', ids.fields.portrait],
    ['FASHION_PORTRAIT', 'Chup thoi trang', ids.fields.portrait],
    ['WEDDING_DAY', 'Chup ngay cuoi', ids.fields.wedding],
    ['PRE_WEDDING', 'Chup anh cuoi', ids.fields.wedding],
    ['EVENT', 'Chup su kien', ids.fields.commercial],
    ['PRODUCT', 'Chup san pham', ids.fields.commercial],
  ] as const;
  for (const [code, name, activityFieldId] of services) {
    await prisma.service.upsert({
      where: { code },
      create: { code, name, activityFieldId, status: CatalogStatus.ACTIVE },
      update: { name, activityFieldId, status: CatalogStatus.ACTIVE },
    });
  }
}

async function seedLegalDocuments() {
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
    await prisma.legalDocument.upsert({
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
