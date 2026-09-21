// Live paired benchmark: load_all vs progressive_jev on identical fresh git
// workspaces. The agent NEVER learns its arm: both arms receive the same task
// prompt, same kernel text, same model/permissions/timeout; only the APM
// context policy differs (full baseline overlay vs JEV-managed overlay).
// The agent turn loop is benchmark-owned: each turn the runner compiles the
// current overlay from runtime state via ExplicitHarness (the authoritative
// request path), calls the agent model, applies file ops, and re-routes on
// semantic events. Telemetry + independent verification per trial.
//
// Agent model: opencode models (opencode-go credential). Task prompt, model,
// timeout, and verifier are identical across arms within a pair.

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { loadCatalog } from "../../packages/apm-catalog/src/catalog.ts";
import { HeuristicBackend, SystemOneBackend, type ScoreBackend } from "../../packages/progressive-context/src/router.ts";
import { ProgressiveSession } from "../../packages/progressive-context/src/session.ts";
import type { Arm } from "../../packages/protocol/src/types.ts";
import { CONFIG_PATH, PKG_DIR, RESULTS_DIR, REPO_ROOT, checkProvenance, collectVersions } from "./lib.ts";
import { verifyWorkspace } from "./independent/verify-workspace.ts";

export const TASK_PROMPT = `Complete the checkout flow in this repository: finish the accessible cart checkout UI, implement the server-side Stripe Checkout Session route, persist the needed synthetic shipping/contact fields safely, implement retry-safe Stripe webhook handling, add focused regression tests, and prepare (but do not execute) the production release checklist. Do not deploy. Do not commit secrets.`;

const MAX_TURNS = 12;
const TURN_TIMEOUT_MS = 120_000;

function sh(cmd: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<{ code: number; out: string }> {
  const { promise, resolve } = Promise.withResolvers<{ code: number; out: string }>();
  execFile(cmd, args, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
    resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.slice(0, 6000) });
  });
  return promise;
}

async function agentTurn(model: string, opencodeBin: string, ws: string, prompt: string): Promise<{ text: string; ms: number }> {
  const t0 = Date.now();
  const { promise, resolve } = Promise.withResolvers<{ code: number; out: string }>();
  execFile(opencodeBin, ["run", "--format", "json", "--dir", ws, "--model", model, prompt], {
    timeout: TURN_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  }, (err, stdout, stderr) => {
    resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.slice(0, 20000) });
  });
  const r = await promise;
  return { text: r.out.slice(0, 8000), ms: Date.now() - t0 };
}

function inferEventKind(text: string, turn: number): { kind: "user_message" | "observation" | "verification" | "completion"; phase: string } {
  const t = text.toLowerCase();
  if (turn === 0) return { kind: "user_message", phase: "ui" };
  if (/test|spec|verif|regression|pass|fail/i.test(text).valueOf() && /test/i.test(t)) return { kind: "verification", phase: "verification" };
  if (/release|deploy|production|checklist/i.test(t)) return { kind: "observation", phase: "deploy" };
  if (/webhook/i.test(t)) return { kind: "observation", phase: "webhook" };
  if (/migration|schema|column/i.test(t)) return { kind: "observation", phase: "migration" };
  if (/checkout|stripe|route|api/i.test(t)) return { kind: "observation", phase: "checkout-api" };
  return { kind: "observation", phase: "build" };
}

