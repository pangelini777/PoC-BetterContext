# JEV + Microsoft APM Progressive Context PoC — Standalone Implementation Plan

## 0. Mission

Build a standalone Bun/TypeScript proof of concept that uses Microsoft Agent Package Manager (APM) as the package/install format and TypeSafe/JEV System One as a fast semantic routing layer over installed rules and skills.

The PoC must prove, with external telemetry rather than model self-report, that:

1. the agent begins without the full package in normal harness-discoverable context;
2. JEV selects rules/skills as the task trajectory reveals new needs;
3. deterministic runtime logic activates, retains, and retires resources;
4. materialized rule/skill bodies appear in the intended model request;
5. dematerialized bodies are absent from the next request's effective context;
6. progressive routing improves context health versus loading everything;
7. independent end-to-end task correctness is not degraded;
8. results are not contaminated by sibling `agentOpt` behavior.

This is an evaluation PoC, not a production authorization/security system.

Read `EXPERIMENT_CONTRACT.md` first. It is authoritative when this plan is ambiguous.

---

## 1. Repository independence and experimental boundary

This repository must remain self-contained.

Do not import, symlink, execute, or read runtime artifacts from `../agentOpt` or any sibling project. In particular, do not inherit:

- completion gating;
- verification checkpoints;
- output/tool-result distillation;
- write/edit steering;
- intervention budgets;
- previous JEV benchmark workspaces;
- previous SQLite telemetry;
- previous benchmark result JSON;
- sibling OpenCode/OMP plugins.

The PoC may implement generic ideas independently, but all code used in the experiment must live in this repository or installed third-party dependencies.

Add a benchmark provenance assertion that rejects paths resolving into `../agentOpt` or other sibling project roots.

### Treatment variable

For the primary live comparison, hold constant:

- base workspace git commit;
- task prompt;
- model/provider;
- tool permissions;
- harness version;
- timeout;
- independent test suite;
- environment, except routing-specific treatment variables.

Only APM context policy should differ:

```text
load_all        -> all synthetic rules/skills available/materialized by baseline policy
progressive_jev -> JEV-managed progressive resource materialization
```

`static_initial` and `oracle_dynamic` are diagnostic/scripted arms.

---

## 2. External primitives

### Microsoft APM

Use the supplied package in the standard multi-primitive shape:

```text
fixtures/apm-package/
  apm.yml
  .apm/
    instructions/*.instructions.md
    skills/<name>/SKILL.md
  jev-runtime.yaml
```

Current APM documentation describes `.apm/instructions/` and `.apm/skills/<name>/SKILL.md` as package primitives, and skills are normally runtime-discovered using their `description` metadata.

Install the package into an isolated root:

```bash
cd fixtures/apm-package
apm install --target opencode --root <isolated-store>
```

`--root` currently redirects APM writes, including integrated harness files, under the target directory while package sources resolve from the package working directory.

Do not run `apm compile` into a live benchmark workspace. Doing so would materialize context up front and invalidate progressive-discovery claims.

Record `apm --version` and exact install command in every evidence artifact.

### TypeSafe / JEV System One

Implement a minimal local client for `POST /v1/systemone` with:

- bearer authentication;
- timeout/abort;
- strict response validation;
- persisted input/output token usage;
- latency;
- model identifier;
- raw question-answer probabilities needed for audit;
- no API key in telemetry.

Use typed JEV primitives for narrow decisions:

- one `Noul` per rule applicability decision;
- `Choice` + gating `Noul`s for broad skill selection;
- second-stage `Choice` + absolute-fit `Noul`s for shortlisted skills.

JEV decides semantic relevance. Code decides lifecycle transitions.

---

## 3. Architecture

Target structure:

```text
jev-apm-progressive-poc/
  packages/
    protocol/
    jev-client/
    apm-catalog/
    progressive-context/
    opencode-adapter/
  evals/
    progressive-context/
      scripted/
      live/
      independent/
      results/
  apps/
    dashboard/                  # optional until core proof works
  fixtures/
    apm-package/
    scenarios/
    demo-workspace/
  docs/
  .env.example
```

Logical flow:

```text
APM package source
      │
      │ apm install --root <isolated store>
      ▼
APM installed/catalogued resources
      │ metadata only for broad routing
      ▼
JEV router
      │ probabilities
      ▼
deterministic resolver
      │ activation/retention/deactivation/dependencies/lifetimes
      ▼
active resource state
      │
      ▼
ContextCompiler
      │ exact overlay for NEXT request
      ▼
agent/harness/model
```

