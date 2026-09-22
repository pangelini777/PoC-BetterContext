// Probe-question eval: session-continue routing probe over three arms.
// One `opencode run` SESSION per arm (turn 1 plain run captures the sessionID
// from the JSON event stream; turns 2..N pass `--session <id>`), asking each
// frozen probe question (fixtures/probe-questions.json v1 plus -v2/-v3 —
// tuning sets, NOT held-out) in order on an identical fresh git workspace.
// Only the APM context policy differs per arm — setup is identical to
// run-single.ts:
//
// - load_all_single: full catalog compiled ONCE into the initial stdin prompt
//   (compileOverlay over every catalog body). Runner-owned materialized set =
//   every catalog id. unloadMode=none.
// - apm_discovery: workspace gets fixture apm.yml + .apm/ plus the brew APM
//   `install --target opencode,antigravity` output (.agents/rules/ +
//   .agents/skills/) committed in place. The agent discovers autonomously.
//   Materialized set is unknown -> null. unloadMode=none.
// - jev_single: NO APM files in the workspace. The controller owns an
//   isolated APM store (mkdtemp dir OUTSIDE the workspace holding apm.yml +
//   .apm/ + the brew APM install output; the catalog loads from there) and
//   the workspace gets only the demo fixture PLUS the OpenCode plugin
//   (single-session/jev-plugin.ts, transpiled to
//   .opencode/plugins/jev-single.mjs, wired via .opencode/opencode.json with
//   the singular "plugin" key; the module default-exports { id, server }).
//   Routing is runner-owned: the runner drives ProgressiveSession once per
//   probe and rewrites .agents/jev-decisions.json before each turn; the plugin
//   reads it per turn. Unload is BEHAVIORAL, recorded honestly. A
//   contamination gate (assertJevWorkspaceClean + per-probe tool-call scan)
//   marks the trial ineligible if controller APM material leaks into the
//   workspace or the agent touches the store directly.
//
// Transport: native Bun.spawn with each probe prompt over stdin (never argv),
// `--auto --format json`, NDJSON parsed via parseOpencodeJson, 120s timeout
// per probe. jev_single runs WITHOUT --pure so its plugin loads; the other
// arms use --pure. No arm runs formatters, linters, typecheck, tests, or
// project-wide validation.
//
// Artifact: kind "probe-eval" with trials[] carrying probeResults[] per probe:
// { probeId, answer, retrieval{citedExpected, citedForbidden, quoteHit},
//   materializedIds, contextTokens } plus trial.contamination {clean,
//   reasons[]}. A top-level `bodies` snapshot (full rule + skill bodies keyed
//   by id) travels with the artifact, as do the embedded `probeSet` (content
//   probe definitions), `recallTemplate`, and `evaluator` (v4) with
//   probeSetHash/evaluatorHash, so the separate grader (probe/grade-run.ts)
//   can grade without reading fixtures. Progress sidecar at
//   results/.live/<runId>.json (deleted after the final artifact writes
//   successfully).

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { loadCatalog } from "../../packages/apm-catalog/src/catalog.ts";
import { HeuristicBackend, SystemOneBackend } from "../../packages/progressive-context/src/router.ts";
import type { ScoreBackend } from "../../packages/progressive-context/src/router.ts";
import { compileOverlay } from "../../packages/progressive-context/src/compiler.ts";
import { KERNEL, ProgressiveSession } from "../../packages/progressive-context/src/session.ts";
import type { ResourceDescriptor, ThresholdConfig } from "../../packages/protocol/src/types.ts";
import { CONFIG_PATH, PKG_DIR, RESULTS_DIR, REPO_ROOT, checkProvenance, collectVersions } from "./lib.ts";
import { parseOpencodeJson } from "./live/opencode-parser.ts";
import type { ParsedRun } from "./live/opencode-parser.ts";

export const DEFAULT_MODEL = "opencode/big-pickle";

export const APM_BIN = "/home/linuxbrew/.linuxbrew/bin/apm";

/** Per-probe opencode timeout: one short Q&A turn, not a full build loop. */
const PROBE_TIMEOUT_MS = Number(process.env["PROBE_TIMEOUT_MS"] ?? 120_000);
const APM_TIMEOUT_MS = 120_000;

const SKIP_VALIDATION_LINE =
  "Do not run formatters, linters, typecheck, or test suites; answer the question directly without executing project validation.";

const ANSWER_TEMPLATE = `Answer in exactly this template:
Rules: <comma-separated FULL ids (with rule./skill. prefix, copied verbatim from the injected overlay) that decide this, or "none" if no rule applies. Name CONSTRAINTS (rule.*) for what must hold, PROCEDURES (skill.*) for how to do it.>
Answer: <your answer in 1-3 sentences; start with yes/no where the question asks for it>
Quote: <one quoted line from the cited rule, or "n/a">`;

const PLUGIN_SRC = join(REPO_ROOT, "evals/progressive-context/single-session/jev-plugin.ts");
const PLUGIN_DEST_REL = ".opencode/plugins/jev-single.mjs";
const DECISIONS_REL = ".agents/jev-decisions.json";
const TURN_LOG_REL = ".agents/jev-plugin-turns.jsonl";
const PROBE_FIXTURE = join(REPO_ROOT, "fixtures/probe-questions.json");
const PROBE_FIXTURE_V2 = join(REPO_ROOT, "fixtures/probe-questions-v2.json");
const PROBE_FIXTURE_V3 = join(REPO_ROOT, "fixtures/probe-questions-v3.json");
const PROBE_FIXTURE_V4 = join(REPO_ROOT, "fixtures/probe-questions-v4-heldout.json");

