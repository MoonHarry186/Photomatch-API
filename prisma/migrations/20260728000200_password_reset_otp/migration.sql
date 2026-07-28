ALTER TABLE "password_reset_tokens"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_at" TIMESTAMPTZ(3),
  ADD COLUMN "verified_at" TIMESTAMPTZ(3);

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_attempt_count_check"
  CHECK ("attempt_count" >= 0 AND "attempt_count" <= 5);
