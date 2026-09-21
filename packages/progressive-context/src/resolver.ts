// Deterministic lifecycle resolver. JEV (or oracle/baseline/heuristic score
// sources) proposes fuzzy applicability; THIS code owns activation thresholds,
// hysteresis, dependencies, lifetimes, and transitions. It never calls a model.

import type {
  ResourceDescriptor,
  ResourceStatus,
  ResourceTransition,
  ScoreSource,
  SemanticEvent,
  ThresholdConfig,
} from "../../protocol/src/types.ts";

export interface ScoreInput {
  probability: number;
  source: ScoreSource;
}

export interface ResolverStep {
  transitions: ResourceTransition[];
  activeAfter: string[];
  materializedAfter: string[];
  added: string[];
  retained: string[];
  removed: string[];
}

interface Entry {
  status: ResourceStatus | "none";
  belowStreak: number;
  activePhase?: string;
}

function activateThreshold(cfg: ThresholdConfig, d: ResourceDescriptor): number {
  return d.critical ? cfg.rules.activateCritical : cfg.rules.activate;
}

/** Streak of consecutive below-unload scores required before removal. */
function requiredStreak(
  cfg: ThresholdConfig,
  d: ResourceDescriptor,
  phaseChanged: boolean,
): number {
  if (d.lifetime === "task" || d.lifetime === "session") return Number.POSITIVE_INFINITY;
  if (d.lifetime === "turn" || d.lifetime === "action") return 1;
  // phase: sticky within a phase, normal hysteresis across a phase change.
  return phaseChanged ? cfg.rules.unloadStreakRequired : cfg.rules.unloadStreakRequired + 1;
}

export class LifecycleResolver {
  private entries = new Map<string, Entry>();
  private lastPhase: string | undefined;

  constructor(
    private readonly catalog: Map<string, ResourceDescriptor>,
    private readonly cfg: ThresholdConfig,
  ) {}

  reset(): void {
    this.entries.clear();
    this.lastPhase = undefined;
  }

  /** Completion/finalization retires everything still active. */
  complete(event: SemanticEvent): ResourceTransition[] {
    const out: ResourceTransition[] = [];
    for (const [id, e] of [...this.entries].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (e.status === "materialized" || e.status === "active") {
        out.push({ resourceId: id, from: e.status, to: "retired", reason: "completion_retire", semanticEventId: event.id });
        e.status = "retired";
      } else if (e.status === "dematerialized") {
        out.push({ resourceId: id, from: e.status, to: "retired", reason: "completion_retire", semanticEventId: event.id });
        e.status = "retired";
      }
    }
    return out;
  }