export type ProbeArm = "load_all_single" | "apm_discovery" | "jev_single";
export type UnloadMode = "byte-proof" | "behavioral" | "none";

const PROBE_ARMS: ProbeArm[] = ["load_all_single", "apm_discovery", "jev_single"];

const UNLOAD_MODE: Record<ProbeArm, UnloadMode> = {
  load_all_single: "none",
  apm_discovery: "none",
  jev_single: "behavioral",
};

export interface ProbeQuestion {
  id: string;
  phase: string;
  question: string;
  expectedIds: string[];
  expectedSkills: string[];
  forbiddenIds: string[];
  mustCite: string[];
  mustQuote: string[];
  mustNotCite: string[];
}

export interface ProbeRetrieval {
  citedExpected: boolean;
  citedForbidden: boolean;
  quoteHit: boolean;
}

export interface ProbeResult {
  probeId: string;
  phase: string;
  question: string;
  answer: string;
  answerChars: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  toolCallCount: number;
  toolCalls: { name: string; status: string; args: string }[];
  /** Runner-owned materialized set; null when unknown (apm_discovery). */
  materializedIds: string[] | null;
  /** Runner-owned evicted ids for this turn (jev_single only); null otherwise. */
  evictedIds: string[] | null;
  /** Compiled resource-token estimate for this probe (0 when unknown). */
  contextTokens: number;
  retrieval: ProbeRetrieval;
  timedOut: boolean;
  pluginTurnsAdded: number;
}

interface ProbeTrial {
  trialId: string;
  arm: ProbeArm;
  status: "running" | "completed" | "failed" | "dry-run";
  durationMs: number;
  agentTokens: { input: number; output: number; reasoning: number; total: number };
  unloadMode: UnloadMode;
  eligibility: { eligible: boolean; reasons: string[] };
  workspace: string;
  opencodeSessionId: string | null;
  sessionContinued: boolean;
  probeResults: ProbeResult[];
  contamination: { clean: boolean; reasons: string[] };
  [key: string]: unknown;
}

interface ProbeSidecar {
  schemaVersion: 1;
  runId: string;
  kind: "probe-eval";
  status: "running" | "completed";
  createdAt: string;
  updatedAt: string;
  model: string;
  routingBackend: "provider_backed" | "fail_open";
  probeSetVersion: string;
  trials: ProbeTrial[];
}

async function writeSidecar(path: string, sidecar: ProbeSidecar): Promise<void> {
  sidecar.updatedAt = new Date().toISOString();
  const tempPath = `${path}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(sidecar, null, 2)}\n`);
  await rename(tempPath, path);
}

function sh(cmd: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<{ code: number; out: string }> {
  const { promise, resolve } = Promise.withResolvers<{ code: number; out: string }>();
  execFile(cmd, args, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
    resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.slice(0, 6000) });
  });
  return promise;
}

async function hashDirectory(root: string, relative = ""): Promise<string> {
  const hash = createHash("sha256");
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) {
      hash.update(`d:${path}\0${await hashDirectory(root, path)}\0`);
    } else if (entry.isFile()) {
      hash.update(`f:${path}\0`);
      hash.update(await readFile(join(root, path)));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

/** Canonical JSON: sorted keys, arrays preserve order. Hash inputs use this. */
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const rec = v as Record<string, unknown>;
  return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(rec[k])}`).join(",")}}`;
}

/** Embedded evaluator identity (v4). Grader reads this from the artifact. */
const EVALUATOR = {
  name: "probe-retrieval+noul",
  version: "v4",
  retrieval: "Rules-line endorsement substring rule (endorses): expected id counts when a Rules-line entry contains it or vice versa, slug/stem cover both directions; mustCite all endorsed, mustNotCite none endorsed, mustQuote any-of present",
  noul: "per-expected-rule compliance Noul (state {question, answer, ruleBody}) + distractor Choice {follows,contradicts,correctly-dismissed} + eviction Choice {relies-on-evicted,consistent-but-independent,unrelated}",
  selfReport: "Rules-line recall vs expected/current set + Jaccard agreementWithRunner",
} as const;

/** Controller-only APM store: mkdtemp dir OUTSIDE any agent workspace holding
 *  apm.yml + jev-runtime.yaml + .apm/ plus the brew APM install output. The
 *  catalog loads from here; agent workspaces MUST NOT contain these files on
 *  JEV arms. */
async function setupIsolatedApmStore(): Promise<string> {
  const store = await mkdtemp(join(tmpdir(), "jev-apm-store-"));
  await cp(join(REPO_ROOT, "fixtures/apm-package/apm.yml"), join(store, "apm.yml"));
  await cp(join(REPO_ROOT, "fixtures/apm-package/jev-runtime.yaml"), join(store, "jev-runtime.yaml"));
  await cp(join(REPO_ROOT, "fixtures/apm-package/.apm"), join(store, ".apm"), { recursive: true });
  const r = await sh(APM_BIN, ["install", "--target", "opencode,antigravity"], store, APM_TIMEOUT_MS);
  if (r.code !== 0) throw new Error(`controller APM store install failed: ${r.out.slice(0, 500)}`);
  return store;
}

const JEV_FORBIDDEN_REL = ["apm.yml", ".apm", ".agents/rules", ".agents/skills"];

