---
description: "Canary deployment rules for Acme Checkout releases: staged traffic shifting, bake windows, promotion gates, and automatic rollback triggers."
applyTo: "deploy/**/*,infra/**/*,.github/workflows/**/*"
tags: [canary, deployment]
---

# Canary deploys

Apply when changing release rollout behavior or shipping a production deployment in stages.

1. Roll out in explicit stages with traffic percentages and bake windows, for example 1% for 15 minutes, then 10% for 1 hour, then 50%, then 100%. Never jump from canary directly to full traffic.
2. Define promotion gates before the rollout starts: error-rate ceiling, p99 latency ceiling, and checkout-conversion floor measured against the stable cohort over the same window.
3. The canary cohort MUST be comparable to baseline: same regions, same device mix, same time window. Comparing canary traffic from `us-east` off-peak against global peak baseline proves nothing.
4. Automatic rollback triggers are REQUIRED: error-rate spike, SLO burn-rate alert, or failed synthetic checkout probe. State the exact threshold and who is paged when it fires.
5. Keep the previous release deployable for the full canary window. A canary whose rollback artifact was garbage-collected is not a canary.
6. Database migrations MUST be backward-compatible across the canary window: the old release keeps serving while the canary runs, so additive changes first, destructive changes in a later release.
7. Tag canary traffic observably: distinct deployment label, separate dashboard panel, and log field so canary errors are attributable without guessing.
8. Record the rollout decision trail: who promoted each stage, which gate values were observed, and the command used to promote or roll back.
9. For changes touching payments, authentication, or webhooks, add a focused synthetic check (for example a demo-merchant `merchant_acme_demo_042` test checkout) to the canary gate set.
10. Document canary commands separately for staging versus production; a runbook that does not say which environment it affects MUST NOT be used.
