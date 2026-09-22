---
name: run-review-checklist
description: >-
  Run an Acme Checkout code-review checklist with correctness, security, data-safety, and author-actionable findings.
---

# Review checklist runner

Use when reviewing an Acme Checkout change before approval or merge.

1. Confirm the change scope first: linked ticket, touched paths, and migration/backfill presence; send back scope-creep diffs (unrelated refactors, drive-by formatting) for splitting before reviewing logic.
2. Check correctness at the boundaries: request validation rejects bad input with 400, money math stays in minor units, state transitions use guarded writes (for example order `ord_77120` cannot jump `pending -> fulfilled`), and retries are idempotent on keys like `sess_55118`.
3. Check security and privacy: no raw card data in app code, no secrets in the diff, webhook handlers verify signatures on raw bodies, authorization is re-checked inside the query for merchant `merch_44012`, and logs carry ids only (never emails like `o***@example.com` unmasked).
4. Check data safety: migrations are expand/contract compatible with a down path or forward fix, backfills are bounded and resumable, destructive DDL is flagged, and seed/fixtures use synthetic ids rather than production dumps.
5. Check tests as evidence: the diff must include a failing-before/passing-after case for the fixed behavior plus one failure-path test (expired hold, declined card, duplicate webhook `evt_33018`); bare not-throw or coverage-only tests are called out, not counted.
6. Write findings as author-actionable items: file plus line, what breaks, a concrete fix, and severity (`blocker`, `should-fix`, `nit`); at most three nits per review so signal survives, and every blocker needs a suggested patch or test.
7. Render the verdict explicitly: `approve`, `approve-with-followups` (with ticket ids), or `request-changes` listing the blocking items; never approve with open blockers or unreviewed force-pushes after the last pass.
8. Log only review ids, verdicts, and finding counts by severity; never paste secrets, customer data, or full diffs into review tooling outside the code host.

Do not use this for post-incident review, dependency approval, or public-docs editing.
