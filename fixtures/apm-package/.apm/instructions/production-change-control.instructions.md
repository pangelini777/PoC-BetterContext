---
description: "Production deployment and operational change controls: preflight checks, migrations, rollback, observability, and human confirmation."
applyTo: "deploy/**/*,.github/workflows/**/*,infra/**/*"
tags: [production, deployment]
---

# Production change control

Apply when preparing or changing production deployment behavior.

- Produce an explicit preflight checklist covering tests, required secrets/configuration, schema migration order, and external dependencies.
- The deployment path must have a rollback or forward-fix strategy. Call out irreversible migrations separately.
- Never embed automatic production credentials or bypass approval/confirmation merely to make a demo pass.
- Verify health/critical behavior after deployment and state what signal would trigger rollback.
- For changes involving payments, authentication, personal data, or webhooks, include a focused smoke check for that boundary.
- Deployment documentation must distinguish commands safe for local/test environments from commands that affect production.
