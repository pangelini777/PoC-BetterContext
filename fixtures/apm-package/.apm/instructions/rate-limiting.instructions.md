---
description: "Rate-limiting rules for public and authenticated APIs: per-key quotas, fair-use tiers, headers, and safe 429 behavior."
applyTo: "app/api/**/*.ts,src/api/**/*.ts,server/middleware/**/*.ts,gateway/**/*.ts"
tags: [api, rate-limit, reliability]
---

# Rate limiting

Apply when adding, changing, or reviewing any network-exposed endpoint in Acme Checkout.

## Requirements

1. Enforce limits at the edge or gateway before expensive work such as database queries or provider calls.
2. Key limits by the most specific stable identity available: authenticated account ID first, then API key, then IP address.
3. Give authenticated traffic a higher quota than anonymous traffic on the same route.
4. Use a sliding or token-bucket algorithm; fixed windows alone are not sufficient for bursty checkout traffic.
5. Return HTTP 429 with a stable machine-readable code such as `rate_limited` for over-limit requests.
6. Include `Retry-After` (seconds) on every 429 response so clients can back off deterministically.
7. Emit standard quota headers on success: `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`.
8. Keep quota configuration in one reviewable place (config file or policy table), never hard-coded per handler.
9. Apply stricter limits to auth, password-reset, coupon-apply, and checkout-create routes than to read-only catalog routes.
10. Count retries and paginated follow-up requests against the same quota as the original call.
11. Fail open only for the health-check route; every other route fails closed when the limiter store is unavailable.
12. Log limiter rejections with route, key hash, and quota name; never log the raw API key or session token.
13. Distinguish per-route quotas from global abuse bans in both code and observability labels.
14. Document public quotas in the developer docs next to each endpoint, including burst and sustained rates.
15. Cover new limits with at least one test that exceeds the quota and asserts 429 plus `Retry-After`.

## Anti-patterns

16. Do not trust a client-supplied `X-Forwarded-For` value as the sole limit key without a trusted-proxy allowlist.
17. Do not return 500 or a generic 400 for over-limit traffic; clients cannot build backoff on ambiguous statuses.
18. Do not silently drop over-limit requests without a response body; always explain the limit and the retry time.
19. Do not share one global bucket across unrelated routes; a catalog crawler must not starve checkout creation.
20. Do not reset quotas from client input such as `?reset_quota=true`.
21. Do not exempt internal tooling by IP without an expiring allowlist entry and an audit log line.
22. Do not sleep-and-retry inside the request handler to "wait out" the limit; reject fast with 429.

## Synthetic example

23. Acme Checkout allows 60 checkout-create requests per minute per account with a burst of 10. A synthetic client `acct_demo_042` fires 75 requests in 40 seconds; requests 71-75 receive 429 with `Retry-After: 18` and code `rate_limited`, while catalog reads on a separate bucket keep succeeding.
