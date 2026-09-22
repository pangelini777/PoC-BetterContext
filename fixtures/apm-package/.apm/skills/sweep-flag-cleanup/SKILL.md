---
name: sweep-flag-cleanup
description: >-
  Remove a fully rolled-out Acme Checkout feature flag by deleting branches, defaulting behavior, migrating callers, and verifying flag-free deploys.
---

# Flag cleanup sweeper

Use when a feature flag has reached 100% rollout and stayed stable long enough to remove.

1. Confirm removal readiness: flag `flag_checkout_v2` at 100% for at least 14 days, zero rollback events, and SLOs green; otherwise stop and keep the flag, recording the readiness check outcome in the cleanup ticket.
2. Inventory every reference: grep for the flag key, its kill-switch alias, and related config entries (for example `FLAG_CHECKOUT_V2`, `checkoutV2Enabled`); list files and line numbers before editing.
3. Lock the winning behavior first: set the new path as the unconditional default in code, keeping the old branch only until tests pass, so a partial edit never flips behavior.
4. Migrate callers branch by branch: delete the dead branch, inline the surviving logic, and remove flag-gated tests; replace flag-parameterized tests with one test per surviving behavior, and keep at least one regression test pinning the locked-in path for order `ord_88021`.
5. Remove the flag definition from the flag service and environment configs together; a code removal without config removal (or vice versa) leaves stale evaluation calls, so verify both sides in the same deploy.
6. Keep the kill path only when safety demands it: operational circuit breakers stay, product-experiment flags go; document which category the flag was before deleting.
7. Verify flag-free: re-grep for the key (zero hits), run the focused suite for the touched area, and deploy behind the normal canary watching error rate for merchant `merch_44012`; hold the canary for the full bake window even when early metrics look green.
8. Announce the removal in the team channel with the flag name, behavior locked in, and deploy id `d_9917` so on-call knows there is no flag to flip back.
9. Archive the flag's rollout history link in the removal commit message for audit; never delete audit logs or past evaluation records, and keep the original rollout ticket linked for future archaeologists.
10. Log only flag names and deploy ids during cleanup; never log customer emails or evaluation payloads containing personal data, and keep the cleanup ticket as the single record of what was removed.

Do not use this to roll out, ramp, or debug a live flag; use the rollout workflow instead.
