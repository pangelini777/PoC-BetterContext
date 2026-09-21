---
description: "Privacy handling requirements for personal data such as names, email addresses, postal addresses, identifiers, exports, and deletion."
applyTo: "**/*"
tags: [privacy, pii]
---

# Personal-data handling

Apply once the task is known to collect, persist, export, delete, transmit, or expose personal data.

- Collect only fields required by the product behavior being implemented.
- Do not copy personal data into logs, analytics events, test snapshots, exception messages, URLs, or filenames.
- Keep storage and API exposure scoped to the minimum fields needed by the caller.
- New persistence of personal data must have a clear deletion/retention path; avoid orphan copies in auxiliary tables or caches.
- Test fixtures must use synthetic values, never production/customer data.
- Before introducing a new third-party transmission, make that boundary explicit in code/configuration and surface it for review.

For this synthetic package, email, full name, postal address, phone number, and stable customer identifiers are treated as personal data.
