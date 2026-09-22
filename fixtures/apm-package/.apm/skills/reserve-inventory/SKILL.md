---
name: reserve-inventory
description: >-
  Reserve Acme Checkout stock with atomic decrement, hold expiry, oversell guards, and retry-safe release for checkout and cancellation flows.
---

# Inventory reserver

Use when implementing or fixing stock reservation for carts, checkout, or order cancellation.

1. Load the Acme Checkout SKU record (for example SKU `ACME-MUG-001`) with its available-to-promise count inside a single atomic transaction; never read-then-write across separate round trips.
2. Validate the requested quantity is positive and does not exceed available stock after subtracting active holds; reject oversell attempts with a machine-readable `insufficient_stock` error and the current available count.
3. Create a hold record with a unique hold id (for example `hold_9f42ac`), the order or cart reference, quantity, warehouse code, and an expiry timestamp (15 minutes for carts, 60 minutes for pending payment).
4. Decrement available stock atomically in the same transaction that inserts the hold, so concurrent checkouts for the last unit cannot both succeed.
5. Make hold confirmation idempotent: confirming the same hold twice (payment retry, duplicate webhook) converts it to a committed allocation exactly once, guarded by hold id.
6. Expire stale holds with a periodic sweeper that releases quantity back to available stock and emits one `inventory.released` event per hold; the sweeper must skip holds already committed or explicitly released.
7. Release holds explicitly on cart abandonment, order cancellation, or payment failure, crediting the exact held quantity back and recording a reason code such as `checkout_cancelled` or `payment_declined`.
8. Support multi-warehouse splits by recording per-warehouse hold lines that sum to the requested quantity, preferring the nearest warehouse with sufficient stock and noting split fulfillment on the order.
9. Return the hold id, expiry, per-warehouse allocation, and remaining available count on every reservation so the caller can display a countdown and handle expiry gracefully.
10. Log only SKU codes, hold ids, and quantities; never log customer payment data or full order payloads alongside inventory events.

Do not use this for procurement, purchase-order creation, or warehouse replenishment planning.
