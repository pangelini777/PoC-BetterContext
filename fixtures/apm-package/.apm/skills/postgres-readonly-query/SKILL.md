---
name: postgres-readonly-query
description: >-
  Investigate PostgreSQL data or query behavior without changing schema: write safe read-only SQL and summarize findings.
---

# PostgreSQL read-only query

Use only for read-only data investigation. Never change schema or data.

1. Use SELECT-only statements; no DDL, no INSERT/UPDATE/DELETE.
2. Bound every query with LIMIT and a time predicate where applicable.
3. Avoid SELECT * on wide tables; project only needed columns.
4. Summarize findings with row counts and example values, redacting personal data.
5. If the investigation reveals a needed schema change, stop and hand off.

Do not use this for migrations or backfills.
