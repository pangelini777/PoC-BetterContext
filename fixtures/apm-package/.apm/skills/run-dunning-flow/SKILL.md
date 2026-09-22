---
name: run-dunning-flow
description: >-
  Run the Acme Checkout failed-payment dunning sequence with spaced retries, clear customer emails, idempotent attempts, and cancellation on success.
---

# Dunning flow runner

Use when a subscription or invoice payment fails and the account enters the dunning sequence.

1. Trigger dunning only on terminal payment failures (`card_declined`, `insufficient_funds`) for invoice `inv_77031`; never start dunning on validation errors or pending 3DS challenges, and confirm the decline code came from the provider webhook before acting.
2. Space retries with a fixed schedule: day 1, day 3, day 7, and day 14, each creating a new payment attempt with a fresh idempotency key (`dun_inv_77031_try2`); never reuse a key across attempts.
3. Send one customer email per attempt using the Acme Checkout dunning template: state the amount (`USD 42.10`), the last-four, the next retry date, and a single update-payment link; keep tone factual, never threatening, and include the invoice id `inv_77031` so support can trace the thread.
4. Cancel the sequence immediately on any success signal: successful charge, customer-updated method, or manual invoice void; confirm cancellation with a `dunning_cancelled` event before stopping emails, and suppress any email already queued but unsent.
5. Cap the sequence at 4 attempts then suspend the subscription with reason `past_due`, preserving order history and data; never delete the subscription or its invoices on dunning expiry.
6. Guard every attempt with the same prechecks as the initial charge: subscription still active, invoice still open, amount unchanged since `inv_77031` was issued; abort and alert on mismatch, and never charge a superseded invoice after a plan change.
7. Handle provider webhooks during dunning idempotently: a late `payment_succeeded` for try 1 after try 2 started still cancels the sequence and refunds any duplicate capture.
8. Test with synthetic declined cards only: fail all 4 attempts, succeed on try 3, and cancel-mid-sequence cases; assert exactly one email per attempt and no charge after cancellation, and verify the suspension path fires only after the fourth failure.
9. Emit per-attempt metrics (attempt number, decline code, email sent) and alert when dunning recovery rate for merchant `merch_44012` drops 10 points week over week.
10. Log only invoice id, attempt number, and decline code; never log full card numbers, customer emails, or raw provider payloads.

Do not use this for initial checkout charges, refunds, or marketing win-back emails.
