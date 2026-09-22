---
description: "Refund and chargeback handling: eligibility, provider reconciliation, dispute evidence, and safe money-movement sequencing."
applyTo: "app/api/refunds/**/*.ts,app/api/orders/**/*.ts,payments/**/*.ts"
tags: [payments, refunds, chargeback]
---

# Refund and chargeback handling

Apply to any refund, reversal, or dispute flow in Acme Checkout. Money movement is critical: follow the payments card-data boundary too.

## Requirements

1. Compute refund eligibility server-side from order and payment state; never trust a client-supplied refund amount alone.
2. Reconcile every refund against the provider's charge status before marking it complete in the local order record.
3. Sequence money movement safely: validate, create the provider refund with an idempotency key, then update local state.
4. Require an explicit reason code (duplicate, fraudulent, requested_by_customer, defective) on every refund record.
5. Enforce authorization: only support staff with the refunds role or the original purchasing account may initiate a refund.
6. Cap partial-refund totals at the captured amount; reject over-refunds with 422 and code `refund_exceeds_capture`.
7. Record provider refund IDs on the order and surface them in support tooling for later dispute evidence.
8. Handle chargeback webhooks as authoritative provider events: quarantine the order, preserve evidence, and notify support.
9. Assemble dispute evidence from stored records (receipt, tracking, terms) without pulling raw card data into the packet.
10. Keep refunds and chargebacks in separate ledger states; a chargeback is not a refund and must not reuse refund transitions.
11. Notify the customer exactly once per refund state change through the notification queue, not inline.
12. Log refund attempts with order ID, amount, reason code, and provider ID; never log card numbers or security codes.
13. Cover each refund path with tests: full refund, partial refund, over-refund rejection, and duplicate-request replay.
14. Document refund windows (e.g. 30 days) and dispute SLAs next to the endpoint and in operator runbooks.
15. Require human confirmation for refunds above the configured threshold before the provider call executes.

## Anti-patterns

16. Do not mark an order refunded before the provider confirms; local-only refunds diverge from real money.
17. Do not net a chargeback by issuing a second refund for the same amount without checking provider state.
18. Do not accept refund webhooks without the same signature verification as other provider callbacks.
19. Do not expose full dispute packets or customer personal data in public API responses.
20. Do not retry provider refund calls without the original idempotency key; blind retries double-refund.
21. Do not allow customer-supplied reason text to reach the provider dispute packet unreviewed.
22. Do not close a chargeback locally while the provider dispute is still open.

## Synthetic example

23. Order `ord_demo_500` ($42.50 captured) requests a $10 partial refund with reason `defective` and key `idem-refund-007`. The server validates the $10 against the $42.50 capture, calls the provider once, stores provider refund `re_demo_300`, and queues one customer notice. A later chargeback webhook for the same order quarantines rather than double-refunding.
