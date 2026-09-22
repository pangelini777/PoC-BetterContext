---
name: render-invoice-pdf
description: >-
  Render an Acme Checkout order invoice PDF from trusted order data with deterministic layout, locale-aware money formatting, and archival output.
---

# Invoice PDF renderer

Use when generating a customer or merchant invoice PDF for a completed Acme Checkout order.

1. Render from trusted server-side order rows only (order `ord_88021`, merchant `merch_44012`): line items, unit prices in minor units, tax, shipping, and totals; never accept line-item prices from client input.
2. Format money per locale with explicit currency: `USD 42.10`, `EUR 38,50`, using the order's captured currency; show the minor-unit source value in a machine-readable appendix for reconciliation, and never round display values independently of the ledger.
3. Keep layout deterministic: fixed A4 page, embedded fonts, no remote assets, and byte-stable output for identical inputs so reprints match the original hash; pin the renderer library version and record it in the job metadata.
4. Number pages and reference the order id on every page (`ord_88021`, page 1/2) so split or reordered prints stay attributable.
5. Include required fiscal fields: merchant legal name, tax id mask (`TX•••4412`), invoice date in ISO format, and sequential invoice number `INV-2026-088021`; leave placeholders visible as `NOT SET` rather than silently omitting them, and fail the render when the invoice number is missing.
6. Handle refunds and partial captures as separate credit-note pages linked to the original invoice, never by editing the issued PDF in place.
7. Generate asynchronously off the request path: enqueue a render job with the order id, store the PDF at `invoices/ord_88021.pdf`, and return a signed download URL with a 24h expiry; retry failed renders twice with backoff before marking the job dead.
8. Test with synthetic orders only: single-item, multi-tax-rate, zero-total, and 50-line overflow cases; assert totals reconcile to the order ledger within one minor unit.
9. Archive the issued PDF hash alongside the order record for 7 years; reprints serve the archived bytes, never a fresh render that could drift, and the archive lookup key is the invoice number plus order id.
10. Log only order id, invoice number, and render outcome; never log buyer emails, full addresses, or card data during rendering, and alert on repeated render failures for the same order.

Do not use this for marketing PDFs, packing slips, or editable spreadsheet exports.
