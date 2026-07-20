# Deployment

## Release order

1. Build one immutable image and deploy it to staging.
2. Apply `deploy/kubernetes/config.yaml`; provision `photomatch-backend-secrets` outside source control.
3. Run `node scripts/deploy-migrations.js` as a one-off job.
4. Roll out API first, then worker, using the same image digest.
5. Verify `/api/v1/health/live`, `/api/v1/health/ready`, worker heartbeat, queue failures and Sentry.
6. Run generated-client smoke tests before opening traffic.

Schema changes use expand/migrate/contract. Applied migrations are immutable. Roll back application and worker independently only while the expanded schema is backward compatible; database repair uses a reviewed forward-fix migration.

## Required secrets

`DATABASE_URL`, `REDIS_URL`, both JWT secrets, `SMTP_URL`, OAuth client IDs, R2 endpoint/bucket/credentials, Expo token when used, FCM service-account values, `SENTRY_DSN`, and CORS origins belong in the environment secret store. Never place them in ConfigMaps, images, logs or CI artifacts.

## Backup

Run `scripts/backup-database.sh` daily with encrypted, access-controlled object storage and retention rules. A staging restore rehearsal must restore the latest dump to a fresh database, run `prisma migrate status`, execute critical API journeys, and record recovery time and recovery point before production release.
