---
name: review-contract-diff
description: >-
  Review an Acme Checkout OpenAPI contract diff for breaking changes, schema drift, example accuracy, and implementation alignment before merge.
---

# Contract diff reviewer

Use when reviewing a pull request that changes the Acme Checkout OpenAPI contract or generated API surface.

1. Load the contract diff itself first (for example `openapi/acme-checkout@v42` versus `@v43`): enumerate added, removed, and renamed paths plus changed request/response schemas before reading any implementation code.
2. Classify every change as breaking or safe: removed paths, removed fields, tightened required lists, and altered status codes (for example `POST /refunds` dropping `reason`) are breaking; additive optional fields and new paths are safe pending review.
3. Verify schema drift field by field: type changes, enum narrowing, new required properties, and altered nullability each get an explicit verdict, and any silent tightening fails the review until versioned or reverted.
4. Check example accuracy against the new schemas: every request/response example (for example `RefundResponse` with `refund_id: re_200991`) must validate, and stale examples that no longer match the schema block the merge.
5. Confirm implementation alignment: the handler, validator, and serializer for each changed path must accept and emit exactly what the contract promises; a contract-only change without matching code (or vice versa) fails the review.
6. Enforce versioning policy: breaking changes require a new API version segment or an explicit sunset header plus changelog entry, never a silent in-place break on the current version.
7. Run the contract test suite (schema validation plus consumer-driven pacts `pact_checkout_v12`) and require green results on the diff commit; a passing unit suite alone does not clear a contract change.
8. Record the review outcome on the pull request: breaking-change list, example check result, implementation-alignment notes, and the approve or request-changes verdict with file and line references.
9. Log only contract version, path names, and check outcomes; never log customer data, API secrets, or full request payloads alongside review telemetry.

Do not use this for initial API design drafts, marketing documentation edits, or generated-client release publishing.
