import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AccountStatus,
  CatalogStatus,
  LegalDocumentType,
  RoleCode,
  ServiceMode,
  UploadAssetStatus,
  UploadIntentStatus,
  UploadPurpose,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { EligibilityService } from '../../src/profiles/eligibility.service';

const USER_ID = '95000000-0000-4000-8000-000000000001';
const CUSTOMER_ROLE_ID = '95000000-0000-4000-8000-000000000002';
const PHOTOGRAPHER_ROLE_ID = '95000000-0000-4000-8000-000000000003';
const SESSION_ID = '95000000-0000-4000-8000-000000000004';
const STALE_LEGAL_ID = '95000000-0000-4000-8000-000000000005';

describe('profile, catalog, and onboarding (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let eligibility: EligibilityService;
  let token: string;
  let fieldId: string;
  let serviceId: string;
  let cityId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    eligibility = app.get(EligibilityService);
    await cleanup(prisma);

    const [customer, photographer, field, city] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { code: RoleCode.CUSTOMER } }),
      prisma.role.findUniqueOrThrow({ where: { code: RoleCode.PHOTOGRAPHER } }),
      prisma.activityField.findFirstOrThrow({
        where: {
          status: CatalogStatus.ACTIVE,
          roleMappings: { some: { role: { code: RoleCode.PHOTOGRAPHER } } },
        },
      }),
      prisma.city.findFirstOrThrow({ where: { status: CatalogStatus.ACTIVE } }),
    ]);
    const service = await prisma.service.findFirstOrThrow({
      where: { activityFieldId: field.id, status: CatalogStatus.ACTIVE },
    });
    fieldId = field.id;
    serviceId = service.id;
    cityId = city.id;

    await prisma.user.create({
      data: {
        id: USER_ID,
        email: 'profile-e2e@photomatch.test',
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        profile: { create: {} },
        settings: { create: {} },
        roles: {
          create: [
            { id: CUSTOMER_ROLE_ID, roleId: customer.id },
            {
              id: PHOTOGRAPHER_ROLE_ID,
              roleId: photographer.id,
              photographerProfile: { create: {} },
            },
          ],
        },
        authSessions: {
          create: {
            id: SESSION_ID,
            refreshTokenHash: 'unused-in-profile-e2e',
            tokenFamilyId: '95000000-0000-4000-8000-000000000006',
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        },
      },
    });
    await prisma.user.update({
      where: { id: USER_ID },
      data: { currentRoleId: PHOTOGRAPHER_ROLE_ID },
    });
    await prisma.legalDocument.create({
      data: {
        id: STALE_LEGAL_ID,
        documentType: LegalDocumentType.COMMUNITY_GUIDELINES,
        version: 'profile-e2e-stale',
        contentUrl: 'https://photomatch.test/legal/stale',
        status: CatalogStatus.INACTIVE,
        effectiveAt: new Date(Date.now() - 86_400_000),
      },
    });
    token = await app.get(JwtService).signAsync(
      {
        sub: USER_ID,
        sid: SESSION_ID,
        roleId: PHOTOGRAPHER_ROLE_ID,
        roles: [RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER],
        typ: 'access',
      },
      { secret: process.env.JWT_ACCESS_SECRET, audience: 'mobile', expiresIn: 900 },
    );
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  it('serves active public catalogs and mobile-selectable roles', async () => {
    const cities = await request(app.getHttpServer()).get('/api/v1/cities').expect(200);
    const fields = await request(app.getHttpServer())
      .get('/api/v1/activity-fields')
      .query({ role: RoleCode.PHOTOGRAPHER })
      .expect(200);
    const services = await request(app.getHttpServer())
      .get('/api/v1/services')
      .query({ activityFieldId: fieldId })
      .expect(200);
    const roles = await request(app.getHttpServer())
      .get('/api/v1/roles/available')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(cities.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: cityId })]));
    expect(fields.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: fieldId })]));
    expect(services.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: serviceId })]),
    );
    expect(roles.body.map((item: { code: RoleCode }) => item.code)).not.toContain(RoleCode.ADMIN);
  });

  it('accepts only active legal versions and keeps consent append-only', async () => {
    const current = await request(app.getHttpServer())
      .get('/api/v1/legal-documents/current')
      .expect(200);
    const legalDocumentId = current.body[0].id as string;
    for (let index = 0; index < 2; index += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/me/consents')
        .set('authorization', `Bearer ${token}`)
        .send({ legalDocumentId })
        .expect(201);
    }
    await expect(
      prisma.userConsent.count({ where: { userId: USER_ID, legalDocumentId } }),
    ).resolves.toBe(1);
    await request(app.getHttpServer())
      .post('/api/v1/me/consents')
      .set('authorization', `Bearer ${token}`)
      .send({ legalDocumentId: STALE_LEGAL_ID })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('STALE_LEGAL_VERSION'));
  });

  it('validates selections and resumes onboarding from persisted progress', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/me/onboarding/progress')
      .set('authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            userRoleId: PHOTOGRAPHER_ROLE_ID,
            role: RoleCode.PHOTOGRAPHER,
            complete: false,
            discoveryEligible: false,
            missing: expect.arrayContaining(['displayName', 'portfolioImages']),
            discoveryReasons: expect.any(Array),
          }),
        );
      });
    await expect(eligibility.onboarding(USER_ID, PHOTOGRAPHER_ROLE_ID)).resolves.toEqual(
      expect.objectContaining({
        complete: false,
        missing: expect.arrayContaining([
          'displayName',
          'dateOfBirth',
          'city',
          'avatar',
          'location',
          'activityFields',
          'services',
          'portfolioImages',
        ]),
      }),
    );
    await request(app.getHttpServer())
      .patch('/api/v1/me/profile')
      .set('authorization', `Bearer ${token}`)
      .send({ displayName: 'Profile E2E', dateOfBirth: '1990-01-01', cityId })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/me/roles/${PHOTOGRAPHER_ROLE_ID}/activity-fields`)
      .set('authorization', `Bearer ${token}`)
      .send({ activityFieldIds: ['95000000-0000-4000-8000-000000000099'] })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('INVALID_ACTIVITY_FIELD'));
    await request(app.getHttpServer())
      .put(`/api/v1/me/roles/${PHOTOGRAPHER_ROLE_ID}/activity-fields`)
      .set('authorization', `Bearer ${token}`)
      .send({ activityFieldIds: [fieldId] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/me/roles/${PHOTOGRAPHER_ROLE_ID}/services`)
      .set('authorization', `Bearer ${token}`)
      .send({
        services: [
          { serviceId, serviceMode: ServiceMode.OFFERED, minPrice: 2_000_000, maxPrice: 1_000_000 },
        ],
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('INVALID_PRICE_RANGE'));
    await request(app.getHttpServer())
      .put(`/api/v1/me/roles/${PHOTOGRAPHER_ROLE_ID}/services`)
      .set('authorization', `Bearer ${token}`)
      .send({
        services: [
          { serviceId, serviceMode: ServiceMode.OFFERED, minPrice: 1_000_000, maxPrice: 2_000_000 },
        ],
      })
      .expect(200);
    await request(app.getHttpServer())
      .put('/api/v1/me/location')
      .set('authorization', `Bearer ${token}`)
      .send({ latitude: 21.0278, longitude: 105.8342, accuracyMeters: 20 })
      .expect(200);

    const avatar = await createAsset(prisma, UploadPurpose.AVATAR, 0);
    await request(app.getHttpServer())
      .put('/api/v1/me/profile/avatar')
      .set('authorization', `Bearer ${token}`)
      .send({ assetId: avatar })
      .expect(200);
    const portfolioAssets = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createAsset(prisma, UploadPurpose.PORTFOLIO, index + 1),
      ),
    );
    for (const [index, assetId] of portfolioAssets.entries()) {
      await request(app.getHttpServer())
        .post(`/api/v1/me/roles/${PHOTOGRAPHER_ROLE_ID}/portfolio`)
        .set('authorization', `Bearer ${token}`)
        .send({ assetId, serviceId, title: `Portfolio ${index + 1}` })
        .expect(201);
      const progress = await eligibility.onboarding(USER_ID, PHOTOGRAPHER_ROLE_ID);
      expect(progress.complete).toBe(index === 5);
      if (index < 5) expect(progress.missing).toContain('portfolioImages');
    }
    await expect(prisma.user.findUniqueOrThrow({ where: { id: USER_ID } })).resolves.toEqual(
      expect.objectContaining({ onboardingCompletedAt: expect.any(Date) }),
    );
    await request(app.getHttpServer())
      .get('/api/v1/me/onboarding/progress')
      .set('authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.complete).toBe(true);
        expect(body.missing).toEqual([]);
      });
  });

  it('persists privacy settings without exposing them or exact GPS publicly', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/me/settings')
      .set('authorization', `Bearer ${token}`)
      .send({
        readReceiptsEnabled: false,
        profileVisibilityEnabled: true,
        locationVisibilityDurationHours: 48,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.readReceiptsEnabled).toBe(false);
        expect(body.profileVisibilityEnabled).toBe(true);
        expect(body.locationVisibilityDurationHours).toBe(48);
      });
    await request(app.getHttpServer())
      .get(`/api/v1/profiles/${PHOTOGRAPHER_ROLE_ID}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).not.toHaveProperty('settings');
        expect(body).not.toHaveProperty('latitude');
        expect(body).not.toHaveProperty('longitude');
        expect(JSON.stringify(body)).not.toContain('exactPoint');
      });
  });

  it('removes service selections whose parent fields are no longer selected', async () => {
    await expect(
      prisma.userRoleService.count({
        where: { userRoleId: PHOTOGRAPHER_ROLE_ID, serviceId },
      }),
    ).resolves.toBe(1);

    await request(app.getHttpServer())
      .put(`/api/v1/me/roles/${PHOTOGRAPHER_ROLE_ID}/activity-fields`)
      .set('authorization', `Bearer ${token}`)
      .send({ activityFieldIds: [] })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/me/roles/${PHOTOGRAPHER_ROLE_ID}/services`)
      .set('authorization', `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual([]));
  });
});

async function createAsset(
  prisma: PrismaService,
  purpose: UploadPurpose,
  index: number,
): Promise<string> {
  const objectKey = `profile-e2e/${purpose.toLowerCase()}-${index}.jpg`;
  const intent = await prisma.uploadIntent.create({
    data: {
      ownerUserId: USER_ID,
      purpose,
      objectKey,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      expectedSizeBytes: 1n,
      status: UploadIntentStatus.COMPLETED,
      expiresAt: new Date(Date.now() + 3_600_000),
      completedAt: new Date(),
      asset: {
        create: {
          ownerUserId: USER_ID,
          purpose,
          objectKey,
          mimeType: 'image/jpeg',
          sizeBytes: 1n,
          status: UploadAssetStatus.USABLE,
        },
      },
    },
    include: { asset: true },
  });
  if (!intent.asset) throw new Error('Fixture asset was not created');
  return intent.asset.id;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  if (!prisma) return;
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.legalDocument.deleteMany({ where: { id: STALE_LEGAL_ID } });
}