There must be only one dynamic discovery authority for the experiment: the progressive-context runtime.

The full package must not simultaneously exist in harness-native discovery folders inside the live agent workspace.

---

## 4. Lifecycle semantics

Use explicit terms. Never use “loaded” without qualification.

```text
INSTALLED
INDEXED
CANDIDATE
ACTIVE
EXPOSED          # skill short descriptor only
MATERIALIZED     # full body in next model context
INVOKED          # skill currently used for an operation/turn
DEMATERIALIZED   # full body absent from next model context
RETIRED          # no longer active in runtime state
```

Optional future state:

```text
DISTILLED         # full rule replaced by compact task-specific invariants
```

Do not make the initial PoC depend on distillation.

### Definition of unload

For this PoC:

> unload = DEMATERIALIZED from the next provider request's effective context.

The model cannot be made to literally forget prior text. The runtime claim is only that the body is no longer sent in subsequent requests.

---

## 5. Critical proof: request reconstruction and historical scrubbing

This is the highest-risk implementation issue and must be spiked before full routing.

Every dynamic overlay should be marked:

```text
<jev-apm-context version="1" event="evt-004">
...current dynamic resource bodies...
</jev-apm-context>
```

The authoritative request path must guarantee:

1. every old `jev-apm-context` block is removed from historical messages/system content;
2. the current active overlay is compiled from runtime state;
3. exactly one current overlay is added to the outgoing request;
4. on the next request, the previous overlay is absent unless the same resource is deliberately rematerialized.

### Phase-0 OpenCode capability spike

Before building the full adapter, inspect the installed OpenCode plugin API and prove hook ordering/transform capability around:

- user/chat message hooks;
- message transforms;
- system transforms;
- provider request construction;
- tool pre/post hooks;
- session lifecycle hooks.

Build a sentinel fixture:

```text
<jev-resource id="rule.alpha">UNIQUE_ALPHA_SENTINEL_7F3A</jev-resource>
```

Request N should contain it while alpha is active.

After alpha is dematerialized, request N+1 must not contain `UNIQUE_ALPHA_SENTINEL_7F3A` anywhere in the effective sent context.

Capture provider-request context safely enough to assert marker presence/absence. Persist hashes/counts rather than full prompts by default.

### Required fallback

If OpenCode's installed plugin API cannot guarantee this, do not weaken the claim.

Implement a benchmark-owned explicit request-construction harness that uses the same:

- catalog;
- JEV router;
- resolver;
- context compiler;
- model;
- task state;

but assembles each model request itself. That path becomes the authoritative lifecycle/context-health proof.

The OpenCode adapter can remain a secondary integration demonstration until it supports true reconstruction.

---

## 6. Core packages

### `packages/protocol`

Define Zod schemas and shared types.

Recommended types:

```ts
type ResourceKind = "rule" | "skill";

type ResourceStatus =
  | "installed"
  | "indexed"
  | "candidate"
  | "active"
  | "exposed"
  | "materialized"
  | "invoked"
  | "dematerialized"
  | "retired";

type Lifetime = "turn" | "action" | "phase" | "task" | "session";

interface ResourceDescriptor {
  id: string;                  // rule.foo or skill.bar
  kind: ResourceKind;
  name: string;
  summary: string;
  sourcePath: string;
  bodySha256: string;
  estimatedTokens: number;
  lifetime: Lifetime;
  critical: boolean;
  dependsOn: string[];
}

interface SemanticEvent {
  id: string;
  seq: number;
  kind:
    | "user_message"
    | "plan_or_phase_change"
    | "observation"
    | "before_high_impact_action"
    | "verification"
    | "completion";
  text: string;
  phase?: string;
  changedPaths?: string[];
}

interface RoutingState {
  sessionId: string;
  goal: string;
  currentEvent: SemanticEvent;
  recentEvents: SemanticEvent[];
  activeResourceIds: string[];
  changedPaths: string[];
}

interface ResourceScore {
  resourceId: string;
  probability: number;
  source: "system_one" | "dependency" | "load_all" | "static_initial" | "oracle";
}

interface ResourceTransition {
  resourceId: string;
  from: ResourceStatus | "none";
  to: ResourceStatus;
  reason: string;
  score?: number;
  semanticEventId: string;
}
```

### `packages/jev-client`

Minimal TypeSafe client only. No completion gate or agent-behavior policy.

Expose something like:

```ts
systemOne({ state, questions, model }): Promise<SystemOneResponse>
```

Validate:

- answer type matches question type;
- Choice selected key exists;
- Choice probabilities sum approximately to 1;
- selected Choice has maximal probability;
- Noul in [0,1];
- usage counters nonnegative;
- model is present.

### `packages/apm-catalog`

Responsibilities:

- locate/index supplied APM instructions and skills;
- parse frontmatter;
- load JEV sidecar metadata from `jev-runtime.yaml`;
- compute stable SHA-256;
- estimate tokens consistently;
- resolve resource IDs;
- detect duplicate/missing IDs;
- read a body only when materialization or narrow reranking requires it.

Do not send all full resource bodies to broad JEV routing.

### `packages/progressive-context`

Responsibilities:

- normalize semantic event state;
- call JEV router;
- apply thresholds/hysteresis;
- enforce dependency closure;
- track lifetimes;
- compile dynamic context;
- remove stale dynamic context blocks;
- produce telemetry.

Keep it harness-neutral.

### `packages/opencode-adapter`

Thin integration only:

- derive semantic events from harness activity;
- feed those events to `progressive-context`;
- inject/reconstruct context if the installed API permits it;
- never contain separate selection logic.

---

## 7. Catalog and synthetic package

Use `fixtures/apm-package/` unchanged for the first evidence run.

Expected catalog:

- 15 rules;
- 14 skills.

The package deliberately includes:

- close look-alikes (`postgres-schema-migration` vs `postgres-readonly-query`);
- close look-alikes (`stripe-checkout-session` vs `stripe-webhook-handler`);
- domain distractors (iOS, ML);
- critical rules (payments/privacy/secrets/auth).

Do not remove them.

The sidecar `jev-runtime.yaml` is JEV/runtime metadata, not a new APM primitive. It describes:

- stable IDs;
- summary;
- lifecycle;
- critical flag;
- dependencies.

Fail deterministic indexing tests on:

- duplicate IDs;
- sidecar references to missing source files;
- malformed frontmatter needed for routing;
- invalid dependency references;
- dependency cycles if cycles are unsupported.

---

## 8. Semantic routing events

Do not call JEV blindly on every model/tool step.

Route when state changes meaningfully:

- initial `user_message`;
- explicit plan/phase change;
- repository/tool observation that introduces a new domain fact;
- before a materially new file domain or high-impact action;
- entering verification;
- entering release/deployment preparation;
- completion/finalization.

Normalize the state and hash its routing-relevant fields. Skip JEV if the hash is unchanged.

The scripted evaluator provides exact events. The live adapter may infer events heuristically, but must log why a routing refresh occurred.

---

## 9. JEV rule routing

Rules are multi-label, not single-choice.

For the 15-rule PoC, ask one independent Noul per rule in one System One request.

State should include only compact task evidence:

```json
{
  "goal": "...",
  "phase": "webhook",
  "currentEvent": "...",
  "changedPaths": ["app/api/stripe/webhook/route.ts"],
  "recentEvidence": ["..."],
  "currentlyActive": ["rule.privacy-personal-data"]
}
```

Question intent per rule:

> Is this rule needed now to constrain or guide correct execution of the current phase or immediate next action?

Broad pass includes the rule summary/criteria, not the full body.

Persist raw probability per rule.

### Initial configurable thresholds

Use seeds, not hard truth:

```text
activate >= 0.65
retain   >= 0.35
unload   <  0.20 for 2 consecutive routing events
```

Critical rules may use a lower activation threshold, e.g. 0.55, but this must be explicit and frozen before held-out evaluation.

---

## 10. JEV skill routing: two-stage progressive disclosure

Skills need both relative ranking and an absolute no-skill escape.

### Stage 1: broad shortlist

One System One request with:

- `which_skill`: Choice across all 14 skill names using short descriptions as criteria;
- `acts_on_repo_or_system`: Noul;
- `specialized_procedure_helpful`: Noul;
- `prose_only_suffices`: Noul (inverted in gate score).

Gate score example:

```ts
mean([
  actsOnRepo,
  specializedProcedureHelpful,
  1 - proseOnlySuffices,
]);
```

If gate < configured threshold, select no skill.

Otherwise take top K, default K=3.

### Stage 2: deep rerank

Load full metadata/excerpt only for top K.

Ask:

- `which_skill`: Choice among K using richer criteria;
- `fits::<skill>`: independent Noul for each candidate.

If best absolute fit < configured threshold, select no skill.

