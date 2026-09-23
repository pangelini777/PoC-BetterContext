// Context compiler + scrubber + explicit request-construction harness.
// The compiler is the proof surface: deterministic overlay assembly, idempotent
// removal of stale overlays, and exactly-once current-overlay insertion.
// The harness assembles each model request itself, so unload claims rest on
// observed request bytes rather than harness internals.

import { createHash } from "node:crypto";
import { OVERLAY_CLOSE, OVERLAY_OPEN, overlayOpenTag } from "../../protocol/src/types.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface CompiledContext {
  kernel: string;
  dynamicOverlay: string;
  materializedResourceIds: string[];
  resourceTokenEstimate: number;
  overlaySha256: string;
}

const OVERLAY_BLOCK_RE = /<jev-apm-context\b[^>]*>[\s\S]*?<\/jev-apm-context>/g;
const STRAY_TAG_RE = /<\/?jev-apm-context\b[^>]*>/g;

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Idempotent: removes every complete overlay block plus stray markers. */
export function scrubOverlays(text: string): { scrubbed: string; removedCount: number } {
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

export function countOverlays(text: string): number {
  return text.match(OVERLAY_BLOCK_RE)?.length ?? 0;
}

export function compileOverlay(
  materializedIds: string[],
  bodies: Map<string, string>,
  eventId: string,
  sourcePaths?: Map<string, string>,
): CompiledContext {
  const ids = [...materializedIds].sort();
  const parts: string[] = [];
  let resourceTokenEstimate = 0;
  for (const id of ids) {
    const body = bodies.get(id);
    if (body === undefined) throw new Error(`compileOverlay: missing body for ${id}`);
    const kind = id.startsWith("skill.") ? "skill" : "rule";
    const short = id.slice(id.indexOf(".") + 1);
    const kindTag = kind === "skill" ? "[SKILL — procedure, how to do it]" : "[RULE — constraint, what must hold]";
    // sourcePath grounds the agent: bodies carry what, the path carries where.
    // The descriptor map is threaded via an optional side table (see below).
    const where = sourcePaths?.get(id) ?? "";
    const whereLine = where !== "" ? `\n  [LOCATION ${where}]` : "";
    resourceTokenEstimate += Math.max(1, Math.ceil(body.length / 4));
    parts.push(`  <${kind} id="${id}" name="${short}" sha256="${sha256Hex(body)}">\n  ${kindTag}${whereLine}\n${body}\n  </${kind}>`);
  }
  const dynamicOverlay =
    ids.length === 0
      ? `${overlayOpenTag(eventId)}\n${OVERLAY_CLOSE}`
      : `${overlayOpenTag(eventId)}\n${parts.join("\n")}\n${OVERLAY_CLOSE}`;
  return {
    kernel: "",
    dynamicOverlay,
    materializedResourceIds: ids,
    resourceTokenEstimate,
    overlaySha256: sha256Hex(dynamicOverlay),
  };
}

/**
 * Authoritative request path. Owns the message list: every step scrubs ALL
 * historical contents (system included), then appends exactly one fresh system
 * entry carrying kernel + current overlay, plus the new user event.
 * effectiveContext(step) is the exact bytes the model would receive.
 */
export class ExplicitHarness {
  private messages: ChatMessage[] = [];
  private effectiveRequests: string[] = [];
  private scrubbedCounts: number[] = [];

  constructor(private readonly kernel: string) {}

  step(eventId: string, eventText: string, compiled: CompiledContext): string {
    let scrubbedTotal = 0;
    const cleanHistory: ChatMessage[] = [];
    for (const m of this.messages) {
      const { scrubbed, removedCount } = scrubOverlays(m.content);
      scrubbedTotal += removedCount;
      // Drop now-empty prior system overlays entirely; keep the rest.
      if (m.role === "system" && scrubbed.trim().length === 0) continue;
      cleanHistory.push({ role: m.role, content: scrubbed });
    }
    const systemContent =
      compiled.materializedResourceIds.length === 0
        ? this.kernel
        : `${this.kernel}\n${compiled.dynamicOverlay}`;
    this.messages = [
      { role: "system", content: systemContent },
      ...cleanHistory.filter((m) => m.role !== "system" || m.content.trim().length > 0),
      { role: "user", content: eventText },
    ];
    // Collapse duplicate systems: only the fresh one survives (it is first).
    this.messages = [this.messages[0], ...this.messages.slice(1).filter((m) => m.role !== "system")];
    const effective = this.messages.map((m) => `<${m.role}>\n${m.content}`).join("\n");
    this.effectiveRequests.push(effective);
    this.scrubbedCounts.push(scrubbedTotal);
    void eventId;
    return effective;
  }

  effectiveContext(stepIndex: number): string {
    const s = this.effectiveRequests[stepIndex];
    if (s === undefined) throw new Error(`no effective request at step ${stepIndex}`);
    return s;
  }

  lastScrubbedCount(): number {
    return this.scrubbedCounts[this.scrubbedCounts.length - 1] ?? 0;
  }

  requestCount(): number {
    return this.effectiveRequests.length;
  }

  containsInStep(stepIndex: number, needle: string): boolean {
    return this.effectiveContext(stepIndex).includes(needle);
  }
}

export { OVERLAY_CLOSE, OVERLAY_OPEN };
