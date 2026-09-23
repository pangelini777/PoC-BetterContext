// Scoped refund-slice verifier. Runs against the agent's own workspace copy:
// read-only source checks plus `bun test refund.test.ts` (the agent's own
// test file, which must exit 0 with at least 1 pass).

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

export async function verifyRefund(ws: string): Promise<{ checks: VerifyCheck[]; passed: number; total: number }> {
  const checks: VerifyCheck[] = [];
  const routeRaw = await readIf(join(ws, "route.ts"));
  const route = routeRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  const catalog = await readIf(join(ws, "catalog.ts"));
  const schema = await readIf(join(ws, "schema.sql"));
  const test = await readIf(join(ws, "refund.test.ts"));

  // 1. Route is implemented (not the NOT_IMPLEMENTED stub).
  const implemented =
    /export\s+(async\s+)?function\s+POST|export\s+const\s+POST/.test(route) &&
    !/NOT_IMPLEMENTED/.test(route) &&
    !/status:\s*501/.test(route);
  checks.push({
    name: "route-implemented",
    pass: implemented,
    detail: implemented ? "POST exported without stub" : "stub or missing POST",
  });

  // 2. Trusted server-side totals from the fixture catalog, never client totals.
  const usesCatalog = /CATALOG_ITEM|catalog|unitPriceCents/.test(route);
  const honorsClientTotal = /body\s*[?._\[]\s*(total|amount)|clientTotal|total_cents\s*as\s+amount|amount\s*:\s*body/i.test(route);
  const trusted = usesCatalog && !honorsClientTotal && route.length > 100;
  checks.push({
    name: "trusted-totals",
    pass: trusted,
    detail: trusted ? "server-side catalog total referenced" : "no trusted total found",
  });

  // 3. Idempotency-Key handling: scoped replay (200 + Idempotent-Replayed) vs 422 on key reuse.
  const idem =
    /idempotency-key/i.test(route) && /Idempotent-Replayed/.test(route) && /422/.test(route);
  checks.push({
    name: "idempotent-replay",
    pass: idem,
    detail: idem ? "Idempotency-Key + replay header + 422 found" : "missing idempotency handling",
  });

  // 4. No card data handled by slice code.
  const cardWords = /card[_-]?number|cardNumber|\bcvc\b|\bcvv\b|exp_month|exp_year|raw[_-]?card/i;
  const appCode = `${route}\n${catalog}\n${schema}\n${test}`;
  checks.push({
    name: "no-card-data",
    pass: !cardWords.test(appCode),
    detail: cardWords.test(appCode) ? "raw card pattern found" : "clean",
  });

  // 5. The agent's own focused test proves duplicate delivery converges.
  const testOut = await new Promise<{ code: number; out: string }>((resolve) => {
    execFile("bun", ["test", "refund.test.ts"], { cwd: ws, timeout: 120_000 }, (err, stdout, stderr) => {
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
    console.error("usage: verify-refund.ts <workspace-dir>");
    process.exit(2);
  }
  const r = await verifyRefund(ws);
  console.log(JSON.stringify(r, null, 2));
  if (r.passed < r.total) process.exit(1);
}
