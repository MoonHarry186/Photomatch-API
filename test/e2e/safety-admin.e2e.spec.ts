import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AccountStatus,
  AuthProvider,
  BookingStatus,
  CatalogStatus,
  LegalDocumentType,
  MessageType,
  PenaltyStatus,
  PenaltyType,
  ReportReasonCode,
  ReportStatus,
  ReviewStatus,
  RoleCode,
  ServiceMode,
  UploadAssetStatus,
  UploadIntentStatus,
  UploadPurpose,
} from '@prisma/client';
import type { Job } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { PushPort } from '../../src/integrations/integration.ports';
import { ObjectStoragePort } from '../../src/integrations/object-storage.port';
import { OutboxProcessor } from '../../src/jobs/outbox.processor';
import { PairOrchestrationService } from '../../src/relationships/pair-orchestration.service';

const ADMIN_ID = '97000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = '97000000-0000-4000-8000-000000000002';
const PHOTOGRAPHER_ID = '97000000-0000-4000-8000-000000000003';
const STRANGER_ID = '97000000-0000-4000-8000-000000000004';
const ADMIN_ROLE_ID = '97100000-0000-4000-8000-000000000001';
const CUSTOMER_ROLE_ID = '97100000-0000-4000-8000-000000000002';
const PHOTOGRAPHER_ROLE_ID = '97100000-0000-4000-8000-000000000003';
const STRANGER_ROLE_ID = '97100000-0000-4000-8000-000000000004';
const ADMIN_SESSION_ID = '97200000-0000-4000-8000-000000000001';
const CUSTOMER_SESSION_ID = '97200000-0000-4000-8000-000000000002';
const PHOTOGRAPHER_SESSION_ID = '97200000-0000-4000-8000-000000000003';
const STRANGER_SESSION_ID = '97200000-0000-4000-8000-000000000004';
const PHOTOGRAPHER_RECOVERY_SESSION_ID = '97200000-0000-4000-8000-000000000005';
const CUSTOM_FIELD_CODE = 'SAFETY_E2E';
const CUSTOM_SERVICE_CODE = 'SAFETY_E2E_PORTRAIT';
const CUSTOM_LEGAL_VERSION = 'safety-e2e';
const USER_IDS = [ADMIN_ID, CUSTOMER_ID, PHOTOGRAPHER_ID, STRANGER_ID];
const USER_ROLE_IDS = [ADMIN_ROLE_ID, CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID, STRANGER_ROLE_ID];

