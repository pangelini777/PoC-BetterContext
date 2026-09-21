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
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { loadCatalog, type Catalog } from "../../packages/apm-catalog/src/catalog.ts";
import { HeuristicBackend, SystemOneBackend, type ScoreBackend } from "../../packages/progressive-context/src/router.ts";
import { ProgressiveSession } from "../../packages/progressive-context/src/session.ts";
import type { Arm, ThresholdConfig } from "../../packages/protocol/src/types.ts";
import { CONFIG_PATH, PKG_DIR, RESULTS_DIR, REPO_ROOT, checkProvenance, collectVersions } from "./lib.ts";
import { verifyWorkspace } from "./independent/verify-workspace.ts";
import { parseOpencodeJson, type ParsedRun } from "./live/opencode-parser.ts";
import { deriveEvent, observeFromRun, type ObservedState } from "./live/event-derive.ts";
import { classifyTrial } from "./live/eligibility.ts";

export const TASK_PROMPT = `Complete the checkout flow in this repository: finish the accessible cart checkout UI, implement the server-side Stripe Checkout Session route, persist the needed synthetic shipping/contact fields safely, implement retry-safe Stripe webhook handling, add focused regression tests, and prepare (but do not execute) the production release checklist. Do not deploy. Do not commit secrets.`;

export const DEFAULT_MODEL = "local/qwen3";
const MAX_TURNS = 12;
const TURN_TIMEOUT_MS = 300_000;

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
}

async function agentTurn(model: string, opencodeBin: string, ws: string, prompt: string): Promise<AgentTurnResult> {
  const t0 = Date.now();
  const { promise, resolve } = Promise.withResolvers<{ code: number; out: string; timedOut: boolean }>();
  // --auto: harness constant, identical across arms (single treatment variable
  // is APM context policy). Without it, non-interactive `opencode run` blocks
  // forever on permission prompts and no live evidence can be produced.
  execFile(opencodeBin, ["run", "--format", "json", "--auto", "--dir", ws, "--model", model, prompt], {
    timeout: TURN_TIMEOUT_MS,
    maxBuffer: 40 * 1024 * 1024,
  }, (err, stdout, stderr) => {
    const killed = err !== null && String(err.message ?? err).includes("ETIMEDOUT");
    resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.slice(0, 200000), timedOut: killed });
  });
  const r = await promise;
  return { run: parseOpencodeJson(r.out), rawBytes: r.out.length, ms: Date.now() - t0, timedOut: r.timedOut };
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
  const routingRecords: unknown[] = [];
  let cumulativeIn = 0;
  let cumulativeOut = 0;
  let cumulativeReasoning = 0;
  let cumulativeTotal = 0;
  let prevFiles = baseFiles;
  let verificationPassed: boolean | null = null;

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

    const harness = sess.getHarness();
    const effective = harness.effectiveContext(harness.requestCount() - 1);
    const agentPrompt = `${effective}\n\n<task>\n${TASK_PROMPT}\n</task>\n\nWork in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.`;
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
      done: tres.run.done,
    });

    const doneText = /^\s*DONE\b/i.test(tres.run.assistantText) || (tres.run.assistantText.includes("DONE") && turn >= 3);
    if (doneText || tres.timedOut) break;
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
  const recs = routingRecords as { removed: string[]; materializedAfter: string[] }[];
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
      // A removal on the final event has no "next request" — record as vacuous.
      unloadProofs.push({ resourceId: id, dematerializedAt: i, absentAt, pass: i + 1 >= harness.requestCount() ? true : pass });
    }
  }
  const sentinelFailures = unloadProofs.filter((p) => !p.pass).length +
    (routingRecords as { sentinelAssertions: { pass: boolean }[] }[]).reduce((a, r) => a + r.sentinelAssertions.filter((s) => !s.pass).length, 0);
  const materializations = (routingRecords as { added: string[] }[]).reduce((a, r) => a + r.added.length, 0);
  const dematerializations = (routingRecords as { removed: string[] }[]).reduce((a, r) => a + r.removed.length, 0);

  const eligibility = classifyTrial({
    arm: opts.arm,
    records: routingRecords as never,
    sentinelFailures,
    materializations,
    dematerializations,
    verificationComplete,
    provenanceOk,
  });

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
  const provenance = checkProvenance();
  const versions = await collectVersions();
  versions["agentModel"] = model;
  const cat = await loadCatalog(PKG_DIR);
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8")) as ThresholdConfig;
  const cfgHash = createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
  const taskPromptHash = createHash("sha256").update(TASK_PROMPT).digest("hex").slice(0, 16);
  const baseFixtureHash = createHash("sha256").update(JSON.stringify((await import("node:fs/promises")).readdir(REPO_ROOT + "/fixtures/demo-workspace"))).digest("hex").slice(0, 16);
  const apiKey = process.env["TYPESAFE_API_KEY"];
  const backend: ScoreBackend = apiKey
    ? new SystemOneBackend(apiKey, process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest")
    : new HeuristicBackend();
  const backendLabel = (apiKey ? "provider" : "failopen") as "provider" | "failopen";
  console.error(`[run-live] routing backend: ${backendLabel === "provider" ? "SystemOneBackend(provider)" : "HeuristicBackend(fail_open)"} model=${model}`);
  const loadAllTokens = [...cat.byId.values()].reduce((a, d) => a + d.estimatedTokens, 0);
  const demoDir = join(REPO_ROOT, "fixtures/demo-workspace");

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
        backend, backendLabel, loadAllTokens, demoDir,
      });
      trialResults.push({ ...r, armOrder: order });
    }
  }

  const artifact = {
    runId, kind: "live-paired", createdAt: new Date().toISOString(),
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
  console.log(outPath);
  for (const t of trialResults) {
    if (t && typeof t === "object" && "trialId" in t && "arm" in t && "workspace" in t) {
      console.error(`workspace ${String(t.trialId)} ${String(t.arm)}: ${String(t.workspace)}`);
    }
  }
}

await main();
