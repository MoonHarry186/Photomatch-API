import {
  AccountStatus,
  BookingStatus,
  CatalogStatus,
  ConversationStatus,
  IdentityVerificationStatus,
  LegalDocumentType,
  MatchStatus,
  PenaltyStatus,
  PenaltyType,
  PhotographerAvailabilityStatus,
  Prisma,
  PrismaClient,
  ProfileStatus,
  ReportReasonCode,
  ReportStatus,
  ReviewStatus,
  RoleCode,
  RoleStatus,
  ServiceMode,
} from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_COUNT = 1000;
const CHUNK_SIZE = 500;
const DEMO_PREFIX = 'ADMIN_DEMO';
const EMAIL_PREFIX = 'admin-demo-user-';

const ids = {
  roles: {
    customer: '10000000-0000-4000-8000-000000000001',
    photographer: '10000000-0000-4000-8000-000000000002',
    admin: '10000000-0000-4000-8000-000000000003',
  },
  cities: [
    { id: '20000000-0000-4000-8000-000000000001', code: 'HA_NOI', name: 'Ha Noi' },
    { id: '20000000-0000-4000-8000-000000000002', code: 'HO_CHI_MINH', name: 'Ho Chi Minh' },
    { id: '20000000-0000-4000-8000-000000000003', code: 'DA_NANG', name: 'Da Nang' },
  ],
  groups: {
    user: '91000000',
    profile: '91000001',
    customerRole: '91000002',
    photographerRole: '91000003',
    adminRole: '91000004',
    photographerProfile: '91000005',
    activityField: '91000006',
    service: '91000007',
    serviceSelection: '91000008',
    match: '91000009',
    conversation: '91000010',
    booking: '91000011',
    bookingHistory: '91000012',
    review: '91000013',
    report: '91000014',
    penalty: '91000015',
    legalDocument: '91000016',
  },
};

const accountStatuses = [
  AccountStatus.ACTIVE,
  AccountStatus.ACTIVE,
  AccountStatus.ACTIVE,
  AccountStatus.PENDING_VERIFICATION,
  AccountStatus.SUSPENDED,
  AccountStatus.BANNED,
];
const verificationStatuses = [
  IdentityVerificationStatus.NOT_SUBMITTED,
  IdentityVerificationStatus.PENDING,
  IdentityVerificationStatus.VERIFIED,
  IdentityVerificationStatus.REJECTED,
];
const profileStatuses = [
  ProfileStatus.ACTIVE,
  ProfileStatus.ACTIVE,
  ProfileStatus.DRAFT,
  ProfileStatus.HIDDEN,
  ProfileStatus.SUSPENDED,
];
const availabilityStatuses = [
  PhotographerAvailabilityStatus.AVAILABLE,
  PhotographerAvailabilityStatus.BUSY,
  PhotographerAvailabilityStatus.UNAVAILABLE,
];
const bookingStatuses = [
  BookingStatus.PENDING,
  BookingStatus.ACCEPTED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
  BookingStatus.DISPUTED,
  BookingStatus.CANCELLED,
];
const reviewStatuses = [ReviewStatus.PUBLISHED, ReviewStatus.HIDDEN, ReviewStatus.REMOVED];
const reportReasons = [
  ReportReasonCode.SPAM,
  ReportReasonCode.HARASSMENT,
  ReportReasonCode.FAKE_PROFILE,
  ReportReasonCode.INAPPROPRIATE_CONTENT,
  ReportReasonCode.SCAM,
  ReportReasonCode.OTHER,
];
const reportStatuses = [
  ReportStatus.OPEN,
  ReportStatus.IN_REVIEW,
  ReportStatus.RESOLVED,
  ReportStatus.REJECTED,
];
const penaltyTypes = [
  PenaltyType.WARNING,
  PenaltyType.TEMPORARY_SUSPENSION,
  PenaltyType.PERMANENT_BAN,
  PenaltyType.FEATURE_RESTRICTION,
];
const penaltyStatuses = [PenaltyStatus.ACTIVE, PenaltyStatus.EXPIRED, PenaltyStatus.REVOKED];
const legalDocumentTypes = [
  LegalDocumentType.TERMS_OF_SERVICE,
  LegalDocumentType.PRIVACY_POLICY,
  LegalDocumentType.COMMUNITY_GUIDELINES,
];

