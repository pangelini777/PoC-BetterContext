// Deterministic semantic-event derivation from OBSERVED execution state.
// Inputs: git diff paths, tool calls (names/args), verification results,
// agent text (only as a weak tiebreak), turn index. No gold labels, no JEV,
// no arm knowledge. Output: the next SemanticEvent for the router.

import type { SessionStepInput } from "../../../packages/progressive-context/src/session.ts";
import type { ParsedRun } from "./opencode-parser.ts";

export interface ObservedState {
  turn: number;
  changedPaths: string[];
  newFiles: string[];
  toolNames: string[];
  toolArgsText: string;
  verificationRunning: boolean;
  verificationPassed: boolean | null;
  agentTextExcerpt: string;
}

const PATH_PHASES: { re: RegExp; phase: string }[] = [
  { re: /webhook/i, phase: "webhook" },
  { re: /migration|migrate|schema\.sql/i, phase: "migration" },
  { re: /checkout|stripe|payment/i, phase: "checkout-api" },
  { re: /auth|login|oauth|session/i, phase: "auth" },
  { re: /deploy|release|infra|workflow/i, phase: "deploy" },
  { re: /docs|openapi|readme/i, phase: "docs" },
  { re: /test|spec/i, phase: "verification" },
  { re: /cart|page\.tsx|component/i, phase: "ui" },
];
const MAX_EVIDENCE_PATHS = 64;

function phaseFromPaths(paths: string[]): string | null {
  for (const p of paths) {
    for (const { re, phase } of PATH_PHASES) {
      if (re.test(p)) return phase;
    }
  }
  return null;
}

function phaseFromTools(toolNames: string[], argsText: string): string | null {
  const t = `${toolNames.join(" ")} ${argsText}`.toLowerCase();
  if (/test|bun test|vitest|jest/.test(t)) return "verification";
  if (/webhook/.test(t)) return "webhook";
  if (/migration|psql|postgres/.test(t)) return "migration";
  if (/deploy|release/.test(t)) return "deploy";
  return null;
}

/** Pure deterministic derivation. Same inputs -> same event. */
export function deriveEvent(state: ObservedState, taskGoal: string): SessionStepInput {
  if (state.turn === 0) {
    return { kind: "user_message", text: taskGoal, phase: "ui", changedPaths: [] };
  }
  const allChanged = [...state.changedPaths].sort();
  const changed = allChanged.slice(0, MAX_EVIDENCE_PATHS);
  const allNew = [...state.newFiles].sort();
  const newFiles = allNew.slice(0, MAX_EVIDENCE_PATHS);
  const evidence: string[] = [];
  if (changed.length > 0) {
    const omitted = allChanged.length - changed.length;
    evidence.push(`changed: ${changed.join(", ")}${omitted > 0 ? ` (+${omitted} more paths omitted)` : ""}`);
  }
  if (newFiles.length > 0) {
    const omitted = allNew.length - newFiles.length;
    evidence.push(`new: ${newFiles.join(", ")}${omitted > 0 ? ` (+${omitted} more paths omitted)` : ""}`);
  }
  if (state.toolNames.length > 0) evidence.push(`tools: ${[...new Set(state.toolNames)].sort().join(", ")}`);
  if (state.verificationRunning) {
    evidence.push(
      state.verificationPassed === true ? "verification: passing"
      : state.verificationPassed === false ? "verification: failing"
      : "verification: running",
    );
  }
  const phase =
    (state.verificationRunning ? "verification" : null) ??
    phaseFromPaths(allChanged) ??
    phaseFromTools(state.toolNames, state.toolArgsText) ??
    "build";
  const kind: SessionStepInput["kind"] =
    phase === "verification" ? "verification"
    : phase === "deploy" ? "before_high_impact_action"
    : "observation";
  const text =
    evidence.length > 0
      ? `Execution evidence after turn ${state.turn}: ${evidence.join("; ")}. Agent summary: ${state.agentTextExcerpt.slice(0, 400)}`
      : `Turn ${state.turn} completed with no file changes. Agent summary: ${state.agentTextExcerpt.slice(0, 400)}`;
  return { kind, text, phase, changedPaths: changed };
}

/** Summarize a parsed agent run into tool/state signals for deriveEvent. */
export function observeFromRun(run: ParsedRun): Pick<ObservedState, "toolNames" | "toolArgsText" | "agentTextExcerpt" | "verificationRunning"> {
  const toolNames = run.turns.flatMap((t) => t.toolCalls.map((c) => c.name));
  const toolArgsText = run.turns.flatMap((t) => t.toolCalls.map((c) => c.argsSummary)).join(" ").slice(0, 2000);
  const blob = `${toolNames.join(" ")} ${toolArgsText}`.toLowerCase();
  return {
    toolNames,
    toolArgsText,
    agentTextExcerpt: run.assistantText.slice(0, 800),
    verificationRunning: /test|spec|verif/.test(blob),
  };
}
