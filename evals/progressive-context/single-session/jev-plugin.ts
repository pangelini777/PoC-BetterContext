// jev_single OpenCode plugin: single-session progressive-context demo.
//
// BEHAVIORAL HONESTY (read before citing this plugin as proof):
// This plugin rewrites the EMITTED message/system lists it is handed via the
// experimental transform hooks. That is a behavioral overlay policy, NOT a
// byte-proof unload guarantee: there is NO provider-request construction hook
// with a reconstruction guarantee in the installed OpenCode plugin API
// (v1.18.31: chat.message / chat.params / experimental chat.messages.transform
// + chat.system.transform / tool hooks only). Compaction summaries and
// provider-native replay payloads can reintroduce evicted text outside these
// hooks' view. Authoritative unload proof lives in the benchmark-owned
// ExplicitHarness (packages/progressive-context/src/compiler.ts), which
// assembles each request itself. This plugin is the real-life single-session
// shape; the harness is the proof.
//
// ROUTING OWNERSHIP:
// JEV routing is owned by the benchmark runner (run-single.ts), which drives
// ProgressiveSession (packages/progressive-context/src/session.ts) + the
// ScoreBackend from packages/progressive-context/src/router.ts. Per turn the
// runner writes its decision to:
//
//   <workspace>/.agents/jev-decisions.json
//   {
//     "eventId": "evt-003",
//     "kernel": "optional kernel override (else built-in KERNEL)",
//     "materialized": [{ "id": "rule.x", "name": "x", "body": "..." }],
//     "evictedIds": ["rule.y"],
//     "evictedProbes": { "rule.y": "<first ~60 chars of evicted body>" }
//   }
//
// The plugin reads that file per turn (best effort, never throws), scrubs
// every <jev-apm-context> block from the emitted lists IN PLACE, and pushes
// exactly one fresh overlay carrying the current materialized set. If the
// file is missing/unparseable the plugin still scrubs and pushes an (empty)
// overlay so the exactly-once invariant holds, and records the fallback.
//
// PER-TURN JSONL:
// After each system transform the plugin appends one line to
// <workspace>/.agents/jev-plugin-turns.jsonl with the derived routing event,
// materialized/evicted ids, and the emitted-message unload assertions
// (evicted probes absent, exactly one overlay block). All file I/O is
// wrapped; the plugin NEVER throws into the agent loop.
//
// HOOK MUTATION DISCIPLINE:
// The transform outputs MUST be mutated in place (splice/push/index-assign).
// Reassigning output.messages / output.system detaches the caller's list and
// silently drops the rewrite. Every helper below obeys this; see
// scrubTextPartsInPlace / applySystemOverlayInPlace.

// The @opencode-ai/plugin types are intentionally NOT imported here: the
// benchmark repo has no such dependency and the plugin is transpiled into the
// trial workspace. Structural hook signatures below mirror the installed
// plugin API (v1.18.31) and are checked against it in review, not by tsc.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DECISIONS_REL_PATH = ".agents/jev-decisions.json";
export const TURN_LOG_REL_PATH = ".agents/jev-plugin-turns.jsonl";

export const OVERLAY_OPEN_PREFIX = '<jev-apm-context version="1"';
export const OVERLAY_CLOSE = "</jev-apm-context>";

const OVERLAY_BLOCK_RE = /<jev-apm-context\b[^>]*>[\s\S]*?<\/jev-apm-context>/g;
const STRAY_TAG_RE = /<\/?jev-apm-context\b[^>]*>/g;

export const KERNEL = [
  "This session uses a runtime-managed capability and policy context.",
  "Additional rules/skills may appear as the task changes.",
  "Treat currently supplied dynamic rules as authoritative for their scope.",
  "Do not assume unavailable package capabilities.",
].join("\n");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaterializedBody {
  id: string;
  name?: string;
  body: string;
}

export interface RunnerDecision {
  eventId?: string;
  kernel?: string;
  materialized?: MaterializedBody[];
  evictedIds?: string[];
  /** id -> short probe (prefix) of the evicted body, for absence assertions. */
  evictedProbes?: Record<string, string>;
}

export interface ToolActivity {
  tool: string;
  argsText: string;
  outputExcerpt?: string;
}

export type DerivedKind =
  | "user_message"
  | "plan_or_phase_change"
  | "observation"
  | "before_high_impact_action"
  | "verification"
  | "completion";

