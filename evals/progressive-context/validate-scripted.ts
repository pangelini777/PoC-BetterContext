// Validates a scripted artifact against the plan's acceptance thresholds
// (sections 22D/E/F). Reports PASS/FAIL per criterion honestly; exits nonzero
// on any failure. Thresholds: recall >= 0.90, precision >= 0.75, zero critical
// misses, look-alike/no-skill checks, token-reduction checks. Intended for the
// progressive_jev arm; the caller selects which evidence class the artifact
// represents (provider_backed vs fail_open) via the artifact itself.

import { readFile } from "node:fs/promises";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: validate-scripted.ts <artifact.json>");
    process.exit(2);
  }
  const d = JSON.parse(await readFile(path, "utf8")) as {
    providerBackend: string;
    summary: { arm: string; rulePrecision: number; ruleRecall: number; criticalMisses: number; skillAccuracy: number; dynTokens: number; staleTokens: number; staleRatio: number; evidenceClasses: string[] }[];
    armResults: { arm: string; scenarioId: string; events: { seq: number; metrics: { skillMatch: boolean }; goldSkill: string | null; materialized: string[] }[] }[];
    records: { arm: string; sessionId: string; providerEvidenceClass: string; sentinelAssertions: { pass: boolean }[]; materializedAfter: string[] }[];
  };
  const checks: Check[] = [];
  const prog = d.summary.find((s) => s.arm === "progressive_jev")!;
  const loadAll = d.summary.find((s) => s.arm === "load_all")!;
  const statik = d.summary.find((s) => s.arm === "static_initial")!;
  const oracle = d.summary.find((s) => s.arm === "oracle_dynamic")!;

  const isProvider = d.providerBackend.startsWith("provider_backed");
  checks.push({
    name: "evidence-class-labeled",
    pass: true,
    detail: `backend=${d.providerBackend}; progressive evidence=${prog.evidenceClasses.join(",")}`,
  });

  // D: lifecycle proof on checkout-progressive.
  const checkoutRecs = d.records.filter((r) => r.arm === "progressive_jev" && r.sessionId.startsWith("checkout-progressive"));
  const matChanges = checkoutRecs.reduce((a, r) => a + (r as unknown as { added: string[] }).added.length, 0);
  const dematChanges = checkoutRecs.reduce((a, r) => a + (r as unknown as { removed: string[] }).removed.length, 0);
  checks.push({ name: "lifecycle>=3mat-2demat", pass: matChanges >= 3 && dematChanges >= 2, detail: `mat=${matChanges} demat=${dematChanges}` });

  // Sentinel: zero failures across all records.
  const sentinelFails = d.records.filter((r) => r.sentinelAssertions.some((a) => !a.pass)).length;
  checks.push({ name: "sentinel-zero-failures", pass: sentinelFails === 0, detail: `records with failures=${sentinelFails}` });

  // E: routing quality (strict gates only meaningful for provider-backed; still reported for fail_open).
  checks.push({ name: "recall>=0.90", pass: prog.ruleRecall >= 0.9, detail: `recall=${prog.ruleRecall.toFixed(3)}` });
  checks.push({ name: "precision>=0.75", pass: prog.rulePrecision >= 0.75, detail: `precision=${prog.rulePrecision.toFixed(3)}` });
  checks.push({ name: "zero-critical-misses", pass: prog.criticalMisses === 0, detail: `misses=${prog.criticalMisses}` });

  const find = (scenario: string, arm: string) => d.armResults.find((r) => r.scenarioId === scenario && r.arm === arm)!;
  const readonlySkill = find("readonly-db", "progressive_jev").events[0].materialized.find((m) => m.startsWith("skill."));
  checks.push({ name: "readonly-selects-readonly-query", pass: readonlySkill === "skill.postgres-readonly-query", detail: `selected=${readonlySkill}` });
  const webhookSkill = find("stripe-webhook-bug", "progressive_jev").events[0].materialized.find((m) => m.startsWith("skill."));
  checks.push({ name: "webhook-selects-handler", pass: webhookSkill === "skill.stripe-webhook-handler", detail: `selected=${webhookSkill}` });
  const noSkillMat = find("no-skill", "progressive_jev").events[0].materialized;
  checks.push({ name: "no-skill-quiet", pass: noSkillMat.length === 0, detail: `materialized=${JSON.stringify(noSkillMat)}` });
  // Distractors inactive for commerce scenarios.
  const commerceMat = d.armResults
    .filter((r) => r.arm === "progressive_jev" && !["no-skill"].includes(r.scenarioId))
    .flatMap((r) => r.events.flatMap((e) => e.materialized));
  const distractorHits = commerceMat.filter((m) => m === "rule.mobile-ios-guidelines" || m === "rule.ml-model-governance" || m === "skill.ios-swiftui-component" || m === "skill.ml-evaluation");
  checks.push({ name: "distractors-inactive", pass: distractorHits.length === 0, detail: `hits=${distractorHits.length}` });

  // F: context health.
  const dynReduction = 1 - prog.dynTokens / loadAll.dynTokens;
  const staleReduction = 1 - prog.staleTokens / loadAll.staleTokens;
  checks.push({ name: "dyn-token-reduction>=0.50", pass: dynReduction >= 0.5, detail: `reduction=${dynReduction.toFixed(3)}` });
  checks.push({ name: "stale-token-reduction>=0.40", pass: staleReduction >= 0.4, detail: `reduction=${staleReduction.toFixed(3)}` });
  const checkoutProg = d.armResults.find((r) => r.arm === "progressive_jev" && r.scenarioId === "checkout-progressive")!;
  const checkoutStat = d.armResults.find((r) => r.arm === "static_initial" && r.scenarioId === "checkout-progressive")!;
  const staleOf = (evts: typeof checkoutProg.events): number => {
    const s = evts.reduce((a, e) => a + (e as unknown as { metrics: { staleTokens: number } }).metrics.staleTokens, 0);
    const t = evts.reduce((a, e) => a + (e as unknown as { metrics: { dynTokens: number } }).metrics.dynTokens, 0);
    return t === 0 ? 0 : s / t;
  };
  const progStale = staleOf(checkoutProg.events);
  const statStale = staleOf(checkoutStat.events);
  checks.push({ name: "progressive-staleratio-beats-static-on-checkout", pass: progStale < statStale, detail: `prog=${progStale.toFixed(3)} static=${statStale.toFixed(3)}` });
  void oracle;
  void statik;

  console.log(JSON.stringify({ artifact: path, providerBackend: d.providerBackend, isProviderBacked: isProvider, checks }, null, 2));
  if (checks.some((c) => !c.pass)) process.exit(1);
}

await main();
