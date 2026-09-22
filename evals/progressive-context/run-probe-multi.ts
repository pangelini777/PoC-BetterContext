// Multi-session probe eval for agentic factories: one FRESH opencode run per
// probe (no --session). Per probe: a fresh git workspace from the demo
// fixture + per-probe arm setup, then a single `opencode run --auto --pure
// --format json` with the probe + answer template over stdin (never argv),
// 120s default (PROBE_MULTI_TIMEOUT_MS). No arm runs formatters, linters,
// typecheck, tests, or project-wide validation.
//
// Arms (same tuning probe set, model, and demo-workspace fixture; only the
// APM context policy differs):
//
// - load_all_single: full catalog compiled into THIS probe's prompt via
//   compileOverlay. Runner-owned materialized set = every catalog id.
//   unloadMode=none.
// - apm_discovery: workspace gets fixture apm.yml + .apm/ plus the brew APM
//   `install --target opencode,antigravity` output (.agents/rules/ +
//   .agents/skills/) committed in place. The agent discovers autonomously.
//   Materialized set is unknown -> null. unloadMode=none.
// - jev_single: workspace gets the demo fixture ONLY (no apm.yml, .apm/,
//   .agents/rules/, .agents/skills/ — a contamination gate fails the trial
//   if any appear). The APM catalog lives in a controller-owned store
//   (mkdtemp dir outside the workspace) and the catalog loads from there.
//   NO plugin, NO --session. Routing is runner-owned: a FRESH
//   ProgressiveSession per probe routes exactly ONE event (the probe
//   question) and the harness-assembled effective request (kernel + exactly
//   one overlay, scrubbed history — trivially empty on a fresh harness)
//   becomes that probe's prompt. unloadMode=byte-proof.
//
// Artifact: kind "probe-multi" with trials[] carrying probeResults[] per
// probe: { probeId, answer, retrieval{citedExpected, citedForbidden,
// quoteHit}, materializedIds, contextTokens, freshSession:true } plus
// trial.contamination {clean, reasons[]} from the per-probe workspace +
// tool-call gate. Top-level probeSet (full content-probe definitions,
// recall probes excluded), recallTemplate, evaluator, probeSetHash, and
// evaluatorHash travel with the artifact so the separate grader
// (probe/grade-run.ts) can judge without reading disk. Progress sidecar at
// results/.live/<runId>.json (deleted after the final artifact writes
// successfully).

import { createHash } from "node:crypto";
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { loadCatalog, type Catalog } from "../../packages/apm-catalog/src/catalog.ts";
import { HeuristicBackend, SystemOneBackend } from "../../packages/progressive-context/src/router.ts";
import type { ScoreBackend } from "../../packages/progressive-context/src/router.ts";
import { compileOverlay, countOverlays } from "../../packages/progressive-context/src/compiler.ts";
import { KERNEL, ProgressiveSession } from "../../packages/progressive-context/src/session.ts";
import type { ResourceDescriptor, ThresholdConfig } from "../../packages/protocol/src/types.ts";
import { CONFIG_PATH, PKG_DIR, RESULTS_DIR, REPO_ROOT, checkProvenance, collectVersions } from "./lib.ts";
import { parseOpencodeJson } from "./live/opencode-parser.ts";
import type { ParsedRun } from "./live/opencode-parser.ts";

export const DEFAULT_MODEL = "opencode/big-pickle";

export const APM_BIN = "/home/linuxbrew/.linuxbrew/bin/apm";

/** Per-probe opencode timeout: one short Q&A turn, not a full build loop. */
const PROBE_MULTI_TIMEOUT_MS = Number(process.env["PROBE_MULTI_TIMEOUT_MS"] ?? 120_000);
const APM_TIMEOUT_MS = 120_000;

const SKIP_VALIDATION_LINE =
  "Do not run formatters, linters, typecheck, or test suites; answer the question directly without executing project validation.";

const ANSWER_TEMPLATE = `Answer in exactly this template:
Rules: <comma-separated FULL ids (with rule./skill. prefix, copied verbatim from the injected overlay) that decide this, or "none" if no rule applies. Name CONSTRAINTS (rule.*) for what must hold, PROCEDURES (skill.*) for how to do it.>
Answer: <your answer in 1-3 sentences; start with yes/no where the question asks for it>
Quote: <one quoted line from the cited rule, or "n/a">`;

