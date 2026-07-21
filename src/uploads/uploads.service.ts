import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadAssetStatus, UploadIntentStatus, UploadPurpose } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import { ObjectStoragePort } from '../integrations/object-storage.port';
import { CompleteUploadDto, PresignUploadDto } from './uploads.dto';
import { UPLOAD_POLICIES } from './upload-policy';

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStoragePort,
    private readonly config: ConfigService,
  ) {}

  async presign(userId: string, dto: PresignUploadDto) {
    const extension = dto.extension.toLowerCase().replace(/^\./, '');
    const policy = UPLOAD_POLICIES[dto.purpose];
    if (!policy.mimeExtensions[dto.mimeType]?.includes(extension)) {
      throw new ApiError(
        'UNSUPPORTED_MEDIA_TYPE',
        'MIME type and extension are not allowed together',
      );
    }
    if (dto.sizeBytes > policy.maximumSizeBytes) {
      throw new ApiError(
        'UPLOAD_TOO_LARGE',
        'Upload exceeds the maximum allowed size',
        HttpStatus.PAYLOAD_TOO_LARGE,
        { maximumSizeBytes: policy.maximumSizeBytes },
      );
    }
    const id = randomUUID();
    const objectKey = `${this.config.get<string>('NODE_ENV', 'development')}/${userId}/${dto.purpose.toLowerCase()}/${id}.${extension}`;
    const expiresIn = 15 * 60;
    const intent = await this.prisma.uploadIntent.create({
      data: {
        id,
        ownerUserId: userId,
        purpose: dto.purpose,
        objectKey,
        mimeType: dto.mimeType,
        extension,
        expectedSizeBytes: BigInt(dto.sizeBytes),
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      },
    });
    const signed = await this.storage.presignPut(objectKey, dto.mimeType, expiresIn);
    return {
      uploadId: intent.id,
      objectKey,
      uploadUrl: signed.url,
      requiredHeaders: signed.headers,
      expiresAt: intent.expiresAt,
    };
  }

  async complete(userId: string, uploadId: string, dto: CompleteUploadDto) {
    const intent = await this.prisma.uploadIntent.findFirst({
      where: { id: uploadId, ownerUserId: userId },
      include: { asset: true },
    });
    if (!intent) throw ApiError.notFound('Upload');
    if (intent.asset) return this.serializeAsset(intent.asset);
    if (intent.status !== UploadIntentStatus.PENDING || intent.expiresAt <= new Date()) {
      throw ApiError.conflict('UPLOAD_NOT_COMPLETABLE', 'Upload is expired or no longer pending');
    }

    let metadata;
    try {
      metadata = await this.storage.head(intent.objectKey);
    } catch {
      throw new ApiError('UPLOAD_OBJECT_MISSING', 'Uploaded object could not be verified');
    }
    if (
      metadata.sizeBytes !== Number(intent.expectedSizeBytes) ||
      metadata.mimeType !== intent.mimeType
    ) {
      await this.prisma.uploadIntent.update({
        where: { id: intent.id },
        data: { status: UploadIntentStatus.REJECTED },
      });
      throw new ApiError(
        'UPLOAD_METADATA_MISMATCH',
        'Uploaded object metadata does not match the intent',
      );
    }
    if (dto.checksum && metadata.checksum && dto.checksum !== metadata.checksum) {
      throw new ApiError('UPLOAD_CHECKSUM_MISMATCH', 'Uploaded object checksum does not match');
    }
    const asset = await this.prisma.transaction(async (tx) => {
      await tx.uploadIntent.update({
        where: { id: intent.id },
        data: { status: UploadIntentStatus.COMPLETED, completedAt: new Date() },
      });
      return tx.uploadAsset.create({
        data: {
          uploadIntentId: intent.id,
          ownerUserId: userId,
          purpose: intent.purpose,
          objectKey: intent.objectKey,
          mimeType: intent.mimeType,
          sizeBytes: BigInt(metadata.sizeBytes),
          checksum: metadata.checksum ?? dto.checksum,
          status: UploadAssetStatus.USABLE,
          isPublic: UPLOAD_POLICIES[intent.purpose].publicAllowed,
        },
      });
    });
    return this.serializeAsset(asset);
  }

  async accessUrl(userId: string, assetId: string, adminEvidenceAccess = false) {
    const asset = await this.prisma.uploadAsset.findUnique({
      where: { id: assetId },
      include: { reportEvidence: { select: { reportId: true }, take: 1 } },
    });
    if (!asset || asset.status !== UploadAssetStatus.USABLE) throw ApiError.notFound('Asset');
    const canInspectReportEvidence = adminEvidenceAccess && asset.reportEvidence.length > 0;
    if (!asset.isPublic && asset.ownerUserId !== userId && !canInspectReportEvidence) {
      throw ApiError.forbidden('ASSET_ACCESS_DENIED', 'Asset is private');
    }
    const publicBase = this.config.get<string>('R2_PUBLIC_BASE_URL');
    if (asset.isPublic && publicBase) {
      return { url: `${publicBase.replace(/\/$/, '')}/${asset.objectKey}`, expiresAt: null };
    }
    const expiresIn = 5 * 60;
    return {
      url: await this.storage.presignGet(asset.objectKey, expiresIn),
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  async assertUsableOwnedAsset(userId: string, assetId: string, purposes: UploadPurpose[]) {
    const asset = await this.prisma.uploadAsset.findFirst({
      where: {
        id: assetId,
        ownerUserId: userId,
        purpose: { in: purposes },
        status: UploadAssetStatus.USABLE,
      },
    });
    if (!asset)
      throw ApiError.forbidden(
        'ASSET_ATTACH_DENIED',
        'Asset is unavailable or not owned by the actor',
      );
    return asset;
  }

  private serializeAsset(asset: {
    id: string;
    purpose: UploadPurpose;
    mimeType: string;
    sizeBytes: bigint;
    status: UploadAssetStatus;
    isPublic: boolean;
    createdAt: Date;
  }) {
    return {
      id: asset.id,
      purpose: asset.purpose,
      mimeType: asset.mimeType,
      sizeBytes: Number(asset.sizeBytes),
      status: asset.status,
      isPublic: asset.isPublic,
      createdAt: asset.createdAt,
    };
  }
}
