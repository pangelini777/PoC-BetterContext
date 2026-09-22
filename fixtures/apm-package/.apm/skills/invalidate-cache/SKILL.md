---
name: invalidate-cache
description: >-
  Invalidate Acme Checkout caches safely with scoped keys, version bumps, stampede guards, and observable purge confirmation.
---

# Cache invalidator

Use when adding or fixing cache invalidation for catalog, pricing, or session reads.

1. Name the invalidation scope before purging: single key (SKU `ACME-MUG-001` price), key prefix (`catalog:category:drinkware:*`), or full version bump (`price_table_v18`); never default to a global flush when a scoped purge suffices.
2. Version cacheable payloads explicitly: embed the rate-table, template, or rank-profile version in the key (for example `price:ACME-MUG-001:v18`) so a deploy or rate change retires stale entries without a purge race.
3. Invalidate write-through on mutation: update the Acme Checkout source of truth first, then delete affected keys in the same request path; queue a deferred re-delete when the first purge fails so a crashed writer cannot leave stale reads behind.
4. Guard repopulation against stampedes: use single-flight or a short `refreshing` lock with a stale-while-revalidate window (serve stale up to 60s while one worker refreshes) so a popular-key expiry never fans out to 500 database queries.
5. Confirm the purge observably: read back one representative key per scope after invalidation and assert a miss or the new version; surface the confirmation count (`purged 42 keys, confirmed 3 probes`) in the operation result.
6. Set TTLs by volatility: 30s for cart and inventory availability, 5 minutes for product detail, 1 hour for category listings and static copy; document the TTL next to each key pattern so future editors preserve the intent.
7. Isolate tenants in keys: prefix every key with merchant or storefront id (for example `merch_44012:price:ACME-MUG-001:v18`) so a purge for one merchant can never evict or leak another merchant's entries.
8. Emit `cache.invalidated` with scope, key count, trigger (deploy, price change, manual), and probe outcome; alert when purge latency exceeds 5s or confirmation probes keep hitting stale versions.
9. Log only key patterns, versions, and counts; never log customer identifiers, session tokens, or full cached payloads alongside invalidation events.

Do not use this for database migration rollbacks, queue draining, or CDN certificate rotation.
