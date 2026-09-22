---
name: inspect-order-state
description: >-
  Inspect an Acme Checkout order lifecycle with transition history, side-effect audit, stuck-state diagnosis, and safe read-only queries.
---

# Order state inspector

Use when debugging a stuck, disputed, or unexpectedly transitioned Acme Checkout order.

1. Load the order by id (for example `ord_77120`) with a read-only query; never mutate status during inspection, and include the full transition log ordered by `(occurred_at, id)` with actor, from-state, to-state, and trigger.
2. Reconstruct the legal path: compare the observed transitions against the order state machine (`pending -> authorized -> captured -> fulfilled`, with `cancelled` and `refunded` as terminal branches); flag any jump that skips a required state.
3. Audit single-fire side effects per transition: exactly one `payment.capture` for `authorized -> captured`, one `warehouse.release` for `captured -> fulfilled`, one customer email per terminal state; list duplicates or missing effects with event ids.
4. Check concurrency evidence: look for overlapping writes within the same second, competing worker ids, or a missing row-level lock on the status update; report whether the final state came from last-write-wins instead of a guarded transition.
5. Diagnose stuck states with bounded checks: an order in `authorized` longer than 30 minutes needs capture or void guidance, an order in `captured` longer than 24 hours needs fulfillment or refund guidance; cite the age and the owning queue (for example `fulfillment_q`).
6. Verify linked records without exposing PII: confirm payment intent id (for example `pi_99120`), shipment id (for example `shp_55210`), and refund ids exist and agree on amount and currency; mask customer emails as `o***@example.com` in output.
7. Produce a one-page finding: current state, transition table, violated invariant (if any), owning service, and the single recommended next transition with its guard condition.
8. Log only order id, state names, and transition counts; never log full customer records, payment payloads, or token values in inspection output.

Do not use this to change order status, issue refunds, or replay webhooks.
