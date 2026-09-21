---
name: postgres-schema-migration
description: >-
  Design and implement a PostgreSQL schema migration or backfill with compatibility, rollout, rollback/forward-fix, and verification.
---

# PostgreSQL schema migration

Use only when schema/data shape changes.

1. Inspect current schema and migration conventions.
2. Decide whether the change can be additive. For populated tables, stage required fields rather than adding an unsafe NOT NULL column in one step.
3. Write deterministic migration SQL.
4. If a backfill is needed, make it bounded/batchable.
5. State deploy ordering and rollback/forward-fix implications.
6. Verify with a query or test that old rows remain readable and new writes work.

Do not use this for read-only SQL investigation.