async function runTrialArm(opts: {
  arm: Arm;
  trialId: string;
  model: string;
  opencodeBin: string;
  runId: string;
  catalogHash: string;
  backend: ScoreBackend;
  loadAllTokens: number;
  demoDir: string;
}): Promise<Record<string, unknown>> {
  const ws = await mkdtemp(join(tmpdir(), `jev-live-${opts.trialId}-${opts.arm}-`));
  checkProvenance({ workspace: ws });
  await cp(opts.demoDir, ws, { recursive: true });
  await sh("git", ["init", "-q"], ws);
  await sh("git", ["add", "-A"], ws);
  await sh("git", ["-c", "user.email=poc@local", "-c", "user.name=poc", "commit", "-qm", "base"], ws);
  const baseCommit = (await sh("git", ["rev-parse", "--short", "HEAD"], ws)).out.trim();

  const cat = await loadCatalog(PKG_DIR);
  const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  const sess = new ProgressiveSession({
    runId: opts.runId,
    sessionId: `${opts.trialId}-${opts.arm}`,
    arm: opts.arm,
    goal: TASK_PROMPT,
    catalogHash: opts.catalogHash,
    bodies: cat.bodies,
    rules: cat.rules,
    skills: cat.skills,
    byId: cat.byId,
    cfg,
    backend: opts.backend,
    loadAllTokens: opts.loadAllTokens,
  });

  const t0 = Date.now();
  let prompt = TASK_PROMPT;
  let turns = 0;
  let agentInputTokens = 0;
  let agentOutputTokens = 0;
  void agentInputTokens;
  void agentOutputTokens;
  const timeline: unknown[] = [];
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    turns = turn + 1;
    const { kind, phase } = inferEventKind(prompt, turn);
    const rec = await sess.runEvent({ kind, text: prompt.slice(0, 2000), phase });
    timeline.push({ turn, phase, added: rec.added, removed: rec.removed, materialized: rec.materializedAfter, dynTokens: rec.compiledResourceTokens });
    // The agent sees kernel + current overlay + task/continuation prompt. Arm is never named.
    const harness = sess.getHarness();
    const effective = harness.effectiveContext(harness.requestCount() - 1);
    const agentPrompt = `${effective}\n\n<task>\n${prompt}\n</task>\n\nWork in the current directory. Apply file changes directly. Reply with a brief summary of what you changed and what remains.`;
    const { text } = await agentTurn(opts.model, opts.opencodeBin, ws, agentPrompt);
    prompt = `Previous turn summary:\n${text.slice(0, 1500)}\n\nContinue the checkout task. If everything in the task is done, reply DONE with a file list.`;
    if (/^\s*DONE\b/i.test(text) || (text.includes("DONE") && turn >= 3)) break;
  }
  const durationMs = Date.now() - t0;
  const verification = await verifyWorkspace(ws);
  const harness = sess.getHarness();
  const sentinelPass = harness.requestCount() > 0;
  const result = {
    trialId: opts.trialId,
    arm: opts.arm,
    baseCommit,
    workspace: ws,
    turns,
    durationMs,
    verification,
    timeline,
    sentinelRequests: harness.requestCount(),
    sentinelPass,
  };
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const trials = Number(args.find((a) => a.startsWith("--trials="))?.slice(9) ?? "1");
  const armsArg = args.find((a) => a.startsWith("--arms="))?.slice(7) ?? "load_all,progressive_jev";
  const arms = armsArg.split(",") as Arm[];
  const alternate = args.includes("--alternate-order");
  const model = args.find((a) => a.startsWith("--model="))?.slice(8) ?? process.env["AGENT_MODEL"] ?? "";
  const opencodeBin = args.find((a) => a.startsWith("--opencode-bin="))?.slice(15) ?? process.env["OPENCODE_BIN"] ?? "opencode";
  if (!model) {
    console.error("missing --model (or AGENT_MODEL). Example: --model opencode/claude-haiku-4-5");
    process.exit(2);
  }
  const runId = `live-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 8)}`;
  const provenance = checkProvenance();
  const versions = await collectVersions();
  versions["agentModel"] = model;
  const cat = await loadCatalog(PKG_DIR);
  const apiKey = process.env["TYPESAFE_API_KEY"];
  const backend: ScoreBackend = apiKey
    ? new SystemOneBackend(apiKey, process.env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest")
    : new HeuristicBackend();
  console.error(`[run-live] routing backend: ${apiKey ? "SystemOneBackend(provider)" : "HeuristicBackend(fail_open)"}`);
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
        catalogHash: cat.hash, backend, loadAllTokens, demoDir,
      });
      trialResults.push({ ...r, armOrder: order });
    }
  }

  const artifact = {
    runId, kind: "live-paired", createdAt: new Date().toISOString(),
    taskPrompt: TASK_PROMPT,
    taskPromptHash: createHash("sha256").update(TASK_PROMPT).digest("hex").slice(0, 16),
    provenance, versions,
    catalogHash: cat.hash,
    routingBackend: apiKey ? "provider_backed" : "fail_open",
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
