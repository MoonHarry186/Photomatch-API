# Location privacy policy

- Exact coordinates are owner/system-only and never appear in public DTOs.
- Public coordinates use one stable random offset per visibility window.
- Noise radius: 1,000-3,000 meters, configurable by environment.
- Default nearby radius: 20 km; maximum: 100 km.
- Default visibility window: 24 hours.
- Public distance is represented as approximate buckets: `<1 km`, `1-3 km`, `3-5 km`, `5-10 km`, `10-20 km`, `20-50 km`, `50+ km`.
- Deleting exact location disables all active discovery presence.
