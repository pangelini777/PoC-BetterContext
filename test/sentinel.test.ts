import { describe, expect, test } from "bun:test";
import { ExplicitHarness, compileOverlay, scrubOverlays, countOverlays } from "../packages/progressive-context/src/compiler.ts";
import { KERNEL } from "../packages/progressive-context/src/session.ts";

const ALPHA_BODY = `<jev-resource id="rule.alpha">UNIQUE_ALPHA_SENTINEL_7F3A</jev-resource>\nAlpha rule body for sentinel proof.`;
const BETA_BODY = "Beta rule body without any marker.";

function bodies(): Map<string, string> {
  return new Map([
    ["rule.alpha", ALPHA_BODY],
    ["rule.beta", BETA_BODY],
  ]);
}

describe("sentinel dematerialization on the authoritative request path", () => {
  test("materialized body present in request N, absent from every part of request N+1", () => {
    const h = new ExplicitHarness(KERNEL);
    const bodiesMap = bodies();

    // Request N: alpha active.
    const c1 = compileOverlay(["rule.alpha", "rule.beta"], bodiesMap, "evt-000");
    c1.kernel = KERNEL;
    const reqN = h.step("evt-000", "do alpha work", c1);
    expect(reqN.includes("UNIQUE_ALPHA_SENTINEL_7F3A")).toBe(true);

    // Request N+1: alpha dematerialized, only beta remains.
    const c2 = compileOverlay(["rule.beta"], bodiesMap, "evt-001");
    c2.kernel = KERNEL;
    const reqNext = h.step("evt-001", "alpha no longer needed", c2);

    expect(reqNext.includes("UNIQUE_ALPHA_SENTINEL_7F3A")).toBe(false);
    expect(reqNext.includes("rule.alpha")).toBe(false);
    // Beta still present.
    expect(reqNext.includes(BETA_BODY.slice(0, 20))).toBe(true);
    // Exactly one current overlay block.
    expect(countOverlays(reqNext)).toBe(1);
  });

  test("historical overlay blocks are scrubbed, not accumulated", () => {
    const h = new ExplicitHarness(KERNEL);
    const bodiesMap = bodies();
    for (let i = 0; i < 4; i++) {
      const ids = i % 2 === 0 ? ["rule.alpha"] : ["rule.beta"];
      const c = compileOverlay(ids, bodiesMap, `evt-00${i}`);
      c.kernel = KERNEL;
      h.step(`evt-00${i}`, `event ${i}`, c);
    }
    const last = h.effectiveContext(h.requestCount() - 1);
    expect(countOverlays(last)).toBe(1);
    // The alpha sentinel from two steps ago must not leak through history.
    expect(last.includes("UNIQUE_ALPHA_SENTINEL_7F3A")).toBe(false);
  });

  test("scrubber is idempotent and preserves non-overlay text", () => {
    const text = `hello <jev-apm-context version="1" event="e1">STALE</jev-apm-context> world`;
    const once = scrubOverlays(text);
    expect(once.removedCount).toBe(1);
    expect(once.scrubbed.includes("STALE")).toBe(false);
    expect(once.scrubbed.includes("hello")).toBe(true);
    expect(once.scrubbed.includes("world")).toBe(true);
    const twice = scrubOverlays(once.scrubbed);
    expect(twice.scrubbed).toBe(once.scrubbed);
    expect(twice.removedCount).toBe(0);
  });

  test("malformed and stray markers are removed safely", () => {
    const text = `a <jev-apm-context version="1">unclosed b </jev-apm-context> c`;
    const { scrubbed, removedCount } = scrubOverlays(text);
    expect(removedCount).toBeGreaterThanOrEqual(1);
    expect(scrubbed.includes("jev-apm-context")).toBe(false);
    expect(scrubbed.includes("a")).toBe(true);
  });
});
