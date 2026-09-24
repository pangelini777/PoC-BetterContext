// Build-slice three-arm comparison: load_all_single vs apm_discovery vs
// jev_single on the refund-slice fixture. One controller-driven session per
// arm (MAX_TURNS turns, one `opencode run` per turn), same TASK_PROMPT /
// model / fixture; only the APM context policy differs.
//
// - load_all_single: full catalog compiled ONCE via compileOverlay and
//   prepended to every turn prompt (FIXED wiring, no rerouting, no .agents/).
// - apm_discovery: workspace gets fixture apm.yml + .apm/ plus the brew APM
//   `install --target opencode,antigravity` output (.agents/rules/ +
//   .agents/skills/) committed in place. The agent discovers autonomously.
//   No compile, no AGENTS.md.
// - jev_single: same discovery files PLUS the OpenCode plugin
//   (single-session/jev-plugin.ts, transpiled to
//   .opencode/plugins/jev-single.mjs, wired via .opencode/opencode.json with
//   the singular "plugin" key; module default-exports { id, server }) that
//   per turn scrubs every <jev-apm-context> block from the emitted lists and
//   injects exactly one fresh overlay carrying the current materialized set.
//   Routing is runner-owned: the runner drives ProgressiveSession once up
//   front and writes .agents/jev-decisions.json; the plugin reads it per
//   turn. Unload here is BEHAVIORAL (absent from emitted messages), never
//   byte-proof — recorded honestly in unloadMode + eligibility reasons.
//
// Controller loop mirrors run-live: per-turn `opencode run --auto --format
// json` with the prompt over stdin (native Bun.spawn), 300s/turn timeout,
// 16 completed-tool-call streaming budget (kill on budget), NDJSON parsed via
// parseOpencodeJson, CONTINUE/DONE protocol. jev_single runs WITHOUT --pure
// so its plugin loads; the other arms use --pure. Hidden refund verification
// (verifyRefund, incl. the agent's own bun test) runs post-run, outside the
// agent loop. No arm runs formatters, linters, typecheck, tests, or
// project-wide validation; the hidden verifier is the only post-run check.

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
import { verifyRefund } from "./independent/verify-refund.ts";
import { parseOpencodeJson } from "./live/opencode-parser.ts";
import type { ParsedRun } from "./live/opencode-parser.ts";

export const TASK_PROMPT = `Implement POST /api/refunds with Idempotency-Key handling (scoped replay 200 + Idempotent-Replayed vs 422 on key reuse), trusted server-side totals from the fixture catalog (never client totals), and one focused bun test proving duplicate delivery converges. Do not run validation suites; do not deploy.`;
export const JOURNEY_TASK_PROMPT = `4-phase engineering journey (up to 30 turns total; advance exactly one coherent phase per turn and end each turn with CONTINUE, or DONE only when all four phases are implemented and verified). Implement new modules at their fixture paths (route.ts, lib/notify.ts, lib/privacy.ts, journey.test.ts, release.sh); do not create root-level duplicates (notify.ts, privacy.ts). Complete the phases in order: do not start Phase 4 until the Phase 3 files exist with real implementations. Phase 1 (turns 1-7) refunds: implement POST /api/refunds with Idempotency-Key handling (scoped replay 200 + Idempotent-Replayed vs 422 on key reuse) and trusted server-side totals from the fixture catalog (never client totals). Phase 2 (turns 8-14) notifications: implement lib/notify.ts with an email template plus SMS fallback and retry. Phase 3 (turns 15-22) privacy: implement the GDPR deletion endpoint plus audit export in lib/privacy.ts. Phase 4 (turns 23-30) release: write the deploy checklist plus release.sh with migration ordering. Do not run validation suites; do not deploy.`;
export const JOURNEY2_TASK_PROMPT = `2-phase engineering journey (up to 20 turns total; advance exactly one coherent step per turn and end each turn with CONTINUE, or DONE only when both phases are implemented and verified). Implement new modules at their fixture paths (route.ts, lib/notify.ts, lib/privacy.ts, journey.test.ts); do not create root-level duplicates (notify.ts, privacy.ts). Phase 1 (turns 1-10) refunds: implement POST /api/refunds with Idempotency-Key handling (scoped replay 200 + Idempotent-Replayed vs 422 on key reuse) and trusted server-side totals from the fixture catalog (never client totals), plus a focused bun test proving duplicate delivery converges. Phase 2 (turns 11-20) notifications: implement lib/notify.ts with an email template plus SMS fallback and retry, plus a focused bun test proving fallback converges. Do not run validation suites; do not deploy.`;

/** Phase gate: observable file-existence + non-stub check. No gold labels —
 * the controller reads workspace files only, same class as the test-gate. */
export interface PhaseGate {
  phase: number;
  files: string[];
}
export const JOURNEY_GATES: PhaseGate[] = [
  { phase: 1, files: ["route.ts"] },
  { phase: 2, files: ["lib/notify.ts"] },
  { phase: 3, files: ["lib/privacy.ts"] },
  { phase: 4, files: ["release.sh"] },
];
export const JOURNEY2_GATES: PhaseGate[] = [
  { phase: 1, files: ["route.ts"] },
  { phase: 2, files: ["lib/notify.ts"] },
];


export type VerifierKind = "refund" | "journey" | "journey2";
export const DEFAULT_FIXTURE = "refund-slice";
export const DEFAULT_TASK_ID = "refund-slice";
export const DEFAULT_VERIFIER: VerifierKind = "refund";

