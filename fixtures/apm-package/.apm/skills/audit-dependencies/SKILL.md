---
name: audit-dependencies
description: >-
  Audit Acme Checkout dependencies with risk-tiered review, lockfile checks, advisory triage, and staged upgrade plan.
---

# Dependency auditor

Use when reviewing, upgrading, or approving an Acme Checkout third-party dependency change.

1. Inventory the change surface first: package name plus from/to versions (for example `acme-pay 2.14.0 -> 2.15.1`), lockfile diff, and which checkout paths import it (sessions, webhooks, payouts); vague `bump all` requests are rejected.
2. Tier the risk before testing: patch releases get install plus smoke tests, minor releases add the focused suite for the importing paths, and major releases require changelog review, breaking-change grep, and a staged rollout with rollback notes.
3. Triage advisories by reachability, not raw severity: confirm whether the vulnerable function is actually called (for example `acme-pay/verifySignature` in the webhook handler); unreachable advisories are scheduled normally, reachable criticals jump the queue with a 48-hour SLA.
4. Verify lockfile hygiene: the lockfile must pin exact versions, the manifest must not float across majors, and checksums must match the registry; fail the audit on a lockfile-manifest mismatch or an unsigned provenance gap for payment-adjacent packages.
5. Test the upgrade at the importing paths: session creation for merchant `merch_44012`, webhook verification fixture `evt_33018`, and payout reconciliation sample; record pass/fail per path rather than a single whole-suite verdict.
6. Plan the rollout with a revert line: deploy behind the normal pipeline to staging first, bake 24 hours on low-risk tiers (docs, lint, test-only deps ship directly), and keep the prior lockfile entry plus rollback deploy id on the ticket.
7. Record the decision: version pair, risk tier, advisory ids (if any), test evidence, rollout plan, and owner; emit one `deps.audited` note per package so the next audit starts from written state.
8. Log only package names, versions, advisory ids, and ticket ids; never log registry tokens, customer data, or internal mirror credentials.

Do not use this for first-party code review, license-legal clearance, or secret rotation.
