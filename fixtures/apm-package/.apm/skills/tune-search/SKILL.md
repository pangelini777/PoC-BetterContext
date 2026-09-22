---
name: tune-search
description: >-
  Tune Acme Checkout catalog search relevance with query analysis, synonym rules, ranking weights, and measured precision/recall checks.
---

# Search tuner

Use when improving product search relevance for the Acme Checkout catalog.

1. Capture the failing Acme Checkout query first (for example `stainless steel travel mug`) with its current top-10 result ids, click-through rate, and zero-result rate before changing any ranking inputs.
2. Analyze query intent: split brand, product type, attribute, and size tokens, and log which tokens matched versus which were dropped by the analyzer chain.
3. Fix analyzer gaps before touching weights: add ASCII folding, lowercase, and edge n-grams for prefix queries, and verify with the `_analyze` API that `Mug` and `mug` produce identical tokens.
4. Add synonym rules narrowly (for example `mug => cup, tumbler`) in a versioned synonym set `syn_v14`, scoped to the catalog index; never add global synonyms that bleed into help-center or order search.
5. Set field boosts explicitly: product name `^3`, brand `^2`, category `^1.5`, description `^1`, and SKU exact-match as a separate filter clause so SKU `ACME-MUG-001` always ranks first on exact query.
6. Handle zero-result and low-recall queries with a fallback chain: exact match, then synonym-expanded match, then fuzziness `AUTO`, then category backfill; record which fallback served each query for later review.
7. Gate every tuning change behind an A/B or interleaving check: compare precision@5 and add-to-cart rate on a pinned 200-query eval set (for example eval `search-eval-2026-09`) before promoting the new rank profile.
8. Version the rank profile (for example `rank_v22`) with its analyzer, synonym set, and boost map, and keep the previous profile live for instant rollback when relevance regresses.
9. Exclude out-of-stock and discontinued SKUs from default ranking unless the query is an exact SKU match, and annotate remaining results with availability so relevance and inventory stay consistent.
10. Log only query text hashes, result ids, and rank scores; never log customer identifiers or full session histories alongside search telemetry.

Do not use this for order-history lookup, admin full-text search, or recommendation-model training.
