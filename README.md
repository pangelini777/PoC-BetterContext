# JEV × APM Progressive Context

TypeSafe/JEV System One progressively materializes and dematerializes APM
rules/skills per the agent's task trajectory — loading what each phase needs,
unloading what it doesn't.

## The result

On a **fresh 10-probe held-out set** over a **94-resource / ~46.7k-token APM
catalog** (Spark agent model, provider-backed JEV), isolated JEV matched
load-all and native APM discovery at **10/10 retrieval, 1.0 rule recall, zero
critical misses** — while materializing **~3.9k APM tokens on average (~8% of
load-all)** and using **~257k agent tokens vs ~633k / ~1.37M**.

| arm | retrieval | recall | misses | fidelity | avg ctx | tokens |
|---|---|---|---|---|---|---|
| load-all (46,736 flat) | 10/10 | 1.0 | 0 | — | 46,736 | 633k |
| native APM discovery | 10/10 | 1.0 | 0 | — | traced* | 1.37M |
| **JEV progressive (isolated)** | **10/10** | **1.0** | **0** | **0.9997** | **3,906** | **257k** |

The JEV agent workspace contained **no discoverable non-materialized APM
rules or skills** — no `apm.yml`, no `.apm/`, no `.agents/rules/`, no
`.agents/skills/`. The full package lives in a controller-only directory;
only JEV-selected bodies reach the prompt. Contamination gates clean on all
arms. Replicated 10/10 on a second seed
(`probe-2026-09-22T19-35-27-9ufpxd.json`).

\* Discovery context is measured (files opened + input tokens), not
runner-owned. No overlay by design.

Primary artifacts: `evals/progressive-context/results/probe-2026-09-22T17-31-31-8wmokx.json`
(+ `.grades.json`), replication `probe-2026-09-22T19-35-27-9ufpxd.json`
(+ `.grades.json`). Probe + evaluator definitions embedded with hashes.

## What each layer proves

- **v4 probe benchmark** = routing + context-isolation evidence, with
  behavioral eviction fidelity. The single-session plugin rewrites emitted
  messages but cannot observe provider-request bytes — so `jev_single` stays
  deliberately ineligible for byte-proof unload. Expected, and visible.
- **ExplicitHarness + eligible live runs** = byte-proof future-request
  dematerialization: `live-2026-09-21T21-11-07` (progressive arm, 4/4 unload
  proofs pass, sentinel-zero, eligible).

## Stability note

Single-session JEV is bistable: one run collapsed to 2/10 (since removed)
when the model hedged early and the posture self-reinforced through session
history — identical overlays, different samples. Multi-session (fresh probe
each turn) cannot enter that attractor: 10/10 twice. JEV-only v4 stability
trials are next.

## Reproduction

```bash
bun install
bun run check
source .env   # TYPESAFE_API_KEY + APM 0.31 at /home/linuxbrew/.linuxbrew/bin/apm
bun run evals/progressive-context/run-probe.ts --arms=load_all_single,apm_discovery,jev_single --model=opencode-go/muse-spark-1.3-contributor --probe-set=v4
bun run evals/progressive-context/probe/grade-run.ts evals/progressive-context/results/<artifact>.json
```

## Dashboard

```bash
bun run dashboard   # http://127.0.0.1:4317, live 2s refresh
```

## Further evidence

- `evals/progressive-context/results/EVIDENCE.md` — full evidence record.
- `evals/progressive-context/results/PROBE-SCALE-REPORT.md` — tuning history
  (v1/v2/v3 development, naming fixes, lifetime tuning) and factory runs.
- `evals/progressive-context/results/ANALYSIS.md` — skeptical-reviewer analysis.

## Key design decisions

- Controller-only APM store + per-probe contamination gates for JEV arms;
  full in-workspace install for the discovery baseline; direct injection for
  load-all.
- 58 skills renamed noun→verb so kind reads from name shape; overlay entries
  carry `[RULE]/[SKILL]` tags; answers require verbatim `rule./skill.` ids.
- 30 phase-diagnostic rules use `action` lifetime (evict after 1 low score);
  cross-cutting rules stay `phase`, privacy stays `task`.
- Thresholds frozen (`thresholds-v1-untuned`); improvements are architectural,
  never retuned on held-out gold.
