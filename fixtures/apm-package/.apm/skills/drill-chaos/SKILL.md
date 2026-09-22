---
name: drill-chaos
description: >-
  Run an Acme Checkout chaos drill with blast-radius limits, abort conditions, steady-state checks, and rollback readiness.
---

# Chaos driller

Use when game-day testing Acme Checkout resilience against dependency or infrastructure faults.

1. Write the hypothesis first: steady state plus expected degradation (for example `killing one checkout worker keeps p95 under 800ms with zero duplicate charges`); drills without a falsifiable hypothesis are rejected.
2. Bound the blast radius in writing: one staging namespace (for example `checkout-staging`), at most 5% of synthetic traffic, one fault at a time, business-hours only with the owning engineer reachable; production faults need explicit written approval.
3. Inject one fault per run from the allow-list: pod kill, 300ms latency on the warehouse mock, 5% error rate on the email double, or DNS blackhole of the analytics endpoint; never fault the payment provider path, the ledger database, or DNS for the checkout domain itself.
4. Guard with automatic abort conditions: halt injection when success rate drops below 98%, p95 exceeds 3x baseline, or any duplicate-charge detector fires; the abort path must restore the fault-free state within 60 seconds without manual steps.
5. Measure steady-state probes, not vibes: checkout success rate, capture exactly-once count for order `ord_77120`-class fixtures, queue depth on `checkout_q`, and time-to-recovery after the fault clears; record pre-, during-, and post-fault windows.
6. Keep rollback armed before injecting: pinned prior deploy, database forward-compatible (no destructive DDL in flight), and a one-command traffic shift back to the healthy pool; verify the rollback command dry-runs clean before the drill starts.
7. Debrief with a one-page record: hypothesis, fault, blast radius, probe graphs summarized as numbers, abort fired or not, and the single hardening action filed as a ticket; drills that find nothing still file the evidence.
8. Log only drill ids, fault names, aggregate probe numbers, and ticket ids; never log customer data, provider secrets, or full request payloads from drill traffic.

Do not use this for load benchmarking, penetration testing, or unannounced production fault injection.
