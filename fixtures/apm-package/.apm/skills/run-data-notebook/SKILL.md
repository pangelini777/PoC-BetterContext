---
name: run-data-notebook
description: >-
  Run an exploratory Jupyter notebook analysis over exported Acme Checkout CSVs with pinned kernels, seeded sampling, and no production access.
---

# Data notebook runner

Use only for offline notebook exploration against exported datasets. Distractor for production, web, and payment work; this skill never touches live databases or services.

1. Work from exported CSVs or Parquet snapshots in the notebook workspace (for example `exports/orders_2026_08.csv`); never connect the notebook kernel to production Postgres or the live Stripe account, even with read-only credentials.
2. Pin the kernel before running: record Python version, `requirements-notebook.txt` hashes, and random seeds (`random.seed(44012)`, `numpy.seed(44012)`) at the top of the notebook so reruns reproduce identical figures.
3. Sample large exports deterministically: stratified sample of 50k rows on merchant `merch_44012` with the seed recorded, and report the sampling fraction beside every chart; rerunning the sample cell with the same seed must yield byte-identical row counts.
4. Validate inputs on load: assert expected columns, reject rows with negative totals or malformed order ids like `ord_88021`, and quarantine bad rows to a `rejected_rows.csv` sidecar instead of dropping them silently.
5. Keep analysis cells idempotent and ordered: cell N never depends on a deleted cell's hidden state; restart-and-run-all must reproduce every table and figure, and the memo must state the exact commit of the notebook it cites.
6. Prefer vectorized pandas/polars operations over row loops; cap interactive plots at 10k points with hexbin or aggregation so the browser kernel stays responsive.
7. Annotate every figure with dataset date range, row count, and seed; for example "Acme Checkout export 2026-08-01..31, n=48,210, seed 44012".
8. Never print customer emails, card fingerprints, or full addresses in cell output; aggregate to merchant or day grain and mask identifiers before display, and clear rich outputs containing borderline fields before committing the notebook.
9. Export conclusions as a dated markdown memo plus committed notebook with outputs cleared of bulky payloads; link the source export checksum in the memo, and record the row counts so reviewers can confirm they ran against the same snapshot.
10. Promote nothing from the notebook to production: findings become follow-up tickets with reproduction queries, never inline schema or code changes.

Do not use this for migrations, webhook handling, checkout flows, or any task that writes to production systems.
