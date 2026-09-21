// Provenance guard: rejects any resolved benchmark path that enters a sibling
// project root (agentOpt or other checkouts). Called by every eval entrypoint.

import { resolve } from "node:path";

const FORBIDDEN_SEGMENTS = ["agentOpt", "betterContext-backup", "sibling"];

export function assertProvenance(paths: Record<string, string>): void {
  for (const [label, p] of Object.entries(paths)) {
    const r = resolve(p);
    const parts = r.split("/");
    for (const seg of FORBIDDEN_SEGMENTS) {
      if (parts.includes(seg)) {
        throw new Error(`provenance violation: ${label} resolves into forbidden segment ${seg}: ${r}`);
      }
    }
    if (r.includes("../agentOpt") || r.endsWith("/agentOpt")) {
      throw new Error(`provenance violation: ${label} points into ../agentOpt: ${r}`);
    }
  }
}

export function provenanceReport(paths: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, p] of Object.entries(paths)) out[k] = resolve(p);
  return out;
}
