# Gold routing scenarios

These files are the evaluation oracle, not instructions shown to JEV. The router must only receive each event's visible state plus the resource catalog. The benchmark evaluator compares the runtime's active/materialized resources with `gold_rules` and `gold_skill` after the fact.

`checkout-progressive.json` is the primary lifecycle proof. It should demonstrate at least three loads and two unloads/dematerializations, including look-alike skill switches (`stripe-checkout-session` → `postgres-schema-migration` → `stripe-webhook-handler`).

Build-slice verifiers are a separate oracle family (not scenario gold):
`independent/verify-refund.ts` (5 checks, 1 rule), `verify-journey2.ts`
(8 checks, 3 rules), `verify-journey.ts` (12 checks, 4 rules). Same
discipline — evaluator-only, never shown to JEV or the agent — applied to
shipped code instead of cited ids. Counts and results: README §live
engineering exercise, EVIDENCE §7b.
