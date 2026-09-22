---
name: convert-currency
description: >-
  Convert Acme Checkout amounts across currencies with minor-unit math, trusted FX rates, rounding rules, and settlement-currency discipline.
---

# Currency converter

Use when displaying, charging, or settling an Acme Checkout amount in a non-base currency.

1. Represent every amount in minor units with an explicit currency code (for example `2499 EUR`, never `24.99` bare); reject requests missing either field with 400, and never accept floating-point amounts as canonical input.
2. Source the FX rate from the trusted rate table only (for example `fx_rates` version `fx_2026_09_22_06`), keyed by `(from, to, date)`; never call a public FX API at request time or accept a client-supplied rate.
3. Convert with integer math: `converted = round(amount_minor * rate_num / rate_den)` using the table's numerator/denominator pair; document the rate version and pair on the converted record so finance can replay the math exactly.
4. Apply the currency's rounding rule after conversion: zero-decimal currencies (for example `JPY`) round to whole units, two-decimal currencies round to the minor unit, and cash-settled totals round per merchant config (for example `merch_44012` rounds up to 5 minor units); record which rule fired.
5. Keep settlement currency authoritative: the charge settles in the merchant settlement currency (for example `USD`), while display currency is a presentation layer; store both (`display: 2299 EUR`, `settled: 2499 USD`) and never overwrite the settled figure with a display recomputation.
6. Handle stale or missing rates explicitly: rates older than 24 hours trigger a refresh job and a 503 with `retry_after` for live charges, while historical receipts reuse the rate version pinned at charge time instead of the current table.
7. Format for locale without changing value: render `2 499 €` for `fr-FR` and `€2,499.00` for `en-IE` from the same minor-unit figure; formatting must never feed back into arithmetic.
8. Log only amount, currency codes, rate version, and merchant id; never log customer identifiers, card data, or full rate-table dumps.

Do not use this for tax computation, fee schedules, or payout reconciliation.
