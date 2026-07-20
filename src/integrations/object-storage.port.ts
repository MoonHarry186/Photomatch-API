export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
}

export interface StoredObjectMetadata {
  sizeBytes: number;
  mimeType?: string;
  checksum?: string;
}

export abstract class ObjectStoragePort {
  abstract presignPut(
    objectKey: string,
    mimeType: string,
    expiresInSeconds: number,
  ): Promise<PresignedUpload>;
  abstract head(objectKey: string): Promise<StoredObjectMetadata>;
  abstract presignGet(objectKey: string, expiresInSeconds: number): Promise<string>;
  abstract remove(objectKey: string): Promise<void>;
}
