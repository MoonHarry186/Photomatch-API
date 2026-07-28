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
    tx.user.findUnique.mockResolvedValue({ accountStatus: AccountStatus.ACTIVE });
    tx.user.findUniqueOrThrow.mockResolvedValue({ id: 'user-1' });
    tx.authSession.updateMany.mockResolvedValue({ count: 1 });
    tx.outboxEvent.create.mockResolvedValue({ id: 'event-1' });
  });

  it('atomically suspends an active account and revokes its sessions', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 1 });

    await service.userStatus('admin-1', 'user-1', {
      status: AccountStatus.SUSPENDED,
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

  it('changes an active account directly to banned and revokes its sessions', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 1 });

    await service.userStatus('admin-1', 'user-1', {
      status: AccountStatus.BANNED,
      reason: 'Confirmed severe abuse',
    });

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', accountStatus: AccountStatus.ACTIVE },
      data: { accountStatus: AccountStatus.BANNED },
    });
    expect(tx.authSession.updateMany).toHaveBeenCalled();
  });

  it('restores a suspended account directly to active without revoking sessions', async () => {
    tx.user.findUnique.mockResolvedValue({ accountStatus: AccountStatus.SUSPENDED });
    tx.user.updateMany.mockResolvedValue({ count: 1 });

    await service.userStatus('admin-1', 'user-1', {
      status: AccountStatus.ACTIVE,
      reason: 'Restriction cleared',
    });

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', accountStatus: AccountStatus.SUSPENDED },
      data: { accountStatus: AccountStatus.ACTIVE },
    });
    expect(tx.authSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale transition and returns the current status', async () => {
    tx.user.findUnique
      .mockResolvedValueOnce({ accountStatus: AccountStatus.ACTIVE })
      .mockResolvedValueOnce({ accountStatus: AccountStatus.SUSPENDED });
    tx.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.userStatus('admin-1', 'user-1', {
        status: AccountStatus.BANNED,
        reason: 'Stale command',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'ACCOUNT_STATUS_CHANGED',
        details: {
          previousStatus: AccountStatus.ACTIVE,
          currentStatus: AccountStatus.SUSPENDED,
          requestedStatus: AccountStatus.BANNED,
        },
      },
      status: 409,
    });
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a no-op status change', async () => {
    await expect(
      service.userStatus('admin-1', 'user-1', {
        status: AccountStatus.ACTIVE,
        reason: 'No change',
      }),
    ).rejects.toMatchObject({
      response: { code: 'ACCOUNT_STATUS_UNCHANGED' },
      status: 409,
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('keeps deleted account state immutable', async () => {
    tx.user.findUnique.mockResolvedValue({ accountStatus: AccountStatus.DELETED });

    await expect(
      service.userStatus('admin-1', 'user-1', {
        status: AccountStatus.ACTIVE,
        reason: 'Restore deleted account',
      }),
    ).rejects.toMatchObject({
      response: { code: 'DELETED_ACCOUNT_STATUS_IMMUTABLE' },
      status: 409,
    });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('denies changing the current Admin account', async () => {
    await expect(
      service.userStatus('admin-1', 'admin-1', {
        status: AccountStatus.SUSPENDED,
        reason: 'Should fail',
      }),
    ).rejects.toMatchObject({ response: { code: 'SELF_STATUS_ACTION_DENIED' }, status: 403 });
    expect(prisma.transaction).not.toHaveBeenCalled();
  });
});
