---
name: warm-cache
description: >-
  Warm Acme Checkout read caches after a deploy or cold start with a bounded key list, concurrency cap, and hit-rate verification.
---

# Cache warmer

Use after deploys, failovers, or cache flushes that leave catalog and pricing reads cold.

1. Build the warm list from observed traffic, not guesses: top 5k product keys and top 500 merchant pricing keys (for example merchant `merch_44012`) from the last 7 days of access logs; refresh the list weekly so retired products stop consuming warm budget.
2. Bound the run: cap total keys, set a per-key timeout of 2s, and limit concurrency to 20 so warming never saturates the database or the provider pricing API; jitter start times across keys to avoid a thundering-herd spike at run start.
3. Warm in priority order: checkout-critical pricing first, then product detail, then search facets; stop early if p99 origin latency recovers to baseline.
4. Read through the normal code path (same `getPricing(key)` function the request path uses) so TTLs, serialization, and negative-cache entries match production behavior; a warmer that bypasses the code path warms bytes the request path never reads.
5. Skip personal or session keys: warm only shared catalog and merchant-config entries; never warm per-customer carts, tokens, or order `ord_88021` payloads.
6. Make warming idempotent and resumable: checkpoint every 500 keys, skip keys already fresh (TTL > 50% remaining), and allow safe re-runs after interruption; a second run over a completed list must issue zero origin fetches.
7. Verify with hit-rate metrics: compare cache hit ratio and origin p99 before and after the run; a successful warm lifts hit ratio above 90% on the warmed keyspace.
8. Alert on warm misses: keys that fail to populate go to a `warm_misses.log` with key hash and error class, and feed a follow-up ticket if miss rate exceeds 2%; repeated misses for the same key indicate an origin problem, not a cache problem.
9. Schedule warming as a post-deploy hook with a kill switch (`warmer_enabled=false` stops new batches within 30s); never run ad-hoc warmers against production without the switch.
10. Log only key hashes, hit/miss counts, and latency aggregates; never log customer emails, prices tied to identifiable accounts, or full response bodies, and retain the warm report for one week for post-deploy review.

Do not use this for cache invalidation, TTL policy design, or write-path consistency fixes.