export interface DerivedEvent {
  kind: DerivedKind;
  text: string;
  phase?: string;
}

export interface UnloadAssertion {
  evictedAbsent: boolean;
  leakedProbes: string[];
  overlayCount: number;
  exactlyOneOverlay: boolean;
}

export interface TurnLogLine {
  turn: number;
  eventId: string;
  derivedEvent: DerivedEvent;
  materializedIds: string[];
  evictedIds: string[];
  decisionsSource: "runner-file" | "fallback-empty";
  messagesScrubbed: number;
  systemScrubbed: number;
  unload: UnloadAssertion;
  at: string;
}

// ---------------------------------------------------------------------------
// Pure functions (unit-testable, no I/O, no plugin runtime)
// ---------------------------------------------------------------------------

/** Idempotent: removes every complete overlay block plus stray markers. */
export function scrubOverlaysText(text: string): { scrubbed: string; removedCount: number } {
  let removedCount = 0;
  const withoutBlocks = text.replace(OVERLAY_BLOCK_RE, () => {
    removedCount += 1;
    return "";
  });
  const scrubbed = withoutBlocks.replace(STRAY_TAG_RE, () => {
    removedCount += 1;
    return "";
  });
  return { scrubbed, removedCount };
}

export function countOverlayBlocks(text: string): number {
  return text.match(OVERLAY_BLOCK_RE)?.length ?? 0;
}

/** Tiny non-crypto hex digest for overlay attrs (router identity uses sha256; this is display-only). */
export function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

export function overlayOpenTag(eventId: string): string {
  return `<jev-apm-context version="1" event="${eventId}">`;
}

/** Exactly one overlay block for the current materialized set (empty set -> open+close pair). */
export function buildFreshOverlay(eventId: string, materialized: MaterializedBody[]): string {
  const ids = [...materialized].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (ids.length === 0) return `${overlayOpenTag(eventId)}\n${OVERLAY_CLOSE}`;
  const parts = ids.map((m) => {
    const kind = m.id.startsWith("skill.") ? "skill" : "rule";
    const short = m.name ?? m.id.slice(m.id.indexOf(".") + 1);
    return `  <${kind} id="${m.id}" name="${short}" hash="${shortHash(m.body)}">\n${m.body}\n  </${kind}>`;
  });
  return `${overlayOpenTag(eventId)}\n${parts.join("\n")}\n${OVERLAY_CLOSE}`;
}


const PHASE_HINTS: { re: RegExp; phase: string }[] = [
  { re: /webhook/i, phase: "webhook" },
  { re: /migration|migrate|schema\.sql/i, phase: "migration" },
  { re: /checkout|stripe|payment/i, phase: "checkout-api" },
  { re: /auth|login|oauth|session/i, phase: "auth" },
  { re: /deploy|release|infra|workflow/i, phase: "deploy" },
  { re: /docs|openapi|readme/i, phase: "docs" },
  { re: /test|spec/i, phase: "verification" },
  { re: /cart|page\.tsx|component/i, phase: "ui" },
];

function phaseFromText(t: string): string | undefined {
  for (const h of PHASE_HINTS) if (h.re.test(t)) return h.phase;
  return undefined;
}

/**
 * Derive the routing event for this turn from observed tool/file activity.
 * Pure + deterministic: same activity -> same event. Mirrors the spirit of
 * live/event-derive.ts without importing it (plugin must stay dependency-free).
 */
export function deriveRoutingEvent(activity: ToolActivity[], messageText = ""): DerivedEvent {
  const joined = `${activity.map((a) => `${a.tool} ${a.argsText}`).join("\n")}\n${messageText}`;
  const lower = joined.toLowerCase();
  const phase = phaseFromText(joined);
  const text = activity.length === 0 ? messageText.slice(0, 500) : joined.slice(0, 2000);

  if (/test|vitest|jest|bun test|pytest|go test/.test(lower)) {
    return { kind: "verification", text, phase: phase ?? "verification" };
  }
  if (/rm\s+-rf|delete\s+.*\*|drop\s+(table|database)|deploy|release\s+prod/i.test(joined)) {
    return { kind: "before_high_impact_action", text, phase };
  }
  if (activity.length > 0) {
    return { kind: "observation", text, phase };
  }
  return { kind: "user_message", text: text.slice(0, 500), phase };
}

