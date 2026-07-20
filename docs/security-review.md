# MVP privacy and security review

Review date: 2026-07-20

Scope: exact location, credentials and token hashes, admin-only notes, media access,
authorization boundaries, and rate limits for the Photomatch MVP backend.

## Result

The reviewed controls pass for the MVP deployment model. No exact coordinate, password
hash, refresh-token hash, or admin note is exposed by a mobile/public response covered by
the automated journeys. Private media access is owner-bound and returns a five-minute
signed URL. Sensitive command routes have explicit throttles in addition to the global
limit.

## Evidence

| Area | Control | Automated evidence |
| --- | --- | --- |
| Exact GPS | `user_locations.exact_point` is separate from the stable, obfuscated `discovery_presence.public_point`; public discovery returns only distance buckets. | `profile-catalog.e2e.spec.ts`, `discovery-performance.spec.ts`, `safety-admin.e2e.spec.ts` |
| Passwords and tokens | Passwords use Argon2id; refresh tokens are persisted only as hashes; auth responses use explicit selects; logs and monitoring filter password/token fields. | `auth-lifecycle.e2e.spec.ts`, `sanitize.spec.ts`, `safety-admin.e2e.spec.ts` |
| Admin notes | Report list projections omit `adminNote`; detail and resolution routes require an ADMIN role and admin JWT audience; monitoring sanitization filters `adminNote`. | `safety-admin.e2e.spec.ts`, `realtime-contract.spec.ts`, `sanitize.spec.ts` |
| Upload ownership | Presign and completion are owner-bound; completion verifies object size and MIME metadata; attachment validates owner, purpose, and usable status. | `interest-chat.e2e.spec.ts`, `safety-admin.e2e.spec.ts` |
| Private downloads | Chat files, chat images, and report evidence are private; non-owners receive `ASSET_ACCESS_DENIED`; owners receive a short-lived signed URL. | `safety-admin.e2e.spec.ts` |
| Public media | Only avatar and portfolio policies permit public objects. Object keys are generated server-side under an environment/user/purpose prefix. | `upload-policy.ts`, `uploads.service.ts` |
| Role boundaries | Mobile and admin access tokens have separate audiences; admin routes require both ADMIN role and admin audience; sessions and account penalties are checked on every protected request. | `auth-lifecycle.e2e.spec.ts`, `safety-admin.e2e.spec.ts` |
| Safety controls | Blocks propagate bidirectionally; report evidence must belong to the reporter; account and feature penalties are enforced and revocable. | `interest-chat.e2e.spec.ts`, `safety-admin.e2e.spec.ts` |
| Rate limits | Global 120 requests/minute; tighter limits exist for auth, reports, block, uploads, interests, booking, and admin surfaces. Report throttling is verified at the HTTP boundary. | `safety-admin.e2e.spec.ts`, controller throttle metadata |
| Error/log boundary | Unexpected errors return a generic `INTERNAL_ERROR`; Sentry and server error logs pass through recursive sensitive-key sanitization. | `api-boundary.e2e.spec.ts`, `sanitize.spec.ts` |

## Release conditions and residual risk

- Production secrets must come from the secret manager and must never be committed or
  rendered into ConfigMaps. Rotate JWT, OAuth, SMTP, push, R2, and database credentials on
  suspected disclosure.
- Validate R2 bucket policy, CORS, public base URL, signed URL expiry, and orphan cleanup in
  staging against the real Cloudflare account before opening traffic.
- The current throttler storage is process-local. One API replica is acceptable for the MVP
  launch; before horizontal scaling, use a Redis-backed limiter or enforce equivalent limits
  at the ingress/API gateway so limits apply across replicas.
- TLS termination, database encryption/backup encryption, network policies, and access-log
  retention remain deployment controls and must be checked in the staging release review.
- Re-run `npm audit --omit=dev`, the full test suite, and this review after dependency,
  authorization, upload-policy, or response-projection changes.
