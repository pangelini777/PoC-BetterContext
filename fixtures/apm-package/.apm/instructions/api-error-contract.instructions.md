---
description: "Contract for API validation, status codes, stable machine-readable errors, and safe client-facing failure responses."
applyTo: "app/api/**/*.ts,src/api/**/*.ts,server/**/*.ts"
tags: [api, errors]
---

# API error contract

Use for HTTP/API handlers.

- Validate untrusted request data at the boundary before invoking domain or provider logic.
- Return an appropriate HTTP status and a stable machine-readable error code for expected failures.
- Error payloads may contain a short safe message but must not expose stack traces, SQL text, credentials, provider secrets, or raw upstream payloads.
- Map provider-specific failures to the application's public contract; do not leak provider implementation details into clients.
- Preserve correlation/request identifiers when available so logs can be joined to a client-reported failure.
- Retriable and non-retriable failures must be distinguishable by status/code or explicit metadata.

Tests should cover at least one validation failure and one downstream/provider failure for a new endpoint.
