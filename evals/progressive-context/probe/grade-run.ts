// One-shot Noul grading of a stored probe-eval artifact. Reads the artifact,
// runs gradeProbe per probe per arm (deterministic + SystemOne Noul batched
// ONE systemOne call per probe: Noul comprehension + Choice eviction per
// evicted id + Choice disposition for distractors), derives probe quality
// metrics in the scripted quality vocabulary, writes
// <artifact>.grades.json alongside. Fail-open: Noul errors yield nulls.
//
// Probe definitions come from the artifact itself when embedded
// (artifact.probeSet + artifact.recallTemplate + artifact.evaluator, with
// artifact.probeSetHash / artifact.evaluatorHash verified when present):
// regrading an embedded artifact never touches the fixture files. Fixture
// files (fixtures/probe-questions{,-v2,-v3}.json) are read ONLY for legacy
// artifacts that lack an embedded probeSet; that fallback is recorded as
// fallback:true in the output. Version strings are never imported from
// fixtures when the artifact carries them.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { endorsedIds, gradeProbe } from "./grade.ts";

const artifactPath = process.argv[2];
if (!artifactPath) {
  console.error("usage: grade-run.ts <probe-artifact.json>");
  process.exit(2);
}
const apiKey = process.env["TYPESAFE_API_KEY"] ?? "";
const model = process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest";

const data = JSON.parse(await readFile(artifactPath, "utf8")) as {
  trials: { arm: string; probeResults: { probeId: string; phase?: string; question?: string; answer: string; materializedIds: string[] | null; evictedIds?: string[] | null; contextTokens: number }[] }[];
  bodies: Record<string, string>;
  probeSetVersion?: string;
  probeSet?: ProbeFixture[];
  recallTemplate?: { idSuffix: string; question: string };
  evaluator?: { name: string; version: string; retrieval: string; noul: string; selfReport: string };
  probeSetHash?: string;
  evaluatorHash?: string;
};
type ProbeFixture = { id: string; phase: string; question: string; expectedIds: string[]; expectedSkills: string[]; forbiddenIds: string[]; mustCite: string[]; mustQuote: string[]; mustNotCite: string[] };

