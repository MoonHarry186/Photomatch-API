# Message attachment model

Canonical message types are `TEXT`, `SYSTEM`, `IMAGE` and `FILE`.

- `TEXT`: bounded non-empty text and no required asset.
- `SYSTEM`: server-authored immutable text/event payload.
- `IMAGE`: one verified `CHAT_IMAGE` asset and optional caption.
- `FILE`: one verified `CHAT_FILE` asset and optional caption.

Messages are immutable after send. Client retries are deduplicated by `(sender_user_id, client_message_id)`. Storage metadata lives in `UploadAsset`; messages reference the canonical asset id instead of persisting signed URLs.
