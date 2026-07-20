import type { OpenAPIObject } from '@nestjs/swagger';

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (name: string): Schema => ({ type: 'array', items: ref(name) });
const dateTime = (): Schema => ({ type: 'string', format: 'date-time' });
const uuid = (): Schema => ({ type: 'string', format: 'uuid' });
const nullableString = (): Schema => ({ type: 'string', nullable: true });
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});
const page = (itemName: string): Schema =>
  object(
    {
      items: arrayOf(itemName),
      nextCursor: nullableString(),
    },
    ['items', 'nextCursor'],
  );

export const MVP_RESPONSE_SCHEMAS: Record<string, Schema> = {
  ErrorResponse: object(
    {
      code: { type: 'string', example: 'VALIDATION_ERROR' },
      message: { type: 'string' },
      details: { type: 'object', additionalProperties: true, nullable: true },
      requestId: { type: 'string' },
    },
    ['code', 'message', 'requestId'],
  ),
  StatusResponse: object({ status: { type: 'string' } }, ['status']),
  HealthLiveResponse: object({ status: { type: 'string', enum: ['ok'] }, timestamp: dateTime() }, [
    'status',
    'timestamp',
  ]),
  HealthReadyResponse: object(
    {
      status: { type: 'string', enum: ['ok'] },
      dependencies: object({
        database: { type: 'string', enum: ['up'] },
        redis: { type: 'string', enum: ['up'] },
        worker: { type: 'string', enum: ['up'] },
      }),
    },
    ['status', 'dependencies'],
  ),
  RoleSummary: object(
    {
      id: uuid(),
      code: { type: 'string', enum: ['CUSTOMER', 'PHOTOGRAPHER'] },
      name: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
    },
    ['id', 'code', 'name'],
  ),
  UserSummary: object(
    {
      id: uuid(),
      email: { type: 'string', format: 'email', nullable: true },
      phone: nullableString(),
      accountStatus: {
        type: 'string',
        enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'],
      },
      emailVerified: { type: 'boolean' },
      currentRoleId: { ...uuid(), nullable: true },
      onboardingCompletedAt: { ...dateTime(), nullable: true },
      profile: ref('ProfileResponse'),
      roles: arrayOf('RoleSummary'),
      createdAt: dateTime(),
    },
    ['id', 'accountStatus', 'emailVerified', 'roles', 'createdAt'],
  ),
  VerificationPendingResponse: object(
    {
      userId: uuid(),
      status: { type: 'string' },
      emailVerificationRequired: { type: 'boolean' },
    },
    ['userId', 'status', 'emailVerificationRequired'],
  ),
  AuthSessionResponse: object(
    {
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
      expiresIn: { type: 'integer', minimum: 1 },
      tokenType: { type: 'string', enum: ['Bearer'] },
      user: ref('UserSummary'),
      restrictions: arrayOf('PenaltyResponse'),
    },
    ['accessToken', 'refreshToken', 'expiresIn', 'user'],
  ),
  UploadPresignResponse: object(
    {
      uploadId: uuid(),
      objectKey: { type: 'string' },
      uploadUrl: { type: 'string', format: 'uri' },
      requiredHeaders: { type: 'object', additionalProperties: { type: 'string' } },
      expiresAt: dateTime(),
    },
    ['uploadId', 'objectKey', 'uploadUrl', 'requiredHeaders', 'expiresAt'],
  ),
  UploadAssetResponse: object(
    {
      id: uuid(),
      purpose: {
        type: 'string',
        enum: ['AVATAR', 'PORTFOLIO', 'CHAT_IMAGE', 'CHAT_FILE', 'REPORT_EVIDENCE'],
      },
      mimeType: { type: 'string' },
      sizeBytes: { type: 'integer', format: 'int64' },
      status: { type: 'string', enum: ['USABLE', 'QUARANTINED', 'REMOVED'] },
      isPublic: { type: 'boolean' },
      createdAt: dateTime(),
    },
    ['id', 'purpose', 'mimeType', 'sizeBytes', 'status', 'isPublic', 'createdAt'],
  ),
  AssetAccessResponse: object(
    {
      url: { type: 'string', format: 'uri' },
      expiresAt: { ...dateTime(), nullable: true },
    },
    ['url', 'expiresAt'],
  ),
  CatalogItemResponse: object(
    {
      id: uuid(),
      code: { type: 'string' },
      name: { type: 'string' },
      description: nullableString(),
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] },
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
    ['id', 'code', 'name', 'status'],
  ),
  LegalDocumentResponse: object(
    {
      id: uuid(),
      documentType: {
        type: 'string',
        enum: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'COMMUNITY_GUIDELINES'],
      },
      version: { type: 'string' },
      contentUrl: { type: 'string', format: 'uri' },
      status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] },
      effectiveAt: dateTime(),
      createdAt: dateTime(),
    },
    ['id', 'documentType', 'version', 'contentUrl', 'status', 'effectiveAt'],
  ),
  ConsentResponse: object(
    {
      userId: uuid(),
      legalDocumentId: uuid(),
      acceptedAt: dateTime(),
      legalDocument: ref('LegalDocumentResponse'),
    },
    ['userId', 'legalDocumentId', 'acceptedAt', 'legalDocument'],
  ),
  ProfileResponse: object(
    {
      id: uuid(),
      userId: uuid(),
      userRoleId: uuid(),
      displayName: nullableString(),
      bio: nullableString(),
      cityId: { ...uuid(), nullable: true },
      avatarAssetId: { ...uuid(), nullable: true },
      status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'HIDDEN', 'SUSPENDED'] },
      onboarding: { type: 'object', additionalProperties: true },
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
    ['status'],
  ),
  PortfolioItemResponse: object(
    {
      id: uuid(),
      userRoleId: uuid(),
      assetId: uuid(),
      serviceId: { ...uuid(), nullable: true },
      title: nullableString(),
      description: nullableString(),
      sortOrder: { type: 'integer' },
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
    ['id', 'userRoleId', 'assetId', 'sortOrder'],
  ),
  SettingsResponse: object(
    {
      language: { type: 'string', enum: ['VI', 'EN'] },
      theme: { type: 'string', enum: ['SYSTEM', 'LIGHT', 'DARK'] },
      mapType: { type: 'string', enum: ['STANDARD', 'SATELLITE', 'HYBRID'] },
      matchNotificationsEnabled: { type: 'boolean' },
      bookingNotificationsEnabled: { type: 'boolean' },
      readReceiptsEnabled: { type: 'boolean' },
      profileVisibilityEnabled: { type: 'boolean' },
      locationVisibilityDurationHours: { type: 'integer' },
    },
    ['language', 'theme', 'mapType'],
  ),
  DiscoveryPresenceResponse: object(
    {
      userRoleId: uuid(),
      isVisible: { type: 'boolean' },
      visibleUntil: { ...dateTime(), nullable: true },
      publicRadiusMeters: { type: 'integer', nullable: true },
      updatedAt: { ...dateTime(), nullable: true },
    },
    ['userRoleId', 'isVisible', 'visibleUntil'],
  ),
  DiscoveryCandidateResponse: object(
    {
      userRoleId: uuid(),
      displayName: nullableString(),
      avatarAssetId: { ...uuid(), nullable: true },
      headline: nullableString(),
      availabilityStatus: nullableString(),
      identityVerificationStatus: { type: 'string' },
      distance: { type: 'string', example: '3-5 km' },
    },
    ['userRoleId', 'distance'],
  ),
  SwipeResponse: object(
    {
      id: uuid(),
      actorUserRoleId: uuid(),
      targetUserRoleId: uuid(),
      direction: { type: 'string', enum: ['LEFT', 'RIGHT', 'ACCEPT', 'REJECT'] },
      source: { type: 'string', enum: ['DISCOVERY', 'NEARBY', 'PROFILE'] },
      effectiveUntil: { ...dateTime(), nullable: true },
      createdAt: dateTime(),
    },
    ['id', 'actorUserRoleId', 'targetUserRoleId', 'direction', 'source', 'createdAt'],
  ),
  InterestResponse: object(
    {
      id: uuid(),
      actorUserRoleId: uuid(),
      targetUserRoleId: uuid(),
      direction: { type: 'string', enum: ['RIGHT', 'ACCEPT', 'REJECT'] },
      resolvedAt: { ...dateTime(), nullable: true },
      createdAt: dateTime(),
    },
    ['id', 'actorUserRoleId', 'targetUserRoleId', 'direction', 'createdAt'],
  ),
  PairDecisionResponse: object(
    {
      interestId: uuid(),
      decision: { type: 'string', enum: ['ACCEPT', 'REJECT'] },
      matchId: { ...uuid(), nullable: true },
      conversationId: { ...uuid(), nullable: true },
    },
    ['interestId', 'decision'],
  ),
  MatchResponse: object(
    {
      id: uuid(),
      status: { type: 'string', enum: ['ACTIVE', 'ENDED', 'BLOCKED'] },
      matchedAt: dateTime(),
      endedAt: { ...dateTime(), nullable: true },
      endReason: nullableString(),
      conversationId: { ...uuid(), nullable: true },
      counterpart: ref('ProfileResponse'),
    },
    ['id', 'status', 'matchedAt'],
  ),
  ConversationResponse: object(
    {
      id: uuid(),
      matchId: uuid(),
      status: { type: 'string', enum: ['ACTIVE', 'CLOSED', 'BLOCKED'] },
      lastMessageAt: { ...dateTime(), nullable: true },
      createdAt: dateTime(),
    },
    ['id', 'matchId', 'status', 'createdAt'],
  ),
  MessageResponse: object(
    {
      id: uuid(),
      conversationId: uuid(),
      senderUserId: uuid(),
      clientMessageId: { type: 'string' },
      messageType: { type: 'string', enum: ['TEXT', 'SYSTEM', 'IMAGE', 'FILE'] },
      content: nullableString(),
      assetId: { ...uuid(), nullable: true },
      status: { type: 'string', enum: ['SENT', 'DELIVERED', 'FAILED'] },
      sentAt: dateTime(),
    },
    ['id', 'conversationId', 'senderUserId', 'clientMessageId', 'messageType', 'status', 'sentAt'],
  ),
  ReceiptResponse: object(
    {
      messageId: uuid(),
      type: { type: 'string', enum: ['delivered', 'read'] },
      readReceiptShared: { type: 'boolean' },
      updatedAt: dateTime(),
    },
    ['messageId', 'type'],
  ),
  BookingResponse: object(
    {
      id: uuid(),
      matchId: uuid(),
      conversationId: { ...uuid(), nullable: true },
      customerUserRoleId: uuid(),
      photographerUserRoleId: uuid(),
      serviceId: uuid(),
      creatorUserId: uuid(),
      status: {
        type: 'string',
        enum: [
          'DRAFT',
          'PENDING',
          'ACCEPTED',
          'REJECTED',
          'CANCELLED',
          'IN_PROGRESS',
          'COMPLETED',
          'DISPUTED',
        ],
      },
      agreedPrice: { type: 'number' },
      currency: { type: 'string', enum: ['VND'] },
      scheduledStart: dateTime(),
      scheduledEnd: dateTime(),
      address: { type: 'string' },
      note: nullableString(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
      completedAt: { ...dateTime(), nullable: true },
    },
    [
      'id',
      'matchId',
      'customerUserRoleId',
      'photographerUserRoleId',
      'serviceId',
      'status',
      'scheduledStart',
      'scheduledEnd',
    ],
  ),
  ReviewResponse: object(
    {
      id: uuid(),
      bookingId: uuid(),
      reviewerUserId: uuid(),
      revieweeUserId: uuid(),
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      comment: nullableString(),
      status: { type: 'string', enum: ['PUBLISHED', 'HIDDEN', 'REMOVED'] },
      moderationReason: nullableString(),
      moderatedAt: { ...dateTime(), nullable: true },
      createdAt: dateTime(),
    },
    ['id', 'bookingId', 'reviewerUserId', 'revieweeUserId', 'rating', 'status', 'createdAt'],
  ),
  ReviewCollectionResponse: object(
    {
      summary: object({ average: { type: 'number' }, count: { type: 'integer', minimum: 0 } }, [
        'average',
        'count',
      ]),
      items: arrayOf('ReviewResponse'),
      nextCursor: nullableString(),
    },
    ['summary', 'items', 'nextCursor'],
  ),
  BlockResponse: object(
    {
      id: uuid(),
      blockerUserId: uuid(),
      blockedUserId: uuid(),
      reason: nullableString(),
      createdAt: dateTime(),
    },
    ['id', 'blockerUserId', 'blockedUserId', 'createdAt'],
  ),
  ReportResponse: object(
    {
      id: uuid(),
      reporterUserId: uuid(),
      reportedUserId: uuid(),
      reasonCode: {
        type: 'string',
        enum: ['SPAM', 'HARASSMENT', 'FAKE_PROFILE', 'INAPPROPRIATE_CONTENT', 'SCAM', 'OTHER'],
      },
      description: { type: 'string' },
      status: { type: 'string', enum: ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED'] },
      resolution: nullableString(),
      evidence: { type: 'array', items: object({ assetId: uuid() }, ['assetId']) },
      createdAt: dateTime(),
      resolvedAt: { ...dateTime(), nullable: true },
    },
    ['id', 'reportedUserId', 'reasonCode', 'status', 'createdAt'],
  ),
  PenaltyResponse: object(
    {
      id: uuid(),
      userId: uuid(),
      reportId: { ...uuid(), nullable: true },
      penaltyType: {
        type: 'string',
        enum: ['WARNING', 'TEMPORARY_SUSPENSION', 'PERMANENT_BAN', 'FEATURE_RESTRICTION'],
      },
      featureCode: nullableString(),
      reason: { type: 'string' },
      status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED'] },
      startsAt: dateTime(),
      endsAt: { ...dateTime(), nullable: true },
      revokedAt: { ...dateTime(), nullable: true },
    },
    ['id', 'userId', 'penaltyType', 'reason', 'status', 'startsAt'],
  ),
  ReportResolutionResponse: object(
    { report: ref('ReportResponse'), penalty: { ...ref('PenaltyResponse'), nullable: true } },
    ['report', 'penalty'],
  ),
  DeviceResponse: object(
    {
      id: uuid(),
      deviceId: { type: 'string' },
      provider: { type: 'string', enum: ['EXPO', 'FCM'] },
      isActive: { type: 'boolean' },
      createdAt: dateTime(),
      updatedAt: dateTime(),
    },
    ['id', 'deviceId', 'provider', 'isActive'],
  ),
  AdminDashboardResponse: object(
    {
      users: { type: 'integer' },
      photographers: { type: 'integer' },
      matches: { type: 'integer' },
      bookings: { type: 'integer' },
      openReports: { type: 'integer' },
      activePenalties: { type: 'integer' },
    },
    ['users', 'photographers', 'matches', 'bookings', 'openReports', 'activePenalties'],
  ),
  MvpEntityResponse: { type: 'object', additionalProperties: true },
  DiscoveryCandidatePage: page('DiscoveryCandidateResponse'),
  InterestPage: page('InterestResponse'),
  MatchPage: page('MatchResponse'),
  ConversationPage: page('ConversationResponse'),
  MessagePage: page('MessageResponse'),
  BookingPage: page('BookingResponse'),
  ReviewPage: page('ReviewResponse'),
  BlockPage: page('BlockResponse'),
  AdminEntityPage: page('MvpEntityResponse'),
};

const DIRECT_RESPONSE: Record<string, string> = {
  HealthController_live: 'HealthLiveResponse',
  HealthController_ready: 'HealthReadyResponse',
  AuthController_signUp: 'VerificationPendingResponse',
  AuthController_signIn: 'AuthSessionResponse',
  AuthController_oauthSignIn: 'AuthSessionResponse',
  AuthController_refresh: 'AuthSessionResponse',
  AdminAuthController_signIn: 'AuthSessionResponse',
  MeController_me: 'UserSummary',
  MeController_addRole: 'RoleSummary',
  MeController_switchRole: 'UserSummary',
  UploadsController_presign: 'UploadPresignResponse',
  UploadsController_complete: 'UploadAssetResponse',
  UploadsController_accessUrl: 'AssetAccessResponse',
  ProfilesController_self: 'ProfileResponse',
  ProfilesController_updateSelf: 'ProfileResponse',
  ProfilesController_publicProfile: 'ProfileResponse',
  ProfilesController_attachAvatar: 'ProfileResponse',
  ProfilesController_consent: 'ConsentResponse',
  ProfilesController_photographerSelf: 'ProfileResponse',
  ProfilesController_updatePhotographer: 'ProfileResponse',
  ProfilesController_createPortfolio: 'PortfolioItemResponse',
  ProfilesController_portfolioDetail: 'PortfolioItemResponse',
  ProfilesController_updatePortfolio: 'PortfolioItemResponse',
  ProfilesController_deletePortfolio: 'PortfolioItemResponse',
  ProfilesController_settings: 'SettingsResponse',
  ProfilesController_updateSettings: 'SettingsResponse',
  DiscoveryController_presence: 'DiscoveryPresenceResponse',
  DiscoveryController_putPresence: 'DiscoveryPresenceResponse',
  DiscoveryController_candidates: 'DiscoveryCandidatePage',
  DiscoveryController_nearby: 'DiscoveryCandidatePage',
  RelationshipsController_swipe: 'SwipeResponse',
  RelationshipsController_incoming: 'InterestPage',
  RelationshipsController_decide: 'PairDecisionResponse',
  RelationshipsController_matches: 'MatchPage',
  RelationshipsController_matchDetail: 'MatchResponse',
  RelationshipsController_unmatch: 'MatchResponse',
  MessagingController_conversations: 'ConversationPage',
  MessagingController_conversation: 'ConversationResponse',
  MessagingController_messages: 'MessagePage',
  MessagingController_send: 'MessageResponse',
  MessagingController_receipt: 'ReceiptResponse',
  BookingsController_list: 'BookingPage',
  BookingsController_create: 'BookingResponse',
  BookingsController_detail: 'BookingResponse',
  BookingsController_update: 'BookingResponse',
  BookingsController_transition: 'BookingResponse',
  BookingsController_createReview: 'ReviewResponse',
  BookingsController_bookingReview: 'ReviewResponse',
  BookingsController_photographerReviews: 'ReviewCollectionResponse',
  TrustController_blocks: 'BlockPage',
  TrustController_block: 'BlockResponse',
  TrustController_report: 'ReportResponse',
  DevicesController_register: 'DeviceResponse',
  AdminController_dashboard: 'AdminDashboardResponse',
  AdminController_userDetail: 'UserSummary',
  AdminController_userStatus: 'UserSummary',
  AdminController_reviewDetail: 'ReviewResponse',
  AdminController_moderateReview: 'ReviewResponse',
  AdminController_reportDetail: 'ReportResponse',
  AdminController_resolveReport: 'ReportResolutionResponse',
  AdminController_createPenalty: 'PenaltyResponse',
  AdminController_penaltyDetail: 'PenaltyResponse',
  AdminController_revokePenalty: 'PenaltyResponse',
  AdminController_bookingDetail: 'BookingResponse',
  AdminController_createActivityField: 'CatalogItemResponse',
  AdminController_activityField: 'CatalogItemResponse',
  AdminController_updateActivityField: 'CatalogItemResponse',
  AdminController_createService: 'CatalogItemResponse',
  AdminController_service: 'CatalogItemResponse',
  AdminController_updateService: 'CatalogItemResponse',
  AdminController_createLegalDocument: 'LegalDocumentResponse',
  AdminController_legalDocument: 'LegalDocumentResponse',
  AdminController_updateLegalDocument: 'LegalDocumentResponse',
  AdminController_legalStatus: 'LegalDocumentResponse',
};

const ARRAY_RESPONSE: Record<string, string> = {
  MeController_availableRoles: 'RoleSummary',
  CatalogController_cities: 'CatalogItemResponse',
  CatalogController_fields: 'CatalogItemResponse',
  CatalogController_services: 'CatalogItemResponse',
  CatalogController_currentLegal: 'LegalDocumentResponse',
  ProfilesController_fields: 'CatalogItemResponse',
  ProfilesController_replaceFields: 'CatalogItemResponse',
  ProfilesController_services: 'CatalogItemResponse',
  ProfilesController_replaceServices: 'CatalogItemResponse',
  ProfilesController_consents: 'MvpEntityResponse',
  ProfilesController_portfolio: 'PortfolioItemResponse',
  ProfilesController_reorderPortfolio: 'PortfolioItemResponse',
  TrustController_restrictions: 'PenaltyResponse',
  AdminController_activityFields: 'CatalogItemResponse',
  AdminController_services: 'CatalogItemResponse',
  AdminController_legalDocuments: 'LegalDocumentResponse',
};

const ADMIN_PAGE_OPERATIONS = new Set([
  'AdminController_users',
  'AdminController_photographers',
  'AdminController_reviews',
  'AdminController_reports',
  'AdminController_penalties',
  'AdminController_bookings',
]);

const STATUS_OPERATIONS = new Set([
  'AuthController_verifyEmail',
  'AuthController_resend',
  'AuthController_changePendingEmail',
  'AuthController_forgotPassword',
  'AuthController_resetPassword',
  'AuthController_signOut',
  'AdminAuthController_signOut',
  'ProfilesController_deleteAvatar',
  'DiscoveryController_putLocation',
  'DiscoveryController_deleteLocation',
  'TrustController_unblock',
  'DevicesController_remove',
]);

const IDEMPOTENT_OPERATIONS = new Set([
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
  'AdminController_createPenalty',
  'AdminController_revokePenalty',
  'AdminController_legalStatus',
]);

export function enrichOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas = {
    ...(document.components.schemas ?? {}),
    ...MVP_RESPONSE_SCHEMAS,
  };
  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem ?? {})) {
      if (!isOperation(operation)) continue;
      const operationId = operation.operationId as string;
      const successCode = Object.keys(operation.responses ?? {}).find((code) =>
        code.startsWith('2'),
      );
      if (!successCode) continue;
      const response = operation.responses[successCode];
      response.description ||= 'Successful response';
      response.content =
        operationId === 'MetricsController_get'
          ? { 'text/plain': { schema: { type: 'string' } } }
          : { 'application/json': { schema: responseSchema(operationId) } };
      addErrorResponses(operation);
      if (IDEMPOTENT_OPERATIONS.has(operationId)) addIdempotencyContract(operation);
      normalizeDateFormats(operation);
    }
  }
  normalizeDateFormats(document.components.schemas);
  return document;
}

