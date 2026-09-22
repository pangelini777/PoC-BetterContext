# Final analysis — hardened benchmark (conservative, skeptical-reviewer grade)

## What is actually proven

1. **Lifecycle correctness** (unit-tested): hysteresis activate/retain/unload
   streaks, critical lower threshold, transitive dependency closure, skill
   supersede, task-lifetime stickiness. 41 tests green.
2. **Real dematerialization**: sentinel test + per-record assertions + live
   `unloadProofs` (absence verified across ALL subsequent requests, not just
   the next one). Zero sentinel failures on every scripted artifact.
3. **Context health** (provider-backed, both sets): training dyn −0.82 /
   stale −0.91; held-out-v2 dyn −0.82 / stale −0.91 vs load_all; progressive
   stale ratio beats static_initial on both multi-phase trajectories.
4. **Routing plumbing**: strict System One validation; 21 provider calls per
   13-event training run persisted with model/usage/latency (jev-1.13.0,
   p50 514ms).
5. **Look-alikes mostly resolve**: webhook-vs-checkout → handler on both
   sets; migration-vs-readonly → migration; readonly-v2 FAILS (gated out);
   checkout-vs-generic → generic API skill (documented below).

## What failed (held-out-v2, frozen `d7d044863a5319c7`, single run)

- Recall 0.781 (< 0.90), precision 0.605 (< 0.75), 4 critical misses.
- Gating is the dominant failure: 3 single-label scenarios rank the right
  skill at Choice p=1.0 but the gate (0.28–0.52 < 0.55) rejects it
  (copy-only, oauth, readonly). The gate Nouls systematically under-read
  "acting on the repo" for read-only/investigative and copy tasks.
- `shortlistMin=0.3` is now enforced (was dead config) but did not cause
  these misses; the gate did.
- Dependency-hint questions + new `dependsOn` edges (payments/webhook/auth →
  secrets) fixed the training secrets misses but held-out still misses 4
  criticals (privacy on docs-only, logging on migration, payments+webhook
  mass split on webhook-vs-checkout and observation-trigger).
- Skill accuracy 0.789 on held-out (up from 0.615 training pre-fix) but below
  any publishable bar.

## Context savings (held-out-v2, provider-backed)

- Dynamic APM tokens: 21,295 vs 115,767 load_all (−82%).
- Stale tokens: 8,830 vs 100,478 (−91%). Oracle bound: 4,272.
- The savings are real and large; the quality gap is in *which* resources,
  not how many.

## Correctness comparison

- Scripted: oracle P 0.849 / R 1.000 bounds the task; progressive trails on
  both sets. No live correctness data (smoke blocked).
- Hidden executable verifier (9 static + 3 `bun test` suites, injected
  post-run, removed after) discriminates: stub workspace fails as expected.

## JEV overhead

- Training: 21 calls / 42,514 in / 8,758 out tokens per 13 progressive
  events (~2 calls/event). Held-out similar scale. Per-event p50 514ms /
  p95 587ms — negligible next to agent turn latency (10–20s).

## Limitations

- Small N (7 training + 11 held-out events ≈ 31 routing decisions); no
  significance claims.
- Synthetic rules/domain; single JEV model version (1.13.0); single
  thresholds snapshot; JEV prompt changes move masses (stochastic).
- APM claim is consumption + validation + workspace isolation, NOT an
  isolated `apm install` (CLI lacks `--root`; product-integration gap).
- Unload = future-request omission, not model forgetting.
- Live evidence: zero paired trials (model server down). All live
  infrastructure is implemented and tested except the model itself.

## Exact reproduction

```bash
bun install
bun run check
bun run evals/progressive-context/apm-isolation.ts
bun run evals/progressive-context/context-spike.ts
bun run evals/progressive-context/run-scripted.ts --arms=load_all,static_initial,progressive_jev,oracle_dynamic
bun run evals/progressive-context/validate-scripted.ts evals/progressive-context/results/<artifact>.json
# Held-out (already run once — rerunning is NOT held out anymore):
bun run evals/progressive-context/run-live.ts --trials=1 --arms=load_all,progressive_jev --alternate-order --model=local/qwen3
```

## Verdict for a skeptic

Superseded 2026-09-22 by the isolated probe eval: on the frozen v4 held-out
set (10 probes, never tuned on), all 3 arms reach 10/10 retrieval, recall 1.0,
0 critical misses, with JEV isolated (contamination-clean) at 3,906 avg ctx
vs 46,736 flat and fidelity 0.9997. The routing-quality bar the old verdict
demanded is now met on unseen probes; the remaining gap is cold-start
multi-session quality (23/48 vs 48/48 single) and fatty-build throughput,
both measured honestly in PROBE-SCALE-REPORT.md.
