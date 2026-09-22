---
name: build-vat-report
description: >-
  Build an Acme Checkout VAT report for a merchant and period from ledger rows with jurisdiction grouping, audit links, and CSV export.
---

# VAT report builder

Use when producing a periodic VAT or sales-tax summary for a merchant's finance team.

1. Source every figure from posted ledger rows for merchant `merch_44012` and the closed period (for example `2026-07-01..2026-07-31`); never include draft, voided, or test-mode orders like `ord_88021` in report fixtures, and freeze the ledger snapshot before aggregating.
2. Group by jurisdiction and rate: one row per (country, rate) pair with net, tax, and gross in minor units, plus the order count; keep rates as exact decimals (`0.19`, `0.077`) to avoid float drift.
3. Reconcile before exporting: sum of report gross must equal the ledger gross for the period within one minor unit; abort with `vat_reconcile_failed` and list the diff instead of shipping a drifting report, and attach the failing jurisdiction rows for finance review.
4. Handle corrections as separate lines: refunds and credit notes appear as negative rows linked to the original invoice (`INV-2026-088021`), never by editing the original period row, so auditors can trace every adjustment to its source.
5. Convert currencies at the captured rate stored on each order, and show both the order currency and the report currency columns; flag any order missing a rate for manual review.
6. Export a stable CSV with header `jurisdiction,rate_bps,orders,net_minor,tax_minor,gross_minor`, UTF-8 encoding, and LF endings; filename `vat_merch_44012_2026-07.csv`, with rows sorted by jurisdiction then rate so diffs between reruns stay readable.
7. Attach an audit appendix: report parameters, ledger snapshot hash, generator version, and the reconciliation result so finance can reproduce the run.
8. Test with synthetic ledgers: multi-rate period, refund-spanning periods, and mixed-currency months; assert per-jurisdiction totals and the reconciliation gate, and assert the CSV header order never drifts between runs.
9. Retain issued reports and their inputs for 7 years in the finance archive; re-downloads serve archived bytes, never a regenerated variant.
10. Log only merchant id, period, and row counts; never log buyer emails, addresses, or line-item detail in job logs, and restrict report downloads to finance roles with audit-logged access.

Do not use this for invoice rendering, real-time tax calculation, or filing with tax authorities.
