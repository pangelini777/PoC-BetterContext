---
description: "Caching policy for catalog, pricing, and session-adjacent reads: TTLs, invalidation, and stale-data boundaries."
applyTo: "app/api/catalog/**/*.ts,src/cache/**/*.ts,server/cache/**/*.ts,lib/cache/**/*.ts"
tags: [caching, performance, reliability]
---

# Caching policy

Apply when adding or changing any cache layer in Acme Checkout (catalog reads, price lookups, session-adjacent data).

## Requirements

1. Assign every cached entry an explicit TTL; eternal entries are prohibited except for immutable content hashes.
2. Prefer short TTLs (30-300 seconds) for price and inventory reads; longer TTLs (hours) only for static catalog copy.
3. Key cache entries on all inputs that change the output: product ID, currency, locale, and account tier at minimum.
4. Invalidate on write: any mutation to a product, price, or coupon must evict or version-bump the affected keys.
5. Use versioned or hashed keys for deploys so a rollout never serves a mix of old-code and new-code shapes.
6. Serve stale-while-revalidate only for read-only catalog surfaces, never for price totals or checkout state.
7. Cap entry size and total cache memory; evict least-recently-used entries under pressure.
8. Serialize cached values with a schema version field so readers can reject entries written by older code.
9. Record cache hit/miss ratios per namespace in observability; alert on sudden miss storms after deploys.
10. Namespace keys by environment (dev, staging, prod) so test fixtures can never poison production reads.
11. Treat user-specific data (carts, tokens, addresses) as non-cacheable in shared caches unless the key includes the account ID.
12. Document each namespace next to its code: what is cached, TTL, invalidation trigger, and staleness tolerance.
13. Cover invalidation with at least one test: mutate, then assert the next read reflects the write.
14. Set negative caching (not-found markers) with a very short TTL to absorb catalog-scan bursts.

## Anti-patterns

15. Do not cache checkout totals, payment authorizations, or order-write results for reuse across requests.
16. Do not build cache keys by string-concatenating unsanitized user input; normalize and hash variable parts.
17. Do not swallow deserialization failures and return partial objects; treat corrupt entries as misses and re-fetch.
18. Do not share one namespace for unrelated domains; catalog entries and session fragments must not collide.
19. Do not rely on wall-clock expiry alone for inventory counts; revalidate against stock before promising fulfillment.
20. Do not log full cached payloads at info level; log key, namespace, and hit/miss only.
21. Do not bypass the cache-write path in background jobs while web handlers use it; all writers share one helper.
22. Do not return stale pricing with a 200 and no signal; include an `Age` or `X-Cache` header on cached responses.

## Synthetic example

23. Acme Checkout caches product `prod_demo_101` card data for 120 seconds keyed on `prod_demo_101:USD:en`. An operator edits the price from $19 to $24; the write path evicts the key, the next read misses and fetches $24, and the `X-Cache: MISS` header confirms the refresh.
24. A load test hammers a discontinued SKU `prod_demo_404`; the negative-cache marker (TTL 15 seconds) absorbs the burst without touching the database on every request.
25. After a deploy bumps the card schema from v3 to v4, readers reject v3 entries by schema version and re-fetch instead of rendering broken cards.
