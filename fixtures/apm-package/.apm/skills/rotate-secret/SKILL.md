---
name: rotate-secret
description: >-
  Rotate an Acme Checkout credential with dual-secret overlap, staged rollout, revocation evidence, and leak response.
---

# Secret rotator

Use when rotating an Acme Checkout API key, webhook secret, or provider credential.

1. Inventory the secret's blast radius first: every reader and writer (for example webhook endpoint `https://acme.example/hooks/pay`, worker `payout_q`, dashboard user `ops_014`); no rotation starts until the consumer list is complete and owned.
2. Issue the new secret alongside the old one (overlap window 24 hours, for example `whsec_v6` live while `whsec_v7` rolls out); consumers accept both versions during the window so in-flight requests signed with either key verify cleanly.
3. Roll out in dependency order: provider-side issuance first, then server verification config, then edge caches and workers, then the sender cutover; each stage gets a health check (for example 50 consecutive verified webhooks) before the next begins.
4. Cut over the sender only after all verifiers accept the new secret; flip the signing key in one deploy, watch error rates for 30 minutes, and keep the instant-revert flag (re-sign with `whsec_v6`) armed during the bake window.
5. Revoke the old secret exactly once the bake window passes with zero auth failures: call the provider revocation API, assert subsequent `whsec_v6` requests fail closed with 401, and record the revocation id on the rotation ticket.
6. Handle suspected leaks as an emergency rotation: skip the overlap, revoke first, reissue, then reconcile — audit the access log for the leaked key window (for example `2026-09-20/22`), and force-expire sessions or tokens minted under the compromised secret.
7. Store the new secret in the vault only (for example path `acme/checkout/whsec`), never in chat, tickets, or `.env` files; reference it by path plus version in config, and confirm no repository file contains the plaintext value with a pre-merge scan.
8. Log only secret names, versions, rotation timestamps, and revocation ids; never log secret values, plaintext keys, or full credential payloads.

Do not use this for customer passwords, OAuth user tokens, or data-encryption key ceremonies.
