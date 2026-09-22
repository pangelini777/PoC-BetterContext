import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArmView, RunKind, RunsResponse, RunStatus, RunView } from "./types.ts";

type JsonObject = Record<string, unknown>;

/** Read <artifact>.grades.json quality map when present; null when absent. */
async function readGradesQuality(runId: string): Promise<Record<string, JsonObject> | null> {
  // Grades file is <artifact>.grades.json, i.e. <runId>.json.grades.json.
  for (const candidate of [join(RESULTS_ROOT, `${runId}.json.grades.json`), join(RESULTS_ROOT, `${runId}.grades.json`)]) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as { quality?: Record<string, JsonObject> };
      if (parsed !== null && typeof parsed === "object" && parsed.quality !== null && typeof parsed.quality === "object") {
        return parsed.quality as Record<string, JsonObject>;
      }
    } catch {
      // Try the next candidate name.
    }
  }
  return null;
}

const RESULTS_ROOT = join(import.meta.dir, "..", "results");
const INDEX_PATH = join(import.meta.dir, "index.html");
const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const ARM_LABELS: Record<string, string> = {
  load_all: "Load all",
  static_initial: "Static initial",
  progressive_jev: "Progressive JEV",
  oracle_dynamic: "Oracle dynamic",
  load_all_single: "Load all (single)",
  apm_discovery: "APM discovery",
  jev_single: "JEV single-session",
  probe_load_all: "Probe load-all",
  probe_discovery: "Probe discovery",
  probe_jev: "Probe JEV",
};

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asModel(value: unknown): string | null {
  const model = asString(value);
  return model === "unset" ? null : model;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asCount(value: unknown): number | null {
  const count = asNumber(value);
  return count !== null && Number.isInteger(count) && count >= 0 ? count : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  return value;
}

function asDate(value: unknown): string | null {
  const date = asString(value);
  return date !== null && Number.isFinite(Date.parse(date)) ? date : null;
}

function objects(value: unknown): JsonObject[] | null {
  if (!Array.isArray(value) || !value.every(isObject)) return null;
  return value;
}

function armLabel(name: string, trialId: string | null): string {
  const label = ARM_LABELS[name] ?? name.replaceAll("_", " ");
  return trialId === null ? label : `${label} · ${trialId.replaceAll("-", " ")}`;
}

function runLabel(kind: RunKind, id: string): string {
  const prefix = kind === "live-paired" ? "Live paired"
    : kind === "single-session" ? "Single session"
    : kind === "probe-eval" ? "Probe eval"
    : kind === "probe-multi" ? "Probe multi"
    : "Scripted";
  const suffix = id.replace(/^(probe-multi|live|scripted|single|probe)-/, "");
  return `${prefix} · ${suffix}`;
}

function emptyArm(name: string, label: string, status: RunStatus): ArmView {
  return {
    name,
    label,
    status,
    turns: null,
    durationMs: null,
    contextTokens: null,
    avgContextTokens: null,
    peakContextTokens: null,
    loadAllContextTokens: null,
    loadedResources: null,
    avgLoadedResources: null,
    materializations: null,
    dematerializations: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    verificationPassed: null,
    verificationTotal: null,
    eligible: null,
    eligibilityReasons: null,
    unloadMode: null,
    probeDetail: null,
    gradesPath: null,
    scenarios: null,
    events: null,
    rulePrecision: null,
    ruleRecall: null,
    criticalMisses: null,
    skillAccuracy: null,
    staleTokens: null,
    missingTokens: null,
    staleRatio: null,
    evictionFidelity: null,
    selfReportAccuracy: null,
  };
}

function latestRoutingContext(trial: JsonObject): JsonObject | null {
  if (isObject(trial.context)) return trial.context;
  const records = objects(trial.routingRecords);
  if (records === null) return null;
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (
      asCount(record.compiledResourceTokens) !== null ||
      asCount(record.loadAllResourceTokens) !== null ||
      Array.isArray(record.materializedAfter)
    ) {
      return record;
    }
  }
  return null;
}

