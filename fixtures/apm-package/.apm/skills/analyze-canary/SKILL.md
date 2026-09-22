---
name: analyze-canary
description: >-
  Analyze an Acme Checkout canary deploy with guardrail metrics, statistical promotion gates, automatic rollback triggers, and staged traffic steps.
---

# Canary analyzer

Use when implementing or reviewing progressive canary analysis for a production deploy.

1. Define the canary stages up front for the Acme Checkout service (for example `checkout-api` build `bld_2026_09_22_04`): 1%, 10%, 50%, 100%, each held for a minimum 15-minute bake window before the next promotion step.
2. Pin the guardrail metric set before traffic shifts: p99 latency under 450ms, error rate under 0.5%, checkout-conversion within 2 points of baseline, and zero `payment_double_charge` events; every guardrail needs an explicit abort threshold, not a dashboard glance.
3. Compare canary against the stable baseline over identical windows using the same queries (for example `errors{deploy="canary"}` versus `errors{deploy="stable"}`); never compare a 5-minute canary slice against a 24-hour baseline average.
4. Require statistical significance on promotion gates: at least 500 canary requests per stage, error-rate delta tested at p < 0.05, and latency compared by p50/p99 histograms rather than means that hide tail regressions.
5. Trigger automatic rollback without human approval when any hard guardrail breaches for 3 consecutive minutes: shift traffic to stable, freeze the pipeline, page the deploy owner, and record the aborting metric snapshot on the deploy ticket.
6. Gate promotion on all green signals: every guardrail passes, the bake window elapsed, and a human (or the policy bot `deploybot`) recorded an explicit promote decision per stage; a skipped gate blocks promotion, never silently passes.
7. Keep the blast radius small during early stages by pinning canary traffic to a single region or availability zone first, and verify region-scoped dashboards separately before expanding to global traffic.
8. Emit one `deploy.canary_decision` event per stage transition with stage, metrics snapshot, decision (`promote`, `hold`, `rollback`), and decider identity so post-incident review can reconstruct exactly why traffic moved.
9. Log only deploy ids, stage percentages, and aggregate metric values; never log customer identifiers, order payloads, or card-adjacent fields alongside canary telemetry.

Do not use this for feature-flag percentage rollouts, load-test analysis, or post-deploy SLO reporting alone.
