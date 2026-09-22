---
name: replay-webhook
description: >-
  Replay Acme Checkout webhooks safely with signature verification, idempotent handlers, ordered redelivery, and dead-letter triage.
---

# Webhook replayer

Use when redelivering missed, failed, or out-of-order Acme Checkout webhook events.

1. Select the replay scope explicitly: event ids (for example `evt_33018`, `evt_33019`) or a bounded `(endpoint, time-range)` window under 24 hours; reject unbounded replays and page large windows in 500-event batches.
2. Verify before replaying: each stored event must carry a valid provider signature over its original raw body; drop tampered or unsigned events into the dead-letter queue instead of redelivering them.
3. Replay through the idempotent handler path: the consumer dedupes on event id (for example `evt_33018`) so redelivery never double-captures a payment or double-fulfills an order; assert the dedupe key exists before the first replay.
4. Preserve causal order per aggregate: replay events for order `ord_77120` in `(occurred_at, id)` sequence (`payment.authorized` before `payment.captured`); across different orders, any order is safe and parallelism is allowed.
5. Throttle the replay to protect the consumer: max 50 deliveries per second per endpoint with exponential backoff (1s, 5s, 30s) on 429/5xx; after three failures, park the event in the dead-letter queue and continue the batch.
6. Sign every redelivery with the endpoint's current secret (for example secret version `whsec_v6`) and include the original `attempt` count plus `replay=true` header; the consumer must accept both the current and previous secret during rotation windows.
7. Report per-event outcomes: `delivered`, `duplicate_skipped`, or `dead_lettered` with event id, endpoint, HTTP status, and latency; emit one `webhook.replay_completed` summary with batch counts when the run finishes.
8. Log only event ids, endpoint hosts, statuses, and counts; never log full event bodies, customer PII, or webhook secrets.

Do not use this to fabricate new events, mutate order state directly, or rotate webhook secrets.
