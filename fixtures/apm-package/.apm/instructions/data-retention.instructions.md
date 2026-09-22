---
description: "Data-retention rules for Acme Checkout: documented retention schedules, bounded purge jobs, no orphan copies, and reviewable deletion evidence."
applyTo: "db/**/*.sql,migrations/**/*.ts,src/db/**/*.ts,retention/**/*.ts"
tags: [retention, privacy, database]
---

# Data retention

Apply when persisting new data, adding auxiliary copies (caches, exports, derived tables), or implementing cleanup and purge behavior.

- Give every persisted dataset a documented retention period and a deletion path before it ships: what is kept, for how long, and which job or request removes it afterwards.
- Drive retention windows from configuration or a schedule table, not from hard-coded constants scattered through jobs; a reviewer must be able to find every active window in one place.
- Implement purges as bounded, resumable batch jobs (delete in limited batches with progress tracking), never as unbounded single statements that lock production tables or time out halfway.
- Eliminate orphan copies: when the primary record expires, derived copies in caches, search indexes, export files, and analytics staging for the same subject (for example Acme Checkout customer `cust_test_2207`) must expire through the same job or a linked follow-up — not linger indefinitely.
- Distinguish soft-delete from hard-delete explicitly: a `deleted_at` flag hides rows from the application but does not satisfy retention expiry; the purge job must still remove or anonymize the underlying data on schedule.
- Honor legal holds explicitly: when litigation or a tax obligation suspends deletion for specific records, the hold must be a recorded, expirable exception — never an excuse to disable the purge job wholesale.
- Produce reviewable evidence: each purge run records its scope, row counts, timestamp, and outcome where operators can inspect it, so compliance review never depends on trusting that "the cron ran."
- Keep retention changes migration-safe: shortening a retention window or adding a purge to a large table requires a staged rollout with batch limits and rollback notes, not a surprise destructive migration.
- Cover retention with synthetic data only: tests seed fixture rows older and newer than the boundary, run the purge, and assert the old rows are gone while the new rows and unrelated tenants are untouched.

Do not assume data disappears because the UI no longer shows it; hidden rows, caches, and exports are still retained data until the purge removes them.
