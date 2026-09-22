// Live paired benchmark: load_all vs progressive_jev on identical fresh git
// workspaces. The agent NEVER learns its arm: both arms receive the same task
// prompt, same kernel text, same model/permissions/timeout; only the APM
// context policy differs (full baseline overlay vs JEV-managed overlay).
// The agent turn loop is benchmark-owned: each turn the runner compiles the
// current overlay from runtime state via ExplicitHarness (the authoritative
// request path), calls the agent model via `opencode run --format json`,
// parses the JSON event stream (text, tool calls, tokens), derives the next
// semantic event from OBSERVED execution state (git diff, tool activity,
// verification signals), and re-routes. Telemetry + hidden independent
// verification per trial. local/qwen3 is the default smoke model.

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { loadCatalog, type Catalog } from "../../packages/apm-catalog/src/catalog.ts";
import { HeuristicBackend, SystemOneBackend, type ScoreBackend } from "../../packages/progressive-context/src/router.ts";
import { ProgressiveSession } from "../../packages/progressive-context/src/session.ts";
import type { Arm, TelemetryRecord, ThresholdConfig } from "../../packages/protocol/src/types.ts";
import { CONFIG_PATH, PKG_DIR, RESULTS_DIR, REPO_ROOT, checkProvenance, collectVersions } from "./lib.ts";
import { verifyWorkspace } from "./independent/verify-workspace.ts";
import { parseOpencodeJson, type ParsedRun } from "./live/opencode-parser.ts";
import { deriveEvent, observeFromRun, type ObservedState } from "./live/event-derive.ts";
import { classifyTrial } from "./live/eligibility.ts";

export const TASK_PROMPT = `Complete the checkout flow in this repository: finish the accessible cart checkout UI, implement the server-side Stripe Checkout Session route, persist the needed synthetic shipping/contact fields safely, implement retry-safe Stripe webhook handling, add focused regression tests, and prepare (but do not execute) the production release checklist. Do not deploy. Do not commit secrets.`;

export const DEFAULT_MODEL = "local/qwen3";
const MAX_TURNS = 12;
const TURN_TIMEOUT_MS = 300_000;
const MAX_TOOL_CALLS_PER_TURN = 16;
interface LiveTrialProgress {
  trialId: string;
  arm: Arm;
  status: "running" | "completed";
  turns: number;
  durationMs: number;
  agentTokens: { input: number; output: number; reasoning: number; total: number };
  context: {
    loadedResources: number;
    compiledResourceTokens: number;
    loadAllResourceTokens: number;
  };
  materializations: number;
  dematerializations: number;
  verification: null | { passed: number; total: number };
  eligibility: null | { eligible: boolean; reasons: string[] };
}

interface LiveProgressSidecar {
  schemaVersion: 1;
  runId: string;
  kind: "live-paired";
  status: "running";
  createdAt: string;
  updatedAt: string;
  model: string;
  routingBackend: "provider_backed" | "fail_open";
  taskPromptHash: string;
  trials: LiveTrialProgress[];
}