/**
 * Assert unload over the EMITTED texts handed to the provider path:
 * every evicted probe absent, exactly one overlay block present.
 */
export function assertEmittedUnload(emittedTexts: string[], evictedProbes: string[]): UnloadAssertion {
  const joined = emittedTexts.join("\n");
  const leakedProbes = evictedProbes.filter((p) => p.length > 0 && joined.includes(p));
  const overlayCount = countOverlayBlocks(joined);
  return {
    evictedAbsent: leakedProbes.length === 0,
    leakedProbes,
    overlayCount,
    exactlyOneOverlay: overlayCount === 1,
  };
}

/**
 * Scrub overlay blocks from every text-carrying part IN PLACE
 * (mutates part.text, never replaces the parts array). Returns total removed.
 */
export function scrubTextPartsInPlace(parts: Array<Record<string, unknown>>): number {
  let removed = 0;
  for (const part of parts) {
    if (typeof part["text"] === "string") {
      const { scrubbed, removedCount } = scrubOverlaysText(part["text"] as string);
      if (removedCount > 0) part["text"] = scrubbed;
      removed += removedCount;
    }
  }
  return removed;
}

/**
 * Scrub overlay blocks from every system entry IN PLACE (index-assign, never
 * reassign the array), then push exactly one fresh entry. Returns scrub count.
 */
