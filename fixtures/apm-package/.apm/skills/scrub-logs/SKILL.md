---
name: scrub-logs
description: >-
  Scrub Acme Checkout logs and exports of secrets, PII, and card data with pattern profiles, sampled verification, and safe redaction.
---

# Log scrubber

Use when removing secrets, personal data, or payment payloads from Acme Checkout logs or exports.

1. Select the scrub profile before scanning (for example `scrub_profile_v5`): secret patterns (keys, tokens, `whsec_*`), PII patterns (emails, `+15551234567` phones, addresses), and card-adjacent patterns (PAN fragments, CVC, expiry); reject ad-hoc regex runs outside a versioned profile.
2. Scan the bounded scope only: named log group plus time range (for example `/acme/checkout/api`, `2026-09-15/22`), or a named export file (for example `audit_merch_44012_2026-09-22.csv`); never run open-ended scans across all log groups in one job.
3. Redact with structure-preserving tokens: emails become `o***@example.com`, phones become `+1***567`, secrets become `[REDACTED:secret]`, card fields become `[REDACTED:pan]`; keep order ids (for example `ord_77120`) and timestamps intact so debugging still works.
4. Verify with sampled diffs: after scrubbing, pull a 200-line sample and assert zero profile-pattern hits with the verification scanner; any hit fails the job and routes the sample (with line numbers, not full contents) to the owning team.
5. Preserve forensic utility explicitly: retain request ids, status codes, latency, merchant ids (for example `merch_44012`), and error names; drop only the sensitive values, never the rows, so error-rate dashboards stay accurate.
6. Handle live pipelines separately from archives: live shippers apply the profile at emit time with a 5-minute propagation check, while archived objects get a scrubbed copy written beside the original (for example `api.log.scrubbed`) and the original is expired per retention policy.
7. Record the scrub run: profile version, scope, lines scanned, redactions per pattern class, and verifier result; emit one `logs.scrubbed` event per completed run with those counts and no sample contents.
8. Never echo matched secrets or PII into job output, tickets, or chat; paste only pattern names and line numbers when reporting findings.

Do not use this for database deletion, GDPR erasure execution, or fraud investigation data pulls.
