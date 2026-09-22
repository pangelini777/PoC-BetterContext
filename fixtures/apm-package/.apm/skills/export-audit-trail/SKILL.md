---
name: export-audit-trail
description: >-
  Export an Acme Checkout audit trail with bounded time ranges, redacted payloads, signed manifests, and replay-safe pagination.
---

# Audit exporter

Use when implementing or fixing compliance or support exports of order, refund, and admin-action history.

1. Scope the export explicitly before querying: merchant id (for example `merch_44012`), event types (`order.created`, `refund.issued`), and a bounded time range (max 90 days per export); reject unbounded or cross-merchant requests with 400.
2. Require an export ticket (for example `export_tkt_5518`) with requester identity and business reason, and verify the requester holds export permission for the target merchant before the first row is read.
3. Paginate the source query with a stable cursor over `(occurred_at, id)` and a capped page size (500 rows), so a 2M-row export streams without loading the full result set into memory.
4. Redact payloads at export time: keep order ids, amounts, and status codes, but mask emails (for example `o***@example.com`), tokens, and card-adjacent fields; apply the same redaction profile `audit_redact_v3` to every row.
5. Write rows to a signed artifact (CSV plus SHA-256 manifest, for example `audit_merch_44012_2026-09-22.csv` with `audit_merch_44012_2026-09-22.sha256`); include row count, time range, redaction profile version, and exporter identity in the manifest header.
6. Make the export replay-safe: derive the artifact name from scope plus time range so a retried export overwrites the identical file instead of duplicating delivery, and record one `audit.exported` event per completed artifact.
7. Enforce authorization inside the query: the requesting admin must hold export permission for the target merchant, and every access is itself appended to the audit trail with requester, scope, and artifact hash.
8. Stream the file to object storage with a 24-hour expiring download link; never email the artifact or expose it on an unauthenticated URL.
9. Confirm delivery with a checksum handshake: the downloader verifies the SHA-256 before use, and a mismatch triggers a single automatic re-export rather than a manual retry loop.
10. Log only merchant id, row count, artifact hash, and time range; never log row contents, customer identifiers, or download URLs in application logs.

Do not use this for realtime event streaming, full-database dumps, or marketing analytics extracts.
