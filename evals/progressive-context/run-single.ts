// Single-session three-arm comparison: load_all_single vs apm_discovery vs
// jev_single. One `opencode run` per arm on identical fresh git workspaces,
// same TASK_PROMPT/model/fixture; only the APM context policy differs.
//
// - load_all_single: full catalog compiled ONCE into the initial stdin prompt
//   (compileOverlay over every catalog body). No rerouting, no .agents/.
// - apm_discovery: workspace gets fixture apm.yml + .apm/ plus the brew APM
//   `install --target opencode,antigravity` output (.agents/rules/ +
//   .agents/skills/) committed in place. The agent discovers autonomously.
//   No compile, no AGENTS.md.
// - jev_single: same discovery files PLUS the OpenCode plugin
//   (single-session/jev-plugin.ts, transpiled to
//   .opencode/plugins/jev-single.mjs, wired via opencode.json) that per turn
//   scrubs every <jev-apm-context> block from the emitted lists and injects
//   exactly one fresh overlay carrying the current materialized set. Routing
//   is runner-owned: the runner drives ProgressiveSession once up front and
//   writes .agents/jev-decisions.json; the plugin reads it per turn.
//   Unload here is BEHAVIORAL (absent from emitted messages), never
//   byte-proof — recorded honestly in unloadMode + eligibility reasons.
//
// `--auto --format json`, NDJSON parsed via parseOpencodeJson, 900s timeout.
// jev_single runs WITHOUT --pure so its plugin loads; the other arms use
// --pure. Hidden independent verification runs post-run, outside the agent
// loop. No arm runs formatters, linters, typecheck, tests, or project-wide
// validation; the hidden verifier is the only post-run check.

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
import { verifyWorkspace } from "./independent/verify-workspace.ts";
import { parseOpencodeJson } from "./live/opencode-parser.ts";
import type { ParsedRun } from "./live/opencode-parser.ts";

export const TASK_PROMPT = `Complete the checkout flow in this repository: finish the accessible cart checkout UI, implement the server-side Stripe Checkout Session route, persist the needed synthetic shipping/contact fields safely, implement retry-safe Stripe webhook handling, add focused regression tests, and prepare (but do not execute) the production release checklist. Do not deploy. Do not commit secrets.`;

export const DEFAULT_MODEL = "local/qwen3";

/** Pinned brew APM binary. Never /usr/local/bin/apm (stale 0.9.4). */
export const APM_BIN = "/home/linuxbrew/.linuxbrew/bin/apm";

const RUN_TIMEOUT_MS = Number(process.env["SINGLE_RUN_TIMEOUT_MS"] ?? 900_000);
const APM_TIMEOUT_MS = 120_000;

const SKIP_VALIDATION_LINE =
  "Do not run formatters, linters, typecheck, or test suites; implement the changes without executing project validation.";

const PLUGIN_SRC = join(REPO_ROOT, "evals/progressive-context/single-session/jev-plugin.ts");
const PLUGIN_DEST_REL = ".opencode/plugins/jev-single.mjs";
const DECISIONS_REL = ".agents/jev-decisions.json";
const TURN_LOG_REL = ".agents/jev-plugin-turns.jsonl";

export type SingleArm = "load_all_single" | "apm_discovery" | "jev_single";
export type UnloadMode = "byte-proof" | "behavioral" | "none";

const SINGLE_ARMS: SingleArm[] = ["load_all_single", "apm_discovery", "jev_single"];

const UNLOAD_MODE: Record<SingleArm, UnloadMode> = {
  load_all_single: "none",
  apm_discovery: "none",
  jev_single: "behavioral",
};

export interface ContextSample {
  turn: number;
  compiledResourceTokens: number;
  loadedResources: number;
}

interface SingleTrial {
  trialId: string;
  arm: SingleArm;
  status: "running" | "completed" | "failed" | "skipped" | "dry-run";
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

interface SingleSidecar {
  schemaVersion: 1;
  runId: string;
  kind: "single-session";
  status: "running" | "completed";
  createdAt: string;
  updatedAt: string;
  model: string;
  routingBackend: "provider_backed" | "fail_open";
  taskPromptHash: string;
  trials: SingleTrial[];
}

async function writeSidecar(path: string, sidecar: SingleSidecar): Promise<void> {
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

interface OpencodeResult {
  run: ParsedRun;
  rawBytes: number;
  ms: number;
  timedOut: boolean;
}

/** Single opencode run. Prompt travels over stdin (never argv); pure only
 *  when the arm needs no workspace plugin (jev_single must load its own). */
async function opencodeRun(opts: {
  model: string;
  opencodeBin: string;
  ws: string;
  prompt: string;
  pure: boolean;
}): Promise<OpencodeResult> {
  const t0 = Date.now();
  const args = ["run", "--dir", opts.ws, "--model", opts.model, "--auto", "--format", "json"];
  if (opts.pure) args.push("--pure");
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
  }, RUN_TIMEOUT_MS);
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
  return { run: parseOpencodeJson(out), rawBytes: out.length, ms: Date.now() - t0, timedOut };
}

