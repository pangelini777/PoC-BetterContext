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

## 2. External versions (provider-backed scripted run)

| surface | version |
|---|---|
| Bun | 1.4.0 |
| APM CLI | 0.9.4 (5c0976b) — **no `--root` flag** (adaptation documented in §3) |
| OpenCode | 1.18.31, plugin API 1.18.31 (inspected, spike in §4) |
| TypeSafe model | **jev-1.13.0** (live provider, 21 calls, inTok 42514 / outTok 8758, latency p50 514ms / p95 587ms) |
| Agent model | opencode/big-pickle (user-directed; smoke pair running) |
| Thresholds | `config/thresholds.json` (`thresholds-v1-untuned`, frozen, never tuned on gold) |
| Catalog | 15 rules + 14 skills, hash recorded per artifact |

## 3. APM isolation

`bun run evals/progressive-context/apm-isolation.ts` → **PASS**:
`apm compile --validate` exit 0 (15 primitives), read-only dry-run wrote no
files, live workspace contains no discoverable copies or body-hash matches.
Adaptation: the plan's `apm install --root <store>` does not exist in APM
0.9.4; the proof copies the package into an isolated `mkdtemp` store (same
property: package bytes outside every live workspace) and validates with the
real CLI. `apm compile` write mode is never run into a live workspace.

## 4. Context-transform spike verdict

`bun run evals/progressive-context/context-spike.ts` →
`NEGATIVE_FOR_OPENCODE_AUTHORITATIVE__EXPLICIT_HARNESS_AUTHORITATIVE`.
The installed OpenCode plugin API exposes `chat.message`, `chat.params`
(temperature/topP/topK only), experimental message/system transforms, and
tool hooks — but **no provider-request construction hook** with a
reconstruction guarantee. A sentinel injected via `chat.message` would persist
in history. The benchmark-owned `ExplicitHarness` (same catalog/router/
resolver/compiler, assembles each request, scrubs all historical overlay
## 6. Scripted four-arm results (PROVIDER-BACKED JEV — jev-1.13.0)

Artifact: `evals/progressive-context/results/scripted-2026-09-21T16-48-16-3404n2.json`
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

## 7. Live trials — SMOKE BLOCKED (model server down, runner hardened)

- Agent model: **local/qwen3** per user direction. Server `10.0.0.17:8080`
  verified working earlier (`PROBE_OK` + `--auto` tool-write turn in ~22s),
  now TCP closed (three `000` probes). Smoke runner (`bg_6`) wedged on a
  permission-blocked turn (pre-`--auto` code) and was cancelled; rerun blocked
  until the server is reachable.
- Runner is now hardened: real `tool_use/part.state` JSON parsing, `--auto`
  harness constant (identical across arms), event derivation from git diff +
  tool activity (not keyword-scanning), per-turn token capture, hash-pinned
  arm parity (task/base-commit/catalog/thresholds/model), next-request unload
  proofs across ALL subsequent requests, hidden executable verification
  injected post-run, and `classifyTrial` eligibility gates.
- Gate for 3 paired evidence trials: smoke must show provider-backed JEV
  telemetry + ≥1 materialization + ≥1 genuine dematerialization with
  next-request absence + hidden verification on both arms + provenance pass.

## 8. Reproduction

```bash
bun install
bun run check                                   # typecheck + 23 tests
bun run evals/progressive-context/apm-isolation.ts
bun run evals/progressive-context/context-spike.ts
bun run evals/progressive-context/run-scripted.ts --arms load_all,static_initial,progressive_jev,oracle_dynamic
bun run evals/progressive-context/validate-scripted.ts evals/progressive-context/results/<artifact>.json
```

## 9. Answers to the plan's evidence questions

- Installed but never materialized: iOS/ML distractors (all scenarios).
- Per-event add/retain/remove + reasons: in artifact `records[].{added,retained,removed,transitionReasons}` with JEV/dependency/lifetime/baseline/oracle reasons.
- Next-request absence proof: sentinel assertions per record + `test/sentinel.test.ts` on the authoritative harness.
- Precision/recall, stale/missing ratios: §6 table + per-event metrics in artifact.
- Dynamic tokens per arm: §6 table.
- progressive vs static_initial: §6 (provider-backed progressive wins on stale ratio, recall, skill accuracy).
- Live correctness: smoke running (§7).
- JEV overhead: 21 calls / 42514 in / 8758 out tokens across 13 progressive events; p50 514ms / p95 587ms per event (2 calls: rules+stage1, stage2).
- Trial eligibility: scripted progressive records all `provider_backed`; oracle kept separate; live gate per §7.
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