function observedTransitionCount(trial: JsonObject, field: "added" | "removed"): number | null {
  const records = objects(trial.routingRecords);
  if (records === null) return null;
  let count = 0;
  for (const record of records) {
    if (!Array.isArray(record[field])) return null;
    count += record[field].length;
  }
  return count;
}
function contextSamples(trial: JsonObject): { tokens: number; resources: number }[] {
  if (isObject(trial.context)) {
    const tokens = asCount(trial.context.compiledResourceTokens);
    if (tokens === null) return [];
    const resources = asCount(trial.context.loadedResources) ??
      (Array.isArray(trial.context.materializedAfter) ? trial.context.materializedAfter.length : 0);
    return [{ tokens, resources }];
  }
  const records = objects(trial.routingRecords);
  if (records === null) return [];
  const samples: { tokens: number; resources: number }[] = [];
  for (const record of records) {
    const tokens = asCount(record.compiledResourceTokens);
    if (tokens === null) continue;
    const resources = Array.isArray(record.materializedAfter) ? record.materializedAfter.length : 0;
    samples.push({ tokens, resources });
  }
  return samples;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function observedVerification(verification: unknown): { passed: number | null; total: number | null } {
  if (!isObject(verification)) return { passed: null, total: null };
  const passed = asCount(verification.passed);
  const total = asCount(verification.total);
  if (passed !== null || total !== null) return { passed, total };

  const checks = objects(verification.checks);
  if (checks === null) return { passed: null, total: null };
  return {
    passed: checks.filter((check) => check.pass === true).length,
    total: checks.length,
  };
}

function normalizeLiveTrial(trial: JsonObject, runStatus: RunStatus): ArmView | null {
  const name = asString(trial.arm);
  if (name === null) return null;
  if (runStatus === "running" && trial.status !== "running" && trial.status !== "completed") return null;
  const trialId = asString(trial.trialId);
  const status = runStatus === "completed"
    ? "completed"
    : trial.status === "completed"
      ? "completed"
      : "running";
  const view = emptyArm(name, armLabel(name, trialId), status);
  const context = latestRoutingContext(trial);
  const tokens = isObject(trial.agentTokens) ? trial.agentTokens : null;
  const verification = observedVerification(trial.verification);
  const eligibility = isObject(trial.eligibility) ? trial.eligibility : null;

  view.turns = asCount(trial.turns) ?? (Array.isArray(trial.turnRecords) ? trial.turnRecords.length : null);
  view.durationMs = asCount(trial.durationMs);
  view.contextTokens = context === null ? null : asCount(context.compiledResourceTokens);
  view.loadAllContextTokens = context === null ? null : asCount(context.loadAllResourceTokens);
  view.loadedResources = context === null
    ? null
    : asCount(context.loadedResources) ?? (Array.isArray(context.materializedAfter) ? context.materializedAfter.length : null);
  const samples = contextSamples(trial);
  if (samples.length > 0) {
    view.avgContextTokens = average(samples.map((sample) => sample.tokens));
    view.peakContextTokens = Math.max(...samples.map((sample) => sample.tokens));
    view.avgLoadedResources = average(samples.map((sample) => sample.resources));
  }
  view.materializations = asCount(trial.materializations) ?? observedTransitionCount(trial, "added");
  view.dematerializations = asCount(trial.dematerializations) ?? observedTransitionCount(trial, "removed");
  view.inputTokens = tokens === null ? null : asCount(tokens.input);
  view.outputTokens = tokens === null ? null : asCount(tokens.output);
  view.totalTokens = tokens === null ? null : asCount(tokens.total);
  view.verificationPassed = verification.passed;
  view.verificationTotal = verification.total;
  view.eligible = eligibility === null ? null : asBoolean(eligibility.eligible);
  view.eligibilityReasons = eligibility === null ? null : asStringArray(eligibility.reasons);
  return view;
}

function normalizeLiveArtifact(artifact: JsonObject): RunView | null {
  const id = asString(artifact.runId);
  const createdAt = asDate(artifact.createdAt);
  const trials = objects(artifact.trials);
  if (id === null || createdAt === null || trials === null) return null;

  const isProgressSidecar = artifact.status === "running";
  if (isProgressSidecar && artifact.schemaVersion !== 1) return null;
  const status: RunStatus = isProgressSidecar ? "running" : "completed";
  const updatedAt = status === "running" ? asDate(artifact.updatedAt) : asDate(artifact.updatedAt) ?? createdAt;
  if (updatedAt === null) return null;

  const arms = trials.map((trial) => normalizeLiveTrial(trial, status)).filter((arm): arm is ArmView => arm !== null);
  const versions = isObject(artifact.versions) ? artifact.versions : null;
  const firstTrial = trials[0];
  return {
    id,
    label: runLabel("live-paired", id),
    kind: "live-paired",
    status,
    createdAt,
    updatedAt,
    model: asModel(artifact.model) ?? asModel(versions?.agentModel) ?? asModel(firstTrial?.model),
    routingBackend: asString(artifact.routingBackend),
    arms,
  };
}

function normalizeScriptedArtifact(artifact: JsonObject): RunView | null {
  const id = asString(artifact.runId);
  const createdAt = asDate(artifact.createdAt);
  const summary = objects(artifact.summary);
  if (id === null || createdAt === null || summary === null) return null;

  const loadAllSummary = summary.find((entry) => entry.arm === "load_all");
  const loadAllContextTokens = loadAllSummary === undefined ? null : asCount(loadAllSummary.dynTokens);
  const arms: ArmView[] = [];
  for (const entry of summary) {
    const name = asString(entry.arm);
    if (name === null) continue;
    const view = emptyArm(name, armLabel(name, null), "completed");
    view.contextTokens = asCount(entry.dynTokens);
    view.loadAllContextTokens = loadAllContextTokens;
    view.scenarios = asCount(entry.scenarios);
    view.events = asCount(entry.events);
    view.rulePrecision = asNumber(entry.rulePrecision);
    view.ruleRecall = asNumber(entry.ruleRecall);
    view.criticalMisses = asCount(entry.criticalMisses);
    view.skillAccuracy = asNumber(entry.skillAccuracy);
    view.staleTokens = asCount(entry.staleTokens);
    view.missingTokens = asCount(entry.missingTokens);
    view.staleRatio = asNumber(entry.staleRatio);
    arms.push(view);
  }

  const versions = isObject(artifact.versions) ? artifact.versions : null;
  return {
    id,
    label: runLabel("scripted-four-arm", id),
    kind: "scripted-four-arm",
    status: "completed",
    createdAt,
    updatedAt: asDate(artifact.updatedAt) ?? createdAt,
    model: asModel(artifact.model) ?? asModel(versions?.agentModel),
    routingBackend: asString(artifact.providerBackend) ?? asString(artifact.routingBackend),
    arms,
  };
}

export async function normalizeArtifact(value: unknown): Promise<RunView | null> {
  if (!isObject(value)) return null;
  if (value.kind === "live-paired") return normalizeLiveArtifact(value);
  if (value.kind === "scripted-four-arm") return normalizeScriptedArtifact(value);
  if (value.kind === "single-session") return normalizeSingleArtifact(value);
  if (value.kind === "probe-eval") return normalizeProbeArtifact(value);
  if (value.kind === "probe-multi") return normalizeProbeMultiArtifact(value);
  return null;
}

async function normalizeProbeArtifact(artifact: JsonObject): Promise<RunView | null> {
  const id = asString(artifact.runId);
  const createdAt = asDate(artifact.createdAt);
  const trials = objects(artifact.trials);
  if (id === null || createdAt === null || trials === null) return null;
  const isProgressSidecar = artifact.status === "running";
  if (isProgressSidecar && artifact.schemaVersion !== 1) return null;
  const status: RunStatus = isProgressSidecar ? "running" : "completed";
  const updatedAt = status === "running" ? asDate(artifact.updatedAt) : asDate(artifact.updatedAt) ?? createdAt;
  if (updatedAt === null) return null;
  const arms: ArmView[] = [];
  for (const trial of trials) {
    const name = asString(trial.arm);
    if (name === null) continue;
    const trialId = asString(trial.trialId);
    const rawStatus = asString(trial.status);
    const armStatus: RunStatus = rawStatus === "completed" || rawStatus === "dry-run" || rawStatus === "failed" || rawStatus === "skipped"
      ? rawStatus
      : status;
    const view = emptyArm(name, armLabel(name, trialId), armStatus);
    const results = objects(trial.probeResults);
    const tokens = isObject(trial.agentTokens) ? trial.agentTokens : null;
    const samples = results === null ? [] : results.map((result) => asCount(result.contextTokens) ?? 0);
    const matCounts = results === null ? [] : results.map((result) => Array.isArray(result.materializedIds) ? result.materializedIds.length : null);
    const last = samples.length > 0 ? samples[samples.length - 1] : null;
    const lastMat = matCounts.length > 0 ? matCounts[matCounts.length - 1] : null;
    const probePass = results === null ? [] : results.map((result) => {
      const retrieval = isObject(result.retrieval) ? result.retrieval : null;
      if (retrieval === null) return null;
      const cited = asBoolean(retrieval.citedExpected);
      const forbidden = asBoolean(retrieval.citedForbidden);
      const quote = asBoolean(retrieval.quoteHit);
      if (cited === null || forbidden === null || quote === null) return null;
      return cited && !forbidden && quote;
    });
    const passed = probePass.filter((pass) => pass === true).length;
    view.turns = results === null ? asCount(trial.turns) : results.length;
    view.durationMs = asCount(trial.durationMs);
    view.contextTokens = last;
    view.loadAllContextTokens = null;
    view.loadedResources = lastMat;
    if (samples.length > 0) {
      view.avgContextTokens = average(samples);
      view.peakContextTokens = Math.max(...samples);
    }
    const matKnown = matCounts.filter((count): count is number => count !== null);
    if (matKnown.length > 0) view.avgLoadedResources = average(matKnown);
    view.inputTokens = tokens === null ? null : asCount(tokens.input);
    view.outputTokens = tokens === null ? null : asCount(tokens.output);
    view.totalTokens = tokens === null ? null : asCount(tokens.total);
    view.verificationPassed = results === null ? null : passed;
    view.verificationTotal = results === null ? null : probePass.length;
    view.eligible = null;
    view.eligibilityReasons = null;
    view.unloadMode = asString(trial.unloadMode);
    view.probeDetail = null;
    view.gradesPath = `${id}.grades.json`;
    view.scenarios = null;
    view.events = results === null ? null : results.length;
    // Honest quality subset from <artifact>.grades.json (written post-run by
    // probe/grade-run.ts). Only recall, critical misses, and missing tokens
    // are fixture-grounded; precision/skill/stale stay null by design.
    const grades = await readGradesQuality(id);
    const armQuality = grades === null ? null : grades[name];
    view.rulePrecision = null;
    view.ruleRecall = armQuality === null ? null : asNumber(armQuality.ruleRecall);
    view.criticalMisses = armQuality === null ? null : asCount(armQuality.criticalMisses);
    view.skillAccuracy = null;
    view.staleTokens = null;
    view.missingTokens = armQuality === null ? null : asCount(armQuality.missingTokens);
    view.staleRatio = null;
    view.evictionFidelity = armQuality === null ? null : asNumber(armQuality.evictionFidelity);
    view.selfReportAccuracy = armQuality === null ? null : asNumber(armQuality.selfReportAccuracy);
    arms.push(view);
  }
  const versions = isObject(artifact.versions) ? artifact.versions : null;
  const firstTrial = trials[0];
  return {
    id,
    label: runLabel("probe-eval", id),
    kind: "probe-eval",
    status,
    createdAt,
    updatedAt,
    model: asModel(artifact.model) ?? asModel(versions?.agentModel) ?? asModel(firstTrial?.model),
    routingBackend: asString(artifact.routingBackend),
    arms,
  };
}

async function normalizeProbeMultiArtifact(artifact: JsonObject): Promise<RunView | null> {
  const view = await normalizeProbeArtifact(artifact);
  if (view === null) return null;
  return { ...view, label: runLabel("probe-multi", view.id), kind: "probe-multi" };
}

function singleSamples(trial: JsonObject): { tokens: number; resources: number }[] {
  const samples = objects(trial.contextSamples);
  if (samples === null) return [];
  const out: { tokens: number; resources: number }[] = [];
  for (const sample of samples) {
    const tokens = asCount(sample.compiledResourceTokens);
    if (tokens === null) continue;
    out.push({ tokens, resources: asCount(sample.loadedResources) ?? 0 });
  }
  return out;
}

function normalizeSingleTrial(trial: JsonObject, runStatus: RunStatus): ArmView | null {
  const name = asString(trial.arm);
  if (name === null) return null;
  const trialId = asString(trial.trialId);
  const rawStatus = asString(trial.status);
  const status: RunStatus = rawStatus === "completed" || rawStatus === "dry-run" || rawStatus === "failed" || rawStatus === "skipped"
    ? rawStatus
    : runStatus === "completed" ? "completed" : "running";
  const view = emptyArm(name, armLabel(name, trialId), status);
  const tokens = isObject(trial.agentTokens) ? trial.agentTokens : null;
  const verification = observedVerification(trial.verification);
  const eligibility = isObject(trial.eligibility) ? trial.eligibility : null;
  const samples = singleSamples(trial);
  const last = samples.length > 0 ? samples[samples.length - 1] : null;
  view.turns = samples.length > 0 ? samples.length : asCount(trial.turns);
  view.durationMs = asCount(trial.durationMs);
  view.contextTokens = last === null ? null : last.tokens;
  view.loadAllContextTokens = null;
  view.loadedResources = last === null ? null : last.resources;
  if (samples.length > 0) {
    view.avgContextTokens = average(samples.map((sample) => sample.tokens));
    view.peakContextTokens = Math.max(...samples.map((sample) => sample.tokens));
    view.avgLoadedResources = average(samples.map((sample) => sample.resources));
  }
  view.inputTokens = tokens === null ? null : asCount(tokens.input);
  view.outputTokens = tokens === null ? null : asCount(tokens.output);
  view.totalTokens = tokens === null ? null : asCount(tokens.total);
  view.verificationPassed = verification.passed;
  view.verificationTotal = verification.total;
  view.eligible = eligibility === null ? null : asBoolean(eligibility.eligible);
  view.eligibilityReasons = eligibility === null ? null : asStringArray(eligibility.reasons);
  view.unloadMode = asString(trial.unloadMode);
  return view;
}

function normalizeSingleArtifact(artifact: JsonObject): RunView | null {
  const id = asString(artifact.runId);
  const createdAt = asDate(artifact.createdAt);
  const trials = objects(artifact.trials);
  if (id === null || createdAt === null || trials === null) return null;
  const isProgressSidecar = artifact.status === "running";
  if (isProgressSidecar && artifact.schemaVersion !== 1) return null;
  const status: RunStatus = isProgressSidecar ? "running" : "completed";
  const updatedAt = status === "running" ? asDate(artifact.updatedAt) : asDate(artifact.updatedAt) ?? createdAt;
  if (updatedAt === null) return null;
  const arms = trials.map((trial) => normalizeSingleTrial(trial, status)).filter((arm): arm is ArmView => arm !== null);
  const versions = isObject(artifact.versions) ? artifact.versions : null;
  const firstTrial = trials[0];
  return {
    id,
    label: runLabel("single-session", id),
    kind: "single-session",
    status,
    createdAt,
    updatedAt,
    model: asModel(artifact.model) ?? asModel(versions?.agentModel) ?? asModel(firstTrial?.model),
    routingBackend: asString(artifact.routingBackend),
    arms,
  };
}

async function jsonFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".json"))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

