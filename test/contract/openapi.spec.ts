import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
}

interface Response {
  description: string;
  content?: Record<string, { schema?: Schema }>;
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
}

interface Operation {
  operationId: string;
  parameters?: Parameter[];
  responses: Record<string, Response>;
  security?: Array<Record<string, string[]>>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, Operation>>;
  components?: {
    schemas?: Record<string, Schema>;
    securitySchemes?: Record<string, unknown>;
  };
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const ERROR_REF = '#/components/schemas/ErrorResponse';
const IDEMPOTENT_OPERATION_IDS = [
  'UploadsController_complete',
  'RelationshipsController_decide',
  'RelationshipsController_unmatch',
  'BookingsController_create',
  'BookingsController_transition',
  'BookingsController_createReview',
  'TrustController_block',
  'TrustController_report',
  'AdminController_userStatus',
  'AdminController_moderateReview',
  'AdminController_resolveReport',
  'AdminController_reportStatus',
  'AdminController_createPenalty',
  'AdminController_revokePenalty',
  'AdminController_legalStatus',
];

describe('OpenAPI contract', () => {
  const document = JSON.parse(
    readFileSync(resolve(process.cwd(), 'openapi.json'), 'utf8'),
  ) as OpenApiDocument;
  const allOperations = operations(document);

  it('contains critical mobile and admin lifecycle routes', () => {
    const expected = [
      '/api/v1/roles/available',
      '/api/v1/cities',
      '/api/v1/legal-documents/current',
      '/api/v1/me/onboarding/progress',
      '/api/v1/me/profile',
      '/api/v1/me/location',
      '/api/v1/discovery/candidates',
      '/api/v1/interests/{interestId}/decision',
      '/api/v1/conversations/{conversationId}/messages',
      '/api/v1/bookings',
      '/api/v1/bookings/{bookingId}/review',
      '/api/v1/uploads/{uploadId}/complete',
      '/api/v1/uploads/{assetId}/access-url',
      '/api/v1/admin/reports/{reportId}/resolve',
      '/api/v1/admin/reports/{reportId}/status',
      '/api/v1/admin/feature-codes',
      '/api/v1/admin/legal-documents/{id}/status',
    ];
    for (const path of expected) expect(document.paths).toHaveProperty(path);
  });

  it('keeps unsupported MVP routes out of the contract', () => {
    for (const path of [
      '/api/v1/shoot-requests',
      '/api/v1/notifications',
      '/api/v1/referrals',
      '/api/v1/admin/payments',
      '/api/v1/admin/refunds',
      '/api/v1/admin/identity-verifications',
      '/api/v1/auth/change-pending-email',
    ]) {
      expect(document.paths).not.toHaveProperty(path);
    }
  });

  it('publishes a concrete success schema for every HTTP operation', () => {
    expect(allOperations).toHaveLength(114);
    for (const operation of allOperations) {
      const success = Object.entries(operation.responses).find(([code]) => code.startsWith('2'));
      expect(success).toBeDefined();
      expect(success?.[1].description).not.toBe('');
      const media = success?.[1].content ?? {};
      expect(Object.keys(media).length).toBeGreaterThan(0);
      expect(Object.values(media)[0]?.schema).toBeDefined();
    }
    expect(Object.keys(document.components?.schemas ?? {}).length).toBeGreaterThanOrEqual(90);
  });

  it('uses domain response models for critical generated-client workflows', () => {
    expect(successSchema(document.paths['/api/v1/auth/sign-up'].post)).toEqual({
      $ref: '#/components/schemas/VerificationPendingResponse',
    });
    expect(successSchema(document.paths['/api/v1/auth/resend-verification'].post)).toEqual({
      $ref: '#/components/schemas/VerificationAcceptedResponse',
    });
    expect(successSchema(document.paths['/api/v1/auth/verify-email'].post)).toEqual({
      $ref: '#/components/schemas/AuthSessionResponse',
    });
    expect(successSchema(document.paths['/api/v1/auth/forgot-password'].post)).toEqual({
      $ref: '#/components/schemas/PasswordResetChallengeResponse',
    });
    expect(successSchema(document.paths['/api/v1/auth/verify-password-reset-otp'].post)).toEqual({
      $ref: '#/components/schemas/PasswordResetVerifiedResponse',
    });
    expect(successSchema(document.paths['/api/v1/auth/sign-in'].post)).toEqual({
      $ref: '#/components/schemas/AuthSessionResponse',
    });
    expect(successSchema(document.paths['/api/v1/me/onboarding/progress'].get)).toEqual({
      $ref: '#/components/schemas/OnboardingProgressResponse',
    });
    expect(successSchema(document.paths['/api/v1/me/consents'].get)).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/ConsentResponse' },
    });
    expect(successSchema(document.paths['/api/v1/discovery/candidates'].get)).toEqual({
      $ref: '#/components/schemas/DiscoveryCandidatePage',
    });
    expect(successSchema(document.paths['/api/v1/bookings'].post)).toEqual({
      $ref: '#/components/schemas/BookingResponse',
    });
    expect(successSchema(document.paths['/api/v1/bookings/{bookingId}/review'].get)).toEqual({
      $ref: '#/components/schemas/ReviewResponse',
    });
    expect(successSchema(document.paths['/api/v1/admin/reports/{reportId}/resolve'].post)).toEqual({
      $ref: '#/components/schemas/ReportResolutionResponse',
    });
    expect(successSchema(document.paths['/api/v1/admin/reports/{reportId}/status'].post)).toEqual({
      $ref: '#/components/schemas/ReportResolutionResponse',
    });
  });

