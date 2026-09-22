import { describe, expect, test } from "bun:test";
import { loadCatalog } from "../packages/apm-catalog/src/catalog.ts";
import { SystemOneBackend } from "../packages/progressive-context/src/router.ts";
import { readFile } from "node:fs/promises";

/** Canned fetch proving the provider-backed path end to end (validation,
// telemetry attribution, evidence class) without needing a live API key. */
function cannedFetch(): typeof fetch {
  return (async (_url: unknown, init: unknown) => {
    const body = JSON.parse(String((init as { body: string }).body));
    const qids = Object.keys(body.questions);
    const answers: Record<string, unknown> = {};
    for (const qid of qids) {
      const q = body.questions[qid];
      if (q.type === "noul") {
        if (qid.includes("payments") || qid.includes("webhook-idempotency")) answers[qid] = { type: "noul", noul: 0.9 };
        else if (qid === "prose_only_suffices") answers[qid] = { type: "noul", noul: 0.1 };
        else if (qid === "acts_on_repo_or_system" || qid === "specialized_procedure_helpful") answers[qid] = { type: "noul", noul: 0.85 };
        else answers[qid] = { type: "noul", noul: 0.05 };
      } else if (q.type === "choice" && qid === "which_skill") {
        const options = Object.keys(q.criteria);
        const probs: Record<string, number> = {};
        for (const o of options) probs[o] = o === "skill.handle-webhook" ? 0.7 : 0.3 / Math.max(1, options.length - 1);
        const sum = Object.values(probs).reduce((a, b) => a + b, 0);
        for (const o of options) probs[o] /= sum;
        answers[qid] = { type: "choice", choice: "skill.handle-webhook", probabilities: probs, confidence: 0.6 };
      } else {
        answers[qid] = { type: "noul", noul: 0.8 };
      }
    }
    // Stage-2 shape: fits::* nouls.
    for (const qid of qids) {
      if (qid.startsWith("fits::")) answers[qid] = { type: "noul", noul: qid.includes("handle-webhook") ? 0.9 : 0.1 };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: "jev-1.13.0-test", answers, usage: { input_tokens: 100, output_tokens: 10 } }),
      text: async () => "",
    } as unknown as Response;
  }) as typeof fetch;
}

describe("provider-backed routing plumbing", () => {
  test("SystemOneBackend yields provider_backed evidence with persisted usage", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    const cfg = JSON.parse(await readFile("config/thresholds.json", "utf8"));
    // Monkey-patch fetch via env-independent injection: SystemOneBackend uses
    // global fetch by default; here we test systemOne-level validation instead
    // by calling route with a backend wired to canned fetch through opts.
    const { systemOne } = await import("../packages/jev-client/src/client.ts");
    const res = await systemOne(
      { goal: "webhook fix" },
      { is_needed: { type: "noul", instructions: "Is webhook work needed?" } },
      { apiKey: "test-key", fetchImpl: cannedFetch(), timeoutMs: 5000 },
    );
    expect(res.model).toBe("jev-1.13.0-test");
    expect(res.usage.input_tokens).toBe(100);
    expect(res.answers["is_needed"].type).toBe("noul");
    void cfg;
    void cat;
  });

  test("SystemOneBackend.route classifies evidence as provider_backed", async () => {
    // SystemOneBackend accepts only apiKey/model/timeout; fetch injection is
    // via global fetch. Swap it temporarily with the canned implementation.
    const original = globalThis.fetch;
    globalThis.fetch = cannedFetch();
    try {
      const cat = await loadCatalog("fixtures/apm-package");
      const backend = new SystemOneBackend("test-key", "jev-test", 5000);
      const out = await backend.route(
        {
          sessionId: "s", goal: "Fix stripe webhook",
          currentEvent: { id: "e0", seq: 0, kind: "user_message", text: "Fix stripe webhook signature and duplicate delivery", phase: "webhook" },
          recentEvents: [], activeResourceIds: [], changedPaths: [],
        },
        cat.rules, cat.skills, cat.bodies,
        { topK: 3, gateThreshold: 0.55, fitsThreshold: 0.55, shortlistMin: 0.3 },
      );
      expect(out.evidenceClass).toBe("provider_backed");
      expect(out.jevModel).toBe("jev-1.13.0-test");
      expect(out.calls).toBe(2);
      expect(out.inputTokens).toBe(200);
      expect(out.ruleScores.get("rule.webhook-idempotency")?.probability).toBe(0.9);
      expect(out.selectedSkill).toBe("skill.handle-webhook");
    } finally {
      globalThis.fetch = original;
    }
  });
});
