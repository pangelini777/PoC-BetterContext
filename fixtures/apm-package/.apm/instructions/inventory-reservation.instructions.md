---
description: "Inventory reservation rules for Acme Checkout: hold-before-charge, expiring holds, oversell prevention, idempotent release, and reconciliation."
applyTo: "app/api/checkout/**/*.ts,app/api/orders/**/*.ts,inventory/**/*.ts,orders/**/*.ts"
tags: [inventory, orders]
---

# Inventory reservation

Apply when checkout or order code reserves, releases, commits, or reconciles stock for sellable items.

- Reserve stock before requesting payment authorization, and tie every reservation to a stable idempotency key (for example the Acme Checkout cart id `cart_test_5501`) so retries of the same checkout never create duplicate holds.
- Give every hold an explicit expiry timestamp; an unconfirmed hold must return its quantity to available stock automatically when the lease lapses, without manual intervention.
- Decrement available stock atomically at reservation time (single conditional write or transaction); never implement reserve as a read-then-write pair that two concurrent checkouts can interleave into an oversell.
- Release is idempotent: releasing an already-released or already-committed reservation must succeed quietly without adjusting stock a second time, and must be safe under webhook retries.
- Commit (convert hold to sold) exactly once, only on trusted payment confirmation — never on browser redirect, page view, or optimistic client state.
- Handle partial outcomes explicitly: when an order with several lines can only be partially fulfilled, the code must define which lines hold, which wait, and what the shopper is told; silent partial shipment is not acceptable.
- Never invent backorder or waitlist behavior implicitly: if oversubscribed demand is allowed to queue, that path must be an explicit, reviewed state with its own expiry and cancellation rules, not a negative stock number.
- Reconcile periodically: a bounded background check must detect orphaned holds (reserved but neither committed nor expired) and either expire or alert on them, so crashed checkouts cannot leak stock forever.
- Expose reservation outcomes to support tooling with identifiers only (SKU, reservation id, order id, timestamps); stock diagnostics must never include shopper personal data or payment details.
- Cover the lifecycle with synthetic SKUs only (for example `SKU-ACME-WIDGET-001` with fixture stock of 5): successful reserve-commit, expiry release, concurrent-reserve oversell attempt, double-release idempotency, orphan-hold reconciliation, and partial-fulfillment handling.

Do not treat available stock as a display hint; it is the guard that prevents selling what Acme Checkout does not have.
