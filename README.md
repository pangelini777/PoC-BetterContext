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