const PROBE_FIXTURE = join(REPO_ROOT, "fixtures/probe-questions.json");
const PROBE_FIXTURE_V2 = join(REPO_ROOT, "fixtures/probe-questions-v2.json");
const PROBE_FIXTURE_V3 = join(REPO_ROOT, "fixtures/probe-questions-v3.json");
const PROBE_FIXTURE_V4 = join(REPO_ROOT, "fixtures/probe-questions-v4-heldout.json");

export type ProbeMultiArm = "load_all_single" | "apm_discovery" | "jev_single";
export type UnloadMode = "byte-proof" | "behavioral" | "none";

const PROBE_MULTI_ARMS: ProbeMultiArm[] = ["load_all_single", "apm_discovery", "jev_single"];
const DEFAULT_ARMS: ProbeMultiArm[] = ["jev_single"];

const UNLOAD_MODE: Record<ProbeMultiArm, UnloadMode> = {
  load_all_single: "none",
  apm_discovery: "none",
  jev_single: "byte-proof",
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

export interface ProbeMultiResult {
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
  /** Runner-owned evicted ids for this probe (jev_single only); null otherwise. */
  evictedIds: string[] | null;
  /** Compiled resource-token estimate for this probe (0 when unknown). */
  contextTokens: number;
  retrieval: ProbeRetrieval;
  timedOut: boolean;
  pluginTurnsAdded: number;
  /** Every probe runs in its own fresh opencode session (no --session). */
  freshSession: true;
  /** Hybrid-memory chars injected into this probe's prompt (only with --hybrid-memory). */
  memoryChars?: number;
}

interface ProbeMultiTrial {
  trialId: string;
  arm: ProbeMultiArm;
  status: "running" | "completed" | "failed" | "dry-run";
  durationMs: number;
  agentTokens: { input: number; output: number; reasoning: number; total: number };
  unloadMode: UnloadMode;
  eligibility: { eligible: boolean; reasons: string[] };
  contamination: { clean: boolean; reasons: string[] };
  workspace: string;
  opencodeSessionId: string | null;
  sessionContinued: boolean;
  freshSession: true;
  probeResults: ProbeMultiResult[];
  [key: string]: unknown;
}

interface ProbeMultiSidecar {
  schemaVersion: 1;
  runId: string;
  kind: "probe-multi";
  status: "running" | "completed";
  createdAt: string;
  updatedAt: string;
  model: string;
  routingBackend: "provider_backed" | "fail_open";
  probeSetVersion: string;
  trials: ProbeMultiTrial[];
}

async function writeSidecar(path: string, sidecar: ProbeMultiSidecar): Promise<void> {
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

/** Deterministic retrieval pre-score (mirrors probe/grade.ts scoreRetrieval). */
function scoreRetrievalLocal(probe: ProbeQuestion, answer: string): ProbeRetrieval {
  const text = (answer ?? "").toLowerCase();
  return {
    citedExpected: probe.mustCite.every((id) => text.includes(id.toLowerCase())),
    citedForbidden: probe.mustNotCite.some((id) => text.includes(id.toLowerCase())),
    quoteHit: probe.mustQuote.length === 0 || probe.mustQuote.some((q) => text.includes(q.toLowerCase())),
  };
}

/** Canonical JSON: recursive sorted-key stringify for stable hashing. */
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const rec = v as Record<string, unknown>;
  return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(rec[k])}`).join(",")}}`;
}


/** Embedded evaluator contract (grader reads this from the artifact). */
const EVALUATOR = {
  name: "probe-retrieval+noul",
  version: "v4",
  retrieval:
    "Rules-line endorsement substring rule (endorses): expected id counts when a Rules-line entry contains it or vice versa, slug/stem cover both directions; mustCite all endorsed, mustNotCite none endorsed, mustQuote any-of present",
  noul:
    "per-expected-rule compliance Noul (state {question, answer, ruleBody}) + distractor Choice {follows,contradicts,correctly-dismissed} + eviction Choice {relies-on-evicted,consistent-but-independent,unrelated}",
  selfReport: "Rules-line recall vs expected/current set + Jaccard agreementWithRunner",
} as const;

/** Controller-owned APM store: mkdtemp dir OUTSIDE the agent workspace
 *  holding apm.yml + .apm/ + installed .agents/ output; the catalog loads
 *  from there. Agent workspaces never see these files on JEV arms. */