/** Fresh git workspace from the demo fixture. Returns ws path + base commit. */
async function freshWorkspace(trialId: string, arm: SingleArm, demoDir: string): Promise<{ ws: string; baseCommit: string }> {
  const ws = await mkdtemp(join(tmpdir(), `jev-single-${trialId}-${arm}-`));
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

async function runSingleArm(opts: {
  arm: SingleArm;
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
  demoDir: string;
  dryRun: boolean;
  reportProgress: (trial: SingleTrial) => Promise<void>;
}): Promise<SingleTrial> {
  const t0 = Date.now();
  const unloadMode = UNLOAD_MODE[opts.arm];
  const blankTokens = { input: 0, output: 0, reasoning: 0, total: 0 };

  const { ws, baseCommit } = await freshWorkspace(opts.trialId, opts.arm, opts.demoDir);
  const running: SingleTrial = {
    trialId: opts.trialId,
    arm: opts.arm,
    status: "running",
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

  let prompt: string;
  let sample: ContextSample;
  let usePure = true;
  const extra: Record<string, unknown> = { baseCommit };
  let provenanceOk = true;
  try {
    checkProvenance({ workspace: ws });
  } catch {
    provenanceOk = false;
  }

  if (opts.arm === "load_all_single") {
    // Full catalog compiled once into the initial prompt; no rerouting.
    const compiled = compileOverlay(opts.catalogIds, opts.catalogBodies, "evt-single-000");
    prompt =
      `${KERNEL}\n${compiled.dynamicOverlay}\n\n<task>\n${TASK_PROMPT}\n</task>\n\nWork in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.\n${SKIP_VALIDATION_LINE}`;
    sample = { turn: 0, compiledResourceTokens: compiled.resourceTokenEstimate, loadedResources: opts.catalogIds.length };
    extra["compiledOverlaySha256"] = compiled.overlaySha256;
  } else {
    // apm_discovery and jev_single share the discovery-file install.
    const install = await installApmDiscovery(ws);
    extra["apmInstall"] = install;
    if (install.code !== 0) {
      const failed: SingleTrial = {
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
    if (opts.arm === "apm_discovery") {
      prompt =
        `<task>\n${TASK_PROMPT}\n</task>\n\nThis workspace uses APM-managed context (apm.yml, .apm/, .agents/rules/, .agents/skills/). Discover and follow the relevant rules and skills autonomously. Work in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.\n${SKIP_VALIDATION_LINE}`;
      // The benchmark compiles nothing here: the agent discovers on its own.
      sample = { turn: 0, compiledResourceTokens: 0, loadedResources: 0 };
    } else {
      // jev_single: runner-owned routing up front -> decisions file, plus the plugin.
      let pluginJs: string;
      try {
        const src = await readFile(PLUGIN_SRC, "utf8");
        pluginJs = new Bun.Transpiler({ loader: "ts" }).transformSync(src, "ts");
      } catch {
        const skipped: SingleTrial = {
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
      const sess = new ProgressiveSession({
        runId: opts.runId,
        sessionId: `${opts.trialId}-${opts.arm}`,
        arm: "progressive_jev",
        goal: TASK_PROMPT,
        catalogHash: opts.catalogHash,
        bodies: opts.catalogBodies,
        rules: opts.catalogRules,
        skills: opts.catalogSkills,
        byId: opts.catalogById,
        cfg: opts.cfg,
        backend: opts.backend,
        loadAllTokens: opts.loadAllTokens,
      });
      const rec = await sess.runEvent({ kind: "user_message", text: TASK_PROMPT, phase: "ui", changedPaths: [] });
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
      prompt =
        `<task>\n${TASK_PROMPT}\n</task>\n\nA workspace plugin manages progressive APM context each turn: treat the injected <jev-apm-context> overlay as authoritative for its scope. Work in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.\n${SKIP_VALIDATION_LINE}`;
      sample = {
        turn: 0,
        compiledResourceTokens: rec.compiledResourceTokens,
        loadedResources: rec.materializedAfter.length,
      };
      usePure = false;
    }
  }

  if (opts.dryRun) {
    const dry: SingleTrial = {
      ...running,
      status: "dry-run",
      durationMs: Date.now() - t0,
      contextSamples: [sample],
      eligibility: { eligible: false, reasons: ["dry-run: agent spawn skipped"] },
      ...extra,
    };
    await opts.reportProgress(dry);
    return dry;
  }

  let result: OpencodeResult;
  try {
    result = await opencodeRun({ model: opts.model, opencodeBin: opts.opencodeBin, ws, prompt, pure: usePure });
  } catch (err) {
    const failed: SingleTrial = {
      ...running,
      status: "failed",
      durationMs: Date.now() - t0,
      contextSamples: [sample],
      eligibility: { eligible: false, reasons: [`opencode spawn failed: ${String(err).slice(0, 200)}`] },
      ...extra,
    };
    await opts.reportProgress(failed);
    return failed;
  }

  // Hidden independent verification runs AFTER the agent finished, outside ws.
  let verification: SingleTrial["verification"];
  let verificationComplete = true;
  try {
    verification = await verifyWorkspace(ws);
  } catch (err) {
    verificationComplete = false;
    verification = { checks: [{ name: "verifier-crashed", pass: false, detail: String(err).slice(0, 300) }], passed: 0, total: 1 };
  }

  // jev_single behavioral evidence: per-turn plugin log (never byte-proof).
  let pluginTurns: unknown[] = [];
  if (opts.arm === "jev_single") {
    try {
      const raw = await readFile(join(ws, TURN_LOG_REL), "utf8");
      pluginTurns = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as unknown);
    } catch {
      pluginTurns = [];
    }
    extra["pluginTurns"] = pluginTurns.length;
  }

  const reasons: string[] = [];
  if (!verificationComplete) reasons.push("independent verification incomplete");
  if (!provenanceOk) reasons.push("workspace/provenance guard failed");
  if (result.timedOut) reasons.push(`opencode run hit the ${Math.round(RUN_TIMEOUT_MS / 1000)}s timeout`);
  if (opts.arm === "jev_single") {
    reasons.push("unloadMode=behavioral: overlay scrubbed from emitted messages only; not byte-proof (see jev-plugin.ts header)");
    if (pluginTurns.length === 0) reasons.push("no plugin turn log observed (.agents/jev-plugin-turns.jsonl missing)");
  }

  const completed: SingleTrial = {
    ...running,
    status: "completed",
    durationMs: Date.now() - t0,
    agentTokens: {
      input: result.run.inputTokens,
      output: result.run.outputTokens,
      reasoning: result.run.reasoningTokens,
      total: result.run.totalTokens,
    },
    contextSamples: [sample],
    verification,
    verificationComplete,
    eligibility: { eligible: reasons.length === 0, reasons },
    assistantTextChars: result.run.assistantText.length,
    assistantText: result.run.assistantText.slice(0, 2000),
    toolCallCount: result.run.toolCallCount,
    timedOut: result.timedOut,
    ...extra,
  };
  await opts.reportProgress(completed);
  return completed;
}

function printHelp(): void {
  console.log(`run-single.ts — single-session 3-arm comparison (one opencode run per arm).

Arms (same TASK_PROMPT, model, and demo-workspace fixture):
  load_all_single  Full APM catalog compiled once into the initial stdin
                   prompt via compileOverlay. No rerouting, no .agents/.
                   unloadMode=none.
  apm_discovery    Workspace gets fixture apm.yml + .apm/ plus
                   \`${APM_BIN} install --target opencode,antigravity\`
                   output (.agents/rules/ + .agents/skills/) committed in
                   place. The agent discovers rules/skills autonomously.
                   No compile, no AGENTS.md. unloadMode=none.
  jev_single       Same discovery files PLUS the OpenCode plugin
                   (single-session/jev-plugin.ts transpiled to
                   .opencode/plugins/jev-single.mjs, wired via opencode.json)
                   that per turn scrubs all <jev-apm-context> blocks from the
                   emitted lists and injects exactly one fresh overlay with
                   the current materialized set from .agents/jev-decisions.json
                   (runner-owned routing via ProgressiveSession). Runs WITHOUT
                   --pure so the plugin loads. Unload is BEHAVIORAL (absent
                   from emitted messages only), flagged honestly as
                   unloadMode=behavioral — never byte-proof.

Each arm spawns one \`opencode run --auto --format json\` with the prompt over
stdin (native Bun.spawn), 900s timeout, NDJSON via parseOpencodeJson, then
hidden verifyWorkspace post-run. No arm runs formatters, linters, typecheck,
tests, or project-wide validation.

Artifact: kind "single-session" with trials[] carrying agentTokens,
contextSamples[{turn, compiledResourceTokens, loadedResources}], verification,
and unloadMode. Progress sidecar at results/.live/<runId>.json (deleted after
the final artifact writes successfully).

Options:
  --arms=<a,b,c>       subset of ${SINGLE_ARMS.join(",")} (default: all three)
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
  const armsArg = args.find((a) => a.startsWith("--arms="))?.slice(7) ?? SINGLE_ARMS.join(",");
  const arms = armsArg.split(",").filter(Boolean) as SingleArm[];
  for (const arm of arms) {
    if (!SINGLE_ARMS.includes(arm)) {
      console.error(`[run-single] unknown arm: ${arm} (expected one of ${SINGLE_ARMS.join(",")})`);
      printHelp();
      process.exit(1);
    }
  }
  const model = args.find((a) => a.startsWith("--model="))?.slice(8) ?? process.env["AGENT_MODEL"] ?? DEFAULT_MODEL;
  const opencodeBin = args.find((a) => a.startsWith("--opencode-bin="))?.slice(15) ?? process.env["OPENCODE_BIN"] ?? "opencode";
  const dryRun = args.includes("--dry-run");

  const runId = `single-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();
  const provenance = checkProvenance();
  const versions = await collectVersions();
  versions["agentModel"] = model;
  const cat = await loadCatalog(PKG_DIR);
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as ThresholdConfig;
  const cfgHash = createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
  const taskPromptHash = createHash("sha256").update(TASK_PROMPT).digest("hex").slice(0, 16);
  const baseFixtureHash = (await hashDirectory(join(REPO_ROOT, "fixtures/demo-workspace"))).slice(0, 16);
  const apiKey = process.env["TYPESAFE_API_KEY"];
  const backend: ScoreBackend = apiKey
    ? new SystemOneBackend(apiKey, process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest")
    : new HeuristicBackend();
  const backendLabel = (apiKey ? "provider" : "failopen") as "provider" | "failopen";
  console.error(`[run-single] routing backend: ${backendLabel === "provider" ? "SystemOneBackend(provider)" : "HeuristicBackend(fail_open)"} model=${model}${dryRun ? " dry-run" : ""}`);
  const loadAllTokens = [...cat.byId.values()].reduce((a, d) => a + d.estimatedTokens, 0);
  const catalogIds = [...cat.byId.keys()].sort();
  const demoDir = join(REPO_ROOT, "fixtures/demo-workspace");
  const liveDir = join(RESULTS_DIR, ".live");
  const livePath = join(liveDir, `${runId}.json`);
  const liveTrials = new Map<string, SingleTrial>();
  const sidecar: SingleSidecar = {
    schemaVersion: 1,
    runId,
    kind: "single-session",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    model,
    routingBackend: backendLabel === "provider" ? "provider_backed" : "fail_open",
    taskPromptHash,
    trials: [],
  };
  const reportProgress = async (trial: SingleTrial): Promise<void> => {
    liveTrials.set(`${trial.trialId}:${trial.arm}`, trial);
    sidecar.trials = [...liveTrials.values()];
    await writeSidecar(livePath, sidecar);
  };
  await mkdir(liveDir, { recursive: true });
  await writeSidecar(livePath, sidecar);

  const trialResults: SingleTrial[] = [];
  let n = 0;
  for (const arm of arms) {
    n += 1;
    const trialId = `trial-${n}`;
    console.error(`[run-single] ${trialId} arm=${arm}${dryRun ? " (dry-run)" : ""}`);
    const r = await runSingleArm({
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
      demoDir,
      dryRun,
      reportProgress,
    });
    trialResults.push(r);
  }

  const artifact = {
    runId,
    kind: "single-session",
    status: "completed",
    createdAt,
    taskPrompt: TASK_PROMPT,
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
