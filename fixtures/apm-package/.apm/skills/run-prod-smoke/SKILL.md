---
name: run-prod-smoke
description: >-
  Run the read-only Acme Checkout production smoke suite after a deploy with bounded probes, instant abort on failure, and safe synthetic writes.
---

# Production smoke runner

Use immediately after a production deploy or config change to confirm the storefront is healthy.

1. Run the pinned smoke list only: homepage 200, product page for `prod_staging_mirror_07`, cart-create, checkout-session dry-run, and webhook-endpoint HEAD; never invent extra probes against production mid-incident, and never run the suite twice concurrently against the same deploy.
2. Stay read-only by default: use `GET` and `HEAD` plus provider status pages; the single synthetic order uses a `smoke_merch_44012` test merchant flagged `source=prod-smoke` and is voided within 60s.
3. Bound every probe: 5s timeout, one retry, 3-minute total budget; a probe that exceeds budget fails the suite instead of hanging the deploy pipeline, and the runner exits non-zero so the pipeline halts promotion.
4. Abort on the first critical failure (checkout dry-run or payment provider unreachable) and page the deploy owner; continue past minor failures (search facet latency) but mark the suite amber, and record which probes were skipped after the abort.
5. Check deploy attribution: assert the running version matches deploy `d_9917` via the `/api/version` endpoint before trusting green probes against a stale rollout.
6. Compare against baseline: fail when p99 checkout latency exceeds 2x the 7-day median or error rate exceeds 1% over the 10-minute post-deploy window; use the same dashboard queries on-call watches to avoid metric-definition drift.
7. Notify once with a compact report: deploy id, per-probe pass/fail with latency, version hash, and the voided smoke order id; link dashboards instead of pasting raw bodies.
8. Never run load, chaos, or mutation probes in this suite; those belong in staging behind explicit approval, and any probe that writes customer-visible state is rejected from the smoke list at review time.
9. Test the suite itself in staging weekly with a forced-failure fixture so a silently broken smoker cannot report green.
10. Log only probe names, status codes, and latency aggregates; never log customer data, tokens, or full response payloads from production, and expire the smoke report artifacts after 30 days.

Do not use this for staging verification, full regression runs, or performance benchmarking.