async function setupIsolatedApmStore(): Promise<string> {
  const store = await mkdtemp(join(tmpdir(), "jev-apm-store-"));
  await cp(join(REPO_ROOT, "fixtures/apm-package/apm.yml"), join(store, "apm.yml"));
  await cp(join(REPO_ROOT, "fixtures/apm-package/jev-runtime.yaml"), join(store, "jev-runtime.yaml"));
  await cp(join(REPO_ROOT, "fixtures/apm-package/.apm"), join(store, ".apm"), { recursive: true });
  await sh(APM_BIN, ["install", "--target", "opencode,antigravity"], store, APM_TIMEOUT_MS);
  return store;
}

/** Forbidden agent-workspace paths on JEV arms (controller-store only). */
const JEV_FORBIDDEN_REL = ["apm.yml", ".apm", ".agents/rules", ".agents/skills"];

/** Contamination gate (workspace half): list workspace files (git ls-files
 *  plus a direct stat of each forbidden path). Returns reasons; empty = clean. */
async function assertJevWorkspaceClean(ws: string): Promise<string[]> {
  const reasons: string[] = [];
  const ls = await sh("git", ["ls-files"], ws);
  const tracked = ls.out.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const rel of JEV_FORBIDDEN_REL) {
    if (tracked.some((f) => f === rel || f.startsWith(`${rel}/`))) {
      reasons.push(`forbidden workspace path tracked: ${rel}`);
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

/** Contamination gate (tool-call half): native skill-tool invocation or
 *  direct controller-store access. Returns reasons; empty = clean. */
function scanToolCallsForContamination(
  probeId: string,
  toolCalls: { name: string; status: string; args: string }[],
  storePath: string,
): string[] {
  const reasons: string[] = [];
  for (const c of toolCalls) {
    if (c.name === "skill") {
      reasons.push(`probe ${probeId}: native skill-tool invocation (tool name == "skill")`);
    }
    const args = c.args ?? "";
    if (storePath && args.includes(storePath)) {
      reasons.push(`probe ${probeId}: tool call references controller store path`);
    }
    if (args.includes("/.apm/") || args.includes(".agents/rules") || args.includes(".agents/skills")) {
      reasons.push(`probe ${probeId}: tool call references controller store content (${c.name})`);
    }
  }
  return reasons.filter((r, i) => reasons.indexOf(r) === i);
}

/** Hybrid-memory mode (opt-in via --hybrid-memory): per-probe fresh sessions
 *  PLUS a runner-maintained auditable memory file carried across probes.
 *  Memory is explicit auditable content appended by the runner — not hidden
 *  model history — so unloadMode stays byte-proof. */
const HYBRID_MEMORY_CAP = 4000;
const HYBRID_MEMORY_REL = "ws-memory/.agents/jev-memory.md";

/** Parse endorsed ids from the answer's Rules line (local regex, best-effort). */
function parseEndorsedIds(answer: string): string {
  const m = answer.match(/^rules\s*:(.*)$/im);
  if (!m) return "none";
  const ids = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length > 0 ? ids.join(", ") : "none";
}

function formatMemoryEntry(opts: {
  probeId: string;
  phase: string;
  endorsed: string;
  materializedCount: number;
  contextTokens: number;
  answer: string;
}): string {
  const excerpt = opts.answer.replace(/\s+/g, " ").trim().slice(0, 300);
  return (
    `## ${opts.probeId} (${opts.phase})\n` +
    `- endorsed: ${opts.endorsed}\n` +
    `- materialized: ${opts.materializedCount} resources, ${opts.contextTokens} ctx tokens\n` +
    `- answer: ${excerpt}\n`
  );
}

/** Newest entries kept: tail the file to HYBRID_MEMORY_CAP chars on inject. */

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

/** One fresh opencode run. Prompt travels over stdin (never argv); always
 *  --pure (no arm needs a workspace plugin here). Never --session. */
async function opencodeProbeOnce(opts: {
  model: string;
  opencodeBin: string;
  ws: string;
  prompt: string;
}): Promise<OpencodeProbeResult> {
  const t0 = Date.now();
  const args = ["run", "--dir", opts.ws, "--model", opts.model, "--auto", "--pure", "--format", "json"];
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
  }, PROBE_MULTI_TIMEOUT_MS);
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

/** Fresh git workspace from the demo fixture, per probe. */
async function freshWorkspace(trialId: string, probeId: string, arm: ProbeMultiArm, demoDir: string): Promise<{ ws: string; baseCommit: string }> {
  const ws = await mkdtemp(join(tmpdir(), `jev-probe-multi-${trialId}-${arm}-${probeId}-`));
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

async function runProbeMultiArm(opts: {
  arm: ProbeMultiArm;
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
  dryRun: boolean;
  hybridMemory: boolean;
  backend: ScoreBackend;
  storePath: string;
  reportProgress: (trial: ProbeMultiTrial) => Promise<void>;
}): Promise<ProbeMultiTrial> {
  const t0 = Date.now();
  const unloadMode = UNLOAD_MODE[opts.arm];
  const blankTokens = { input: 0, output: 0, reasoning: 0, total: 0 };

  const running: ProbeMultiTrial = {
    trialId: opts.trialId,
    arm: opts.arm,
    status: "running",
    durationMs: 0,
    agentTokens: { ...blankTokens },
    unloadMode,
    eligibility: { eligible: false, reasons: ["running"] },
    contamination: { clean: true, reasons: [] },
    workspace: "",
    opencodeSessionId: null,
    sessionContinued: false,
    freshSession: true,
    probeResults: [],
  };
  await opts.reportProgress({ ...running, durationMs: Date.now() - t0 });

  const extra: Record<string, unknown> = {};
  const workspaces: string[] = [];
  const probeSessionIds: (string | null)[] = [];
  let provenanceOk = true;
  const setupFailures: string[] = [];
  const timedOutProbes: string[] = [];
  const overlayViolations: string[] = [];
  const contaminationReasons: string[] = [];

  const compiledAll = compileOverlay(opts.catalogIds, opts.catalogBodies, "evt-probe-multi-000");
  const loadAllOverlayTokens = compiledAll.resourceTokenEstimate;
  if (opts.arm === "load_all_single") {
    extra["compiledOverlaySha256"] = compiledAll.overlaySha256;
    extra["initialOverlay"] = compiledAll.dynamicOverlay.slice(0, 4000);
  }

  const probeResults: ProbeMultiResult[] = [];
  let opencodeSessionId: string | null = null;

  // Hybrid-memory (--hybrid-memory only): ONE shared dir per arm, created once
  // outside the probe loop — never the per-probe workspaces. The runner
  // appends one entry per probe; the next probe's prompt carries the file
  // back as explicit auditable content (not hidden history).
  let hybridMemoryFile = "";
  let hybridMemoryText = "";
  if (opts.hybridMemory) {
    const hybridMemoryDir = await mkdtemp(join(tmpdir(), "probe-multi-memory-"));
    hybridMemoryFile = join(hybridMemoryDir, HYBRID_MEMORY_REL);
    await mkdir(dirname(hybridMemoryFile), { recursive: true });
    await writeFile(hybridMemoryFile, "");
  }
  const appendHybridMemory = async (
    probe: ProbeQuestion,
    answer: string,
    materialized: string[] | null,
    ctxTokens: number,
  ): Promise<void> => {
    const entry = formatMemoryEntry({
      probeId: probe.id,
      phase: probe.phase,
      endorsed: parseEndorsedIds(answer),
      materializedCount: Array.isArray(materialized) ? materialized.length : 0,
      contextTokens: ctxTokens,
      answer,
    });
    hybridMemoryText += entry;
    await appendFile(hybridMemoryFile, entry);
  };

  for (const probe of opts.probes) {
    // Hybrid-memory inject (opt-in only): explicit auditable file contents
    // (capped tail, newest kept), never hidden history. First probe gets
    // none; later probes carry the runner-appended notes in a <memory> block.
    const hybridMemoryKept =
      opts.hybridMemory && hybridMemoryText.length > 0
        ? hybridMemoryText.length > HYBRID_MEMORY_CAP
          ? hybridMemoryText.slice(hybridMemoryText.length - HYBRID_MEMORY_CAP)
          : hybridMemoryText
        : "";
    const hybridMemoryCharsForPrompt = hybridMemoryKept.length > 0
      ? `<memory>\nPrior probe notes from this task thread (auditable file, not model history):\n${hybridMemoryKept}\n</memory>`.length
      : 0;
    // Fresh workspace per probe (not per arm).
    let ws: string;
    try {
      const fresh = await freshWorkspace(opts.trialId, probe.id, opts.arm, opts.demoDir);
      ws = fresh.ws;
      workspaces.push(ws);
      try {
        checkProvenance({ workspace: ws });
      } catch {
        provenanceOk = false;
      }
    } catch (err) {
      setupFailures.push(`probe ${probe.id}: workspace setup failed: ${String(err).slice(0, 200)}`);
      if (opts.hybridMemory) {
        await appendHybridMemory(probe, "", opts.arm === "load_all_single" ? [...opts.catalogIds] : null, opts.arm === "load_all_single" ? loadAllOverlayTokens : 0);
      }
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
        materializedIds: opts.arm === "load_all_single" ? [...opts.catalogIds] : null,
        evictedIds: null,
        contextTokens: opts.arm === "load_all_single" ? loadAllOverlayTokens : 0,
        retrieval: scoreRetrievalLocal(probe, ""),
        timedOut: false,
        pluginTurnsAdded: 0,
        freshSession: true,
        ...(opts.hybridMemory ? { memoryChars: hybridMemoryCharsForPrompt } : {}),
      });
      continue;
    }
    running.workspace = ws;
    if (opts.arm === "jev_single") {
      for (const r of await assertJevWorkspaceClean(ws)) contaminationReasons.push(`probe ${probe.id}: ${r}`);
    }
    // Per-probe arm setup + prompt. Every probe is a fresh session, so every
    // prompt carries its full arm preamble — no history is ever continued.
    let materializedIds: string[] | null;
    let evictedIds: string[] | null;
    let contextTokens: number;
    let prompt: string;
    if (opts.arm === "load_all_single") {
      materializedIds = [...opts.catalogIds];
      evictedIds = null;
      contextTokens = loadAllOverlayTokens;
      prompt =
        `${KERNEL}\n${compiledAll.dynamicOverlay}\n\n<probe id="${probe.id}" phase="${probe.phase}">\n${probe.question}\n</probe>\n\n${ANSWER_TEMPLATE}\n${SKIP_VALIDATION_LINE}`;
    } else if (opts.arm === "apm_discovery") {
      const install = await installApmDiscovery(ws);
      if (install.code !== 0) {
        setupFailures.push(`probe ${probe.id}: apm install failed for opencode,antigravity targets`);
        if (opts.hybridMemory) {
          await appendHybridMemory(probe, "", null, 0);
        }
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
          materializedIds: null,
          evictedIds: null,
          contextTokens: 0,
          retrieval: scoreRetrievalLocal(probe, ""),
          timedOut: false,
          pluginTurnsAdded: 0,
          freshSession: true,
          ...(opts.hybridMemory ? { memoryChars: hybridMemoryCharsForPrompt } : {}),
        });
        probeSessionIds.push(null);
        continue;
      }
      materializedIds = null;
      evictedIds = null;
      contextTokens = 0;
      prompt =
        `This workspace uses APM-managed context (apm.yml, .apm/, .agents/rules/, .agents/skills/). Discover and follow the relevant rules and skills autonomously.\n\n<probe id="${probe.id}" phase="${probe.phase}">\n${probe.question}\n</probe>\n\n${ANSWER_TEMPLATE}\n${SKIP_VALIDATION_LINE}`;
    } else {
      // jev_single: workspace gets the demo fixture ONLY — no
      // installApmDiscovery call. The catalog lives in the
      // controller-owned store. Harness-owned routing: a FRESH
      // ProgressiveSession routes exactly ONE event (this probe). The
      // harness-assembled effective request — kernel + exactly one
      // overlay over scrubbed (empty) history — becomes the prompt.
      // No plugin, no --session.
      const sess = new ProgressiveSession({
        runId: opts.runId,
        sessionId: `${opts.trialId}-${probe.id}`,
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
      const rec = await sess.runEvent({
        kind: "user_message",
        text: `<probe id="${probe.id}" phase="${probe.phase}">\n${probe.question}\n</probe>`,
        phase: probe.phase,
        changedPaths: [],
      });
      materializedIds = [...rec.materializedAfter].sort();
      evictedIds = [...rec.removed];
      contextTokens = rec.compiledResourceTokens;
      const harness = sess.getHarness();
      const effective = harness.effectiveContext(harness.requestCount() - 1);
      prompt = `${effective}\n\n${ANSWER_TEMPLATE}\n${SKIP_VALIDATION_LINE}`;
      // Byte-proof assertion on the exact prompt bytes: one harness request
      // (no history) and at most one overlay block (zero when nothing
      // materialized). Stale content cannot survive a fresh harness.
      if (harness.requestCount() !== 1 || countOverlays(prompt) > 1) {
        overlayViolations.push(probe.id);
      }
    }
    if (opts.hybridMemory && hybridMemoryKept.length > 0) {
      prompt += `\n\n<memory>\nPrior probe notes from this task thread (auditable file, not model history):\n${hybridMemoryKept}\n</memory>`;
    }

    if (opts.dryRun) {
      if (opts.hybridMemory) {
        await appendHybridMemory(probe, "", materializedIds, contextTokens);
      }
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
        freshSession: true,
        ...(opts.hybridMemory ? { memoryChars: hybridMemoryCharsForPrompt } : {}),
      });
      probeSessionIds.push(null);
      continue;
    }

    let result: OpencodeProbeResult;
    try {
      result = await opencodeProbeOnce({
        model: opts.model,
        opencodeBin: opts.opencodeBin,
        ws,
        prompt,
      });
    } catch (err) {
      setupFailures.push(`probe ${probe.id}: opencode spawn failed: ${String(err).slice(0, 200)}`);
      if (opts.hybridMemory) {
        await appendHybridMemory(probe, "", materializedIds, contextTokens);
      }
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
        freshSession: true,
        ...(opts.hybridMemory ? { memoryChars: hybridMemoryCharsForPrompt } : {}),
      });
      probeSessionIds.push(null);
      continue;
    }

    if (result.sessionId) opencodeSessionId = result.sessionId;
    probeSessionIds.push(result.sessionId);
    if (result.timedOut) timedOutProbes.push(probe.id);

    const answer = result.run.assistantText;
    if (opts.hybridMemory) {
      await appendHybridMemory(probe, answer, materializedIds, contextTokens);
    }
    const flatCalls = result.run.turns.flatMap((t) => t.toolCalls.map((c) => ({ name: c.name, status: c.status, args: c.argsSummary.slice(0, 300) })));
    if (opts.arm === "jev_single") {
      for (const r of scanToolCallsForContamination(probe.id, flatCalls, opts.storePath)) contaminationReasons.push(r);
    }
    probeResults.push({
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
      toolCalls: flatCalls,
      materializedIds,
      evictedIds,
      contextTokens,
      retrieval: scoreRetrievalLocal(probe, answer),
      timedOut: result.timedOut,
      pluginTurnsAdded: 0,
      freshSession: true,
      ...(opts.hybridMemory ? { memoryChars: hybridMemoryCharsForPrompt } : {}),
    });
    await opts.reportProgress({
      ...running,
      durationMs: Date.now() - t0,
      opencodeSessionId,
      probeResults: [...probeResults],
    });
  }

  extra["workspaces"] = workspaces;
  extra["probeSessionIds"] = probeSessionIds;
  if (opts.hybridMemory) {
    extra["memoryLog"] = hybridMemoryText;
  }

  const totals = probeResults.reduce(
    (a, r) => ({ input: a.input + r.inputTokens, output: a.output + r.outputTokens, reasoning: a.reasoning + r.reasoningTokens, total: a.total + r.totalTokens }),
    { input: 0, output: 0, reasoning: 0, total: 0 },
  );

  const reasons: string[] = [];
  if (!provenanceOk) reasons.push("workspace/provenance guard failed");
  for (const f of setupFailures) reasons.push(f);
  for (const id of timedOutProbes) reasons.push(`probe ${id} hit the ${Math.round(PROBE_MULTI_TIMEOUT_MS / 1000)}s timeout`);
  for (const id of overlayViolations) reasons.push(`probe ${id}: prompt failed byte-proof overlay assertion`);
  const contamination = {
    clean: opts.arm === "jev_single" ? contaminationReasons.length === 0 : true,
    reasons: opts.arm === "jev_single" ? [...contaminationReasons] : [],
  };
  if (!contamination.clean) {
    for (const r of contamination.reasons) reasons.push(`contamination: ${r}`);
  }

  const done: ProbeMultiTrial = {
    ...running,
    status: opts.dryRun ? "dry-run" : "completed",
    durationMs: Date.now() - t0,
    agentTokens: totals,
    eligibility: {
      eligible: opts.dryRun ? false : reasons.length === 0,
      reasons: opts.dryRun ? ["dry-run: agent spawn skipped"] : reasons,
    },
    contamination,
    opencodeSessionId,
    probeResults,
    ...extra,
  };
  await opts.reportProgress(done);
  return done;
}