async function writeLiveProgress(path: string, sidecar: LiveProgressSidecar): Promise<void> {
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

export interface AgentTurnResult {
  run: ParsedRun;
  rawBytes: number;
  ms: number;
  timedOut: boolean;
  budgetReached: boolean;
}

async function agentTurn(model: string, opencodeBin: string, ws: string, prompt: string): Promise<AgentTurnResult> {
  const t0 = Date.now();
  // Native Bun spawning is required here. Bun's Node-compatible execFile shim
  // can leave `opencode run` stalled before it opens the provider connection.
  // The prompt travels over stdin rather than argv so long multi-turn context
  // cannot exceed the OS argument-size limit (E2BIG).
  const child = Bun.spawn(
    [opencodeBin, "run", "--dir", ws, "--model", model, "--auto", "--pure", "--format", "json"],
    {
      cwd: ws,
      env: process.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
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
      // Handle renames: "old -> new".
      const arrow = p.indexOf(" -> ");
      files.add(arrow >= 0 ? p.slice(arrow + 4) : p);
    }
  }
  return files;
}

async function runTrialArm(opts: {
  arm: Arm;
  trialId: string;
  model: string;
  opencodeBin: string;
  runId: string;
  cat: Catalog;
  cfg: ThresholdConfig;
  cfgHash: string;
  taskPromptHash: string;
  baseFixtureHash: string;
  backend: ScoreBackend;
  backendLabel: "provider" | "failopen";
  loadAllTokens: number;
  demoDir: string;
  reportProgress: (trial: LiveTrialProgress) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const ws = await mkdtemp(join(tmpdir(), `jev-live-${opts.trialId}-${opts.arm}-`));
  let provenanceOk = true;
  try {
    checkProvenance({ workspace: ws });
  } catch {
    provenanceOk = false;
  }
  await cp(opts.demoDir, ws, { recursive: true });
  await sh("git", ["init", "-q"], ws);
  await sh("git", ["add", "-A"], ws);
  await sh("git", ["-c", "user.email=poc@local", "-c", "user.name=poc", "commit", "-qm", "base"], ws);
  const baseCommit = (await sh("git", ["rev-parse", "HEAD"], ws)).out.trim();
  const baseFiles = await gitFiles(ws);

  const sess = new ProgressiveSession({
    runId: opts.runId,
    sessionId: `${opts.trialId}-${opts.arm}`,
    arm: opts.arm,
    goal: TASK_PROMPT,
    catalogHash: opts.cat.hash,
    bodies: opts.cat.bodies,
    rules: opts.cat.rules,
    skills: opts.cat.skills,
    byId: opts.cat.byId,
    cfg: opts.cfg,
    backend: opts.backend,
    loadAllTokens: opts.loadAllTokens,
  });

  const t0 = Date.now();
  const turnRecords: unknown[] = [];
  const routingRecords: TelemetryRecord[] = [];
  let cumulativeIn = 0;
  let cumulativeOut = 0;
  let cumulativeReasoning = 0;
  let cumulativeTotal = 0;
  let prevFiles = baseFiles;
  let verificationPassed: boolean | null = null;
  const reportProgress = (
    status: LiveTrialProgress["status"],
    verification: LiveTrialProgress["verification"] = null,
    eligibility: LiveTrialProgress["eligibility"] = null,
    durationMs = Date.now() - t0,
  ): Promise<void> => {
    const current = routingRecords.at(-1);
    if (!current) throw new Error("Cannot report live trial progress before routing");
    return opts.reportProgress({
      trialId: opts.trialId,
      arm: opts.arm,
      status,
      turns: turnRecords.length,
      durationMs,
      agentTokens: {
        input: cumulativeIn,
        output: cumulativeOut,
        reasoning: cumulativeReasoning,
        total: cumulativeTotal,
      },
      context: {
        loadedResources: current.materializedAfter.length,
        compiledResourceTokens: current.compiledResourceTokens,
        loadAllResourceTokens: current.loadAllResourceTokens,
      },
      materializations: routingRecords.reduce((sum, record) => sum + record.added.length, 0),
      dematerializations: routingRecords.reduce((sum, record) => sum + record.removed.length, 0),
      verification,
      eligibility,
    });
  };


  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Derive the routing event from observed execution state (not keywords).
    let stepInput;
    if (turn === 0) {
      stepInput = deriveEvent({ turn, changedPaths: [], newFiles: [], toolNames: [], toolArgsText: "", verificationRunning: false, verificationPassed: null, agentTextExcerpt: "" }, TASK_PROMPT);
    } else {
      const last = turnRecords[turnRecords.length - 1] as { parsed: ParsedRun; changedPaths: string[]; newFiles: string[] };
      const obs = observeFromRun(last.parsed);
      const state: ObservedState = {
        turn,
        changedPaths: last.changedPaths,
        newFiles: last.newFiles,
        toolNames: obs.toolNames,
        toolArgsText: obs.toolArgsText,
        verificationRunning: obs.verificationRunning,
        verificationPassed,
        agentTextExcerpt: obs.agentTextExcerpt,
      };
      stepInput = deriveEvent(state, TASK_PROMPT);
    }
    const rec = await sess.runEvent(stepInput);
    routingRecords.push(rec);
    await reportProgress("running");

    const harness = sess.getHarness();
    const effective = harness.effectiveContext(harness.requestCount() - 1);
    const controllerPrompt = `<controller-turn index="${turn + 1}" max="${MAX_TURNS}">
Work on exactly one coherent next phase of the task, using at most ${MAX_TOOL_CALLS_PER_TURN} tool calls.
Inspect the current workspace first so you continue prior work rather than restart it.
Do not merely describe planned work: make concrete progress in this phase.
End your response with a line containing exactly CONTINUE if work remains, or exactly DONE only when the entire task is implemented and verified.
</controller-turn>`;
    const agentPrompt = `${effective}\n\n${controllerPrompt}\n\n<task>\n${TASK_PROMPT}\n</task>\n\nWork in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.`;
    const tres = await agentTurn(opts.model, opts.opencodeBin, ws, agentPrompt);
    cumulativeIn += tres.run.inputTokens;
    cumulativeOut += tres.run.outputTokens;
    cumulativeReasoning += tres.run.reasoningTokens;
    cumulativeTotal += tres.run.totalTokens;

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
    const newFiles = [...nowFiles].filter((f) => !baseFiles.has(f)).sort();
    prevFiles = nowFiles;

    // Verification signal: run the hidden verifier's cheap static subset?
    // No — hidden tests stay hidden until the end. Here we only note whether
    // the agent itself ran tests (tool evidence), without judging results.
    const toolBlob = tres.run.turns.flatMap((t) => t.toolCalls.map((c) => `${c.name} ${c.argsSummary}`)).join(" ").toLowerCase();
    if (/bun test|bun run.*test|npm test/.test(toolBlob)) {
      const failed = tres.run.turns.some((t) => t.toolCalls.some((c) => c.status === "error" && /test/i.test(`${c.name} ${c.argsSummary}`)));
      verificationPassed = !failed;
    }

    turnRecords.push({
      turn,
      parsed: tres.run,
      eventPhase: stepInput.phase,
      eventKind: stepInput.kind,
      changedPaths,
      newFiles,
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
    });
    await reportProgress("running");

    const doneText = /^\s*DONE\b/i.test(tres.run.assistantText) || (tres.run.assistantText.includes("DONE") && turn >= 3);
    if (doneText || (tres.timedOut && tres.run.toolCallCount === 0 && changedPaths.length === 0)) break;
    void prevFiles;
  }
  const durationMs = Date.now() - t0;

  // Hidden independent verification runs AFTER the agent finished, outside ws.
  let verification: { checks: { name: string; pass: boolean; detail: string }[]; passed: number; total: number };
  let verificationComplete = true;
  try {
    verification = await verifyWorkspace(ws);
  } catch (err) {
    verificationComplete = false;
    verification = { checks: [{ name: "verifier-crashed", pass: false, detail: String(err).slice(0, 300) }], passed: 0, total: 1 };
  }

  // Next-request unload proof: for every dematerialized resource, verify its
  // body probe is absent from the LATER request's effective context.
  const harness = sess.getHarness();
  const unloadProofs: { resourceId: string; dematerializedAt: number; absentAt: number; pass: boolean }[] = [];
  const recs = routingRecords;
  for (let i = 0; i < recs.length; i++) {
    for (const id of recs[i].removed) {
      const body = opts.cat.bodies.get(id) ?? "";
      const probe = body.slice(0, 60);
      // Absent from every subsequent request (not just the next one).
      let pass = true;
      let absentAt = -1;
      for (let j = i + 1; j < harness.requestCount(); j++) {
        if (!harness.effectiveContext(j).includes(probe)) {
          if (absentAt < 0) absentAt = j;
        } else {
          pass = false;
          break;
        }
      }
      // A final-event removal has no later request and therefore is not proof.
      const hasLaterRequest = i + 1 < harness.requestCount();
      unloadProofs.push({ resourceId: id, dematerializedAt: i, absentAt, pass: hasLaterRequest && pass && absentAt >= 0 });
    }
  }
  const sentinelFailures = unloadProofs.filter((p) => !p.pass).length +
    routingRecords.reduce((a, r) => a + r.sentinelAssertions.filter((s) => !s.pass).length, 0);
  const materializations = routingRecords.reduce((a, r) => a + r.added.length, 0);
  const dematerializations = routingRecords.reduce((a, r) => a + r.removed.length, 0);

  const eligibility = classifyTrial({
    arm: opts.arm,
    records: routingRecords,
    sentinelFailures,
    materializations,
    dematerializations,
    verificationComplete,
    provenanceOk,
  });
  await reportProgress(
    "completed",
    { passed: verification.passed, total: verification.total },
    eligibility,
    durationMs,
  );

  return {
    trialId: opts.trialId,
    arm: opts.arm,
    model: opts.model,
    taskPromptHash: opts.taskPromptHash,
    baseFixtureHash: opts.baseFixtureHash,
    baseCommit,
    catalogHash: opts.cat.hash,
    thresholdsHash: opts.cfgHash,
    workspace: ws,
    turns: turnRecords.length,
    durationMs,
    agentTokens: { input: cumulativeIn, output: cumulativeOut, reasoning: cumulativeReasoning, total: cumulativeTotal },
    verification,
    verificationComplete,
    routingRecords,
    turnRecords,
    unloadProofs,
    sentinelFailures,
    materializations,
    dematerializations,
    eligibility,
    backendLabel: opts.backendLabel,
    provenanceOk,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const trials = Number(args.find((a) => a.startsWith("--trials="))?.slice(9) ?? "1");
  const armsArg = args.find((a) => a.startsWith("--arms="))?.slice(7) ?? "load_all,progressive_jev";
  const arms = armsArg.split(",") as Arm[];
  const alternate = args.includes("--alternate-order");
  const model = args.find((a) => a.startsWith("--model="))?.slice(8) ?? process.env["AGENT_MODEL"] ?? DEFAULT_MODEL;
  const opencodeBin = args.find((a) => a.startsWith("--opencode-bin="))?.slice(15) ?? process.env["OPENCODE_BIN"] ?? "opencode";
  const runId = `live-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
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
  console.error(`[run-live] routing backend: ${backendLabel === "provider" ? "SystemOneBackend(provider)" : "HeuristicBackend(fail_open)"} model=${model}`);
  const loadAllTokens = [...cat.byId.values()].reduce((a, d) => a + d.estimatedTokens, 0);
  const demoDir = join(REPO_ROOT, "fixtures/demo-workspace");
  const liveDir = join(RESULTS_DIR, ".live");
  const livePath = join(liveDir, `${runId}.json`);
  const liveTrials = new Map<string, LiveTrialProgress>();
  const liveSidecar: LiveProgressSidecar = {
    schemaVersion: 1,
    runId,
    kind: "live-paired",
    status: "running",
    createdAt,
    updatedAt: createdAt,
    model,
    routingBackend: backendLabel === "provider" ? "provider_backed" : "fail_open",
    taskPromptHash,
    trials: [],
  };
  const reportProgress = async (trial: LiveTrialProgress): Promise<void> => {
    liveTrials.set(`${trial.trialId}:${trial.arm}`, trial);
    liveSidecar.trials = [...liveTrials.values()];
    await writeLiveProgress(livePath, liveSidecar);
  };
  await mkdir(liveDir, { recursive: true });
  await writeLiveProgress(livePath, liveSidecar);


  const trialResults: Record<string, unknown>[] = [];
  for (let t = 0; t < trials; t++) {
    const trialId = `trial-${t + 1}`;
    let order = [...arms];
    if (alternate && t % 2 === 1) order = [...order].reverse();
    for (const arm of order) {
      console.error(`[run-live] ${trialId} arm=${arm}`);
      const r = await runTrialArm({
        arm, trialId, model, opencodeBin, runId,
        cat, cfg, cfgHash, taskPromptHash, baseFixtureHash,
        backend, backendLabel, loadAllTokens, demoDir, reportProgress,
      });
      trialResults.push({ ...r, armOrder: order });
    }
  }

  const artifact = {
    runId, kind: "live-paired", createdAt,
    taskPrompt: TASK_PROMPT,
    taskPromptHash,
    baseFixtureHash,
    thresholdsHash: cfgHash,
    provenance, versions,
    catalogHash: cat.hash,
    routingBackend: backendLabel === "provider" ? "provider_backed" : "fail_open",
    trials: trialResults,
  };
  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${runId}.json`);
  await writeFile(outPath, JSON.stringify(artifact, null, 2));
  await rm(livePath);
  console.log(outPath);
  for (const t of trialResults) {
    if (t && typeof t === "object" && "trialId" in t && "arm" in t && "workspace" in t) {
      console.error(`workspace ${String(t.trialId)} ${String(t.arm)}: ${String(t.workspace)}`);
    }
  }
}

await main();