async function main() {
  const count = seedCount();
  console.log(`Seeding ${count} ${DEMO_PREFIX} records per admin domain...`);

  await ensureBaseline();
  await seedActivityFields(count);
  await seedServices(count);
  await seedUsersAndPhotographers(count);
  await seedMatchesConversationsAndBookings(count);
  await seedReviewsReportsPenaltiesAndLegalDocuments(count);

  const counts = await demoCounts();
  console.table(counts);
  assertCount('users', counts.users, count);
  assertCount('photographers', counts.photographers, count);
  assertCount('reviews', counts.reviews, count);
  assertCount('reports', counts.reports, count);
  assertCount('penalties', counts.penalties, count);
  assertCount('bookings', counts.bookings, count);
  assertCount('activityFields', counts.activityFields, count);
  assertCount('services', counts.services, count);
  assertCount('legalDocuments', counts.legalDocuments, count);
}

async function ensureBaseline() {
  const roles = [
    { id: ids.roles.customer, code: RoleCode.CUSTOMER, name: 'Customer' },
    { id: ids.roles.photographer, code: RoleCode.PHOTOGRAPHER, name: 'Photographer' },
    { id: ids.roles.admin, code: RoleCode.ADMIN, name: 'Admin' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      create: { ...role, status: RoleStatus.ACTIVE },
      update: { name: role.name, status: RoleStatus.ACTIVE },
    });
  }

  for (const city of ids.cities) {
    await prisma.city.upsert({
      where: { code: city.code },
      create: { ...city, status: CatalogStatus.ACTIVE },
      update: { name: city.name, status: CatalogStatus.ACTIVE },
    });
  }
}

async function seedActivityFields(count: number) {
  const fields = range(count).map<Prisma.ActivityFieldCreateManyInput>((index) => ({
    id: demoId(ids.groups.activityField, index),
    code: `ADMIN_DEMO_FIELD_${serial(index)}`,
    name: `Demo linh vuc ${serial(index)}`,
    description: `${DEMO_PREFIX} activity field ${serial(index)}`,
    status: cycle([CatalogStatus.ACTIVE, CatalogStatus.ACTIVE, CatalogStatus.INACTIVE], index),
    createdAt: pastDate(index),
  }));
  await createManyInChunks('activity fields', fields, (data) =>
    prisma.activityField.createMany({ data, skipDuplicates: true }),
  );

  const mappings = fields.flatMap<Prisma.RoleActivityFieldCreateManyInput>((field) => [
    { roleId: ids.roles.customer, activityFieldId: field.id! },
    { roleId: ids.roles.photographer, activityFieldId: field.id! },
  ]);
  await createManyInChunks('role activity mappings', mappings, (data) =>
    prisma.roleActivityField.createMany({ data, skipDuplicates: true }),
  );
}

async function seedServices(count: number) {
  const services = range(count).map<Prisma.ServiceCreateManyInput>((index) => ({
    id: demoId(ids.groups.service, index),
    activityFieldId: demoId(ids.groups.activityField, index),
    code: `ADMIN_DEMO_SERVICE_${serial(index)}`,
    name: `Demo dich vu ${serial(index)}`,
    description: `${DEMO_PREFIX} service ${serial(index)}`,
    status: cycle([CatalogStatus.ACTIVE, CatalogStatus.ACTIVE, CatalogStatus.INACTIVE], index),
    createdAt: pastDate(index),
  }));
  await createManyInChunks('services', services, (data) =>
    prisma.service.createMany({ data, skipDuplicates: true }),
  );
}

