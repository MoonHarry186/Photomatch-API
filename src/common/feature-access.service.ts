import { Injectable } from '@nestjs/common';
import { PenaltyStatus, PenaltyType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ApiError } from './api-error';

@Injectable()
export class FeatureAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAllowed(userId: string, featureCode: string): Promise<void> {
    const penalty = await this.prisma.accountPenalty.findFirst({
      where: {
        userId,
        status: PenaltyStatus.ACTIVE,
        startsAt: { lte: new Date() },
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
        AND: [
          {
            OR: [
              { penaltyType: PenaltyType.TEMPORARY_SUSPENSION },
              { penaltyType: PenaltyType.PERMANENT_BAN },
              { penaltyType: PenaltyType.FEATURE_RESTRICTION, featureCode },
            ],
          },
        ],
      },
      select: { id: true, penaltyType: true, featureCode: true, endsAt: true },
    });
    if (penalty) {
      throw ApiError.forbidden('FEATURE_RESTRICTED', 'This feature is currently restricted');
    }
  }
}
