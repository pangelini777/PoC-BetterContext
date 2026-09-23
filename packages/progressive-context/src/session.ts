// Progressive session: wires routing state, score backend, resolver, compiler,
// and the explicit request harness into one trajectory runner. Emits one
// TelemetryRecord per semantic event. Gold labels never enter this module.

import { createHash } from "node:crypto";
import type {
  Arm,
  EvidenceClass,
  ResourceDescriptor,
  ResourceTransition,
  RoutingState,
  ScoreSource,
  SemanticEvent,
  TelemetryRecord,
  ThresholdConfig,
} from "../../protocol/src/types.ts";
import { compileOverlay, ExplicitHarness, scrubOverlays } from "./compiler.ts";
import { LifecycleResolver } from "./resolver.ts";
import type { ScoreBackend } from "./router.ts";

export const KERNEL = [
  "This session uses a runtime-managed capability and policy context.",
  "Additional rules/skills may appear as the task changes.",
  "Treat currently supplied dynamic rules as authoritative for their scope.",
  "Do not assume unavailable package capabilities.",
].join("\n");

export interface SessionStepInput {
  kind: SemanticEvent["kind"];
  text: string;
  phase?: string;
  changedPaths?: string[];
}

export interface SessionResult {
  records: TelemetryRecord[];
  finalActive: string[];
  harness: ExplicitHarness;
}

function stateHash(s: RoutingState): string {
  return createHash("sha256")
    .update(JSON.stringify([s.goal, s.currentEvent.text, s.currentEvent.phase, s.activeResourceIds, s.changedPaths]))
    .digest("hex")
    .slice(0, 16);
}

export class ProgressiveSession {
  private resolver: LifecycleResolver;
  private loadAllActive: string[] = [];
  private harness = new ExplicitHarness(KERNEL);
  private seq = 0;
  private recent: SemanticEvent[] = [];
  // Build mode: classified once on turn 0 from the task goal, then locked
  // for the session (per-event flips would thrash lifetimes mid-build).
  private buildMode: boolean | null = null;
  private buildModeScore: number | null = null;
  constructor(
    private readonly opts: {
      runId: string;
      sessionId: string;
      arm: Arm;
      goal: string;
      catalogHash: string;
      bodies: Map<string, string>;
      rules: ResourceDescriptor[];
      skills: ResourceDescriptor[];
      byId: Map<string, ResourceDescriptor>;
      cfg: ThresholdConfig;
      backend: ScoreBackend;
      loadAllTokens: number;
    },
  ) {
    this.resolver = new LifecycleResolver(opts.byId, opts.cfg);
  }