async function seedUsersAndPhotographers(count: number) {
  const users = range(count).map<Prisma.UserCreateManyInput>((index) => ({
    id: demoId(ids.groups.user, index),
    email: `${EMAIL_PREFIX}${serial(index)}@photomatch.test`,
    phone: `+8490${String(index).padStart(7, '0')}`,
    accountStatus: cycle(accountStatuses, index),
    identityVerificationStatus: cycle(verificationStatuses, index),
    emailVerified: index % 3 !== 0,
    phoneVerified: index % 4 === 0,
    onboardingCompletedAt: index % 5 === 0 ? null : pastDate(index, 12),
    lastLoginAt: index % 7 === 0 ? null : pastDate(index, 2),
    createdAt: pastDate(index, 24),
  }));
  await createManyInChunks('users', users, (data) =>
    prisma.user.createMany({ data, skipDuplicates: true }),
  );

  const profiles = range(count).map<Prisma.UserProfileCreateManyInput>((index) => ({
    id: demoId(ids.groups.profile, index),
    userId: demoId(ids.groups.user, index),
    cityId: ids.cities[(index - 1) % ids.cities.length]!.id,
    displayName: `Demo User ${serial(index)}`,
    dateOfBirth: new Date(Date.UTC(1990 + (index % 18), index % 12, (index % 27) + 1)),
    bio: `${DEMO_PREFIX} profile ${serial(index)} for admin pagination and filtering.`,
    status: cycle(profileStatuses, index),
    createdAt: pastDate(index, 24),
  }));
  await createManyInChunks('user profiles', profiles, (data) =>
    prisma.userProfile.createMany({ data, skipDuplicates: true }),
  );

  const settings = range(count).map<Prisma.UserSettingsCreateManyInput>((index) => ({
    userId: demoId(ids.groups.user, index),
    profileVisibilityEnabled: index % 3 !== 0,
  }));
  await createManyInChunks('user settings', settings, (data) =>
    prisma.userSettings.createMany({ data, skipDuplicates: true }),
  );

  const userRoles = range(count).flatMap<Prisma.UserRoleCreateManyInput>((index) => [
    {
      id: demoId(ids.groups.customerRole, index),
      userId: demoId(ids.groups.user, index),
      roleId: ids.roles.customer,
      status: RoleStatus.ACTIVE,
      isInitialAdditionalRole: false,
      createdAt: pastDate(index, 24),
    },
    {
      id: demoId(ids.groups.photographerRole, index),
      userId: demoId(ids.groups.user, index),
      roleId: ids.roles.photographer,
      status: index % 11 === 0 ? RoleStatus.INACTIVE : RoleStatus.ACTIVE,
      isInitialAdditionalRole: true,
      createdAt: pastDate(index, 23),
    },
  ]);
  userRoles.push({
    id: demoId(ids.groups.adminRole, 1),
    userId: demoId(ids.groups.user, 1),
    roleId: ids.roles.admin,
    status: RoleStatus.ACTIVE,
    isInitialAdditionalRole: true,
    createdAt: pastDate(1, 1),
  });
  await createManyInChunks('user roles', userRoles, (data) =>
    prisma.userRole.createMany({ data, skipDuplicates: true }),
  );

  const photographerProfiles = range(count).map<Prisma.PhotographerProfileCreateManyInput>(
    (index) => ({
      id: demoId(ids.groups.photographerProfile, index),
      userRoleId: demoId(ids.groups.photographerRole, index),
      availabilityStatus: cycle(availabilityStatuses, index),
      headline: `Demo photographer headline ${serial(index)}`,
      yearsExperience: index % 16,
      createdAt: pastDate(index, 22),
    }),
  );
  await createManyInChunks('photographer profiles', photographerProfiles, (data) =>
    prisma.photographerProfile.createMany({ data, skipDuplicates: true }),
  );

  const selectedFields = range(count).map<Prisma.UserRoleFieldCreateManyInput>((index) => ({
    userRoleId: demoId(ids.groups.photographerRole, index),
    activityFieldId: demoId(ids.groups.activityField, index),
    selectedAt: pastDate(index, 20),
  }));
  await createManyInChunks('photographer fields', selectedFields, (data) =>
    prisma.userRoleField.createMany({ data, skipDuplicates: true }),
  );

  const selectedServices = range(count).map<Prisma.UserRoleServiceCreateManyInput>((index) => ({
    id: demoId(ids.groups.serviceSelection, index),
    userRoleId: demoId(ids.groups.photographerRole, index),
    serviceId: demoId(ids.groups.service, index),
    serviceMode: ServiceMode.OFFERED,
    minPrice: `${500_000 + index * 10_000}`,
    maxPrice: `${1_500_000 + index * 10_000}`,
    currency: 'VND',
    priceUnit: 'buoi',
    isActive: index % 13 !== 0,
    createdAt: pastDate(index, 19),
  }));
  await createManyInChunks('photographer services', selectedServices, (data) =>
    prisma.userRoleService.createMany({ data, skipDuplicates: true }),
  );
}

