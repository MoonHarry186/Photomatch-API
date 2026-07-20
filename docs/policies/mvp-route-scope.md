# MVP route scope

The following capabilities are deliberately disabled and must not appear in the generated OpenAPI contract:

- Paid Photographer-initiated `RIGHT` swipe (returns `FEATURE_NOT_AVAILABLE` through the candidate decision endpoint)
- Shoot requests
- Referrals/rewards
- Notification inbox
- Identity-verification provider workflow
- Generic update/delete routes for sent messages, submitted reviews, matches, bookings, reports, penalties and active legal versions
