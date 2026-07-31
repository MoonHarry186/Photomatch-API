import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  AccountStatus,
  MessageType,
  RoleCode,
  ServiceMode,
  SwipeDirection,
  SwipeSource,
  UploadAssetStatus,
  UploadIntentStatus,
  UploadPurpose,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/bootstrap';
import { ApiError } from '../../src/common/api-error';
import { PrismaService } from '../../src/database/prisma.service';
import { EligibilityService } from '../../src/profiles/eligibility.service';
import { PairOrchestrationService } from '../../src/relationships/pair-orchestration.service';

const CUSTOMER_ID = '96000000-0000-4000-8000-000000000001';
const PHOTOGRAPHER_ID = '96000000-0000-4000-8000-000000000002';
const STRANGER_ID = '96000000-0000-4000-8000-000000000003';
const CUSTOMER_ROLE_ID = '96000000-0000-4000-8000-000000000011';
const PHOTOGRAPHER_ROLE_ID = '96000000-0000-4000-8000-000000000012';
const STRANGER_ROLE_ID = '96000000-0000-4000-8000-000000000013';
const CUSTOMER_SESSION_ID = '96000000-0000-4000-8000-000000000021';
const PHOTOGRAPHER_SESSION_ID = '96000000-0000-4000-8000-000000000022';
const STRANGER_SESSION_ID = '96000000-0000-4000-8000-000000000023';

