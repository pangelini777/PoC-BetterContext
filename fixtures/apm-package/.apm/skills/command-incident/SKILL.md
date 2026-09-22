---
name: command-incident
description: >-
  Run an Acme Checkout production incident with severity triage, role assignment, timeboxed mitigation, comms cadence, and blameless follow-up.
---

# Incident commander

Use when leading or tooling the response to a live Acme Checkout production incident.

1. Declare the incident explicitly with a severity and a commander: for example `INC-2041` severity `sev2` (checkout errors above 2% for 5 minutes), commander `oncall_chen`, started timestamp, and a dedicated channel `#inc-2041`; work stops being ad-hoc the moment the declaration lands.
2. Assign the minimum role set within 10 minutes: commander, responder driving mitigation, and communicator owning status updates; record names on the ticket so nobody wonders who decides the next action.
3. Timebox diagnosis before mitigation: 15 minutes of log and dashboard triage (error codes, deploy correlation with `bld_2026_09_22_04`, provider status), then mitigate first (rollback, traffic shift, feature-flag kill) and root-cause after customers recover.
4. Hold a fixed comms cadence: internal update every 15 minutes, status-page update every 30 minutes for customer-visible impact, each with current impact, mitigation in progress, and next update time; silence breeds duplicate escalations.
5. Track every mitigation as a reversible action with timestamp and owner: rollback to `bld_2026_09_21_09`, disable flag `checkout_redesign`, drain region `us-east-1b`; never stack two mitigations without noting which one moved the metric.
6. Declare recovery with evidence, not optimism: error rate back under 0.5% for 20 consecutive minutes on the same dashboard that paged, plus one successful synthetic checkout for order `ord_probe_001`; then close the incident channel to new work.
7. Schedule the blameless review within 3 business days with the timeline, contributing factors, and action items each carrying an owner and due date; the review asks what allowed the failure, never who caused it.
8. Preserve the evidence bundle: paged alert snapshot, metric screenshots, deploy diff, mitigation log, and comms archive attached to `INC-2041` before the channel auto-archives at 30 days.
9. Log only incident ids, metric aggregates, and action records; never log customer personal data, card-adjacent fields, or full order payloads in the incident timeline.

Do not use this for planned maintenance windows, security-tabletop exercises without live impact, or post-deploy SLO reporting.