async function seedMatchesConversationsAndBookings(count: number) {
  const matches = range(count).map<Prisma.MatchCreateManyInput>((index) => {
    const status = cycle([MatchStatus.ACTIVE, MatchStatus.ACTIVE, MatchStatus.ENDED], index);
    return {
      id: demoId(ids.groups.match, index),
      userRoleAId: demoId(ids.groups.customerRole, index),
      userRoleBId: demoId(ids.groups.photographerRole, pairedIndex(index, count)),
      pairKey: `${DEMO_PREFIX.toLowerCase()}-${serial(index)}`,
      activePairKey:
        status === MatchStatus.ACTIVE ? `${DEMO_PREFIX.toLowerCase()}-${serial(index)}` : null,
      status,
      endedByUserId: status === MatchStatus.ENDED ? demoId(ids.groups.user, index) : null,
      endReason:
        status === MatchStatus.ENDED ? `${DEMO_PREFIX} ended match ${serial(index)}` : null,
      matchedAt: pastDate(index, 18),
      endedAt: status === MatchStatus.ENDED ? pastDate(index, 8) : null,
      createdAt: pastDate(index, 18),
    };
  });
  await createManyInChunks('matches', matches, (data) =>
    prisma.match.createMany({ data, skipDuplicates: true }),
  );

  const conversations = range(count).map<Prisma.ConversationCreateManyInput>((index) => ({
    id: demoId(ids.groups.conversation, index),
    matchId: demoId(ids.groups.match, index),
    status: cycle(
      [ConversationStatus.ACTIVE, ConversationStatus.ACTIVE, ConversationStatus.CLOSED],
      index,
    ),
    lastMessageAt: pastDate(index, 4),
    createdAt: pastDate(index, 18),
  }));
  await createManyInChunks('conversations', conversations, (data) =>
    prisma.conversation.createMany({ data, skipDuplicates: true }),
  );

  const participants = range(count).flatMap<Prisma.ConversationParticipantCreateManyInput>(
    (index) => [
      {
        conversationId: demoId(ids.groups.conversation, index),
        userId: demoId(ids.groups.user, index),
        joinedAt: pastDate(index, 18),
      },
      {
        conversationId: demoId(ids.groups.conversation, index),
        userId: demoId(ids.groups.user, pairedIndex(index, count)),
        joinedAt: pastDate(index, 18),
      },
    ],
  );
  await createManyInChunks('conversation participants', participants, (data) =>
    prisma.conversationParticipant.createMany({ data, skipDuplicates: true }),
  );

  const bookings = range(count).map<Prisma.BookingCreateManyInput>((index) => {
    const status = cycle(bookingStatuses, index);
    return {
      id: demoId(ids.groups.booking, index),
      matchId: demoId(ids.groups.match, index),
      conversationId: demoId(ids.groups.conversation, index),
      customerUserRoleId: demoId(ids.groups.customerRole, index),
      photographerUserRoleId: demoId(ids.groups.photographerRole, pairedIndex(index, count)),
      serviceId: demoId(ids.groups.service, pairedIndex(index, count)),
      creatorUserId: demoId(ids.groups.user, index),
      status,
      agreedPrice: `${1_000_000 + index * 15_000}`,
      currency: 'VND',
      scheduledStart: futureDate(index, 6),
      scheduledEnd: futureDate(index, 9),
      address: `${DEMO_PREFIX} studio address ${serial(index)}`,
      note: `${DEMO_PREFIX} booking ${serial(index)}`,
      cancellationReason:
        status === BookingStatus.CANCELLED ? `${DEMO_PREFIX} cancellation ${serial(index)}` : null,
      createdAt: pastDate(index, 12),
      completedAt: status === BookingStatus.COMPLETED ? pastDate(index, 1) : null,
    };
  });
  await createManyInChunks('bookings', bookings, (data) =>
    prisma.booking.createMany({ data, skipDuplicates: true }),
  );

  const history = range(count).map<Prisma.BookingStatusHistoryCreateManyInput>((index) => ({
    id: demoId(ids.groups.bookingHistory, index),
    bookingId: demoId(ids.groups.booking, index),
    changedByUserId: demoId(ids.groups.user, index),
    previousStatus: null,
    newStatus: cycle(bookingStatuses, index),
    note: `${DEMO_PREFIX} booking status seed ${serial(index)}`,
    changedAt: pastDate(index, 11),
  }));
  await createManyInChunks('booking status history', history, (data) =>
    prisma.bookingStatusHistory.createMany({ data, skipDuplicates: true }),
  );
}

