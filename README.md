# JEV × APM Progressive Context

Give your agent exactly the context each task phase needs — nothing more.
TypeSafe/JEV System One progressively materializes and dematerializes APM
rules/skills as work evolves, replacing the all-or-nothing context dump.

## Same answers. A tenth of the context.

Fresh 10-probe held-out set · 94-resource / ~46.7k-token catalog · Spark ·
provider-backed JEV · contamination-clean workspaces:

| arm | retrieval | recall | misses | avg context | tokens |
|---|---|---|---|---|---|
| load-all (everything, always) | 10/10 | 1.0 | 0 | 46,736 | 633k |
| native APM discovery | 10/10 | 1.0 | 0 | traced* | 1.37M |
| **JEV progressive (isolated)** | **10/10** | **1.0** | **0** | **3,906** | **257k** |

**10/10 on unseen probes with 8% of the context and ~40% of the tokens.**
Noul comprehension 0.6–0.95; distractors correctly dismissed; eviction
fidelity 0.9997 — evicted rules stay evicted. Replicated on a second seed.

The JEV workspace contains zero non-materialized APM surface — no `apm.yml`,
no `.apm/`, no `.agents/rules/`, no `.agents/skills/`. Only JEV-selected
bodies reach the prompt. That's not a smaller dump. It's a different
mechanism.

\* Discovery context measured from files opened + input tokens.

Primary artifacts: `evals/progressive-context/results/probe-2026-09-22T17-31-31-8wmokx.json`
(+ `.grades.json`), replication `probe-2026-09-22T19-35-27-9ufpxd.json`
(+ `.grades.json`). Definitions embedded with hashes.

## Two guarantees, two layers

- **Routing + isolation** (this benchmark): the right rules, nothing else,
  physically enforced by workspace isolation — not trust.
