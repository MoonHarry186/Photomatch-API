# Media policy

| Purpose | MIME allow-list | Extensions | Maximum | Orphan retention |
| --- | --- | --- | ---: | ---: |
| Avatar | `image/jpeg`, `image/png`, `image/webp` | jpg, jpeg, png, webp | 5 MB | 24 hours |
| Portfolio | `image/jpeg`, `image/png`, `image/webp` | jpg, jpeg, png, webp | 15 MB | 24 hours |
| Chat image | `image/jpeg`, `image/png`, `image/webp` | jpg, jpeg, png, webp | 15 MB | 24 hours |
| Chat file | `application/pdf`, DOC/DOCX | pdf, doc, docx | 25 MB | 24 hours |
| Report evidence | image allow-list plus `application/pdf`, `video/mp4` | jpg, jpeg, png, webp, pdf, mp4 | 25 MB | 7 days |

All upload intents are owner- and purpose-bound, expire after 15 minutes, and become usable only after server-side metadata verification. A quarantine hook is available before attachment. Private downloads require domain authorization and a short-lived signed URL.
