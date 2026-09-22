---
name: prepare-deploy-checklist
description: >-
  Prepare a production deployment checklist covering configuration, secrets, migrations, smoke checks, monitoring, rollback, and irreversible changes.
---

# Production deploy checklist

Use when preparing (not executing) a production release.

1. List required secrets and configuration with rotation and presence checks.
2. Order schema migrations before code rollout; note rollback or forward-fix path.
3. Define smoke checks that prove the release works in production.
4. Confirm monitoring, alerting, and on-call coverage for the change window.
5. Require explicit human confirmation; never deploy autonomously.
