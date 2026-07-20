# ADR 0001: External integration boundaries

## Status

Accepted for MVP.

## Decision

- Object storage: Cloudflare R2 through the AWS S3-compatible SDK. Buckets are private by default.
- Local storage: fake in-memory adapter for tests and MinIO for manual integration testing.
- Email: an `EmailPort`; fake adapter by default and SMTP adapter for deployed environments.
- OAuth: an `OAuthVerifierPort` with Google and Apple implementations that validate issuer, audience, signature, expiry and nonce. Tests use a fake verifier.
- Push: a `PushPort` with Expo/FCM adapters and fake local implementation.
- Monitoring: Sentry behind sanitized exception/log boundaries; no tokens, passwords, exact coordinates or admin notes are sent.

Provider calls are not made inside core database transactions. Durable side effects use the outbox and worker pipeline.
