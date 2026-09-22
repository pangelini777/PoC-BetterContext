---
name: paginate-results
description: >-
  Add cursor or offset pagination to an Acme Checkout list API with stable ordering, page-size bounds, total-count policy, and client-safe page tokens.
---

# Pagination helper

Use when adding or fixing paginated listing on orders, products, or audit endpoints.

1. Choose the pagination mode up front and document it in the Acme Checkout endpoint contract: cursor pagination for feeds that mutate during reads (order `ord_100421` history, event streams), offset pagination only for small static admin tables under 10k rows.
2. Define a stable sort key before paging anything: primary sort (for example `created_at DESC`) plus a unique tiebreaker (`id DESC`), and reject requests that omit the sort so pages never skip or duplicate rows when new records insert mid-read.
3. Bound page size explicitly: default 25, minimum 1, maximum 100; clamp out-of-range values and return the effective `limit` in the response so the client can reconcile instead of guessing.
4. Encode cursor tokens opaquely (for example `cur_eyJjcmVhdGVkX2F0IjoiMjAyNi0wOS0yMiIsImlkIjoib3JkXzEwMDQyMSJ9`): base64 JSON of sort-key values plus a version byte, never raw offsets or SQL fragments, and reject tampered or version-mismatched tokens with 400.
5. Return a consistent envelope on every page: `data[]`, `next_cursor` (null on the last page), `prev_cursor` where supported, effective `limit`, and the applied sort; keep field names identical across all list endpoints.
6. Set the total-count policy deliberately: omit `total` on high-cardinality feeds where `COUNT(*)` is expensive, and only include it for bounded admin lists with a documented staleness note; never run an unbounded count on the hot path.
7. Filter before paginating, never after: apply status, date-range, and tenant predicates (for example `status=shipped&since=2026-08-01`) inside the paged query so page sizes stay full and cursors stay valid across filter combinations.
8. Enforce tenant and authorization scoping inside the pagination query itself, so a forged cursor from one merchant account can never surface another merchant's rows when decoded and re-executed.
9. Handle empty and edge pages gracefully: return `data: []` with `next_cursor: null` past the end, treat an expired cursor as 400 with a `cursor_expired` code plus guidance to restart from the first page, and never return 500 for a well-formed but stale token.
10. Cap query cost with a statement timeout and a covering index on `(sort_key, id)`; log only endpoint, limit, and cursor version plus latency, never customer identifiers or full row payloads.

Do not use this for realtime event streaming, full-table exports, or search-relevance ranking.
