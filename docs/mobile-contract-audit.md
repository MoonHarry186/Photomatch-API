# Mobile endpoint-by-screen contract audit

Source order for the mobile client:

1. `photomatch-api/openapi.json` generated from current controllers and response contracts.
2. Runtime service serializers and backend domain policies.
3. `documents/1.0.0-mvp/plan/photomatch-mvp-plan.md` for approved behavior.
4. Mobile OpenSpec capability requirements.

The generated client must not use endpoint strings from the older product-plan table where they differ from OpenAPI.

| Mobile surface | Implemented operations | Contract readiness |
| --- | --- | --- |
| Bootstrap/auth | `/auth/sign-up`, `/auth/sign-in`, `/auth/oauth`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/forgot-password`, `/auth/verify-password-reset-otp`, `/auth/reset-password`, `/auth/refresh`, `/auth/sign-out`, `/me`, `/me/restrictions` | Password recovery uses a six-digit OTP followed by a short-lived one-time reset grant. |
| Onboarding | `/roles/available`, `/me/roles`, `/me/current-role`, `/cities`, `/activity-fields`, `/services`, `/legal-documents/current`, `/me/consents`, `/me/profile`, `/me/profile/avatar`, `/me/location` | Add `/me/onboarding/progress`; type self profile, selected fields/services, and consent responses. |
| Profiles/portfolio | `/profiles/{userRoleId}`, `/me/photographer-profile`, role-scoped owned portfolio routes, `/photographers/{photographerRoleId}/portfolio` | Type distinct public/Photographer/portfolio read models; keep role-scoped portfolio paths. |
| Discovery/Nearby | `/me/discovery-presence`, `/discovery/candidates`, `/nearby`, `/swipes` | Enrich discovery card summary; make Nearby return only obfuscated `discovery_presence.public_point` coordinates. |
| Interests/matches | `/interests/incoming`, `/interests/{interestId}/decision`, `/matches`, `/matches/{matchId}`, `/matches/{matchId}/unmatch` | Type current nested Customer/counterpart/conversation serializers. |
| Messaging | `/conversations`, `/conversations/{conversationId}`, message collection/send, conversation-scoped message receipt | Type counterpart, participants, last message, reply/receipts; keep conversation-scoped receipt path. |
| Bookings/reviews | `/bookings`, `/bookings/{bookingId}`, booking status, booking review, Photographer reviews | Type counterpart, service, cancellation and ordered history already returned at runtime. |
| Media | `/uploads/presign`, `/uploads/{uploadId}/complete`, `GET /uploads/{assetId}/access-url` | Keep actual `GET` access route; asset IDs remain canonical and access URLs ephemeral. |
| Trust | `/blocks`, `/blocks/{blockedUserId}`, `/reports`, `/me/restrictions` | Type nested blocked-user summary and privacy-minimized active penalty response. |
| Settings/push | `/me/settings`, `/devices`, `/devices/{deviceId}` | Type all settings fields and device `lastSeenAt`; push data is allow-listed by the client. |
| Realtime/deep links | Socket.IO namespace `/realtime`, `conversation.join`, message/receipt/match/booking events; `photomatch://bookings/{id}` payloads | Publish shared event/push payload types and keep REST as history source. |

## Additive response changes

- No existing `/api/v1` path or command payload is removed or renamed.
- Exact user location, credential material, Admin notes, and unauthorized evidence remain absent.
- Existing Web Admin operations and generated bindings remain compatible.
- Runtime serializers and OpenAPI schemas must agree before the mobile client is generated.
