---
name: plan-migration-rollback
description: >-
  Plan an Acme Checkout database rollback with compatibility checks, forward-fix preference, staged reversal, and verification gates.
---

# Migration rollback planner

Use when a shipped Acme Checkout schema migration needs reversal or a forward fix.

1. Classify the migration first: additive changes (new nullable column on `orders`) roll back cleanly, backfills (for example `backfill_88231`) need row-count reconciliation, and destructive DDL (dropped column, tightened constraint) usually requires a forward fix instead of a raw rollback.
2. Prefer a forward fix when data has already flowed: if the new column for merchant `merch_44012` already holds production writes, ship a compatible follow-up migration rather than dropping the column and destroying those writes.
3. Check expand/contract compatibility before reversing: the application must run against both old and new schemas during the window, so roll back the application first to the version that tolerates the pre-migration schema, then reverse the DDL.
4. Stage the reversal in three gated steps: `1` stop writers and drain the queue (for example `migration_q`), `2` apply the down migration inside a bounded transaction with a lock timeout, `3` verify row counts and constraint state before reopening writers.
5. Reconcile backfilled rows explicitly: capture pre-rollback counts (for example `1_204_118` rows in `order_ledger`), and after reversal assert the count matches minus only the rows the down migration documents as removed; any unexplained delta blocks reopening.
6. Keep the down migration reviewable: it must be the exact inverse of the up migration, checked in beside it (for example `migrations/0882_add_ledger_seq_down.sql`), with a comment citing the deploy id and reason; never hand-edit production schema outside a migration file.
7. Define the abort condition up front: if the down migration exceeds its statement timeout or touches more rows than estimated, halt, keep the forward schema, and escalate to the on-call engineer instead of forcing the rollback through.
8. Log only migration ids, row counts, timings, and deploy ids; never log row contents, customer data, or database credentials.

Do not use this for application-code rollbacks, feature-flag reversals, or provider-side data fixes.
