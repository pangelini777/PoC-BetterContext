---
description: "Pagination contract for list endpoints: cursor semantics, limits, ordering stability, and total-count rules."
applyTo: "app/api/**/list/**/*.ts,app/api/orders/**/*.ts,app/api/catalog/**/*.ts,src/api/**/*.ts"
tags: [api, pagination, contract]
---

# Pagination contracts

Apply when adding or changing any list endpoint in Acme Checkout (orders, products, events, audit rows).

## Requirements

1. Use opaque cursor pagination as the default for user-visible and unbounded lists; offset is allowed only for small admin tables.
2. Return a stable envelope: `data`, `next_cursor` (null when done), and `has_more`; keep field names identical across endpoints.
3. Sort by a unique, immutable tiebreaker (e.g. `created_at` plus `id`) so inserts during paging never skip or duplicate rows.
4. Document the default sort order next to each endpoint; clients must be able to reproduce page order.
5. Cap `limit`/`page_size` server-side (default 20, maximum 100) and clamp out-of-range values instead of erroring.
6. Validate cursor format at the boundary; a malformed cursor returns 400 with code `invalid_cursor`, never 500.
7. Treat cursors as opaque: clients must not construct or parse them, and servers must tolerate re-encoded values safely.
8. Expire or version cursors when the underlying sort or filter semantics change; old cursors fail with a clear 400.
9. Apply the same authorization filter to every page; never leak rows the caller may not see on later pages.
10. Keep filter parameters stable across pages; changing filters mid-walk starts a new pagination session.
11. Include `total_count` only when it is cheap and exact; otherwise omit it rather than returning an estimate as fact.
12. Return an empty `data` array with `has_more: false` (not 404) when a page has no rows.
13. Log pagination abuse (limit=100 hammered in a loop) with route and key hash for rate-limit tuning.
14. Cover each list endpoint with a test that walks two pages and asserts no duplicates or gaps under concurrent inserts.
15. Document cursor lifetime and reuse rules in developer docs with a two-page walk example.

## Anti-patterns

16. Do not use OFFSET/LIMIT for unbounded customer-facing lists; deep offsets get slower and shift under writes.
17. Do not expose raw SQL offsets, row numbers, or internal sequence values as cursors.
18. Do not return a `next_cursor` that points past the end; the last page must carry an explicit terminal signal.
19. Do not change sort order between pages based on heuristics; one request, one order.
20. Do not echo unvalidated `limit` values into SQL; always coerce to integer and clamp.
21. Do not include personal data of other accounts in shared list caches keyed only by cursor.
22. Do not return 500 when a cursor references a deleted row; resume from the nearest live position or restart cleanly.

## Synthetic example

23. Listing orders for `acct_demo_042` with `limit=2` returns `data: [ord_demo_101, ord_demo_102]`, `next_cursor: "cur_demo_abc"`, `has_more: true`. Following the cursor returns `ord_demo_103` with `next_cursor: null`. A new order inserted mid-walk appears exactly once because the sort key is `(created_at, id)`.
24. A client sends `limit=5000`; the server clamps to 100 and returns 100 rows with the applied limit echoed in the envelope.
25. A client replays a cursor from before a sort change; the server returns 400 `invalid_cursor` with a message to restart the listing.
