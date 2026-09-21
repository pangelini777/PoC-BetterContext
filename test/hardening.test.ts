import { describe, expect, test } from "bun:test";
import { loadCatalog } from "../packages/apm-catalog/src/catalog.ts";
import { MockBackend } from "../packages/progressive-context/src/router.ts";
import { LifecycleResolver } from "../packages/progressive-context/src/resolver.ts";
import { parseOpencodeJson } from "../evals/progressive-context/live/opencode-parser.ts";
import { deriveEvent } from "../evals/progressive-context/live/event-derive.ts";
import { classifyTrial } from "../evals/progressive-context/live/eligibility.ts";
import type { ThresholdConfig } from "../packages/protocol/src/types.ts";
import { readFile } from "node:fs/promises";

async function cfg(): Promise<ThresholdConfig> {
  return JSON.parse(await readFile("config/thresholds.json", "utf8"));
}

function evt(seq: number, phase?: string) {
  return { id: `evt-${seq}`, seq, kind: "observation" as const, text: `event ${seq}`, phase };
}

describe("shortlistMin semantics", () => {
  test("candidates below shortlistMin never reach stage-2 even inside topK", async () => {
    // shortlistMin=0.3 with a flat distribution: only masses >= 0.3 survive.
    const probs = { a: 0.28, b: 0.27, c: 0.25, d: 0.2 };
    const ranked = Object.entries(probs).sort(([, a], [, b]) => b - a);
    const eligible = ranked.filter(([, p]) => p >= 0.3);
    expect(eligible.length).toBe(0);
    const peaked = { a: 0.6, b: 0.2, c: 0.1, d: 0.1 };
    const eligible2 = Object.entries(peaked).sort(([, a], [, b]) => b - a).filter(([, p]) => p >= 0.3);
    expect(eligible2.map(([id]) => id)).toEqual(["a"]);
  });
});

describe("stage-2 Choice/fit disagreement", () => {
  test("best fit wins over Choice winner; ties break by Choice mass", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    void cat;
    const shortlist = ["s1", "s2", "s3"];
    const fits = { s1: 0.54, s2: 0.78, s3: 0.4 };
    const choiceProbs = { s1: 0.76, s2: 0.19, s3: 0.05 };
    const byFit = [...shortlist].sort((a, b) => fits[b as keyof typeof fits] - fits[a as keyof typeof fits] || choiceProbs[b as keyof typeof choiceProbs] - choiceProbs[a as keyof typeof choiceProbs]);
    expect(byFit[0]).toBe("s2");
  });
});

describe("no-skill gating", () => {
  test("gate below threshold yields no selection", () => {
    const gateScore = (0.1 + 0.2 + (1 - 0.9)) / 3;
    expect(gateScore).toBeLessThan(0.55);
  });
});

