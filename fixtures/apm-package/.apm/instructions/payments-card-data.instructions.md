---
description: "Payment integration boundary: keep raw card data out of the application and use provider-hosted/tokenized payment flows."
applyTo: "app/api/checkout/**/*.ts,app/api/stripe/**/*.ts,payments/**/*.ts"
tags: [payments, security]
---

# Payment and card-data boundary

Apply to payment and checkout implementation.

- The application must never receive, persist, log, or test with raw card numbers or card security codes.
- Prefer provider-hosted checkout or tokenized provider elements so sensitive card entry stays on the payment provider boundary.
- Price and currency used to create a payment must come from trusted server-side product/order data, not directly from client-supplied totals.
- Treat provider object IDs as sensitive operational identifiers; log only what is necessary for support and never log provider secrets or complete provider payloads.
- Do not mark an order paid solely because a browser returned from checkout; use a trusted provider confirmation/webhook or verified server-side status.
- Idempotency is required for operations that can create duplicate charges or duplicate orders.
