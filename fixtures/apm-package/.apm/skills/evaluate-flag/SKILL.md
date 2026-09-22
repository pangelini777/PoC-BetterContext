---
name: evaluate-flag
description: >-
  Evaluate Acme Checkout feature flags with deterministic bucketing, targeting rules, kill-switch defaults, and auditable exposure logs.
---

# Flag evaluator

Use when implementing or fixing server- or client-side feature-flag evaluation.

1. Resolve the flag definition first (for example `checkout_redesign` at ruleset `flags_v31`): default variant, targeting rules in priority order, and rollout percentage; reject evaluation when the ruleset version is missing or unparsable.
2. Build the evaluation context from trusted server-side attributes only: merchant id (for example `merch_44012`), plan tier, and region; never trust a client-supplied `is_internal` claim without server verification.
3. Apply targeting rules top-down and stop at the first match, recording the matched rule id (for example `rule_staff_only`) so support can explain why subject `cust_88312` saw variant `treatment`.
4. Bucket percentage rollouts deterministically: hash the stable subject key plus flag key (for example `cust_88312:checkout_redesign`) into `[0,100)` so the same subject always lands in the same bucket across requests and replicas.
5. Default to the safe control variant on every failure mode: missing context, evaluation error, or ruleset fetch timeout all serve `control` and increment a `flag.degraded` counter; a flag must never throw into the request path.
6. Enforce kill-switch semantics: a flag set to `killed` serves `control` to 100% of subjects within 30 seconds of the change, bypassing cached rulesets via a version-check header on the flag fetch path.
7. Keep evaluation local and fast: cache the ruleset in memory with a 15-second refresh, evaluate in under 1ms p99, and never make a network call per evaluation on the hot checkout path.
8. Log exposures once per subject per flag version (subject hash, flag key, variant, rule id) for experiment analysis; suppress repeat exposure events within the session to keep telemetry cardinality bounded.
9. Audit flag changes like code: every ruleset publish records author, diff, and reason, and percentage increases above 50% require a second approver before rollout continues.

Do not use this for A/B statistical analysis, pricing authorization, or secrets rotation.
