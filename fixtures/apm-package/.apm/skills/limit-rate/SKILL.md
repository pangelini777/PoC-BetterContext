---
name: limit-rate
description: >-
  Add a retry-safe rate limit to an Acme Checkout API with per-key buckets, burst headroom, fair rejection codes, and observable limit headers.
---

# Rate limiter

Use when adding or fixing throttling on a public or partner-facing Acme Checkout endpoint.

1. Pick the limit key deliberately for the abuse model: authenticated merchant id (for example `merch_44012`) for partner APIs, API key hash for service-to-service calls, IP `/24` plus endpoint for anonymous storefront reads; never key anonymous limits on a forgeable header alone.
2. Choose the algorithm to match burst behavior: token bucket (capacity plus refill rate) for checkout and webhook endpoints that legitimately burst, fixed window only for low-volume admin actions; document capacity, refill, and window on the endpoint contract.
3. Set explicit budgets with headroom: for example 120 requests/minute with burst 40 for product reads, 30/minute with burst 10 for order creation on merchant `merch_44012`; keep a 20% margin above measured p99 traffic so normal peaks never trip the limiter.
4. Enforce limits atomically in the shared store (Redis `INCR` plus `EXPIRE`, or Lua token-bucket script) so concurrent app instances share one counter; never enforce in per-process memory where each replica gets its own budget.
5. Reject over-limit requests with 429 plus a machine-readable `rate_limited` code, a `Retry-After` seconds header, and stable limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`); keep the error body identical across endpoints so clients can back off uniformly.
6. Fail open or closed by endpoint risk: fail open (allow with a metric) on catalog reads when the counter store is down, fail closed (reject with 503 plus `limiter_unavailable`) on order creation and refund paths where unbounded writes risk oversell or double-charge.
7. Exempt safely and narrowly: health checks and the limiter's own status probe bypass by path, partner bulk-export jobs bypass by explicit key allowlist entry `allowlist_export_07` with expiry; never exempt by `User-Agent` or a client-supplied flag.
8. Emit per-decision metrics with key hash, endpoint, and outcome (`allowed`, `rejected`, `degraded`) so dashboards can separate legitimate growth from abuse spikes, and alert when rejection rate exceeds 5% for 10 minutes.
9. Test the limiter with a synthetic burst harness: sequential allowance up to capacity, rejection of request N+1, refill after the window, and multi-replica atomicity under 50 concurrent callers; assert `Retry-After` parses and remaining counts decrease monotonically.
10. Log only key hashes, endpoint, limit, and outcome; never log API secrets, customer emails, or full request bodies alongside throttle decisions.

Do not use this for concurrency locks, inventory holds, or payment-fraud scoring.
