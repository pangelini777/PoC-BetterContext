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

  Stability: three consecutive JEV-only v4 seeds, 10/10 each —
  `probe-2026-09-22T19-51`, `19-58`, `20-04` (avg ctx ~4k, fidelity ~1.0).
  Factory runs (fresh session per probe, v4 held-out, Spark):

  | run | arm | retrieval | avg ctx | tokens |
  |---|---|---|---|---|
  | probe-multi-2026-09-22T15-18 | load-all | 34/48 (24/26 content) | 46,736 flat | 2.73M |
  | probe-multi-2026-09-22T19-12 | all three, 10 probes | 10/10 × 3 | JEV 1,324 | JEV 133k |

  Single-session builds (checkout task, verification x/11, Spark): 5/11 on all
  three arms — builds tie; probes discriminate.
  (`single-2026-09-22T09-22-44-30k0td.json`)

  ```mermaid
  flowchart LR
      subgraph CTRL["Controller (owns APM store)"]
          CAT["94-resource catalog"]
          JEV["JEV router + resolver"]
          CMP["Overlay compiler"]
      end
      subgraph WS["Agent workspace (one continued session)"]
          PLG["JEV plugin"]
          AGT["Agent"]
      end
      CAT --> JEV
      JEV -->|"materialized bodies"| CMP
      CMP -->|"fresh overlay per turn"| PLG
      PLG -->|"scrub + inject"| AGT
      AGT -->|"tool/file activity"| JEV
  ```

  ```mermaid
  flowchart LR
      subgraph CTRL["Controller (owns APM store)"]
          CAT["94-resource catalog"]
          JEV["JEV router + resolver"]
          CMP["Harness-assembled prompt"]
      end
      subgraph S1["Probe 1 session"]
          A1["Agent"]
      end
      subgraph S2["Probe 2 session"]
          A2["Agent"]
      end
      subgraph SN["Probe N session"]
          AN["Agent"]
      end
      CAT --> JEV
      JEV -->|"one overlay per probe"| CMP
      CMP --> A1
      CMP --> A2
      CMP --> AN
  ```

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
