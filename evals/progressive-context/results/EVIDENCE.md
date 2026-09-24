# JEV × APM Progressive Context PoC — Evidence Report

> Status: ISOLATED PROBE EVAL AT SCALE (94 resources / 46.7k tokens).
> v1/v2/v3 probe sets are TUNING sets (used iteratively — not held-out).
> probe-v4-heldout is the frozen held-out set: 10/10 retrieval on all 3 arms,
> JEV isolated (contamination-clean) at 3,906 avg ctx vs 46,736 flat.
> Artifacts embed probeSet + evaluator definitions with hashes; grading uses
> embedded definitions (fixture fallback only for legacy artifacts).

## 1. Provenance and independence

- Repo: standalone `jev-apm-progressive-poc` (this directory). Git commits:
  `04dd426` (core), `e7135de` (eval layer).
- Provenance guard (`packages/progressive-context/src/provenance.ts`) rejects
  any resolved benchmark path containing `agentOpt` segments; enforced by
- Contamination incident (recorded honestly): an early scripted run executed
  while a `.env` file copied from the sibling `agentOpt` checkout was present
  in this repo root. Bun auto-loads `.env`, so `TYPESAFE_API_KEY` was picked
  up from a sibling-sourced secret. That artifact is QUARANTINED at
  `evals/progressive-context/results/quarantined/CONTAMINATED-sibling-env-*`
  and excluded from all evidence. UPDATE: the user has since confirmed the
  `.env` (including `TYPESAFE_API_KEY`) is a legitimate shared credential for
  this PoC. The stale quarantine stays excluded (it was produced before the
  fix and under unclear provenance); all provider-backed evidence below comes
  from fresh runs with the confirmed key. The sibling JEV_* server vars in
  `.env` are never consumed by this repo (verified: no source references).
- No imports, symlinks, plugins, telemetry, workspaces, or results from
  `../agentOpt` are used. `grep -rn "agentOpt" packages/ evals/ test/` hits
  only the provenance guard and this report.

  ## 2. External versions (v4 held-out run)

  | surface | version |
  |---|---|
  | Bun | 1.4.0 |
  | APM CLI | 0.31.0 (brew, pinned binary `/home/linuxbrew/.linuxbrew/bin/apm`) |
  | OpenCode | 1.18.x, plugin API V1 (inspected, spike in §4) |
  | TypeSafe model | jev-latest (live provider) |
  | Agent model | opencode-go/muse-spark-1.3-contributor |
  | Thresholds | `config/thresholds.json` (`thresholds-v1-untuned`, frozen, never tuned on gold) |
  | Catalog | 36 rules + 58 skills = 94 resources, ~46,736 tokens, hash recorded per artifact |

  ## 3. APM isolation (historical scripted proof + current controller store)

  Historical: `bun run evals/progressive-context/apm-isolation.ts` → **PASS**
  on the 29-resource catalog (15 primitives validated, read-only dry-run).
  Current: JEV probe workspaces contain no `apm.yml`/`.apm/`/`.agents/rules/`/
  `.agents/skills/` — the full 94-resource package lives in a controller-only
  directory outside the agent workspace, enforced per probe by contamination
  gates (clean on the v4 run, all arms).
## 4. Context-transform spike verdict

