---
name: send-notification
description: >-
  Send Acme Checkout transactional notifications with channel routing, template versioning, delivery retries, and unsubscribe-safe preferences.
---

# Notification sender

Use when implementing or fixing transactional email, SMS, or push delivery for orders and account events.

1. Classify the Acme Checkout event first (for example `order.shipped` for order `ord_100421`): transactional messages bypass marketing opt-out, while promotional ones must check the subscriber preference record.
2. Resolve the recipient channel set from stored preferences: verified email `ops@example.com`, SMS `+1-555-0100`, or push token `push_tok_abc123`; never send to an unverified address or an unsubscribed promotional channel.
3. Render the pinned template version (for example `order-shipped@v7`) with order-safe variables only: order id, tracking number, totals; never interpolate raw user HTML or unescaped input into the body.
4. Enqueue one delivery job per channel with a unique delivery id (for example `dlv_ord_100421_email_01`) so provider retries and duplicate queue deliveries collapse to a single send per recipient.
5. Apply per-channel retry policy with backoff: retry soft bounces and provider 5xx up to 5 times over 24 hours, and mark hard bounces or deactivated push tokens as undeliverable without further retries.
6. Honor unsubscribe and quiet hours: check the preference snapshot at send time, include a working unsubscribe link on marketing mail, and defer non-urgent sends inside the recipient quiet window (21:00-08:00 local).
7. Persist delivery status transitions (`queued`, `sent`, `delivered`, `bounced`, `complained`) keyed by delivery id, and suppress future promotional sends to addresses with an active complaint or hard bounce.
8. Emit one `notification.sent` event per successful provider acceptance with channel, template version, and delivery id for audit and support lookup.
9. Log only delivery ids, template versions, and status codes; never log message bodies containing personal data, tokens, or full recipient addresses in debug output.
10. If the provider credentials rotate or the template version is missing, fail closed with a machine-readable `notification_unavailable` error and keep the job queued for replay.

Do not use this for bulk marketing campaigns, in-app banner content, or provider account management.
