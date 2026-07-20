import { UploadPurpose } from '@prisma/client';

interface MediaPolicy {
  mimeExtensions: Record<string, string[]>;
  maximumSizeBytes: number;
  retentionDaysAfterOrphaned: number;
  publicAllowed: boolean;
}

export const UPLOAD_POLICIES: Record<UploadPurpose, MediaPolicy> = {
  [UploadPurpose.AVATAR]: {
    mimeExtensions: { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] },
    maximumSizeBytes: 10 * 1024 * 1024,
    retentionDaysAfterOrphaned: 7,
    publicAllowed: true,
  },
  [UploadPurpose.PORTFOLIO]: {
    mimeExtensions: { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] },
    maximumSizeBytes: 25 * 1024 * 1024,
    retentionDaysAfterOrphaned: 30,
    publicAllowed: true,
  },
  [UploadPurpose.CHAT_IMAGE]: {
    mimeExtensions: { 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'] },
    maximumSizeBytes: 15 * 1024 * 1024,
    retentionDaysAfterOrphaned: 90,
    publicAllowed: false,
  },
  [UploadPurpose.CHAT_FILE]: {
    mimeExtensions: {
      'application/pdf': ['pdf'],
      'application/zip': ['zip'],
      'text/plain': ['txt'],
    },
    maximumSizeBytes: 25 * 1024 * 1024,
    retentionDaysAfterOrphaned: 90,
    publicAllowed: false,
  },
  [UploadPurpose.REPORT_EVIDENCE]: {
    mimeExtensions: {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
      'application/pdf': ['pdf'],
    },
    maximumSizeBytes: 25 * 1024 * 1024,
    retentionDaysAfterOrphaned: 365,
    publicAllowed: false,
  },
};
