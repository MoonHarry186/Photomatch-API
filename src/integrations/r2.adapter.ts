import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ObjectStoragePort, PresignedUpload, StoredObjectMetadata } from './object-storage.port';

@Injectable()
export class R2Adapter implements ObjectStoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('R2_BUCKET');
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('R2_ENDPOINT'),
      region: config.getOrThrow<string>('R2_REGION'),
      forcePathStyle: config.get<boolean>('R2_FORCE_PATH_STYLE', false),
      credentials: {
        accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  async presignPut(
    objectKey: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: mimeType,
    });
    return {
      url: await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds }),
      headers: { 'content-type': mimeType },
    };
  }

  async head(objectKey: string): Promise<StoredObjectMetadata> {
    const result = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    return {
      sizeBytes: result.ContentLength ?? 0,
      mimeType: result.ContentType,
      checksum: result.ChecksumSHA256 ?? result.ETag?.replaceAll('"', ''),
    };
  }

  presignGet(objectKey: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds },
    );
  }

  async remove(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }
}
