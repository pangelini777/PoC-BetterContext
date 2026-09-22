---
name: investigate-slo-burn
description: >-
  Investigate an Acme Checkout SLO burn alert by scoping the window, segmenting traffic, finding the regressing deploy, and proposing a stop-burn action.
---

# SLO burn investigator

Use when a burn-rate alert fires on an Acme Checkout service and the cause is unknown.

1. Scope the alert first: record the SLO (for example 99.9% checkout success over 30 days), the burn window (fast 1h vs slow 6h), and the current error budget remaining before touching any dashboard; an alert without a named SLO gets reclassified, not investigated.
2. Confirm the signal is real: compare the alerting query against raw request logs for merchant `merch_44012` over the same window, and rule out alert-config drift or a broken probe endpoint.
3. Segment the burn: split errors by endpoint, status code, region, and deploy version; a burn concentrated on `POST /api/orders` with `order_create_failed` after deploy `d_9917` points at the deploy, not global traffic.
4. Correlate with recent changes: list deploys, flag flips, and migrations in the 2h before burn start; check the canary diff for the suspect deploy before blaming infrastructure.
5. Read exemplars, not just rates: pull 20 failed traces with order ids like `ord_88021`, classify each (validation, provider timeout, DB deadlock), and report the dominant class with counts; if no single class exceeds 50%, widen the window before concluding.
6. Separate provider faults from own faults: if Stripe latency p99 tripled while own DB latency held flat, page the provider path and consider the cached-fallback runbook instead of rolling back own code; attach both latency graphs to the incident timeline.
7. Propose one stop-burn action with a revert path: rollback deploy `d_9917`, disable flag `flag_checkout_v2`, or shed low-priority export traffic; never stack two mitigations at once.
8. Verify the mitigation in the fast-burn window: watch the 1h burn rate return below 1x for 30 minutes before declaring the incident contained, and keep the incident channel open until the slow-burn window also recovers.
9. Write the timeline as observed facts (alert time, deploy time, action time) with trace and dashboard links; keep speculation in a separate hypotheses section, and update the timeline as new evidence lands rather than rewriting history.
10. File follow-ups for the top error class only: one ticket per class with exemplar traces and a proposed guard (alert, test, or limit); never log raw customer emails or card data in the incident notes.

Do not use this for feature work, load testing, or routine deploy checklists.
