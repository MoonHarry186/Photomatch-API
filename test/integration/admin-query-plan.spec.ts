import {
  AccountStatus,
  IdentityVerificationStatus,
  PenaltyStatus,
  PenaltyType,
  Prisma,
  ReportReasonCode,
  ReportStatus,
} from '@prisma/client';
import { PrismaService } from '../../src/database/prisma.service';

const ACTOR_ID = '99000000-0000-4000-8000-000000000001';
const EMAIL_SUFFIX = '@admin-query-plan.test';
const ROW_COUNT = 1_500;

describe('admin combined-filter query plans (integration)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await cleanup(prisma);
    await seedVolume(prisma);
    await prisma.$executeRawUnsafe('ANALYZE users, user_reports, account_penalties');
  }, 60_000);

  afterAll(async () => {
    await cleanup(prisma);
    await prisma.$disconnect();
  }, 60_000);

  it.each([
    {
      expectedIndex: 'users_account_status_created_at_idx',
      sql: Prisma.sql`
        SELECT id FROM users
        WHERE account_status = 'ACTIVE'::"AccountStatus"
        ORDER BY created_at DESC
        LIMIT 51
      `,
    },
    {
      expectedIndex: 'user_reports_reason_code_status_created_at_idx',
      sql: Prisma.sql`
        SELECT id FROM user_reports
        WHERE reason_code = 'SPAM'::"ReportReasonCode"
          AND status = 'OPEN'::"ReportStatus"
        ORDER BY created_at DESC
        LIMIT 51
      `,
    },
    {
      expectedIndex: 'account_penalties_penalty_type_status_starts_at_idx',
      sql: Prisma.sql`
        SELECT id FROM account_penalties
        WHERE penalty_type = 'WARNING'::"PenaltyType"
          AND status = 'ACTIVE'::"PenaltyStatus"
        ORDER BY starts_at DESC
        LIMIT 51
      `,
    },
  ])('uses $expectedIndex', async ({ expectedIndex, sql }) => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<Array<Record<'QUERY PLAN', string>>>(
        Prisma.sql`EXPLAIN (FORMAT TEXT) ${sql}`,
      );
    });
    const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    expect(plan).toContain(expectedIndex);
  });
});

async function seedVolume(prisma: PrismaService): Promise<void> {
  const users = Array.from({ length: ROW_COUNT }, (_, index) => ({
    id: fixtureId(index + 2),
    email: `admin-query-${index + 1}${EMAIL_SUFFIX}`,
    emailVerified: true,
    accountStatus: AccountStatus.ACTIVE,
    identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
  }));
  await prisma.user.createMany({
    data: [
      {
        id: ACTOR_ID,
        email: `admin-query-actor${EMAIL_SUFFIX}`,
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      ...users,
    ],
  });
  await prisma.userReport.createMany({
    data: users.map((user, index) => ({
      id: fixtureId(index + ROW_COUNT + 2),
      reporterUserId: ACTOR_ID,
      reportedUserId: user.id,
      reasonCode: Object.values(ReportReasonCode)[index % Object.values(ReportReasonCode).length],
      description: 'Representative admin query-plan fixture',
      status: index % 4 === 0 ? ReportStatus.OPEN : ReportStatus.IN_REVIEW,
    })),
  });
  await prisma.accountPenalty.createMany({
    data: users.map((user, index) => ({
      id: fixtureId(index + ROW_COUNT * 2 + 2),
      userId: user.id,
      imposedByUserId: ACTOR_ID,
      penaltyType: PenaltyType.WARNING,
      reason: 'Representative admin query-plan fixture',
      status: PenaltyStatus.ACTIVE,
      startsAt: new Date(Date.now() - index * 1_000),
    })),
  });
}

function fixtureId(sequence: number): string {
  return `99000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const fixtureUsers = await prisma.user.findMany({
    where: { email: { endsWith: EMAIL_SUFFIX } },
    select: { id: true },
  });
  const userIds = fixtureUsers.map(({ id }) => id);
  if (userIds.length === 0) return;
  await prisma.accountPenalty.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userReport.deleteMany({
    where: { OR: [{ reporterUserId: { in: userIds } }, { reportedUserId: { in: userIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