export const DEFAULT_MODEL = "local/qwen3";

/** Pinned brew APM binary. Never /usr/local/bin/apm (stale 0.9.4). */
export const APM_BIN = "/home/linuxbrew/.linuxbrew/bin/apm";

const MAX_TURNS = Number(process.env["BUILD_MAX_TURNS"] ?? 10);
const TURN_TIMEOUT_MS = 300_000;
const MAX_TOOL_CALLS_PER_TURN = 16;
const APM_TIMEOUT_MS = 120_000;

const SKIP_VALIDATION_LINE =
  "Do not run formatters, linters, typecheck, or test suites; implement the changes without executing project validation.";

const FIXTURE_DIR = join(REPO_ROOT, "fixtures/refund-slice");
const PLUGIN_SRC = join(REPO_ROOT, "evals/progressive-context/single-session/jev-plugin.ts");
const PLUGIN_DEST_REL = ".opencode/plugins/jev-single.mjs";
const DECISIONS_REL = ".agents/jev-decisions.json";
const TURN_LOG_REL = ".agents/jev-plugin-turns.jsonl";

export type BuildArm = "load_all_single" | "apm_discovery" | "jev_single";
export type UnloadMode = "byte-proof" | "behavioral" | "none";

const BUILD_ARMS: BuildArm[] = ["load_all_single", "apm_discovery", "jev_single"];

const UNLOAD_MODE: Record<BuildArm, UnloadMode> = {
  load_all_single: "none",
  apm_discovery: "none",
  jev_single: "behavioral",
};

export interface ContextSample {
  turn: number;
  compiledResourceTokens: number;
  loadedResources: number;
}

interface BuildTrial {
  trialId: string;
  arm: BuildArm;
  status: "running" | "completed" | "failed" | "skipped" | "dry-run";
  turns: number;
  durationMs: number;
  agentTokens: { input: number; output: number; reasoning: number; total: number };
  contextSamples: ContextSample[];
  verification: { checks: { name: string; pass: boolean; detail: string }[]; passed: number; total: number } | null;
  verificationComplete: boolean;
  unloadMode: UnloadMode;
  eligibility: { eligible: boolean; reasons: string[] };
  workspace: string;
  [key: string]: unknown;
}

interface BuildSidecar {
  schemaVersion: 1;
  runId: string;
  kind: "build-slice";
  status: "running" | "completed";
  createdAt: string;
  updatedAt: string;
  model: string;
  routingBackend: "provider_backed" | "fail_open";
  taskPromptHash: string;
  trials: BuildTrial[];
}

