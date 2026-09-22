---
description: "Notification delivery rules for order and account emails/SMS: queuing, retries, templating, and unsubscribe handling."
applyTo: "app/api/notifications/**/*.ts,notifications/**/*.ts,workers/notify/**/*.ts"
tags: [notifications, email, reliability]
---

# Notification delivery

Apply when adding or changing customer notifications in Acme Checkout (order confirmations, shipping updates, account mail).

## Requirements

1. Send all customer notifications through a durable queue, never inline in the web request path.
2. Render templates server-side from reviewed template files; no string-concatenated HTML in handlers.
3. Include a plain-text alternative for every HTML email; links must carry the same destination in both parts.
4. Retry transient provider failures with bounded exponential backoff (at least 3 attempts over 15 minutes).
5. Treat provider "sent" as accepted, not delivered; track delivery/open webhooks separately from the send call.
6. Deduplicate by notification ID so a retried job never double-sends the same order confirmation.
7. Honor unsubscribe and bounce suppression lists before sending any marketing or lifecycle message.
8. Keep transactional mail (receipts, resets) on a separate sender and quota from marketing mail.
9. Personalize with the minimum fields the template needs (name, order ID); never attach full order or payment payloads.
10. Localize subject, body, and dates per recipient locale; fall back to English only when a translation is missing.
11. Log send attempts with template name, recipient hash, and provider message ID; never log full bodies with personal data.
12. Validate recipient addresses at the boundary; reject malformed addresses with 400 before enqueueing.
13. Provide an operator-visible dead-letter view for messages that exhaust retries, with a manual resend action.
14. Cover each new template with a render test plus a retry test (first attempt fails, second succeeds, one message sent).
15. Document template variables and required data next to each template file.

## Anti-patterns

16. Do not send notifications synchronously inside checkout or webhook handlers; queue latency must not block orders.
17. Do not embed secrets, reset tokens in cleartext logs, or raw card data in any notification.
18. Do not use the same idempotency scope for sends and orders; notification IDs live in their own namespace.
19. Do not retry hard bounces or explicit provider rejections; suppress and surface them instead.
20. Do not fire one provider call per recipient in a loop for bulk sends; use batch APIs with per-recipient status.
21. Do not change live template copy without a review step; templates are customer-facing contract.
22. Do not ignore provider webhook signature verification on delivery-status callbacks.

## Synthetic example

23. Order `ord_demo_500` for `sam@example.test` enqueues `notify_demo_900` with template `order-confirm-v2`. The first provider attempt times out, the retry succeeds, and the customer receives exactly one email whose plain-text part mirrors the HTML total of $42.50.
