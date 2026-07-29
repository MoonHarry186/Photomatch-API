import { RoleCode, RoleStatus } from '@prisma/client';
import { AdminService } from '../../src/admin/admin.service';
import { PrismaService } from '../../src/database/prisma.service';
import { TrustService } from '../../src/trust/trust.service';

describe('AdminService roles', () => {
  const prisma = {
    role: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    {} as unknown as TrustService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists roles with relationship counts and server-side filters', async () => {
    prisma.role.findMany.mockResolvedValue([]);

    await service.roles({
      limit: 20,
      search: 'photographer',
      status: RoleStatus.ACTIVE,
    });

    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: RoleStatus.ACTIVE,
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([{ code: RoleCode.PHOTOGRAPHER }]),
            }),
          ]),
        }),
        include: {
          _count: { select: { userRoles: true, allowedFields: true } },
        },
        take: 21,
      }),
    );
  });

  it('updates mutable role properties and keeps the code immutable', async () => {
    prisma.role.findUnique.mockResolvedValue({ code: RoleCode.CUSTOMER });
    prisma.role.update.mockResolvedValue({ id: 'role-1' });

    await service.updateRole('role-1', {
      name: ' Khách hàng ',
      description: ' Người thuê dịch vụ ',
      status: RoleStatus.INACTIVE,
    });

    expect(prisma.role.update).toHaveBeenCalledWith({
      where: { id: 'role-1' },
      data: {
        name: 'Khách hàng',
        description: 'Người thuê dịch vụ',
        status: RoleStatus.INACTIVE,
      },
      include: {
        _count: { select: { userRoles: true, allowedFields: true } },
      },
    });
  });

  it('never allows the administrator role to be disabled', async () => {
    prisma.role.findUnique.mockResolvedValue({ code: RoleCode.ADMIN });

    await expect(
      service.updateRole('role-admin', { status: RoleStatus.INACTIVE }),
    ).rejects.toMatchObject({
      response: { code: 'ADMIN_ROLE_CANNOT_BE_DISABLED' },
      status: 409,
    });
    expect(prisma.role.update).not.toHaveBeenCalled();
  });
});
