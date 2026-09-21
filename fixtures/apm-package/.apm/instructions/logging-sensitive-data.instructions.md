---
description: "Logging rules preventing secrets, tokens, personal data, payment payloads, and oversized provider responses from entering logs."
applyTo: "**/*.{ts,tsx,js,jsx}"
tags: [logging, privacy, security]
---

# Sensitive-data logging

Apply to code that handles authentication, payments, personal data, webhooks, or external provider responses.

- Never log passwords, API keys, authorization headers, session cookies, OAuth tokens, webhook secrets, raw card data, or complete payment-provider objects.
- Avoid logging personal-data fields. Prefer internal record IDs and a small allow-listed diagnostic shape.
- Error logging should include operation name, safe error category/code, correlation identifier, and enough context to troubleshoot without dumping request/response bodies.
- Redact before serialization; do not rely on log viewers to hide sensitive fields.
- Avoid debug statements that can accidentally ship enabled.

Tests for redaction should assert forbidden sample values are absent from captured logs.
