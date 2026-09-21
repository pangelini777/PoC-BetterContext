// APM integration proof (Workstream 5: precise claim).
// The PoC consumes and validates a Microsoft APM-format package while keeping
// the package bodies outside the live agent workspace and preventing
// autonomous harness discovery. This is NOT a proof of isolated
// `apm install`: the installed APM CLI (0.9.4) provides no `--root` flag
// (verified via `apm install --help`), so that command is never executed.
// Product-integration gap (documented, not a routing failure): a supported
// real-APM install workflow with equivalent isolation is unavailable in the
// installed CLI. What IS proven here:
//   1. copy fixtures/apm-package into an isolated temp store (package bytes
//      live outside every live workspace);
//   2. run `apm compile --validate` + `apm compile --local-only --dry-run`
//      inside the store to prove package validity with the real CLI;
//   3. prove the live workspace contains no auto-discoverable copies;
//   4. record versions + commands in the artifact.
// Never runs `apm compile` (write mode) into a live workspace.

import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { PKG_DIR, REPO_ROOT, checkProvenance, collectVersions } from "./lib.ts";

function sh(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  const { promise, resolve } = Promise.withResolvers<{ code: number; out: string }>();
  execFile(cmd, args, { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
    resolve({ code: err ? (err as { code?: number }).code ?? 1 : 0, out: `${stdout}\n${stderr}`.slice(0, 4000) });
  });
  return promise;
}

const DISCOVERABLE = ["AGENTS.md", ".apm", "apm.yml", "apm.lock"];

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      await walk(p, out);
    } else out.push(p);
  }
  return out;
}

export async function runIsolation(workspaceDir: string): Promise<Record<string, unknown>> {
  const provenance = checkProvenance({ workspace: workspaceDir, tmp: tmpdir() });
  const versions = await collectVersions();

  // 1. Isolated store.
  const store = await mkdtemp(join(tmpdir(), "jev-apm-store-"));
  await cp(PKG_DIR, store, { recursive: true });
  const storedFiles = await walk(store);

  // 2. Real CLI validation inside the store.
  const validate = await sh("apm", ["compile", "--validate"], store);
  const dryrun = await sh("apm", ["compile", "--local-only", "--dry-run"], store);
  const storeAfter = await walk(store);
  const storeWroteFiles = storeAfter.length !== storedFiles.length;

  // 3. Live workspace must not contain discoverable copies.
  const wsFiles = await walk(resolve(workspaceDir));
  const rel = wsFiles.map((f) => f.slice(resolve(workspaceDir).length + 1));
  const violations = rel.filter((f) => {
    const top = f.split("/")[0];
    if (DISCOVERABLE.includes(top) || DISCOVERABLE.includes(f)) return true;
    if (f.endsWith(".instructions.md")) return true;
    if (f.endsWith("/SKILL.md") || f === "SKILL.md") return true;
    return false;
  });
  // Also: no file in the workspace may hash-match a full fixture body.
  const fixtureBodies = new Map<string, string>();
  for (const f of storedFiles) {
    fixtureBodies.set(createHash("sha256").update(await readFile(f)).digest("hex"), f);
  }
  const bodyCopies: string[] = [];
  for (const f of wsFiles) {
    const h = createHash("sha256").update(await readFile(f)).digest("hex");
    if (fixtureBodies.has(h)) bodyCopies.push(f);
  }

  const pass =
    validate.code === 0 &&
    !storeWroteFiles &&
    violations.length === 0 &&
    bodyCopies.length === 0;

  return {
    check: "apm-isolation",
    pass,
    versions,
    installCommand: `cp -r ${PKG_DIR} <isolated-store> (adapted: installed apm 0.9.4 has no --root flag)`,
    validateCommand: "apm compile --validate",
    dryrunCommand: "apm compile --local-only --dry-run",
    validateExit: validate.code,
    dryrunExit: dryrun.code,
    storeFileCount: storedFiles.length,
    storeWroteFilesDuringReadonlyOps: storeWroteFiles,
    workspaceViolations: violations,
    workspaceBodyCopies: bodyCopies,
    provenance,
    createdAt: new Date().toISOString(),
  };
}

const isMain = import.meta.main;
if (isMain) {
  const ws = process.argv[2] ?? join(REPO_ROOT, "fixtures/demo-workspace");
  const result = await runIsolation(ws);
  console.log(JSON.stringify(result, null, 2));
  if (typeof result["pass"] !== "boolean" || result["pass"] !== true) process.exit(1);
}