export function applySystemOverlayInPlace(system: string[], freshEntry: string): number {
  let removed = 0;
  for (let i = 0; i < system.length; i++) {
    const { scrubbed, removedCount } = scrubOverlaysText(system[i]);
    if (removedCount > 0) system[i] = scrubbed;
    removed += removedCount;
  }
  system.push(freshEntry);
  return removed;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const JevSingleSession = async (input: { directory?: string }): Promise<Record<string, (arg1: never, arg2: never) => Promise<void>>> => {
  const workspaceDir: string = input.directory ?? process.cwd();
  const activity: ToolActivity[] = [];
  let turn = 0;
  let messagesScrubbed = 0;
  let lastMaterializedIds: string[] = [];

  const recordActivity = (entry: ToolActivity): void => {
    activity.push(entry);
    if (activity.length > 50) activity.splice(0, activity.length - 50);
  };

  const loadDecision = async (): Promise<{ decision: RunnerDecision; source: TurnLogLine["decisionsSource"] }> => {
    try {
      const raw = await readFile(join(workspaceDir, DECISIONS_REL_PATH), "utf8");
      const parsed = JSON.parse(raw) as RunnerDecision;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("decisions file is not an object");
      }
      return { decision: parsed, source: "runner-file" };
    } catch {
      return { decision: {}, source: "fallback-empty" };
    }
  };

  return {
    "tool.execute.before": (async (toolInput: { tool: string }, output: { args: unknown }) => {
      try {
        const name = String((toolInput as { tool?: unknown }).tool ?? "unknown");
        const argsText = JSON.stringify((output as { args?: unknown }).args ?? {}).slice(0, 2000);
        recordActivity({ tool: name, argsText });
      } catch {
        // Never break the agent loop.
      }
    }) as never,

    "tool.execute.after": (async (toolInput: { tool: string }, output: { output: unknown }) => {
      try {
        const name = String((toolInput as { tool?: unknown }).tool ?? "unknown");
        const outText = String((output as { output?: unknown }).output ?? "").slice(0, 500);
        const last = activity[activity.length - 1];
        if (last !== undefined && last.tool === name && last.outputExcerpt === undefined) {
          last.outputExcerpt = outText;
        } else {
          recordActivity({ tool: name, argsText: "", outputExcerpt: outText });
        }
      } catch {
        // Never break the agent loop.
      }
    }) as never,

    "experimental.chat.messages.transform": (async (_in: Record<string, never>, output: { messages: { info: { role?: string }; parts: Record<string, unknown>[] }[] }) => {
      try {
        const out = output as { messages?: Array<{ parts?: Array<Record<string, unknown>> }> };
        if (!Array.isArray(out.messages)) return;
        let removed = 0;
        for (const msg of out.messages) {
          if (Array.isArray(msg.parts)) removed += scrubTextPartsInPlace(msg.parts);
        }
        messagesScrubbed = removed;
      } catch {
        // Never break the agent loop.
      }
    }) as never,

    "experimental.chat.system.transform": (async (_in: Record<string, never>, output: { system: string[] }) => {
      try {
        const out = output as { system?: string[] };
        if (!Array.isArray(out.system)) return;
        turn += 1;

        const { decision, source } = await loadDecision();
        const materialized = Array.isArray(decision.materialized) ? decision.materialized : [];
        const materializedIds = materialized.map((m) => m.id).sort();
        const eventId =
          typeof decision.eventId === "string" && decision.eventId.length > 0
            ? decision.eventId
            : `evt-plugin-${String(turn).padStart(3, "0")}`;

        // Eviction set: explicit runner list, else previous-minus-current ids.
        const evictedIds =
          Array.isArray(decision.evictedIds) && decision.evictedIds.length > 0
            ? [...decision.evictedIds].sort()
            : lastMaterializedIds.filter((id) => !materializedIds.includes(id)).sort();
        const probes =
          decision.evictedProbes !== undefined && typeof decision.evictedProbes === "object"
            ? evictedIds.map((id) => decision.evictedProbes?.[id]).filter((p): p is string => typeof p === "string")
            : [];

        const derivedEvent = deriveRoutingEvent(activity);
        const kernel = typeof decision.kernel === "string" && decision.kernel.length > 0 ? decision.kernel : KERNEL;
        // Overlay stability: when the materialized set is unchanged since the
        // last turn, skip the rewrite entirely (no scrub, no push). A "fresh"
        // identical block every turn reads as "re-plan" to the agent; silence
        // reads as "continue". Phase-carry note preserves continuity across
        // genuine changes without resetting the agent's mental model.
        const sameAsLast = lastMaterializedIds.length === materializedIds.length &&
          lastMaterializedIds.every((id, i) => id === materializedIds[i]);
        if (sameAsLast && turn > 1) {
          const skipLine: TurnLogLine = {
            turn,
            eventId,
            derivedEvent,
            materializedIds,
            evictedIds: [],
            decisionsSource: source,
            messagesScrubbed: 0,
            systemScrubbed: 0,
            unload: { evictedAbsent: true, leakedProbes: [], overlayCount: -1, exactlyOneOverlay: true },
            at: new Date().toISOString(),
          };
          lastMaterializedIds = materializedIds;
          messagesScrubbed = 0;
          activity.splice(0, activity.length);
          const skipLogPath = join(workspaceDir, TURN_LOG_REL_PATH);
          await mkdir(dirname(skipLogPath), { recursive: true }).catch(() => {});
          await appendFile(skipLogPath, `${JSON.stringify(skipLine)}\n`, "utf8").catch(() => {});
          return;
        }
        // Phase-carry continuity: on genuine change, name what survived so the
        // agent continues instead of restarting. Retained ids are still-active
        // constraints from prior phases; evicted ids are explicitly retired.
        const retained = lastMaterializedIds.filter((id) => materializedIds.includes(id));
        const carryNote = retained.length > 0
          ? `\n  [CONTINUITY still-active: ${retained.join(", ")}]`
          : "";
        const freshEntry = `${kernel}\n${buildFreshOverlay(eventId, materialized)}${carryNote}`;
        const systemScrubbed = applySystemOverlayInPlace(out.system, freshEntry);
        // Assertion over the emitted system list (the slice this hook owns).
        // Messages-slice scrub count is carried over from the messages hook.
        const unload = assertEmittedUnload(out.system, probes);

        const line: TurnLogLine = {
          turn,
          eventId,
          derivedEvent,
          materializedIds,
          evictedIds,
          decisionsSource: source,
          messagesScrubbed,
          systemScrubbed,
          unload,
          at: new Date().toISOString(),
        };
        lastMaterializedIds = materializedIds;
        messagesScrubbed = 0;
        activity.splice(0, activity.length);

        const logPath = join(workspaceDir, TURN_LOG_REL_PATH);
        await mkdir(dirname(logPath), { recursive: true }).catch(() => {});
        await appendFile(logPath, `${JSON.stringify(line)}\n`, "utf8").catch(() => {});
      } catch {
        // Never break the agent loop.
      }
    }) as never,
  };
};

// V1 path-plugin contract (opencode 1.18.31): a path plugin module MUST
// default-export { id, server } (PluginModule), NOT a bare setup function.
// A bare function fails with "Plugin export is not a function"; an object
// without id fails with "must export id". Verified against the live loader.
export default { id: "jev-single-session", server: JevSingleSession };
