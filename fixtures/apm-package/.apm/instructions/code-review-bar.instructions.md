---
description: "Code-review bar for Acme Checkout changes: what reviewers must check, approval discipline, and author responsibilities before requesting review."
applyTo: "**/*"
tags: [code-review, quality]
---

# Code-review bar

Apply when requesting review or reviewing an Acme Checkout change.

1. Authors MUST self-review the full diff before requesting review: remove debug output, stray comments, unrelated drive-by edits, and accidental fixture changes. A diff containing `console.log` debugging or commented-out blocks is not ready.
2. Keep changes reviewable: one concern per change, under roughly 400 lines of meaningful diff excluding generated files. Larger changes need a written summary mapping each part to its purpose, or MUST be split.
3. Reviewers check correctness first: does the change do what it claims, are error paths handled, are boundaries (payments, auth, personal data, webhooks) given focused scrutiny. Style nits never block; missing failure handling does.
4. Every change needs verification evidence in its description: exact test command and result, or a demo-merchant walkthrough (for example an Acme Checkout session for `merchant_acme_demo_042`) with observed outcome. "Works on my machine" without evidence is not evidence.
5. Reviewers MUST verify the tests discriminate the fix: would the new test fail without the change. Tests that pass either way get sent back.
6. Approval requires understanding, not skimming: the approver states what they checked (logic, tests, migration safety, rollback). Rubber-stamp approvals on payment, auth, migration, or webhook changes are prohibited.
7. Blocking comments name the specific risk and the required resolution ("blocks: card tokens logged in webhook handler; strip before merging"). Non-blocking suggestions are labeled as such so authors can merge confidently.
8. Security-sensitive paths need a second reviewer: any change touching card data, session tokens, secrets handling, or personal-data exports MUST have two approvals, one from a reviewer familiar with that boundary.
9. Follow up after merge: the author watches CI, the canary or deploy signal, and the first production telemetry for the changed path. Merging and disappearing is not done.
10. Disagreements resolve by written reasoning, not seniority: the dissenter states the failure scenario they fear, the author states why it cannot occur or adds a test proving it. Unresolved safety objections block the merge.