Otherwise select the Choice winner only if it also meets fit threshold.

Persist:

- broad probabilities;
- gate probabilities/score;
- shortlist;
- fit probabilities;
- final skill;
- JEV latency/tokens for both calls.

---

## 11. Deterministic lifecycle resolver

JEV never directly mutates context.

Given scores and current state, deterministic code computes transitions.

Pseudo-logic:

```ts
for (const rule of catalog.rules) {
  const p = scores[rule.id];
  const state = current[rule.id];

  if (!state.active && p >= activateThreshold(rule)) {
    activate(rule, "jev_activate");
  } else if (state.active && p >= retainThreshold(rule)) {
    retain(rule);
    state.belowUnloadStreak = 0;
  } else if (state.active && p < unloadThreshold(rule)) {
    state.belowUnloadStreak += 1;
    if (state.belowUnloadStreak >= unloadStreakRequired && lifetimeAllowsRemoval(rule)) {
      dematerializeAndRetire(rule, "jev_unload_hysteresis");
    }
  }
}

applyDependencyClosure();
applyLifetimeRules();
```

### Lifetimes

Recommended behavior:

- `turn`: reevaluate/rematerialize only for current turn/action;
- `action`: retain through one bounded action;
- `phase`: retain until phase change unless strong negative evidence;
- `task`: once activated, remain logically active for task, but body may be materialized only when needed;
- `session`: sticky for session.

For P0, keep active state and materialization state distinct so a task-lifetime rule can remain `ACTIVE` without its full body being sent on every call if the implementation supports that cleanly.

### Dependencies

JEV answers fuzzy applicability. Code resolves dependencies.

Example:

```text
payments-card-data -> logging-sensitive-data
webhook-idempotency -> logging-sensitive-data
production-change-control -> secrets-management
```

A dependency transition must record source=`dependency`, not pretend JEV selected it directly.

---

## 12. Context compiler

The compiler is the proof surface.

Input:

- immutable kernel;
- current task state;
- active/materialized rules;
- selected skill;
- compact recent trajectory summary;
- current user/tool event.

Output:

```ts
interface CompiledContext {
  kernel: string;
  dynamicOverlay: string;
  materializedResourceIds: string[];
  resourceTokenEstimate: number;
  overlaySha256: string;
}
```

Overlay example:

```text
<jev-apm-context version="1" event="evt-005">
  <rule id="rule.secrets-management" sha256="...">
  ...body...
  </rule>
  <skill id="skill.production-deploy-checklist" sha256="...">
  ...body...
  </skill>
</jev-apm-context>
```

Compiler properties:

- deterministic order;
- no duplicate resource body;
- body IDs/hashes traceable;
- token estimate recorded;
- gold labels never included;
- experiment arm never included;
- routing probabilities never included unless required for agent behavior (default: do not include).

### Context scrubber

Implement idempotent removal of all previous `<jev-apm-context>` blocks before adding the current overlay.

Tests:

- one old overlay removed;
- multiple malformed/partial markers handled safely;
- ordinary user text outside markers preserved;
- running scrub twice is same as once;
- current overlay can be added exactly once;
- dematerialized sentinel absent after reconstruction.

---

## 13. APM installation/isolation proof

Implement a fixture-install command/test that:

1. creates an isolated temporary store outside the live workspace;
2. runs APM from `fixtures/apm-package` using `--root`;
3. records APM version and output paths;
4. proves expected package/install output exists in the isolated root;
5. proves live workspace does not contain auto-discoverable copies of fixture primitives.

Check relevant harness locations, including any target-specific OpenCode skill/instruction paths produced by the installed APM version.

Do not hardcode only one legacy path; discover/inspect actual APM output and document it.

If APM is unavailable, stop the end-to-end APM evidence path with an actionable prerequisite error. Unit tests can still run.

---

## 14. Telemetry schema

Persist one JSONL/SQLite record per routing event. SQLite is optional; JSONL is sufficient if robust.

Minimum fields:

```text
run_id
session_id
arm
semantic_event_id
semantic_event_seq
phase
provider_evidence_class
jev_model
catalog_hash
state_hash
rule_scores
skill_stage1
skill_stage2
active_before
active_after
materialized_before
materialized_after
added
retained
removed
transition_reasons
compiled_overlay_sha256
compiled_resource_tokens
load_all_resource_tokens
gold_required_resource_ids        # evaluator output only, stored outside agent trace
context_precision                  # evaluator-derived
context_recall                     # evaluator-derived
stale_resource_tokens              # evaluator-derived
missing_required_resource_tokens   # evaluator-derived
provider_input_tokens
provider_output_tokens
provider_latency_ms
scrubbed_overlay_count
sentinel_assertions
created_at
```

