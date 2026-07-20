import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AccountStatus, BookingStatus, ReviewStatus, RoleCode, ServiceMode } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { EligibilityService } from '../../src/profiles/eligibility.service';

const CUSTOMER_ID = '91000000-0000-4000-8000-000000000001';
const PHOTOGRAPHER_ID = '91000000-0000-4000-8000-000000000002';
const STRANGER_ID = '91000000-0000-4000-8000-000000000003';
const CUSTOMER_ROLE_ID = '92000000-0000-4000-8000-000000000001';
const PHOTOGRAPHER_ROLE_ID = '92000000-0000-4000-8000-000000000002';
const STRANGER_ROLE_ID = '92000000-0000-4000-8000-000000000003';
const CUSTOMER_SESSION_ID = '93000000-0000-4000-8000-000000000001';
const PHOTOGRAPHER_SESSION_ID = '93000000-0000-4000-8000-000000000002';
const STRANGER_SESSION_ID = '93000000-0000-4000-8000-000000000003';

describe('direct booking lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerToken: string;
  let photographerToken: string;
  let strangerToken: string;
  let serviceId: string;
  let bookingId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EligibilityService)
      .useValue({ discovery: async () => ({ eligible: true, reasons: [] }) })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    await cleanup(prisma);

    const customerRole = await prisma.role.findUniqueOrThrow({
      where: { code: RoleCode.CUSTOMER },
    });
    const photographerRole = await prisma.role.findUniqueOrThrow({
      where: { code: RoleCode.PHOTOGRAPHER },
    });
    const service = await prisma.service.findFirstOrThrow();
    serviceId = service.id;
    await createUser(prisma, {
      userId: CUSTOMER_ID,
      userRoleId: CUSTOMER_ROLE_ID,
      sessionId: CUSTOMER_SESSION_ID,
      roleId: customerRole.id,
      email: 'booking-customer@photomatch.test',
    });
    await createUser(prisma, {
      userId: PHOTOGRAPHER_ID,
      userRoleId: PHOTOGRAPHER_ROLE_ID,
      sessionId: PHOTOGRAPHER_SESSION_ID,
      roleId: photographerRole.id,
      email: 'booking-photographer@photomatch.test',
      serviceId,
    });
    await createUser(prisma, {
      userId: STRANGER_ID,
      userRoleId: STRANGER_ROLE_ID,
      sessionId: STRANGER_SESSION_ID,
      roleId: customerRole.id,
      email: 'booking-stranger@photomatch.test',
    });

    const jwt = app.get(JwtService);
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
    await app.close();
  });

  it('denies Photographer booking without an active conversation', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('authorization', `Bearer ${photographerToken}`)
      .set('idempotency-key', 'photographer-unmatched-booking-e2e')
      .send({ ...bookingBody(serviceId), customerUserRoleId: STRANGER_ROLE_ID })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ACTIVE_CONVERSATION_REQUIRED'));
    await expect(prisma.match.count()).resolves.toBe(0);
  });

  it('rolls back pair creation when a later booking write fails', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'direct-booking-rollback-e2e')
      .send({ ...bookingBody(serviceId), agreedPrice: 999_999_999_999_999 })
      .expect(500);
    await expect(prisma.match.count()).resolves.toBe(0);
    await expect(prisma.conversation.count()).resolves.toBe(0);
    await expect(prisma.booking.count()).resolves.toBe(0);
  });

  it('creates one relationship and one pending booking under concurrent retry', async () => {
    const body = bookingBody(serviceId);
    const attempts = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/api/v1/bookings')
          .set('authorization', `Bearer ${customerToken}`)
          .set('idempotency-key', 'direct-booking-e2e')
          .send(body),
      ),
    );
    expect(attempts.map((attempt) => attempt.status)).toContain(201);
    expect(attempts.every((attempt) => [201, 409].includes(attempt.status))).toBe(true);
    const first = attempts.find((attempt) => attempt.status === 201);
    if (!first) throw new Error('Concurrent booking did not return a successful response');
    bookingId = first.body.id as string;
    expect(first.body.status).toBe(BookingStatus.PENDING);
    const replay = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'direct-booking-e2e')
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(bookingId);
    await expect(prisma.match.count()).resolves.toBe(1);
    await expect(prisma.conversation.count()).resolves.toBe(1);
    await expect(prisma.booking.count({ where: { id: bookingId } })).resolves.toBe(1);
  });

  it('allows only the creator to update pending terms and filters participant reads', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${bookingId}`)
      .set('authorization', `Bearer ${customerToken}`)
      .send({ address: '2 Updated Street, Ha Noi', note: 'Updated pending booking' })
      .expect(200)
      .expect(({ body }) => expect(body.address).toBe('2 Updated Street, Ha Noi'));
    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${bookingId}`)
      .set('authorization', `Bearer ${photographerToken}`)
      .send({ note: 'Not creator' })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('BOOKING_UPDATE_DENIED'));
    for (const participantToken of [customerToken, photographerToken]) {
      await request(app.getHttpServer())
        .get(`/api/v1/bookings/${bookingId}`)
        .set('authorization', `Bearer ${participantToken}`)
        .expect(200);
    }
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}`)
      .set('authorization', `Bearer ${strangerToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/bookings')
      .set('authorization', `Bearer ${strangerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));
  });

  it('allows the Photographer to accept, start, and complete', async () => {
    const concurrentAccepts = await Promise.all(
      ['booking-accepted-concurrent-a', 'booking-accepted-concurrent-b'].map((idempotencyKey) =>
        request(app.getHttpServer())
          .post(`/api/v1/bookings/${bookingId}/status`)
          .set('authorization', `Bearer ${photographerToken}`)
          .set('idempotency-key', idempotencyKey)
          .send({ status: BookingStatus.ACCEPTED }),
      ),
    );
    expect(concurrentAccepts.map((attempt) => attempt.status)).toEqual([201, 201]);
    expect(
      concurrentAccepts.every((attempt) => attempt.body.status === BookingStatus.ACCEPTED),
    ).toBe(true);
    await expect(
      prisma.bookingStatusHistory.count({
        where: { bookingId, newStatus: BookingStatus.ACCEPTED },
      }),
    ).resolves.toBe(1);

    for (const status of [BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED]) {
      await request(app.getHttpServer())
        .post(`/api/v1/bookings/${bookingId}/status`)
        .set('authorization', `Bearer ${photographerToken}`)
        .set('idempotency-key', `booking-${status.toLowerCase()}-e2e`)
        .send({ status })
        .expect(201)
        .expect(({ body }) => expect(body.status).toBe(status));
    }
    await expect(prisma.bookingStatusHistory.count({ where: { bookingId } })).resolves.toBe(4);
  });

  it('enforces review eligibility, uniqueness, and public moderation filters', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/review`)
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'booking-review-invalid-e2e')
      .send({ rating: 6 })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('INVALID_RATING'));
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/review`)
      .set('authorization', `Bearer ${photographerToken}`)
      .set('idempotency-key', 'booking-review-photographer-e2e')
      .send({ rating: 5 })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('REVIEW_NOT_ALLOWED'));
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/review`)
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'booking-review-e2e')
      .send({ rating: 5, comment: 'Excellent session' })
      .expect(201)
      .expect(({ body }) => expect(body.rating).toBe(5));
    const duplicate = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/review`)
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'booking-review-duplicate-e2e')
      .send({ rating: 5, comment: 'Excellent session' })
      .expect(201);
    expect(duplicate.body.bookingId).toBe(bookingId);
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${bookingId}/review`)
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'booking-review-conflict-e2e')
      .send({ rating: 4, comment: 'Changed review' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('REVIEW_ALREADY_EXISTS'));
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}/review`)
      .set('authorization', `Bearer ${customerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.comment).toBe('Excellent session'));
    await expect(prisma.review.count({ where: { bookingId } })).resolves.toBe(1);
    await request(app.getHttpServer())
      .patch(`/api/v1/bookings/${bookingId}/review`)
      .set('authorization', `Bearer ${customerToken}`)
      .send({ rating: 4 })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/bookings/${bookingId}/review`)
      .set('authorization', `Bearer ${customerToken}`)
      .expect(404);

    const published = await request(app.getHttpServer())
      .get(`/api/v1/photographers/${PHOTOGRAPHER_ROLE_ID}/reviews`)
      .set('authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(published.body.summary).toEqual({ average: 5, count: 1 });
    const review = await prisma.review.findUniqueOrThrow({ where: { bookingId } });
    await prisma.review.update({
      where: { id: review.id },
      data: {
        status: ReviewStatus.HIDDEN,
        moderatedByUserId: CUSTOMER_ID,
        moderationReason: 'Hidden for aggregate e2e',
        moderatedAt: new Date(),
      },
    });
    await request(app.getHttpServer())
      .get(`/api/v1/photographers/${PHOTOGRAPHER_ROLE_ID}/reviews`)
      .set('authorization', `Bearer ${customerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.summary).toEqual({ average: 0, count: 0 });
        expect(body.items).toHaveLength(0);
      });
    await prisma.review.update({
      where: { id: review.id },
      data: { status: ReviewStatus.PUBLISHED },
    });
  });

  it('reuses the active relationship for a later direct booking', async () => {
    const first = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const second = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('authorization', `Bearer ${customerToken}`)
      .set('idempotency-key', 'direct-booking-active-pair-e2e')
      .send(bookingBody(serviceId, 72))
      .expect(201);
    expect(second.body.status).toBe(BookingStatus.PENDING);
    expect(second.body.matchId).toBe(first.matchId);
    expect(second.body.conversationId).toBe(first.conversationId);
    await expect(prisma.match.count()).resolves.toBe(1);
    await expect(prisma.conversation.count()).resolves.toBe(1);
    await expect(prisma.booking.count()).resolves.toBe(2);
  });
});