/** Fail a JEV trial if controller APM material leaked into the workspace.
 *  Allowed: demo fixture, .opencode/plugins/jev-single.mjs,
 *  .opencode/opencode.json, .agents/jev-decisions.json,
 *  .agents/jev-plugin-turns.jsonl, .agents/jev-memory.md. */
async function assertJevWorkspaceClean(ws: string): Promise<string[]> {
  const reasons: string[] = [];
  let tracked: string[] = [];
  try {
    tracked = (await sh("git", ["ls-files"], ws)).out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    tracked = [];
  }
  for (const rel of JEV_FORBIDDEN_REL) {
    if (tracked.some((t) => t === rel || t.startsWith(`${rel}/`))) {
      reasons.push(`forbidden workspace path (tracked): ${rel}`);
      continue;
    }
    try {
      await stat(join(ws, rel));
      reasons.push(`forbidden workspace path present: ${rel}`);
    } catch {
      // absent — clean
    }
  }
  return reasons;
}

/** Per-probe tool-call scan: native skill-tool use or direct store access. */
function scanProbeContamination(toolCalls: { name: string; args: string }[], storePath: string): string[] {
  const reasons: string[] = [];
  for (const c of toolCalls) {
    if (c.name === "skill") reasons.push("native skill-tool invocation");
    const a = c.args ?? "";
    if (storePath !== "" && a.includes(storePath)) {
      reasons.push("direct controller-store access (store path in tool args)");
    } else if (a.includes("/.apm/") || a.includes(".agents/rules") || a.includes(".agents/skills")) {
      reasons.push(`direct store access pattern in tool args: ${a.slice(0, 120)}`);
    }
  }
  return [...new Set(reasons)];
}

/**
 * Preliminary per-turn pre-score, stored as probeResults[].retrieval.
 * LEGACY shape: whole-answer substring checks without the Rules-line
 * endorsement scoping of probe/grade.ts scoreRetrieval. Authoritative
 * retrieval is recomputed by probe/grade-run.ts from the stored answer text
 * using the embedded evaluator definitions; dashboard Verification and
 * grades files reflect the authoritative score, not this field. Kept for
 * live sidecar progress display only. Do not cite raw retrieval as evidence.
 */
