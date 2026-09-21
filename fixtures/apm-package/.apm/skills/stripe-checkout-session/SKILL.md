---
name: stripe-checkout-session
description: >-
  Implement server-side Stripe Checkout Session creation using trusted price/order data, provider-hosted card collection, metadata, and safe errors.
---

# Stripe Checkout Session

Use when creating a server-side Stripe Checkout Session.

1. Build the session on the server using trusted price/order data, never client-supplied totals.
2. Use provider-hosted card collection so raw card data never touches the application.
3. Attach order metadata needed for later webhook reconciliation.
4. Return the provider redirect URL; handle provider errors with safe generic messages.
5. Never log secrets, full provider payloads, or card-adjacent fields.