Do not store API keys.

Do not persist full provider prompts by default. For sentinel testing, persist marker counts/hashes or a sanitized test-only request capture.

---

## 15. Scripted scenario evaluator

Use all JSON fixtures under `fixtures/scenarios/`.

Keep gold labels evaluator-only.

The runner should replay semantic events through each arm and emit per-event metrics.

### Arms

#### `load_all`

Baseline. No JEV routing.

All 15 rule bodies and all skill bodies/descriptors are considered available/materialized according to the baseline definition used by the experiment. Clearly document whether full skill bodies or only runtime skill descriptors are included; choose the version that best matches the actual “everything installed/discoverable” agent context and use the same definition for token accounting.

For the simplest context-health baseline, compile every rule body + every skill body.

#### `static_initial`

JEV resolves resources only from the initial user message/event. Freeze that selection for the full trajectory.

This measures progressive routing against ordinary initial semantic retrieval.

#### `progressive_jev`

JEV reevaluates on semantic events. Deterministic resolver applies hysteresis/dependencies/lifetimes and compiler reconstructs context.

Only successful provider-backed decisions count toward provider-backed efficacy.

#### `oracle_dynamic`

Use gold labels per event. No JEV. This is an upper-bound context policy, never mixed with JEV evidence.

### Scripted metrics

Per event:

```text
rule precision
rule recall
critical-rule recall
skill exact match / no-skill correctness
materialized resource count
dynamic resource tokens
stale/irrelevant resource tokens
missing-required resource tokens
activation latency in semantic events
unload latency in semantic events
resource churn
JEV latency/tokens
```

Aggregate median and distribution across scenarios.

---

## 16. Context-health metrics

Do not hide proof behind one opaque “health score”. Report raw dimensions.

### Resource precision

```text
|materialized ∩ gold| / |materialized|
```

Define empty-set cases explicitly.

### Resource recall

```text
|materialized ∩ gold| / |gold|
```

### Stale/irrelevant token ratio

```text
estimated tokens of materialized resources not in gold
------------------------------------------------------
estimated tokens of all materialized resources
```

### Missing-required token ratio

```text
estimated tokens of gold resources not materialized
----------------------------------------------------
estimated tokens of gold resources
```

### Context savings vs load_all

```text
1 - progressive_dynamic_tokens / load_all_dynamic_tokens
```

### Churn

Number of add/remove transitions per semantic event. Excess churn is a failure mode even if average token count is small.

### Activation/unload latency

Number of semantic events between gold relevance transition and actual materialization/dematerialization.

---

## 17. Threshold tuning discipline

Do not tune on all supplied scenarios and then report the same scenarios as held-out evidence.

Preferred approach:

1. create 3-5 additional `training-*` scenarios that are not included in final evidence metrics;
2. choose thresholds using only those training scenarios;
3. freeze config to a versioned JSON/YAML file with SHA;
4. run supplied scenarios as held-out tests;
5. do not alter gold labels or thresholds after seeing held-out results.

If time-constrained, use initial thresholds without tuning and label the result “untuned”. This is preferable to leaking held-out labels.

---

## 18. Live end-to-end benchmark

Use `fixtures/demo-workspace` as the base, copied into a fresh temporary git workspace for every arm/trial.

Create a realistic task that forces trajectory changes across several domains, for example:

> Complete the checkout flow in this repository: finish the accessible cart checkout UI, implement the server-side Stripe Checkout Session route, persist the needed synthetic shipping/contact fields safely, implement retry-safe Stripe webhook handling, add focused regression tests, and prepare (but do not execute) the production release checklist.

The exact final task prompt must be committed to the benchmark runner and identical across arms.

The agent must not be told:

- benchmark arm;
- expected rules/skills;
- gold labels;
- expected lifecycle transitions;
- that a context-health experiment is being run, unless unavoidable for bootstrap mechanics.

### Independent verification

Keep independent tests outside the agent-visible workspace until after the run.

Verify at minimum:

- checkout route rejects/handles invalid input safely;
- trusted server-side values are used rather than arbitrary client payment totals;
- raw card data is not persisted/handled by application code;
- webhook signature failure path exists;
- duplicate webhook delivery is idempotent;
- synthetic personal data is not logged;
- schema changes exist and are compatible with fixture expectations;
- relevant targeted tests pass;
- release checklist/config requirements exist without actually deploying.

