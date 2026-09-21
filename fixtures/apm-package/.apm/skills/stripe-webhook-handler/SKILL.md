---
name: stripe-webhook-handler
description: >-
  Implement or fix a Stripe webhook endpoint with signature verification, raw-body handling, duplicate-event protection, and retry-safe side effects.
---

# Stripe webhook handler

Use when implementing or fixing a Stripe webhook endpoint.

1. Read the raw request body for signature verification before any parsing.
2. Verify the provider signature with the webhook secret; reject invalid signatures with 400.
3. Deduplicate by provider event id so duplicate deliveries never double-apply side effects.
4. Make fulfillment side effects retry-safe and idempotent.
5. Return 2xx only after durable handling; return 400/500 appropriately otherwise.
