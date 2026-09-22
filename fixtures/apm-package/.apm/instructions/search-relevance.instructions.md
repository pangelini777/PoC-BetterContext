---
description: "Search relevance rules for catalog search: query handling, ranking signals, typo tolerance, and empty-result behavior."
applyTo: "app/api/search/**/*.ts,src/search/**/*.ts,catalog/search/**/*.ts"
tags: [search, relevance, catalog]
---

# Search relevance

Apply when adding or changing catalog search in Acme Checkout (query parsing, ranking, facets, suggestions).

## Requirements

1. Normalize queries before matching: lowercase, trim, collapse whitespace, and strip control characters.
2. Rank exact title matches above partial and description matches for the same query terms.
3. Weight in-stock, purchasable products above discontinued or out-of-stock ones for generic queries.
4. Support typo tolerance of at least one edit for queries of five or more characters.
5. Treat facet filters (category, price band, brand) as hard constraints applied before ranking, not after.
6. Return a stable result envelope: `results`, `total`, `query`, and `applied_filters` echoed back.
7. Cap page size for search like other list endpoints (default 20, maximum 100) and clamp invalid values.
8. Log queries with result counts and latency (query hash, locale, filters) to tune relevance without storing raw personal data.
9. Provide a `did_you_mean` suggestion when the corrected query would return materially more results.
10. Handle empty-result sets with a 200, an empty list, and at most one suggestion; never 404 for zero hits.
11. Keep ranking weights in one reviewable config so relevance tuning does not require code edits.
12. Localize stemming and stop-words per supported locale; English rules must not apply to all languages.
13. Guard expensive queries (very long strings, all-wildcard) with length caps and timeouts that degrade to a safe empty set.
14. Cover ranking with tests: exact match first, typo match found, facet filter respected, empty query handled.
15. Document query syntax (quotes, minus, filters) in developer docs with two copy-paste examples.

## Anti-patterns

16. Do not execute raw user input as a queryDSL or regex without parsing and escaping; ReDoS and injection live here.
17. Do not boost sponsored or promoted items silently; any paid placement must be labeled in the response.
18. Do not return out-of-stock items as purchasable; mark availability explicitly on every result.
19. Do not log full raw queries containing email addresses or personal identifiers at info level.
20. Do not change result ordering nondeterministically between identical requests without a documented reason.
21. Do not expose internal scores, shard IDs, or index names in public responses.
22. Do not autocomplete queries by firing unthrottled index requests per keystroke without debounce and caching.

## Synthetic example

23. A shopper types `blu toaster` in locale `en`; normalization plus one-edit tolerance matches `Blue Toaster prod_demo_201`, which ranks above a description-only match `Retro Kettle prod_demo_202`. Facet `category=appliances` is echoed in `applied_filters`, and a zero-hit query `zxqv` returns 200 with `results: []` plus `did_you_mean: null`.
