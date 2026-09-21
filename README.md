# jev-apm-progressive-poc

Standalone PoC: TypeSafe/JEV System One progressively materializes and
dematerializes Microsoft APM rules/skills per the agent's task trajectory.
Experimentally independent from any sibling project (see `EXPERIMENT_CONTRACT.md`).

## Reproduction

```bash
bun install
bun run check                                   # typecheck + tests (23 pass)
bun run evals/progressive-context/apm-isolation.ts
bun run evals/progressive-context/context-spike.ts
bun run evals/progressive-context/run-scripted.ts --arms load_all,static_initial,progressive_jev,oracle_dynamic
bun run evals/progressive-context/validate-scripted.ts evals/progressive-context/results/<artifact>.json
```

Live (requires `AGENT_MODEL` with upstream access + `TYPESAFE_API_KEY`):

```bash
AGENT_MODEL=opencode/<model> TYPESAFE_API_KEY=<key> \
  bun run evals/progressive-context/run-live.ts --trials 1 --arms load_all,progressive_jev --alternate-order --model "$AGENT_MODEL"
```

## Evidence

See `evals/progressive-context/results/EVIDENCE.md` (partial evidence:
lifecycle, dematerialization, context-health, and plumbing verified;
provider-backed routing + live trials blocked on missing credentials/model).

## Key adaptations (honest deviations from the plan)

- Installed APM 0.9.4 has **no `--root` flag**; isolation proof copies the
  package into an `mkdtemp` store and validates with the real CLI.
- OpenCode 1.18.31 plugin API has **no provider-request hook**; the
  benchmark-owned `ExplicitHarness` is the authoritative unload path.
- One `.env` copied from a sibling checkout contaminated an early run; the
  artifact is quarantined and the copy deleted. Current runs are keyless
  (`fail_open`) by design until a first-party key is provided.