describe('trust, safety, and admin operations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerToken: string;
  let photographerToken: string;
  let strangerToken: string;
  let serviceId: string;
  let matchId: string;
  let conversationId: string;
  let bookingId: string;
  let reviewId: string;
  let reportId: string;
  let previousLegalId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    await cleanup(prisma);

    const roles = await prisma.role.findMany({
      where: { code: { in: [RoleCode.ADMIN, RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER] } },
    });
    const roleByCode = new Map(roles.map((role) => [role.code, role.id]));
    serviceId = (await prisma.service.findFirstOrThrow({ where: { status: CatalogStatus.ACTIVE } }))
      .id;
    previousLegalId = (
      await prisma.legalDocument.findFirst({
        where: {
          documentType: LegalDocumentType.COMMUNITY_GUIDELINES,
          status: CatalogStatus.ACTIVE,
        },
        select: { id: true },
      })
    )?.id;

    await createUser(prisma, {
      userId: ADMIN_ID,
      userRoleId: ADMIN_ROLE_ID,
      sessionId: ADMIN_SESSION_ID,
      roleId: requiredRole(roleByCode, RoleCode.ADMIN),
      email: 'safety-admin@photomatch.test',
    });
    await createUser(prisma, {
      userId: CUSTOMER_ID,
      userRoleId: CUSTOMER_ROLE_ID,
      sessionId: CUSTOMER_SESSION_ID,
      roleId: requiredRole(roleByCode, RoleCode.CUSTOMER),
      email: 'safety-customer@photomatch.test',
      passwordHash: 'safety-secret-password-hash',
    });
    await createUser(prisma, {
      userId: PHOTOGRAPHER_ID,
      userRoleId: PHOTOGRAPHER_ROLE_ID,
      sessionId: PHOTOGRAPHER_SESSION_ID,
      roleId: requiredRole(roleByCode, RoleCode.PHOTOGRAPHER),
      email: 'safety-photographer@photomatch.test',
      serviceId,
    });
    await createUser(prisma, {
      userId: STRANGER_ID,
      userRoleId: STRANGER_ROLE_ID,
      sessionId: STRANGER_SESSION_ID,
      roleId: requiredRole(roleByCode, RoleCode.CUSTOMER),
      email: 'safety-stranger@photomatch.test',
    });
    await prisma.$executeRaw`
      INSERT INTO user_locations
        (id, user_id, exact_point, accuracy_meters, is_current, captured_at, created_at)
      VALUES
        ('97300000-0000-4000-8000-000000000001'::uuid, ${CUSTOMER_ID}::uuid,
         ST_SetSRID(ST_MakePoint(105.123456, 21.654321), 4326)::geography,
         5, true, NOW(), NOW())
    `;

    const pair = await app
      .get(PairOrchestrationService)
      .ensurePair(CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID);
    matchId = pair.matchId;
    conversationId = pair.conversationId;
    const booking = await prisma.booking.create({
      data: {
        matchId,
        conversationId,
        customerUserRoleId: CUSTOMER_ROLE_ID,
        photographerUserRoleId: PHOTOGRAPHER_ROLE_ID,
        serviceId,
        creatorUserId: CUSTOMER_ID,
        status: BookingStatus.COMPLETED,
        agreedPrice: 2_500_000,
        currency: 'VND',
        scheduledStart: new Date(Date.now() - 4 * 60 * 60 * 1000),
        scheduledEnd: new Date(Date.now() - 2 * 60 * 60 * 1000),
        completedAt: new Date(Date.now() - 60 * 60 * 1000),
        address: 'Safety test address',
        review: {
          create: {
            reviewerUserId: CUSTOMER_ID,
            revieweeUserId: PHOTOGRAPHER_ID,
            rating: 4,
            comment: 'Original immutable review',
          },
        },
      },
      include: { review: true },
    });
    bookingId = booking.id;
    reviewId = booking.review!.id;

    const jwt = app.get(JwtService);
    adminToken = await accessToken(
      jwt,
      ADMIN_ID,
      ADMIN_SESSION_ID,
      ADMIN_ROLE_ID,
      [RoleCode.ADMIN],
      'admin',
    );
    customerToken = await accessToken(jwt, CUSTOMER_ID, CUSTOMER_SESSION_ID, CUSTOMER_ROLE_ID, [
      RoleCode.CUSTOMER,
    ]);
    photographerToken = await accessToken(
      jwt,
      PHOTOGRAPHER_ID,
      PHOTOGRAPHER_SESSION_ID,
      PHOTOGRAPHER_ROLE_ID,
      [RoleCode.PHOTOGRAPHER],
    );
    strangerToken = await accessToken(jwt, STRANGER_ID, STRANGER_SESSION_ID, STRANGER_ROLE_ID, [
      RoleCode.CUSTOMER,
    ]);
  });

  afterAll(async () => {
    await cleanup(prisma);
    if (previousLegalId) {
      await prisma.legalDocument.updateMany({
        where: { id: previousLegalId },
        data: {
          status: CatalogStatus.ACTIVE,
          activeTypeKey: LegalDocumentType.COMMUNITY_GUIDELINES,
        },
      });
    }
    await app.close();
  });

  it('enforces admin authorization, filters, pagination limits, redaction, and MVP scope', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('authorization', `Bearer ${customerToken}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ROLE_FORBIDDEN'));
    await request(app.getHttpServer())
      .get('/api/v1/admin/users?limit=101')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(400);

    const users = await request(app.getHttpServer())
      .get(
        '/api/v1/admin/users?search=safety-customer&status=ACTIVE&role=CUSTOMER&verificationStatus=NOT_SUBMITTED&limit=1',
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(users.body.items).toHaveLength(1);
    expect(users.body.items[0].id).toBe(CUSTOMER_ID);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/users/${CUSTOMER_ID}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    const serialized = JSON.stringify(detail.body);
    expect(serialized).not.toContain('safety-secret-password-hash');
    expect(serialized).not.toContain('unused-in-safety-e2e');
    expect(serialized).not.toContain('105.123456');
    expect(serialized).not.toContain('21.654321');
    expect(detail.body).not.toHaveProperty('authIdentities');
    expect(detail.body).not.toHaveProperty('authSessions');
    expect(detail.body).not.toHaveProperty('locations');

    await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard/summary')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.activeUsers).toBeGreaterThanOrEqual(4);
        expect(body.activeMatches).toBeGreaterThanOrEqual(1);
        expect(body.pendingBookings).toBeGreaterThanOrEqual(0);
        expect(body.users).toBe(body.activeUsers);
      });
    await request(app.getHttpServer())
      .get('/api/v1/admin/feature-codes')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.version).toBe('1.0.0');
        expect(body.items).toEqual(expect.arrayContaining(['DISCOVERY', 'CHAT', 'BOOKING']));
      });
    await request(app.getHttpServer())
      .get(
        `/api/v1/admin/photographers?search=safety-photographer&accountStatus=ACTIVE&verificationStatus=NOT_SUBMITTED&availabilityStatus=AVAILABLE&serviceId=${serviceId}`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.items[0].id).toBe(PHOTOGRAPHER_ROLE_ID));
    await request(app.getHttpServer())
      .get(`/api/v1/admin/photographers/${PHOTOGRAPHER_ROLE_ID}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get(
        `/api/v1/admin/bookings?status=COMPLETED&search=safety-customer&customerUserId=${CUSTOMER_ID}&photographerUserId=${PHOTOGRAPHER_ID}&serviceId=${serviceId}&dateFrom=${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())}&dateTo=${encodeURIComponent(new Date().toISOString())}`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.some((item: { id: string }) => item.id === bookingId)).toBe(true),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/admin/bookings/${bookingId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);

    for (const path of ['payments', 'refunds', 'identity-verifications']) {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/${path}`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(404);
    }
  });

  it('accepts only participant-owned report evidence and exposes it to admin review', async () => {
    const ownEvidenceId = await createEvidence(prisma, CUSTOMER_ID, 'own');
    const foreignEvidenceId = await createEvidence(prisma, STRANGER_ID, 'foreign');
    const body = {
      reportedUserId: PHOTOGRAPHER_ID,
      reasonCode: ReportReasonCode.HARASSMENT,
      description: 'Safety report with participant context',
      matchId,
      conversationId,
    };
    await request(app.getHttpServer())
      .get(`/api/v1/uploads/${foreignEvidenceId}/access-url`)
      .set('authorization', `Bearer ${customerToken}`)
      .expect(403)
      .expect(({ body: response }) => expect(response.code).toBe('ASSET_ACCESS_DENIED'));
    await request(app.getHttpServer())
      .get(`/api/v1/uploads/${ownEvidenceId}/access-url`)
      .set('authorization', `Bearer ${customerToken}`)
      .expect(200)
      .expect(({ body: response }) => {
        expect(response.url).toEqual(expect.any(String));
        expect(response.expiresAt).toEqual(expect.any(String));
      });
    await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'foreign-report-evidence-e2e')
      .send({ ...body, evidenceAssetIds: [foreignEvidenceId] })
      .expect(403)
      .expect(({ body: response }) => expect(response.code).toBe('ASSET_ATTACH_DENIED'));
    await expect(prisma.userReport.count({ where: { reporterUserId: CUSTOMER_ID } })).resolves.toBe(
      0,
    );

    const created = await request(app.getHttpServer())
      .post('/api/v1/reports')
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'owned-report-evidence-e2e')
      .send({ ...body, evidenceAssetIds: [ownEvidenceId] })
      .expect(201);
    reportId = created.body.id as string;
    expect(created.body.evidence).toEqual([{ assetId: ownEvidenceId }]);

    await request(app.getHttpServer())
      .get(
        `/api/v1/admin/reports?status=OPEN&reasonCode=HARASSMENT&reporterUserId=${CUSTOMER_ID}&reportedUserId=${PHOTOGRAPHER_ID}&contextType=CONVERSATION`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: response }) =>
        expect(response.items.some((item: { id: string }) => item.id === reportId)).toBe(true),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/${reportId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: response }) => expect(response.evidence[0].assetId).toBe(ownEvidenceId));
    await request(app.getHttpServer())
      .get(`/api/v1/uploads/${ownEvidenceId}/access-url`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body: response }) => expect(response.url).toEqual(expect.any(String)));
  });

  it('resolves a report with temporary suspension and restores access after maintenance expiry', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/reports/${reportId}/status`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'triage-report-e2e')
      .send({ status: ReportStatus.IN_REVIEW, adminNote: 'Evidence review started' })
      .expect(201)
      .expect(({ body }) => expect(body.report.status).toBe(ReportStatus.IN_REVIEW));
    const resolved = await request(app.getHttpServer())
      .post(`/api/v1/admin/reports/${reportId}/resolve`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'resolve-temporary-suspension-e2e')
      .send({
        status: ReportStatus.RESOLVED,
        resolution: 'Temporary suspension after evidence review',
        adminNote: 'Internal safety note',
        penaltyType: PenaltyType.TEMPORARY_SUSPENSION,
        penaltyEndsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    const penaltyId = resolved.body.penalty.id as string;
    expect(resolved.body.report.status).toBe(ReportStatus.RESOLVED);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: PHOTOGRAPHER_ID } }),
    ).resolves.toMatchObject({
      accountStatus: AccountStatus.SUSPENDED,
    });
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${photographerToken}`)
      .expect(401)
      .expect(({ body }) => expect(body.code).toBe('SESSION_REVOKED'));

    await prisma.accountPenalty.update({
      where: { id: penaltyId },
      data: {
        startsAt: new Date(Date.now() - 2000),
        endsAt: new Date(Date.now() - 1000),
      },
    });
    const processor = new OutboxProcessor(
      app.get(ConfigService),
      prisma,
      app.get(PushPort),
      app.get(ObjectStoragePort),
    );
    try {
      await processor.process({
        name: 'maintenance.penalty-expiration',
        data: {},
        opts: {},
      } as Job<{ outboxEventId?: string }>);
    } finally {
      processor.onModuleDestroy();
    }
    await expect(
      prisma.accountPenalty.findUniqueOrThrow({ where: { id: penaltyId } }),
    ).resolves.toMatchObject({
      status: PenaltyStatus.EXPIRED,
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: PHOTOGRAPHER_ID } }),
    ).resolves.toMatchObject({
      accountStatus: AccountStatus.ACTIVE,
    });

    await prisma.authSession.create({
      data: {
        id: PHOTOGRAPHER_RECOVERY_SESSION_ID,
        userId: PHOTOGRAPHER_ID,
        refreshTokenHash: 'unused-recovery-token',
        tokenFamilyId: PHOTOGRAPHER_RECOVERY_SESSION_ID,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    photographerToken = await accessToken(
      app.get(JwtService),
      PHOTOGRAPHER_ID,
      PHOTOGRAPHER_RECOVERY_SESSION_ID,
      PHOTOGRAPHER_ROLE_ID,
      [RoleCode.PHOTOGRAPHER],
    );
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${photographerToken}`)
      .expect(200);
  });

  it('enforces and revokes a feature restriction at the chat boundary', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/penalties')
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'invalid-feature-restriction-e2e')
      .send({
        userId: CUSTOMER_ID,
        penaltyType: PenaltyType.FEATURE_RESTRICTION,
        featureCode: 'UNKNOWN_FEATURE',
        reason: 'Unknown feature must be rejected',
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('FEATURE_CODE_INVALID'));
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/penalties')
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'chat-feature-restriction-e2e')
      .send({
        userId: CUSTOMER_ID,
        penaltyType: PenaltyType.FEATURE_RESTRICTION,
        featureCode: 'CHAT',
        reason: 'Restrict chat during safety review',
      })
      .expect(201);
    const penaltyId = created.body.id as string;
    await request(app.getHttpServer())
      .get(
        `/api/v1/admin/penalties?status=ACTIVE&penaltyType=FEATURE_RESTRICTION&userId=${CUSTOMER_ID}`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.some((item: { id: string }) => item.id === penaltyId)).toBe(true),
      );
    await request(app.getHttpServer())
      .get('/api/v1/me/restrictions')
      .set('authorization', `Bearer ${customerToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: penaltyId, featureCode: 'CHAT' })]),
        ),
      );
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('authorization', `Bearer ${customerToken}`)
      .send({
        clientMessageId: 'restricted-chat-e2e',
        messageType: MessageType.TEXT,
        content: 'This message must be denied',
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('FEATURE_RESTRICTED'));

    await request(app.getHttpServer())
      .post(`/api/v1/admin/penalties/${penaltyId}/revoke`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'revoke-chat-restriction-e2e')
      .send({ reason: 'Safety review completed' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(PenaltyStatus.REVOKED));
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('authorization', `Bearer ${customerToken}`)
      .send({
        clientMessageId: 'restored-chat-e2e',
        messageType: MessageType.TEXT,
        content: 'Chat works after revocation',
      })
      .expect(201);
  });

  it('enforces a permanent ban and restores only after explicit penalty revocation', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/penalties')
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'permanent-ban-e2e')
      .send({
        userId: STRANGER_ID,
        penaltyType: PenaltyType.PERMANENT_BAN,
        reason: 'Permanent ban safety test',
      })
      .expect(201);
    const penaltyId = created.body.id as string;
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: STRANGER_ID } }),
    ).resolves.toMatchObject({
      accountStatus: AccountStatus.BANNED,
    });
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${strangerToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/penalties/${penaltyId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/penalties/${penaltyId}/revoke`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'revoke-permanent-ban-e2e')
      .send({ reason: 'Ban overturned by admin review' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(PenaltyStatus.REVOKED));
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: STRANGER_ID } }),
    ).resolves.toMatchObject({
      accountStatus: AccountStatus.ACTIVE,
    });
  });

  it('moderates reviews without changing customer content or rating', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/admin/reviews/${reviewId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/reviews/${reviewId}/status`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'moderate-review-e2e')
      .send({ status: ReviewStatus.HIDDEN, reason: 'Hidden by safety moderation' })
      .expect(201);
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review).toMatchObject({
      status: ReviewStatus.HIDDEN,
      rating: 4,
      comment: 'Original immutable review',
      moderatedByUserId: ADMIN_ID,
      moderationReason: 'Hidden by safety moderation',
    });
    expect(review.moderatedAt).not.toBeNull();
    await request(app.getHttpServer())
      .get(
        `/api/v1/admin/reviews?status=HIDDEN&rating=4&reviewerUserId=${CUSTOMER_ID}&revieweeUserId=${PHOTOGRAPHER_ID}`,
      )
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.some((item: { id: string }) => item.id === reviewId)).toBe(true),
      );
  });

  it('supports catalog CRUD semantics and immutable legal version lifecycle', async () => {
    const field = await request(app.getHttpServer())
      .post('/api/v1/admin/activity-fields')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        code: CUSTOM_FIELD_CODE,
        name: 'Safety Test Field',
        description: 'Created by admin e2e',
        allowedRoles: [RoleCode.CUSTOMER, RoleCode.PHOTOGRAPHER],
      })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/admin/activity-fields?search=Safety&status=ACTIVE&limit=10')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.some((item: { id: string }) => item.id === field.body.id)).toBe(true),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/admin/activity-fields/${field.body.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/activity-fields/${field.body.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Safety Test Field', status: CatalogStatus.INACTIVE })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe(CatalogStatus.INACTIVE));

    const service = await request(app.getHttpServer())
      .post('/api/v1/admin/services')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        activityFieldId: field.body.id,
        code: CUSTOM_SERVICE_CODE,
        name: 'Safety Portrait',
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/services?activityFieldId=${field.body.id}&status=ACTIVE&limit=10`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.some((item: { id: string }) => item.id === service.body.id)).toBe(true),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/admin/services/${service.body.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/services/${service.body.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Safety Portrait', status: CatalogStatus.INACTIVE })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe(CatalogStatus.INACTIVE));

    const legal = await request(app.getHttpServer())
      .post('/api/v1/admin/legal-documents')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        documentType: LegalDocumentType.COMMUNITY_GUIDELINES,
        version: CUSTOM_LEGAL_VERSION,
        contentUrl: 'https://example.test/legal/safety-e2e-v1',
        effectiveAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/admin/legal-documents?documentType=COMMUNITY_GUIDELINES&status=INACTIVE')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items.some((item: { id: string }) => item.id === legal.body.id)).toBe(true),
      );
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/legal-documents/${legal.body.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ contentUrl: 'https://example.test/legal/safety-e2e-v2' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/legal-documents/${legal.body.id}/status`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'activate-legal-e2e')
      .send({ action: 'ACTIVATE' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(CatalogStatus.ACTIVE));
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/legal-documents/${legal.body.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ contentUrl: 'https://example.test/legal/forbidden-edit' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('LEGAL_DOCUMENT_IMMUTABLE'));
    await request(app.getHttpServer())
      .post(`/api/v1/admin/legal-documents/${legal.body.id}/status`)
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'archive-legal-e2e')
      .send({ action: 'ARCHIVE' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe(CatalogStatus.ARCHIVED));
  });

  it('rate-limits repeated report commands', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set('authorization', `Bearer ${customerToken}`)
        .set('idempotency-key', `report-rate-limit-e2e-${index}`)
        .send({
          reportedUserId: STRANGER_ID,
          reasonCode: ReportReasonCode.SPAM,
          description: `Rate-limit security review ${index}`,
        });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });
});

function requiredRole(roleByCode: Map<RoleCode, string>, code: RoleCode): string {
  const roleId = roleByCode.get(code);
  if (!roleId) throw new Error(`Seed role ${code} is missing`);
  return roleId;
}

async function createUser(
  prisma: PrismaService,
  fixture: {
    userId: string;
    userRoleId: string;
    sessionId: string;
    roleId: string;
    email: string;
    passwordHash?: string;
    serviceId?: string;
  },
): Promise<void> {
  await prisma.user.create({
    data: {
      id: fixture.userId,
      email: fixture.email,
      emailVerified: true,
      accountStatus: AccountStatus.ACTIVE,
      profile: { create: { displayName: fixture.email.split('@')[0], status: 'ACTIVE' } },
      settings: { create: { profileVisibilityEnabled: true } },
      ...(fixture.passwordHash
        ? {
            authIdentities: {
              create: {
                provider: AuthProvider.EMAIL,
                email: fixture.email,
                passwordHash: fixture.passwordHash,
              },
            },
          }
        : {}),
      roles: {
        create: {
          id: fixture.userRoleId,
          roleId: fixture.roleId,
          ...(fixture.serviceId
            ? {
                photographerProfile: { create: { availabilityStatus: 'AVAILABLE' } },
                selectedServices: {
                  create: {
                    serviceId: fixture.serviceId,
                    serviceMode: ServiceMode.OFFERED,
                    minPrice: 1_000_000,
                    maxPrice: 3_000_000,
                    currency: 'VND',
                  },
                },
              }
            : {}),
        },
      },
      authSessions: {
        create: {
          id: fixture.sessionId,
          refreshTokenHash: 'unused-in-safety-e2e',
          tokenFamilyId: fixture.sessionId,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      },
    },
  });
  await prisma.user.update({
    where: { id: fixture.userId },
    data: { currentRoleId: fixture.userRoleId },
  });
}

async function createEvidence(prisma: PrismaService, ownerUserId: string, suffix: string) {
  const objectKey = `report-evidence/safety-e2e-${suffix}`;
  const intent = await prisma.uploadIntent.create({
    data: {
      ownerUserId,
      purpose: UploadPurpose.REPORT_EVIDENCE,
      objectKey,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      expectedSizeBytes: 16,
      status: UploadIntentStatus.COMPLETED,
      expiresAt: new Date(Date.now() + 3_600_000),
      completedAt: new Date(),
      asset: {
        create: {
          ownerUserId,
          purpose: UploadPurpose.REPORT_EVIDENCE,
          objectKey,
          mimeType: 'image/jpeg',
          sizeBytes: 16,
          status: UploadAssetStatus.USABLE,
          attachedAt: new Date(),
        },
      },
    },
    include: { asset: true },
  });
  return intent.asset!.id;
}

function accessToken(
  jwt: JwtService,
  userId: string,
  sessionId: string,
  roleId: string,
  roles: RoleCode[],
  audience: 'mobile' | 'admin' = 'mobile',
) {
  return jwt.signAsync(
    { sub: userId, sid: sessionId, roleId, roles, typ: 'access' },
    { secret: process.env.JWT_ACCESS_SECRET, audience, expiresIn: 900 },
  );
}

async function cleanup(prisma: PrismaService): Promise<void> {
  if (!prisma) return;
  const matches = await prisma.match.findMany({
    where: {
      OR: [{ userRoleAId: { in: USER_ROLE_IDS } }, { userRoleBId: { in: USER_ROLE_IDS } }],
    },
    select: { id: true, conversation: { select: { id: true } } },
  });
  const matchIds = matches.map((item) => item.id);
  const conversationIds = matches.flatMap((item) =>
    item.conversation ? [item.conversation.id] : [],
  );
  const bookings = await prisma.booking.findMany({
    where: {
      OR: [
        { customerUserRoleId: { in: USER_ROLE_IDS } },
        { photographerUserRoleId: { in: USER_ROLE_IDS } },
      ],
    },
    select: { id: true, review: { select: { id: true } } },
  });
  const bookingIds = bookings.map((item) => item.id);
  const reviewIds = bookings.flatMap((item) => (item.review ? [item.review.id] : []));
  const reports = await prisma.userReport.findMany({
    where: { OR: [{ reporterUserId: { in: USER_IDS } }, { reportedUserId: { in: USER_IDS } }] },
    select: { id: true },
  });
  const reportIds = reports.map((item) => item.id);
  const messages = await prisma.message.findMany({
    where: {
      OR: [{ senderUserId: { in: USER_IDS } }, { conversationId: { in: conversationIds } }],
    },
    select: { id: true },
  });
  const messageIds = messages.map((item) => item.id);

  await prisma.notification.deleteMany({
    where: { OR: [{ recipientUserId: { in: USER_IDS } }, { actorUserId: { in: USER_IDS } }] },
  });
  await prisma.accountPenalty.deleteMany({
    where: { OR: [{ userId: { in: USER_IDS } }, { imposedByUserId: { in: USER_IDS } }] },
  });
  await prisma.userReport.deleteMany({
    where: { OR: [{ reporterUserId: { in: USER_IDS } }, { reportedUserId: { in: USER_IDS } }] },
  });
  await prisma.review.deleteMany({
    where: { OR: [{ reviewerUserId: { in: USER_IDS } }, { revieweeUserId: { in: USER_IDS } }] },
  });
  await prisma.booking.deleteMany({
    where: {
      OR: [
        { customerUserRoleId: { in: USER_ROLE_IDS } },
        { photographerUserRoleId: { in: USER_ROLE_IDS } },
      ],
    },
  });
  await prisma.message.deleteMany({
    where: {
      OR: [{ senderUserId: { in: USER_IDS } }, { conversationId: { in: conversationIds } }],
    },
  });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: conversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.userBlock.deleteMany({
    where: { OR: [{ blockerUserId: { in: USER_IDS } }, { blockedUserId: { in: USER_IDS } }] },
  });
  await prisma.idempotencyRecord.deleteMany({ where: { actorKey: { in: USER_IDS } } });
  await prisma.outboxEvent.deleteMany({
    where: {
      aggregateId: {
        in: [
          ...matchIds,
          ...conversationIds,
          ...bookingIds,
          ...reviewIds,
          ...reportIds,
          ...messageIds,
        ],
      },
    },
  });
  await prisma.userRoleService.deleteMany({ where: { userRoleId: { in: USER_ROLE_IDS } } });
  await prisma.userRole.deleteMany({ where: { id: { in: USER_ROLE_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });

  const customFields = await prisma.activityField.findMany({
    where: { code: CUSTOM_FIELD_CODE },
    select: { id: true },
  });
  const customFieldIds = customFields.map((field) => field.id);
  await prisma.service.deleteMany({
    where: { OR: [{ code: CUSTOM_SERVICE_CODE }, { activityFieldId: { in: customFieldIds } }] },
  });
  await prisma.roleActivityField.deleteMany({ where: { activityFieldId: { in: customFieldIds } } });
  await prisma.activityField.deleteMany({ where: { id: { in: customFieldIds } } });
  await prisma.legalDocument.deleteMany({
    where: {
      documentType: LegalDocumentType.COMMUNITY_GUIDELINES,
      version: CUSTOM_LEGAL_VERSION,
    },
  });
}
