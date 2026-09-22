---
name: process-refund
description: >-
  Process an Acme Checkout refund with idempotent charge reversal, reason codes, partial-refund math, and retry-safe ledger updates.
---

# Refund processor

Use when implementing or fixing an order refund against a payment provider charge.

1. Load the original Acme Checkout order (for example order `ord_100421`) and its provider charge id from the order record; never accept a charge id from the client alone, since a forged id could reverse another customer's payment.
2. Validate refund eligibility before touching the provider: order status is paid, the order is not already fully refunded, and the requested amount is positive and within the remaining refundable balance; reject anything else with a machine-readable `refund_ineligible` code and the current refundable balance.
3. Compute partial-refund math in integer minor units (cents) only; split line-item, tax, and shipping portions explicitly on the refund record so the ledger reconciles against the original charge without floating-point drift.
4. Require an idempotency key per refund attempt (for example `refund_ord_100421_01`) and deduplicate by refund record id before calling the provider, so a retried request or duplicate webhook never issues two reversals for one intent.
5. Call the provider refund API with the idempotency key, then persist the provider refund id alongside a reason code such as `duplicate_charge` or `item_out_of_stock`; treat a provider timeout as unknown outcome and reconcile by lookup rather than blind retry.
6. Make ledger side effects retry-safe: credit the customer balance exactly once, emit one `refund.issued` event keyed by refund id, and guard every consumer (email, analytics, loyalty reversal) with the same id so re-delivery collapses safely.
7. Reconcile asynchronously via the provider refund webhook: match by provider refund id, advance the local status from `pending` to `succeeded` or `failed`, and alert support when a refund stays `pending` past 24 hours instead of leaving it stuck silently.
8. Return the refund status (`pending`, `succeeded`, `failed`) with the remaining refundable balance on every call; surface provider errors as safe retryable (`provider_timeout`) or final (`charge_already_refunded`) failures the client can act on.
9. Produce support evidence on demand: refund id, reason code, amount breakdown, provider reference, and status timeline for order `ord_100421`, so an agent can answer "where is my refund" without querying the provider dashboard directly.
10. Log only order and refund ids plus amounts; never log card numbers, tokens, or full provider payloads.

Do not use this for chargebacks, payouts, or gift-card issuance.
