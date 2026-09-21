// Scripted four-arm evaluator. Replays every scenario in fixtures/scenarios
// through load_all, static_initial, progressive_jev, and oracle_dynamic.
// GOLD IS EVALUATOR-ONLY: scenario gold labels are stripped before routing;
// the backends receive only visible state (goal, event text, phase, paths).
// progressive_jev uses the provider-backed SystemOneBackend when
// TYPESAFE_API_KEY is set, else the documented HeuristicBackend (fail_open).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCatalog } from "../../packages/apm-catalog/src/catalog.ts";
import { HeuristicBackend, MockBackend, SystemOneBackend, type ScoreBackend } from "../../packages/progressive-context/src/router.ts";
import { ProgressiveSession } from "../../packages/progressive-context/src/session.ts";
import type { Arm, EventMetrics, Scenario, TelemetryRecord } from "../../packages/protocol/src/types.ts";
import {
  CONFIG_PATH,
  PKG_DIR,
  RESULTS_DIR,
  REPO_ROOT,
  checkProvenance,
  collectVersions,
  goldIds,
  loadScenarios,
  scoreEvent,
} from "./lib.ts";

interface ArmEvent {
  seq: number;
  phase?: string;
  goldRules: string[];
  goldSkill: string | null;
  materialized: string[];
  metrics: EventMetrics;
}

interface ArmResult {
  arm: Arm;
  scenarioId: string;
  records: TelemetryRecord[];
  events: ArmEvent[];
}

