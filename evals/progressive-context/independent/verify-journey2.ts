// Journey2 verifier: 8 checks over the 2-phase refunds -> notifications
// journey. Read-only source checks (comments stripped) plus the agent's own
// bun tests (journey.test.ts), which must exit 0 with at least 2 passes
// (one per phase).
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface VerifyCheck {
  name: string;
  pass: boolean;
  detail: string;
}

async function readIf(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function stripJs(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

export async function verifyJourney2(ws: string): Promise<{ checks: VerifyCheck[]; passed: number; total: number }> {
  const checks: VerifyCheck[] = [];
  const route = stripJs(await readIf(join(ws, "route.ts")));
  // Notify module: canonical path is lib/notify.ts (per task prompt); fall
  // back to root notify.ts for arms/runs that scaffolded at root.
  const notify = stripJs(await readIf(join(ws, "lib/notify.ts"))) || stripJs(await readIf(join(ws, "notify.ts")));
  const logger = stripJs(await readIf(join(ws, "lib/logger.ts"))) || stripJs(await readIf(join(ws, "logger.ts")));

  // 1. Refund route with trusted server-side totals.
  const routeExported = /export\s+(async\s+)?function\s+POST|export\s+const\s+POST/.test(route);
  const notStub = !/NOT_IMPLEMENTED/.test(route) && !/status:\s*501/.test(route);
  const usesCatalog = /CATALOG_ITEM|catalog|unitPriceCents/.test(route);
  const honorsClientTotal =
    /body\s*[?._\[]\s*(total|amount)|clientTotal|total_cents\s*as\s+amount|amount\s*:\s*body/i.test(route);
  const refundRoute = routeExported && notStub && usesCatalog && !honorsClientTotal && route.length > 100;
  checks.push({
    name: "refund-route",
    pass: refundRoute,
    detail: refundRoute ? "POST exported with trusted catalog total" : "stub or missing trusted total",
  });

  // 2. Idempotency-Key handling.
  const idem =
    /idempotency-key/i.test(route) && /Idempotent-Replayed/.test(route) && /422/.test(route);
  checks.push({
    name: "idempotent-replay",
    pass: idem,
    detail: idem ? "Idempotency-Key + replay header + 422 found" : "missing idempotency handling",
  });

  // 3. Notify lib exposes both channels.
  const notifyLib = /sendEmail/.test(notify) && /sendSms/.test(notify);
  checks.push({
    name: "notify-lib",
    pass: notifyLib,
    detail: notifyLib ? "sendEmail + sendSms present" : "missing notify entry point",
  });

  // 4. SMS fallback with retry logic.
  const smsFallback = /fallback/i.test(notify) && /retr/i.test(notify);
  checks.push({
    name: "sms-fallback",
    pass: smsFallback,
    detail: smsFallback ? "fallback + retry logic found" : "missing sms fallback/retry",
  });

  // 5. No raw card data (rule:payments-card-data).
  const cardWords = /card[_-]?number|cardNumber|cvc|cvv|exp_month|exp_year|raw[_-]?card|4242[\s-]*4242/i;
  const noCard = !cardWords.test(`${route}\n${notify}\n${logger}`);
  checks.push({ name: "rule:payments-card-data", pass: noCard, detail: noCard ? "clean" : "raw card pattern found" });

  // 6. No personal-data/secrets logging (rule:logging-sensitive-data).
  const logLeak = /console\.log.*(email|address|card|secret|token)|log.*(shipping_email|personal)/i.test(`${route}\n${notify}\n${logger}`);
  checks.push({ name: "rule:logging-sensitive-data", pass: !logLeak, detail: logLeak ? "personal data in logs" : "clean" });

  // 7. Secrets fail closed (rule:secrets-management).
  const hardSecret = /sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|password\s*=\s*["'][^"']+["']/i.test(`${route}\n${notify}`);
  const secretsOk = !hardSecret;
  checks.push({ name: "rule:secrets-management", pass: secretsOk, detail: secretsOk ? "no hardcoded secrets" : "secret handling violation" });

  // 8. The agent's own tests converge (at least 2 passes: refund + notify).
  const testOut = await new Promise<{ code: number; out: string }>((resolve) => {
    execFile("bun", ["test", "journey.test.ts"], { cwd: ws, timeout: 120_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.slice(0, 4000) });
    });
  });
  const m = testOut.out.match(/(\d+)\s+pass/);
  const passes = m ? parseInt(m[1], 10) : 0;
  const testOk = testOut.code === 0 && passes >= 2;
  checks.push({ name: "agent-test", pass: testOk, detail: `bun test exit=${testOut.code} pass=${passes}` });

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length };
}

const isMain = import.meta.main;
if (isMain) {
  const ws = process.argv[2];
  if (!ws) {
    console.error("usage: verify-journey2.ts <workspace-dir>");
    process.exit(2);
  }
  const r = await verifyJourney2(ws);
  console.log(JSON.stringify(r, null, 2));
  if (r.passed < r.total) process.exit(1);
}
