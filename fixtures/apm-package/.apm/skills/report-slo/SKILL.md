---
name: report-slo
description: >-
  Report Acme Checkout service SLOs with burn-rate alerts, error-budget accounting, windowed compliance math, and executive-safe summaries.
---

# SLO reporter

Use when implementing or publishing availability and latency SLO reports for checkout services.

1. Define each Acme Checkout SLO explicitly before reporting: service `checkout-api`, objective (for example 99.9% successful checkouts over a 30-day rolling window), and the exact SLI query (`good_events / valid_events` excluding synthetic probes and `test_merchant_999` traffic).
2. Compute compliance over rolling windows, not calendar months: report the trailing 30-day and 7-day burn side by side so a bad week cannot hide behind three good ones, and freeze the window boundaries in the report header.
3. Track the error budget in minutes (for example 43.2 minutes per 30 days at 99.9%) and subtract consumed budget per incident; display remaining budget prominently and block risky deploys when fewer than 10 minutes remain.
4. Alert on burn rate, not on raw errors: page when the 1-hour burn exceeds 14x budget consumption, ticket when the 6-hour burn exceeds 6x, and link each alert to the contributing incident ids so responders skip triage arithmetic.
5. Separate SLI classes honestly: availability (non-5xx responses), latency (p99 under 450ms for `POST /checkout`), and correctness (no `payment_double_charge`); a green availability line never masks a breached latency objective in the summary.
6. Annotate every budget dip with its cause: deploy id (for example `bld_2026_09_22_04`), incident ticket, or provider outage, so the report reads as a narrative rather than an unexplained red segment.
7. Publish an executive-safe summary alongside the engineering detail: one sentence per SLO (`Checkout availability 99.94%, budget 18.1 min remaining`), trend arrow versus last period, and the top budget consumer with its remediation owner.
8. Version the SLI queries (`sli_checkout_v5`) and keep the previous definition queryable for one quarter, so definition changes never rewrite history silently; note the version and effective date on every report.
9. Log only aggregate SLI values, budget minutes, and window boundaries; never log customer identifiers or per-order outcomes alongside SLO telemetry.

Do not use this for canary-stage promotion decisions, realtime paging content, or marketing uptime claims.
