---
name: build-email-template
description: >-
  Build an Acme Checkout transactional email template with brand voice, safe variables, locale support, and plain-text fallback.
---

# Email template builder

Use when creating or changing an Acme Checkout transactional email (receipts, shipping, refunds, disputes).

1. Name the template by event and locale (for example `order.receipt_en`, `refund.issued_fr`); one template per event per locale, versioned (for example `order.receipt_en_v4`), so rollbacks pin an exact prior version.
2. Write the subject and body in Acme Checkout voice: short subject under 60 characters, one primary action per email, plain-language amounts with currency codes (for example `24.99 USD`); never promise delivery dates, refund timing, or dispute outcomes the system cannot guarantee.
3. Bind only allow-listed variables (for example `{{order.id}}`, `{{order.total}}`, `{{tracking.url}}`); render unknown or missing variables as empty with a logged warning, never by interpolating raw user input or HTML from order notes.
4. Escape and sanitize every variable at render time: HTML-escape names and addresses, URL-encode tracking links, and strip script/style tags from merchant-supplied fragments; the template must pass an XSS fixture (for example name `<img src=x onerror=alert(1)>`) before shipping.
5. Ship a plain-text twin for every HTML body with identical facts (amounts, ids, links as full URLs); the send call fails validation if either part is missing, so screen-reader and text-only clients never get a degraded receipt.
6. Preview with synthetic fixtures only: order `ord_77120`, merchant `merch_44012`, masked email `o***@example.com`; never preview with production customer data or real addresses.
7. Gate sending behind the preference check: transactional receipts always send, marketing-adjacent content respects the unsubscribe flag, and every footer carries the merchant support address plus a one-click preference link.
8. Log only template name, version, order id, and delivery status; never log full email bodies, recipient addresses, or tracking tokens in application logs.

Do not use this for SMS copy, push notifications, or marketing campaign builders.
