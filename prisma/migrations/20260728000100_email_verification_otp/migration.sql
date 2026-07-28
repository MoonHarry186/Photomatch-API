ALTER TABLE "email_verification_tokens"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_at" TIMESTAMPTZ(3);

ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_attempt_count_check"
  CHECK ("attempt_count" >= 0 AND "attempt_count" <= 5);