async function writeSidecar(path: string, sidecar: BuildSidecar): Promise<void> {
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

async function gitFiles(ws: string): Promise<Set<string>> {
  const r = await sh("git", ["status", "--porcelain", "-uall"], ws);
  const files = new Set<string>();
  for (const line of r.out.split("\n")) {
    const m = line.match(/^[ MADRCU?!]{1,2}\s+(.+)$/);
    if (m) {
      const p = m[1].trim().replace(/^"(.*)"$/, "$1");
      const arrow = p.indexOf(" -> ");
      files.add(arrow >= 0 ? p.slice(arrow + 4) : p);
    }
  }
  return files;
}

interface AgentTurnResult {
  run: ParsedRun;
  rawBytes: number;
  ms: number;
  timedOut: boolean;
  budgetReached: boolean;
}

/** One controller turn. Prompt travels over stdin (never argv); pure only
 *  when the arm needs no workspace plugin (jev_single must load its own).
 *  Streaming tool-call budget: kill after MAX_TOOL_CALLS_PER_TURN completed
 *  tool_use events; TURN_TIMEOUT_MS hard timeout. */
async function agentTurn(model: string, opencodeBin: string, ws: string, prompt: string, pure: boolean): Promise<AgentTurnResult> {
  const t0 = Date.now();
  // Native Bun spawning is required here. Bun's Node-compatible execFile shim
  // can leave `opencode run` stalled before it opens the provider connection.
  // The prompt travels over stdin rather than argv so long multi-turn context
  // cannot exceed the OS argument-size limit (E2BIG).
  const args = ["run", "--dir", ws, "--model", model, "--auto", "--format", "json"];
  if (pure) args.push("--pure");
  const child = Bun.spawn([opencodeBin, ...args], {
    cwd: ws,
    env: process.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(prompt);
  child.stdin.end();
  let timedOut = false;
  let budgetReached = false;
  const completedCalls = new Set<string>();
  const decoder = new TextDecoder();
  let pending = "";
  let stdout = "";

  const stdoutPromise = (async (): Promise<void> => {
    const reader = child.stdout.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const text = decoder.decode(chunk.value, { stream: true });
      stdout += text;
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          if (event["type"] !== "tool_use") continue;
          const part = (event["part"] ?? {}) as Record<string, unknown>;
          const state = (part["state"] ?? {}) as Record<string, unknown>;
          if (state["status"] !== "completed" && state["status"] !== "error") continue;
          const callId = typeof part["callID"] === "string"
            ? part["callID"]
            : `${String(part["tool"] ?? "unknown")}:${completedCalls.size}`;
          completedCalls.add(callId);
          if (!budgetReached && completedCalls.size >= MAX_TOOL_CALLS_PER_TURN) {
            budgetReached = true;
            child.kill();
          }
        } catch {
          // Parser records malformed output later; streaming control stays fail-open.
        }
      }
    }
    stdout += decoder.decode();
  })();

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, TURN_TIMEOUT_MS);
  let stderr = "";
  try {
    [, stderr] = await Promise.all([
      stdoutPromise,
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
    budgetReached,
  };
}

/** Fresh git workspace from the refund-slice fixture. Returns ws path + base commit. */
async function freshWorkspace(trialId: string, arm: BuildArm, fixtureDir: string): Promise<{ ws: string; baseCommit: string }> {
  const ws = await mkdtemp(join(tmpdir(), `jev-build-${trialId}-${arm}-`));
  try {
    checkProvenance({ workspace: ws });
  } catch (err) {
    throw new Error(`provenance guard failed: ${String(err).slice(0, 200)}`);
  }
  await cp(fixtureDir, ws, { recursive: true });
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

async function runBuildArm(opts: {
  arm: BuildArm;
  trialId: string;
  model: string;
  opencodeBin: string;
  runId: string;
  cfg: ThresholdConfig;
  cfgHash: string;
  taskPromptHash: string;
  baseFixtureHash: string;
  backend: ScoreBackend;
  backendLabel: "provider" | "failopen";
  catalogHash: string;
  loadAllTokens: number;
  catalogBodies: Map<string, string>;
  catalogRules: ResourceDescriptor[];
  catalogSkills: ResourceDescriptor[];
  catalogById: Map<string, ResourceDescriptor>;
  catalogIds: string[];
  fixtureDir: string;
  taskPrompt: string;
  verifier: VerifierKind;
  dryRun: boolean;
  reportProgress: (trial: BuildTrial) => Promise<void>;
}): Promise<BuildTrial> {
  const t0 = Date.now();
  const taskPrompt = opts.taskPrompt;
  const unloadMode = UNLOAD_MODE[opts.arm];
  const blankTokens = { input: 0, output: 0, reasoning: 0, total: 0 };

  const { ws, baseCommit } = await freshWorkspace(opts.trialId, opts.arm, opts.fixtureDir);
  const running: BuildTrial = {
    trialId: opts.trialId,
    arm: opts.arm,
    status: "running",
    turns: 0,
    durationMs: 0,
    agentTokens: { ...blankTokens },
    contextSamples: [],
    verification: null,
    verificationComplete: false,
    unloadMode,
    eligibility: { eligible: false, reasons: ["running"] },
    workspace: ws,
  };
  await opts.reportProgress({ ...running, durationMs: Date.now() - t0 });

  // FIXED arm wiring (identical to run-single): full overlay prompt for
  // load_all; discovery install for the other two; decisions file + plugin
  // for jev. The controller loop below only varies the per-turn prompt
  // wrapper, never the wiring.
  let usePure = true;
  const extra: Record<string, unknown> = { baseCommit };
  let provenanceOk = true;
  try {
    checkProvenance({ workspace: ws });
  } catch {
    provenanceOk = false;
  }

  let compiledOverlay = "";
  let compiledTokens = 0;
  let jevCompiledTokens = 0;
  let jevLoadedResources = 0;
  let buildSess: ProgressiveSession | null = null;

  if (opts.arm === "load_all_single") {
    const compiled = compileOverlay(opts.catalogIds, opts.catalogBodies, "evt-build-000");
    compiledOverlay = compiled.dynamicOverlay;
    compiledTokens = compiled.resourceTokenEstimate;
    extra["compiledOverlaySha256"] = compiled.overlaySha256;
  } else {
    const install = await installApmDiscovery(ws);
    extra["apmInstall"] = install;
    if (install.code !== 0) {
      const failed: BuildTrial = {
        ...running,
        status: "failed",
        durationMs: Date.now() - t0,
        contextSamples: [{ turn: 0, compiledResourceTokens: 0, loadedResources: 0 }],
        eligibility: { eligible: false, reasons: ["apm install failed for opencode,antigravity targets"] },
        ...extra,
      };
      await opts.reportProgress(failed);
      return failed;
    }
    if (opts.arm === "jev_single") {
      let pluginJs: string;
      try {
        const src = await readFile(PLUGIN_SRC, "utf8");
        pluginJs = new Bun.Transpiler({ loader: "ts" }).transformSync(src, "ts");
      } catch {
        const skipped: BuildTrial = {
          ...running,
          status: "skipped",
          durationMs: Date.now() - t0,
          contextSamples: [{ turn: 0, compiledResourceTokens: 0, loadedResources: 0 }],
          eligibility: { eligible: false, reasons: ["plugin-missing: single-session/jev-plugin.ts not landed"] },
          ...extra,
        };
        await opts.reportProgress(skipped);
        return skipped;
      }
      // Runner-owned ProgressiveSession. Seeded once here, then stepped
      // per turn inside the controller loop (per-turn routing). The plugin
      // reads the decisions file the runner rewrites each turn.
      buildSess = new ProgressiveSession({
        runId: opts.runId,
        sessionId: `${opts.trialId}-${opts.arm}`,
        arm: "progressive_jev",
        goal: taskPrompt,
        catalogHash: opts.catalogHash,
        bodies: opts.catalogBodies,
        rules: opts.catalogRules,
        skills: opts.catalogSkills,
        byId: opts.catalogById,
        cfg: opts.cfg,
        backend: opts.backend,
        loadAllTokens: opts.loadAllTokens,
      });
      const rec = await buildSess.runEvent({ kind: "user_message", text: taskPrompt, phase: "ui", changedPaths: [] });
      // Runner-owned routing up front: one initial event seeds the decisions
      // file the plugin reads per turn. No gold labels enter this path.
      const decisions = {
        eventId: rec.semanticEventId,
        kernel: KERNEL,
        materialized: rec.materializedAfter.map((id: string) => ({
          id,
          name: id.includes(".") ? id.slice(id.indexOf(".") + 1) : id,
          body: opts.catalogBodies.get(id) ?? "",
        })),
        evictedIds: [],
        evictedProbes: {},
      };
      await mkdir(join(ws, ".agents"), { recursive: true });
      await writeFile(join(ws, DECISIONS_REL), `${JSON.stringify(decisions, null, 2)}\n`);
      await mkdir(join(ws, ".opencode/plugins"), { recursive: true });
      await writeFile(join(ws, PLUGIN_DEST_REL), pluginJs);
      // V1 (opencode 1.18.31) reads workspace plugin config from
      // .opencode/opencode.json with the singular "plugin" key. A project-root
      // opencode.json "plugins" entry is rejected as unsupported (compat
      // diagnostic: "Omitted native setting that cannot be represented in V1").
      await writeFile(join(ws, ".opencode/opencode.json"), `${JSON.stringify({ plugin: [`./plugins/jev-single.mjs`] }, null, 2)}\n`);
      await sh("git", ["add", "-A"], ws);
      await sh("git", ["-c", "user.email=poc@local", "-c", "user.name=poc", "commit", "-qm", "jev-single-plugin"], ws);
      extra["decisionsEventId"] = decisions.eventId;
      extra["pluginBytes"] = pluginJs.length;
      jevCompiledTokens = rec.compiledResourceTokens;
      jevLoadedResources = rec.materializedAfter.length;
      usePure = false;
    }
  }


  if (opts.dryRun) {
    const dry: BuildTrial = {
      ...running,
      status: "dry-run",
      durationMs: Date.now() - t0,
      contextSamples: [opts.arm === "load_all_single"
        ? { turn: 0, compiledResourceTokens: compiledTokens, loadedResources: opts.catalogIds.length }
        : opts.arm === "jev_single"
          ? { turn: 0, compiledResourceTokens: jevCompiledTokens, loadedResources: jevLoadedResources }
          : { turn: 0, compiledResourceTokens: 0, loadedResources: 0 }],
      eligibility: { eligible: false, reasons: ["dry-run: agent spawn skipped"] },
      ...extra,
    };
    await opts.reportProgress(dry);
    return dry;
  }

  const baseFiles = await gitFiles(ws);
  const contextSamples: ContextSample[] = [];
  const turnRecords: unknown[] = [];
  let cumulativeIn = 0;
  let cumulativeOut = 0;
  let cumulativeReasoning = 0;
  let cumulativeTotal = 0;
  let timedOutAny = false;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Test-gate (JEV arm, build sessions only): ask System One whether
    // running the test suite this turn would give actionable signal, given
    // changed paths + tool activity so far. Probe arms and non-JEV arms
    // keep the validation ban unconditionally.
    let allowTestsThisTurn = false;
    if (opts.arm === "jev_single" && turnRecords.length > 0) {
      const last = turnRecords[turnRecords.length - 1] as { changedPaths?: string[]; toolCalls?: { name: string }[] };
      const changedSoFar = [...new Set(turnRecords.flatMap((r) => (r as { changedPaths?: string[] }).changedPaths ?? []))];
      const hasCodeChanges = changedSoFar.some((p) => /\.(ts|tsx|js|jsx|sql|sh)$/.test(p));
      if (hasCodeChanges) {
        try {
          const { systemOne } = await import("../../packages/jev-client/src/client.ts");
          const res = await systemOne(
            {
              goal: taskPrompt,
              turn: turn + 1,
              maxTurns: MAX_TURNS,
              changedPaths: changedSoFar,
              lastTurnTools: (last.toolCalls ?? []).map((c) => c.name),
            },
            {
              run_tests_now: {
                type: "noul",
                instructions: "Is the current phase's implementation substantially complete, such that verifying now would unblock starting the next phase — rather than mid-phase work still being in progress?",
                criteria: {
                  true: "The current phase looks substantially implemented (new module plus its test exist); a verification run now would confirm readiness to advance.",
                  false: "Work is still mid-phase (files being created/edited, modules missing) or tests just ran with no intervening changes; testing now would interrupt progress.",
                },
              },
            },
            { apiKey: process.env["TYPESAFE_API_KEY"] ?? "", timeoutMs: 60_000 },
          );
          const a = res.answers["run_tests_now"];
          allowTestsThisTurn = a !== undefined && a.type === "noul" && a.noul >= 0.5;
          (turnRecords[turnRecords.length - 1] as Record<string, unknown>).testGate = {
            fired: allowTestsThisTurn,
            score: a !== undefined && a.type === "noul" ? a.noul : null,
          };
        } catch {
          // Fail-closed: gate errors keep the ban (never auto-allow).
          allowTestsThisTurn = false;
        }
      }
    }
    const validationLine = allowTestsThisTurn
      ? "You may run `bun test <file>` once this turn to check your work, then continue building."
      : SKIP_VALIDATION_LINE;
    // Phase gate (all arms, controller-owned): the earliest phase whose
    // files are missing-or-stub is the phase the agent must work on. Past
    // the phase's turn window with files still missing, the controller
    // prompt escalates to that phase explicitly. Observable harness state
    // only (file existence + NOT_IMPLEMENTED scan) — no gold labels.
    const gates = opts.verifier === "journey" ? JOURNEY_GATES : opts.verifier === "journey2" ? JOURNEY2_GATES : [];
    let gateDirective = "";
    let gateState: { phase: number; missing: string[]; escalated: boolean } | null = null;
    if (gates.length > 0) {
      const { readFile: readGateFile } = await import("node:fs/promises");
      for (const gate of gates) {
        const missing: string[] = [];
        for (const file of gate.files) {
          let body = "";
          try {
            body = await readGateFile(join(ws, file), "utf8");
          } catch {
            body = "";
          }
          if (body.trim().length < 50 || /NOT_IMPLEMENTED/.test(body)) missing.push(file);
        }
        if (missing.length > 0) {
          // Turn windows mirror the task prompt phase ranges (4-phase:
          // 1-7/8-14/15-22/23-30; 2-phase: 1-10/11-20). Escalate once the
          // window for this phase has passed without its files.
          const windowEnd = gates.length === 4 ? [7, 14, 22, 30][gate.phase - 1]! : [10, 20][gate.phase - 1]!;
          const escalated = turn >= windowEnd;
          gateState = { phase: gate.phase, missing, escalated };
          gateDirective = escalated
            ? `Phase ${gate.phase} is still missing its implementation (${missing.join(", ")}). Work on Phase ${gate.phase} ONLY this turn: implement the missing files before any other work.`
            : `Current earliest incomplete phase: Phase ${gate.phase} (${missing.join(", ")} missing). Prefer advancing it.`;
          break;
        }
      }
    }
    const controllerPrompt = `<controller-turn index="${turn + 1}" max="${MAX_TURNS}">
Work on exactly one coherent next phase of the task, using at most ${MAX_TOOL_CALLS_PER_TURN} tool calls.
Inspect the current workspace first so you continue prior work rather than restart it.
Do not merely describe planned work: make concrete progress in this phase.
${gateDirective}
End your response with a line containing exactly CONTINUE if work remains, or exactly DONE only when the entire task is implemented and verified.
</controller-turn>`;
    let agentPrompt: string;
    if (opts.arm === "load_all_single") {
      agentPrompt = `${KERNEL}\n${compiledOverlay}\n\n${controllerPrompt}\n\n<task>\n${taskPrompt}\n</task>\n\nWork in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.\n${SKIP_VALIDATION_LINE}`;
    } else if (opts.arm === "apm_discovery") {
      agentPrompt = `${controllerPrompt}\n\n<task>\n${taskPrompt}\n</task>\n\nThis workspace uses APM-managed context (apm.yml, .apm/, .agents/rules/, .agents/skills/). Discover and follow the relevant rules and skills autonomously. Work in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.\n${SKIP_VALIDATION_LINE}`;
    } else {
      agentPrompt = `${controllerPrompt}\n\n<task>\n${taskPrompt}\n</task>\n\nA workspace plugin manages progressive APM context each turn: treat the injected <jev-apm-context> overlay as authoritative for its scope. Work in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.\n${validationLine}`;
    }

    let tres: AgentTurnResult;
    try {
      tres = await agentTurn(opts.model, opts.opencodeBin, ws, agentPrompt, usePure);
    } catch (err) {
      const failed: BuildTrial = {
        ...running,
        status: "failed",
        turns: turnRecords.length,
        durationMs: Date.now() - t0,
        agentTokens: { input: cumulativeIn, output: cumulativeOut, reasoning: cumulativeReasoning, total: cumulativeTotal },
        contextSamples,
        eligibility: { eligible: false, reasons: [`opencode spawn failed: ${String(err).slice(0, 200)}`] },
        ...extra,
      };
      await opts.reportProgress(failed);
      return failed;
    }
    cumulativeIn += tres.run.inputTokens;
    cumulativeOut += tres.run.outputTokens;
    cumulativeReasoning += tres.run.reasoningTokens;
    cumulativeTotal += tres.run.totalTokens;
    if (tres.timedOut) timedOutAny = true;

    // Context sample pushed AFTER per-turn routing below, so it reflects
    // the post-routing materialized set (not the pre-turn one).

    const nowFiles = await gitFiles(ws);
    const changedPaths: string[] = [];
    for (const f of nowFiles) {
      if (!baseFiles.has(f)) {
        changedPaths.push(f);
        continue;
      }
      if ((await sh("git", ["diff", "--quiet", "--", f], ws)).code !== 0) changedPaths.push(f);
    }
    changedPaths.sort();
    turnRecords.push({
      turn,
      changedPaths,
      assistantTextChars: tres.run.assistantText.length,
      assistantText: tres.run.assistantText.slice(0, 2000),
      toolCalls: tres.run.turns.flatMap((t) => t.toolCalls.map((c) => ({ name: c.name, args: c.argsSummary.slice(0, 300), status: c.status }))),
      inputTokens: tres.run.inputTokens,
      outputTokens: tres.run.outputTokens,
      reasoningTokens: tres.run.reasoningTokens,
      totalTokens: tres.run.totalTokens,
      turnMs: tres.run.durationMs,
      wallMs: tres.ms,
      timedOut: tres.timedOut,
      budgetReached: tres.budgetReached,
      done: tres.run.done,
      phaseGate: gateState,
    });
    // Per-turn routing (JEV arm only): step the runner-owned session on the
    // observed turn outcome and rewrite the decisions file the plugin reads
    // next turn. Previous materialized set seeds eviction detection. No gold
    // labels enter this path: event text is assistant summary + tool names.
    // The plugin turn log is mirrored outside the workspace (runner-owned
    // telemetry the agent cannot read or destroy); the in-workspace copy
    // remains as the plugin's append target.
    if (opts.arm === "jev_single" && buildSess !== null) {
      try {
        const toolNames = tres.run.turns.flatMap((t) => t.toolCalls.map((c) => c.name));
        const prevDecisions = JSON.parse(await readFile(join(ws, DECISIONS_REL), "utf8")) as {
          materialized?: { id: string }[];
        };
        const prevIds = Array.isArray(prevDecisions.materialized) ? prevDecisions.materialized.map((m) => m.id).sort() : [];
        const rec = await buildSess.runEvent({
          kind: "observation",
          text: `turn ${turn}: ${tres.run.assistantText.slice(0, 500)} [tools: ${[...new Set(toolNames)].join(",")}]`,
          changedPaths: changedPaths.filter((p) => !p.startsWith(".agents/") && !p.startsWith(".opencode/")),
        });
        const nextIds = [...rec.materializedAfter].sort();
        const evicted = prevIds.filter((id) => !nextIds.includes(id));
        const evictedProbes: Record<string, string> = {};
        for (const id of evicted) evictedProbes[id] = (opts.catalogBodies.get(id) ?? "").slice(0, 60);
        await writeFile(join(ws, DECISIONS_REL), `${JSON.stringify({
          eventId: rec.semanticEventId,
          kernel: KERNEL,
          materialized: rec.materializedAfter.map((id: string) => ({
            id,
            name: id.includes(".") ? id.slice(id.indexOf(".") + 1) : id,
            body: opts.catalogBodies.get(id) ?? "",
          })),
          evictedIds: evicted,
          evictedProbes,
        }, null, 2)}\n`);
        jevCompiledTokens = rec.compiledResourceTokens;
        jevLoadedResources = rec.materializedAfter.length;
        (turnRecords[turnRecords.length - 1] as Record<string, unknown>).routing = {
          eventId: rec.semanticEventId,
          added: rec.added,
          removed: rec.removed,
          materialized: rec.materializedAfter,
        };
      } catch {
        // Fail-open: routing errors keep the previous decisions file; the
        // plugin re-injects the last known set (stability skip).
      }
      // Mirror the plugin turn log outside the workspace every turn, before
      // the agent's next turn can read or destroy it. Runner-owned telemetry.
      try {
        const logRaw = await readFile(join(ws, TURN_LOG_REL), "utf8");
        const mirrorDir = join(RESULTS_DIR, ".turnlog-mirror", `${opts.runId}-${opts.trialId}-${opts.arm}`);
        await mkdir(mirrorDir, { recursive: true });
        await writeFile(join(mirrorDir, `turn-${String(turn).padStart(3, "0")}.jsonl`), logRaw);
      } catch {
        // Missing log mirrors as absent; final collection reports it.
      }
    }
    contextSamples.push(opts.arm === "load_all_single"
      ? { turn, compiledResourceTokens: compiledTokens, loadedResources: opts.catalogIds.length }
      : opts.arm === "jev_single"
        ? { turn, compiledResourceTokens: jevCompiledTokens, loadedResources: jevLoadedResources }
        : { turn, compiledResourceTokens: 0, loadedResources: 0 });
    await opts.reportProgress({
      ...running,
      turns: turnRecords.length,
      durationMs: Date.now() - t0,
      agentTokens: { input: cumulativeIn, output: cumulativeOut, reasoning: cumulativeReasoning, total: cumulativeTotal },
      contextSamples: [...contextSamples],
    });

    const doneText = /^\s*DONE\b/i.test(tres.run.assistantText) || (tres.run.assistantText.includes("DONE") && turn >= 3);
    if (doneText || (tres.timedOut && tres.run.toolCallCount === 0 && changedPaths.length === 0)) break;
  }

  // Hidden independent verification runs AFTER the agent finished, outside ws.
  // verifier=journey resolves dynamically so the refund default never depends
  // on verify-journey.ts being present.
  let verification: BuildTrial["verification"];
  let verificationComplete = true;
  try {
    if (opts.verifier === "journey") {
      const mod = (await import("./independent/verify-journey.ts")) as {
        verifyJourney: (ws: string) => Promise<NonNullable<BuildTrial["verification"]>>;
      };
      verification = await mod.verifyJourney(ws);
    } else if (opts.verifier === "journey2") {
      const mod = (await import("./independent/verify-journey2.ts")) as {
        verifyJourney2: (ws: string) => Promise<NonNullable<BuildTrial["verification"]>>;
      };
      verification = await mod.verifyJourney2(ws);
    } else {
      verification = await verifyRefund(ws);
    }
  } catch (err) {
    verificationComplete = false;
    verification = { checks: [{ name: "verifier-crashed", pass: false, detail: String(err).slice(0, 300) }], passed: 0, total: 1 };
  }

  // jev_single behavioral evidence: per-turn plugin log (never byte-proof).
  // Prefer the runner-owned mirror (agent cannot destroy it); fall back to
  // the in-workspace copy.
  let pluginTurns: unknown[] = [];
  if (opts.arm === "jev_single") {
    try {
      const mirrorDir = join(RESULTS_DIR, ".turnlog-mirror", `${opts.runId}-${opts.trialId}-${opts.arm}`);
      const names = (await readdir(mirrorDir)).filter((n) => n.endsWith(".jsonl")).sort();
      const latest = names.length > 0 ? names[names.length - 1] : null;
      const raw = latest !== null
        ? await readFile(join(mirrorDir, latest), "utf8")
        : await readFile(join(ws, TURN_LOG_REL), "utf8");
      pluginTurns = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
    } catch {
      pluginTurns = [];
    }
    extra["pluginTurns"] = pluginTurns.length;
  }

  const reasons: string[] = [];
  if (!verificationComplete) reasons.push("independent verification incomplete");
  if (!provenanceOk) reasons.push("workspace/provenance guard failed");
  if (timedOutAny) reasons.push(`opencode run hit the ${Math.round(TURN_TIMEOUT_MS / 1000)}s turn timeout`);
  if (opts.arm === "jev_single") {
    reasons.push("unloadMode=behavioral: overlay scrubbed from emitted messages only; not byte-proof (see jev-plugin.ts header)");
    if (pluginTurns.length === 0) reasons.push("no plugin turn log observed (.agents/jev-plugin-turns.jsonl missing)");
  }

  const completed: BuildTrial = {
    ...running,
    status: "completed",
    turns: turnRecords.length,
    durationMs: Date.now() - t0,
    agentTokens: {
      input: cumulativeIn,
      output: cumulativeOut,
      reasoning: cumulativeReasoning,
      total: cumulativeTotal,
    },
    contextSamples,
    verification,
    verificationComplete,
    eligibility: { eligible: reasons.length === 0, reasons },
    turnRecords,
    timedOutAny,
    ...extra,
  };
  await opts.reportProgress(completed);
  return completed;
}

function printHelp(): void {
  console.log(`run-build-slice.ts — build-slice 3-arm comparison (controller-driven sessions on the refund-slice fixture).

Arms (same TASK_PROMPT, model, and refund-slice fixture):
  load_all_single  Full APM catalog compiled once via compileOverlay and
                   prepended to every turn prompt. No rerouting, no .agents/.
                   unloadMode=none.
  apm_discovery    Workspace gets fixture apm.yml + .apm/ plus
                   \`${APM_BIN} install --target opencode,antigravity\`
                   output (.agents/rules/ + .agents/skills/) committed in
                   place. The agent discovers rules/skills autonomously.
                   No compile, no AGENTS.md. unloadMode=none.
  jev_single       Same discovery files PLUS the OpenCode plugin
                   (single-session/jev-plugin.ts transpiled to
                   .opencode/plugins/jev-single.mjs, wired via
                   .opencode/opencode.json with the singular "plugin" key)
                   that per turn scrubs all <jev-apm-context> blocks from the
                   emitted lists and injects exactly one fresh overlay with
                   the current materialized set from .agents/jev-decisions.json
                   (runner-owned routing via ProgressiveSession). Runs WITHOUT
                   --pure so the plugin loads. Unload is BEHAVIORAL (absent
                   from emitted messages only), flagged honestly as
                   unloadMode=behavioral — never byte-proof.

Each arm runs a controller loop of up to ${MAX_TURNS} turns: one \`opencode run
--auto --format json\` per turn with the prompt over stdin (native Bun.spawn),
${Math.round(TURN_TIMEOUT_MS / 1000)}s/turn timeout, ${MAX_TOOL_CALLS_PER_TURN}-tool-call streaming
budget, NDJSON via parseOpencodeJson, CONTINUE/DONE protocol, then hidden
verifyRefund post-run. No arm runs formatters, linters, typecheck, tests, or
project-wide validation.

Task: ${TASK_PROMPT}
Journey task (--verifier=journey): ${JOURNEY_TASK_PROMPT}

Artifact: kind "build-slice" with trials[] carrying arm, turns,
agentTokens, contextSamples[{turn, compiledResourceTokens, loadedResources}],
verification{passed,total}, and unloadMode. Progress sidecar at
results/.live/<runId>.json (deleted after the final artifact writes
successfully).

Options:
  --arms=<a,b,c>       subset of ${BUILD_ARMS.join(",")} (default: all three)
  --model=<m>          opencode model (default: $AGENT_MODEL or ${DEFAULT_MODEL})
  --opencode-bin=<p>   opencode binary (default: $OPENCODE_BIN or "opencode")
  --fixture=<name>   fixture directory under fixtures/ (default: ${DEFAULT_FIXTURE})
  --verifier=<v>     refund | journey | journey2 (default: ${DEFAULT_VERIFIER}); journey
                     selects the 4-phase journey task prompt and verifies via a
                     dynamic import of ./independent/verify-journey.ts; journey2
                     selects the 2-phase refunds+notifications prompt and verifies
                     via ./independent/verify-journey2.ts
  --dry-run            set up workspaces + decisions/plugin files but skip the
                       agent loop; writes a valid artifact with
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
  const armsArg = args.find((a) => a.startsWith("--arms="))?.slice(7) ?? BUILD_ARMS.join(",");
  const arms = armsArg.split(",").filter(Boolean) as BuildArm[];
  for (const arm of arms) {
    if (!BUILD_ARMS.includes(arm)) {
      console.error(`[run-build-slice] unknown arm: ${arm} (expected one of ${BUILD_ARMS.join(",")})`);
      printHelp();
      process.exit(1);
    }
  }
  const model = args.find((a) => a.startsWith("--model="))?.slice(8) ?? process.env["AGENT_MODEL"] ?? DEFAULT_MODEL;
  const opencodeBin = args.find((a) => a.startsWith("--opencode-bin="))?.slice(15) ?? process.env["OPENCODE_BIN"] ?? "opencode";
  const dryRun = args.includes("--dry-run");
  const fixture = args.find((a) => a.startsWith("--fixture="))?.slice(10) || DEFAULT_FIXTURE;
  const taskId = args.find((a) => a.startsWith("--task-id="))?.slice(10) || DEFAULT_TASK_ID;
  const verifier = ((args.find((a) => a.startsWith("--verifier="))?.slice(11) || DEFAULT_VERIFIER) as VerifierKind);
  if (verifier !== "refund" && verifier !== "journey" && verifier !== "journey2") {
    console.error(`[run-build-slice] unknown verifier: ${verifier} (expected refund|journey|journey2)`);
    printHelp();
    process.exit(1);
  }
  const fixtureDir = join(REPO_ROOT, "fixtures", fixture);
  const taskPrompt = verifier === "journey" ? JOURNEY_TASK_PROMPT : verifier === "journey2" ? JOURNEY2_TASK_PROMPT : TASK_PROMPT;

  const runId = `build-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const provenance = checkProvenance();
  const versions = await collectVersions();
  versions["agentModel"] = model;
  const cat = await loadCatalog(PKG_DIR);
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as ThresholdConfig;
  const cfgHash = createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
  const taskPromptHash = createHash("sha256").update(taskPrompt).digest("hex").slice(0, 16);
  let baseFixtureHash: string;
  try {
    baseFixtureHash = (await hashDirectory(fixtureDir)).slice(0, 16);
  } catch {
    baseFixtureHash = "missing";
  }
  const apiKey = process.env["TYPESAFE_API_KEY"];
  const backend: ScoreBackend = apiKey
    ? new SystemOneBackend(apiKey, process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest")
    : new HeuristicBackend();
  const backendLabel = (apiKey ? "provider" : "failopen") as "provider" | "failopen";
  console.error(`[run-build-slice] routing backend: ${backendLabel === "provider" ? "SystemOneBackend(provider)" : "HeuristicBackend(fail_open)"} model=${model}${dryRun ? " dry-run" : ""}`);
  const loadAllTokens = [...cat.byId.values()].reduce((a, d) => a + d.estimatedTokens, 0);
  const catalogIds = [...cat.byId.keys()].sort();
  const liveDir = join(RESULTS_DIR, ".live");
  const livePath = join(liveDir, `${runId}.json`);
  const liveTrials = new Map<string, BuildTrial>();
  const sidecar: BuildSidecar = {
    schemaVersion: 1,
    runId,
    kind: "build-slice",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    model,
    routingBackend: backendLabel === "provider" ? "provider_backed" : "fail_open",
    taskPromptHash,
    trials: [],
  };
  const reportProgress = async (trial: BuildTrial): Promise<void> => {
    liveTrials.set(`${trial.trialId}:${trial.arm}`, trial);
    sidecar.trials = [...liveTrials.values()];
    await writeSidecar(livePath, sidecar);
  };
  await mkdir(liveDir, { recursive: true });
  await writeSidecar(livePath, sidecar);

  const trialResults: BuildTrial[] = [];
  let n = 0;
  for (const arm of arms) {
    n += 1;
    const trialId = `trial-${n}`;
    console.error(`[run-build-slice] ${trialId} arm=${arm}${dryRun ? " (dry-run)" : ""}`);
    let r: BuildTrial;
    try {
      r = await runBuildArm({
        arm,
        trialId,
        model,
        opencodeBin,
        runId,
        cfg,
        cfgHash,
        taskPromptHash,
        baseFixtureHash,
        backend,
        backendLabel,
        catalogHash: cat.hash,
        loadAllTokens,
        catalogBodies: cat.bodies,
        catalogRules: cat.rules,
        catalogSkills: cat.skills,
        catalogById: cat.byId,
        catalogIds,
        fixtureDir,
        taskPrompt,
        verifier,
        dryRun,
        reportProgress,
      });
    } catch (err) {
      r = {
        trialId,
        arm,
        status: "failed",
        turns: 0,
        durationMs: 0,
        agentTokens: { input: 0, output: 0, reasoning: 0, total: 0 },
        contextSamples: [],
        verification: null,
        verificationComplete: false,
        unloadMode: UNLOAD_MODE[arm],
        eligibility: { eligible: false, reasons: [`setup failed: ${String(err).slice(0, 200)}`] },
        workspace: "",
      };
    }
    trialResults.push(r);
  }

  const artifact = {
    runId,
    taskId,
    kind: "build-slice",
    status: "completed",
    createdAt,
    taskPrompt,
    taskPromptHash,
    baseFixtureHash,
    thresholdsHash: cfgHash,
    provenance,
    versions,
    catalogHash: cat.hash,
    routingBackend: backendLabel === "provider" ? "provider_backed" : "fail_open",
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
