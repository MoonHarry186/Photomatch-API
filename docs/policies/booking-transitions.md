# Booking transition matrix

| From | To | Actor | Reason |
| --- | --- | --- | --- |
| DRAFT | PENDING | Creator | Optional |
| PENDING | ACCEPTED | Non-creator participant | Optional |
| PENDING | REJECTED | Non-creator participant | Required |
| PENDING | CANCELLED | Creator | Required |
| ACCEPTED | CANCELLED | Either participant before start | Required |
| ACCEPTED | IN_PROGRESS | Photographer | Optional |
| IN_PROGRESS | COMPLETED | Photographer | Optional |
| ACCEPTED | DISPUTED | Either participant | Required |
| IN_PROGRESS | DISPUTED | Either participant | Required |
| COMPLETED | DISPUTED | Either participant | Required |

Core schedule/service/price fields may be patched only by the creator while `PENDING`. Every transition appends booking history in the same transaction. There is no hard-delete booking operation.
