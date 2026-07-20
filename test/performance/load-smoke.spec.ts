import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AccountStatus,
  MessageType,
  PhotographerAvailabilityStatus,
  ProfileStatus,
  RoleCode,
} from '@prisma/client';
import { performance } from 'node:perf_hooks';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import { PrismaService } from '../../src/database/prisma.service';
import { PairOrchestrationService } from '../../src/relationships/pair-orchestration.service';

const CUSTOMER_ID = '99000000-0000-4000-8000-000000000001';
const PHOTOGRAPHER_ID = '99000000-0000-4000-8000-000000000002';
const CUSTOMER_ROLE_ID = '99100000-0000-4000-8000-000000000001';
const PHOTOGRAPHER_ROLE_ID = '99100000-0000-4000-8000-000000000002';
const CUSTOMER_SESSION_ID = '99200000-0000-4000-8000-000000000001';
const USER_IDS = [CUSTOMER_ID, PHOTOGRAPHER_ID];
const USER_ROLE_IDS = [CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID];

describe('representative API load smoke (performance)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerToken: string;
  let conversationId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    await prisma.user.create({
      data: {
        id: CUSTOMER_ID,
        email: 'load-customer@photomatch.test',
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        profile: {
          create: { displayName: 'Load Customer', status: ProfileStatus.ACTIVE },
        },
        settings: { create: { profileVisibilityEnabled: true } },
        roles: { create: { id: CUSTOMER_ROLE_ID, roleId: customerRole.id } },
        authSessions: {
          create: {
            id: CUSTOMER_SESSION_ID,
            refreshTokenHash: 'unused-load-smoke',
            tokenFamilyId: CUSTOMER_SESSION_ID,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        },
      },
    });
    await prisma.user.create({
      data: {
        id: PHOTOGRAPHER_ID,
        email: 'load-photographer@photomatch.test',
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        profile: {
          create: { displayName: 'Load Photographer', status: ProfileStatus.ACTIVE },
        },
        settings: { create: { profileVisibilityEnabled: true } },
        roles: {
          create: {
            id: PHOTOGRAPHER_ROLE_ID,
            roleId: photographerRole.id,
            photographerProfile: {
              create: { availabilityStatus: PhotographerAvailabilityStatus.AVAILABLE },
            },
          },
        },
      },
    });
    await prisma.user.update({
      where: { id: CUSTOMER_ID },
      data: { currentRoleId: CUSTOMER_ROLE_ID },
    });
    await prisma.user.update({
      where: { id: PHOTOGRAPHER_ID },
      data: { currentRoleId: PHOTOGRAPHER_ROLE_ID },
    });
    await prisma.$executeRaw`
      INSERT INTO user_locations
        (id, user_id, exact_point, accuracy_meters, is_current, captured_at, created_at)
      VALUES
        ('99300000-0000-4000-8000-000000000001'::uuid, ${CUSTOMER_ID}::uuid,
         ST_SetSRID(ST_MakePoint(105.8342, 21.0278), 4326)::geography,
         5, true, NOW(), NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO discovery_presence (
        id, user_role_id, public_point, public_radius_meters, location_noise_meters,
        is_visible, visible_until, created_at, updated_at
      ) VALUES (
        '99400000-0000-4000-8000-000000000001'::uuid,
        ${PHOTOGRAPHER_ROLE_ID}::uuid,
        ST_SetSRID(ST_MakePoint(105.8350, 21.0284), 4326)::geography,
        1000, 1000, true, NOW() + INTERVAL '24 hours', NOW(), NOW()
      )
    `;
    conversationId = (
      await app.get(PairOrchestrationService).ensurePair(CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID)
    ).conversationId;
    customerToken = await app.get(JwtService).signAsync(
      {
        sub: CUSTOMER_ID,
        sid: CUSTOMER_SESSION_ID,
        roleId: CUSTOMER_ROLE_ID,
        roles: [RoleCode.CUSTOMER],
        typ: 'access',
      },
      { secret: process.env.JWT_ACCESS_SECRET, audience: 'mobile', expiresIn: 900 },
    );
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  it('meets MVP P95 targets for regular API, text chat, discovery, and nearby', async () => {
    const server = app.getHttpServer();
    const auth = { authorization: `Bearer ${customerToken}` };
    const meCall = async () => {
      const response = await request(server).get('/api/v1/me').set(auth);
      expect(response.status).toBe(200);
    };
    const discoveryCall = async (path: 'discovery/candidates' | 'nearby') => {
      const response = await request(server)
        .get(`/api/v1/${path}`)
        .set(auth)
        .query({ targetRole: RoleCode.PHOTOGRAPHER, radiusKm: 20, limit: 20 });
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ userRoleId: PHOTOGRAPHER_ROLE_ID })]),
      );
    };

    await warmUp(meCall);
    await warmUp(() => discoveryCall('discovery/candidates'));
    await warmUp(() => discoveryCall('nearby'));
    const apiP95 = await measureP95(meCall, 30);
    const discoveryP95 = await measureP95(() => discoveryCall('discovery/candidates'), 30);
    const nearbyP95 = await measureP95(() => discoveryCall('nearby'), 30);
    const chatP95 = await measureP95(async (index) => {
      const response = await request(server)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set(auth)
        .send({
          clientMessageId: `load-smoke-message-${index}`,
          messageType: MessageType.TEXT,
          content: `Load smoke message ${index}`,
        });
      expect(response.status).toBe(201);
    }, 30);

    console.info(
      `load-smoke-p95-ms api=${apiP95.toFixed(1)} chat=${chatP95.toFixed(1)} discovery=${discoveryP95.toFixed(1)} nearby=${nearbyP95.toFixed(1)}`,
    );
    expect(apiP95).toBeLessThan(500);
    expect(chatP95).toBeLessThan(500);
    expect(discoveryP95).toBeLessThan(1_000);
    expect(nearbyP95).toBeLessThan(1_000);
  }, 30_000);
});

async function warmUp(operation: () => Promise<void>): Promise<void> {
  for (let index = 0; index < 3; index += 1) await operation();
}

async function measureP95(
  operation: (index: number) => Promise<void>,
  count: number,
): Promise<number> {
  const durations: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now();
    await operation(index);
    durations.push(performance.now() - startedAt);
  }
  durations.sort((left, right) => left - right);
  return durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)];
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
  const messages = await prisma.message.findMany({
    where: { conversationId: { in: conversationIds } },
    select: { id: true },
  });
  await prisma.notification.deleteMany({
    where: { OR: [{ recipientUserId: { in: USER_IDS } }, { actorUserId: { in: USER_IDS } }] },
  });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: conversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.outboxEvent.deleteMany({
    where: {
      aggregateId: {
        in: [...matchIds, ...conversationIds, ...messages.map((message) => message.id)],
      },
    },
  });
  await prisma.userRole.deleteMany({ where: { id: { in: USER_ROLE_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
}
