---
description: "SLO and error-budget policy for Acme Checkout: defining objectives, burn-rate alerting, budget-gated launches, and freeze discipline."
applyTo: "observability/**/*,src/**/*,infra/**/*"
tags: [slo, reliability]
---

# SLOs and error budgets

Apply when defining service-level objectives, spending error budget, or gating launches on reliability.

1. Every user-facing path (checkout completion, payment authorization, webhook delivery) needs an SLO stated as objective, window, and measurement source, for example: 99.9% of Acme Checkout authorizations succeed over a 28-day rolling window as measured by the provider callback log.
2. Error budget is `100% minus SLO` over the window. Budget policy MUST be written down: what fraction pauses launches, what fraction freezes non-urgent deploys, and who can grant an exception.
3. Alert on burn rate, not on raw error counts: a fast-burn alert (for example 14x budget consumption over 1 hour) pages; a slow-burn alert (for example 2x over 6 hours) tickets. Tune thresholds from past incidents, not from round numbers.
4. Budget-exhausted services freeze feature launches until budget recovers or the SLO is explicitly renegotiated with stakeholders. Shipping into a blown budget without a written exception violates this rule.
5. Distinguish user-caused failures (card declined, invalid address) from system failures (timeouts, 5xx, dropped webhooks) in the burn calculation; only system failures consume budget.
6. Dashboards MUST show budget remaining, burn rate, and window on one panel. An SLO without a visible budget graph is aspirational, not operational.
7. Review SLOs quarterly: tighten objectives the service beats comfortably, loosen or re-scope ones that burn constantly despite healthy user experience, and retire objectives nobody consults during incidents.
8. Load-test and capacity changes reference the SLO: state the expected headroom (for example "handles 3x holiday peak within p99 800ms") rather than asserting vague readiness.
9. Never game the budget by excluding inconvenient endpoints, reclassifying outages as maintenance after the fact, or shrinking the window to hide a bad week.
10. Incident postmortems record budget impact explicitly: budget consumed, whether the burn alert fired in time, and whether the SLO definition itself needs revision.
