---
name: erase-personal-data
description: >-
  Execute an Acme Checkout GDPR erasure request with identity verification, scoped deletion across stores, retention-safe exceptions, and completion evidence.
---

# GDPR eraser

Use when implementing or handling a data-deletion (right-to-erasure) request for a customer account.

1. Verify the requester before touching data: confirm account ownership via the Acme Checkout login session plus a one-time code to `o***@example.com`; reject unverified or third-party requests with 403 and log the attempt.
2. Inventory the personal-data footprint first: profile row, order history for customer `cust_88312`, notification logs, support tickets, and analytics aliases; produce the store list and have the requester confirm scope before deletion starts.
3. Apply retention-safe exceptions explicitly: keep anonymized order-ledger rows the tax authority requires (7-year retention `ret_tax_ledger`), and delete or anonymize everything else; document each exception with its legal basis on the erasure ticket.
4. Delete in dependency order inside bounded transactions: notification preferences, push tokens, and sessions first, then profile PII, then order-linked personal fields replaced with `deleted_subject_88312` placeholders so foreign keys and ledger integrity survive.
5. Propagate to downstream stores with one job per store (search index, warehouse system, email provider suppression list `sup_88312`); each job is idempotent by subject id so retries never double-delete or error on already-removed rows.
6. Confirm completion with evidence: re-query every inventoried store for the subject id and assert zero personal-data hits, then issue a signed completion receipt with ticket id, scope, exceptions, and per-store confirmation counts.
7. Notify connected processors (payment provider, shipper) of the erasure via their deletion APIs where contracts require it, and record each processor acknowledgement or its absence on the ticket.
8. Enforce the 30-day SLA with a due-date timer: escalate to the privacy owner at day 20, complete by day 28, and emit one `privacy.erasure_completed` event carrying only the ticket id and completion date.
9. Log only ticket ids, subject hashes, and store counts; never log the subject's name, email, address, or deleted payload contents in application logs.

Do not use this for account suspension, fraud holds, or marketing-unsubscribe handling alone.
