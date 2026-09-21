# Prompt for the autonomous coding agent

You are in the root of a new standalone repository named `jev-apm-progressive-poc`. Implement the complete PoC specified by `IMPLEMENTATION_PLAN.md` and obey `EXPERIMENT_CONTRACT.md` as a hard experimental constraint.

The purpose is to prove that TypeSafe/JEV System One can progressively discover, materialize, retain, and dematerialize Microsoft APM rules and skills according to an agent's changing task trajectory, while reducing irrelevant/stale context without reducing independently verified task correctness.

Important constraints:

- This repo is a sibling of `agentOpt`, but it MUST be independent. Do not import, symlink, execute plugins from, read telemetry/results from, or otherwise depend on `../agentOpt` or any sibling project. Implement the minimal JEV/System One client and telemetry needed here.
- Microsoft APM remains the package format/installer. Use the supplied package under `fixtures/apm-package/` and install it into an isolated `apm install --root <store>` location outside each live agent workspace so normal harness auto-discovery cannot bypass JEV.
- Never expose gold labels from `fixtures/scenarios/` to JEV or the coding agent. Gold data is evaluator-only.
- Do not call an internal state change an “unload”. A resource is dematerialized only when its full marked body is absent from the next actual provider request/effective context. Build a sentinel test that proves this on the authoritative request path.
- Perform the OpenCode hook/context-reconstruction capability spike before assuming the harness can scrub historical overlays. If the installed OpenCode plugin API cannot prove clean next-request replacement, keep the OpenCode integration as a secondary demo and use the explicit benchmark-owned context-construction harness defined in the plan for authoritative unload/context-health evidence. Do not weaken the unload definition.
- JEV makes fuzzy semantic applicability/skill-fit decisions. Deterministic code owns thresholds, hysteresis, dependencies, lifetimes, state transitions, and context compilation.
- Implement all four scripted arms: `load_all`, `static_initial`, `progressive_jev`, and `oracle_dynamic`. The primary live comparison is paired `load_all` vs `progressive_jev`; the agent must not be told its arm.
- Provider-backed JEV results must be attributable to persisted raw probabilities/usage/latency. Label fail-open and oracle results separately and exclude them from provider-backed aggregates.
- Use the supplied 15 rules, 14 skills, seven scenarios, and demo workspace initially. Keep look-alike and distractor resources because they are essential to routing quality.
- Prioritize proof in this order: lifecycle correctness -> real dematerialization -> context health -> routing accuracy -> independent task correctness -> secondary token/turn/time outcomes.
- Run deterministic/unit/scripted validation before any expensive live run. Then run ONE paired live smoke trial. Only if JEV routing telemetry and real dematerialization are verified should you run the required 3 paired evidence trials with alternating arm order.
- Do not tune thresholds after inspecting held-out gold results. If targets are missed, report the miss instead of changing labels or hiding failures.
- Do not commit credentials.

Deliver working code, tests, exact reproduction commands, machine-readable result artifacts, a Markdown evidence report, and provenance sufficient to audit that the experiment was independent from `agentOpt`.

Do not stop at a design document. Implement and run as much of the PoC as the environment permits, and clearly separate implemented/verified evidence from unrun steps caused by missing external credentials or CLIs.
