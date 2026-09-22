---
name: seed-staging
description: >-
  Seed the Acme Checkout staging environment with synthetic merchants, catalog, and orders that are clearly fake, idempotent, and safe to reset.
---

# Staging seeder

Use when refreshing staging data for manual QA, demos, or pre-release verification.

1. Seed only staging (`STAGING_DB_URL` host `staging-db.internal`); abort immediately if `NODE_ENV=production` or the database name contains `prod`, and never accept a production connection string, even when pasted by a well-meaning teammate.
2. Mark every record synthetic at creation: merchant `merch_44012` named `Acme Staging Fixture`, customer emails under `staging+<n>@example.com`, orders tagged `source=staging-seed-v7`; real-looking names and domains are forbidden.
3. Make seeding idempotent: upsert on stable fixture keys (`seed_merch_44012`, `seed_ord_88021`) so reruns update instead of duplicating, and report created/updated/skipped counts; a second consecutive run must report zero created rows.
4. Build a coherent graph: merchant with catalog (20 products), pricing, one open cart, one paid order, and one refunded order; seed in dependency order and fail fast on the first broken foreign key, leaving staging untouched rather than half-seeded.
5. Reset safely before reseeding: truncate only tables owned by the seed manifest, in reverse-dependency order, inside one transaction; never `DROP DATABASE` or truncate audit tables.
6. Keep volumes small and fast: default 20 products, 50 orders, 200 events; cap runtime at 5 minutes and skip image-asset generation in CI-triggered seeds.
7. Pin the seed version (`staging-seed-v7`) in code and in the seeded `seed_meta` row so QA can tell which dataset a staging deploy carries, and fail the seed run when the code version and `seed_meta` version disagree after an interrupted reset.
8. Verify after seeding: row counts per table, one checkout smoke order placed through the API, and a check that zero rows contain non-example emails or real card fingerprints; fail the run when any verification query returns an unexpected count.
9. Log only fixture keys and counts; never log staging passwords, tokens, or full customer payloads.
10. Document the reset command and seed version in the staging runbook; on-call resets staging with one command, never by hand-editing rows, and every reset re-runs the post-seed verification before handing staging back to QA.

Do not use this for production backfills, load testing, or analytics fixtures.
