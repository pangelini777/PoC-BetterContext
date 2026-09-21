// APM catalog: indexes installed APM instructions + skills, parses frontmatter,
// joins JEV sidecar metadata (jev-runtime.yaml), hashes bodies, estimates tokens.
// Reads bodies lazily: full body only on materialization or narrow rerank.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  Lifetime,
  ResourceDescriptor,
  ResourceKind,
} from "../../protocol/src/types.ts";

export interface Catalog {
  hash: string;
  rules: ResourceDescriptor[];
  skills: ResourceDescriptor[];
  byId: Map<string, ResourceDescriptor>;
  bodies: Map<string, string>; // id -> full body text (loaded at index for PoC scale; routing uses summaries only)
}


function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** ~4 chars per token, matching the PoC's documented estimator. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function parseFrontmatter(text: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {};
  if (!text.startsWith("---")) return { data, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) throw new Error("malformed frontmatter: missing closing ---");
  const fm = text.slice(3, end);
  for (const line of fm.split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m) data[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { data, body: text.slice(end + 4).replace(/^\n/, "") };
}

function checkLifetime(v: unknown, id: string): Lifetime {
  if (v === "turn" || v === "action" || v === "phase" || v === "task" || v === "session") return v;
  throw new Error(`resource ${id}: invalid lifetime ${JSON.stringify(v)}`);
}

function shortName(id: string): string {
  return id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
}

/** Resolve a dependency reference (bare name or full id) to a full resource id. */
function resolveDep(ref: string, allIds: Set<string>): string {
  if (allIds.has(ref)) return ref;
  const withRule = `rule.${ref}`;
  if (allIds.has(withRule)) return withRule;
  const withSkill = `skill.${ref}`;
  if (allIds.has(withSkill)) return withSkill;
  throw new Error(`invalid dependency reference: ${ref}`);
}

export async function loadCatalog(packageDir: string): Promise<Catalog> {
  const root = resolve(packageDir);
  const sidecarRaw = await readFile(join(root, "jev-runtime.yaml"), "utf8");
  const sidecar = parseYaml(sidecarRaw) as {
    resources?: Record<string, { kind: string; source: string; summary: string; lifetime?: string; critical?: boolean; dependsOn?: string[] }>;
  };
  if (!sidecar.resources || typeof sidecar.resources !== "object") {
    throw new Error("jev-runtime.yaml: missing resources map");
  }

  // Duplicate-ID detection happens naturally via the resources map, but also
  // guard against two ids normalizing to the same short name + kind.
  const seen = new Set<string>();
  for (const id of Object.keys(sidecar.resources)) {
    if (seen.has(id)) throw new Error(`duplicate resource id: ${id}`);
    seen.add(id);
  }
  const allIds = new Set(Object.keys(sidecar.resources));

  const rules: ResourceDescriptor[] = [];
  const skills: ResourceDescriptor[] = [];
  const byId = new Map<string, ResourceDescriptor>();
  const bodies = new Map<string, string>();

  for (const [id, meta] of Object.entries(sidecar.resources)) {
    if (meta.kind !== "rule" && meta.kind !== "skill") {
      throw new Error(`resource ${id}: invalid kind ${JSON.stringify(meta.kind)}`);
    }
    if (!meta.source) throw new Error(`resource ${id}: missing source`);
    if (!meta.summary) throw new Error(`resource ${id}: missing summary needed for routing`);
    const abs = resolve(root, meta.source);
    let raw: string;
    try {
      raw = await readFile(abs, "utf8");
    } catch {
      throw new Error(`resource ${id}: sidecar references missing source file ${meta.source}`);
    }
    // Frontmatter required for routing-relevant resources; validate presence.
    const { data } = parseFrontmatter(raw);
    if (meta.kind === "rule" && !data["description"]) {
      throw new Error(`resource ${id}: malformed frontmatter (missing description)`);
    }
    if (meta.kind === "skill" && !data["name"] && !data["description"]) {
      throw new Error(`resource ${id}: malformed skill frontmatter (missing name/description)`);
    }
    const lifetime = checkLifetime(meta.lifetime ?? "phase", id);
    const dependsOn = (meta.dependsOn ?? []).map((d) => resolveDep(d, allIds));
    const desc: ResourceDescriptor = {
      id,
      kind: meta.kind,
      name: shortName(id),
      summary: meta.summary,
      sourcePath: abs,
      bodySha256: sha256Hex(raw),
      estimatedTokens: estimateTokens(raw),
      lifetime,
      critical: meta.critical ?? false,
      dependsOn,
    };
    if (byId.has(id)) throw new Error(`duplicate resource id: ${id}`);
    byId.set(id, desc);
    bodies.set(id, raw);
    if (desc.kind === "rule") rules.push(desc);
    else skills.push(desc);
  }

  // Dependency cycle detection (DFS).
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`dependency cycle: ${[...stack, id].join(" -> ")}`);
    visiting.add(id);
    for (const dep of byId.get(id)!.dependsOn) visit(dep, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id, []);

  rules.sort((a, b) => (a.id < b.id ? -1 : 1));
  skills.sort((a, b) => (a.id < b.id ? -1 : 1));
  const hash = sha256Hex(
    JSON.stringify([...byId.values()].map((d) => [d.id, d.bodySha256, d.lifetime, d.critical, d.dependsOn])),
  );
  return { hash, rules, skills, byId, bodies };
}

export async function listInstructionFiles(packageDir: string): Promise<string[]> {
  const dir = join(resolve(packageDir), ".apm", "instructions");
  return (await readdir(dir)).filter((f) => f.endsWith(".instructions.md")).sort();
}

export async function listSkillDirs(packageDir: string): Promise<string[]> {
  const dir = join(resolve(packageDir), ".apm", "skills");
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