  async runEvent(input: SessionStepInput): Promise<TelemetryRecord> {
    const event: SemanticEvent = {
      id: `evt-${String(this.seq).padStart(3, "0")}`,
      seq: this.seq,
      kind: input.kind,
      text: input.text,
      phase: input.phase,
      changedPaths: input.changedPaths,
    };
    const activeBefore = this.currentActive();
    const materializedBefore = [...activeBefore];

    const routingState: RoutingState = {
      sessionId: this.opts.sessionId,
      goal: this.opts.goal,
      currentEvent: event,
      recentEvents: [...this.recent],
      activeResourceIds: activeBefore,
      changedPaths: input.changedPaths ?? [],
    };

    let ruleScores: Map<string, { probability: number; source: ScoreSource }>;
    let selectedSkill: string | null;
    let skillSource: ScoreSource;
    let stage1: TelemetryRecord["skillStage1"] = null;
    let stage2: TelemetryRecord["skillStage2"] = null;
    let evidenceClass: EvidenceClass;
    let jevModel: string | null = null;
    let inTokens = 0;
    let outTokens = 0;
    let latencyMs = 0;
    let calls = 0;

    if (this.opts.arm === "load_all") {
      ruleScores = new Map(this.opts.rules.map((r) => [r.id, { probability: 1, source: "load_all" as ScoreSource }]));
      selectedSkill = null; // load_all materializes every skill body; no single selection.
      skillSource = "load_all";
      evidenceClass = "load_all";
    } else {
      const routed = await this.opts.backend.route(
        routingState,
        this.opts.rules,
        this.opts.skills,
        this.opts.bodies,
        {
          topK: this.opts.cfg.skills.topK,
          gateThreshold: this.opts.cfg.skills.gateThreshold,
          fitsThreshold: this.opts.cfg.skills.fitsThreshold,
          shortlistMin: this.opts.cfg.skills.shortlistMin,
        },
      );
      ruleScores = routed.ruleScores;
      selectedSkill = routed.selectedSkill;
      skillSource = routed.skillSource;
      stage1 = routed.stage1;
      stage2 = routed.stage2;
      evidenceClass = routed.evidenceClass;
      jevModel = routed.jevModel;
      inTokens = routed.inputTokens;
      outTokens = routed.outputTokens;
      latencyMs = routed.latencyMs;
      calls = routed.calls;
      // Lock build mode on the first routed event; later events reuse it.
      if (this.buildMode === null) {
        this.buildMode = routed.buildMode;
        this.buildModeScore = routed.buildModeScore;
      }
    }

    let transitions: ResourceTransition[];
    let activeAfter: string[];
    let materializedAfter: string[];
    let added: string[];
    let retained: string[];
    let removed: string[];

    if (this.opts.arm === "load_all") {
      const all = [...this.opts.rules.map((r) => r.id), ...this.opts.skills.map((s) => s.id)].sort();
      transitions = all
        .filter((id) => !activeBefore.includes(id))
        .map((id) => ({ resourceId: id, from: "none" as const, to: "materialized" as const, reason: "baseline_activate", semanticEventId: event.id }));
      activeAfter = all;
      materializedAfter = all;
      added = transitions.map((t) => t.resourceId);
      retained = activeBefore.filter((id) => all.includes(id));
      removed = [];
      this.loadAllActive = all;
    } else if (event.kind === "completion") {
      const retired = this.resolver.complete(event);
      transitions = retired;
      activeAfter = [];
      materializedAfter = [];
      added = [];
      retained = [];
      removed = retired.filter((t) => t.to === "retired" && t.from === "materialized").map((t) => t.resourceId);
    } else {
      const step = this.buildMode === true
        ? this.resolver.stepSticky(event, ruleScores, selectedSkill, skillSource)
        : this.resolver.step(event, ruleScores, selectedSkill, skillSource);
      transitions = step.transitions;
      activeAfter = step.activeAfter;
      materializedAfter = step.materializedAfter;
      added = step.added;
      retained = step.retained;
      removed = step.removed;
    }

    const sourcePaths = new Map<string, string>();
    for (const [id, d] of this.opts.byId) sourcePaths.set(id, d.sourcePath);
    const compiled = compileOverlay(materializedAfter, this.opts.bodies, event.id, sourcePaths);
    compiled.kernel = KERNEL;
    const effective = this.harness.step(event.id, event.text, compiled);
    void effective;

    // Sentinel assertion: every materialized body present; every non-materialized
    // catalog body absent from THIS request's effective context.
    const sentinelAssertions: TelemetryRecord["sentinelAssertions"] = [];
    const ctx = this.harness.effectiveContext(this.harness.requestCount() - 1);
    for (const id of materializedAfter) {
      const body = this.opts.bodies.get(id)!;
      const probe = body.slice(0, 60);
      sentinelAssertions.push({ name: `materialized:${id}`, pass: ctx.includes(probe), detail: `sha ${this.opts.byId.get(id)!.bodySha256.slice(0, 12)}` });
    }
    // Spot-check removed resources for absence (full check would bloat telemetry;
    // the dedicated sentinel test asserts exhaustively).
    for (const id of removed) {
      const body = this.opts.bodies.get(id)!;
      const probe = body.slice(0, 60);
      sentinelAssertions.push({ name: `dematerialized:${id}`, pass: !ctx.includes(probe) });
    }

    const transitionReasons: Record<string, string> = {};
    for (const t of transitions) transitionReasons[t.resourceId] = t.reason;

    const record: TelemetryRecord = {
      runId: this.opts.runId,
      sessionId: this.opts.sessionId,
      arm: this.opts.arm,
      semanticEventId: event.id,
      semanticEventSeq: event.seq,
      phase: event.phase,
      providerEvidenceClass: evidenceClass,
      jevModel,
      catalogHash: this.opts.catalogHash,
      stateHash: stateHash(routingState),
      ruleScores: Object.fromEntries([...ruleScores].map(([k, v]) => [k, v.probability])),
      skillStage1: stage1,
      skillStage2: stage2,
      activeBefore,
      activeAfter,
      materializedBefore,
      materializedAfter,
      added,
      retained,
      removed,
      transitionReasons,
      compiledOverlaySha256: compiled.overlaySha256,
      compiledResourceTokens: compiled.resourceTokenEstimate,
      loadAllResourceTokens: this.opts.loadAllTokens,
      providerInputTokens: inTokens,
      providerOutputTokens: outTokens,
      providerLatencyMs: latencyMs,
      providerCalls: calls,
      scrubbedOverlayCount: this.harness.lastScrubbedCount(),
      sentinelAssertions,
      createdAt: new Date().toISOString(),
    };

    this.recent.push(event);
    this.seq += 1;
    return record;
  }

  private currentActive(): string[] {
    if (this.opts.arm === "load_all") return [...this.loadAllActive];
    const snap = this.resolver.snapshot();
    return Object.entries(snap)
      .filter(([, v]) => v.status === "materialized" || v.status === "active")
      .map(([id]) => id)
      .sort();
  }

  getHarness(): ExplicitHarness {
    return this.harness;
  }

  scrubCount(text: string): number {
    return scrubOverlays(text).removedCount;
  }
}
