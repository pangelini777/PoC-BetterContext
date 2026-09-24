# How the probe run works

Agent model for probes: `opencode-go/muse-spark-1.3-contributor` only.
Builds (not covered here) run Spark plus `openrouter/openai/gpt-6-luna-pro`
across two provider paths — see README §live engineering exercise.

## Per turn

1. **Runner → JEV (System One).** One batched `POST /v1/systemone` with the
   trajectory state (`goal`, `phase`, current event text, last 3 events,
   active ids, changed paths) and ~100 questions: one Noul per rule ("is this
   rule needed now?"), a Choice over skill summaries, gating Nouls
   (`acts_on_repo`, `procedure_helpful`, `prose_suffices`,
   `sustained_construction`), then a second-pass Choice + fit-Nouls over the
   top-3 shortlist. Answers are strict-validated (probabilities sum to ~1,
   winner holds max). Usage/latency/model recorded per call. The
   `sustained_construction` gate locks the session into build mode
   (sticky lifetimes via `stepSticky`) or fast-eviction probe mode on turn 0.
2. **Runner → resolver + compiler.** Rule probabilities feed the deterministic
   lifecycle resolver (thresholds, hysteresis streaks, dependencies,
   lifetimes, build-mode stickiness, probation fuse). The compiler injects
   exactly the materialized bodies — each tagged `[RULE]`/`[SKILL]` with a
   `[LOCATION path]` line — into one `<jev-apm-context>` overlay block.
3. **Runner → agent model.** The probe question + answer template
   (`Rules:` / `Answer:` / `Quote:`) + current overlay go over stdin to
   `opencode run` (`--auto --format json`). NDJSON events parsed for text,
   tool calls, and per-step token usage.
4. **Agent → runner.** Answer text + tool calls + tokens captured. The
   decisions file (`.agents/jev-decisions.json`) records what was materialized
   vs evicted for the plugin (single-session) or the record (grading).

## What we expect from each answer

**From the agent** (per probe, deterministic checks):

- `Rules:` line endorses every `mustCite` id (substring/endorsement rule —
  abbreviations and skill↔rule slug matches accepted, look-alikes rejected),
  endorses none of `mustNotCite`, and the body quotes any-of `mustQuote`.
- Distractor probes (`pq-ios`, `pq-ml`, …): `Rules: none` plus a
  non-applicability statement. Quoting the rule's own "does not apply" text
  is correct dismissal, not a violation.
- Recall probes (at phase boundaries): re-list still-active ids from the
  current overlay, not from session memory.

**From JEV** (per probe, provider-judged):

- Comprehension Nouls per expected rule: P(answer complies with the rule).
- Distractor disposition Choice: follows / contradicts / correctly-dismissed.
## Probation fuse (build runs, resolver-owned)

Talk opens the door, work keeps it open. A rule activated on chatter alone
(announcement without file evidence in `changedPaths`) materializes on a
2-turn fuse: file evidence graduates it to full membership
(`probation_confirmed`), silence dematerializes it (`probation_expired`)
regardless of score. File-evidenced activations skip probation; task/session
lifetime rules are exempt (their lifetime is the commitment). Provenance:
the 4/8 per-turn collapse without the fuse (set bloated 7→11, Phase 1 never
built) vs 8/8 with it (t1 −5 expiry, t2 +5 confirm, then flat). Deterministic
code owns the fuse; JEV only scores.

## Reading the grades

`<artifact>.grades.json` carries per-probe `{retrieval, noul, disposition,
evictions, selfReport}` plus per-arm quality: recall, critical misses,
eviction fidelity, self-report accuracy. Precision/skill/stale stay null by
design (fixture expected sets are minimal; skills are cited in prose).
`probeResults[].retrieval` in the raw artifact is a legacy pre-score —
authoritative retrieval is recomputed by `grade-run.ts` from stored answers
using the embedded evaluator definitions.

  ## Worked example (from `probe-2026-09-22T11-09-56`, JEV arm, Spark)

  Probe `pq-payments-boundary` (phase `checkout-api`). JEV materialized 3
  rules (780 ctx tokens); the agent prompt is the question + template +
  overlay:

  ```text
  <probe id="pq-payments-boundary" phase="checkout-api">
  You are about to write app/api/checkout/route.ts. Which payment boundary
  rules constrain this file? Name each rule id and quote one line that
  forbids handling raw card data.
  </probe>

  Answer in exactly this template:
  Rules: <comma-separated FULL ids ...>
  Answer: <1-3 sentences>
  Quote: <one quoted line, or "n/a">

  <jev-apm-context version="1" event="evt-003">
    <rule id="rule.payments-card-data" ...>
    [RULE — constraint, what must hold]
    [LOCATION .../.apm/instructions/payments-card-data.instructions.md]
    ...body...
    </rule>
    ... (logging-sensitive-data, secrets-management) ...
  </jev-apm-context>
  ```

  Agent answer (retrieval PASS):

  ```text
  Rules: rule.payments-card-data
  Answer: app/api/checkout/route.ts is constrained by the payment card-data
  boundary rule.
  Quote: "- The application must never receive, persist, log, or test with
  raw card numbers or card security codes."
  ```

  Grader → System One (same API as routing, batched with the eviction
  Choices for this turn):

  ```json
  // state
  {
    "question": "You are about to write app/api/checkout/route.ts...",
    "answer": "Rules: rule.payments-card-data\nAnswer: ...\nQuote: ...",
    "ruleBody": "<full payments-card-data body>"
  }
  // questions
  {
    "grade": {
      "type": "noul",
      "instructions": "Does this answer comply with and follow the rule?",
      "criteria": {
        "true": "The answer complies with and follows the rule.",
        "false": "The answer contradicts or ignores the rule."
      }
    }
  }
  // answers
  { "grade": { "type": "noul", "noul": 0.94 } }
  ```

  Distractor `pq-ios` ("Which iOS SwiftUI navigation pattern..."): overlay
  carried 11 rules, none iOS-related. Agent answered `Rules: none` + "No
  injected rule specifies an iOS pattern" → retrieval PASS (endorsement-scoped
  forbidden check), disposition Choice → `correctly-dismissed`.
