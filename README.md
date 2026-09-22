# jev-apm-progressive-poc

Standalone PoC: TypeSafe/JEV System One progressively materializes and
dematerializes APM rules/skills per the agent's task trajectory.
Experimentally independent from any sibling project (see `EXPERIMENT_CONTRACT.md`).

## Headline result (frozen held-out set)

On a fresh 10-probe held-out set over a 94-resource / ~46.7k-token APM
catalog (`probe-v4-heldout-frozen`, Spark agent model, provider-backed JEV),
isolated JEV matched load-all and native APM discovery at **10/10 retrieval,
1.0 rule recall and zero critical misses**, while materializing **~3.9k APM
tokens on average (~8% of load-all)**.

The JEV agent workspace contained no discoverable non-materialized APM rules
or skills: no `apm.yml`, no `.apm/`, no `.agents/rules/`, no `.agents/skills/`.
The full APM package lives in a controller-only directory outside the
workspace; only JEV-selected rule/skill bodies reach the agent prompt.
Contamination gates (workspace scan + native skill-tool + store-access checks)
are clean on all arms. Probe and evaluator definitions are embedded in the
artifact with hashes; grading uses the embedded definitions.

Primary artifact:
`evals/progressive-context/results/probe-2026-09-22T17-31-31-8wmokx.json`
(+ `.grades.json`).

| arm | retrieval | recall | misses | fidelity | avg ctx | tokens |
|---|---|---|---|---|---|---|
| load-all (46,736 flat) | 10/10 | 1.0 | 0 | — (never evicts) | 46,736 | 633k |
| native APM discovery | 10/10 | 1.0 | 0 | — (no mechanism) | traced* | 1.37M |
| JEV progressive (isolated) | 10/10 | 1.0 | 0 | 0.9997 | 3,906 | 257k |

Noul comprehension 0.6–0.95 on graded rules; distractors correctly dismissed.

\* Discovery context is measured, not runner-owned: files the agent opened
(tool-call tracing) plus per-probe input tokens. No overlay by design.

## Unload proof (what each layer shows)

- **v4 probe benchmark = clean routing/context-isolation evidence** with
  **behavioral** eviction fidelity (Choice-graded: answers don't rely on
  evicted rules). The v4 `jev_single` trial is deliberately ineligible for
  authoritative byte-proof unload — the single-session OpenCode plugin rewrites
  emitted messages but cannot observe provider-request bytes. This is expected
  and remains visible in the artifact eligibility.
- **ExplicitHarness / eligible live runs = byte-proof future-request
  dematerialization evidence**: `live-2026-09-21T21-11-07-fn5tlc.json`
  (progressive arm, 4/4 unload proofs pass, sentinel-zero, eligible).

## Historical benchmark development (tuning sets, not held-out)

v1/v2/v3 probe sets were used iteratively (naming fixes, lifetime tuning,
grader calibration) and earlier JEV runs allowed native APM discovery in the
workspace. Their 48/48 results are diagnostic, not the clean proof. Artifacts
are kept for auditability.

| run | load-all ret. / tok | discovery ret. / tok | JEV ret. / tok | JEV avg ctx |
|---|---|---|---|---|
| probe-2026-09-22T09-49-26 (pre-rename) | 47/48 / 3.41M | 11/48 / 3.25M | 18/48 / 2.76M | 5,101 |
| probe-2026-09-22T11-09-56 (renamed) | 48/48 / 3.60M | 48/48 / 3.67M | 48/48 / 2.72M | 5,228 |

The rename (58 skills noun→verb + kind tags + verbatim-id template) took JEV
18→48 and discovery 11→48: naming, not routing, was the bottleneck.

| run | retrieval | fidelity | avg ctx |
|---|---|---|---|
| probe-2026-09-22T12-39-24 (JEV lifetime tuning) | 47/48 | 0.96 | 3,901 |

Switching 30 phase-diagnostic rules `phase` → `action` lifetime took fidelity
0.67→0.96 with recall held.

| run | retrieval | files read | body tokens | avg input/probe |
|---|---|---|---|---|
| probe-2026-09-22T16-08-09 (discovery tracing) | 48/48 | 50 | 24,009 | 6,417 |

  Multi-session factory (fresh `opencode run` per probe):

  | run | arm | retrieval | avg ctx | tokens |
  |---|---|---|---|---|
  | probe-multi-2026-09-22T15-18 | load-all | 34/48 (24/26 content) | 46,736 flat | 2.73M |

  (A hybrid file-memory JEV variant was evaluated during development but its
  artifact was never committed; no quantitative hybrid claim is made here.
  The `--hybrid-memory` runner flag remains available for future runs.)
Single-session builds (fatty checkout task, verification x/11) — smoke only:

| run | model | load-all | discovery | JEV |
|---|---|---|---|---|
| single-2026-09-21T23-11 (fail_open) | qwen3 | 3/11 | 3/11 | 3/11 |
| single-2026-09-22T05-42 (fail_open) | qwen3 | 6/11 | 4/11 | 2/11 |
| single-2026-09-22T08-06 (provider) | qwen3 | 6/11 | 2/11 | 4/11 |
| single-2026-09-22T09-22 (provider) | Spark | 5/11 | 5/11 | 5/11 |

Live paired multi-turn, byte-proof harness (qwen3):