function scoreRetrievalLocal(probe: ProbeQuestion, answer: string): ProbeRetrieval {
  const text = (answer ?? "").toLowerCase();
  return {
    citedExpected: probe.mustCite.every((id) => text.includes(id.toLowerCase())),
    citedForbidden: probe.mustNotCite.some((id) => text.includes(id.toLowerCase())),
    quoteHit: probe.mustQuote.length === 0 || probe.mustQuote.some((q) => text.includes(q.toLowerCase())),
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Best-effort sessionID extraction from one `opencode run --format json` line. */
function sessionIdFromLine(line: string): string | null {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  const root = asRecord(ev);
  if (!root) return null;
  const direct =
    asNonEmptyString(root["sessionID"]) ??
    asNonEmptyString(root["sessionId"]) ??
    asNonEmptyString(root["session_id"]);
  if (direct) return direct;
  for (const key of ["part", "properties", "payload", "data", "session", "info"]) {
    const nested = asRecord(root[key]);
    if (!nested) continue;
    const hit =
      asNonEmptyString(nested["sessionID"]) ??
      asNonEmptyString(nested["sessionId"]) ??
      asNonEmptyString(nested["session_id"]) ??
      asNonEmptyString(nested["id"]);
    if (hit && key !== "part") return hit;
    // part.id is usually a message/part id, not a session — only accept
    // session-looking keys inside part.
    if (hit && key === "part") continue;
  }
  return null;
}

function extractSessionId(stdout: string): string | null {
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const hit = sessionIdFromLine(t);
    if (hit) return hit;
  }
  return null;
}

interface OpencodeProbeResult {
  run: ParsedRun;
  rawBytes: number;
  ms: number;
  timedOut: boolean;
  sessionId: string | null;
}

/** One probe turn. Prompt travels over stdin (never argv); pure only when the
 *  arm needs no workspace plugin (jev_single must load its own). Turns 2..N
 *  pass --session <id> to continue the arm's session. */
async function opencodeProbe(opts: {
  model: string;
  opencodeBin: string;
  ws: string;
  prompt: string;
  pure: boolean;
  sessionId: string | null;
}): Promise<OpencodeProbeResult> {
  const t0 = Date.now();
  const args = ["run", "--dir", opts.ws, "--model", opts.model, "--auto", "--format", "json"];
  if (opts.pure) args.push("--pure");
  if (opts.sessionId) args.push("--session", opts.sessionId);
  const child = Bun.spawn([opts.opencodeBin, ...args], {
    cwd: opts.ws,
    env: process.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(opts.prompt);
  child.stdin.end();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, PROBE_TIMEOUT_MS);
  let stdout = "";
  let stderr = "";
  try {
    [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  } finally {
    clearTimeout(timer);
  }
  const out = `${stdout}\n${stderr}`.slice(0, 200000);
  return {
    run: parseOpencodeJson(out),
    rawBytes: out.length,
    ms: Date.now() - t0,
    timedOut,
    sessionId: extractSessionId(stdout),
  };
}

/** Fresh git workspace from the demo fixture. Returns ws path + base commit. */
async function freshWorkspace(trialId: string, arm: ProbeArm, demoDir: string): Promise<{ ws: string; baseCommit: string }> {
  const ws = await mkdtemp(join(tmpdir(), `jev-probe-${trialId}-${arm}-`));
  try {
    checkProvenance({ workspace: ws });
  } catch (err) {
    throw new Error(`provenance guard failed: ${String(err).slice(0, 200)}`);
  }
  await cp(demoDir, ws, { recursive: true });
  await sh("git", ["init", "-q"], ws);
  await sh("git", ["add", "-A"], ws);
  await sh("git", ["-c", "user.email=poc@local", "-c", "user.name=poc", "commit", "-qm", "base"], ws);
  const baseCommit = (await sh("git", ["rev-parse", "HEAD"], ws)).out.trim();
  return { ws, baseCommit };
}

/** Copy fixture apm.yml + .apm/ into the workspace and run the pinned brew
 *  APM install for the opencode+antigravity targets. Never `compile`
 *  (compile would flatten everything into AGENTS.md and defeat discovery). */
async function installApmDiscovery(ws: string): Promise<{ code: number; outExcerpt: string }> {
  await cp(join(REPO_ROOT, "fixtures/apm-package/apm.yml"), join(ws, "apm.yml"));
  await cp(join(REPO_ROOT, "fixtures/apm-package/.apm"), join(ws, ".apm"), { recursive: true });
  const r = await sh(APM_BIN, ["install", "--target", "opencode,antigravity"], ws, APM_TIMEOUT_MS);
  await sh("git", ["add", "-A"], ws);
  await sh("git", ["-c", "user.email=poc@local", "-c", "user.name=poc", "commit", "-qm", "apm-discovery"], ws);
  return { code: r.code, outExcerpt: r.out.slice(0, 1500) };
}

async function readTurnLogCount(ws: string): Promise<number> {
  try {
    const raw = await readFile(join(ws, TURN_LOG_REL), "utf8");
    return raw.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

async function runProbeArm(opts: {
  arm: ProbeArm;
  trialId: string;
  model: string;
  opencodeBin: string;
  runId: string;
  cfg: ThresholdConfig;
  catalogHash: string;
  loadAllTokens: number;
  catalogBodies: Map<string, string>;
  catalogRules: ResourceDescriptor[];
  catalogSkills: ResourceDescriptor[];
  catalogById: Map<string, ResourceDescriptor>;
  catalogIds: string[];
  demoDir: string;
  probes: ProbeQuestion[];
  storePath: string;
  dryRun: boolean;
  backend: ScoreBackend;
  reportProgress: (trial: ProbeTrial) => Promise<void>;
}): Promise<ProbeTrial> {
  const t0 = Date.now();
  const unloadMode = UNLOAD_MODE[opts.arm];
  const blankTokens = { input: 0, output: 0, reasoning: 0, total: 0 };

  const { ws, baseCommit } = await freshWorkspace(opts.trialId, opts.arm, opts.demoDir);
  const running: ProbeTrial = {
    trialId: opts.trialId,
    arm: opts.arm,
    status: "running",
    durationMs: 0,
    agentTokens: { ...blankTokens },
    unloadMode,
    eligibility: { eligible: false, reasons: ["running"] },
    workspace: ws,
    opencodeSessionId: null,
    sessionContinued: false,
    probeResults: [],
    contamination: { clean: true, reasons: [] },
  };
  await opts.reportProgress({ ...running, durationMs: Date.now() - t0 });

  const usePure = opts.arm !== "jev_single";
  const extra: Record<string, unknown> = { baseCommit };
  let provenanceOk = true;
  try {
    checkProvenance({ workspace: ws });
  } catch {
    provenanceOk = false;
  }

  // Runner-owned routing state for jev_single: one ProgressiveSession across
  // probes; each probe re-routes and rewrites the decisions file the plugin
  // reads per turn. load_all uses the full id set; discovery leaves it null.
  let sess: ProgressiveSession | null = null;
  let loadAllOverlayTokens = 0;
  const decisionsEventIds: string[] = [];
  const contaminationReasons: string[] = [];
  if (opts.arm === "load_all_single") {
    const compiled = compileOverlay(opts.catalogIds, opts.catalogBodies, "evt-probe-000");
    loadAllOverlayTokens = compiled.resourceTokenEstimate;
    extra["compiledOverlaySha256"] = compiled.overlaySha256;
    extra["initialOverlay"] = compiled.dynamicOverlay.slice(0, 4000);
  } else if (opts.arm === "apm_discovery") {
    const install = await installApmDiscovery(ws);
    extra["apmInstall"] = install;
    if (install.code !== 0) {
      const failed: ProbeTrial = {
        ...running,
        status: "failed",
        durationMs: Date.now() - t0,
        eligibility: { eligible: false, reasons: ["apm install failed for opencode,antigravity targets"] },
        ...extra,
      };
      await opts.reportProgress(failed);
      return failed;
    }
  } else {
    // jev_single: NO workspace APM install. The controller store (opts.storePath)
    // already holds apm.yml + .apm/ + install output; the catalog loaded from
    // there. Workspace gets demo fixture + plugin + decisions file only.
    let pluginJs: string;
    try {
      const src = await readFile(PLUGIN_SRC, "utf8");
      pluginJs = new Bun.Transpiler({ loader: "ts" }).transformSync(src, "ts");
    } catch {
      const skipped: ProbeTrial = {
        ...running,
        status: "dry-run",
        durationMs: Date.now() - t0,
        eligibility: { eligible: false, reasons: ["plugin-missing: single-session/jev-plugin.ts not landed"] },
        ...extra,
      };
      await opts.reportProgress(skipped);
      return skipped;
    }
    sess = new ProgressiveSession({
      runId: opts.runId,
      sessionId: `${opts.trialId}-${opts.arm}`,
      arm: "progressive_jev",
      goal: "Answer probe questions about APM-managed rules and skills for this workspace.",
      catalogHash: opts.catalogHash,
      bodies: opts.catalogBodies,
      rules: opts.catalogRules,
      skills: opts.catalogSkills,
      byId: opts.catalogById,
      cfg: opts.cfg,
      backend: opts.backend,
      loadAllTokens: opts.loadAllTokens,
    });
    await mkdir(join(ws, ".opencode/plugins"), { recursive: true });
    await writeFile(join(ws, PLUGIN_DEST_REL), pluginJs);
    // V1 (opencode 1.18.31) reads workspace plugin config from
    // .opencode/opencode.json with the singular "plugin" key. A project-root
    // opencode.json "plugins" entry is rejected as unsupported.
    await writeFile(join(ws, ".opencode/opencode.json"), `${JSON.stringify({ plugin: [`./plugins/jev-single.mjs`] }, null, 2)}\n`);
    await sh("git", ["add", "-A"], ws);
    await sh("git", ["-c", "user.email=poc@local", "-c", "user.name=poc", "commit", "-qm", "jev-single-plugin"], ws);
    extra["pluginBytes"] = pluginJs.length;
    extra["controllerStore"] = opts.storePath;
    const cleanReasons = await assertJevWorkspaceClean(ws);
    for (const r of cleanReasons) contaminationReasons.push(r);
  }

  const probeResults: ProbeResult[] = [];
  let opencodeSessionId: string | null = null;
  let sessionContinued = false;
  const timedOutProbes: string[] = [];
  let turnLogSeen = 0;

  for (let i = 0; i < opts.probes.length; i += 1) {
    const probe = opts.probes[i];
    const isFirst = i === 0;

    // Runner-owned materialized set + context tokens for this probe.
    // Recall probes (phase "recall") carry no routing event: they inherit the
    // previous turn's runner state so the self-report reads current context.
    let materializedIds: string[] | null;
    let evictedIds: string[] | null;
    let contextTokens: number;
    const isRecall = probe.phase === "recall";
    if (isRecall) {
      const prev = probeResults.length > 0 ? probeResults[probeResults.length - 1] : null;
      materializedIds = prev ? (prev.materializedIds === null ? null : [...prev.materializedIds]) : (opts.arm === "load_all_single" ? [...opts.catalogIds] : null);
      evictedIds = null;
      contextTokens = prev ? prev.contextTokens : 0;
    } else if (opts.arm === "load_all_single") {
      materializedIds = [...opts.catalogIds];
      evictedIds = null;
      contextTokens = loadAllOverlayTokens;
    } else if (opts.arm === "jev_single") {
      const rec = await sess!.runEvent({ kind: "user_message", text: probe.question, phase: probe.phase, changedPaths: [] });
      materializedIds = [...rec.materializedAfter].sort();
      evictedIds = [...rec.removed];
      contextTokens = rec.compiledResourceTokens;
      decisionsEventIds.push(rec.semanticEventId);
      const decisions = {
        eventId: rec.semanticEventId,
        kernel: KERNEL,
        materialized: rec.materializedAfter.map((id: string) => ({
          id,
          name: id.includes(".") ? id.slice(id.indexOf(".") + 1) : id,
          body: opts.catalogBodies.get(id) ?? "",
        })),
        evictedIds: rec.removed,
        evictedProbes: {},
      };
      await mkdir(join(ws, ".agents"), { recursive: true });
      await writeFile(join(ws, DECISIONS_REL), `${JSON.stringify(decisions, null, 2)}\n`);
    } else {
      materializedIds = null;
      evictedIds = null;
      contextTokens = 0;
    }

    // Prompt: turn 1 carries the arm preamble; later turns are the bare probe
    // (the session carries history). Every turn carries the answer template.
    let prompt: string;
    if (isFirst) {
      if (opts.arm === "load_all_single") {
        const compiled = compileOverlay(opts.catalogIds, opts.catalogBodies, "evt-probe-000");
        prompt =
          `${KERNEL}\n${compiled.dynamicOverlay}\n\n<probe id="${probe.id}" phase="${probe.phase}">\n${probe.question}\n</probe>\n\n${ANSWER_TEMPLATE}\n${SKIP_VALIDATION_LINE}`;
      } else if (opts.arm === "apm_discovery") {
        prompt =
          `This workspace uses APM-managed context (apm.yml, .apm/, .agents/rules/, .agents/skills/). Discover and follow the relevant rules and skills autonomously.\n\n<probe id="${probe.id}" phase="${probe.phase}">\n${probe.question}\n</probe>\n\n${ANSWER_TEMPLATE}\n${SKIP_VALIDATION_LINE}`;
      } else {
        prompt =
          `A workspace plugin manages progressive APM context each turn: treat the injected <jev-apm-context> overlay as authoritative for its scope.\n\n<probe id="${probe.id}" phase="${probe.phase}">\n${probe.question}\n</probe>\n\n${ANSWER_TEMPLATE}\n${SKIP_VALIDATION_LINE}`;
      }
    } else {
      prompt = `<probe id="${probe.id}" phase="${probe.phase}">\n${probe.question}\n</probe>\n\n${ANSWER_TEMPLATE}\n${SKIP_VALIDATION_LINE}`;
    }

    if (opts.dryRun) {
      probeResults.push({
        probeId: probe.id,
        phase: probe.phase,
        question: probe.question,
        answer: "",
        answerChars: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        toolCallCount: 0,
        toolCalls: [],
        materializedIds,
        evictedIds,
        contextTokens,
        retrieval: scoreRetrievalLocal(probe, ""),
        timedOut: false,
        pluginTurnsAdded: 0,
      });
      continue;
    }

    const turnsBefore = await readTurnLogCount(ws);
    let result: OpencodeProbeResult;
    try {
      result = await opencodeProbe({
        model: opts.model,
        opencodeBin: opts.opencodeBin,
        ws,
        prompt,
        pure: usePure,
        sessionId: opencodeSessionId,
      });
    } catch (err) {
      const failed: ProbeTrial = {
        ...running,
        status: "failed",
        durationMs: Date.now() - t0,
        opencodeSessionId,
        sessionContinued,
        probeResults,
        eligibility: { eligible: false, reasons: [`opencode spawn failed: ${String(err).slice(0, 200)}`] },
        ...extra,
      };
      await opts.reportProgress(failed);
      return failed;
    }

    if (isFirst && result.sessionId) opencodeSessionId = result.sessionId;
    if (!isFirst && opencodeSessionId) sessionContinued = true;
    if (result.timedOut) timedOutProbes.push(probe.id);
    const turnsAfter = await readTurnLogCount(ws);
    const pluginAdded = Math.max(0, turnsAfter - turnsBefore);
    turnLogSeen += pluginAdded;

    const answer = result.run.assistantText;
    const toolCalls = result.run.turns.flatMap((t) => t.toolCalls.map((c) => ({ name: c.name, status: c.status, args: c.argsSummary.slice(0, 300) })));
    const pr: ProbeResult = {
      probeId: probe.id,
      phase: probe.phase,
      question: probe.question,
      answer,
      answerChars: answer.length,
      inputTokens: result.run.inputTokens,
      outputTokens: result.run.outputTokens,
      reasoningTokens: result.run.reasoningTokens,
      totalTokens: result.run.totalTokens,
      toolCallCount: result.run.toolCallCount,
      toolCalls,
      materializedIds,
      evictedIds,
      contextTokens,
      retrieval: scoreRetrievalLocal(probe, answer),
      timedOut: result.timedOut,
      pluginTurnsAdded: pluginAdded,
    };
    probeResults.push(pr);
    if (opts.arm === "jev_single") {
      for (const r of scanProbeContamination(toolCalls, opts.storePath)) {
        contaminationReasons.push(`probe ${probe.id}: ${r}`);
      }
    }
    await opts.reportProgress({
      ...running,
      durationMs: Date.now() - t0,
      opencodeSessionId,
      sessionContinued,
      probeResults: [...probeResults],
    });
  }
  if (opts.arm === "jev_single") {
    extra["decisionsEventIds"] = decisionsEventIds;
    extra["pluginTurns"] = turnLogSeen;
    for (const r of await assertJevWorkspaceClean(ws)) contaminationReasons.push(r);
  }

  const totals = probeResults.reduce(
    (a, r) => ({ input: a.input + r.inputTokens, output: a.output + r.outputTokens, reasoning: a.reasoning + r.reasoningTokens, total: a.total + r.totalTokens }),
    { input: 0, output: 0, reasoning: 0, total: 0 },
  );

  const reasons: string[] = [];
  if (!provenanceOk) reasons.push("workspace/provenance guard failed");
  for (const id of timedOutProbes) reasons.push(`probe ${id} hit the ${Math.round(PROBE_TIMEOUT_MS / 1000)}s timeout`);
  if (opts.probes.length > 1 && opencodeSessionId === null && !opts.dryRun) {
    reasons.push("no opencode session id captured on turn 1; turns ran without --session");
  }
  if (opts.arm === "jev_single") {
    reasons.push("unloadMode=behavioral: overlay scrubbed from emitted messages only; not byte-proof (see jev-plugin.ts header)");
    if (turnLogSeen === 0 && !opts.dryRun) reasons.push("no plugin turn log observed (.agents/jev-plugin-turns.jsonl missing)");
    for (const r of contaminationReasons) reasons.push(`contamination: ${r}`);
  }

  const contamination = { clean: contaminationReasons.length === 0, reasons: [...contaminationReasons] };
  const done: ProbeTrial = {
    ...running,
    status: opts.dryRun ? "dry-run" : "completed",
    durationMs: Date.now() - t0,
    agentTokens: totals,
    eligibility: {
      eligible: opts.dryRun ? false : reasons.length === 0 && (opts.arm !== "jev_single" || contamination.clean),
      reasons: opts.dryRun ? ["dry-run: agent spawn skipped"] : reasons,
    },
    opencodeSessionId,
    sessionContinued,
    probeResults,
    contamination,
    ...extra,
  };
  if (opts.dryRun) done.eligibility = { eligible: false, reasons: ["dry-run: agent spawn skipped"] };
  await opts.reportProgress(done);
  return done;
}

function printHelp(): void {
  console.log(`run-probe.ts — probe-question eval (one opencode session per arm).

Arms (same frozen probe set, model, and demo-workspace fixture):
  load_all_single  Full APM catalog compiled once into the initial stdin
                   prompt via compileOverlay. Runner-owned materialized set
                   = every catalog id. unloadMode=none.
  apm_discovery    Workspace gets fixture apm.yml + .apm/ plus
                   \`${APM_BIN} install --target opencode,antigravity\`
                   output (.agents/rules/ + .agents/skills/) committed in
                   place. The agent discovers rules/skills autonomously.
                   Materialized set unknown (null). unloadMode=none.
  jev_single       Controller-owned isolated APM store (mkdtemp dir OUTSIDE
                   the workspace) plus the OpenCode plugin
                   (single-session/jev-plugin.ts transpiled to
                   .opencode/plugins/jev-single.mjs, wired via
                   .opencode/opencode.json with the singular "plugin" key)
                   that per turn scrubs all <jev-apm-context> blocks from the
                   emitted lists and injects exactly one fresh overlay with
                   the current materialized set from .agents/jev-decisions.json
                   (runner-owned routing via ProgressiveSession, re-driven per
                   probe). The workspace holds NO apm.yml/.apm/.agents/rules/
                   .agents/skills/. Runs WITHOUT --pure so the plugin loads.
                   Unload is BEHAVIORAL — never byte-proof. A contamination
                   gate marks the trial ineligible on store leakage.

Each arm spawns one opencode session: turn 1 is a plain \`opencode run --auto
--format json\` (prompt over stdin) that captures the sessionID from the JSON
event stream; turns 2..N continue it via \`opencode run --session <id>\`.
120s timeout per probe, NDJSON via parseOpencodeJson. No arm runs formatters,
linters, typecheck, tests, or project-wide validation.
Artifact: kind "probe-eval" with trials[] carrying probeResults[] per probe
({ probeId, answer, retrieval{citedExpected, citedForbidden, quoteHit},
materializedIds, contextTokens }) plus trial.contamination {clean, reasons[]}.
Top-level probeSet (content probe definitions), recallTemplate, evaluator
(v4), probeSetHash/evaluatorHash, and a bodies snapshot travel with the
artifact for the separate grader (probe/grade-run.ts). Progress sidecar at
results/.live/<runId>.json (deleted after the final artifact writes
successfully).

Options:
  --arms=<a,b,c>       subset of load_all_single,apm_discovery,jev_single (default: all three)
  --probe-set=<s>      v1 | v2 | v1+v2 (default) | v3 (v1+v2+v3: 26 content probes
                       plus auto-inserted recall probes at each phase boundary:
                       id <prev>-recall, phase recall)
  --model=<m>          opencode model (default: $AGENT_MODEL or ${DEFAULT_MODEL})
  --opencode-bin=<p>   opencode binary (default: $OPENCODE_BIN or "opencode")
  --dry-run            set up workspaces + decisions/plugin files but skip the
                       opencode spawn; writes a valid artifact with
                       status "dry-run"
  --help, -h           this text
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const armsArg = args.find((a) => a.startsWith("--arms="))?.slice(7) ?? PROBE_ARMS.join(",");
  const arms = armsArg.split(",").filter(Boolean) as ProbeArm[];
  for (const arm of arms) {
    if (!PROBE_ARMS.includes(arm)) {
      console.error(`[run-probe] unknown arm: ${arm} (expected one of ${PROBE_ARMS.join(",")})`);
      printHelp();
      process.exit(1);
    }
  }
  const model = args.find((a) => a.startsWith("--model="))?.slice(8) ?? process.env["AGENT_MODEL"] ?? DEFAULT_MODEL;
  const opencodeBin = args.find((a) => a.startsWith("--opencode-bin="))?.slice(15) ?? process.env["OPENCODE_BIN"] ?? "opencode";
  const dryRun = args.includes("--dry-run");

  const runId = `probe-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const provenance = checkProvenance();
  const versions = await collectVersions();
  versions["agentModel"] = model;
  let storePath = "";
  try {
    storePath = await setupIsolatedApmStore();
    console.error(`[run-probe] controller APM store: ${storePath}`);
  } catch (err) {
    console.error(`[run-probe] controller store setup failed, falling back to fixture dir: ${String(err).slice(0, 200)}`);
  }
  const cat = await loadCatalog(storePath !== "" ? storePath : PKG_DIR);
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as ThresholdConfig;
  const cfgHash = createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
  const baseFixtureHash = (await hashDirectory(join(REPO_ROOT, "fixtures/demo-workspace"))).slice(0, 16);
  const probeSetIdx = args.findIndex((a) => a === "--probe-set");
  const probeSetArg = args.find((a) => a.startsWith("--probe-set="))?.slice(12) ?? (probeSetIdx >= 0 ? args[probeSetIdx + 1] : undefined) ?? "v1+v2";
  const probeFiles = probeSetArg === "v1" ? [PROBE_FIXTURE]
    : probeSetArg === "v2" ? [PROBE_FIXTURE_V2]
    : probeSetArg === "v3" ? [PROBE_FIXTURE, PROBE_FIXTURE_V2, PROBE_FIXTURE_V3]
    : probeSetArg === "v4" ? [PROBE_FIXTURE_V4]
    : [PROBE_FIXTURE, PROBE_FIXTURE_V2];
  const probeVersions: string[] = [];
  const contentProbes: ProbeQuestion[] = [];
  let recallIdSuffix = "-recall";
  let recallQuestion = "You have answered several questions across phases. Without quoting rule text, list the rule/skill ids that are still active constraints on your current work. Answer template: Rules: <comma list or none>.";
  for (const file of probeFiles) {
    const raw = await readFile(file, "utf8");
    const set = JSON.parse(raw) as { version: string; probes: ProbeQuestion[]; recallTemplate?: { idSuffix: string; question: string } };
    probeVersions.push(set.version);
    contentProbes.push(...set.probes);
    if (typeof set.recallTemplate?.question === "string" && set.recallTemplate.question.length > 0) {
      recallQuestion = set.recallTemplate.question;
    }
    if (typeof set.recallTemplate?.idSuffix === "string" && set.recallTemplate.idSuffix.length > 0) {
      recallIdSuffix = set.recallTemplate.idSuffix;
    }
  }
  // Recall probes (v3 only): auto-inserted before each content probe whose
  // phase differs from the previous content probe's phase. The recall turn
  // asks for the still-active rule ids; expectedIds/mustCite inherit the
  // previous content probe's expectedIds so retrieval is scored against the
  // pre-shift active set. Id scheme <prevId>-recall, phase "recall".
  const probes: ProbeQuestion[] = [];
  if (probeSetArg === "v3") {
    for (let idx = 0; idx < contentProbes.length; idx += 1) {
      const current = contentProbes[idx];
      const prev = idx > 0 ? contentProbes[idx - 1] : null;
      if (prev !== null && current.phase !== prev.phase) {
        probes.push({
          id: `${prev.id}${recallIdSuffix}`,
          phase: "recall",
          question: recallQuestion,
          expectedIds: [...prev.expectedIds],
          expectedSkills: [],
          forbiddenIds: [],
          mustCite: [...prev.expectedIds],
          mustQuote: [],
          mustNotCite: [],
        });
      }
      probes.push(current);
    }
  } else {
    probes.push(...contentProbes);
  }
  const probeSet: ProbeQuestion[] = contentProbes.map((p) => ({ id: p.id, phase: p.phase, question: p.question, expectedIds: [...p.expectedIds], expectedSkills: [...p.expectedSkills], forbiddenIds: [...p.forbiddenIds], mustCite: [...p.mustCite], mustQuote: [...p.mustQuote], mustNotCite: [...p.mustNotCite] }));
  const recallTemplate = { idSuffix: recallIdSuffix, question: recallQuestion };
  const evaluator = { ...EVALUATOR };
  const probeSetHash = createHash("sha256").update(canonicalize(probeSet)).digest("hex").slice(0, 16);
  const evaluatorHash = createHash("sha256").update(canonicalize(evaluator)).digest("hex").slice(0, 16);
  const apiKey = process.env["TYPESAFE_API_KEY"];
  const backend: ScoreBackend = apiKey
    ? new SystemOneBackend(apiKey, process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest")
    : new HeuristicBackend();
  const backendLabel = (apiKey ? "provider" : "failopen") as "provider" | "failopen";
  console.error(`[run-probe] routing backend: ${backendLabel === "provider" ? "SystemOneBackend(provider)" : "HeuristicBackend(fail_open)"} model=${model} probes=${probes.length}${dryRun ? " dry-run" : ""}`);
  const loadAllTokens = [...cat.byId.values()].reduce((a, d) => a + d.estimatedTokens, 0);
  const catalogIds = [...cat.byId.keys()].sort();
  const demoDir = join(REPO_ROOT, "fixtures/demo-workspace");
  const liveDir = join(RESULTS_DIR, ".live");
  const livePath = join(liveDir, `${runId}.json`);
  const liveTrials = new Map<string, ProbeTrial>();
  const sidecar: ProbeSidecar = {
    schemaVersion: 1,
    runId,
    kind: "probe-eval",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    model,
    routingBackend: backendLabel === "provider" ? "provider_backed" : "fail_open",
    probeSetVersion: probeVersions.join("+"),
    trials: [],
  };
  const reportProgress = async (trial: ProbeTrial): Promise<void> => {
    liveTrials.set(`${trial.trialId}:${trial.arm}`, trial);
    sidecar.trials = [...liveTrials.values()];
    await writeSidecar(livePath, sidecar);
  };
  await mkdir(liveDir, { recursive: true });
  await writeSidecar(livePath, sidecar);

  const trialResults: ProbeTrial[] = [];
  let n = 0;
  for (const arm of arms) {
    n += 1;
    const trialId = `trial-${n}`;
    console.error(`[run-probe] ${trialId} arm=${arm}${dryRun ? " (dry-run)" : ""}`);
    const r = await runProbeArm({
      arm,
      trialId,
      model,
      opencodeBin,
      runId,
      cfg,
      catalogHash: cat.hash,
      loadAllTokens,
      catalogBodies: cat.bodies,
      catalogRules: cat.rules,
      catalogSkills: cat.skills,
      catalogById: cat.byId,
      catalogIds,
      demoDir,
      probes,
      storePath,
      dryRun,
      backend,
      reportProgress,
    });
    trialResults.push(r);
  }

  const artifact = {
    runId,
    kind: "probe-eval",
    status: "completed",
    createdAt,
    model,
    probeSetVersion: probeVersions.join("+"),
    probeSet,
    recallTemplate,
    evaluator,
    probeSetHash,
    evaluatorHash,
    thresholdsHash: cfgHash,
    baseFixtureHash,
    provenance,
    versions,
    catalogHash: cat.hash,
    routingBackend: backendLabel === "provider" ? "provider_backed" : "fail_open",
    bodies: Object.fromEntries(cat.bodies),
    trials: trialResults,
  };
  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${runId}.json`);
  await writeFile(outPath, JSON.stringify(artifact, null, 2));
  await rm(livePath, { force: true });
  console.log(outPath);
  for (const t of trialResults) {
    console.error(`workspace ${t.trialId} ${t.arm}: ${t.workspace}`);
  }
}

await main();