function responseSchema(operationId: string): Schema {
  const direct = DIRECT_RESPONSE[operationId];
  if (direct) return ref(direct);
  const arrayItem = ARRAY_RESPONSE[operationId];
  if (arrayItem) return arrayOf(arrayItem);
  if (ADMIN_PAGE_OPERATIONS.has(operationId)) return ref('AdminEntityPage');
  if (STATUS_OPERATIONS.has(operationId)) return ref('StatusResponse');
  if (operationId === 'ProfilesController_publicPortfolio') return page('PortfolioItemResponse');
  return ref('MvpEntityResponse');
}

function addErrorResponses(operation: any): void {
  const error = {
    description: 'Error response',
    content: { 'application/json': { schema: ref('ErrorResponse') } },
  };
  operation.responses['400'] ??= error;
  operation.responses['429'] ??= error;
  operation.responses['500'] ??= error;
  if (Array.isArray(operation.security) && operation.security.length) {
    operation.responses['401'] ??= error;
    operation.responses['403'] ??= error;
  }
}

function addIdempotencyContract(operation: any): void {
  operation.parameters ??= [];
  if (!operation.parameters.some((parameter: any) => parameter.name === 'Idempotency-Key')) {
    operation.parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      description: 'Unique command key, reusable only with an identical payload for 24 hours.',
      schema: { type: 'string', minLength: 1, maxLength: 255 },
    });
  }
  operation.responses['409'] ??= {
    description: 'Idempotency conflict',
    content: { 'application/json': { schema: ref('ErrorResponse') } },
  };
  if (Array.isArray(operation.security) && operation.security.length) {
    operation.security = [{ bearer: [], 'idempotency-key': [] }];
  }
}

