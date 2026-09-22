---
description: "Order state-machine rules for Acme Checkout: explicit transitions, terminal states, single-fire side effects, and concurrency-safe status writes."
applyTo: "app/api/orders/**/*.ts,app/api/checkout/**/*.ts,orders/**/*.ts"
tags: [orders, state-machine]
---

# Order state machine

Apply when order status fields, fulfillment transitions, cancellation, refund, or shipment code is created or changed.

- Define the full transition map in one place (for example `created -> paid -> fulfilled`, `created -> cancelled`, `paid -> refunded`); every status write must name the transition it performs, and any transition not in the map must be rejected with an explicit error.
- Never skip states: code must not move an order from `created` directly to `fulfilled`, and must not mark an order `paid` on browser redirect alone — only on trusted payment confirmation.
- Treat terminal states (`fulfilled`, `cancelled`, `refunded`) as final: once reached, further transitions out of them are forbidden, and any attempt must fail loudly rather than silently rewriting history.
- Guard concurrent transitions with a conditional write on the expected current state (compare-and-swap or row-version check); a stale worker holding yesterday's state must lose, not overwrite the newer one.
- Fire each transition side effect exactly once (charge capture, shipment request, refund call, customer email): gate side effects on the state change itself inside the same transaction or idempotency boundary, so retried webhooks cannot double-ship order `ord_test_1001`.
- Make the transition handler itself idempotent: receiving the same trusted event twice (for example a duplicate payment confirmation for `evt_test_8801`) must converge on the same state with one set of side effects, not error or duplicate work.
- Record every transition with actor, timestamp, previous state, and new state so the order history reads as an append-only narrative of what happened and why.
- Keep destructive schema changes to the order table compatible with in-flight orders: adding a status value or column follows the staged rollout discipline, and unrelated changes must not smuggle in status rewrites.
- Cover transitions with focused tests using synthetic orders only: a happy-path chain, a skipped-state rejection, a terminal-state escape rejection, a concurrent-write conflict, a duplicate-event idempotency case, and a retried-webhook single-effect case.

Do not infer that an order reached a state because a downstream system acted; the state machine is the authority, and downstream systems react to it.
