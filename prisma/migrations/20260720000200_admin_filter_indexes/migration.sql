CREATE INDEX "users_account_status_created_at_idx"
  ON "users"("account_status", "created_at");

CREATE INDEX "users_identity_verification_status_created_at_idx"
  ON "users"("identity_verification_status", "created_at");

CREATE INDEX "activity_fields_status_created_at_idx"
  ON "activity_fields"("status", "created_at");

CREATE INDEX "bookings_status_scheduled_start_id_idx"
  ON "bookings"("status", "scheduled_start", "id");

CREATE INDEX "bookings_service_id_status_scheduled_start_idx"
  ON "bookings"("service_id", "status", "scheduled_start");

CREATE INDEX "reviews_status_rating_created_at_idx"
  ON "reviews"("status", "rating", "created_at");

CREATE INDEX "reviews_reviewer_user_id_created_at_idx"
  ON "reviews"("reviewer_user_id", "created_at");

CREATE INDEX "user_reports_reason_code_status_created_at_idx"
  ON "user_reports"("reason_code", "status", "created_at");

CREATE INDEX "user_reports_reporter_user_id_created_at_idx"
  ON "user_reports"("reporter_user_id", "created_at");

CREATE INDEX "user_reports_booking_id_created_at_idx"
  ON "user_reports"("booking_id", "created_at");

CREATE INDEX "account_penalties_penalty_type_status_starts_at_idx"
  ON "account_penalties"("penalty_type", "status", "starts_at");

CREATE INDEX "account_penalties_status_starts_at_ends_at_idx"
  ON "account_penalties"("status", "starts_at", "ends_at");
