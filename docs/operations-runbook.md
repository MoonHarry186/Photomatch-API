# Operations runbook

## Migration failure

1. Stop the rollout and keep the currently healthy API/worker image serving.
2. Capture migration job logs and `prisma migrate status` without exposing `DATABASE_URL`.
3. Do not edit an applied migration or run destructive rollback SQL.
4. Correct the issue with a reviewed forward-fix migration, rehearse on a restored staging snapshot, then rerun the one-off migration job.

## Queue retry and terminal failure

Check Redis capacity, worker heartbeat and `outbox_events` rows in `PROCESSING`/`FAILED`. Provider outages should be retried with exponential backoff. After correcting the cause, move reviewed terminal failures back to `PENDING` with a future `available_at`; delivery deduplication prevents repeated successful push sends.

## Invalid push tokens

Provider `DeviceNotRegistered`, `UNREGISTERED` or `NOT_FOUND` responses deactivate the device registration. Users re-register on the next app session. Do not repeatedly retry a known-invalid token.

## Email, OAuth, push or R2 outage

Keep provider errors generic at the API boundary, preserve request IDs, and inspect sanitized Sentry events. Pause affected workers when retry volume threatens Redis/provider quotas. R2 completion remains pending until object metadata can be verified; never mark an unverified asset usable.

## Penalty expiration recovery

Run the idempotent `maintenance.penalty-expiration` job. Confirm expired penalties changed status and suspended accounts without another active suspension/ban returned to `ACTIVE`. Permanent bans with no end are never expired automatically.

## Location expiration recovery

Run `maintenance.presence-expiration`, confirm visible expired rows become hidden, and verify no public response contains exact coordinates. Deleting an exact location must also hide every role presence.

## Media cleanup recovery

Run `maintenance.orphan-media` in batches. Only unattached assets older than the purpose retention window may be removed. Report evidence and attached chat/portfolio/avatar assets must remain. Storage deletion succeeds before the database asset is marked `REMOVED`.

## Database restore

Restore a custom-format dump with `pg_restore --clean --if-exists --no-owner`, run migration status, seed only reference data, then execute signup, discovery, booking, chat and review smoke tests. Record start/end time, dump timestamp and any data loss window.
