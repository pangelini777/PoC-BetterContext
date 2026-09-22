---
name: validate-address
description: >-
  Validate an Acme Checkout shipping or billing address with normalization, deliverability checks, and safe fallback when the provider is down.
---

# Address validator

Use when accepting, correcting, or re-verifying a customer address at checkout or in account settings.

1. Normalize before validating: trim whitespace, uppercase the postal code, collapse internal spacing, and split street lines so `12  Main St Apt 4` and `12 Main St, Apt 4` compare identically; run normalization before any cache lookup so equivalent inputs share one verdict.
2. Check the shape per country first: required fields, postal-code pattern (for example US `94110`, DE `10115`), and region codes against a pinned reference table; reject unknown country codes with `address_country_unsupported`.
3. Call the verification provider with a timeout of 3s and one retry; on provider success, accept `deliverable` and `deliverable_uncertain` but surface corrections (for example `9411O` to `94110`) for customer confirmation, and store the provider confidence score alongside the verdict.
4. Fail safe when the provider is down: accept the well-formed address with flag `validation_degraded`, queue a background recheck, and never block checkout on a provider outage; surface a neutral notice rather than an error so customers complete their purchase.
5. Never silently rewrite the customer input: show the provider suggestion beside the entered address and let the customer pick; store both the entered and the corrected variant on order `ord_88021`.
6. Reject obvious fakes deterministically: empty street, `123 Test St` with phone `000-0000`, or postal code `00000` return `address_rejected` without a provider call, sparing cost and latency on traffic no carrier could deliver.
7. Cache provider verdicts by normalized-address hash for 30 days to cut cost; exclude apartment-level differences from cache keys so unit changes revalidate.
8. Test with synthetic fixtures only: valid US/DE/GB addresses, transposed digits, unsupported country, and provider-timeout cases; assert the degraded path still creates the order, and assert corrections are offered rather than applied silently.
9. Emit validation metrics (provider latency, correction rate, reject rate) sliced by country so merchant `merch_44012` can spot regional form issues.
10. Log only the address hash, country, and verdict; never log full street lines, recipient names, or customer emails.

Do not use this for tax jurisdiction lookup, fraud scoring, or email validation.
