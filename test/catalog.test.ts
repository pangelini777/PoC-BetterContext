import { describe, expect, test } from "bun:test";
import { loadCatalog } from "../packages/apm-catalog/src/catalog.ts";

const PKG = "fixtures/apm-package";

describe("catalog", () => {
  test("indexes exactly 36 rules and 58 skills", async () => {
    const cat = await loadCatalog(PKG);
    expect(cat.rules.length).toBe(36);
    expect(cat.skills.length).toBe(58);
    expect(cat.byId.size).toBe(94);
  });

  test("every resource has id, summary, sha, path, tokens, lifetime, deps", async () => {
    const cat = await loadCatalog(PKG);
    for (const d of [...cat.rules, ...cat.skills]) {
      expect(d.id.length).toBeGreaterThan(0);
      expect(d.summary.length).toBeGreaterThan(0);
      expect(d.bodySha256).toMatch(/^[0-9a-f]{64}$/);
      expect(d.sourcePath.length).toBeGreaterThan(0);
      expect(d.estimatedTokens).toBeGreaterThan(0);
      expect(["turn", "action", "phase", "task", "session"]).toContain(d.lifetime);
      expect(Array.isArray(d.dependsOn)).toBe(true);
    }
  });

  test("distractors and look-alikes are present", async () => {
    const cat = await loadCatalog(PKG);
    for (const id of [
      "rule.mobile-ios-guidelines",
      "rule.ml-model-governance",
      "skill.migrate-postgres-schema",
      "skill.query-postgres-readonly",
      "skill.create-checkout-session",
      "skill.handle-webhook",
    ]) {
      expect(cat.byId.has(id)).toBe(true);
    }
  });

  test("dependency closure is declared", async () => {
    const cat = await loadCatalog(PKG);
    expect(cat.byId.get("rule.payments-card-data")!.dependsOn).toContain("rule.logging-sensitive-data");
    expect(cat.byId.get("rule.webhook-idempotency")!.dependsOn).toContain("rule.logging-sensitive-data");
    expect(cat.byId.get("rule.production-change-control")!.dependsOn).toContain("rule.secrets-management");
  });

  test("catalog hash is stable", async () => {
    const a = await loadCatalog(PKG);
    const b = await loadCatalog(PKG);
    expect(a.hash).toBe(b.hash);
  });
});
