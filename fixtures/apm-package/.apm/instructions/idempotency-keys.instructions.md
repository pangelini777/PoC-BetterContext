---
description: "Idempotency-key contract for order, charge, and refund creation: key handling, replay semantics, and duplicate prevention."
applyTo: "app/api/orders/**/*.ts,app/api/checkout/**/*.ts,payments/**/*.ts"
tags: [idempotency, reliability, payments]
---

# Idempotency keys

Apply to any endpoint that creates an order, charge, refund, or other non-idempotent side effect in Acme Checkout.

## Requirements

1. Accept a client-supplied `Idempotency-Key` header (UUID v4 recommended) on all create operations.
2. Scope each key to the endpoint plus the authenticated account; the same key from another account is a different record.
3. Persist the key before performing the side effect, so a retry during a crash still finds it.
4. On replay with the identical request body, return the original stored response with the same status code.
5. On replay with a different body under the same key, return 422 with code `idempotency_key_in_use`.
6. Retain keys and their responses for at least 24 hours; document the retention window next to the endpoint.
7. Generate a server-side key automatically when the client omits one, and return it in the response for later retries.
8. Include the key in structured logs (key hash, endpoint, account) to join retries to the original attempt.
9. Make key storage atomic with the created record (same transaction or conditional write), never best-effort.
10. Return a `Idempotent-Replayed: true` header on replays so clients can distinguish fresh creates from replays.
11. Validate key format (length, charset) at the boundary and reject empty or oversized keys with 400.
12. Cover each create endpoint with two tests: identical replay returns the same order, differing body returns 422.
13. Expire keys only after the retention window; never reuse an expired key slot for a different request silently.
14. Surface key conflicts in developer docs with a retry example clients can copy.

## Anti-patterns

15. Do not key idempotency on request timestamps, random nonces generated per attempt, or client IP alone.
16. Do not perform the charge first and record the key afterward; a crash between the two double-charges.
17. Do not return 200 with a new resource on every retry; that defeats the entire contract.
18. Do not share one key namespace across unrelated operations (orders vs refunds need separate scopes).
19. Do not log full request bodies alongside keys when they contain personal or payment data.
20. Do not accept keys longer than 128 characters or binary blobs; bound the storage cost per key.
21. Do not silently ignore a mismatched-body replay by returning the old record as if it matched.

## Synthetic example

22. A client creates order `ord_demo_500` with key `idem-demo-001` and the request times out. Retrying with the same key and body returns the original `ord_demo_500` with `Idempotent-Replayed: true`. Retrying with the same key but a different cart total returns 422 `idempotency_key_in_use`.
