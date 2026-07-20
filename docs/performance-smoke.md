# MVP performance smoke

Run date: 2026-07-20

Environment: local Node 22 API, PostGIS and Redis containers, sequential HTTP smoke after
three warm-up requests. Results are release signals, not production capacity claims.

| Boundary | Samples | P95 | MVP target | Result |
| --- | ---: | ---: | ---: | --- |
| Authenticated regular API (`GET /me`) | 30 | 4.2 ms | < 500 ms | Pass |
| Text chat send | 30 | 61.0 ms | < 500 ms | Pass |
| Discovery HTTP query | 30 | 10.6 ms | < 1,000 ms | Pass |
| Nearby HTTP query | 30 | 8.7 ms | < 1,000 ms | Pass |

The spatial integration benchmark additionally seeded 1,000 visible photographer
presences, asserted use of `discovery_presence_public_point_gist_idx`, and passed the
discovery P95 threshold across 30 measured repository queries.

Re-run with `npx jest --runInBand test/performance/load-smoke.spec.ts` and
`npx jest --runInBand test/integration/discovery-performance.spec.ts`. A staging load run
with production-like network, R2, database sizing, and concurrent users remains part of the
release rehearsal.