function printHelp(): void {
  console.log(`run-probe-multi.ts — multi-session probe eval (one fresh opencode run per probe).
One FRESH opencode run per probe (never --session): each probe gets a fresh
git workspace from the demo fixture plus per-probe arm setup, then a single
\`opencode run --auto --pure --format json\` with the probe + answer template
over stdin. ${Math.round(PROBE_MULTI_TIMEOUT_MS / 1000)}s timeout per probe
(PROBE_MULTI_TIMEOUT_MS), NDJSON via parseOpencodeJson. No arm runs
formatters, linters, typecheck, tests, or project-wide validation.

Arms (same tuning probe set, model, and demo-workspace fixture):
  load_all_single  Full APM catalog compiled into EACH probe's prompt via
                   compileOverlay. Runner-owned materialized set = every
                   catalog id. unloadMode=none.
  apm_discovery    Each probe workspace gets fixture apm.yml + .apm/ plus
                   \`${APM_BIN} install --target opencode,antigravity\`
                   output (.agents/rules/ + .agents/skills/) committed in
                   place. The agent discovers rules/skills autonomously.
                   Materialized set unknown (null). unloadMode=none.
  jev_single       Workspace gets the demo fixture ONLY (no apm.yml, .apm/,
                   .agents/rules/, .agents/skills/ — the contamination gate
                   fails the trial if any appear). The catalog lives in a
                   controller-owned store outside the workspace. NO plugin,
                   NO --session. A FRESH ProgressiveSession per probe routes
                   exactly ONE event (the probe question); the
                   harness-assembled effective request (kernel + exactly one
                   overlay, scrubbed history) becomes that probe's prompt.
                   Unload is BYTE-PROOF: each session gets exactly one
                   overlay and no history.

Artifact: kind "probe-multi" with trials[] carrying probeResults[] per probe
({ probeId, answer, retrieval{citedExpected, citedForbidden, quoteHit},
materializedIds, contextTokens, freshSession:true }) plus
trial.contamination {clean, reasons[]} from the per-probe workspace +
tool-call gate. Top-level probeSet (full content-probe definitions, recall
probes excluded), recallTemplate, evaluator, probeSetHash, and evaluatorHash
travel with the artifact so the separate grader (probe/grade-run.ts) can
judge without reading disk. Progress sidecar at results/.live/<runId>.json
(deleted after the final artifact writes successfully).

Options:
  --arms=<a,b,c>       subset of load_all_single,apm_discovery,jev_single (default: jev_single)
  --probe-set=<s>      v1 | v2 | v3 (default: v3 = 26 content probes across
                       v1+v2+v3 plus auto-inserted recall probes at each phase
                       boundary: id <prev>-recall, phase recall)
  --model=<m>          opencode model (default: $AGENT_MODEL or ${DEFAULT_MODEL})
  --opencode-bin=<p>   opencode binary (default: $OPENCODE_BIN or "opencode")
  --dry-run            set up workspaces + routing per probe but skip the
                       opencode spawn; writes a valid artifact with
                       status "dry-run"
  --hybrid-memory      per-probe fresh sessions PLUS a runner-maintained
                       auditable memory file (ws-memory/.agents/jev-memory.md,
                       one shared dir per arm) appended after each probe and
                       carried into the next probe's prompt as a <memory>
                       block (4000-char cap, newest kept). Unload stays
                       byte-proof: memory is explicit content, not history.
  --help, -h           this text
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const armsIdx = args.findIndex((a) => a === "--arms");
  const armsArg = args.find((a) => a.startsWith("--arms="))?.slice(7) ?? (armsIdx >= 0 ? args[armsIdx + 1] : undefined) ?? DEFAULT_ARMS.join(",");
  const arms = armsArg.split(",").filter(Boolean) as ProbeMultiArm[];
  for (const arm of arms) {
    if (!PROBE_MULTI_ARMS.includes(arm)) {
      console.error(`[run-probe-multi] unknown arm: ${arm} (expected one of ${PROBE_MULTI_ARMS.join(",")})`);
      printHelp();
      process.exit(1);
    }
  }
  const model = args.find((a) => a.startsWith("--model="))?.slice(8) ?? process.env["AGENT_MODEL"] ?? DEFAULT_MODEL;
  const opencodeBin = args.find((a) => a.startsWith("--opencode-bin="))?.slice(15) ?? process.env["OPENCODE_BIN"] ?? "opencode";
  const dryRun = args.includes("--dry-run");

  const runId = `probe-multi-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const provenance = checkProvenance();
  const versions = await collectVersions();
  versions["agentModel"] = model;
  let storePath = "";
  let cat: Catalog;
  try {
    storePath = await setupIsolatedApmStore();
    cat = await loadCatalog(storePath);
  } catch (err) {
    console.error(`[run-probe-multi] controller store setup failed, falling back to PKG_DIR: ${String(err).slice(0, 200)}`);
    storePath = "";
    cat = await loadCatalog(PKG_DIR);
  }
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as ThresholdConfig;
  const cfgHash = createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
  const baseFixtureHash = (await hashDirectory(join(REPO_ROOT, "fixtures/demo-workspace"))).slice(0, 16);
  const probeSetIdx = args.findIndex((a) => a === "--probe-set");
  const probeSetArg = args.find((a) => a.startsWith("--probe-set="))?.slice(12) ?? (probeSetIdx >= 0 ? args[probeSetIdx + 1] : undefined) ?? "v3";
  if (probeSetArg !== "v1" && probeSetArg !== "v2" && probeSetArg !== "v3" && probeSetArg !== "v4") {
    console.error(`[run-probe-multi] unknown probe set: ${probeSetArg} (expected v1, v2, v3, or v4)`);
    printHelp();
    process.exit(1);
  }
  const probeFiles = probeSetArg === "v1" ? [PROBE_FIXTURE]
    : probeSetArg === "v2" ? [PROBE_FIXTURE_V2]
    : probeSetArg === "v4" ? [PROBE_FIXTURE_V4]
    : [PROBE_FIXTURE, PROBE_FIXTURE_V2, PROBE_FIXTURE_V3];
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
  // phase differs from the previous content probe's phase. Each recall probe
  // runs in its own fresh session like every other probe; expectedIds/mustCite
  // inherit the previous content probe's expectedIds so retrieval is scored
  // against the pre-shift active set. Id scheme <prevId>-recall, phase "recall".
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
  const probeSetDefs = contentProbes.map((p) => ({
    id: p.id,
    phase: p.phase,
    question: p.question,
    expectedIds: [...p.expectedIds],
    expectedSkills: [...p.expectedSkills],
    forbiddenIds: [...p.forbiddenIds],
    mustCite: [...p.mustCite],
    mustQuote: [...p.mustQuote],
    mustNotCite: [...p.mustNotCite],
  }));
  const recallTemplate = { idSuffix: recallIdSuffix, question: recallQuestion };
  const evaluator = { ...EVALUATOR };
  const probeSetHash = createHash("sha256").update(canonicalize(probeSetDefs)).digest("hex").slice(0, 16);
  const evaluatorHash = createHash("sha256").update(canonicalize(evaluator)).digest("hex").slice(0, 16);
  const apiKey = process.env["TYPESAFE_API_KEY"];
  const backend: ScoreBackend = apiKey
    ? new SystemOneBackend(apiKey, process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest")
    : new HeuristicBackend();
  const backendLabel = (apiKey ? "provider" : "failopen") as "provider" | "failopen";
  console.error(`[run-probe-multi] routing backend: ${backendLabel === "provider" ? "SystemOneBackend(provider)" : "HeuristicBackend(fail_open)"} model=${model} probes=${probes.length}${dryRun ? " dry-run" : ""}`);
  const loadAllTokens = [...cat.byId.values()].reduce((a, d) => a + d.estimatedTokens, 0);
  const catalogIds = [...cat.byId.keys()].sort();
  const demoDir = join(REPO_ROOT, "fixtures/demo-workspace");
  const liveDir = join(RESULTS_DIR, ".live");
  const livePath = join(liveDir, `${runId}.json`);
  const liveTrials = new Map<string, ProbeMultiTrial>();
  const sidecar: ProbeMultiSidecar = {
    schemaVersion: 1,
    runId,
    kind: "probe-multi",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    model,
    routingBackend: backendLabel === "provider" ? "provider_backed" : "fail_open",
    probeSetVersion: probeVersions.join("+"),
    trials: [],
  };
  const reportProgress = async (trial: ProbeMultiTrial): Promise<void> => {
    liveTrials.set(`${trial.trialId}:${trial.arm}`, trial);
    sidecar.trials = [...liveTrials.values()];
    await writeSidecar(livePath, sidecar);
  };
  await mkdir(liveDir, { recursive: true });
  await writeSidecar(livePath, sidecar);

  const trialResults: ProbeMultiTrial[] = [];
  let n = 0;
  for (const arm of arms) {
    n += 1;
    const trialId = `trial-${n}`;
    console.error(`[run-probe-multi] ${trialId} arm=${arm}${dryRun ? " (dry-run)" : ""}`);
    const r = await runProbeMultiArm({
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
      dryRun,
      hybridMemory: args.includes("--hybrid-memory"),
      backend,
      storePath,
      reportProgress,
    });
    trialResults.push(r);
  }

  const artifact = {
    runId,
    kind: "probe-multi",
    status: "completed",
    createdAt,
    model,
    probeSetVersion: probeVersions.join("+"),
    probeSet: probeSetDefs,
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
    console.error(`workspace ${t.trialId} ${t.arm}: ${(t["workspaces"] as string[] ?? []).length} probe workspaces (last: ${t.workspace})`);
  }
}

await main();
