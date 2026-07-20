-- PostgreSQL extensions required by the MVP schema.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED');

-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('CUSTOMER', 'PHOTOGRAPHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RoleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'HIDDEN', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PhotographerAvailabilityStatus" AS ENUM ('AVAILABLE', 'BUSY', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ServiceMode" AS ENUM ('OFFERED', 'WANTED');

-- CreateEnum
CREATE TYPE "SwipeDirection" AS ENUM ('LEFT', 'RIGHT', 'ACCEPT', 'REJECT');

-- CreateEnum
CREATE TYPE "SwipeSource" AS ENUM ('DISCOVERY', 'NEARBY', 'PROFILE');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('ACTIVE', 'ENDED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'CLOSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'SYSTEM', 'IMAGE', 'FILE');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ShootRequestStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MATCH_CREATED', 'MESSAGE_RECEIVED', 'BOOKING_CREATED', 'BOOKING_STATUS_CHANGED', 'REPORT_RESOLVED', 'ACCOUNT_PENALTY_CREATED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReportReasonCode" AS ENUM ('SPAM', 'HARASSMENT', 'FAKE_PROFILE', 'INAPPROPRIATE_CONTENT', 'SCAM', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PenaltyType" AS ENUM ('WARNING', 'TEMPORARY_SUSPENSION', 'PERMANENT_BAN', 'FEATURE_RESTRICTION');

-- CreateEnum
CREATE TYPE "PenaltyStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'COMMUNITY_GUIDELINES');

-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "LanguageCode" AS ENUM ('VI', 'EN');

-- CreateEnum
CREATE TYPE "MapType" AS ENUM ('STANDARD', 'SATELLITE', 'HYBRID');

-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('AVATAR', 'PORTFOLIO', 'CHAT_IMAGE', 'CHAT_FILE', 'REPORT_EVIDENCE');

-- CreateEnum
CREATE TYPE "UploadIntentStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UploadAssetStatus" AS ENUM ('USABLE', 'QUARANTINED', 'REMOVED');

-- CreateEnum
CREATE TYPE "DeviceProvider" AS ENUM ('EXPO', 'FCM');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(32),
    "account_status" "AccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "identity_verification_status" "IdentityVerificationStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "current_role_id" UUID,
    "onboarding_completed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_subject" VARCHAR(255),
    "email" VARCHAR(320),
    "password_hash" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "token_family_id" UUID NOT NULL,
    "device_id" VARCHAR(255),
    "user_agent" VARCHAR(512),
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "city_id" UUID,
    "avatar_asset_id" UUID,
    "display_name" VARCHAR(120),
    "date_of_birth" DATE,
    "bio" VARCHAR(1000),
    "status" "ProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" "RoleCode" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "RoleStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_initial_additional_role" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photographer_profiles" (
    "id" UUID NOT NULL,
    "user_role_id" UUID NOT NULL,
    "availability_status" "PhotographerAvailabilityStatus" NOT NULL DEFAULT 'UNAVAILABLE',
    "headline" VARCHAR(160),
    "years_experience" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "photographer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_fields" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activity_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_activity_fields" (
    "role_id" UUID NOT NULL,
    "activity_field_id" UUID NOT NULL,

    CONSTRAINT "role_activity_fields_pkey" PRIMARY KEY ("role_id","activity_field_id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "activity_field_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_fields" (
    "user_role_id" UUID NOT NULL,
    "activity_field_id" UUID NOT NULL,
    "selected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_fields_pkey" PRIMARY KEY ("user_role_id","activity_field_id")
);

-- CreateTable
CREATE TABLE "user_role_services" (
    "id" UUID NOT NULL,
    "user_role_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "service_mode" "ServiceMode" NOT NULL,
    "min_price" DECIMAL(14,2),
    "max_price" DECIMAL(14,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "price_unit" VARCHAR(40),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_role_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_items" (
    "id" UUID NOT NULL,
    "user_role_id" UUID NOT NULL,
    "service_id" UUID,
    "asset_id" UUID NOT NULL,
    "title" VARCHAR(160),
    "description" VARCHAR(1000),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" UUID NOT NULL,
    "language" "LanguageCode" NOT NULL DEFAULT 'VI',
    "theme" "ThemePreference" NOT NULL DEFAULT 'SYSTEM',
    "map_type" "MapType" NOT NULL DEFAULT 'STANDARD',
    "match_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "booking_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "read_receipts_enabled" BOOLEAN NOT NULL DEFAULT true,
    "profile_visibility_enabled" BOOLEAN NOT NULL DEFAULT false,
    "location_visibility_duration_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_locations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "exact_point" geography(Point, 4326) NOT NULL,
    "accuracy_meters" DOUBLE PRECISION,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_presence" (
    "id" UUID NOT NULL,
    "user_role_id" UUID NOT NULL,
    "public_point" geography(Point, 4326) NOT NULL,
    "public_radius_meters" INTEGER NOT NULL,
    "location_noise_meters" INTEGER NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT false,
    "visible_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discovery_presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_filters" (
    "id" UUID NOT NULL,
    "owner_user_role_id" UUID NOT NULL,
    "target_role_id" UUID NOT NULL,
    "radius_km" INTEGER NOT NULL DEFAULT 20,
    "min_price" DECIMAL(14,2),
    "max_price" DECIMAL(14,2),
    "available_only" BOOLEAN NOT NULL DEFAULT false,
    "verified_only" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discovery_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_filter_services" (
    "discovery_filter_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,

    CONSTRAINT "discovery_filter_services_pkey" PRIMARY KEY ("discovery_filter_id","service_id")
);

-- CreateTable
CREATE TABLE "swipes" (
    "id" UUID NOT NULL,
    "actor_user_role_id" UUID NOT NULL,
    "target_user_role_id" UUID NOT NULL,
    "discovery_filter_id" UUID,
    "direction" "SwipeDirection" NOT NULL,
    "source" "SwipeSource" NOT NULL,
    "effective_until" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "swipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "user_role_a_id" UUID NOT NULL,
    "user_role_b_id" UUID NOT NULL,
    "ended_by_user_id" UUID,
    "pair_key" VARCHAR(80) NOT NULL,
    "active_pair_key" VARCHAR(80),
    "status" "MatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "end_reason" VARCHAR(500),
    "matched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "reply_to_message_id" UUID,
    "asset_id" UUID,
    "client_message_id" VARCHAR(120) NOT NULL,
    "message_type" "MessageType" NOT NULL,
    "content" VARCHAR(5000),
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_receipts" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "message_receipts_pkey" PRIMARY KEY ("message_id","user_id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "id" UUID NOT NULL,
    "blocker_user_id" UUID NOT NULL,
    "blocked_user_id" UUID NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shoot_requests" (
    "id" UUID NOT NULL,
    "customer_user_role_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "city_id" UUID,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "budget_min" DECIMAL(14,2),
    "budget_max" DECIMAL(14,2),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "scheduled_start" TIMESTAMPTZ(3),
    "scheduled_end" TIMESTAMPTZ(3),
    "status" "ShootRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shoot_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "conversation_id" UUID,
    "shoot_request_id" UUID,
    "customer_user_role_id" UUID NOT NULL,
    "photographer_user_role_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "creator_user_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "agreed_price" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'VND',
    "scheduled_start" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_end" TIMESTAMPTZ(3) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "note" VARCHAR(2000),
    "cancellation_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "previous_status" "BookingStatus",
    "new_status" "BookingStatus" NOT NULL,
    "note" VARCHAR(1000),
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "reviewer_user_id" UUID NOT NULL,
    "reviewee_user_id" UUID NOT NULL,
    "moderated_by_user_id" UUID,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(2000),
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "moderation_reason" VARCHAR(1000),
    "moderated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "match_id" UUID,
    "message_id" UUID,
    "booking_id" UUID,
    "penalty_id" UUID,
    "notification_type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_reports" (
    "id" UUID NOT NULL,
    "reporter_user_id" UUID NOT NULL,
    "reported_user_id" UUID NOT NULL,
    "match_id" UUID,
    "conversation_id" UUID,
    "message_id" UUID,
    "booking_id" UUID,
    "resolved_by_user_id" UUID,
    "reason_code" "ReportReasonCode" NOT NULL,
    "description" VARCHAR(3000) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "admin_note" VARCHAR(3000),
    "resolution" VARCHAR(3000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "user_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_evidence" (
    "report_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,

    CONSTRAINT "report_evidence_pkey" PRIMARY KEY ("report_id","asset_id")
);

-- CreateTable
CREATE TABLE "account_penalties" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "report_id" UUID,
    "imposed_by_user_id" UUID NOT NULL,
    "revoked_by_user_id" UUID,
    "penalty_type" "PenaltyType" NOT NULL,
    "feature_code" VARCHAR(80),
    "reason" VARCHAR(2000) NOT NULL,
    "status" "PenaltyStatus" NOT NULL DEFAULT 'ACTIVE',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoke_reason" VARCHAR(1000),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "account_penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_verifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_type" VARCHAR(80) NOT NULL,
    "document_number" VARCHAR(120),
    "status" "IdentityVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "rejected_reason" VARCHAR(1000),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "identity_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" UUID NOT NULL,
    "document_type" "LegalDocumentType" NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "content_url" VARCHAR(1000) NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'INACTIVE',
    "active_type_key" VARCHAR(80),
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "user_id" UUID NOT NULL,
    "legal_document_id" UUID NOT NULL,
    "ip_address" INET,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("user_id","legal_document_id")
);

-- CreateTable
CREATE TABLE "device_registrations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" VARCHAR(255) NOT NULL,
    "provider" "DeviceProvider" NOT NULL,
    "token" VARCHAR(1000) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_intents" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "object_key" VARCHAR(1000) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "extension" VARCHAR(20) NOT NULL,
    "expected_size_bytes" BIGINT NOT NULL,
    "status" "UploadIntentStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_assets" (
    "id" UUID NOT NULL,
    "upload_intent_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "object_key" VARCHAR(1000) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" VARCHAR(255),
    "status" "UploadAssetStatus" NOT NULL DEFAULT 'USABLE',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "attached_at" TIMESTAMPTZ(3),
    "removed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "upload_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "actor_key" VARCHAR(160) NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "method" VARCHAR(12) NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "payload_hash" VARCHAR(128) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'PROCESSING',
    "response_code" INTEGER,
    "response_body" JSONB,
    "locked_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(160) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(3000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_deduplication" (
    "id" UUID NOT NULL,
    "channel" VARCHAR(60) NOT NULL,
    "delivery_key" VARCHAR(255) NOT NULL,
    "delivered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_deduplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "auth_identities_user_id_idx" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_provider_subject_key" ON "auth_identities"("provider", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identities_provider_email_key" ON "auth_identities"("provider", "email");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_sessions_token_family_id_idx" ON "auth_sessions"("token_family_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_consumed_at_idx" ON "email_verification_tokens"("user_id", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_consumed_at_idx" ON "password_reset_tokens"("user_id", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "user_profiles_city_id_status_idx" ON "user_profiles"("city_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "user_roles_role_id_status_idx" ON "user_roles"("role_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "photographer_profiles_user_role_id_key" ON "photographer_profiles"("user_role_id");

-- CreateIndex
CREATE INDEX "photographer_profiles_availability_status_idx" ON "photographer_profiles"("availability_status");

-- CreateIndex
CREATE UNIQUE INDEX "cities_code_key" ON "cities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "activity_fields_code_key" ON "activity_fields"("code");

-- CreateIndex
CREATE UNIQUE INDEX "services_code_key" ON "services"("code");

-- CreateIndex
CREATE INDEX "services_activity_field_id_status_idx" ON "services"("activity_field_id", "status");

-- CreateIndex
CREATE INDEX "user_role_services_service_id_service_mode_is_active_idx" ON "user_role_services"("service_id", "service_mode", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_services_user_role_id_service_id_service_mode_key" ON "user_role_services"("user_role_id", "service_id", "service_mode");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_items_asset_id_key" ON "portfolio_items"("asset_id");

-- CreateIndex
CREATE INDEX "portfolio_items_user_role_id_deleted_at_sort_order_idx" ON "portfolio_items"("user_role_id", "deleted_at", "sort_order");

-- CreateIndex
CREATE INDEX "user_locations_user_id_is_current_idx" ON "user_locations"("user_id", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_presence_user_role_id_key" ON "discovery_presence"("user_role_id");

-- CreateIndex
CREATE INDEX "discovery_presence_is_visible_visible_until_idx" ON "discovery_presence"("is_visible", "visible_until");

-- CreateIndex
CREATE INDEX "discovery_filters_owner_user_role_id_target_role_id_is_defa_idx" ON "discovery_filters"("owner_user_role_id", "target_role_id", "is_default");

-- CreateIndex
CREATE INDEX "swipes_actor_user_role_id_target_user_role_id_created_at_idx" ON "swipes"("actor_user_role_id", "target_user_role_id", "created_at");

-- CreateIndex
CREATE INDEX "swipes_target_user_role_id_direction_resolved_at_created_at_idx" ON "swipes"("target_user_role_id", "direction", "resolved_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "matches_active_pair_key_key" ON "matches"("active_pair_key");

-- CreateIndex
CREATE INDEX "matches_pair_key_ended_at_idx" ON "matches"("pair_key", "ended_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_match_id_key" ON "conversations"("match_id");

-- CreateIndex
CREATE INDEX "conversations_status_last_message_at_idx" ON "conversations"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_left_at_idx" ON "conversation_participants"("user_id", "left_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_id_idx" ON "messages"("conversation_id", "sent_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_sender_user_id_client_message_id_key" ON "messages"("sender_user_id", "client_message_id");

-- CreateIndex
CREATE INDEX "message_receipts_user_id_read_at_idx" ON "message_receipts"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "user_blocks_blocked_user_id_idx" ON "user_blocks"("blocked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_blocks_blocker_user_id_blocked_user_id_key" ON "user_blocks"("blocker_user_id", "blocked_user_id");

-- CreateIndex
CREATE INDEX "shoot_requests_status_city_id_idx" ON "shoot_requests"("status", "city_id");

-- CreateIndex
CREATE INDEX "bookings_customer_user_role_id_status_scheduled_start_idx" ON "bookings"("customer_user_role_id", "status", "scheduled_start");

-- CreateIndex
CREATE INDEX "bookings_photographer_user_role_id_status_scheduled_start_idx" ON "bookings"("photographer_user_role_id", "status", "scheduled_start");

-- CreateIndex
CREATE INDEX "bookings_match_id_created_at_idx" ON "bookings"("match_id", "created_at");

-- CreateIndex
CREATE INDEX "booking_status_history_booking_id_changed_at_idx" ON "booking_status_history"("booking_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

-- CreateIndex
CREATE INDEX "reviews_reviewee_user_id_status_created_at_idx" ON "reviews"("reviewee_user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_created_at_idx" ON "notifications"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_reports_status_created_at_idx" ON "user_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "user_reports_reported_user_id_status_idx" ON "user_reports"("reported_user_id", "status");

-- CreateIndex
CREATE INDEX "account_penalties_user_id_status_starts_at_ends_at_idx" ON "account_penalties"("user_id", "status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "identity_verifications_user_id_status_idx" ON "identity_verifications"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_active_type_key_key" ON "legal_documents"("active_type_key");

-- CreateIndex
CREATE INDEX "legal_documents_document_type_status_effective_at_idx" ON "legal_documents"("document_type", "status", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_document_type_version_key" ON "legal_documents"("document_type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "device_registrations_token_key" ON "device_registrations"("token");

-- CreateIndex
CREATE INDEX "device_registrations_user_id_is_active_idx" ON "device_registrations"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "device_registrations_user_id_device_id_provider_key" ON "device_registrations"("user_id", "device_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "upload_intents_object_key_key" ON "upload_intents"("object_key");

-- CreateIndex
CREATE INDEX "upload_intents_owner_user_id_purpose_status_idx" ON "upload_intents"("owner_user_id", "purpose", "status");

-- CreateIndex
CREATE INDEX "upload_intents_status_expires_at_idx" ON "upload_intents"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "upload_assets_upload_intent_id_key" ON "upload_assets"("upload_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "upload_assets_object_key_key" ON "upload_assets"("object_key");

-- CreateIndex
CREATE INDEX "upload_assets_owner_user_id_purpose_status_idx" ON "upload_assets"("owner_user_id", "purpose", "status");

-- CreateIndex
CREATE INDEX "upload_assets_status_attached_at_created_at_idx" ON "upload_assets"("status", "attached_at", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_records_status_expires_at_idx" ON "idempotency_records"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_actor_key_idempotency_key_method_path_key" ON "idempotency_records"("actor_key", "idempotency_key", "method", "path");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_deduplication_channel_delivery_key_key" ON "delivery_deduplication"("channel", "delivery_key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_current_role_id_fkey" FOREIGN KEY ("current_role_id") REFERENCES "user_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_avatar_asset_id_fkey" FOREIGN KEY ("avatar_asset_id") REFERENCES "upload_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photographer_profiles" ADD CONSTRAINT "photographer_profiles_user_role_id_fkey" FOREIGN KEY ("user_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_activity_fields" ADD CONSTRAINT "role_activity_fields_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_activity_fields" ADD CONSTRAINT "role_activity_fields_activity_field_id_fkey" FOREIGN KEY ("activity_field_id") REFERENCES "activity_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_activity_field_id_fkey" FOREIGN KEY ("activity_field_id") REFERENCES "activity_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_fields" ADD CONSTRAINT "user_role_fields_user_role_id_fkey" FOREIGN KEY ("user_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_fields" ADD CONSTRAINT "user_role_fields_activity_field_id_fkey" FOREIGN KEY ("activity_field_id") REFERENCES "activity_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_services" ADD CONSTRAINT "user_role_services_user_role_id_fkey" FOREIGN KEY ("user_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_services" ADD CONSTRAINT "user_role_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_user_role_id_fkey" FOREIGN KEY ("user_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_items" ADD CONSTRAINT "portfolio_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "upload_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_locations" ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_presence" ADD CONSTRAINT "discovery_presence_user_role_id_fkey" FOREIGN KEY ("user_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_filters" ADD CONSTRAINT "discovery_filters_owner_user_role_id_fkey" FOREIGN KEY ("owner_user_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_filters" ADD CONSTRAINT "discovery_filters_target_role_id_fkey" FOREIGN KEY ("target_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_filter_services" ADD CONSTRAINT "discovery_filter_services_discovery_filter_id_fkey" FOREIGN KEY ("discovery_filter_id") REFERENCES "discovery_filters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_filter_services" ADD CONSTRAINT "discovery_filter_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_actor_user_role_id_fkey" FOREIGN KEY ("actor_user_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_target_user_role_id_fkey" FOREIGN KEY ("target_user_role_id") REFERENCES "user_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_discovery_filter_id_fkey" FOREIGN KEY ("discovery_filter_id") REFERENCES "discovery_filters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_role_a_id_fkey" FOREIGN KEY ("user_role_a_id") REFERENCES "user_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_role_b_id_fkey" FOREIGN KEY ("user_role_b_id") REFERENCES "user_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_ended_by_user_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "upload_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_receipts" ADD CONSTRAINT "message_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_fkey" FOREIGN KEY ("blocker_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_fkey" FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shoot_requests" ADD CONSTRAINT "shoot_requests_customer_user_role_id_fkey" FOREIGN KEY ("customer_user_role_id") REFERENCES "user_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shoot_requests" ADD CONSTRAINT "shoot_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shoot_requests" ADD CONSTRAINT "shoot_requests_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_shoot_request_id_fkey" FOREIGN KEY ("shoot_request_id") REFERENCES "shoot_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_user_role_id_fkey" FOREIGN KEY ("customer_user_role_id") REFERENCES "user_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_photographer_user_role_id_fkey" FOREIGN KEY ("photographer_user_role_id") REFERENCES "user_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_creator_user_id_fkey" FOREIGN KEY ("creator_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewee_user_id_fkey" FOREIGN KEY ("reviewee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_user_id_fkey" FOREIGN KEY ("moderated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_penalty_id_fkey" FOREIGN KEY ("penalty_id") REFERENCES "account_penalties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_reports" ADD CONSTRAINT "user_reports_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_evidence" ADD CONSTRAINT "report_evidence_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "user_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_evidence" ADD CONSTRAINT "report_evidence_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "upload_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_penalties" ADD CONSTRAINT "account_penalties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_penalties" ADD CONSTRAINT "account_penalties_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "user_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_penalties" ADD CONSTRAINT "account_penalties_imposed_by_user_id_fkey" FOREIGN KEY ("imposed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_penalties" ADD CONSTRAINT "account_penalties_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_verifications" ADD CONSTRAINT "identity_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_legal_document_id_fkey" FOREIGN KEY ("legal_document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_registrations" ADD CONSTRAINT "device_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_assets" ADD CONSTRAINT "upload_assets_upload_intent_id_fkey" FOREIGN KEY ("upload_intent_id") REFERENCES "upload_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_assets" ADD CONSTRAINT "upload_assets_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Spatial indexes and partial uniqueness not expressible in Prisma schema.
CREATE INDEX "user_locations_exact_point_gist_idx" ON "user_locations" USING GIST ("exact_point");
CREATE INDEX "discovery_presence_public_point_gist_idx" ON "discovery_presence" USING GIST ("public_point");
CREATE UNIQUE INDEX "user_locations_one_current_per_user_idx"
  ON "user_locations" ("user_id")
  WHERE "is_current" = true AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "discovery_filters_one_default_idx"
  ON "discovery_filters" ("owner_user_role_id", "target_role_id")
  WHERE "is_default" = true;

-- Domain checks that must remain true even when data is written outside the API.
ALTER TABLE "user_blocks"
  ADD CONSTRAINT "user_blocks_not_self_check" CHECK ("blocker_user_id" <> "blocked_user_id");
ALTER TABLE "user_role_services"
  ADD CONSTRAINT "user_role_services_price_range_check"
  CHECK ("min_price" IS NULL OR "max_price" IS NULL OR "min_price" <= "max_price");
ALTER TABLE "shoot_requests"
  ADD CONSTRAINT "shoot_requests_budget_range_check"
  CHECK ("budget_min" IS NULL OR "budget_max" IS NULL OR "budget_min" <= "budget_max"),
  ADD CONSTRAINT "shoot_requests_schedule_check"
  CHECK ("scheduled_start" IS NULL OR "scheduled_end" IS NULL OR "scheduled_start" < "scheduled_end");
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_schedule_check" CHECK ("scheduled_start" < "scheduled_end"),
  ADD CONSTRAINT "bookings_price_check" CHECK ("agreed_price" >= 0),
  ADD CONSTRAINT "bookings_distinct_roles_check" CHECK ("customer_user_role_id" <> "photographer_user_role_id");
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_moderation_metadata_check" CHECK (
    ("status" = 'PUBLISHED') OR
    ("moderated_by_user_id" IS NOT NULL AND "moderation_reason" IS NOT NULL AND "moderated_at" IS NOT NULL)
  );
ALTER TABLE "user_reports"
  ADD CONSTRAINT "user_reports_not_self_check" CHECK ("reporter_user_id" <> "reported_user_id"),
  ADD CONSTRAINT "user_reports_resolution_check" CHECK (
    ("status" IN ('OPEN', 'IN_REVIEW')) OR
    ("resolved_by_user_id" IS NOT NULL AND "resolution" IS NOT NULL AND "resolved_at" IS NOT NULL)
  );
ALTER TABLE "account_penalties"
  ADD CONSTRAINT "account_penalties_window_check" CHECK ("ends_at" IS NULL OR "starts_at" < "ends_at"),
  ADD CONSTRAINT "account_penalties_feature_check" CHECK ("penalty_type" <> 'FEATURE_RESTRICTION' OR "feature_code" IS NOT NULL),
  ADD CONSTRAINT "account_penalties_revoke_check" CHECK (
    "status" <> 'REVOKED' OR
    ("revoked_by_user_id" IS NOT NULL AND "revoke_reason" IS NOT NULL AND "revoked_at" IS NOT NULL)
  );
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_payload_check" CHECK (
    ("message_type" IN ('TEXT', 'SYSTEM') AND "content" IS NOT NULL) OR
    ("message_type" IN ('IMAGE', 'FILE') AND "asset_id" IS NOT NULL)
  );
ALTER TABLE "upload_intents"
  ADD CONSTRAINT "upload_intents_size_check" CHECK ("expected_size_bytes" > 0);
ALTER TABLE "upload_assets"
  ADD CONSTRAINT "upload_assets_size_check" CHECK ("size_bytes" > 0);
