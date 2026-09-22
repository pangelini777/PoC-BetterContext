import { describe, expect, test } from "bun:test";
import { loadCatalog } from "../packages/apm-catalog/src/catalog.ts";
import { LifecycleResolver } from "../packages/progressive-context/src/resolver.ts";
import type { ThresholdConfig } from "../packages/protocol/src/types.ts";
import { readFile } from "node:fs/promises";

async function cfg(): Promise<ThresholdConfig> {
  return JSON.parse(await readFile("config/thresholds.json", "utf8"));
}

function evt(seq: number, phase?: string) {
  return { id: `evt-${seq}`, seq, kind: "observation" as const, text: `event ${seq}`, phase };
}

describe("lifecycle resolver", () => {
  test("activates above threshold, retains in middle band, unloads after streak", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    const r = new LifecycleResolver(cat.byId, await cfg());
    const id = "rule.brand-ui-copy"; // action lifetime: 1 low score evicts
    // Activate.
    let s = r.step(evt(0, "ui"), new Map([[id, { probability: 0.9, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).toContain(id);
    // Middle band: retained, streak untouched.
    s = r.step(evt(1, "ui"), new Map([[id, { probability: 0.25, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).toContain(id);
    // Below unload: single strike evicts (action lifetime).
    s = r.step(evt(2, "ui"), new Map([[id, { probability: 0.05, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).not.toContain(id);
    expect(s.removed).toContain(id);
  });

  test("critical rules use the lower activation threshold", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    const c = await cfg();
    const r = new LifecycleResolver(cat.byId, c);
    // 0.60 activates critical (0.55) but not normal (0.65).
    const s = r.step(
      evt(0, "x"),
      new Map([
        ["rule.secrets-management", { probability: 0.6, source: "system_one" as const }],
        ["rule.brand-ui-copy", { probability: 0.6, source: "system_one" as const }],
      ]),
      null,
      "system_one",
    );
    expect(s.activeAfter).toContain("rule.secrets-management");
    expect(s.activeAfter).not.toContain("rule.brand-ui-copy");
  });

  test("dependencies activate with source=dependency semantics", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    const r = new LifecycleResolver(cat.byId, await cfg());
    const s = r.step(
      evt(0, "pay"),
      new Map([["rule.payments-card-data", { probability: 0.95, source: "system_one" as const }]]),
      null,
      "system_one",
    );
    expect(s.activeAfter).toContain("rule.payments-card-data");
    expect(s.activeAfter).toContain("rule.logging-sensitive-data");
  });

  test("skill supersede dematerializes the previous skill", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    const r = new LifecycleResolver(cat.byId, await cfg());
    let s = r.step(evt(0, "a"), new Map(), "skill.create-checkout-session", "system_one");
    expect(s.activeAfter).toContain("skill.create-checkout-session");
    s = r.step(evt(1, "b"), new Map(), "skill.handle-webhook", "system_one");
    expect(s.activeAfter).toContain("skill.handle-webhook");
    expect(s.activeAfter).not.toContain("skill.create-checkout-session");
    expect(s.removed).toContain("skill.create-checkout-session");
  });

  test("task-lifetime rules resist unload streaks", async () => {
    const cat = await loadCatalog("fixtures/apm-package");
    const r = new LifecycleResolver(cat.byId, await cfg());
    const id = "rule.privacy-personal-data"; // task lifetime
    let s = r.step(evt(0, "a"), new Map([[id, { probability: 0.9, source: "system_one" as const }]]), null, "system_one");
    expect(s.activeAfter).toContain(id);
    for (let i = 1; i <= 5; i++) {
      s = r.step(evt(i, `p${i}`), new Map([[id, { probability: 0.01, source: "system_one" as const }]]), null, "system_one");
    }
    expect(s.activeAfter).toContain(id);
  });
});
