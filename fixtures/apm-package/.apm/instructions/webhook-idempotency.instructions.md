---
description: "Webhook verification, replay resistance, idempotent processing, ordering assumptions, and retry-safe side effects."
applyTo: "app/api/**/webhook/**/*.ts,webhooks/**/*.ts"
tags: [webhook, reliability, security]
---

# Webhook idempotency and verification

Apply when implementing or modifying inbound webhooks.

- Verify provider authenticity/signature against the raw request representation required by the provider before processing the event.
- Treat delivery as at-least-once: the same event may be delivered multiple times. Persist or otherwise enforce an idempotency key before non-idempotent side effects.
- A retry after partial failure must not duplicate orders, emails, credits, or charges.
- Do not assume events arrive in order; fetch authoritative state when ordering matters.
- Return success only after the system has durably recorded enough state to avoid losing the event.
- Never log the webhook secret or full raw payload when it contains personal/payment data.

Tests must include duplicate delivery and invalid-signature cases.