  step(
    event: SemanticEvent,
    scores: Map<string, ScoreInput>,
    selectedSkill: string | null,
    skillSource: ScoreSource,
  ): ResolverStep {
    const transitions: ResourceTransition[] = [];
    const phaseChanged = this.lastPhase !== undefined && event.phase !== this.lastPhase;
    this.lastPhase = event.phase;

    const activateReason = (s: ScoreSource): string =>
      s === "system_one" ? "jev_activate"
      : s === "oracle" ? "oracle_activate"
      : s === "load_all" ? "baseline_activate"
      : s === "static_initial" ? "static_activate"
      : s === "dependency" ? "dependency_activate"
      : "failopen_activate";

    // 1. Rules: hysteresis state machine.
    const ruleIds = [...this.catalog.values()].filter((d) => d.kind === "rule").map((d) => d.id).sort();
    for (const id of ruleIds) {
      const d = this.catalog.get(id)!;
      const s = scores.get(id) ?? { probability: 0, source: "system_one" as ScoreSource };
      const p = Math.min(1, Math.max(0, s.probability));
      const e = this.entries.get(id) ?? { status: "none" as const, belowStreak: 0 };
      this.entries.set(id, e);
      const cur: ResourceStatus | "none" = e.status;
      const isActive = cur === "materialized" || cur === "active";
      if (!isActive && p >= activateThreshold(this.cfg, d)) {
        transitions.push({ resourceId: id, from: cur, to: "materialized", reason: activateReason(s.source), score: p, semanticEventId: event.id });
        e.status = "materialized";
        e.belowStreak = 0;
        e.activePhase = event.phase;
      } else if (isActive && p >= this.cfg.rules.retain) {
        const stay = cur as ResourceStatus;
        transitions.push({ resourceId: id, from: stay, to: stay, reason: "retain", score: p, semanticEventId: event.id });
        e.belowStreak = 0;
      } else if (isActive && p >= this.cfg.rules.unload) {
        const stay = cur as ResourceStatus;
        // Hysteresis middle band: retain without touching the streak.
        transitions.push({ resourceId: id, from: stay, to: stay, reason: "retain_hysteresis_middle", score: p, semanticEventId: event.id });
      } else if (isActive) {
        const stay = cur as ResourceStatus;
        e.belowStreak += 1;
        if (e.belowStreak >= requiredStreak(this.cfg, d, phaseChanged)) {
          transitions.push({ resourceId: id, from: stay, to: "dematerialized", reason: "jev_unload_hysteresis", score: p, semanticEventId: event.id });
          e.status = "dematerialized";
          e.belowStreak = 0;
        } else {
          transitions.push({ resourceId: id, from: stay, to: stay, reason: "retain_pending_unload_streak", score: p, semanticEventId: event.id });
        }
      }
      // inactive + below activation: no transition, stays out.
    }

    // 2. Skills: turn-lifetime single selection. Selected skill materializes;
    //    any previously materialized different skill dematerializes.
    const skillIds = [...this.catalog.values()].filter((d) => d.kind === "skill").map((d) => d.id).sort();
    const prevSkill = skillIds.find((id) => {
      const st = this.entries.get(id)?.status;
      return st === "materialized" || st === "active" || st === "invoked";
    });
    if (selectedSkill) {
      if (prevSkill !== selectedSkill) {
        if (prevSkill) {
          const pe = this.entries.get(prevSkill)!;
          transitions.push({ resourceId: prevSkill, from: pe.status, to: "dematerialized", reason: "skill_superseded", semanticEventId: event.id });
          pe.status = "dematerialized";
          pe.belowStreak = 0;
        }
        const se = this.entries.get(selectedSkill) ?? { status: "none" as const, belowStreak: 0 };
        this.entries.set(selectedSkill, se);
        transitions.push({ resourceId: selectedSkill, from: se.status, to: "materialized", reason: activateReason(skillSource), semanticEventId: event.id });
        se.status = "materialized";
        se.belowStreak = 0;
      } else {
        const se = this.entries.get(selectedSkill)!;
        const stay = se.status as ResourceStatus;
        transitions.push({ resourceId: selectedSkill, from: stay, to: stay, reason: "retain", semanticEventId: event.id });
      }
    } else if (prevSkill) {
      const pe = this.entries.get(prevSkill)!;
      transitions.push({ resourceId: prevSkill, from: pe.status, to: "dematerialized", reason: "skill_deselected", semanticEventId: event.id });
      pe.status = "dematerialized";
      pe.belowStreak = 0;
    }

    // 3. Dependency closure: an active resource keeps its deps active.
    //    Iterates to a fixed point for transitive chains.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, e] of this.entries) {
        if (e.status !== "materialized" && e.status !== "active") continue;
        const d = this.catalog.get(id);
        if (!d) continue;
        for (const dep of d.dependsOn) {
          const de = this.entries.get(dep) ?? { status: "none" as const, belowStreak: 0 };
          this.entries.set(dep, de);
          if (de.status !== "materialized" && de.status !== "active") {
            transitions.push({ resourceId: dep, from: de.status, to: "materialized", reason: "dependency_activate", semanticEventId: event.id });
            de.status = "materialized";
            de.belowStreak = 0;
            changed = true;
          } else if (de.belowStreak > 0) {
            de.belowStreak = 0;
            transitions.push({ resourceId: dep, from: de.status, to: de.status, reason: "dependency_retain", semanticEventId: event.id });
          }
        }
      }
    }

    const activeAfter = [...this.entries]
      .filter(([, e]) => e.status === "materialized" || e.status === "active")
      .map(([id]) => id)
      .sort();
    // P0: active and materialized are aligned; the distinction is reserved for
    // task-lifetime body-on-demand support.
    const materializedAfter = [...activeAfter];
    const added = transitions.filter((t) => t.to === "materialized" && (t.from === "none" || t.from === "dematerialized" || t.from === "retired")).map((t) => t.resourceId);
    const removed = transitions.filter((t) => t.to === "dematerialized").map((t) => t.resourceId);
    const retained = transitions.filter((t) => t.to === t.from && (t.to === "materialized" || t.to === "active")).map((t) => t.resourceId);
    return { transitions, activeAfter, materializedAfter, added, retained, removed };
  }

  snapshot(): Record<string, { status: string; belowStreak: number }> {
    return Object.fromEntries([...this.entries].map(([id, e]) => [id, { status: e.status, belowStreak: e.belowStreak }]));
  }
}
