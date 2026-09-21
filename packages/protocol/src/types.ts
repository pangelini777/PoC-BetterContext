// Shared protocol types for the JEV/APM progressive-context PoC.
// No runtime dependencies. Validation helpers are hand-rolled to keep the
// experiment self-contained.

export type ResourceKind = "rule" | "skill";

export type ResourceStatus =
  | "installed"
  | "indexed"
  | "candidate"
  | "active"
  | "exposed"
  | "materialized"
  | "invoked"
  | "dematerialized"
  | "retired";

export type Lifetime = "turn" | "action" | "phase" | "task" | "session";

export interface ResourceDescriptor {
  id: string; // e.g. "rule.payments-card-data" or "skill.stripe-webhook-handler"
  kind: ResourceKind;
  name: string; // short name without prefix, e.g. "payments-card-data"
  summary: string;
  sourcePath: string; // absolute path to the body file
  bodySha256: string;
  estimatedTokens: number;
  lifetime: Lifetime;
  critical: boolean;
  dependsOn: string[]; // resolved full resource ids
}

export type SemanticEventKind =
  | "user_message"
  | "plan_or_phase_change"
  | "observation"
  | "before_high_impact_action"
  | "verification"
  | "completion";

export interface SemanticEvent {
  id: string;
  seq: number;
  kind: SemanticEventKind;
  text: string;
  phase?: string;
  changedPaths?: string[];
}

export interface RoutingState {
  sessionId: string;
  goal: string;
  currentEvent: SemanticEvent;
  recentEvents: SemanticEvent[];
  activeResourceIds: string[];
  changedPaths: string[];
}

export type EvidenceClass =
  | "provider_backed"
  | "fail_open"
  | "load_all"
  | "static_initial"
  | "oracle";

export type ScoreSource =
  | "system_one"
  | "dependency"
  | "load_all"
  | "static_initial"
  | "oracle"
  | "heuristic_failopen";

export interface ResourceScore {
  resourceId: string;
  probability: number;
  source: ScoreSource;
}

export interface ResourceTransition {
  resourceId: string;
  from: ResourceStatus | "none";
  to: ResourceStatus;
  reason: string;
  score?: number;
  semanticEventId: string;
}

export interface ThresholdConfig {
  version: string;
  notes: string;
  rules: {
    activate: number;
    activateCritical: number;
    retain: number;
    unload: number;
    unloadStreakRequired: number;
  };
  skills: {
    topK: number;
    gateThreshold: number;
    fitsThreshold: number;
    shortlistMin: number;
  };
}

export type Arm = "load_all" | "static_initial" | "progressive_jev" | "oracle_dynamic";

export interface TelemetryRecord {
  runId: string;
  sessionId: string;
  arm: Arm;
  semanticEventId: string;
  semanticEventSeq: number;
  phase?: string;
  providerEvidenceClass: EvidenceClass;
  jevModel: string | null;
  catalogHash: string;
  stateHash: string;
  ruleScores: Record<string, number>;
  skillStage1: null | {
    choice: string | null;
    probabilities: Record<string, number>;
    gateScore: number;
    gatedOut: boolean;
    shortlist: string[];
  };
  skillStage2: null | {
    choice: string | null;
    probabilities: Record<string, number>;
    fits: Record<string, number>;
    selected: string | null;
  };
  activeBefore: string[];
  activeAfter: string[];
  materializedBefore: string[];
  materializedAfter: string[];
  added: string[];
  retained: string[];
  removed: string[];
  transitionReasons: Record<string, string>;
  compiledOverlaySha256: string;
  compiledResourceTokens: number;
  loadAllResourceTokens: number;
  providerInputTokens: number;
  providerOutputTokens: number;
  providerLatencyMs: number;
  providerCalls: number;
  scrubbedOverlayCount: number;
  sentinelAssertions: { name: string; pass: boolean; detail?: string }[];
  createdAt: string;
}

export interface ScenarioEvent {
  seq: number;
  kind: SemanticEventKind;
  text: string;
  phase?: string;
  // Evaluator-only gold labels. MUST never enter JEV state or agent prompts.
  gold_rules?: string[];
  gold_skill?: string | null;
}

export interface Scenario {
  id: string;
  description: string;
  events: ScenarioEvent[];
}

export const OVERLAY_OPEN = '<jev-apm-context version="1"';
export const OVERLAY_CLOSE = "</jev-apm-context>";

export function overlayOpenTag(eventId: string): string {
  return `<jev-apm-context version="1" event="${eventId}">`;
}

export function isProb(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}
export interface EventMetrics {
  rulePrecision: number;
  ruleRecall: number;
  criticalRecall: number;
  skillMatch: boolean;
  noSkillCorrect: boolean;
  materializedCount: number;
  dynTokens: number;
  staleTokens: number;
  missingTokens: number;
  staleRatio: number;
  missingRatio: number;
}
