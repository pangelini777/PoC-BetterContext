  # Probe eval at scale — development history (tuning sets)

  > Catalog: 36 rules + 58 skills = 94 resources, 46,736 tokens.
  > v1/v2/v3 probe sets are TUNING sets (used iteratively — not held-out).
  > Headline result is the frozen v4 held-out comparison (§0 below).

  ## 0. Headline: isolated v4 held-out (2026-09-22)

  Artifact `probe-2026-09-22T17-31-31-8wmokx.json` (+ `.grades.json`), Spark,
  provider-backed JEV. JEV workspaces contain no apm.yml/.apm/.agents/rules/
  or .agents/skills/ (controller-only store); contamination gates clean.
  Probe + evaluator definitions embedded with hashes; grading uses them.

  | arm | retrieval | recall | misses | fidelity | avg ctx | tokens |
  |---|---|---|---|---|---|---|
  | load_all | 10/10 | 1.0 | 0 | — | 46,736 | 633k |
  | apm_discovery | 10/10 | 1.0 | 0 | — | traced | 1.37M |
  | jev (isolated) | 10/10 | 1.0 | 0 | 0.9997 | 3,906 | 257k |

  JEV matched both baselines exactly on unseen probes while physically unable
  to access non-materialized resources, at 8% of the context. The single-session
  plugin provides behavioral eviction fidelity only — byte-proof unload evidence
  comes from ExplicitHarness and eligible live runs (see README §Unload proof).


  ## 1. What was measured (historical tuning trajectory)

  v1/v2/v3 runs below are TUNING/DIAGNOSTIC history (naming fixes, lifetime
  tuning, grader calibration; early JEV arms allowed native APM discovery).
  Do not cite them as clean proof — the headline is §0 (v4 held-out).

  | run (historical tuning) | mode | load-all | discovery | JEV | JEV avg ctx | fidelity |
  |---|---|---|---|---|---|---|
  | probe-2026-09-22T11-09-56-o7n3fy | single | 47/48 | 47/48 | **48/48** | ~5.1k | 0.67 |
  | probe-multi-2026-09-22T15-18-39-ublybq | multi load-all | **24/26 content** | — | — | 46.7k flat | null |
  | probe-2026-09-22T12-39-24-x48mdy | single JEV, tuned lifetimes | — | — | **46/48** | 3,901 | **0.96** |

  (A hybrid file-memory JEV variant was evaluated during development but its
  artifact was never committed; no quantitative hybrid claim is made here.)

Noul comprehension 0.6–0.95 on all arms wherever graded; distractors
`correctly-dismissed` (except noted recall-template artifact below).

  1. **Routing quality ties at Spark quality; cost differs 10×.** With clean
  naming, all arms answer correctly (47–48/48). JEV does it at ~4–5k avg ctx
  vs 46.7k flat. Committed JEV arm totals: 2.76M pre-rename
  (`probe-2026-09-22T09-49-26`), 2.72M renamed (`probe-2026-09-22T11-09-56`),
  1.79M lifetime-tuned (`probe-2026-09-22T12-39-24`).
> Update 2026-09-22: critical misses are now 0 on all arms. The single miss
> was a fixture artifact (pq-webhook-idempotency listed rule.secrets-management
> as expected while the question never asks about secrets); expectedIds trimmed
> to the asked-about rule, all artifacts regraded. Recall is 1.0 everywhere.
2. **At qwen3 quality routing wins outright** (JEV 10/10 vs load-all 4/16 on
   v1+v2): weak models drown in 46k noise that Spark swims through.
  3. **Naming was the dominant failure mode, not routing.** 58 skills renamed
  noun→verb phrases + `[RULE]/[SKILL]` overlay kind tags + verbatim-id
  template took JEV 18/48 → 48/48. Skill-instead-of-rule endorsements
  (6/20 probes) disappeared.
  4. **Session memory flatters single-session ~2×** (48 vs 23 content retrieval
  pre-rename, committed artifacts).
  5. **Lifetime tuning works:** 30 phase-diagnostic rules `phase` → `action`
  took eviction fidelity 0.67 → 0.96 with recall held at 0.95; overlay
  oscillates (avg 10.4 materialized) instead of ratcheting (3→19).
6. **Discovery dematerialization is 0 by construction** (self-report 0.0):
   native sessions accumulate; no eviction mechanism exists.
7. **Fixture bug fixed, not hidden:** webhook probe demanded verbatim "400"
   which the skill text never states ("reject invalid signatures with 400"
   vs "return 400/500 appropriately"). Reworded to accept reject/verify
   language; previously-failing correct answers now pass.

## 4. Honest gaps (probe era; build-slice update follows)

- Multi-session JEV (23/48) vs multi load-all (24/26 content): cold-start
  quality is close; JEV's edge there is cost, not correctness.
- Look-alike recall probes (`follows` on readonly-recall): recall template
  invites re-application. Fixture wording fix outstanding.
- Fatty builds time out at 900s with 2–6/11 verification: probes are the
  instrument; builds are smoke.
- 46.7k catalog, not 60k: new bodies averaged ~500 tokens vs 650 target.
  Same order of magnitude; routing behavior (12/94 materialized) already sharp.

## 5. Build-slice era update (2026-09-22/23, supersedes the "fatty builds" gap)

Sixteen build arms across ten runs (Spark + luna-pro, seed-only → per-turn
+ probation): JEV never loses a paired trial (+1, +1, +4, 0, +2), probation
lifted Spark 5–6/8 → 8/8, and the 8/8-vs-8/8 tie holds at −26% tokens. The
4/8 per-turn collapse without the fuse is kept as the justifying ablation.
Remaining build gaps: 4-phase privacy never starts under any routing (9/12
ceiling twice); per-turn routing can destabilize mid-phase work
(sms-fallback regressed on the 4-phase per-turn run); single-session scrubs
are behavioral-only (`systemScrubbed` 0/182 — fresh processes carry history
outside the hooks' view). Next fix: phase-commitment from the agent's own
green tests. Full table: README §live engineering exercise, artifacts
  `results/build-*.json`, evidence EVIDENCE §7b.

  ## 6. Artifacts (all committed)

  - Probes: `probe-2026-09-22T11-09-56-o7n3fy.json[.grades.json]` (single,
    3-arm), `probe-2026-09-22T12-39-24-x48mdy.json[.grades.json]` (JEV tuned),
    `probe-multi-2026-09-22T15-18-39-ublybq.json[.grades.json]` (multi load-all).
    (A hybrid file-memory variant was evaluated but its artifact was never
    committed; no hybrid numbers are claimed.)
  - Code: `run-probe.ts` (+v3/recall), `run-probe-multi.ts` (+hybrid-memory),
    `probe/grade.ts` (endorsement rule, eviction Choice, self-report),
    `probe/grade-run.ts` (batched grading, quality incl. fidelity,
    discovery file tracing), dashboard (probe-eval/probe-multi kinds, fidelity,
    recall, quality columns).