function bookingBody(serviceId: string, startHours = 24) {
  return {
    photographerUserRoleId: PHOTOGRAPHER_ROLE_ID,
    serviceId,
    agreedPrice: 2_000_000,
    currency: 'VND',
    scheduledStart: new Date(Date.now() + startHours * 60 * 60 * 1000).toISOString(),
    scheduledEnd: new Date(Date.now() + (startHours + 2) * 60 * 60 * 1000).toISOString(),
    address: '1 Test Street, Ha Noi',
    note: 'Direct booking e2e',
  };
}

async function createUser(
  prisma: PrismaService,
  fixture: {
    userId: string;
    userRoleId: string;
    sessionId: string;
    roleId: string;
    email: string;
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
          refreshTokenHash: 'unused-in-booking-e2e',
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

function accessToken(
  jwt: JwtService,
  userId: string,
  sessionId: string,
  roleId: string,
  roles: RoleCode[],
) {
  return jwt.signAsync(
    { sub: userId, sid: sessionId, roleId, roles, typ: 'access' },
    { secret: process.env.JWT_ACCESS_SECRET, audience: 'mobile', expiresIn: 900 },
  );
}

async function cleanup(prisma: PrismaService): Promise<void> {
  if (!prisma) return;
  const userIds = [CUSTOMER_ID, PHOTOGRAPHER_ID, STRANGER_ID];
  const roleIds = [CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID, STRANGER_ROLE_ID];
  const matches = await prisma.match.findMany({
    where: { OR: [{ userRoleAId: { in: roleIds } }, { userRoleBId: { in: roleIds } }] },
    select: { id: true, conversation: { select: { id: true } } },
  });
  const matchIds = matches.map((item) => item.id);
  const conversationIds = matches.flatMap((item) =>
    item.conversation ? [item.conversation.id] : [],
  );
  const bookings = await prisma.booking.findMany({
    where: { matchId: { in: matchIds } },
    select: { id: true, review: { select: { id: true } } },
  });
  const bookingIds = bookings.map((item) => item.id);
  const reviewIds = bookings.flatMap((item) => (item.review ? [item.review.id] : []));
  await prisma.review.deleteMany({
    where: { OR: [{ reviewerUserId: { in: userIds } }, { revieweeUserId: { in: userIds } }] },
  });
  await prisma.notification.deleteMany({
    where: { OR: [{ recipientUserId: { in: userIds } }, { actorUserId: { in: userIds } }] },
  });
  await prisma.booking.deleteMany({ where: { matchId: { in: matchIds } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: conversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { actorKey: { in: userIds } } });
  await prisma.outboxEvent.deleteMany({
    where: { aggregateId: { in: [...matchIds, ...conversationIds, ...bookingIds, ...reviewIds] } },
  });
  await prisma.userRoleService.deleteMany({ where: { userRoleId: { in: roleIds } } });
  await prisma.userRole.deleteMany({ where: { id: { in: roleIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
