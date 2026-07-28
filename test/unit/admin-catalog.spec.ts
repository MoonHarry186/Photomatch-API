import { CatalogStatus } from '@prisma/client';
import { AdminService } from '../../src/admin/admin.service';
import { PrismaService } from '../../src/database/prisma.service';
import { TrustService } from '../../src/trust/trust.service';

describe('AdminService catalog relationships', () => {
  const tx = {
    activityField: {
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    role: { findMany: jest.fn() },
    roleActivityField: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const prisma = {
    activityField: {
      findFirst: jest.fn(),
    },
    service: {
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    {} as unknown as TrustService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.activityField.findFirst.mockResolvedValue({ id: 'field-2' });
    prisma.service.count.mockResolvedValue(0);
    prisma.service.findUnique.mockResolvedValue({
      activityFieldId: 'field-1',
      _count: {
        userSelections: 0,
        portfolioItems: 0,
        filterSelections: 0,
        shootRequests: 0,
        bookings: 0,
      },
    });
    prisma.service.update.mockResolvedValue({
      id: 'service-1',
      activityFieldId: 'field-2',
    });
  });

  it('moves an unreferenced service to an active activity field', async () => {
    await service.updateService('service-1', { activityFieldId: 'field-2' });

    expect(prisma.activityField.findFirst).toHaveBeenCalledWith({
      where: { id: 'field-2', status: CatalogStatus.ACTIVE },
      select: { id: true },
    });
    expect(prisma.service.update).toHaveBeenCalledWith({
      where: { id: 'service-1' },
      data: {
        activityFieldId: 'field-2',
        name: undefined,
        description: undefined,
        status: undefined,
      },
      include: { activityField: true },
    });
  });

  it('rejects moving a service that already has business references', async () => {
    prisma.service.findUnique.mockResolvedValue({
      activityFieldId: 'field-1',
      _count: {
        userSelections: 1,
        portfolioItems: 0,
        filterSelections: 0,
        shootRequests: 0,
        bookings: 1,
      },
    });

    await expect(
      service.updateService('service-1', { activityFieldId: 'field-2' }),
    ).rejects.toMatchObject({
      response: {
        code: 'SERVICE_FIELD_LOCKED',
        details: { referenceCount: 2 },
      },
      status: 409,
    });
    expect(prisma.service.update).not.toHaveBeenCalled();
  });

  it('requires child services to be archived before archiving a field', async () => {
    prisma.service.count.mockResolvedValue(3);

    await expect(
      service.updateActivityField('field-1', {
        status: CatalogStatus.ARCHIVED,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'ACTIVITY_FIELD_HAS_SERVICES',
        details: { activeServiceCount: 3 },
      },
      status: 409,
    });
    expect(prisma.transaction).not.toHaveBeenCalled();
  });
});
