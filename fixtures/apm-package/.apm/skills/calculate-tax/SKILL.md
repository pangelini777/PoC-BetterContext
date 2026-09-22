---
name: calculate-tax
description: >-
  Compute Acme Checkout order tax with jurisdiction lookup, exempt-product handling, rounding rules, and audit-safe rate breakdowns.
---

# Tax calculator

Use when implementing or fixing sales-tax computation for checkout totals.

1. Resolve the Acme Checkout order ship-to address (for example `123 Market St, Springfield, IL 62701`) to a tax jurisdiction before rating any line; use the rooftop geocode result when available and fall back to ZIP+4, recording which resolution level produced the rate.
2. Classify each line item as taxable, exempt, or reduced-rate using the product tax code; never assume every SKU in the cart is taxable, and default unknown codes to taxable with a review flag rather than silently zero-rating them.
3. Fetch the effective rate set for the jurisdiction (state, county, city, district) from the pinned rate table version (for example `rates_2026_q3`), and record the version on the quote so a later rate change cannot retroactively alter an issued total.
4. Compute tax per line in integer minor units (cents), rounding half-up at the line level, then sum lines so the header total reconciles exactly; never compute on float dollars and round once at the end, which drifts by cents on multi-line orders.
5. Handle exemptions explicitly: require a valid exemption certificate id (for example `exempt_cert_7781`) before zero-rating, verify it is unexpired at checkout time, and keep the certificate reference on the order for audit replay.
6. Apply coupons and discounts before tax on the discounted line base, following the jurisdiction rule for the order; when a coupon spans taxable and exempt lines, prorate it by line subtotal so the taxable base stays defensible.
7. Recompute on every cart mutation (quantity, address, coupon) and invalidate cached quotes keyed by cart hash plus rate-table version; a quote older than 30 minutes or computed under a different rate version must re-rate before payment.
8. Handle marketplace-facilitator and cross-border orders by selecting the correct remitting party and duty treatment up front; when the facilitator collects, record a zero-tax line with reason `facilitator_collected` instead of omitting the line.
9. Return a rate breakdown per jurisdiction slice with taxable base and tax due, plus the rate-table version, so support can explain the total for order `ord_100421` without re-running the engine.
10. Log only jurisdiction codes, rate version, and totals; never log customer names or full street addresses alongside tax details.

Do not use this for income-tax filing, VAT registration advice, or provider settlement reconciliation.