`bun run evals/progressive-context/context-spike.ts` →
`NEGATIVE_FOR_OPENCODE_AUTHORITATIVE__EXPLICIT_HARNESS_AUTHORITATIVE`.
The installed OpenCode plugin API exposes `chat.message`, `chat.params`
(temperature/topP/topK only), experimental message/system transforms, and
tool hooks — but **no provider-request construction hook** with a
reconstruction guarantee. A sentinel injected via `chat.message` would persist
in history. The benchmark-owned `ExplicitHarness` (same catalog/router/
resolver/compiler, assembles each request, scrubs all historical overlay
  ## 6. Scripted four-arm results (historical, 29-resource catalog)

  Historical provider-backed scripted evidence (jev-1.13.0) on the original
  29-resource catalog. Kept for audit; superseded by the v4 probe comparison
  (§10) as the headline result.
(`providerBackend: provider_backed`, all progressive records `provider_backed`, model `jev-1.13.0`).
Validator: `bun run evals/progressive-context/validate-scripted.ts <artifact>`
→ 10/13 PASS. Three routing-accuracy gates MISS on held-out gold; reported honestly, thresholds NOT retuned:

| arm | P | R | critMiss | skillAcc | dynTok | staleTok | staleRatio | evidence |
|---|---|---|---|---|---|---|---|---|
| load_all | 0.169 | 0.846 | 0 | 0.000 | 79209 | 68659 | 0.867 | load_all |
| static_initial | 0.558 | 0.558 | 7 | 0.385 | 7552 | 4442 | 0.588 | static_initial |
| progressive_jev | 0.763 | 0.888 | 3 | 0.615 | 13688 | 5269 | 0.385 | **provider_backed** |
| oracle_dynamic | 0.870 | 1.000 | 0 | 1.000 | 13435 | 2885 | 0.215 | oracle (upper bound) |

Lifecycle proof (checkout-progressive, progressive arm): **15 materialization
changes, 15 dematerialization changes** (≥3/≥2 required). Sentinel: **0
failures** across all records. Distractors (iOS/ML) never materialize.
`no-skill` correctly quiet. Context health: dynamic-token reduction vs
load_all **0.83** (≥0.50), stale-token reduction **0.92** (≥0.40), progressive
stale ratio beats static on checkout-progressive (0.427 < 0.833).
Honest provider-backed gaps (frozen untuned thresholds): recall 0.888
(< 0.90, gap 0.012), precision 0.763 (PASS), 3 critical misses — all
`rule.secrets-management` at p=0.47 (oauth, checkout-api) where the event text
implies Stripe/auth context without surface secret keywords; 5 skill misses —
3 gated-out single-label scenarios where JEV ranked the right skill at p=1.0
but the gate (< 0.55) rejected it (copy-only 0.28, oauth 0.52, readonly 0.47),
plus checkout-api (nextjs-api-route fit 0.70 beats stripe-checkout-session fit
0.50 on an observation text leading with "Next.js route handlers") and webhook
seq3 (Choice winner stripe-webhook-handler 0.76 but its fit 0.54 < migration
fit 0.78, so the winner failed its own fit gate and the resolver retained the
incumbent). Prior fail-open artifact
(`scripted-2026-09-21T16-34-01-8ncz3z.json`) is superseded, retained for audit.

  ## 7. Live trials (historical qwen3 runs + byte-proof unload reference)

  Three paired live runs completed on local/qwen3 (provider-backed JEV):
  `live-2026-09-21T19-38-39` (3/11 both arms), `live-2026-09-21T19-50-27`
  (6/11 load-all, 5/11 progressive), `live-2026-09-21T21-11-07` (5/11 load-all,
  7/11 progressive, 4/4 unload proofs pass, eligible). The final run is the
  byte-proof future-request dematerialization reference: ExplicitHarness +
  sentinel-zero + eligible classification. Later work moved to Spark probe
  evals; these runs stand as historical mechanism evidence, not the headline.

  ## 7b. Build-slice engineering journeys (2026-09-22/23)

  Probes check whether the agent cites the relevant rules. Builds check
  whether it completes working features while following them. Each run is a
  paired head-to-head: same fixture, model, task prompt, and turn budget.
  Only the APM context policy differs, and the agent is not told its arm.
  Verifiers are evaluator-only and hidden from JEV and the agent: the refund
  slice has 5 checks (1 rule), the 2-phase journey 8 checks (3 rules: card
  data, sensitive-data logging, secrets), and the 4-phase journey 12 checks
  (4 rules, adding webhook signature handling). A perfect score means the
  feature works, the rule checks pass, and the agent's own `bun test`
  converges.

  2-phase journey (refunds → notifications, 20 turns):

  | run | model | order | routing | JEV | discovery |
  |---|---|---|---|---|---|
  | build-2026-09-23T09-49 | opencode-go/muse-spark-1.3-contributor | JEV-first | seed-only | **8/8**, 1.62M | 7/8, 1.35M |
  | build-2026-09-23T10-19/10-43 | openrouter/meta/muse-spark-1.3-contributor | discovery-first + retry | seed-only | 6/8 | 5/8 |
  | build-2026-09-23T11-23 | openrouter/openai/gpt-6-luna-pro | JEV-first | seed-only | **8/8**, 1.81M | 4/8, 2.28M, no files changed |
  | build-2026-09-23T16-01 | openrouter/openai/gpt-6-luna-pro | JEV-only | per-turn, no fuse | 4/8 (set grew 7→11, Phase 1 unbuilt) | — |
  | build-2026-09-23T16-48 | openrouter/openai/gpt-6-luna-pro | JEV-only | per-turn + fuse | **8/8** in 17 turns, 2.70M | — |
  | build-2026-09-23T17-25 | openrouter/openai/gpt-6-luna-pro | discovery-first | per-turn + fuse | **8/8**, 2.29M | **8/8**, 3.10M |
  | build-2026-09-23T19-33 | openrouter/meta/muse-spark-1.3-contributor | discovery-first | per-turn + fuse | **8/8**, 2.08M | 6/8, 1.44M |

  Across the five paired trials the JEV arm scored equal or higher each time
  (margins +1, +1, +4, 0, +2). In the 8/8-vs-8/8 run both arms passed all
  checks; JEV used 2.29M session tokens versus 3.10M for discovery, about
  26% fewer in that run. The per-turn run without the fuse (4/8) is kept as
  the ablation: conversational activity activated rules without matching
  implementation, the set grew, and the agent did not finish Phase 1.

  Mechanism changes during this series, each responding to an observed
  failure: build-mode gate with sticky lifetimes (overlay churn), overlay
  stability with continuity note (re-planning on identical sets), JEV
  test-gate Noul (test time spent mid-phase instead of at boundaries),
  `lib/`-first verifier paths (the verifier read a stub the agent was told
  not to touch), per-turn routing (seed-only staleness), probation fuse
  (unconfirmed activations accumulating). Thresholds were not tuned on
  held-out gold.

  4-phase journey (30 turns, 12 checks): seed-only luna-pro reached 9/12
  (Phases 1–2 passed, privacy work never started); per-turn luna-pro also
  reached 9/12 with genuine routing (6→14 resources, 3 dematerializations,
  release fixed, sms-fallback lost to mid-phase churn). Open work:
  phase-commitment, freezing a phase's set once its tests go green, using
  the agent's own tests as the signal (no gold labels).

  Caveats: per-turn routing can destabilize as well as advance (sms-fallback
  regressed on the 4-phase per-turn run); single-session plugin scrubs are
  behavioral only (`systemScrubbed` 0 across 182 invocations — fresh
  processes carry history outside the hooks' view), so byte-proof unload
  stays with ExplicitHarness and the sentinel test. Run
  `build-2026-09-23T13-55-38` died of tmpfs ENOSPC (truncated decisions file,
  empty logs) and is excluded, not regraded.

  ## 8. Reproduction

  ```bash
  bun install
  bun run check                                   # typecheck + 43 tests
  bun run evals/progressive-context/apm-isolation.ts
  bun run evals/progressive-context/context-spike.ts
  bun run evals/progressive-context/run-scripted.ts --arms load_all,static_initial,progressive_jev,oracle_dynamic
  bun run evals/progressive-context/validate-scripted.ts evals/progressive-context/results/<artifact>.json
  source .env
  bun run evals/progressive-context/run-probe.ts --arms=load_all_single,apm_discovery,jev_single --model=opencode-go/muse-spark-1.3-contributor --probe-set=v4
  bun run evals/progressive-context/probe/grade-run.ts evals/progressive-context/results/<artifact>.json

  ## 9. Answers to the plan's evidence questions

  - Installed but never materialized: iOS/ML/Android distractors (all sets).
  - Per-event add/retain/remove + reasons: scripted artifact
    `records[].{added,retained,removed,transitionReasons}`; probe artifacts
    carry `materializedIds`/`evictedIds` per probe plus `contamination` gates.
  - Next-request absence proof: sentinel assertions per record +
    `test/sentinel.test.ts` on the authoritative harness + eligible live run
    `live-2026-09-21T21-11-07` (4/4 unload proofs). v4 single-session plugin
    provides behavioral fidelity only (0.9997), never byte-proof — expected.
  - Precision/recall, stale/missing ratios: §6 table (scripted, historical) +
    v4 grades (recall 1.0, 0 misses, all arms) in §10.
  - Dynamic tokens per arm: §6 table + v4 table in §10.
  - progressive vs static_initial: §6 (provider-backed progressive wins on stale ratio, recall, skill accuracy).
  - Live correctness: historical qwen3 runs above; headline correctness is the
    v4 probe comparison (§10).
  - JEV overhead: 21 calls / 42514 in / 8758 out tokens across 13 progressive
    events (scripted); probe grading usage recorded per grades file.
  - Trial eligibility: scripted progressive records all `provider_backed`;
    oracle kept separate; probe trials carry `contamination` + eligibility.
  - Provenance: §1 + guard + quarantine record.

## 10. Isolated probe eval (v4 held-out, 2026-09-22)

Artifact `probe-2026-09-22T17-31-31-8wmokx.json` (+ `.grades.json`), Spark,
provider-backed JEV, 94-resource catalog. JEV workspaces contain NO apm.yml,
.apm/, .agents/rules/, or .agents/skills/ (controller-only APM store);
contamination gates (workspace scan + skill-tool + store-access) clean on all
arms. Artifacts embed probeSet + evaluator v4 with sha16 hashes.

| arm | retrieval | recall | misses | fidelity | avg ctx | tokens |
|---|---|---|---|---|---|---|
| load_all | 10/10 | 1.0 | 0 | — | 46,736 | 633k |
| apm_discovery | 10/10 | 1.0 | 0 | — | traced | 1.37M |
| jev (isolated) | 10/10 | 1.0 | 0 | 0.9997 | 3,906 | 257k |

Key proof: JEV matches both baselines exactly on unseen probes while
physically unable to access non-materialized resources, at 8% of the context.