- **Byte-proof unload** (ExplicitHarness + eligible live runs): dematerialized
  rules provably absent from all future requests.
  Reference: `live-2026-09-21T21-11-07` (4/4 unload proofs, sentinel-zero).

  ## All benchmarks

  Agent model throughout: `opencode-go/muse-spark-1.3-contributor`
  (provider-backed JEV `jev-latest` for routing/grading).

  Tuning trajectory (v1+v2+v3, 48 probes/arm) — how naming and lifetime fixes
  converged all arms to perfect retrieval:

  | run | load-all | discovery | JEV | JEV avg ctx |
  |---|---|---|---|---|
  | probe-2026-09-22T11-09 (renamed catalog) | 48/48, 3.60M tok | 48/48, 3.67M tok | 48/48, 2.72M tok | 5,228 |
  | probe-2026-09-22T12-39 (JEV lifetime tuning) | — | — | 47/48, 1.79M tok | 3,901 |
  | probe-2026-09-22T16-08 (discovery tracing) | — | 48/48, 50 files / 24k tok read | — | — |

  ## How a probe run works

  One continued `opencode run --session` chain per arm (fresh sessions per
  probe in multi-session mode). Each turn asks the **agent model** one frozen
  probe question; the **JEV model** (System One) scores routing in parallel.
  The two models never see each other's outputs — the runner mediates.

  Per turn: (1) runner → JEV: one batched `POST /v1/systemone` with trajectory
  state (`goal`, `phase`, current event, last 3 events, active ids, changed
  paths) and ~100 questions — one Noul per rule, a Choice over skill
  summaries, gating Nouls, then a second-pass Choice + fit-Nouls over the
  top-3 shortlist; (2) runner → deterministic resolver (thresholds,
  hysteresis, dependencies, lifetimes) + compiler, which injects exactly the
  materialized bodies into one `<jev-apm-context>` overlay; (3) runner →
  agent: probe question + `Rules:`/`Answer:`/`Quote:` template + overlay over
  stdin to `opencode run`; (4) agent → runner: answer + tool calls + tokens.

  **Agent answers** are graded deterministically: the `Rules:` line must
  endorse every `mustCite` id, none of `mustNotCite`, and quote any-of
  `mustQuote`. Distractors (`pq-ios`, `pq-ml`) expect `Rules: none` plus a
  non-applicability statement; recall probes re-list still-active ids from
  the overlay, not memory.

  **JEV answers** are graded by JEV itself: comprehension Nouls per expected
  rule (P(answer complies) — e.g. 0.94 on the payments probe), a disposition
  Choice on distractors (`correctly-dismissed`), and an eviction Choice per
  evicted id → fidelity = mean(1 − P(relies)).

  Worked example — `pq-payments-boundary` (phase `checkout-api`, JEV arm):
  overlay carries 3 rules (780 ctx tokens); agent answers
  `Rules: rule.payments-card-data` + one sentence + a verbatim quote
  ("...must never receive, persist, log, or test with raw card numbers...")
  → retrieval PASS, Noul 0.94. Distractor `pq-ios` with 11 unrelated rules
  in context → `Rules: none` → PASS, `correctly-dismissed`.
  Full detail: `evals/progressive-context/PROBE-RUN.md`.

   v4 held-out runs (10 probes, Spark) — five single-session, one multi-session:
  | run | mode | load-all | discovery | JEV | ctx avg − | sess tok − |
  |---|---|---|---|---|---|---|
  | probe-2026-09-22T17-31 (headline) | single | 10/10, 46,736 ctx, 633k tok | 10/10, 1.37M tok | 10/10, 3,906 ctx, 257k tok | −91.64% | −59.4% |
  | probe-2026-09-22T19-35 (replication, JEV-first) | single | 10/10, 46,736 ctx, 684k tok | 10/10, 907k tok | 10/10, 4,367 ctx, 235k tok | −90.66% | −65.7% |
  | probe-2026-09-22T19-51 (stability 1/3) | single, JEV-only | — | — | 10/10, 4,041 ctx, 381k tok | −91.35%* | — |
  | probe-2026-09-22T19-58 (stability 2/3) | single, JEV-only | — | — | 10/10, 3,980 ctx, 219k tok | −91.48%* | — |
  | probe-2026-09-22T20-04 (stability 3/3) | single, JEV-only | — | — | 10/10, 4,145 ctx, 233k tok | −91.13%* | — |
  | probe-multi-2026-09-22T19-12 | **multi (fresh/probe)** | 10/10, 46,736 ctx, 580k tok | 10/10, 1.60M tok | 10/10, 1,324 ctx, 133k tok | −97.17% | −77.1% |

  ## The live engineering exercise (build-slice runs)

  Probes test whether the agent *cites the right rules*. Builds test whether
  it *ships working code under those rules* — the PoC's correctness leg.
  Each run is a paired head-to-head: same fixture, same model, same task
  prompt, same 20-turn budget. Only the APM context policy differs
  (progressive JEV overlay vs native discovery), and the agent never knows
  which arm it is running.

  The 2-phase journey: **Phase 1 — refunds** (POST `/api/refunds` with
  `Idempotency-Key` handling: scoped replay `200` + `Idempotent-Replayed`
  vs `422` on key reuse; trusted server-side totals from the fixture catalog,
  never client totals; a focused `bun` test proving duplicate delivery
  converges). **Phase 2 — notifications** (`lib/notify.ts` with an email
  template plus SMS fallback and retry, plus a test proving fallback
  converges). The fixture ships stubs (`NOT_IMPLEMENTED`, 501s); the agent
  must replace them with real implementations.

  What the hidden checks measure (evaluator-only, never shown to JEV or
  the agent): capability checks (refund route with trusted totals,
  idempotency handling, both notify channels, fallback + retry), *rule
  compliance* checks — normative requirements straight from the rule bodies
  (no raw card data, no personal-data logging, no hardcoded secrets; the
  4-phase variant adds webhook signature discipline), and a *convergence*
  check (the agent's own `bun test` exits 0 with ≥2 passes). Counts per
  verifier: refund slice 5 checks (1 rule), 2-phase journey 8 checks
  (3 rules), 4-phase journey 12 checks (4 rules). A perfect score means the
  agent built the feature, obeyed the rules, and proved it with tests.

  What varies across runs — and why: the overlay *stability* fix (unchanged
  sets send silence, not a "fresh" block), the *continuity* note
  (`still-active` ids survive phase transitions), the JEV-owned *test-gate*
  Noul (test permission fires at phase boundaries, not every turn), and the
  `lib/`-first verifier path. Each was a response to an observed failure
  mode (phase-transition amnesia, test compulsion, root-scaffolding), not
  tuning on held-out gold.

  Two-phase engineering journey (refunds → notifications, 20 turns, 8 checks):

  | run | model | order | JEV | discovery |
  |---|---|---|---|---|
  | build-2026-09-23T09-49 (final) | opencode-go Spark 1.3 | JEV-first | **8/8**, 1.62M tok, gate 3 fires @ boundary | 7/8 (refund-route), 1.35M tok |
  | build-2026-09-23T10-19/10-43 (openrouter) | OpenRouter Spark 1.3 | discovery-first + JEV retry | 6/8 (root-scaffold, thin Phase 2) | 5/8 (Phase 1 gaps) |
  | build-2026-09-23T11-23 (luna) | OpenRouter gpt-6-luna-pro | JEV-first | **8/8**, 1.81M tok, clean tree, 4 test passes | 4/8, 2.28M tok, zero files changed |

  JEV holds 8/8 on two different model families; the advantage grows with
  model strength (tie → +1 → +4). Discovery collapses on luna-pro (20 turns,
  no implementation) while JEV ships a verified build on the same model.

  ```mermaid
  flowchart TB
      subgraph CTRL["Controller — owns the 94-resource APM store"]
          OBS["Observe: phase + tool/file activity"]
          JEV["JEV router: score every rule/skill"]
          RES["Resolver: activate / retain / DEMATERIALIZE"]
          CMP["Compiler: inject selected bodies only"]
      end
      subgraph AGT["Agent (sees only the overlay)"]
          ACT["Act on the task"]
      end
      OBS --> JEV
      JEV --> RES
      RES -->|"materialized"| CMP
      RES -->|"dematerialized: never compiled, never sent"| EVICT{"✕ evicted"}
      CMP --> ACT
      ACT --> OBS
  ```

  ## Model selection

  Agent models are opencode `--model` ids, swappable per run (`--model=`).
  Routing/grading always uses provider-backed JEV (`jev-latest`), never the
  agent model. Why these three:

  - `opencode-go/muse-spark-1.3-contributor` — default workhorse. Fast,
    cheap, contributor-tier; all probe tuning (v1–v4) and the refund slice
    ran on it. Baseline for every comparison.
  - `openrouter/meta/muse-spark-1.3-contributor` — same weights, different
    provider path. Tests whether results survive routing changes: both arms
    degraded (JEV 8/8→6/8, discovery 7/8→5/8), JEV still ahead. Provider
    path matters; report it, don't average over it.
  - `openrouter/openai/gpt-6-luna-pro` — capability probe. A stronger model
    widens the gap instead of closing it: JEV 8/8 with a clean tree while
    discovery produces nothing. Progressive context is load-bearing for
    capable agents, not training wheels for weak ones.

   Per-request context always favors JEV (15× less here). Session totals favor

  `ctx avg −` = 1 − JEV/load-all per-probe context sums. `sess tok −` = 1 −
  JEV/load-all whole-session billing totals (input+output+reasoning, history
  included). \*Stability rows have no same-run baseline; ctx measured against
  the 46,736 flat catalog size, session reduction not computable.

  Rules act in two places. **At routing time**, JEV scores every rule against
  the current phase and the resolver activates, retains, or dematerializes —
  dematerialized rules are never compiled and never reach any prompt. **At
  prompt time**, the compiler injects exactly the materialized bodies (plus a
  `[RULE]/[SKILL]` kind tag) into a single overlay block. Two session shapes
  use this loop: *single-session* keeps one continued agent session with a
  workspace plugin that scrubs stale overlays per turn (behavioral unload);
  *multi-session* (factories) routes each probe in isolation with a
  harness-assembled prompt and zero history (byte-proof by construction).

  ## Example System One call

  Routing sends one batched request per event — a Noul per rule, a Choice over
  skill summaries, and gating Nouls — with the trajectory state:

  ```json
  // POST {baseURL}/v1/systemone { state, model, questions }
  {
    "state": {
      "goal": "Answer probe questions about APM-managed rules and skills.",
      "phase": "tax-exempt",
      "currentEvent": "Are exempt lines excluded from...",
      "eventKind": "user_message",
      "changedPaths": [],
      "recentEvidence": ["...previous event text..."],
      "currentlyActive": ["rule.logging-sensitive-data"]
    },
    "model": "jev-latest",
    "questions": {
      "rule::rule.tax-calculation": {
        "type": "noul",
        "instructions": "Is this rule needed now to constrain or guide correct execution of the current phase or immediate next action? Rule summary: ...",
        "criteria": {
          "true": "The rule constrains or guides the current phase or immediate next action.",
          "false": "The rule is irrelevant to the current phase or would add only stale context."
        }
      },
      "which_skill": {
        "type": "choice",
        "instructions": "Which single skill procedure, if any, best fits the current phase or immediate next action?",
        "criteria": { "skill.calculate-tax": "...", "...": "..." }
      }
    }
  }
  ```

  Response (validated strictly — probabilities sum to ~1, winner holds max):

  ```json
  {
    "model": "jev-latest",
    "answers": {
      "rule::rule.tax-calculation": { "type": "noul", "noul": 0.91 },
      "rule::rule.ml-model-governance": { "type": "noul", "noul": 0.04 },
      "which_skill": {
        "type": "choice",
        "choice": "skill.calculate-tax",
        "probabilities": { "skill.calculate-tax": 0.72, "...": "..." },
        "confidence": 0.81
      }
    },
    "usage": { "input_tokens": 42514, "output_tokens": 8758 }
  }
  ```

  The resolver turns scores into lifecycle transitions (activate/retain/unload
  with hysteresis, dependencies, lifetimes); the compiler injects exactly the
  materialized bodies. Grading reuses the same API: per-rule compliance Nouls
  plus eviction Choices (`relies-on-evicted` / `consistent-but-independent` /
  `unrelated`).

## Try it

```bash
bun install
bun run check
source .env   # TYPESAFE_API_KEY + APM 0.31 at /home/linuxbrew/.linuxbrew/bin/apm
bun run evals/progressive-context/run-probe.ts --arms=load_all_single,apm_discovery,jev_single --model=opencode-go/muse-spark-1.3-contributor --probe-set=v4
bun run evals/progressive-context/probe/grade-run.ts evals/progressive-context/results/<artifact>.json
bun run dashboard   # http://127.0.0.1:4317, live 2s refresh
```

## More evidence

- `evals/progressive-context/results/EVIDENCE.md` — full evidence record.
- `evals/progressive-context/results/PROBE-SCALE-REPORT.md` — tuning history
  and factory runs.
- `evals/progressive-context/results/ANALYSIS.md` — skeptical-reviewer analysis.

## How it works

- Controller-only APM store + per-probe contamination gates for JEV arms;
  full in-workspace install for discovery; direct injection for load-all.
- 58 action-named skills so kind reads from name shape; `[RULE]/[SKILL]`
  overlay tags; verbatim `rule./skill.` ids in answers.
- Phase-diagnostic rules evict after one low score; cross-cutting rules
  persist; privacy rules span the task.
- Thresholds frozen; all gains architectural, never tuned on held-out gold.
