---
description: "Feature-flag discipline for Acme Checkout: flag naming, targeting, default-off safety, stale-flag removal, and flag-aware testing."
applyTo: "src/**/*,config/**/*"
tags: [feature-flags, rollout]
---

# Feature flags

Apply when adding, changing, or removing a feature flag, or when gating Acme Checkout behavior behind one.

1. Name flags descriptively with owner and intent: `checkout.express-pay-team.new-summary-layout`, not `flag123` or `newstuff`.
2. New flags MUST default to off (or to the current behavior) so an unevaluated flag preserves existing behavior.
3. Scope targeting narrowly: percentage rollouts, allowlisted merchant IDs (for example `merchant_acme_demo_042`), or explicit cohorts. Never gate on raw personal data such as customer email addresses.
4. Keep flag evaluation server-side for pricing, eligibility, and checkout flow decisions; client-side flags are presentation hints only.
5. Every flag needs a documented kill path: what happens when the flag service is unreachable (default value, cached value, or safe fallback), and which on-call owns it.
6. Flag-aware tests are REQUIRED:
   - one test with the flag on,
   - one test with the flag off,
   - one test for the fallback when evaluation fails.
7. Set a removal date at creation. Flags older than two release cycles without a removal plan MUST be flagged in review.
8. Never use a long-lived flag as configuration: pricing tiers, API keys, webhook URLs, and rate limits belong in configuration or secrets, not flags.
9. Log flag decisions at debug level with flag key and variant only; never log targeting attributes or customer data alongside the decision.
10. Removing a flag means removing both branches: delete the dead branch, the flag definition, and the targeting rule in the same change. A removal that leaves an orphaned `if (flag)` is incomplete.
