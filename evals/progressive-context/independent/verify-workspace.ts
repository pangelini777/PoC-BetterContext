// Independent end-to-end verifier. Runs OUTSIDE the agent-visible workspace:
// takes a workspace path, applies read-only checks against the files the agent
// produced, then copies HIDDEN executable tests in, runs `bun test` on them,
// and removes them. No gold labels, no JEV state, no agent self-report.
// The live agent never sees the hidden tests.

import { execFile } from "node:child_process";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HIDDEN_TEST_FILES } from "./hidden-tests.ts";

export interface VerifyCheck {
  name: string;
  pass: boolean;
  detail: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIf(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function verifyWorkspace(ws: string): Promise<{ checks: VerifyCheck[]; passed: number; total: number }> {
  const checks: VerifyCheck[] = [];
  const route = await readIf(join(ws, "route.ts"));
  const page = await readIf(join(ws, "page.tsx"));
  const schema = await readIf(join(ws, "schema.sql"));
  const logger = await readIf(join(ws, "logger.ts"));
  const release = await readIf(join(ws, "release.sh"));
  const pkg = await readIf(join(ws, "package.json"));
  void pkg;

  // 1. Checkout route exists and is not the NOT_IMPLEMENTED stub.
  checks.push({
    name: "checkout-route-implemented",
    pass: route.length > 100 && !route.includes("NOT_IMPLEMENTED"),
    detail: `route.ts bytes=${route.length}`,
  });
  // 2. Trusted server-side totals: route references server-side price/order data, not client totals.
  const usesTrusted = /price|product|order/i.test(route) && !/req\.json\(\)\.then.*total|clientTotal|body\.total/i.test(route);
  checks.push({ name: "trusted-server-totals", pass: usesTrusted && route.length > 100, detail: usesTrusted ? "server-side price/order referenced" : "no trusted total found" });
  // 3. No raw card data handled by application code.
  const cardWords = /card[_-]?number|cardNumber|cvc|cvv|exp_month|exp_year|raw[_-]?card/i;
  const appCode = `${route}\n${page}\n${logger}\n${schema}`;
  checks.push({ name: "no-raw-card-data", pass: !cardWords.test(appCode), detail: cardWords.test(appCode) ? "raw card pattern found" : "clean" });
  // 4. Webhook signature failure path exists.
  const webhookFiles = ["webhook/route.ts", "app/api/stripe/webhook/route.ts", "route.ts"];
  let webhookBody = "";
  for (const f of webhookFiles) webhookBody += `\n${await readIf(join(ws, f))}`;
  const sigFail = /signature|constructEvent|whsec|webhook secret/i.test(webhookBody) && /400|401|invalid/i.test(webhookBody);
  checks.push({ name: "webhook-signature-failure-path", pass: sigFail, detail: sigFail ? "signature verify + reject found" : "missing" });
  // 5. Duplicate webhook delivery is idempotent.
  const idem = /idempoten|deduplic|event[_-]?id|already[_-]?processed/i.test(webhookBody);
  checks.push({ name: "webhook-idempotent", pass: idem, detail: idem ? "dedup/idempotency found" : "missing" });
  // 6. No personal-data logging.
  const logLeak = /console\.log.*(email|address|card|secret|token)|log.*shipping_email/i.test(appCode);
  checks.push({ name: "no-personal-data-logging", pass: !logLeak, detail: logLeak ? "personal data in logs" : "clean" });
  // 7. Schema change exists for shipping fields.
  const schemaOk = /shipping_email|shipping_address/i.test(schema);
  checks.push({ name: "schema-shipping-fields", pass: schemaOk, detail: schemaOk ? "shipping columns present" : "missing" });
  // 8. Cart page has a checkout interaction.
  const cartOk = /checkout/i.test(page);
  checks.push({ name: "cart-checkout-ui", pass: cartOk, detail: cartOk ? "checkout referenced in page" : "missing" });
  // 10+. Hidden executable tests: injected AFTER the run, executed, removed.
  const hiddenNames = Object.keys(HIDDEN_TEST_FILES);
  const written: string[] = [];
  try {
    for (const [name, content] of Object.entries(HIDDEN_TEST_FILES)) {
      const dest = join(ws, name);
      await writeFile(dest, content);
      written.push(dest);
    }
    const hiddenOut = await new Promise<{ code: number; out: string }>((resolve) => {
      execFile("bun", ["test", ...hiddenNames], { cwd: ws, timeout: 120_000 }, (err, stdout, stderr) => {
        resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.slice(0, 4000) });
      });
    });
    // Attribute per-file pass/fail from bun output (best-effort parse).
    for (const name of hiddenNames) {
      const pass = hiddenOut.code === 0;
      checks.push({
        name: `hidden:${name}`,
        pass,
        detail: `bun test exit=${hiddenOut.code}; ${hiddenOut.out.split("\n").filter((l) => /pass|fail/.test(l)).slice(0, 3).join(" | ").slice(0, 200)}`,
      });
    }
  } finally {
    for (const dest of written) await rm(dest, { force: true });
  }

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length };
}

const isMain = import.meta.main;
if (isMain) {
  const ws = process.argv[2];
  if (!ws) {
    console.error("usage: verify-workspace.ts <workspace-dir>");
    process.exit(2);
  }
  const r = await verifyWorkspace(ws);
  console.log(JSON.stringify(r, null, 2));
  if (r.passed < r.total) process.exit(1);
}