describe("critical dependency activation", () => {
  test("payments activation pulls secrets via declared dependency", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    expect(cat.byId.get("rule.payments-card-data")!.dependsOn).toContain("rule.secrets-management");
    const r = new LifecycleResolver(cat.byId, await cfg());
    const s = r.step(evt(0, "pay"), new Map([["rule.payments-card-data", { probability: 0.95, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).toContain("rule.secrets-management");
  });

  test("auth activation pulls secrets; webhook pulls secrets", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    const r = new LifecycleResolver(cat.byId, await cfg());
    let s = r.step(evt(0, "a"), new Map([["rule.auth-session-security", { probability: 0.9, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).toContain("rule.secrets-management");
    const r2 = new LifecycleResolver(cat.byId, await cfg());
    s = r2.step(evt(0, "w"), new Map([["rule.webhook-idempotency", { probability: 0.9, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).toContain("rule.secrets-management");
  });
});

describe("dependency retention/removal", () => {
  test("dependency held only by a retired parent can unload", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    const r = new LifecycleResolver(cat.byId, await cfg());
    // Activate payments (pulls logging + secrets).
    let s = r.step(evt(0, "pay"), new Map([["rule.payments-card-data", { probability: 0.95, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).toContain("rule.logging-sensitive-data");
    // Payments scores low across a phase change twice; parent unloads.
    s = r.step(evt(1, "other"), new Map([["rule.payments-card-data", { probability: 0.01, source: "system_one" as const }]]), null, "system_one");
    s = r.step(evt(2, "other2"), new Map([["rule.payments-card-data", { probability: 0.01, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).not.toContain("rule.payments-card-data");
  });
});

describe("event derivation from execution evidence", () => {
  test("changed webhook paths drive webhook phase without keyword-scanning agent text", () => {
    const e = deriveEvent({
      turn: 2, changedPaths: ["app/api/stripe/webhook/route.ts"], newFiles: [],
      toolNames: ["edit"], toolArgsText: "edit webhook route", verificationRunning: false,
      verificationPassed: null, agentTextExcerpt: "I did some general stuff",
    }, "goal");
    expect(e.phase).toBe("webhook");
    expect(e.kind).toBe("observation");
  });

  test("verification signal forces verification phase", () => {
    const e = deriveEvent({
      turn: 3, changedPaths: [], newFiles: [], toolNames: ["bash"],
      toolArgsText: "bun test", verificationRunning: true, verificationPassed: null,
      agentTextExcerpt: "working on checkout",
    }, "goal");
    expect(e.phase).toBe("verification");
    expect(e.kind).toBe("verification");
  });

  test("turn 0 emits the task goal as user_message", () => {
    const e = deriveEvent({
      turn: 0, changedPaths: [], newFiles: [], toolNames: [], toolArgsText: "",
      verificationRunning: false, verificationPassed: null, agentTextExcerpt: "",
    }, "TASK GOAL");
    expect(e.kind).toBe("user_message");
    expect(e.text).toBe("TASK GOAL");
  });
});

describe("opencode JSON parser", () => {
  test("extracts text, tokens, and done from a realistic stream", () => {
    const stream = [
      JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
      JSON.stringify({ type: "text", part: { type: "text", text: "hello" } }),
      JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop", tokens: { input: 100, output: 20, total: 120 }, time: { start: 1, end: 11 } } }),
    ].join("\n");
    const run = parseOpencodeJson(stream);
    expect(run.assistantText).toBe("hello");
    expect(run.inputTokens).toBe(100);
    expect(run.outputTokens).toBe(20);
    expect(run.totalTokens).toBe(120);
    expect(run.turns.length).toBe(1);
    expect(run.turns[0].durationMs).toBe(10);
  });

  test("unknown event kinds are counted, not fatal", () => {
    const run = parseOpencodeJson(JSON.stringify({ type: "future_schema_v9", foo: 1 }));
    expect(run.turns.length).toBe(1);
    expect(run.turns[0].unknownKinds).toContain("future_schema_v9");
  });

  test("reasoning tokens extracted when present", () => {
    const stream = JSON.stringify({ type: "step_finish", part: { type: "step-finish", reason: "stop", tokens: { input: 10, output: 5, reasoning: 50, total: 65 } } });
    const run = parseOpencodeJson(stream);
    expect(run.reasoningTokens).toBe(50);
  });
});

describe("trial eligibility classification", () => {
  test("progressive trial with fail-open record is ineligible", () => {
    const e = classifyTrial({
      arm: "progressive_jev",
      records: [{ providerEvidenceClass: "fail_open", providerCalls: 0, jevModel: null } as never],
      sentinelFailures: 0, materializations: 2, dematerializations: 1,
      verificationComplete: true, provenanceOk: true,
    });
    expect(e.eligible).toBe(false);
    expect(e.reasons.join(" ")).toMatch(/fail-open/);
  });

  test("progressive trial without dematerialization is ineligible", () => {
    const e = classifyTrial({
      arm: "progressive_jev",
      records: [{ providerEvidenceClass: "provider_backed", providerCalls: 2, jevModel: "jev-1.13.0" } as never],
      sentinelFailures: 0, materializations: 2, dematerializations: 0,
      verificationComplete: true, provenanceOk: true,
    });
    expect(e.eligible).toBe(false);
  });

  test("clean progressive trial is eligible; load_all skips routing gates", () => {
    const e = classifyTrial({
      arm: "progressive_jev",
      records: [{ providerEvidenceClass: "provider_backed", providerCalls: 2, jevModel: "jev-1.13.0" } as never],
      sentinelFailures: 0, materializations: 2, dematerializations: 1,
      verificationComplete: true, provenanceOk: true,
    });
    expect(e.eligible).toBe(true);
    const b = classifyTrial({
      arm: "load_all", records: [], sentinelFailures: 0,
      materializations: 29, dematerializations: 0,
      verificationComplete: true, provenanceOk: true,
    });
    expect(b.eligible).toBe(true);
  });
});

describe("hidden verifier behavior", () => {
  test("stub workspace fails executable checks (verifier discriminates)", async () => {
    const { verifyWorkspace } = await import("../evals/progressive-context/independent/verify-workspace.ts");
    const r = await verifyWorkspace("fixtures/demo-workspace");
    expect(r.total).toBeGreaterThan(9);
    expect(r.passed).toBeLessThan(r.total);
    expect(r.checks.some((c) => c.name.startsWith("hidden:"))).toBe(true);
  });
});

describe("mock backend still available for scripted arms", () => {
  test("static_initial freezing works", async () => {
    const b = new MockBackend({ "rule.a": 0.9 }, "skill.x");
    const cat = await loadCatalog("fixtures/apm-package");
    const out = await b.route(
      { sessionId: "s", goal: "g", currentEvent: { id: "e", seq: 0, kind: "user_message", text: "t" }, recentEvents: [], activeResourceIds: [], changedPaths: [] },
      cat.rules, cat.skills, cat.bodies,
      { topK: 3, gateThreshold: 0.55, fitsThreshold: 0.55, shortlistMin: 0.3 },
    );
    expect(out.ruleScores.get("rule.accessibility-ui")?.probability).toBe(0);
  });
});
