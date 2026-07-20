import { AccountStatus, AuthProvider, PrismaClient, RoleCode, RoleStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error(
      'ADMIN_BOOTSTRAP_EMAIL and a 12+ character ADMIN_BOOTSTRAP_PASSWORD are required',
    );
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { code: RoleCode.ADMIN } });
    const user = await tx.user.upsert({
      where: { email },
      create: {
        email,
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        profile: { create: { displayName: 'Photomatch Admin' } },
        settings: { create: {} },
      },
      update: {
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
      },
    });
    await tx.authIdentity.upsert({
      where: { provider_email: { provider: AuthProvider.EMAIL, email } },
      create: { userId: user.id, provider: AuthProvider.EMAIL, email, passwordHash },
      update: { userId: user.id, passwordHash },
    });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id, status: RoleStatus.ACTIVE },
      update: { status: RoleStatus.ACTIVE },
    });
  });

  process.stdout.write('Admin account is ready. Credentials were not logged.\n');
}

main()
  .catch((error) => {
    process.stderr.write(
      `Admin bootstrap failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
