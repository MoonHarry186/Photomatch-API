import { Injectable } from '@nestjs/common';
import { CatalogStatus, RoleCode, RoleStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  cities() {
    return this.prisma.city.findMany({
      where: { status: CatalogStatus.ACTIVE },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  fields(role?: RoleCode) {
    return this.prisma.activityField.findMany({
      where: {
        status: CatalogStatus.ACTIVE,
        ...(role
          ? { roleMappings: { some: { role: { code: role, status: RoleStatus.ACTIVE } } } }
          : {}),
      },
      select: { id: true, code: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
  }

  services(activityFieldId?: string) {
    return this.prisma.service.findMany({
      where: {
        status: CatalogStatus.ACTIVE,
        ...(activityFieldId ? { activityFieldId } : {}),
      },
      select: { id: true, code: true, name: true, description: true, activityFieldId: true },
      orderBy: { name: 'asc' },
    });
  }

  currentLegal() {
    return this.prisma.legalDocument.findMany({
      where: { status: CatalogStatus.ACTIVE, effectiveAt: { lte: new Date() } },
      select: { id: true, documentType: true, version: true, contentUrl: true, effectiveAt: true },
      orderBy: { documentType: 'asc' },
    });
  }
}