async function readRun(path: string): Promise<RunView | null> {
  try {
    const artifact: unknown = JSON.parse(await Bun.file(path).text());
    return normalizeArtifact(artifact);
  } catch {
    return null;
  }
}

async function loadRuns(): Promise<RunView[]> {
  // Only these two directories are admitted. Nested quarantine/private folders,
  // symlinks, documentation, and every non-JSON file are never opened.
  const paths = [
    ...(await jsonFiles(RESULTS_ROOT)),
    ...(await jsonFiles(join(RESULTS_ROOT, ".live"))),
  ];
  const normalized = await Promise.all(paths.map(readRun));
  const byId = new Map<string, RunView>();

  for (const run of normalized) {
    if (run === null) continue;
    const current = byId.get(run.id);
    if (
      current === undefined ||
      (current.status === "running" && run.status === "completed") ||
      (current.status === run.status && Date.parse(run.updatedAt) > Date.parse(current.updatedAt))
    ) {
      byId.set(run.id, run);
    }
  }

  return [...byId.values()].sort((left, right) => {
    const createdDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return createdDifference !== 0 ? createdDifference : Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function dashboardPort(): number {
  const configured = Number(process.env.DASHBOARD_PORT);
  return Number.isInteger(configured) && configured > 0 && configured <= 65_535 ? configured : 4317;
}

export function startDashboardServer() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: dashboardPort(),
    async fetch(request) {
      if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
      const pathname = new URL(request.url).pathname;

      if (pathname === "/api/runs") {
        try {
          const response: RunsResponse = { generatedAt: new Date().toISOString(), runs: await loadRuns() };
          return jsonResponse(response);
        } catch {
          return jsonResponse({ error: "Unable to load benchmark runs" }, 500);
        }
      }

      if (pathname === "/") {
        try {
          const file = Bun.file(INDEX_PATH);
          if (!(await file.exists())) return new Response("Dashboard unavailable", { status: 500, headers: NO_STORE_HEADERS });
          return new Response(file, {
            headers: {
              ...NO_STORE_HEADERS,
              "content-type": "text/html; charset=utf-8",
            },
          });
        } catch {
          return new Response("Dashboard unavailable", { status: 500, headers: NO_STORE_HEADERS });
        }
      }

      return jsonResponse({ error: "Not found" }, 404);
    },
  });
}

if (import.meta.main) {
  const server = startDashboardServer();
  console.log(`Benchmark dashboard: http://${server.hostname}:${server.port}`);
}
