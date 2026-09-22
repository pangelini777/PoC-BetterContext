# jev-apm-progressive-poc

Standalone PoC: TypeSafe/JEV System One progressively materializes and
dematerializes APM rules/skills per the agent's task trajectory.
Experimentally independent from any sibling project (see `EXPERIMENT_CONTRACT.md`).

## Results (2026-09-22, Spark, 94-resource / 46.7k-token catalog)

Probe-question eval (26 content + 22 recall probes/arm, provider-backed JEV,
`probe-v1-frozen`+`v2`+`v3`):

| arm | retrieval | recall | crit. misses | fidelity | avg ctx | tokens |
|---|---|---|---|---|---|---|
| load-all (46.7k flat) | 48/48 | 1.0 | 0 | — (never evicts) | 46,752 | ~3.4M |
| native APM discovery | 48/48 | 1.0 | 0 | — (no mechanism) | 24k files read* | ~4.8M |
| JEV progressive | 48/48 | 1.0 | 0 | 0.67→0.96† | ~4–5k | ~920k |

Noul comprehension 0.6–0.95 on all arms; distractors correctly dismissed.
JEV matches baseline quality at ~10% of the context and ~1/3 of the tokens.

\* Discovery context: 50 files opened / 24,009 tokens of bodies read across
48 probes (tool-call tracing) + 6.4k avg input tokens/probe. No runner-owned
overlay by design.
† Fidelity 0.67 pre-tuning → 0.96 after switching 30 phase-diagnostic rules
`phase` → `action` lifetime.

At qwen3 quality the gap was quality, not just cost (JEV 10/10 vs load-all
4/16 on v1+v2): weak models drown in 46k noise that Spark swims through.

Full report: `evals/progressive-context/results/PROBE-SCALE-REPORT.md`.

## Benchmarks (all runs, aggregated)

### Probe eval — single session (one continued `opencode run --session` chain)

| run | load-all ret. / tok | discovery ret. / tok | JEV ret. / tok | JEV avg ctx |
|---|---|---|---|---|
| probe-2026-09-22T09-49-26 (pre-rename) | 47/48 / 3.41M | 11/48 / 3.25M | 18/48 / 2.76M | 5,101 |
| probe-2026-09-22T11-09-56 (renamed) | 48/48 / 3.60M | 48/48 / 3.67M | 48/48 / 2.72M | 5,228 |

The rename (58 skills noun→verb + kind tags + verbatim-id template) took JEV
18→48 and discovery 11→48: naming, not routing, was the bottleneck.

### Probe eval — JEV lifetime tuning (single, JEV-only)

| run | retrieval | fidelity | avg ctx |
|---|---|---|---|
| probe-2026-09-22T12-39-24 | 47/48 | 0.96 | 3,901 |

### Probe eval — discovery context tracing (single, discovery-only)

| run | retrieval | files read | body tokens | avg input/probe |
|---|---|---|---|---|
| probe-2026-09-22T16-08-09 | 48/48 | 50 | 24,009 | 6,417 |

### Probe eval — multi-session factory (fresh `opencode run` per probe)

| run | arm | retrieval | avg ctx | tokens |
|---|---|---|---|---|
| probe-multi-2026-09-22T15-18 | load-all | 34/48 (24/26 content) | 46,736 flat | 2.73M |
| probe-multi-2026-09-22T14-45 (hybrid JEV) | jev + file memory | 25/26 content | 476 + 3.6k mem | 920k |

Hybrid (fresh sessions + auditable `.agents/jev-memory.md`) recovers
single-session retrieval at multi-session isolation.

### Single-session builds (fatty checkout task, verification x/11)

| run | model | load-all | discovery | JEV |
|---|---|---|---|---|
| single-2026-09-21T23-11 (fail_open) | qwen3 | 3/11 | 3/11 | 3/11 |
| single-2026-09-22T05-42 (fail_open) | qwen3 | 6/11 | 4/11 | 2/11 |
| single-2026-09-22T08-06 (provider) | qwen3 | 6/11 | 2/11 | 4/11 |
| single-2026-09-22T09-22 (provider) | Spark | 5/11 | 5/11 | 5/11 |

Builds time out and tie: probes are the instrument, builds are smoke.

### Live paired multi-turn (qwen3, byte-proof harness)

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
# Frozen held-out v2 (run ONCE, config hash recorded in artifact):
bun run evals/progressive-context/run-scripted.ts --arms=load_all,static_initial,progressive_jev,oracle_dynamic --scenarios=fixtures/scenarios-heldout-v2 --out=evals/progressive-context/results/heldout-v2-frozen.json
```

Probe eval (requires `TYPESAFE_API_KEY` + APM 0.31 at
`/home/linuxbrew/.linuxbrew/bin/apm`):

```bash
source .env
bun run evals/progressive-context/run-probe.ts --arms=load_all_single,apm_discovery,jev_single --model=opencode-go/muse-spark-1.3-contributor --probe-set=v3
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

See `evals/progressive-context/results/EVIDENCE.md` (scripted) and
`evals/progressive-context/results/PROBE-SCALE-REPORT.md` (probe eval at scale).

## Scenario sets

- `fixtures/scenarios/` — original 7 (now training/diagnostic; inspected
  during failure analysis, NOT unbiased validation).
- `fixtures/scenarios-training/` — copy of the original 7 for tuning work.
- `fixtures/scenarios-heldout-v2/` — 11 new scenarios with fresh wording
  (multi-phase checkout, OAuth, look-alikes, docs-only, no-skill, deploy,
  observation-trigger, unload-required). Frozen config `d7d044863a5319c7`;
  run once, failures reported without retuning.
- `fixtures/probe-questions{,-v2,-v3}.json` — frozen probe sets
  (`probe-v1-frozen`, `probe-v2-frozen`, `probe-v3-frozen`): targeted
  rule/skill questions + distractors + recall probes at phase boundaries.

## Key adaptations (honest deviations from the plan)

- APM 0.31 (brew) deploys skills to `.agents/skills/` and rules to
  `.agents/rules/` (antigravity target); the stale 0.9.4 binary at
  `/usr/local/bin/apm` is never used (harness pins the brew binary).
  `apm install --target opencode` alone deploys skills only.
- OpenCode V1 (1.18.x) has no provider-request construction hook
  (context-spike: NEGATIVE for authoritative unload). Byte-proof unload lives
  in the benchmark-owned ExplicitHarness; single-session TUI uses behavioral
  overlay policy via message/system transforms.
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
