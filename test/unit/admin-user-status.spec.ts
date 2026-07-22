import { AccountStatus } from '@prisma/client';
import { AdminService } from '../../src/admin/admin.service';
import { PrismaService } from '../../src/database/prisma.service';
import { TrustService } from '../../src/trust/trust.service';

describe('AdminService user status', () => {
  const tx = {
    user: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    authSession: { updateMany: jest.fn() },
    outboxEvent: { create: jest.fn() },
  };
  const prisma = {
    transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    {} as unknown as TrustService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1' });
    tx.authSession.updateMany.mockResolvedValue({ count: 1 });
    tx.outboxEvent.create.mockResolvedValue({ id: 'event-1' });
  });

  it('atomically suspends an active account and revokes its sessions', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 1 });

    await service.userStatus('admin-1', 'user-1', {
      action: 'SUSPEND',
      reason: 'Safety investigation',
    });

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', accountStatus: AccountStatus.ACTIVE },
      data: { accountStatus: AccountStatus.SUSPENDED },
    });
    expect(tx.authSession.updateMany).toHaveBeenCalled();
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aggregateId: 'user-1',
        payload: expect.objectContaining({
          previousStatus: AccountStatus.ACTIVE,
          newStatus: AccountStatus.SUSPENDED,
        }),
      }),
    });
  });

  it('restores only a suspended account without revoking sessions', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 1 });

    await service.userStatus('admin-1', 'user-1', {
      action: 'RESTORE',
      reason: 'Restriction cleared',
    });

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', accountStatus: AccountStatus.SUSPENDED },
      data: { accountStatus: AccountStatus.ACTIVE },
    });
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale transition and returns the current status', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    tx.user.findUnique.mockResolvedValue({ accountStatus: AccountStatus.SUSPENDED });

    await expect(
      service.userStatus('admin-1', 'user-1', {
        action: 'SUSPEND',
        reason: 'Stale command',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'ACCOUNT_STATUS_CHANGED',
        details: {
          expectedStatus: AccountStatus.ACTIVE,
          currentStatus: AccountStatus.SUSPENDED,
        },
      },
      status: 409,
    });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('denies changing the current Admin account', async () => {
    await expect(
      service.userStatus('admin-1', 'admin-1', {
        action: 'SUSPEND',
        reason: 'Should fail',
      }),
    ).rejects.toMatchObject({ response: { code: 'SELF_STATUS_ACTION_DENIED' }, status: 403 });
    expect(prisma.transaction).not.toHaveBeenCalled();
  });
});
