import { describe, expect, test } from "bun:test";
import { assertProvenance } from "../packages/progressive-context/src/provenance.ts";

describe("provenance", () => {
  test("rejects sibling agentOpt paths", () => {
    expect(() => assertProvenance({ store: "/home/dev/code/agentOpt/data/x" })).toThrow();
    expect(() => assertProvenance({ ws: "/tmp/ok-workspace" })).not.toThrow();
  });
});
