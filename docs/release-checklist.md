# Release checklist

- [ ] Production dependency audit reports zero vulnerabilities.
- [ ] Lint, format check, typecheck, unit, integration, e2e, build and contract tests pass.
- [ ] Initial/forward migration applies to a fresh PostGIS database and `prisma migrate status` is clean.
- [ ] OpenAPI has no drift and generated mobile/admin clients compile.
- [ ] Staging API readiness and worker heartbeat are healthy.
- [ ] Signup/verification/sign-in/refresh and admin sign-in pass.
- [ ] Interest accept -> match/chat -> unmatch journey passes.
- [ ] Direct booking -> `PENDING` -> accepted -> completed -> review journey passes.
- [ ] Block/report/admin resolve/temporary penalty/expiry journey passes.
- [ ] R2 presign/complete/access and orphan cleanup pass with private-object checks.
- [ ] Push deep links and WebSocket events reach only authorized participants.
- [ ] Database backup exists and staging restore rehearsal is recorded.
- [ ] Error-rate, latency, queue, worker, storage and database-capacity alerts are active.
- [ ] Rollback image and independent API/worker scale-to-zero switches are documented.