function normalizeDateFormats(value: unknown, propertyName?: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) normalizeDateFormats(item, propertyName);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    record.type === 'string' &&
    propertyName &&
    /(At|Until|Start|End|dateFrom|dateTo)$/.test(propertyName)
  ) {
    record.format = 'date-time';
  }
  if (record.type === 'string' && propertyName === 'dateOfBirth') record.format = 'date';
  if (
    record.type === 'string' &&
    propertyName &&
    propertyName !== 'clientMessageId' &&
    propertyName !== 'deviceId' &&
    /^(id|.*(User|Role|Asset|Booking|Conversation|Message|Match|Report|Penalty|Service|Field|City|Document|Upload|Intent)Id)$/i.test(
      propertyName,
    )
  ) {
    record.format = 'uuid';
  }
  if (
    propertyName &&
    /(Ids|IDs)$/.test(propertyName) &&
    record.type === 'array' &&
    record.items &&
    typeof record.items === 'object'
  ) {
    (record.items as Record<string, unknown>).format = 'uuid';
  }
  for (const [key, item] of Object.entries(record)) normalizeDateFormats(item, key);
}

function isOperation(value: unknown): value is Record<string, any> {
  return Boolean(
    value && typeof value === 'object' && 'operationId' in value && 'responses' in value,
  );
}
