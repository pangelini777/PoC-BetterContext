// Shared eval helpers: provenance, versions, scenario loading, gold metrics.
// Gold labels are loaded here (evaluator-only) and must never be passed to
// backends or agent prompts; callers strip them before routing.

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import type { Catalog } from "../../packages/apm-catalog/src/catalog.ts";
import type { EventMetrics, Scenario } from "../../packages/protocol/src/types.ts";
import { assertProvenance } from "../../packages/progressive-context/src/provenance.ts";

export const REPO_ROOT = resolve(import.meta.dir + "/../..");
export const PKG_DIR = join(REPO_ROOT, "fixtures/apm-package");
export const SCENARIOS_DIR = join(REPO_ROOT, "fixtures/scenarios");
export const RESULTS_DIR = join(REPO_ROOT, "evals/progressive-context/results");
export const CONFIG_PATH = join(REPO_ROOT, "config/thresholds.json");

export function checkProvenance(extra: Record<string, string> = {}): Record<string, string> {
  const paths: Record<string, string> = {
    repo: REPO_ROOT,
    package: PKG_DIR,
    scenarios: SCENARIOS_DIR,
    results: RESULTS_DIR,
    cwd: process.cwd(),
    ...extra,
  };
  assertProvenance(paths);
  return Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, resolve(p)]));
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: 15_000 }, (err, stdout) => {
      res(err ? `unavailable:${String(err.message).slice(0, 80)}` : String(stdout).trim().split("\n")[0]);
    });
  });
}

export async function collectVersions(): Promise<Record<string, string>> {
  const [apm, opencode] = await Promise.all([run("apm", ["--version"]), run("opencode", ["--version"])]);
  return {
    repoCommit: await run("git", ["-C", REPO_ROOT, "rev-parse", "--short", "HEAD"]),
    os: `${process.platform}-${process.arch}`,
    bun: Bun.version,
    apm,
    opencode,
    agentModel: process.env["AGENT_MODEL"] ?? "unset",
    jevModel: process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest",
  };
}

export async function loadScenarios(dir = SCENARIOS_DIR): Promise<Scenario[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const out: Scenario[] = [];
  for (const f of files) {
    const s = JSON.parse(await readFile(join(dir, f), "utf8")) as Scenario;
    out.push(s);
  }
  return out;
}

export async function loadThresholds() {
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
}

export function goldIds(cat: Catalog, shortRules: string[], shortSkill: string | null): { rules: string[]; skill: string | null } {
  const rules = shortRules.map((s) => (s.includes(".") ? s : `rule.${s}`));
  for (const r of rules) {
    if (!cat.byId.has(r)) throw new Error(`scenario references unknown gold rule ${r}`);
  }
  const skill = shortSkill === null || shortSkill === undefined ? null : shortSkill.includes(".") ? shortSkill : `skill.${shortSkill}`;
  if (skill !== null && !cat.byId.has(skill)) throw new Error(`scenario references unknown gold skill ${skill}`);
  return { rules, skill };
}

/** Evaluator-only comparison of materialized ids vs gold. Empty-gold + empty-materialized = perfect. */
export function scoreEvent(
  cat: Catalog,
  materialized: string[],
  goldRules: string[],
  goldSkill: string | null,
): EventMetrics {
  const mat = new Set(materialized);
  const gold = new Set(goldRules);
  const inter = [...mat].filter((id) => gold.has(id) && cat.byId.get(id)?.kind === "rule");
  const goldRuleCount = goldRules.length;
  const matRuleCount = materialized.filter((id) => cat.byId.get(id)?.kind === "rule").length;
  const rulePrecision = matRuleCount === 0 ? (goldRuleCount === 0 ? 1 : 0) : inter.length / matRuleCount;
  const ruleRecall = goldRuleCount === 0 ? (matRuleCount === 0 ? 1 : 0) : inter.length / goldRuleCount;
  const critGold = goldRules.filter((id) => cat.byId.get(id)?.critical);
  const critHit = critGold.filter((id) => mat.has(id));
  const criticalRecall = critGold.length === 0 ? 1 : critHit.length / critGold.length;
  const matSkill = materialized.find((id) => cat.byId.get(id)?.kind === "skill") ?? null;
  const skillMatch = matSkill === goldSkill;
  const noSkillCorrect = goldSkill === null ? matSkill === null : true;
  const tok = (id: string): number => cat.byId.get(id)?.estimatedTokens ?? 0;
  const dynTokens = materialized.reduce((a, id) => a + tok(id), 0);
  const staleTokens = materialized.filter((id) => !gold.has(id) && !(goldSkill !== null && id === goldSkill)).reduce((a, id) => a + tok(id), 0);
  const missingTokens = [...gold, ...(goldSkill ? [goldSkill] : [])].filter((id) => !mat.has(id)).reduce((a, id) => a + tok(id), 0);
  const goldTokens = [...gold, ...(goldSkill ? [goldSkill] : [])].reduce((a, id) => a + tok(id), 0);
  return {
    rulePrecision,
    ruleRecall,
    criticalRecall,
    skillMatch,
    noSkillCorrect,
    materializedCount: materialized.length,
    dynTokens,
    staleTokens,
    missingTokens,
    staleRatio: dynTokens === 0 ? (staleTokens === 0 ? 0 : 1) : staleTokens / dynTokens,
    missingRatio: goldTokens === 0 ? 0 : missingTokens / goldTokens,
  };
}