The independent evaluator must not depend on the agent's own tests.

### Trial protocol

First:

```text
1 paired smoke trial: load_all + progressive_jev
```

Validate before proceeding:

- provider-backed JEV telemetry exists;
- rule/skill transitions are plausible;
- sentinel/dematerialization assertion passes;
- independent evaluator runs;
- both workspaces start from identical base commit;
- no sibling-project paths are present.

Only then run:

```text
3 paired trials
alternate order:
trial 1: load_all -> progressive_jev
trial 2: progressive_jev -> load_all
trial 3: load_all -> progressive_jev
```

Do not claim statistical significance from N=3.

---

## 19. Live harness metrics

Capture from the harness/provider where available:

```text
input tokens
output tokens
reasoning tokens
total tokens
turns
tool calls by tool
duration
timeout/completion state
final assistant text hash/summary
independent tests passed/total
```

Capture progressive runtime metrics:

```text
JEV calls
JEV input/output tokens
JEV p50/p95 latency
routing refresh count
rule activations
rule dematerializations
skill selections
no-skill selections
resource token area-under-trajectory
sentinel failures
fail-open count
```

The primary PoC claim should focus on context quality and correctness, not generic coding-agent speed.

A valid strong outcome could be:

```text
correctness: equal
required-rule recall: high
context resource tokens: substantially lower
stale resource tokens: substantially lower
```

Even if wall-clock time does not improve.

---

## 20. OpenCode integration

Implement only after the core scripted/controller path works.

The adapter should translate actual harness signals into semantic events, such as:

- initial user message;
- file-read discoveries that materially change task domain;
- write/edit path domain change;
- shell/tool output identifying Stripe/Postgres/deploy concerns;
- test/verification phase;
- session completion.

Avoid calling JEV on every trivial read or text chunk.

Use debouncing/state hashing.

### Bootstrap context

The agent may receive a tiny immutable kernel similar to:

```text
This session uses a runtime-managed capability and policy context.
Additional rules/skills may appear as the task changes.
Treat currently supplied dynamic rules as authoritative for their scope.
Do not assume unavailable package capabilities.
```

Keep this small and identical across live arms as far as possible. `load_all` receives the same kernel plus the full baseline overlay.

### Skills in P0

For the first PoC, full skill materialization into the controlled overlay is acceptable.

Do not make isolated skill/subagent execution a prerequisite.

Future optimization:

```text
main agent sees short skill descriptor -> skill runs in isolated context -> structured result returns
```

That can reduce contamination further, but is a V2 experiment.

---

## 21. Result artifacts

Every run should produce machine-readable JSON under something like:

```text
evals/progressive-context/results/<timestamp>-<run-id>.json
```

And a Markdown report:

```text
evals/progressive-context/results/<timestamp>-<run-id>.md
```

Required provenance:

```text
repo git commit
OS/runtime
Bun version
APM version
OpenCode version
agent model
TypeSafe/JEV model
fixture catalog hash
threshold config hash
base demo-workspace git commit
exact task prompt hash
arm order
trial IDs
external test suite hash
```

Required report table:

```text
trial | arm | correctness | dyn tokens | total tokens | turns | duration | JEV calls | unload proof
```

Required lifecycle timeline for progressive arm:

```text
step | phase | +resources | -resources | skill | active | dyn tokens | precision | recall
```

Required narrative limitations:

- small N;
- synthetic rules/business domain;
- model/harness dependence;
- unload means future-request omission, not erasure from model memory;
- APM isolation prevents ordinary auto-discovery but is not necessarily a filesystem security sandbox;
- System One routing thresholds may require domain calibration.

---

## 22. Acceptance criteria

### A. Independence

- [ ] No runtime/source import or symlink from `../agentOpt`.
- [ ] No sibling plugin is loaded by live runs.
- [ ] No sibling DB/results/workspaces are read.
- [ ] Provenance validator fails if any resolved benchmark path enters sibling project roots.

### B. APM isolation

- [ ] Supplied package installs using current APM `--root` behavior.
- [ ] Full package output is outside each live agent workspace.
- [ ] Live workspace contains no auto-discoverable copies of the complete fixture before the run.
- [ ] Full `apm compile` is not used as the progressive context mechanism.

### C. Catalog