/** Canonical JSON: object keys sorted recursively, matching the runners' hash input. */
const canonicalize = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonicalize((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
};
const sha16 = (v: unknown): string =>
  createHash("sha256").update(JSON.stringify(canonicalize(v))).digest("hex").slice(0, 16);

const byId: Record<string, ProbeFixture> = {};
let fallback = false;
let probeSetVersion: string | undefined = data.probeSetVersion;
let probeSetHash: string | undefined = data.probeSetHash;
let evaluatorHash: string | undefined = data.evaluatorHash;
let evaluatorVersion: string | undefined = data.evaluator?.version;
let recallTemplate: { idSuffix: string; question: string } | undefined = data.recallTemplate;
const warnings: string[] = [];
/** Default recall question when neither the trial result nor the embedded
 * recallTemplate carries one (matches the runners' hardcoded default). */
const DEFAULT_RECALL_QUESTION = "You have answered several questions across phases. Without quoting rule text, list the rule/skill ids that are still active constraints on your current work. Answer template: Rules: <comma list or none>.";
/** A recall probe: synthesized at phase boundaries (id suffix from the
 * embedded recallTemplate, default `-recall`; or phase `recall`). */
const isRecallProbe = (probeId: string, probe: ProbeFixture | undefined): boolean =>
  probeId.endsWith(recallTemplate?.idSuffix ?? "-recall") || probe?.phase === "recall";

if (Array.isArray(data.probeSet) && data.probeSet.length > 0) {
  // Embedded artifact: definitions travel with the artifact; fixtures stay unread.
  for (const probe of data.probeSet) byId[probe.id] = probe;
  if (typeof data.probeSetHash === "string" && data.probeSetHash.length > 0) {
    const actual = sha16(data.probeSet);
    if (actual !== data.probeSetHash) {
      warnings.push(`probeSetHash mismatch: artifact claims ${data.probeSetHash}, recomputed ${actual}; proceeding with embedded probeSet`);
    }
  }
  if (data.evaluator !== undefined) {
    if (typeof data.evaluatorHash === "string" && data.evaluatorHash.length > 0) {
      const actual = sha16(data.evaluator);
      if (actual !== data.evaluatorHash) {
        warnings.push(`evaluatorHash mismatch: artifact claims ${data.evaluatorHash}, recomputed ${actual}; proceeding with embedded evaluator`);
      }
    }
  } else if (typeof data.evaluatorHash === "string") {
    warnings.push("evaluatorHash present but no embedded evaluator; proceeding without evaluator verification");
  }
} else {
  // Legacy artifact without an embedded probeSet: fall back to fixture files.
  fallback = true;
  const fixtureFiles = ["fixtures/probe-questions.json", "fixtures/probe-questions-v2.json", "fixtures/probe-questions-v3.json"];
  const fixtureVersions: string[] = [];
  for (const file of fixtureFiles) {
    try {
      const fixture = JSON.parse(await readFile(file, "utf8")) as { version?: string; probes: ProbeFixture[]; recallTemplate?: { idSuffix: string; question: string } };
      for (const probe of fixture.probes) byId[probe.id] = probe;
      if (typeof fixture.version === "string") fixtureVersions.push(fixture.version);
      if (!recallTemplate && fixture.recallTemplate) recallTemplate = fixture.recallTemplate;
    } catch {
      // Missing fixture file: probes from it are skipped, never fatal.
    }
  }
  if (probeSetVersion === undefined && fixtureVersions.length > 0) probeSetVersion = fixtureVersions.join("+");
  console.error(`[grade-run] legacy artifact without embedded probeSet; falling back to fixture files (fallback:true)`);
}
for (const w of warnings) console.error(`[grade-run] WARNING: ${w}`);

// Critical rule ids from the catalog sidecar (critical: true entries).
const CRITICAL_IDS = new Set([
  "rule.auth-session-security",
  "rule.privacy-personal-data",
  "rule.payments-card-data",
  "rule.secrets-management",
  "rule.refund-chargeback",
  "rule.audit-trails",
  "rule.gdpr-deletion",
  "rule.incident-response",
]);

const tok = (id: string): number => Math.max(1, Math.ceil(((data.bodies ?? {})[id] ?? "").length / 4));
const norm = (id: string): string => id.toLowerCase();

const arms: Record<string, unknown[]> = {};
const quality: Record<string, unknown> = {};
let totalUsage = { input_tokens: 0, output_tokens: 0 };
for (const trial of data.trials) {
  const grades: unknown[] = [];
  // Evicted ids accumulate across the arm's session: any id evicted on an
  // earlier probe stays evicted for later probes. Per-probe evictedIds (when
  // the runner provides them) extend the set; runner-owned materializedIds
  // shrink it (a re-materialized id is no longer evicted).
  const evictedSoFar = new Set<string>();
  const probeResults = trial.probeResults ?? [];
  for (let idx = 0; idx < probeResults.length; idx += 1) {
    const result = probeResults[idx];
    for (const id of result.evictedIds ?? []) evictedSoFar.add(id);
    const materialized = result.materializedIds ?? null;
    if (materialized !== null) for (const id of materialized) evictedSoFar.delete(id);
    let probe = byId[result.probeId];
    if (!probe && isRecallProbe(result.probeId, undefined)) {
      // Runner-synthesized recall probe not in the probe map (recall probes
      // are excluded from the embedded probeSet by contract): fall back to
      // the previous content probe's expected set as the still-active set.
      const prev = probeResults.slice(0, idx).reverse().find((r) => !isRecallProbe(r.probeId, byId[r.probeId]));
      const prevFixture = prev ? byId[prev.probeId] : undefined;
      probe = {
        id: result.probeId,
        phase: result.phase ?? "recall",
        question: result.question ?? recallTemplate?.question ?? DEFAULT_RECALL_QUESTION,
        expectedIds: prevFixture?.expectedIds ?? [],
        expectedSkills: [],
        forbiddenIds: [],
        mustCite: prevFixture?.expectedIds ?? [],
        mustQuote: [],
        mustNotCite: [],
      };
    }
    if (!probe) continue;
    // Thread evicted ids/bodies: evicted-so-far minus anything currently
    // materialized, intersected with the bodies snapshot (unknown bodies
    // cannot be graded and are dropped).
    const bodies = data.bodies ?? {};
    const evictedBodies: Record<string, string> = {};
    for (const id of evictedSoFar) {
      if (materialized !== null && materialized.some((m) => norm(m) === norm(id))) continue;
      if (typeof bodies[id] === "string" && bodies[id].length > 0) evictedBodies[id] = bodies[id];
    }
    const grade = await gradeProbe(probe, result.answer, materialized, bodies, { apiKey, model }, evictedBodies);
    totalUsage.input_tokens += grade.usage.input_tokens;
    totalUsage.output_tokens += grade.usage.output_tokens;
    grades.push({ probeId: result.probeId, retrieval: grade.retrieval, noul: grade.noul, disposition: grade.disposition, evictions: grade.evictions, selfReport: grade.selfReport, noulError: grade.noulError });
  }
  arms[trial.arm] = grades;

  // Probe-derived quality in scripted vocabulary (endorsement = Rules line).
  const results = trial.probeResults ?? [];
  // Discovery file tracing: which .agents rule/skill files the agent opened
  // (tool-call args). Gives the discovery arm a measured context number.
  const bodies = data.bodies ?? {};
  const tokOf = (id: string): number => Math.max(1, Math.ceil(((bodies as Record<string, string>)[id] ?? "").length / 4));
  const idForPath = (path: string): string | null => {
    const m = path.match(/\.agents\/(rules|skills)\/([^"'`\s\]]+)/);
    if (!m) return null;
    const slug = m[2].replace(/\/$/, "").replace(/\.md$/, "");
    if (m[1] === "rules") return `rule.${slug}`;
    return `skill.${slug.split("/")[0]}`;
  };
  const discoveredFiles: Record<string, { probes: string[]; tokens: number }> = {};
  for (const result of results as { probeId: string; toolCalls?: { name: string; args?: string }[] }[]) {
    for (const call of result.toolCalls ?? []) {
      if (call.name !== "read" && call.name !== "grep") continue;
      for (const token of (call.args ?? "").split(/[\s,"'`]+/)) {
        const id = idForPath(token);
        if (!id || !(bodies as Record<string, string>)[id]) continue;
        if (!discoveredFiles[id]) discoveredFiles[id] = { probes: [], tokens: tokOf(id) };
        if (!discoveredFiles[id].probes.includes(result.probeId)) discoveredFiles[id].probes.push(result.probeId);
      }
    }
  }
  const discoveredIds = Object.keys(discoveredFiles).sort();
  const discoveredTokens = discoveredIds.reduce((sum, id) => sum + tokOf(id), 0);
  // v3: eviction fidelity = mean over graded eviction turns of (1 - P(relies));
  // self-report accuracy = mean recallVsExpected over recall probes.
  let evictNum = 0; let evictDen = 0;
  let selfNum = 0; let selfDen = 0;
  for (const entry of grades as { probeId: string; evictions?: Record<string, { probabilities?: Record<string, number> } | null>; selfReport?: { recallVsExpected: number | null } | null }[]) {
    for (const ev of Object.values(entry.evictions ?? {})) {
      const p = ev?.probabilities?.["relies-on-evicted"];
      if (typeof p === "number" && Number.isFinite(p)) {
        evictNum += 1 - p;
        evictDen += 1;
      }
    }
    const r = entry.selfReport?.recallVsExpected;
    if (typeof r === "number" && Number.isFinite(r)) {
      selfNum += r;
      selfDen += 1;
    }
  }
  let precNum = 0; let precDen = 0;
  let recallNum = 0; let recallDen = 0;
  let criticalMisses = 0;
  let skillNum = 0; let skillDen = 0;
  let staleTokens = 0; let missingTokens = 0; let totalCtx = 0;
  for (const probeId of Object.keys(byId)) {
    const probe = byId[probeId];
    const result = results.find((r) => r.probeId === probeId);
    if (!result) continue;
    const endorsed = endorsedIds(result.answer) ?? [];
    if (endorsed.length > 0) {
      precDen += 1;
      const expected = new Set([...probe.expectedIds, ...probe.expectedSkills].map(norm));
      if (endorsed.every((entry) => expected.has(entry) || [...expected].some((id) => id.includes(entry) || entry.includes(id)))) precNum += 1;
    }
    if (probe.expectedIds.length > 0) {
      recallDen += 1;
      if (probe.expectedIds.every((id) => endorsed.some((entry) => entry.includes(norm(id)) || norm(id).includes(entry)))) recallNum += 1;
      else if (probe.expectedIds.some((id) => CRITICAL_IDS.has(id))) criticalMisses += 1;
    }
    if (probe.expectedSkills.length > 0) {
      skillDen += 1;
      if (probe.expectedSkills.every((id) => endorsed.some((entry) => entry.includes(norm(id)) || norm(id).includes(entry)))) skillNum += 1;
    }
    const expectedToks = [...probe.expectedIds, ...probe.expectedSkills].reduce((sum, id) => sum + tok(id), 0);
    totalCtx += result.contextTokens;
    staleTokens += Math.max(0, result.contextTokens - expectedToks);
    if (result.materializedIds !== null) {
      for (const id of probe.expectedIds) {
        if (!result.materializedIds.some((m) => norm(m) === norm(id))) missingTokens += tok(id);
      }
    }
  }
  quality[trial.arm] = {
    // Honest subset only. rulePrecision punishes endorsing extra CORRECT rules
    // (fixture expected sets are minimal, not exhaustive) and skillAccuracy is
    // a template artifact (skills cited in prose, never on Rules lines), so
    // both stay null rather than show numbers that punish correct behavior.
    // Stale context is already visible via Avg ctx/Peak ctx columns.
    rulePrecision: null,
    ruleRecall: recallDen > 0 ? recallNum / recallDen : 0,
    criticalMisses,
    skillAccuracy: null,
    staleTokens: 0,
    missingTokens,
    staleRatio: null,
    evictionFidelity: evictDen > 0 ? evictNum / evictDen : null,
    selfReportAccuracy: selfDen > 0 ? selfNum / selfDen : null,
    // Discovery file tracing: .agents files the agent actually opened.
    discoveredIds,
    discoveredTokens,
    discoveredFiles,
  };
}
const out = {
  artifact: artifactPath,
  model,
  gradedAt: new Date().toISOString(),
  usage: totalUsage,
  // Probe-source provenance: embedded definitions preferred; fixture files
  // only for legacy artifacts (fallback:true). Hash fields echo the verified
  // artifact values (undefined when the artifact lacks them).
  fallback,
  probeSetSource: fallback ? "fixture-fallback" : "embedded",
  probeSetVersion,
  probeSetHash,
  evaluatorVersion,
  evaluatorHash,
  warnings,
  arms,
  quality,
};
const outPath = `${artifactPath}.grades.json`;
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log(outPath);
for (const [arm, grades] of Object.entries(arms)) {
  const list = grades as { probeId: string; retrieval: { pass: boolean }; noul: Record<string, number | null>; disposition: { choice: string } | null; evictions?: Record<string, { probabilities?: Record<string, number> } | null>; selfReport?: { recallVsExpected: number | null } | null }[];
  console.log(`${arm}: retrieval ${list.filter((g) => g.retrieval.pass).length}/${list.length} quality=${JSON.stringify(quality[arm])}`);
  for (const g of list) {
    const evCount = Object.keys(g.evictions ?? {}).length;
    console.log(`  ${g.probeId} noul=${JSON.stringify(g.noul)} disposition=${g.disposition?.choice ?? "-"} evictions=${evCount} selfReport=${g.selfReport?.recallVsExpected ?? "-"}`);
  }
}
console.log(`usage: in=${totalUsage.input_tokens} out=${totalUsage.output_tokens}`);
