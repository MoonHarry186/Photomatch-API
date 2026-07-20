import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('database transaction rollback', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  afterAll(async () => prisma.$disconnect());

  it('rolls back every write when the transaction throws', async () => {
    const marker = `rollback-${Date.now()}@example.com`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { email: marker } });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    await expect(prisma.user.findUnique({ where: { email: marker } })).resolves.toBeNull();
  });
});