- [ ] Exactly 15 rules and 14 skills indexed.
- [ ] Every resource has ID, summary, body SHA, body path, token estimate, lifetime, dependencies.
- [ ] Duplicate/missing/malformed metadata tests fail deterministically.

### D. True materialization/dematerialization

- [ ] Active resource body appears in intended request.
- [ ] Dematerialized body is absent from next compiled request.
- [ ] Previous dynamic overlay blocks are removed before next request.
- [ ] Sentinel regression test passes on authoritative request path.
- [ ] `checkout-progressive` produces at least 3 materialization changes and at least 2 dematerialization changes.

### E. Scripted routing quality

After thresholds are frozen:

- [ ] overall rule recall >= 0.90;
- [ ] overall rule precision >= 0.75;
- [ ] zero misses for gold critical rules in held-out fixtures;
- [ ] `no-skill` returns no skill;
- [ ] `readonly-db` selects `postgres-readonly-query`, not migration;
- [ ] `stripe-webhook-bug` selects webhook skill, not checkout-session skill;
- [ ] iOS and ML distractors remain inactive for commerce/web scenarios.

If targets are missed, report failure honestly. Do not post-hoc edit labels/thresholds.

### F. Context health

Across scripted progressive trajectories:

- [ ] median dynamic APM token reduction vs `load_all` >= 50%;
- [ ] stale/irrelevant APM token reduction vs `load_all` >= 40%;
- [ ] `progressive_jev` stale-token ratio is lower than `static_initial` on `checkout-progressive`;
- [ ] missing-required-token ratio remains acceptably low and is reported;
- [ ] oracle is presented only as an upper bound.

### G. Live end-to-end

- [ ] exactly one smoke pair is run before evidence trials;
- [ ] smoke proves provider-backed routing + sentinel unload proof;
- [ ] then at least 3 paired `load_all` vs `progressive_jev` trials with alternating order;
- [ ] all included progressive trials have provider-backed routing telemetry;
- [ ] same independent verifier used for both arms;
- [ ] progressive median independent pass count is not below baseline median;
- [ ] raw per-trial results, medians, arm order, and limitations reported.

### H. Repository quality

- [ ] `bun run check` passes;
- [ ] credentials excluded from repo/results;
- [ ] clean-clone reproduction steps documented;
- [ ] fixture/gold data cannot leak into live agent context.

---

## 23. Implementation order

### Phase 0 — establish experimental integrity

1. Initialize git in this standalone folder.
2. Read `EXPERIMENT_CONTRACT.md`.
3. Add provenance guard against sibling runtime dependencies.
4. Validate fixture counts/hash.
5. Verify `apm --version`, `opencode --version`, Bun version.
6. Test APM isolated `--root` install.
7. Perform OpenCode context-transform/sentinel spike.
8. Decide authoritative request path: OpenCode if true reconstruction proven; explicit controller harness otherwise.

Do not implement a large adapter before step 7.

### Phase 1 — harness-neutral core

1. `protocol` schemas/types.
2. `jev-client` with mocked contract tests.
3. APM catalog parser.
4. token estimator + SHA hashing.
5. lifecycle resolver with hysteresis/lifetimes/dependencies.
6. context compiler + scrubber.
7. sentinel unit/integration tests.

### Phase 2 — provider-backed routing

1. rule Noul request.
2. broad skill Choice/gates.
3. narrow skill rerank/fits.
4. strict validation.
5. fail-open classification.
6. routing event telemetry.

### Phase 3 — scripted evaluation

1. implement four arms.
2. create separate training scenarios if tuning thresholds.
3. freeze threshold config.
4. run held-out supplied scenarios.
5. generate JSON + Markdown report.
6. add validator for acceptance thresholds.

### Phase 4 — live benchmark

1. build fresh git workspace copier.
2. implement identical-task runner.
3. implement independent verifier outside workspace.
4. wire OpenCode or authoritative controller path.
5. run one smoke pair.
6. inspect attribution and unload proof.
7. only then run 3 paired evidence trials.

### Phase 5 — optional visualization

After evidence is reliable, optionally add a tiny local dashboard showing:

- active/materialized resources over time;
- added/removed transitions;
- dynamic token curve;
- precision/recall/stale-token metrics;
- JEV latency/token overhead.

Dashboard is not a prerequisite for the proof.

---

## 24. Expected commands to implement

Initial project verification:

```bash
bun install
bun run check
apm --version
opencode --version
```

APM isolation smoke:

```bash
bun run evals/progressive-context/apm-isolation.ts
```

Hook/request reconstruction spike:

