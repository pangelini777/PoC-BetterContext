---
description: "Incident-response requirements for Acme Checkout outages: severity levels, roles, communication cadence, mitigation-first discipline, and blameless follow-up."
applyTo: "runbooks/**/*,infra/**/*,docs/incidents/**/*"
tags: [incident, response, operations]
---

# Incident response

Apply when declaring, managing, or following up on a production incident.

1. Declare severity early using written definitions (for example SEV-1: checkout fully down; SEV-2: degraded payments for a subset of merchants such as `merchant_acme_demo_042`; SEV-3: minor degradation with workaround). When in doubt, declare one level higher and downgrade later.
2. Assign the three core roles immediately: incident commander (decides and coordinates), communications lead (status updates), and operations lead (drives mitigation). One person MUST NOT hold all three on a SEV-1 or SEV-2.
3. Mitigate first, diagnose second. Restore checkout service via rollback, traffic shift, or feature-flag kill before root-causing. A commander who lets diagnosis block mitigation for more than 30 minutes on a SEV-1 is failing the role.
4. Communicate on a fixed cadence: SEV-1 updates every 15 minutes, SEV-2 every 30 minutes, internally and to affected merchants. Each update states impact, mitigation in progress, and next update time. Silence is never acceptable during an active incident.
5. Keep a timestamped incident log: detection signal, severity changes, commands run, who ran them, and merchant impact notes. Reconstructing the timeline from chat scrollback after the fact is not acceptable.
6. Follow production change control for every mitigation action: state which environment a command affects, confirm rollback availability, and get a second pair of eyes on irreversible steps such as destructive data fixes.
7. Protect customer data during response: share redacted logs and truncated identifiers in incident channels, never raw card data, tokens, or full personal records. Debug access follows least privilege even mid-incident.
8. Declare incident end explicitly with a resolution summary: what broke, who was affected, what mitigated it, and current confidence. Lingering "probably fixed" incidents MUST be converted into monitored follow-ups with an owner.
9. Every SEV-1 and SEV-2 gets a blameless postmortem within five business days: timeline, contributing factors, action items with owners and due dates. Action items without owners are wishes, not follow-up.
10. Track error-budget impact in the postmortem: budget consumed, whether burn-rate alerts fired in time, and whether SLO definitions need revision in light of what happened.