async function seedReviewsReportsPenaltiesAndLegalDocuments(count: number) {
  const reviews = range(count).map<Prisma.ReviewCreateManyInput>((index) => {
    const status = cycle(reviewStatuses, index);
    return {
      id: demoId(ids.groups.review, index),
      bookingId: demoId(ids.groups.booking, index),
      reviewerUserId: demoId(ids.groups.user, index),
      revieweeUserId: demoId(ids.groups.user, pairedIndex(index, count)),
      moderatedByUserId: status === ReviewStatus.PUBLISHED ? null : demoId(ids.groups.user, 1),
      rating: (index % 5) + 1,
      comment: `${DEMO_PREFIX} review ${serial(index)} with predictable searchable text.`,
      status,
      moderationReason:
        status === ReviewStatus.PUBLISHED ? null : `${DEMO_PREFIX} moderation ${serial(index)}`,
      moderatedAt: status === ReviewStatus.PUBLISHED ? null : pastDate(index, 1),
      createdAt: pastDate(index, 10),
    };
  });
  await createManyInChunks('reviews', reviews, (data) =>
    prisma.review.createMany({ data, skipDuplicates: true }),
  );

  const reports = range(count).map<Prisma.UserReportCreateManyInput>((index) => {
    const status = cycle(reportStatuses, index);
    return {
      id: demoId(ids.groups.report, index),
      reporterUserId: demoId(ids.groups.user, index),
      reportedUserId: demoId(ids.groups.user, pairedIndex(index, count)),
      matchId: demoId(ids.groups.match, index),
      conversationId: demoId(ids.groups.conversation, index),
      bookingId: demoId(ids.groups.booking, index),
      resolvedByUserId:
        status === ReportStatus.RESOLVED || status === ReportStatus.REJECTED
          ? demoId(ids.groups.user, 1)
          : null,
      reasonCode: cycle(reportReasons, index),
      description: `${DEMO_PREFIX} report ${serial(index)} for admin triage filters.`,
      status,
      adminNote:
        status === ReportStatus.IN_REVIEW || status === ReportStatus.RESOLVED
          ? `${DEMO_PREFIX} internal note ${serial(index)}`
          : null,
      resolution:
        status === ReportStatus.RESOLVED || status === ReportStatus.REJECTED
          ? `${DEMO_PREFIX} resolution ${serial(index)}`
          : null,
      createdAt: pastDate(index, 9),
      resolvedAt:
        status === ReportStatus.RESOLVED || status === ReportStatus.REJECTED
          ? pastDate(index, 2)
          : null,
    };
  });
  await createManyInChunks('reports', reports, (data) =>
    prisma.userReport.createMany({ data, skipDuplicates: true }),
  );

  const penalties = range(count).map<Prisma.AccountPenaltyCreateManyInput>((index) => {
    const penaltyType = cycle(penaltyTypes, index);
    const status = cycle(penaltyStatuses, index);
    const revoked = status === PenaltyStatus.REVOKED;
    return {
      id: demoId(ids.groups.penalty, index),
      userId: demoId(ids.groups.user, pairedIndex(index, count)),
      reportId: demoId(ids.groups.report, index),
      imposedByUserId: demoId(ids.groups.user, 1),
      revokedByUserId: revoked ? demoId(ids.groups.user, 1) : null,
      penaltyType,
      featureCode:
        penaltyType === PenaltyType.FEATURE_RESTRICTION
          ? cycle(['CHAT', 'BOOKING', 'DISCOVERY'], index)
          : null,
      reason: `${DEMO_PREFIX} penalty ${serial(index)} for account safety testing.`,
      status,
      startsAt: pastDate(index, 8),
      endsAt:
        penaltyType === PenaltyType.TEMPORARY_SUSPENSION || status === PenaltyStatus.EXPIRED
          ? futureDate(index, 72)
          : null,
      createdAt: pastDate(index, 8),
      revokeReason: revoked ? `${DEMO_PREFIX} revoke ${serial(index)}` : null,
      revokedAt: revoked ? pastDate(index, 1) : null,
    };
  });
  await createManyInChunks('penalties', penalties, (data) =>
    prisma.accountPenalty.createMany({ data, skipDuplicates: true }),
  );

  const documents = range(count).map<Prisma.LegalDocumentCreateManyInput>((index) => {
    const documentType = cycle(legalDocumentTypes, index);
    const version = `admin-demo-${serial(index)}`;
    return {
      id: demoId(ids.groups.legalDocument, index),
      documentType,
      version,
      contentUrl: `https://photomatch.local/legal/admin-demo/${documentType.toLowerCase()}/${version}`,
      status: cycle([CatalogStatus.INACTIVE, CatalogStatus.ARCHIVED], index),
      effectiveAt: pastDate(index, 24),
      createdAt: pastDate(index, 24),
    };
  });
  await createManyInChunks('legal documents', documents, (data) =>
    prisma.legalDocument.createMany({ data, skipDuplicates: true }),
  );
}