function mockFromGold(_scenario: Scenario): ScoreBackend {
  // static_initial needs a per-event mock; built inside the loop instead.
  return new MockBackend({});
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const args = process.argv.slice(2);
  const armsArg = args.find((a) => a.startsWith("--arms="))?.slice(7) ?? "load_all,static_initial,progressive_jev,oracle_dynamic";
  const arms = armsArg.split(",") as Arm[];
  const scenariosArg = args.find((a) => a.startsWith("--scenarios="))?.slice(12);
  const outArg = args.find((a) => a.startsWith("--out="))?.slice(6);
  const runId = `scripted-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;

  const provenance = checkProvenance();
  const versions = await collectVersions();
  const cat = await loadCatalog(PKG_DIR);
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const cfgHash = (await import("node:crypto")).createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
  const scenarios = scenariosArg ? await loadScenarios(scenariosArg) : await loadScenarios();
  const loadAllTokens = [...cat.byId.values()].reduce((a, d) => a + d.estimatedTokens, 0);

  const apiKey = process.env["TYPESAFE_API_KEY"];
  const jevBackend: ScoreBackend = apiKey
    ? new SystemOneBackend(apiKey, process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest")
    : new HeuristicBackend();
  console.error(`[run-scripted] progressive backend: ${apiKey ? "SystemOneBackend(provider)" : "HeuristicBackend(fail_open, no TYPESAFE_API_KEY)"}`);

  const armResults: ArmResult[] = [];
  const allRecords: TelemetryRecord[] = [];

  for (const scenario of scenarios) {
    for (const arm of arms) {
      if (arm === "static_initial") {
        // Freeze the FIRST event's routing for the whole trajectory.
        const first = scenario.events[0];
        const probe = new ProgressiveSession({
          runId, sessionId: `${scenario.id}-${arm}`, arm: "progressive_jev",
          goal: scenario.description, catalogHash: cat.hash, bodies: cat.bodies,
          rules: cat.rules, skills: cat.skills, byId: cat.byId, cfg,
          backend: jevBackend, loadAllTokens,
        });
        const firstRec = await probe.runEvent({ kind: first.kind, text: first.text, phase: first.phase });
        const frozenRules: Record<string, number> = { ...firstRec.ruleScores };
        const frozenSkill = firstRec.materializedAfter.find((id) => cat.byId.get(id)?.kind === "skill") ?? null;
        const frozen = new MockBackend(frozenRules, frozenSkill);
        const sess = new ProgressiveSession({
          runId, sessionId: `${scenario.id}-${arm}`, arm: "static_initial",
          goal: scenario.description, catalogHash: cat.hash, bodies: cat.bodies,
          rules: cat.rules, skills: cat.skills, byId: cat.byId, cfg,
          backend: frozen, loadAllTokens,
        });
        const recs: TelemetryRecord[] = [];
        for (const ev of scenario.events) {
          const r = await sess.runEvent({ kind: ev.kind, text: ev.text, phase: ev.phase });
          r.providerEvidenceClass = "static_initial";
          recs.push(r);
        }
        armResults.push(await evaluateArm(scenario, arm, recs));
        allRecords.push(...recs);
        continue;
      }

      let backend: ScoreBackend;
      let sessionArm: Arm = arm;
      if (arm === "load_all") {
        backend = new MockBackend({});
      } else if (arm === "progressive_jev") {
        backend = jevBackend;
      } else {
        // oracle_dynamic: gold selection per event, upper bound only.
        backend = mockFromGold(scenario);
        sessionArm = "oracle_dynamic";
      }
      const sess = new ProgressiveSession({
        runId, sessionId: `${scenario.id}-${arm}`, arm: sessionArm,
        goal: scenario.description, catalogHash: cat.hash, bodies: cat.bodies,
        rules: cat.rules, skills: cat.skills, byId: cat.byId, cfg,
        backend, loadAllTokens,
      });
      const recs: TelemetryRecord[] = [];
      for (const ev of scenario.events) {
        if (arm === "oracle_dynamic") {
          // Swap in a per-event oracle mock: gold rules at 1.0, gold skill selected.
          const gold = goldIds(cat, ev.gold_rules ?? [], ev.gold_skill ?? null);
          const canned: Record<string, number> = {};
          for (const r of cat.rules) canned[r.id] = gold.rules.includes(r.id) ? 1 : 0;
          (sess as unknown as { opts: { backend: ScoreBackend } }).opts.backend = new MockBackend(canned, gold.skill);
        }
        const r = await sess.runEvent({ kind: ev.kind, text: ev.text, phase: ev.phase });
        if (arm === "oracle_dynamic") r.providerEvidenceClass = "oracle";
        recs.push(r);
      }
      armResults.push(await evaluateArm(scenario, arm, recs));
      allRecords.push(...recs);
    }
  }

  async function evaluateArm(scenario: Scenario, arm: Arm, recs: TelemetryRecord[]): Promise<ArmResult> {
    const events = recs.map((r, i) => {
      const ev = scenario.events[i];
      const gold = goldIds(cat, ev.gold_rules ?? [], ev.gold_skill ?? null);
      const metrics = scoreEvent(cat, r.materializedAfter, gold.rules, gold.skill);
      return { seq: ev.seq, phase: ev.phase, goldRules: gold.rules, goldSkill: gold.skill, materialized: r.materializedAfter, metrics };
    });
    return { arm, scenarioId: scenario.id, records: recs, events };
  }

  // Aggregate summary.
  const summary = arms.map((arm) => {
    const mine = armResults.filter((r) => r.arm === arm);
    const evts = mine.flatMap((r) => r.events);
    const avg = (f: (e: (typeof evts)[number]) => number): number => evts.reduce((a, e) => a + f(e), 0) / Math.max(1, evts.length);
    const dynTokens = evts.reduce((a, e) => a + e.metrics.dynTokens, 0);
    const staleTokens = evts.reduce((a, e) => a + e.metrics.staleTokens, 0);
    const missingTokens = evts.reduce((a, e) => a + e.metrics.missingTokens, 0);
    const skillHits = evts.filter((e) => e.metrics.skillMatch).length;
    const critMiss = evts.filter((e) => e.metrics.criticalRecall < 1).length;
    const evidenceClasses = [...new Set(mine.flatMap((r) => r.records.map((x) => x.providerEvidenceClass)))];
    return {
      arm, scenarios: mine.length, events: evts.length,
      rulePrecision: avg((e) => e.metrics.rulePrecision),
      ruleRecall: avg((e) => e.metrics.ruleRecall),
      criticalMisses: critMiss,
      skillAccuracy: evts.length === 0 ? 0 : skillHits / evts.length,
      dynTokens, staleTokens, missingTokens,
      staleRatio: dynTokens === 0 ? 0 : staleTokens / dynTokens,
      evidenceClasses,
    };
  });

  const artifact = {
    runId,
    kind: "scripted-four-arm",
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    provenance,
    versions,
    catalogHash: cat.hash,
    catalogCounts: { rules: cat.rules.length, skills: cat.skills.length },
    thresholdsConfig: cfg,
    thresholdsHash: cfgHash,
    arms,
    providerBackend: apiKey ? "provider_backed" : "fail_open(heuristic, TYPESAFE_API_KEY unset)",
    summary,
    armResults: armResults.map((r) => ({ arm: r.arm, scenarioId: r.scenarioId, events: r.events })),
    records: allRecords,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = outArg ?? join(RESULTS_DIR, `${runId}.json`);
  await writeFile(outPath, JSON.stringify(artifact, null, 2));
  console.log(outPath);
  void REPO_ROOT;
}

await main();
