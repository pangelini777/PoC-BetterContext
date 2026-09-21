# jev-apm-progressive-poc

Standalone PoC: TypeSafe/JEV System One progressively materializes and
dematerializes Microsoft APM rules/skills per the agent's task trajectory.
Experimentally independent from any sibling project (see `EXPERIMENT_CONTRACT.md`).

## Reproduction

```bash
bun install
bun run check                                   # typecheck + tests (41 pass)
bun run evals/progressive-context/apm-isolation.ts
bun run evals/progressive-context/context-spike.ts
bun run evals/progressive-context/run-scripted.ts --arms=load_all,static_initial,progressive_jev,oracle_dynamic
bun run evals/progressive-context/validate-scripted.ts evals/progressive-context/results/<artifact>.json
# Frozen held-out v2 (run ONCE, config hash recorded in artifact):
bun run evals/progressive-context/run-scripted.ts --arms=load_all,static_initial,progressive_jev,oracle_dynamic --scenarios=fixtures/scenarios-heldout-v2 --out=evals/progressive-context/results/heldout-v2-frozen.json
```

Live smoke (requires `local/qwen3` reachable + `TYPESAFE_API_KEY`):

```bash
AGENT_MODEL=local/qwen3 TYPESAFE_API_KEY="$TYPESAFE_API_KEY" \
  bun run evals/progressive-context/run-live.ts --trials=1 --arms=load_all,progressive_jev --alternate-order --model="$AGENT_MODEL"
```

Only if the smoke passes every eligibility gate, run the 3-pair evidence
benchmark (`--trials=3`). Do not claim significance from 3 pairs.

## Evidence

See `evals/progressive-context/results/EVIDENCE.md`. Current state:
provider-backed scripted evidence on 7 training scenarios (jev-1.13.0) plus a
frozen single run over 11 held-out-v2 scenarios; live smoke blocked on the
local model server being unreachable (TCP closed).

## Scenario sets

- `fixtures/scenarios/` — original 7 (now training/diagnostic; inspected
  during failure analysis, NOT unbiased validation).
- `fixtures/scenarios-training/` — copy of the original 7 for tuning work.
- `fixtures/scenarios-heldout-v2/` — 11 new scenarios with fresh wording
  (multi-phase checkout, OAuth, look-alikes, docs-only, no-skill, deploy,
  observation-trigger, unload-required). Frozen config `d7d044863a5319c7`;
  run once, failures reported without retuning.

## Key adaptations (honest deviations from the plan)

- Installed APM 0.9.4 has **no `--root` flag**; the proof consumes and
  validates an APM-format package while keeping bodies outside the live
  workspace (product-integration gap, not a routing failure).
- OpenCode 1.18.31 plugin API has **no provider-request hook**; the
  benchmark-owned `ExplicitHarness` is the authoritative unload path.
- `opencode run` needs `--auto` (harness constant, identical across arms) or
  non-interactive turns block on permission prompts forever.
- Thresholds in `config/thresholds.json` are frozen (`thresholds-v1-untuned`);
  routing improvements are architectural (dependency metadata, `shortlistMin`
  enforcement, fit-decides selection, dependency-hint questions), never
  threshold retuning on held-out gold.
