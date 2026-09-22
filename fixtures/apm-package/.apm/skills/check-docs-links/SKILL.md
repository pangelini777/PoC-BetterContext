---
name: check-docs-links
description: >-
  Check Acme Checkout documentation links with scoped crawls, anchor verification, redirect policy, and fix-or-file triage.
---

# Docs link checker

Use when verifying links and anchors across Acme Checkout developer documentation.

1. Scope the crawl explicitly: docs root plus changed pages (for example `docs/checkout/sessions.md`, `docs/webhooks.md`); full-site crawls run nightly, while per-change checks cover only added or edited files plus their outbound links.
2. Verify each link in two layers: HTTP status of the target (expect 200 after redirects) and anchor existence on the fetched page (for example `#idempotency-keys` must match a real heading id); a 200 with a missing anchor still fails the check.
3. Apply the redirect policy: allow one same-host redirect (trailing slash, locale prefix like `/docs/en/`), flag chains of two or more, and fail cross-host redirects to unapproved domains; provider dashboard links must use the allow-listed hosts (for example `dashboard.acme.example`).
4. Triage failures as fix-or-file: broken internal links and missing anchors are fixed in the same change, broken external links get a 7-day ticket to the page owner, and flaky third-party 5xx results retry twice before filing rather than failing the build.
5. Respect link hygiene rules: relative links for in-docs navigation, pinned version paths for versioned APIs (for example `/docs/v2/checkout`), no links to `localhost`, staging hosts, or ticket-internal URLs; example code hosts use `acme.example` placeholders only.
6. Check examples alongside prose: every curl or SDK snippet's referenced endpoint must resolve in the current OpenAPI file, and every linked fixture (for example `evt_33018.json`) must exist in the docs fixtures dir with matching ids.
7. Publish the run summary: pages scanned, links checked, failures by class (404, anchor-missing, redirect-chain, external), and the fix-or-file disposition per failure with owner and ticket id where filed.
8. Log only page paths, URLs, statuses, and counts; never log docs-auth tokens, preview credentials, or customer data pasted into example payloads.

Do not use this for spell-checking, brand-voice review, or API contract validation.
