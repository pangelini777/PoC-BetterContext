---
description: "Tax calculation rules for Acme Checkout: trusted rate tables, server-side totals, rounding, jurisdiction handling, and inclusive/exclusive display."
applyTo: "app/api/checkout/**/*.ts,pricing/**/*.ts,tax/**/*.ts,orders/**/*.ts"
tags: [tax, pricing, checkout]
---

# Tax calculation

Apply when checkout, pricing, order-total, or invoicing code computes, displays, or persists tax amounts.

- Compute tax exclusively from trusted server-side rate data (rate table, tax service response, order jurisdiction); never accept a client-supplied tax total, rate, or jurisdiction override.
- Resolve the tax jurisdiction from the order's verified address data (for example `order.shippingAddress.postalCode`), not from a request query parameter or hidden form field.
- Keep money in integer minor units (cents) through every intermediate step; apply rounding once per line item using the documented rounding mode, then sum — never round a rounded total again.
- Treat tax-inclusive and tax-exclusive display as distinct paths: the displayed label must state which one applies (for example "incl. VAT" versus "plus VAT"), and the stored order record must record the mode alongside the amounts.
- Persist the inputs used for the calculation on the order (jurisdiction code, rate identifier, rate version, taxable base) so a support engineer can recompute the total from the record alone.
- Handle rate-table misses as explicit errors: an unknown jurisdiction or expired rate version must block checkout with a safe error, never silently fall back to a zero rate.
- Handle exempt and zero-rated items as explicit line-level flags with a recorded reason code; an exemption must never be implemented as a missing rate or a manual total adjustment.
- Reverse tax symmetrically on refunds and partial cancellations: recompute the refundable tax from the stored order inputs rather than accepting a client-supplied refund tax figure.
- Keep tax logic free of payment-provider secrets and raw card data; the tax module receives amounts and jurisdiction codes only.
- Cover each change with focused tests using synthetic fixtures (for example Acme Checkout order `ord_test_1001` with a 19% fixture rate for `DE-BE-10115`): a standard rate, a zero-rated item, an exempt line with reason code, a multi-line rounding case, a partial-refund reversal, and an unknown-jurisdiction rejection.

Do not infer that a tax total is correct merely because the displayed grand total matches the charged amount in one manual pass.