  it('allows Admin to set operational account statuses directly', () => {
    expect(document.components?.schemas?.UserStatusActionDto).toMatchObject({
      required: ['status', 'reason'],
      properties: {
        status: {
          type: 'string',
          enum: ['ACTIVE', 'SUSPENDED', 'BANNED'],
        },
      },
    });
  });

  it('publishes enums, UUIDs, rating bounds, and UTC date-time formats', () => {
    const schemas = document.components?.schemas ?? {};
    expect(schemas.BookingResponse.properties?.status.enum).toEqual(
      expect.arrayContaining(['PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED']),
    );
    expect(schemas.PenaltyResponse.properties?.penaltyType.enum).toEqual(
      expect.arrayContaining(['TEMPORARY_SUSPENSION', 'PERMANENT_BAN', 'FEATURE_RESTRICTION']),
    );
    expect(schemas.ReviewResponse.properties?.rating).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 5,
    });
    expect(schemas.BookingResponse.properties?.id.format).toBe('uuid');
    expect(schemas.BookingResponse.properties?.scheduledStart.format).toBe('date-time');
    expect(schemas.LegalDocumentResponse.properties?.effectiveAt.format).toBe('date-time');
    expect(schemas.CreateBookingDto.properties?.currency).toMatchObject({
      type: 'string',
      enum: ['VND'],
      default: 'VND',
    });
    expect(schemas.CreateBookingDto.properties?.serviceId.format).toBe('uuid');
    expect(schemas.CreateBookingDto.properties?.scheduledEnd.format).toBe('date-time');
    expect(schemas.AdminFeatureCodesResponse.properties?.items.items?.enum).toEqual([
      'LOCATION',
      'DISCOVERY',
      'SWIPE',
      'CHAT',
      'BOOKING',
      'REVIEW',
      'UPLOAD',
    ]);
    expect(schemas.AdminDashboardResponse.required).toEqual(
      expect.arrayContaining(['activeUsers', 'activeMatches', 'pendingBookings']),
    );
  });

  it('documents bounded cursor pagination in requests and responses', () => {
    const paginatedPaths = [
      '/api/v1/discovery/candidates',
      '/api/v1/interests/incoming',
      '/api/v1/conversations/{conversationId}/messages',
      '/api/v1/bookings',
      '/api/v1/admin/users',
      '/api/v1/admin/activity-fields',
      '/api/v1/admin/services',
      '/api/v1/admin/legal-documents',
    ];
    for (const path of paginatedPaths) {
      const operation = document.paths[path].get;
      expect(parameter(operation, 'cursor')).toMatchObject({ in: 'query', required: false });
      expect(parameter(operation, 'limit')?.schema).toMatchObject({
        type: 'number',
        default: 20,
        minimum: 1,
        maximum: 100,
      });
      const responseSchema = resolveSchema(document, successSchema(operation));
      expect(responseSchema.required).toEqual(expect.arrayContaining(['items', 'nextCursor']));
      expect(responseSchema.properties?.items.type).toBe('array');
      expect(responseSchema.properties?.nextCursor.type).toBe('string');
    }
  });

  it('documents domain-specific Web Admin filters', () => {
    const expected: Array<[string, string[]]> = [
      ['/api/v1/admin/users', ['search', 'status', 'role', 'verificationStatus', 'cityId']],
      [
        '/api/v1/admin/photographers',
        [
          'status',
          'accountStatus',
          'profileStatus',
          'verificationStatus',
          'availabilityStatus',
          'cityId',
          'activityFieldId',
          'serviceId',
        ],
      ],
      [
        '/api/v1/admin/reviews',
        ['status', 'rating', 'dateFrom', 'dateTo', 'reviewerUserId', 'revieweeUserId'],
      ],
      [
        '/api/v1/admin/reports',
        [
          'status',
          'reasonCode',
          'dateFrom',
          'dateTo',
          'reporterUserId',
          'reportedUserId',
          'contextType',
        ],
      ],
      [
        '/api/v1/admin/penalties',
        ['status', 'penaltyType', 'userId', 'effectiveFrom', 'effectiveTo'],
      ],
      [
        '/api/v1/admin/bookings',
        ['status', 'dateFrom', 'dateTo', 'customerUserId', 'photographerUserId', 'serviceId'],
      ],
      ['/api/v1/admin/services', ['status', 'activityFieldId']],
      ['/api/v1/admin/legal-documents', ['status', 'documentType']],
    ];
    for (const [path, names] of expected) {
      const operation = document.paths[path].get;
      for (const name of names) {
        expect(parameter(operation, name)).toMatchObject({ in: 'query', required: false });
      }
    }
  });

  it('uses the common error shape for validation, security, throttling, and server errors', () => {
    expect(document.components?.schemas?.ErrorResponse.required).toEqual([
      'code',
      'message',
      'requestId',
    ]);
    for (const operation of allOperations) {
      for (const code of ['400', '429', '500']) {
        expect(errorSchema(operation, code)).toBe(ERROR_REF);
      }
      if (operation.security?.length) {
        expect(errorSchema(operation, '401')).toBe(ERROR_REF);
        expect(errorSchema(operation, '403')).toBe(ERROR_REF);
      }
    }
  });

  it('requires idempotency keys only on replay-safe command contracts', () => {
    const byId = new Map(allOperations.map((operation) => [operation.operationId, operation]));
    for (const operationId of IDEMPOTENT_OPERATION_IDS) {
      const operation = byId.get(operationId);
      expect(operation).toBeDefined();
      expect(parameter(operation!, 'Idempotency-Key')).toMatchObject({
        in: 'header',
        required: true,
      });
      expect(errorSchema(operation!, '409')).toBe(ERROR_REF);
      expect(operation?.security).toEqual([{ bearer: [], 'idempotency-key': [] }]);
    }
    expect(parameter(byId.get('BookingsController_update')!, 'Idempotency-Key')).toBeUndefined();
    expect(parameter(byId.get('MessagingController_send')!, 'Idempotency-Key')).toBeUndefined();
  });

  it('separates public authentication from protected mobile and admin operations', () => {
    expect(document.paths['/api/v1/auth/sign-in'].post.security).toBeUndefined();
    expect(document.paths['/api/v1/admin/auth/sign-in'].post.security).toBeUndefined();
    expect(document.paths['/api/v1/me'].get.security).toEqual([{ bearer: [] }]);
    expect(document.paths['/api/v1/admin/users'].get.security).toEqual([{ bearer: [] }]);
    expect(document.components?.securitySchemes).toHaveProperty('bearer');
    expect(document.components?.securitySchemes).toHaveProperty('idempotency-key');
  });
});

function operations(document: OpenApiDocument): Operation[] {
  return Object.values(document.paths).flatMap((pathItem) =>
    Object.entries(pathItem)
      .filter(([method]) => HTTP_METHODS.has(method))
      .map(([, operation]) => operation),
  );
}

function successSchema(operation: Operation): Schema {
  const response = Object.entries(operation.responses).find(([code]) => code.startsWith('2'))?.[1];
  const media = response?.content ?? {};
  const schema = Object.values(media)[0]?.schema;
  if (!schema) throw new Error(`Missing success schema for ${operation.operationId}`);
  return schema;
}

function resolveSchema(document: OpenApiDocument, schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.split('/').at(-1)!;
  const resolved = document.components?.schemas?.[name];
  if (!resolved) throw new Error(`Missing schema ${name}`);
  return resolved;
}

function parameter(operation: Operation, name: string): Parameter | undefined {
  return operation.parameters?.find((item) => item.name === name);
}

function errorSchema(operation: Operation, code: string): string | undefined {
  return operation.responses[code]?.content?.['application/json']?.schema?.$ref;
}
