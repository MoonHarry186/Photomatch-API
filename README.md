# Photomatch API

NestJS modular-monolith backend for the Photomatch MVP.

## Stack

- Node.js 22, NestJS 11 and TypeScript
- Prisma 5 with PostgreSQL 15 and PostGIS
- Redis/BullMQ for queues and idempotent background work
- Cloudflare R2 through its S3-compatible API
- JWT access tokens with rotating refresh sessions
- REST/OpenAPI plus Socket.IO delivery for realtime chat

## Run locally with Docker

### Requirements

- Docker Desktop with Docker Compose
- The ports listed below must be available

### First-time setup

From the project directory, create the local environment file:

```bash
cp .env.example .env
```

The example values are ready for the local Docker services. Replace the JWT secrets
before using the environment outside your machine.

Build the API and worker images, then start the complete stack:

```bash
docker compose up -d --build
```

Create/update the database schema and insert the development seed data:

```bash
docker compose run --rm api npm run prisma:migrate:deploy
docker compose run --rm api npm run seed
```

Restart the application processes after the initial database setup:

```bash
docker compose restart api worker
```

The seed command is normally needed only during the first setup. Run migrations
again whenever the project contains a new Prisma migration.

### Daily startup

After the first-time setup, start the existing containers with one command:

```bash
docker compose up -d
```

Opening Docker Desktop alone does not guarantee that this project's containers are
running because the Compose services do not currently define an automatic restart
policy. After opening Docker Desktop or restarting the machine, run the command
above from this directory.

If dependencies, the Dockerfile, or application code have changed, rebuild the
application images:

```bash
docker compose up -d --build
```

If a new migration has been added, apply it with:

```bash
docker compose run --rm api npm run prisma:migrate:deploy
```

### Verify the stack

Check container status:

```bash
docker compose ps
```

The `api`, `worker`, `postgres`, `redis`, `mailpit`, and `minio` services should be
running. The `minio-init` service showing `Exited (0)` is expected: it runs once to
create the local R2-compatible bucket and then exits successfully.

Useful local URLs:

| Service | URL |
| --- | --- |
| Swagger UI | http://localhost:53000/api/docs |
| API base URL | http://localhost:53000/api/v1 |
| API health check | http://localhost:53000/api/v1/health/live |
| Mailpit inbox | http://localhost:8025 |
| MinIO console | http://localhost:59001 |

The local stack uses PostgreSQL on `55432`, Redis on `56379`, MinIO's S3-compatible
API on `59000`, MinIO's console on `59001`, the API on `53000`, and Mailpit on
`1025/8025`. API and worker containers use Compose service DNS internally.

### Logs and shutdown

Follow the API and worker logs:

```bash
docker compose logs -f api worker
```

Press `Ctrl+C` to stop following logs; the containers keep running in the
background.

Stop the stack while preserving PostgreSQL and MinIO data:

```bash
docker compose down
```

Avoid `docker compose down -v` unless you intentionally want to delete the local
database and stored files.

### Native development mode

For hot reload, run only the infrastructure services in Docker:

```bash
docker compose up -d postgres redis mailpit minio minio-init
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run seed
npm run start:dev
```

The native development API is available at http://localhost:3000/api/docs. Keep the
background worker in a second terminal after building the project:

```bash
npm run build
npm run start:worker
```

By default, `.env.example` uses fake email, OAuth, and push adapters. To inspect
development emails in Mailpit, set `EMAIL_ADAPTER=smtp`. Keep
`SMTP_URL=smtp://localhost:1025` in native development mode; when the API runs in
Docker, use `SMTP_URL=smtp://mailpit:1025` because containers reach Mailpit by its
Compose service name.

## Integration decisions

Cloudflare R2 is the only production object store. Local/test environments use the same storage port with a fake adapter or MinIO. Email, OAuth verification and push are adapter-based and default to fake implementations outside production. See `docs/adr/` and `docs/policies/`.

## Out-of-scope routes

The MVP intentionally exposes no notification inbox, shoot request, referral, identity-verification provider workflow, or paid Photographer-initiated swipe route. Unsupported routes must remain absent from OpenAPI.