async function demoCounts() {
  const [
    users,
    photographers,
    reviews,
    reports,
    penalties,
    bookings,
    activityFields,
    services,
    legalDocuments,
  ] = await Promise.all([
    prisma.user.count({ where: { email: { startsWith: EMAIL_PREFIX } } }),
    prisma.userRole.count({
      where: {
        role: { code: RoleCode.PHOTOGRAPHER },
        user: { email: { startsWith: EMAIL_PREFIX } },
      },
    }),
    prisma.review.count({ where: { comment: { startsWith: `${DEMO_PREFIX} review` } } }),
    prisma.userReport.count({
      where: { description: { startsWith: `${DEMO_PREFIX} report` } },
    }),
    prisma.accountPenalty.count({
      where: { reason: { startsWith: `${DEMO_PREFIX} penalty` } },
    }),
    prisma.booking.count({ where: { note: { startsWith: `${DEMO_PREFIX} booking` } } }),
    prisma.activityField.count({ where: { code: { startsWith: 'ADMIN_DEMO_FIELD_' } } }),
    prisma.service.count({ where: { code: { startsWith: 'ADMIN_DEMO_SERVICE_' } } }),
    prisma.legalDocument.count({ where: { version: { startsWith: 'admin-demo-' } } }),
  ]);
  return {
    users,
    photographers,
    reviews,
    reports,
    penalties,
    bookings,
    activityFields,
    services,
    legalDocuments,
  };
}

async function createManyInChunks<T>(
  label: string,
  data: T[],
  createMany: (data: T[]) => Promise<Prisma.BatchPayload>,
) {
  let inserted = 0;
  for (const chunk of chunks(data, CHUNK_SIZE)) {
    inserted += (await createMany(chunk)).count;
  }
  console.log(`${label}: ${inserted} inserted, ${data.length - inserted} already present`);
}

function seedCount(): number {
  const raw = process.env.ADMIN_DEMO_SEED_COUNT;
  if (!raw) return DEFAULT_COUNT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5000) {
    throw new Error('ADMIN_DEMO_SEED_COUNT must be an integer from 1 to 5000.');
  }
  return value;
}

function demoId(group: string, index: number): string {
  return `${group}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function serial(index: number): string {
  return String(index).padStart(4, '0');
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function cycle<T>(values: readonly T[], index: number): T {
  return values[(index - 1) % values.length]!;
}

function pairedIndex(index: number, count: number): number {
  return (index % count) + 1;
}

function pastDate(index: number, hours = 1): Date {
  return new Date(Date.UTC(2026, 6, 21, 0, 0, 0) - index * hours * 60 * 60 * 1000);
}

function futureDate(index: number, hours = 1): Date {
  return new Date(Date.UTC(2026, 6, 21, 0, 0, 0) + index * hours * 60 * 60 * 1000);
}

function chunks<T>(data: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < data.length; index += size) {
    result.push(data.slice(index, index + size));
  }
  return result;
}

function assertCount(label: string, actual: number, expected: number) {
  if (actual < expected) {
    throw new Error(`${label} count is ${actual}; expected at least ${expected}.`);
  }
}

main()
  .catch((error) => {
    process.stderr.write(
      `Admin demo seed failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
