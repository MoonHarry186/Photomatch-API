# Photomatch API

NestJS modular-monolith backend for the Photomatch MVP.

## Stack

- Node.js 22, NestJS 11 and TypeScript
- Prisma 5 with PostgreSQL 15 and PostGIS
- Redis/BullMQ for queues and idempotent background work
- Cloudflare R2 through its S3-compatible API
- JWT access tokens with rotating refresh sessions
- REST/OpenAPI plus Socket.IO delivery for realtime chat

## Local setup

1. Copy `.env.example` to `.env` and replace local secrets.
2. Run `npm install`.
3. Start PostgreSQL/PostGIS, Redis, Mailpit and MinIO with `docker compose up -d postgres redis mailpit minio minio-init`. The one-shot `minio-init` service creates the local R2-compatible bucket.
4. Run `npm run prisma:migrate:deploy && npm run seed`.
5. Start the API with `npm run start:dev`.

The API is served under `/api/v1`; Swagger is available at `/api/docs` outside production.

The local stack uses dedicated host ports to avoid collisions: PostgreSQL `55432`, Redis `56379`, MinIO `59000/59001`, API `53000`, and Mailpit `1025/8025`. API and worker containers use Compose service DNS internally.

## Integration decisions

Cloudflare R2 is the only production object store. Local/test environments use the same storage port with a fake adapter or MinIO. Email, OAuth verification and push are adapter-based and default to fake implementations outside production. See `docs/adr/` and `docs/policies/`.

## Out-of-scope routes

The MVP intentionally exposes no notification inbox, shoot request, referral, identity-verification provider workflow, or paid Photographer-initiated swipe route. Unsupported routes must remain absent from OpenAPI.