```bash
bun run evals/progressive-context/context-spike.ts
```

Scripted routing:

```bash
bun run evals/progressive-context/run-scripted.ts \
  --arms load_all,static_initial,progressive_jev,oracle_dynamic \
  --scenarios fixtures/scenarios
```

Validate scripted artifact:

```bash
bun run evals/progressive-context/validate-scripted.ts \
  evals/progressive-context/results/<artifact>.json
```

Live smoke:

```bash
bun run evals/progressive-context/run-live.ts \
  --trials 1 \
  --arms load_all,progressive_jev \
  --alternate-order \
  --opencode-bin "${OPENCODE_BIN:-$(command -v opencode)}" \
  --model "$AGENT_MODEL"
```

Live evidence after smoke validation:

```bash
bun run evals/progressive-context/run-live.ts \
  --trials 3 \
  --arms load_all,progressive_jev \
  --alternate-order \
  --opencode-bin "${OPENCODE_BIN:-$(command -v opencode)}" \
  --model "$AGENT_MODEL"
```

Final:

```bash
bun run check
```

The coding agent may choose different exact filenames if there is a clear reason, but README must expose equivalent one-command reproductions.

---

## 25. Do not do these things

- Do not use `../agentOpt` as a library, plugin, benchmark framework, or telemetry source.
- Do not install the complete APM package into normal live-workspace discovery directories.
- Do not use `apm compile` to preload all instructions and call the result progressive.
- Do not claim unload if old bodies remain in future request history.
- Do not tell the live agent which arm it is in.
- Do not expose scenario gold labels to JEV or the live agent.
- Do not inject JEV probabilities/benchmark telemetry into the model unless functionally necessary.
- Do not force deterministic choices in `progressive_jev` and count them as provider-backed.
- Do not aggregate fail-open/oracle evidence with provider-backed results.
- Do not tune on held-out labels.
- Do not change task/model/test/timeout/tool permissions between paired arms.
- Do not run expensive 3-pair evidence trials before one smoke pair proves routing and unload telemetry.
- Do not optimize generic coding behavior in this PoC. No completion gate, distillation, write steering, or verification intervention beyond what is necessary to route APM context.
- Do not make task-success improvement a required claim. The core claim is healthier context at preserved correctness.

---

## 26. Final deliverables from the coding agent

1. Standalone working Bun/TypeScript implementation in this repo.
2. Independent minimal TypeSafe/JEV client.
3. APM isolated-install/indexing pipeline using supplied fixture.
4. Deterministic rule/skill lifecycle resolver.
5. Two-stage JEV skill router and multi-label rule router.
6. Context compiler/scrubber with request-level sentinel proof.
7. Scripted four-arm benchmark and validation.
8. OpenCode live integration or clearly documented controller-harness fallback for authoritative unload proof.
9. Independent end-to-end verification suite.
10. One smoke pair and, when external prerequisites permit, three paired live evidence trials.
11. Machine-readable results + Markdown evidence report.
12. Reproduction instructions and version/provenance capture.
13. `bun run check` green.

The final evidence report must answer explicitly:

- Which resources were installed but never materialized?
- At each semantic event, what was added, retained, and removed?
- Why did each transition occur (JEV score, dependency, lifetime, baseline, oracle)?
- Can the runtime prove a removed resource body was absent from the next request?
- What were resource precision/recall and critical misses?
- What were stale and missing-required token ratios?
- How much dynamic APM context did each arm send?
- How did `progressive_jev` compare with `static_initial`, not just `load_all`?
- Did the live task remain correct under external verification?
- What JEV latency/token overhead was paid?
- Was any trial fail-open, oracle, timed out, or otherwise ineligible for provider-backed claims?
- Did provenance confirm zero runtime dependency on `agentOpt`?

---

## 27. External references

Current references used when this starter was prepared:

- Microsoft APM package authoring:
  `https://github.com/microsoft/apm/blob/main/packages/apm-guide/.apm/skills/apm-usage/package-authoring.md`
- Microsoft APM command reference (`apm install --root`):
  `https://github.com/microsoft/apm/blob/main/packages/apm-guide/.apm/skills/apm-usage/commands.md`
- TypeSafe skill suggestion cookbook:
  `https://docs.typesafe.ai/cookbooks/skill_suggestion`
- TypeSafe primitives:
  `https://docs.typesafe.ai/primitives`

These external surfaces can change. Record actual installed versions and verify APIs at implementation time rather than assuming this plan is permanently current.