describe('interest, match, and chat journey (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pairs: PairOrchestrationService;
  let customerToken: string;
  let photographerToken: string;
  let strangerToken: string;
  let interestId: string;
  let matchId: string;
  let conversationId: string;
  let messageId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EligibilityService)
      .useValue({
        discovery: async () => ({ eligible: true, reasons: [] }),
        onboarding: async () => ({ complete: false, missing: [] }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    pairs = app.get(PairOrchestrationService);
    await cleanup(prisma);

    const customerRole = await prisma.role.findUniqueOrThrow({
      where: { code: RoleCode.CUSTOMER },
    });
    const photographerRole = await prisma.role.findUniqueOrThrow({
      where: { code: RoleCode.PHOTOGRAPHER },
    });
    await createUser(prisma, {
      userId: CUSTOMER_ID,
      userRoleId: CUSTOMER_ROLE_ID,
      sessionId: CUSTOMER_SESSION_ID,
      roleId: customerRole.id,
      email: 'interest-customer@photomatch.test',
    });
    await createUser(prisma, {
      userId: PHOTOGRAPHER_ID,
      userRoleId: PHOTOGRAPHER_ROLE_ID,
      sessionId: PHOTOGRAPHER_SESSION_ID,
      roleId: photographerRole.id,
      email: 'interest-photographer@photomatch.test',
      photographer: true,
    });
    await createUser(prisma, {
      userId: STRANGER_ID,
      userRoleId: STRANGER_ROLE_ID,
      sessionId: STRANGER_SESSION_ID,
      roleId: customerRole.id,
      email: 'interest-stranger@photomatch.test',
    });
    await makePhotographerDiscoverable(prisma);
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

  it('excludes LEFT cooldown candidates and restores them after expiry', async () => {
    await globalCandidates(app, customerToken)
      .expect(200)
      .expect(({ body }) =>
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              userRoleId: PHOTOGRAPHER_ROLE_ID,
              distance: null,
            }),
          ]),
        ),
      );
    await candidates(app, customerToken)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(0);
      });
    await request(app.getHttpServer())
      .put('/api/v1/me/location')
      .set('authorization', `Bearer ${customerToken}`)
      .send({ latitude: 21.0278, longitude: 105.8342 })
      .expect(200);
    await request(app.getHttpServer())
      .put('/api/v1/me/location')
      .set('authorization', `Bearer ${photographerToken}`)
      .send({ latitude: 21.028, longitude: 105.8344 })
      .expect(200);
    await request(app.getHttpServer())
      .put('/api/v1/me/discovery-presence')
      .set('authorization', `Bearer ${photographerToken}`)
      .send({ userRoleId: PHOTOGRAPHER_ROLE_ID, enabled: true, visibilityHours: 24 })
      .expect(200);

    const candidatesBefore = await candidates(app, customerToken);
    expect(candidatesBefore.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ userRoleId: PHOTOGRAPHER_ROLE_ID })]),
    );
    const left = await request(app.getHttpServer())
      .post('/api/v1/swipes')
      .set('authorization', `Bearer ${customerToken}`)
      .send({
        targetUserRoleId: PHOTOGRAPHER_ROLE_ID,
        direction: SwipeDirection.LEFT,
        source: SwipeSource.DISCOVERY,
      })
      .expect(201);
    const candidatesDuring = await candidates(app, customerToken);
    expect(candidatesDuring.body.items).toHaveLength(0);

    await prisma.swipe.update({
      where: { id: left.body.id as string },
      data: { effectiveUntil: new Date(Date.now() - 1_000) },
    });
    const candidatesAfter = await candidates(app, customerToken);
    expect(candidatesAfter.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ userRoleId: PHOTOGRAPHER_ROLE_ID })]),
    );
  });

  it('feature-gates Photographer RIGHT without a persisted side effect', async () => {
    const before = await prisma.swipe.count();
    await request(app.getHttpServer())
      .post('/api/v1/swipes')
      .set('authorization', `Bearer ${photographerToken}`)
      .send({
        targetUserRoleId: CUSTOMER_ROLE_ID,
        direction: SwipeDirection.RIGHT,
        source: SwipeSource.PROFILE,
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('FEATURE_NOT_AVAILABLE'));
    await expect(prisma.swipe.count()).resolves.toBe(before);
  });

  it('creates an interest without a match, then accepts concurrently into one pair', async () => {
    const interest = await request(app.getHttpServer())
      .post('/api/v1/swipes')
      .set('authorization', `Bearer ${customerToken}`)
      .send({
        targetUserRoleId: PHOTOGRAPHER_ROLE_ID,
        direction: SwipeDirection.RIGHT,
        source: SwipeSource.DISCOVERY,
      })
      .expect(201);
    interestId = interest.body.id as string;
    await expect(
      prisma.match.count({
        where: {
          OR: [
            {
              userRoleAId: { in: [CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID] },
            },
            {
              userRoleBId: { in: [CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID] },
            },
          ],
        },
      }),
    ).resolves.toBe(0);

    const incoming = await request(app.getHttpServer())
      .get('/api/v1/interests/incoming')
      .set('authorization', `Bearer ${photographerToken}`)
      .expect(200);
    expect(incoming.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: interestId,
          customer: expect.objectContaining({
            userRoleId: CUSTOMER_ROLE_ID,
          }),
        }),
      ]),
    );

    const decisions = await Promise.all(
      ['accept-interest-a', 'accept-interest-b'].map((idempotencyKey) =>
        request(app.getHttpServer())
          .post(`/api/v1/interests/${interestId}/decision`)
          .set('authorization', `Bearer ${photographerToken}`)
          .set('idempotency-key', idempotencyKey)
          .send({ decision: SwipeDirection.ACCEPT }),
      ),
    );
    for (const response of decisions) expect(response.status).toBe(201);
    for (const response of decisions) expect(response.body.interestId).toBe(interestId);
    expect(decisions[0].body.matchId).toBe(decisions[1].body.matchId);
    matchId = decisions[0].body.matchId as string;
    conversationId = decisions[0].body.conversationId as string;
    await expect(
      prisma.match.count({
        where: {
          OR: [
            {
              userRoleAId: { in: [CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID] },
            },
            {
              userRoleBId: { in: [CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID] },
            },
          ],
        },
      }),
    ).resolves.toBe(1);
    await expect(prisma.conversation.count({ where: { matchId } })).resolves.toBe(1);
    await expect(
      prisma.swipe.count({
        where: {
          actorUserRoleId: PHOTOGRAPHER_ROLE_ID,
          targetUserRoleId: CUSTOMER_ROLE_ID,
          direction: SwipeDirection.ACCEPT,
        },
      }),
    ).resolves.toBe(1);
  });

  it('enforces participation and deduplicates concurrent text sends', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conversationId}`)
      .set('authorization', `Bearer ${strangerToken}`)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('CONVERSATION_ACCESS_DENIED'));

    const sends = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post(`/api/v1/conversations/${conversationId}/messages`)
          .set('authorization', `Bearer ${customerToken}`)
          .send({
            clientMessageId: 'interest-chat-message-1',
            messageType: MessageType.TEXT,
            content: 'Hello from the interest journey',
          }),
      ),
    );
    for (const response of sends) expect(response.status).toBe(201);
    expect(sends[0].body.id).toBe(sends[1].body.id);
    messageId = sends[0].body.id as string;
    await expect(prisma.message.count({ where: { senderUserId: CUSTOMER_ID } })).resolves.toBe(1);

    const strangerAsset = await createAsset(prisma, STRANGER_ID);
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('authorization', `Bearer ${customerToken}`)
      .send({
        clientMessageId: 'interest-chat-foreign-asset',
        messageType: MessageType.IMAGE,
        assetId: strangerAsset,
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('ASSET_ATTACH_DENIED'));
    await request(app.getHttpServer())
      .patch(`/api/v1/conversations/${conversationId}/messages/${messageId}`)
      .set('authorization', `Bearer ${customerToken}`)
      .send({ content: 'edited' })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/conversations/${conversationId}/messages/${messageId}`)
      .set('authorization', `Bearer ${customerToken}`)
      .expect(404);
  });

  it('honors read-receipt privacy and closes chat after idempotent unmatch', async () => {
    await prisma.userSettings.update({
      where: { userId: PHOTOGRAPHER_ID },
      data: { readReceiptsEnabled: false },
    });
    await request(app.getHttpServer())
      .put(`/api/v1/conversations/${conversationId}/messages/${messageId}/receipt`)
      .set('authorization', `Bearer ${photographerToken}`)
      .send({ type: 'read' })
      .expect(200)
      .expect(({ body }) => expect(body.readReceiptShared).toBe(false));
    await expect(
      prisma.messageReceipt.findUnique({
        where: { messageId_userId: { messageId, userId: PHOTOGRAPHER_ID } },
      }),
    ).resolves.toEqual(expect.objectContaining({ readAt: null }));

    for (let index = 0; index < 2; index += 1) {
      await request(app.getHttpServer())
        .post(`/api/v1/matches/${matchId}/unmatch`)
        .set('authorization', `Bearer ${customerToken}`)
        .set('idempotency-key', 'interest-unmatch-e2e')
        .send({ reason: 'Journey complete' })
        .expect(201)
        .expect(({ body }) =>
          expect(body).toEqual(
            expect.objectContaining({
              id: matchId,
              status: 'ENDED',
              counterpart: expect.objectContaining({ userRoleId: PHOTOGRAPHER_ROLE_ID }),
              conversation: expect.objectContaining({
                id: conversationId,
                status: 'CLOSED',
              }),
            }),
          ),
        );
    }
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('authorization', `Bearer ${photographerToken}`)
      .send({
        clientMessageId: 'after-unmatch',
        messageType: MessageType.TEXT,
        content: 'Should not send',
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('CONVERSATION_ACCESS_DENIED'));
    await request(app.getHttpServer())
      .get(`/api/v1/conversations/${conversationId}/messages`)
      .set('authorization', `Bearer ${customerToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(1));
    try {
      await pairs.ensurePair(CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID);
      throw new Error('Expected rematch cooldown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).getResponse()).toEqual(
        expect.objectContaining({ code: 'REMATCH_COOLDOWN' }),
      );
    }

    const blockedPair = await pairs.ensurePair(STRANGER_ROLE_ID, PHOTOGRAPHER_ROLE_ID);
    await request(app.getHttpServer())
      .put('/api/v1/me/location')
      .set('authorization', `Bearer ${strangerToken}`)
      .send({ latitude: 21.0279, longitude: 105.8343 })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/discovery/candidates')
      .set('authorization', `Bearer ${strangerToken}`)
      .query({ targetRole: RoleCode.PHOTOGRAPHER, radiusKm: 20 })
      .expect(200)
      .expect(({ body }) =>
        expect(body.items).toEqual(
          expect.arrayContaining([expect.objectContaining({ userRoleId: PHOTOGRAPHER_ROLE_ID })]),
        ),
      );
    await request(app.getHttpServer())
      .post('/api/v1/blocks')
      .set('authorization', `Bearer ${strangerToken}`)
      .set('idempotency-key', 'interest-block-e2e')
      .send({ blockedUserId: PHOTOGRAPHER_ID, reason: 'Blocked chat e2e' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/discovery/candidates')
      .set('authorization', `Bearer ${strangerToken}`)
      .query({ targetRole: RoleCode.PHOTOGRAPHER, radiusKm: 20 })
      .expect(200)
      .expect(({ body }) =>
        expect(body.items).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ userRoleId: PHOTOGRAPHER_ROLE_ID })]),
        ),
      );
    await request(app.getHttpServer())
      .post(`/api/v1/conversations/${blockedPair.conversationId}/messages`)
      .set('authorization', `Bearer ${strangerToken}`)
      .send({
        clientMessageId: 'blocked-conversation-message',
        messageType: MessageType.TEXT,
        content: 'Should not send',
      })
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('CONVERSATION_ACCESS_DENIED'));
    await expect(
      prisma.match.findUniqueOrThrow({ where: { id: blockedPair.matchId } }),
    ).resolves.toEqual(expect.objectContaining({ status: 'BLOCKED' }));
    await expect(
      prisma.conversation.findUniqueOrThrow({ where: { id: blockedPair.conversationId } }),
    ).resolves.toEqual(expect.objectContaining({ status: 'BLOCKED' }));
  });
});

function candidates(app: INestApplication, token: string) {
  return request(app.getHttpServer())
    .get('/api/v1/discovery/candidates')
    .set('authorization', `Bearer ${token}`)
    .query({ targetRole: RoleCode.PHOTOGRAPHER, radiusKm: 20 });
}

function globalCandidates(app: INestApplication, token: string) {
  return request(app.getHttpServer())
    .get('/api/v1/discovery/candidates')
    .set('authorization', `Bearer ${token}`)
    .query({ targetRole: RoleCode.PHOTOGRAPHER });
}

async function makePhotographerDiscoverable(prisma: PrismaService): Promise<void> {
  const service = await prisma.service.findFirstOrThrow({
    where: { status: 'ACTIVE' },
  });
  await prisma.userRoleService.create({
    data: {
      userRoleId: PHOTOGRAPHER_ROLE_ID,
      serviceId: service.id,
      serviceMode: ServiceMode.OFFERED,
      minPrice: 500_000,
      maxPrice: 2_000_000,
      currency: 'VND',
      isActive: true,
    },
  });
  for (let index = 0; index < 6; index += 1) {
    const assetId = await createAsset(
      prisma,
      PHOTOGRAPHER_ID,
      UploadPurpose.PORTFOLIO,
      `portfolio-${index}`,
    );
    await prisma.portfolioItem.create({
      data: {
        userRoleId: PHOTOGRAPHER_ROLE_ID,
        serviceId: service.id,
        assetId,
        sortOrder: index,
      },
    });
  }
}

async function createUser(
  prisma: PrismaService,
  fixture: {
    userId: string;
    userRoleId: string;
    sessionId: string;
    roleId: string;
    email: string;
    photographer?: boolean;
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
          ...(fixture.photographer ? { photographerProfile: { create: {} } } : {}),
        },
      },
      authSessions: {
        create: {
          id: fixture.sessionId,
          refreshTokenHash: 'unused-in-interest-e2e',
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

async function createAsset(
  prisma: PrismaService,
  ownerUserId: string,
  purpose: UploadPurpose = UploadPurpose.CHAT_IMAGE,
  suffix = 'foreign',
): Promise<string> {
  const objectKey = `interest-e2e/${ownerUserId}/${suffix}.jpg`;
  const intent = await prisma.uploadIntent.create({
    data: {
      ownerUserId,
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
          ownerUserId,
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
  const roleIds = [CUSTOMER_ROLE_ID, PHOTOGRAPHER_ROLE_ID, STRANGER_ROLE_ID];
  const userIds = [CUSTOMER_ID, PHOTOGRAPHER_ID, STRANGER_ID];
  const matches = await prisma.match.findMany({
    where: { OR: [{ userRoleAId: { in: roleIds } }, { userRoleBId: { in: roleIds } }] },
    select: {
      id: true,
      conversation: { select: { id: true, messages: { select: { id: true } } } },
    },
  });
  const matchIds = matches.map((item) => item.id);
  const conversationIds = matches.flatMap((item) =>
    item.conversation ? [item.conversation.id] : [],
  );
  const messageIds = matches.flatMap(
    (item) => item.conversation?.messages.map((message) => message.id) ?? [],
  );
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: { in: conversationIds } },
  });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.idempotencyRecord.deleteMany({ where: { actorKey: { in: userIds } } });
  await prisma.outboxEvent.deleteMany({
    where: { aggregateId: { in: [...matchIds, ...conversationIds, ...messageIds] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
