// Thin OpenCode adapter: derives semantic events from harness activity and
// forwards them to ProgressiveSession. Contains NO selection logic.
// Authoritative unload proof lives in ExplicitHarness, not here, because the
// installed OpenCode plugin API (v1.18.31, inspected 2026-09-21) exposes only
// chat.message / chat.params / experimental chat+system transforms with no
// guaranteed historical-overlay reconstruction across compaction. This adapter
// is therefore a secondary integration demo.

import type { SessionStepInput } from "../../progressive-context/src/session.ts";

export interface HarnessSignal {
  kind: "user_message" | "tool_result" | "file_write" | "test_output" | "completion";
  text: string;
  paths?: string[];
  phase?: string;
}

const DOMAIN_HINTS = [
  "stripe", "webhook", "migration", "schema", "oauth", "deploy", "production",
  "test", "checkout", "privacy", "secret", "docs", "openapi", "auth", "payment",
  "cart", "copy", "button",
];

export function signalToEvent(signal: HarnessSignal): SessionStepInput | null {
  const text = signal.text.toLowerCase();
  const introducesDomain = DOMAIN_HINTS.some((h) => text.includes(h));
  const pathChangedDomain = (signal.paths ?? []).some((p) =>
    /stripe|webhook|migration|schema|auth|deploy|checkout|docs|openapi/i.test(p),
  );
  switch (signal.kind) {
    case "user_message":
      return { kind: "user_message", text: signal.text, phase: signal.phase, changedPaths: signal.paths };
    case "completion":
      return { kind: "completion", text: signal.text, phase: signal.phase ?? "done" };
    case "test_output":
      return { kind: "verification", text: signal.text, phase: signal.phase ?? "verification", changedPaths: signal.paths };
    default:
      if (introducesDomain || pathChangedDomain) {
        return { kind: "observation", text: signal.text, phase: signal.phase, changedPaths: signal.paths };
      }
      return null; // debounce: no meaningful state change, skip JEV.
  }
}

export function kernelText(): string {
  return [
    "This session uses a runtime-managed capability and policy context.",
    "Additional rules/skills may appear as the task changes.",
    "Treat currently supplied dynamic rules as authoritative for their scope.",
    "Do not assume unavailable package capabilities.",
  ].join("\n");
}
