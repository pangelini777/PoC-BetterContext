// Journey verifier: 8 checks across the 4-phase refund -> notify -> privacy
// -> release journey. Runs against the agent's own workspace copy: read-only
// source checks (comments stripped) plus `bun test journey.test.ts` (the
// agent's own test file, which must exit 0 with at least 1 pass).

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

function stripSh(src: string): string {
  return src
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

export async function verifyJourney(ws: string): Promise<{ checks: VerifyCheck[]; passed: number; total: number }> {
    const checks: VerifyCheck[] = [];
    const route = stripJs(await readIf(join(ws, "route.ts")));
    const notify = stripJs(await readIf(join(ws, "notify.ts")));
    const privacy = stripJs(await readIf(join(ws, "privacy.ts")));
    const logger = stripJs(await readIf(join(ws, "logger.ts")));
    const release = stripSh(await readIf(join(ws, "release.sh")));

    // Rule-adherence checks (4/5 in report §rule-adherence): normative
    // requirements straight from the rule bodies, not just file existence.
    // 9. No raw card data anywhere in application sources.
    const cardWords = /card[_-]?number|cardNumber|cvc|cvv|exp_month|exp_year|raw[_-]?card|4242[\s-]*4242/i;
    const appCode = `${route}\n${notify}\n${privacy}\n${logger}`;
    const noCard = !cardWords.test(appCode);
    checks.push({
      name: "rule:payments-card-data",
      pass: noCard,
      detail: noCard ? "clean" : "raw card pattern found",
    });
    // 10. No personal-data/secrets logging.
    const logLeak = /console\.log.*(email|address|card|secret|token)|log.*(shipping_email|personal)/i.test(appCode);
    checks.push({
      name: "rule:logging-sensitive-data",
      pass: !logLeak,
      detail: logLeak ? "personal data in logs" : "clean",
    });
    // 11. Secrets fail closed (no hardcoded keys, no insecure fallback).
    const hardSecret = /sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|password\s*=\s*["'][^"']+["']/i.test(appCode);
    const insecureFallback = /fallback.*insecure|insecure.*fallback|\|\|\s*["']test/i.test(appCode);
    const secretsOk = !hardSecret && !insecureFallback;
    checks.push({
      name: "rule:secrets-management",
      pass: secretsOk,
      detail: secretsOk ? "no hardcoded secrets or insecure fallback" : "secret handling violation",
    });
    // 12. Webhook/signature discipline where applicable (checked on route).
    const sigOk = !/stripe/i.test(route) || (/signature|constructEvent|whsec/i.test(route) && /400|401|invalid/i.test(route));
    checks.push({
      name: "rule:webhook-idempotency",
      pass: sigOk,
      detail: sigOk ? "signature discipline ok or N/A" : "stripe route without signature handling",
    });
  // 1. Refund route implemented with trusted server-side totals.
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

  // 2. Idempotency-Key handling: scoped replay (200 + Idempotent-Replayed) vs 422 on key reuse.
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

  // 5. GDPR deletion endpoint backed by eraseCustomer.
  const gdpr =
    /eraseCustomer/.test(privacy) && !/NOT_IMPLEMENTED/.test(privacy) && privacy.length > 50;
  checks.push({
    name: "gdpr-endpoint",
    pass: gdpr,
    detail: gdpr ? "eraseCustomer implemented" : "stub or missing eraseCustomer",
  });

  // 6. Audit export backed by exportAudit.
  const audit =
    /exportAudit/.test(privacy) && !/NOT_IMPLEMENTED/.test(privacy) && privacy.length > 50;
  checks.push({
    name: "audit-export",
    pass: audit,
    detail: audit ? "exportAudit implemented" : "stub or missing exportAudit",
  });

  // 7. Release checklist: migration runs before the code deploy.
  const migIdx = release.search(/migrat/i);
  const depIdx = release.search(/deploy/i);
  const releaseOk = migIdx >= 0 && depIdx >= 0 && migIdx < depIdx;
  checks.push({
    name: "release-checklist",
    pass: releaseOk,
    detail: releaseOk ? "migration ordered before code deploy" : "missing migration-before-code ordering",
  });

  // 8. The agent's own focused test proves the journey converges.
  const testOut = await new Promise<{ code: number; out: string }>((resolve) => {
    execFile("bun", ["test", "journey.test.ts"], { cwd: ws, timeout: 120_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? 1 : 0, out: `${stdout}\n${stderr}`.slice(0, 4000) });
    });
  });
  const m = testOut.out.match(/(\d+)\s+pass/);
  const passes = m ? parseInt(m[1], 10) : 0;
  const testOk = testOut.code === 0 && passes >= 1;
  checks.push({
    name: "agent-test",
    pass: testOk,
    detail: `bun test exit=${testOut.code} pass=${passes}`,
  });

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length };
}

const isMain = import.meta.main;
if (isMain) {
  const ws = process.argv[2];
  if (!ws) {
    console.error("usage: verify-journey.ts <workspace-dir>");
    process.exit(2);
  }
  const r = await verifyJourney(ws);
  console.log(JSON.stringify(r, null, 2));
  if (r.passed < r.total) process.exit(1);
}
