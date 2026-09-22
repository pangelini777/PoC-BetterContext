# Probe eval at scale — results report

> Date: 2026-09-22. Catalog: 36 rules + 58 skills = 94 resources, 46,736 tokens
> (sidecar `110132d1`). Agent models: local/qwen3 (early), Spark
> (opencode-go/muse-spark-1.3-contributor, all reported runs). Routing backend:
> provider-backed SystemOne (jev-latest; smoke model jev-1.13.0). Dashboard:
> `bun run dashboard` → http://127.0.0.1:4317.

## 1. What was measured

Probe-question eval over three session modes × three context policies:

- **Modes:** single-session (one continued `opencode run --session` chain),
  multi-session (fresh `opencode run` per probe, byte-proof prompts),
  hybrid (fresh sessions + runner-maintained auditable `.agents/jev-memory.md`).
- **Arms:** `load_all_single` (full 46.7k overlay), `apm_discovery` (native
  `.agents/` discovery, context unknown), `jev_single` (JEV-routed overlay).
- **Probes:** v1 (10) + v2 (6) + v3 (10) = 26 content + 22 recall = 48/arm.
  Fixtures frozen (`probe-v1-frozen`, `probe-v2-frozen`, `probe-v3-frozen`).
- **Grading:** deterministic retrieval (Rules-line endorsement, substring rule
  grade.ts `endorses`) + SystemOne Noul comprehension per expected rule +
  Choice eviction fidelity + Choice distractor disposition + self-report scoring.

## 2. Headline results (Spark, v3, renamed catalog)

| run | mode | load-all retrieval | discovery retrieval | JEV retrieval | JEV avg ctx | JEV fidelity |
|---|---|---|---|---|---|---|
| probe-2026-09-22T11-09-56-o7n3fy | single | 47/48 | 47/48 | **48/48** | ~5.1k | 0.67 |
| probe-multi-2026-09-22T14-45-16-fdnrx0 | hybrid JEV only | — | — | **25/26 content** | 476 + 3.6k mem | — |
| probe-multi-2026-09-22T15-18-39-ublybq | multi load-all | **24/26 content** | — | — | 46.7k flat | null |
| probe-2026-09-22T12-39-24-x48mdy | single JEV, tuned lifetimes | — | — | **46/48** | 3,901 | **0.96** |

Noul comprehension 0.6–0.95 on all arms wherever graded; distractors
`correctly-dismissed` (except noted recall-template artifact below).

## 3. Findings

1. **Routing quality ties at Spark quality; cost differs 10×.** With clean
   naming, all arms answer correctly (47–48/48). JEV does it at ~4–5k avg ctx
   vs 46.7k flat; ~920k vs ~2.7M tokens per 48-probe arm.

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
   pre-rename; hybrid recovers to 25/26 via auditable file memory).
5. **Lifetime tuning works:** 30 phase-diagnostic rules `phase` → `action`
   took eviction fidelity 0.67 → 0.96 with recall held at 0.95; overlay
   oscillates (avg 10.4 materialized) instead of ratcheting (3→19).
6. **Discovery dematerialization is 0 by construction** (self-report 0.0):
   native sessions accumulate; no eviction mechanism exists.
7. **Fixture bug fixed, not hidden:** webhook probe demanded verbatim "400"
   which the skill text never states ("reject invalid signatures with 400"
   vs "return 400/500 appropriately"). Reworded to accept reject/verify
   language; previously-failing correct answers now pass.

## 4. Honest gaps

- Multi-session JEV (23/48) vs multi load-all (24/26 content): cold-start
  quality is close; JEV's edge there is cost, not correctness.
- Look-alike recall probes (`follows` on readonly-recall): recall template
  invites re-application. Fixture wording fix outstanding.
- Fatty builds time out at 900s with 2–6/11 verification: probes are the
  instrument; builds are smoke.
- 46.7k catalog, not 60k: new bodies averaged ~500 tokens vs 650 target.
  Same order of magnitude; routing behavior (12/94 materialized) already sharp.

## 5. Artifacts

- Probes: `probe-2026-09-22T11-09-56-o7n3fy.json[.grades.json]` (single,
  3-arm), `probe-2026-09-22T12-39-24-x48mdy.json[.grades.json]` (JEV tuned),
  `probe-multi-2026-09-22T14-45-16-fdnrx0.json[.grades.json]` (hybrid JEV),
  `probe-multi-2026-09-22T15-18-39-ublybq.json[.grades.json]` (multi load-all).
- Code: `run-probe.ts` (+v3/recall), `run-probe-multi.ts` (+hybrid-memory),
  `probe/grade.ts` (endorsement rule, eviction Choice, self-report),
  `probe/grade-run.ts` (batched grading, quality incl. fidelity,
  discovery file tracing), dashboard (probe-eval/probe-multi kinds, fidelity,
  recall, quality columns).
