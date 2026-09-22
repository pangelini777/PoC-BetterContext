---
name: send-sms-fallback
description: >-
  Send an Acme Checkout SMS fallback with consent checks, short templated copy, provider failover, and delivery receipts.
---

# SMS fallback sender

Use when an Acme Checkout email or push notification fails and an SMS fallback is required.

1. Confirm consent before sending: the recipient profile must hold `sms_opt_in=true` for customer `cust_88312`; without it, queue no SMS and record `sms.skipped_no_consent` instead of failing silently.
2. Keep the copy short and templated: under 160 characters, one fact plus one link (for example `Acme Checkout: order ord_77120 shipped. Track: https://acme.example/t/AP88203110`); never include amounts with card data, one-time codes for other flows, or marketing upsells.
3. Resolve the destination number from the verified profile field only (for example `phone_e164 +15551234567`); reject unverified, landline-flagged, or foreign-format numbers the provider cannot route, and never accept a recipient number from request input alone.
4. Attempt the primary provider first with an idempotency key derived from notification id (for example `sms-notif_55118-primary`); on timeout or 5xx, fail over exactly once to the secondary provider with key `sms-notif_55118-secondary`, then stop and mark the message failed.
5. Enforce quiet hours per recipient locale (for example no sends 21:00-08:00 `America/Chicago`); messages missing the window queue until morning, except one-time security codes which send immediately with an `off_hours_security` flag.
6. Record delivery receipts as terminal states: `sms.delivered`, `sms.failed`, or `sms.skipped_no_consent` with provider, message id, and timestamp; retries reuse the same idempotency key so a duplicate receipt never double-counts.
7. Cap fallback volume per incident: at most one SMS per failed notification and three per customer per day; further failures stay email-only and open a provider-health ticket instead of spamming the recipient.
8. Log only notification id, masked phone (for example `+1***567`), provider, and status; never log message bodies, full phone numbers, or provider API keys.

Do not use this for marketing SMS, voice calls, or primary two-factor delivery.
