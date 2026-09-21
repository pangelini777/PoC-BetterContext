// OpenCode `--format json` event parser + live token extraction.
// Parses the newline-delimited JSON event stream into per-turn records:
// assistant text, tool calls (name/args/result/status), step boundaries,
// token usage (input/output/reasoning/total), duration. Robust to unknown
// event shapes: anything unrecognized is counted, never crashes.

export interface ParsedToolCall {
  name: string;
  argsSummary: string;
  status: "ok" | "error" | "unknown";
  resultExcerpt: string;
}

export interface ParsedTurn {
  index: number;
  assistantText: string;
  toolCalls: ParsedToolCall[];
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  durationMs: number;
  rawEventCount: number;
  unknownKinds: string[];
}

export interface ParsedRun {
  turns: ParsedTurn[];
  assistantText: string;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  durationMs: number;
  done: boolean;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse one `opencode run --format json` stdout blob into a ParsedRun. */
export function parseOpencodeJson(stdout: string): ParsedRun {
  const turns: ParsedTurn[] = [];
  let cur: ParsedTurn = newTurn(0);
  let done = false;
  let runDurationMs = 0;

  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(t) as Record<string, unknown>;
    } catch {
      cur.unknownKinds.push("unparseable-line");
      continue;
    }
    const type = str(ev["type"]);
    if (type === "text") {
      const part = (ev["part"] ?? {}) as Record<string, unknown>;
      const text = str(part["text"]);
      if (text) cur.assistantText += (cur.assistantText ? "\n" : "") + text;
    } else if (type === "tool_use" || type === "tool-call" || type === "tool_call") {
      // Observed schema (opencode 1.18.31): part={type:"tool", tool, callID,
      // state:{status:"completed"|"error"|..., input:{...}, output, metadata}}.
      // Legacy/alternate shapes (part.args/input/arguments, separate
      // tool_result events) are still accepted below.
      const part = (ev["part"] ?? ev) as Record<string, unknown>;
      const state = (part["state"] ?? {}) as Record<string, unknown>;
      const input = state["input"] ?? part["args"] ?? part["input"] ?? part["arguments"] ?? {};
      const output = state["output"] ?? part["output"] ?? part["result"] ?? part["text"] ?? "";
      const statusRaw = state["status"] ?? part["status"] ?? part["isError"];
      const status = statusRaw === "completed" || statusRaw === false || statusRaw === "ok" ? "ok"
        : statusRaw === "error" || statusRaw === true || statusRaw === "failed" ? "error"
        : output !== "" ? "ok" : "unknown";
      cur.toolCalls.push({
        name: str(part["tool"] ?? part["name"] ?? part["toolName"] ?? state["tool"] ?? "unknown"),
        argsSummary: JSON.stringify(input).slice(0, 500),
        status,
        resultExcerpt: str(output).slice(0, 500),
      });
    } else if (type === "tool_result" || type === "tool-result" || type === "tool_result_part") {
      const part = (ev["part"] ?? ev) as Record<string, unknown>;
      const last = cur.toolCalls[cur.toolCalls.length - 1];
      const output = str(part["output"] ?? part["result"] ?? part["text"] ?? "");
      const isError = part["isError"] === true || part["status"] === "error";
      if (last && !last.resultExcerpt) {
        last.status = isError ? "error" : "ok";
        last.resultExcerpt = output.slice(0, 500);
      } else {
        cur.toolCalls.push({ name: "(result-without-call)", argsSummary: "", status: isError ? "error" : "ok", resultExcerpt: output.slice(0, 500) });
      }
    } else if (type === "step_finish" || type === "step-finish") {
      const part = (ev["part"] ?? {}) as Record<string, unknown>;
      const tokens = (part["tokens"] ?? {}) as Record<string, unknown>;
      cur.inputTokens += num(tokens["input"]);
      cur.outputTokens += num(tokens["output"]);
      cur.reasoningTokens += num(tokens["reasoning"]);
      cur.totalTokens += num(tokens["total"] || num(tokens["input"]) + num(tokens["output"]) + num(tokens["reasoning"]));
      const time = (part["time"] ?? {}) as Record<string, unknown>;
      if (typeof time["start"] === "number" && typeof time["end"] === "number") {
        cur.durationMs += (time["end"] as number) - (time["start"] as number);
      }
      const reason = str(part["reason"]);
      if (reason === "stop" || reason === "done") done = true;
      turns.push(cur);
      cur = newTurn(turns.length);
    } else if (type === "step_start" || type === "step-start") {
      // boundary marker; current accumulator continues.
    } else if (type === "error") {
      cur.unknownKinds.push(`error:${str((ev["error"] as Record<string, unknown> | undefined)?.["message"] ?? "unknown").slice(0, 120)}`);
    } else if (type === "done" || type === "session_end" || type === "finish") {
      done = true;
    } else {
      // Unknown schema shape: count it so schema drift is visible, keep going.
      cur.unknownKinds.push(type || "(missing-type)");
    }
    cur.rawEventCount += 1;
  }
  // Flush a trailing partial turn (e.g. timeout killed the run mid-step).
  // Skip the fresh accumulator when it carries no signal.
  if (cur.assistantText || cur.toolCalls.length > 0 || cur.inputTokens > 0 || cur.outputTokens > 0 || cur.unknownKinds.length > 0) turns.push(cur);

  const assistantText = turns.map((t) => t.assistantText).filter(Boolean).join("\n");
  return {
    turns,
    assistantText,
    toolCallCount: turns.reduce((a, t) => a + t.toolCalls.length, 0),
    inputTokens: turns.reduce((a, t) => a + t.inputTokens, 0),
    outputTokens: turns.reduce((a, t) => a + t.outputTokens, 0),
    reasoningTokens: turns.reduce((a, t) => a + t.reasoningTokens, 0),
    totalTokens: turns.reduce((a, t) => a + t.totalTokens, 0),
    durationMs: runDurationMs + turns.reduce((a, t) => a + t.durationMs, 0),
    done,
  };
}

function newTurn(index: number): ParsedTurn {
  return {
    index, assistantText: "", toolCalls: [],
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0,
    durationMs: 0, rawEventCount: 0, unknownKinds: [],
  };
}
