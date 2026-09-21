---
description: "Safety rules for schema migrations, destructive DDL, backfills, compatibility, rollback, and deploy ordering."
applyTo: "db/**/*.sql,migrations/**/*.sql,src/db/**/*.ts"
tags: [database, migration, safety]
---

# Database migration safety

Apply when schema or migration files are changed.

- Prefer additive, backward-compatible changes that can coexist with the previous application version during rollout.
- Adding a required column to populated data requires a staged plan: nullable/default or backfill first, then enforcement after data is compatible.
- Destructive operations such as dropping columns/tables or rewriting large tables require an explicit migration note and must not be hidden inside unrelated changes.
- Migrations must be deterministic and safe to run once in the expected deployment system.
- Backfills must be bounded or batchable for large datasets.
- Include a verification query or test that proves existing rows remain readable and new writes use the intended schema.

Do not infer that a schema change is safe merely because local tests pass.
