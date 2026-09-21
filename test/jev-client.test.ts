import { describe, expect, test } from "bun:test";
import { SystemOneValidationError, validateAnswer } from "../packages/jev-client/src/client.ts";

describe("jev-client validation", () => {
  test("accepts a valid noul", () => {
    const a = validateAnswer("q", { type: "noul", instructions: "x" }, { type: "noul", noul: 0.7 });
    expect(a.type).toBe("noul");
  });

  test("rejects out-of-range noul", () => {
    expect(() => validateAnswer("q", { type: "noul", instructions: "x" }, { type: "noul", noul: 1.5 })).toThrow(
      SystemOneValidationError,
    );
  });

  test("rejects choice winner that is not max probability", () => {
    expect(() =>
      validateAnswer(
        "q",
        { type: "choice", instructions: "x", criteria: { a: "A", b: "B" } },
        { type: "choice", choice: "b", probabilities: { a: 0.8, b: 0.2 }, confidence: 0.6 },
      ),
    ).toThrow(SystemOneValidationError);
  });

  test("rejects probabilities that do not sum to 1", () => {
    expect(() =>
      validateAnswer(
        "q",
        { type: "choice", instructions: "x", criteria: { a: "A", b: "B" } },
        { type: "choice", choice: "a", probabilities: { a: 0.5, b: 0.1 }, confidence: 0.4 },
      ),
    ).toThrow(SystemOneValidationError);
  });

  test("rejects unknown choice option", () => {
    expect(() =>
      validateAnswer(
        "q",
        { type: "choice", instructions: "x", criteria: { a: "A" } },
        { type: "choice", choice: "zzz", probabilities: { a: 1 }, confidence: 1 },
      ),
    ).toThrow(SystemOneValidationError);
  });
});