| run | load-all ver. | progressive ver. | progressive unload |
|---|---|---|---|
| live-2026-09-21T19-38 | 3/11 | 3/11 | ineligible (no demat.) |
| live-2026-09-21T19-50 | 6/11 | 5/11 | eligible, 1 demat. |
| live-2026-09-21T21-11 | 5/11 | 7/11 | eligible, 4/4 proofs pass |

## Reproduction

```bash
bun install
bun run check                                   # typecheck + tests (42 pass)
bun run evals/progressive-context/apm-isolation.ts
bun run evals/progressive-context/context-spike.ts
bun run evals/progressive-context/run-scripted.ts --arms=load_all,static_initial,progressive_jev,oracle_dynamic
bun run evals/progressive-context/validate-scripted.ts evals/progressive-context/results/<artifact>.json
# Frozen training held-out v2 (run ONCE already — rerunning is NOT held out):
bun run evals/progressive-context/run-scripted.ts --arms=load_all,static_initial,progressive_jev,oracle_dynamic --scenarios=fixtures/scenarios-heldout-v2 --out=evals/progressive-context/results/heldout-v2-frozen.json
```

Held-out probe comparison (requires `TYPESAFE_API_KEY` + APM 0.31 at
`/home/linuxbrew/.linuxbrew/bin/apm`):

```bash
source .env
bun run evals/progressive-context/run-probe.ts --arms=load_all_single,apm_discovery,jev_single --model=opencode-go/muse-spark-1.3-contributor --probe-set=v4
bun run evals/progressive-context/probe/grade-run.ts evals/progressive-context/results/<artifact>.json
```

Single-session builds and multi-session factory runs:

```bash
SINGLE_RUN_TIMEOUT_MS=1200000 bun run evals/progressive-context/run-single.ts --arms=load_all_single,apm_discovery,jev_single --model=opencode-go/muse-spark-1.3-contributor
PROBE_MULTI_TIMEOUT_MS=1800000 bun run evals/progressive-context/run-probe-multi.ts --arms=jev_single --model=opencode-go/muse-spark-1.3-contributor --probe-set=v3 [--hybrid-memory]
```

## Runs dashboard

Start the local read-only dashboard:

```bash
bun run dashboard
```

Open `http://127.0.0.1:4317`. The page lists scripted, live, single-session,
probe, and probe-multi runs (completed + live sidecars) and refreshes every
two seconds. Probe cards show retrieval counts, Noul grades file, eviction
fidelity, self-report accuracy, rule recall, critical misses, and
context/token metrics. Text selection, focus, and scroll survive refresh
cycles. Columns render only when data is present.

## Evidence

See `evals/progressive-context/results/EVIDENCE.md` (scripted + isolated probe
eval) and `evals/progressive-context/results/PROBE-SCALE-REPORT.md`
(development history). Current benchmark setup: 94-resource catalog
(36 rules + 58 skills, ~46.7k tokens), APM 0.31 (brew, pinned binary),
OpenCode 1.18.x, Spark agent model, provider-backed JEV.

## Scenario sets

- `fixtures/scenarios/` — original 7 (training/diagnostic; inspected during
  failure analysis, NOT unbiased validation).
- `fixtures/scenarios-training/` — copy of the original 7 for tuning work.
- `fixtures/scenarios-heldout-v2/` — 11 scripted scenarios with fresh wording,
  run once; rerunning is NOT held out anymore.
- `fixtures/probe-questions.json`, `-v2.json`, `-v3.json` — TUNING probe sets
  (used iteratively for naming, lifetimes, grader calibration — not held-out).
- `fixtures/probe-questions-v4-heldout.json` — FROZEN HELD-OUT probe set
  (`probe-v4-heldout-frozen`): 10 probes over fresh phases, never tuned on.

## Key adaptations (honest deviations from the plan)

- APM 0.31 (brew) deploys skills to `.agents/skills/` and rules to
  `.agents/rules/` (antigravity target); the stale 0.9.4 binary at
  `/usr/local/bin/apm` is never used (harness pins the brew binary).
  `apm install --target opencode` alone deploys skills only.
- JEV agent workspaces contain no APM discovery surface (controller-only
  store); contamination gates enforce this per probe. `apm_discovery` keeps
  the full in-workspace install as the native baseline; `load_all` injects
  all resources directly.
- OpenCode V1 (1.18.x) has no provider-request construction hook
  (context-spike: NEGATIVE for authoritative unload). Byte-proof unload lives
  in the benchmark-owned ExplicitHarness and eligible live runs; the
  single-session plugin provides behavioral overlay policy only.
- V1 path plugins must default-export `{ id, server }` (not a bare function)
  and live under `.opencode/opencode.json` (singular `plugin` key).
- 58 skills renamed noun→verb phrases so kind is readable from name shape;
  overlay entries carry `[RULE]/[SKILL]` kind tags; probe template requires
  verbatim `rule./skill.` ids. This fixed the dominant failure mode
  (skill-instead-of-rule endorsement, 6/20 probes) without touching routing.
- Webhook probe no longer demands verbatim "400" (the skill text never states
  it); accepts reject/verify language. Webhook `expectedIds` trimmed to the
  asked-about rule (secrets dependency stays in the sidecar, not the probe).
- Thresholds in `config/thresholds.json` are frozen (`thresholds-v1-untuned`);
  routing improvements are architectural (dependency metadata, `shortlistMin`
  enforcement, fit-decides selection, dependency-hint questions, lifetime
  tuning), never threshold retuning on held-out gold.
