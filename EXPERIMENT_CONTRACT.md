# Experiment contract

This repository exists to test one narrow hypothesis:

> A JEV System One runtime can progressively materialize and dematerialize Microsoft APM rules and skills according to the current agent trajectory, improving effective context health without reducing task correctness.

## Isolation from sibling projects

The benchmark MUST NOT depend on or execute code from any sibling repository, including `../agentOpt`.

Forbidden during benchmark execution:

- imports from `../agentOpt` or any sibling checkout;
- symlinks into a sibling checkout;
- loading sibling OpenCode/OMP plugins;
- reading sibling SQLite/telemetry databases;
- reusing sibling benchmark workspaces or result artifacts;
- inheriting JEV completion gates, output distillation, write steering, verification interventions, or other agent-behavior policies;
- changing an arm's prompt/model/tests/timeouts based on the arm name.

Copying a generic idea by reimplementing it here is fine. Runtime/source dependencies are not.

The benchmark runner MUST record a provenance check proving that no resolved module path, plugin path, APM store, result path, or workspace path points into `../agentOpt`.

## Single treatment variable

For the primary paired live comparison, the only intended treatment difference is APM context policy:

- `load_all`: every synthetic rule and skill is materialized according to the baseline policy.
- `progressive_jev`: JEV selects resources over time and the context compiler materializes only the current set.

Everything else must match: base git commit, user task, model, tool permissions, timeout, independent verification, environment (except treatment-specific routing vars), and harness version.

`static_initial` and `oracle_dynamic` are diagnostic arms, not the primary efficacy comparison.

## No benchmark leakage

Gold labels in `fixtures/scenarios/*.json` are evaluator-only. They must never be present in JEV state, agent prompts, tool output, or live workspaces.

The agent must not be told which benchmark arm it is running. Experiment telemetry stays outside model context.

## Definition of unload

`DEMATERIALIZED` means the full resource body is absent from the next provider request's effective context.

Removing an ID from an internal set while leaving its body in historical messages is NOT unloading.

A sentinel regression test must demonstrate this property on the exact request assembly path used for the authoritative results.

## Evidence classes

Every routing decision/result must be labelled as one of:

- `provider_backed`: produced by a successful TypeSafe/JEV provider response;
- `fail_open`: provider unavailable/invalid and runtime continued via documented fallback;
- `load_all`: baseline policy;
- `static_initial`: provider selection made only at task start;
- `oracle`: gold dynamic selection; upper bound only.

Never aggregate `fail_open` or `oracle` as provider-backed JEV evidence.

## Primary proof order

1. Resource lifecycle correctness.
2. True next-request dematerialization.
3. Context-health improvement.
4. Routing precision/recall.
5. Independent live task correctness.
6. Secondary efficiency outcomes: total tokens, turns, duration.

A coding-speed win is not required to prove the core hypothesis. Equal correctness with substantially healthier context is a successful PoC.
