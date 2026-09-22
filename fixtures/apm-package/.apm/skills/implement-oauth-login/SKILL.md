---
name: implement-oauth-login
description: >-
  Implement an OAuth/OIDC login flow with trusted redirect handling, state/nonce validation, token/session hygiene, and authorization boundaries.
---

# OAuth login

Use when implementing an OAuth/OIDC login flow.

1. Validate redirect targets against an allow-list; reject untrusted destinations.
2. Generate and verify state and nonce values for the authorization round trip.
3. Keep tokens server-side with secure cookie attributes; never expose them to client scripts.
4. Enforce authorization checks on every authenticated route, not just login.
5. Log authentication failures without recording tokens or secrets.
