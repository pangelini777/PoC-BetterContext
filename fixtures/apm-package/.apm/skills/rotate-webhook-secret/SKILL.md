---
name: rotate-webhook-secret
description: >-
  Rotate an Acme Checkout webhook signing secret with dual-secret verification, staged rollout, revocation, and delivery verification.
---

# Webhook secret rotator

Use when rotating the signing secret for an inbound or outbound Acme Checkout webhook endpoint.

1. Generate the new secret server-side with 32 random bytes (base64url, for example `whsec_r2D8fKqN4xT7vB1mZ3pL6sA9cE0gH5jK`) and store it in the secret manager; never accept a client-supplied secret or commit one to the repo, and confirm the stored value matches the published value with a checksum.
2. Support dual verification during rotation: accept signatures from the old secret `whsec_old_4412` and the new secret for 48h, checking the new one first and tagging each delivery with the verifying key id.
3. Publish the new secret to the counterparty through the documented channel (dashboard secret-roll endpoint or encrypted config push), and confirm receipt before starting the 48h window; never send the secret over plain email or chat threads.
4. Monitor both key ids during the window: alert if old-key deliveries exceed 5% after 24h, which signals a counterparty that never picked up the new secret; include per-key delivery counts in the daily rotation status update.
5. Revoke the old secret exactly once: after 48h with zero old-key deliveries in the trailing 6h, disable `whsec_old_4412`, then verify a fresh test delivery verifies against the new secret only.
6. Keep replay protection intact throughout: timestamp tolerance 5 minutes, nonce cache keyed by delivery id, and idempotent handlers so a redelivered event during rotation processes once, regardless of which key verified it.
7. Roll back by re-enabling dual verification, never by resurrecting a revoked secret value; if the new secret leaks, generate a third secret and restart rotation.
8. Test with synthetic payloads: old-only signature, new-only signature, both-valid window, expired timestamp, and tampered body; assert each case's accept/reject outcome, and assert the verifying key id is tagged correctly on every accepted delivery.
9. Record the rotation in the audit log with key ids, actor, and timestamps; never write secret values to logs, tickets, or example `.env` files.
10. Update the `.env.example` placeholder (`WEBHOOK_SECRET=whsec_...`) only with a fake value, and confirm no real secret appears in git history after rotation.

Do not use this for API-key rotation, OAuth client secrets, or database credential changes.
