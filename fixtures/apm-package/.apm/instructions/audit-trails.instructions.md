---
description: "Audit-trail requirements for Acme Checkout: append-only event records with actor, action, timestamp, and redacted payloads for security-sensitive operations."
applyTo: "app/api/**/*.ts,audit/**/*.ts,orders/**/*.ts,payments/**/*.ts"
tags: [audit, logging, compliance]
---

# Audit trails

Apply when implementing or changing security-sensitive operations: payments, refunds, order state changes, access grants, configuration changes, or personal-data handling.

- Record an audit event for every covered operation with actor (user id, service name, or webhook source), action, target identifier (for example order `ord_test_1001`), timestamp in UTC, and outcome; an operation without its audit write is incomplete.
- Store audit records append-only: application code may insert new events but must never update or delete existing ones, and no routine cleanup job may prune the trail without a documented retention policy.
- Keep payloads redacted by construction: audit events carry identifiers and outcomes, never secrets, tokens, raw card data, full provider payloads, or personal-data fields beyond the minimum needed to identify the subject.
- Emit the audit write in the same atomic boundary as the operation it describes (same transaction or outbox pattern) so a crash cannot leave a committed payment with no record, or a record with no committed payment.
- Attach a correlation identifier (request id, webhook event id such as `evt_test_8801`) to each event so a retried operation links its attempts into one reviewable chain instead of scattering disconnected rows.
- Make the trail queryable for support and review: filter by actor, action, target, and time range, with bounded pagination — never unbounded full-table scans over the audit store.
- Protect read access: audit history is sensitive operational data, so endpoints exposing it require authorization checks and must not leak records across tenant or customer boundaries.
- Use synthetic actors and identifiers in tests and examples (for example actor `user_test_0042`, never a real customer email); test fixtures must prove the event fires on success, on failure, and on retry without duplicating the record.

Do not treat application logs as the audit trail; logs rotate, redact unevenly, and lack the integrity guarantees reviewers and regulators expect.
