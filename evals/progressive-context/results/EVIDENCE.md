# JEV × APM Progressive Context PoC — Evidence Report

> Status: PARTIAL EVIDENCE. Deterministic lifecycle, real dematerialization,
> context-health, and routing-plumbing proofs are VERIFIED. Provider-backed
> JEV routing and live paired trials are NOT RUN (no `TYPESAFE_API_KEY`, no
> live agent model in this environment). Nothing below aggregates fail-open
> or oracle results as provider-backed evidence.

## 1. Provenance and independence

- Repo: standalone `jev-apm-progressive-poc` (this directory). Git commits:
  `04dd426` (core), `e7135de` (eval layer).
- Provenance guard (`packages/progressive-context/src/provenance.ts`) rejects
  any resolved benchmark path containing `agentOpt` segments; enforced by
  every eval entrypoint and covered by `test/provenance.test.ts`.
- Contamination incident (recorded honestly): an early scripted run executed
  while a `.env` file copied from the sibling `agentOpt` checkout was present
  in this repo root. Bun auto-loads `.env`, so `TYPESAFE_API_KEY` was picked
  up from a sibling-sourced secret. That artifact is QUARANTINED at
  `evals/progressive-context/results/quarantined/CONTAMINATED-sibling-env-*`
  and excluded from all evidence. The copy was deleted (`rm .env`); current
  runs see `TYPESAFE_API_KEY=MISSING` and correctly use the fail-open path.
- No imports, symlinks, plugins, telemetry, workspaces, or results from
  `../agentOpt` are used. `grep -rn "agentOpt" packages/ evals/ test/` hits
  only the provenance guard and this report.

## 2. External versions (scripted evidence run)

| surface | version |
|---|---|
| Bun | 1.4.0 |
| APM CLI | 0.9.4 (5c0976b) — **no `--root` flag** (adaptation documented in §3) |
| OpenCode | 1.18.31, plugin API 1.18.31 (inspected, spike in §4) |
| TypeSafe model | NOT CONTACTED (no key); provider-plumbing test uses canned `jev-1.13.0-test` |
| Agent model | NOT RUN (upstream 403 `Model access is disabled` on `opencode/claude-haiku-4-5`) |
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
blocks, inserts exactly one current overlay) is therefore the AUTHORITATIVE
unload/context-health path. OpenCode remains a secondary demo
(`packages/opencode-adapter`, no selection logic).

Artifact: `evals/progressive-context/results/scripted-2026-09-21T16-34-01-8ncz3z.json`
(`providerBackend: fail_open(heuristic, TYPESAFE_API_KEY unset)`).
Validator: `bun run evals/progressive-context/validate-scripted.ts <artifact>`
→ 9/13 PASS; routing-accuracy gates FAIL under the heuristic, as expected
(heuristic ≠ JEV; failures are reported, not hidden):

| arm | P | R | critMiss | skillAcc | dynTok | staleTok | staleRatio | evidence |
|---|---|---|---|---|---|---|---|---|
| load_all | 0.169 | 0.846 | 0 | 0.000 | 79209 | 68659 | 0.867 | load_all |
| static_initial | 0.641 | 0.664 | 7 | 0.615 | 10344 | 4786 | 0.463 | static_initial |
| progressive_jev | 0.688 | 0.869 | 4 | 0.846 | 14166 | 5181 | 0.366 | **fail_open** |
| oracle_dynamic | 0.870 | 1.000 | 0 | 1.000 | 13435 | 2885 | 0.215 | oracle (upper bound) |

Lifecycle proof (checkout-progressive, progressive arm): **16 materialization
changes, 16 dematerialization changes** (≥3/≥2 required). Sentinel: **0
failures** across all records. Distractors (iOS/ML) never materialize.
Look-alikes: `readonly-db` → `postgres-readonly-query`, `stripe-webhook-bug`
→ `stripe-webhook-handler` both correct. `no-skill` correctly quiet.
Context health (fail-open): dynamic-token reduction vs load_all **0.82**
(≥0.50), stale-token reduction **0.93** (≥0.40), progressive stale ratio
beats static on checkout-progressive (0.386 < 0.564).
Honest gaps (heuristic only): recall 0.869 (< 0.90), precision 0.688
(< 0.75), 4 critical misses (phase-implied `secrets-management` without
surface keywords; tie-break retaining the incumbent skill on an ambiguous
test-plan event). These are documented fail-open limitations, NOT JEV
evidence, and were NOT tuned away (thresholds frozen).

## 7. Live trials — NOT RUN

- Smoke pair: BLOCKED. `opencode run --model opencode/claude-haiku-4-5`
  returns 403 `Model access is disabled`; alternate model probe hung and was
  cancelled. No live agent turns were executed, so per the plan no evidence
  trials were started (correct sequencing: 0 smoke → 0 evidence trials).
- Runner, identical-task prompt, arm-blinding, fresh-git workspaces, and the
  independent verifier (`evals/progressive-context/independent/`) are
  implemented and the verifier passes on the stub workspace in the expected
  failing-open way (stub scores 3/9 — proves the verifier discriminates).
- To run when credentials/model exist:
  `AGENT_MODEL=opencode/<model> TYPESAFE_API_KEY=<key> bun run evals/progressive-context/run-live.ts --trials 1 --arms load_all,progressive_jev --alternate-order --model "$AGENT_MODEL"`,
  then `--trials 3` only if the smoke pair shows provider-backed routing +
  sentinel unload proof.

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
- progressive vs static_initial: §6 (progressive wins on stale ratio, recall, skill accuracy in fail-open mode).
- Live correctness: NOT RUN (blocked, §7).
- JEV overhead: 0 live calls (no key); scripted provider usage shape proven by canned test (2 calls/event, usage persisted).
- Trial eligibility: no live trials; scripted progressive records are all `fail_open`, oracle kept separate.
- Provenance: §1 + guard + quarantine record.
