// JEV semantic router: two-stage skill routing (TypeSafe cookbook pattern) +
// multi-label rule Nouls. JEV decides fuzzy relevance; the resolver owns
// thresholds/lifetimes/transitions. Gold labels must never reach this module:
// callers pass only RoutingState + catalog summaries/excerpts.

import type {
  EvidenceClass,
  ResourceDescriptor,
  RoutingState,
  ScoreSource,
} from "../../protocol/src/types.ts";
import { systemOne, type ChoiceAnswer } from "../../jev-client/src/client.ts";

export interface RuleScoreOut {
  probability: number;
  source: ScoreSource;
}

export interface SkillStage1Out {
  choice: string | null;
  probabilities: Record<string, number>;
  gateScore: number;
  gatedOut: boolean;
  shortlist: string[];
}

export interface SkillStage2Out {
  choice: string | null;
  probabilities: Record<string, number>;
  fits: Record<string, number>;
  selected: string | null;
}

export interface RouteOut {
  ruleScores: Map<string, RuleScoreOut>;
  selectedSkill: string | null;
  skillSource: ScoreSource;
  stage1: SkillStage1Out | null;
  stage2: SkillStage2Out | null;
  evidenceClass: EvidenceClass;
  jevModel: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  calls: number;
}

export interface BackendResult {
  ruleScores: Map<string, RuleScoreOut>;
  selectedSkill: string | null;
  skillSource: ScoreSource;
  stage1: SkillStage1Out | null;
  stage2: SkillStage2Out | null;
  evidenceClass: EvidenceClass;
  jevModel: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  calls: number;
}

/** Score backend: provider-backed System One, deterministic heuristic fallback, oracle, or canned mock. */
export interface ScoreBackend {
  readonly label: ScoreSource;
  route(
    state: RoutingState,
    rules: ResourceDescriptor[],
    skills: ResourceDescriptor[],
    bodies: Map<string, string>,
    opts: { topK: number; gateThreshold: number; fitsThreshold: number; shortlistMin: number },
  ): Promise<BackendResult>;
}

export function routingStateFor(
  state: RoutingState,
  rules: ResourceDescriptor[],
  skills: ResourceDescriptor[],
): Record<string, unknown> {
  void rules;
  void skills;
  return {
    goal: state.goal,
    phase: state.currentEvent.phase ?? null,
    currentEvent: state.currentEvent.text,
    eventKind: state.currentEvent.kind,
    changedPaths: state.changedPaths,
    recentEvidence: state.recentEvents.slice(-3).map((e) => e.text),
    currentlyActive: [...state.activeResourceIds].sort(),
  };
}

function ruleQuestion(summary: string, impliedBy: string[]): { type: "noul"; instructions: string; criteria: { true: string; false: string } } {
  const hint = impliedBy.length > 0 ? ` Note: this rule is a declared dependency of ${impliedBy.join(", ")}; if the current phase involves those, answer yes.` : "";
  return {
    type: "noul",
    instructions: `Is this rule needed now to constrain or guide correct execution of the current phase or immediate next action? Rule summary: ${summary}.${hint}`,
    criteria: {
      true: "The rule constrains or guides the current phase or immediate next action, including as a dependency of active work.",
      false: "The rule is irrelevant to the current phase or would add only stale context.",
    },
  };
}

export class SystemOneBackend implements ScoreBackend {
  readonly label: ScoreSource = "system_one";
  constructor(
    private readonly apiKey: string,
    private readonly model?: string,
    private readonly timeoutMs = 60_000,
  ) {}

  async route(
    state: RoutingState,
    rules: ResourceDescriptor[],
    skills: ResourceDescriptor[],
    bodies: Map<string, string>,
    opts: { topK: number; gateThreshold: number; fitsThreshold: number; shortlistMin: number },
  ): Promise<BackendResult> {
    const compact = routingStateFor(state, rules, skills);
    let inputTokens = 0;
    let outputTokens = 0;
    let latencyMs = 0;
    let calls = 0;
    let jevModel: string | null = null;

    // Pass 1: one Noul per rule + skill broad Choice + gating Nouls, single request.
    const questions: Record<string, { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } } | { type: "choice"; instructions: string; criteria: Record<string, string> }> = {};
    const impliedBy = new Map<string, string[]>();
    for (const r of rules) impliedBy.set(r.id, rules.filter((o) => o.dependsOn.includes(r.id)).map((o) => o.id));
    for (const r of rules) questions[`rule::${r.id}`] = ruleQuestion(r.summary, impliedBy.get(r.id) ?? []);
    const skillCriteria: Record<string, string> = {};
    for (const s of [...skills].sort((a, b) => (a.id < b.id ? -1 : 1))) skillCriteria[s.id] = s.summary;
    questions["which_skill"] = {
      type: "choice",
      instructions: "Which single skill procedure, if any, best fits the current phase or immediate next action? Use only the one-line summaries.",
      criteria: skillCriteria,
    };
    questions["acts_on_repo_or_system"] = {
      type: "noul",
      instructions: "Does the current phase require acting on the repository, system, or deployment (not just explaining)?",
    };
    questions["specialized_procedure_helpful"] = {
      type: "noul",
      instructions: "Would a specialized written procedure meaningfully help the immediate next action?",
    };
    questions["prose_only_suffices"] = {
      type: "noul",
      instructions: "Would a short prose answer suffice with no procedure, file change, or checklist?",
    };

    const pass1 = await systemOne(compact, questions as never, {
      apiKey: this.apiKey,
      model: this.model,
      timeoutMs: this.timeoutMs,
    });
    calls += 1;
    inputTokens += pass1.usage.input_tokens;
    outputTokens += pass1.usage.output_tokens;
    latencyMs += pass1.latencyMs;
    jevModel = pass1.model;

    const ruleScores = new Map<string, RuleScoreOut>();
    for (const r of rules) {
      const a = pass1.answers[`rule::${r.id}`];
      if (!a || a.type !== "noul") throw new Error(`missing rule answer for ${r.id}`);
      ruleScores.set(r.id, { probability: a.noul, source: "system_one" });
    }

    const choice = pass1.answers["which_skill"];
    if (!choice || choice.type !== "choice") throw new Error("missing which_skill answer");
    const g1 = pass1.answers["acts_on_repo_or_system"];
    const g2 = pass1.answers["specialized_procedure_helpful"];
    const g3 = pass1.answers["prose_only_suffices"];
    if (!g1 || g1.type !== "noul" || !g2 || g2.type !== "noul" || !g3 || g3.type !== "noul") {
      throw new Error("missing gate answers");
    }
    const gateScore = (g1.noul + g2.noul + (1 - g3.noul)) / 3;
    const gatedOut = gateScore < opts.gateThreshold;
    const ranked = Object.entries((choice as ChoiceAnswer).probabilities).sort(([, a], [, b]) => b - a);
    // shortlistMin: drop candidates below this absolute Choice mass before
    // taking topK, so a flat distribution cannot smuggle weak candidates into
    // stage-2 verification. Tested in test/router-gates.test.ts.
    const eligible = ranked.filter(([, p]) => p >= opts.shortlistMin);
    const shortlist = gatedOut ? [] : eligible.slice(0, opts.topK).map(([id]) => id);
    const stage1: SkillStage1Out = {
      choice: choice.choice,
      probabilities: (choice as ChoiceAnswer).probabilities,
      gateScore,
      gatedOut,
      shortlist,
    };

    // Pass 2: deep rerank over the shortlist with excerpts.
    let stage2: SkillStage2Out | null = null;
    let selectedSkill: string | null = null;
    let skillSource: ScoreSource = "system_one";
    if (!gatedOut && shortlist.length > 0) {
      const rerankCriteria: Record<string, string> = {};
      for (const id of shortlist) {
        const body = bodies.get(id) ?? "";
        rerankCriteria[id] = `${skills.find((s) => s.id === id)?.summary ?? id}\nExcerpt:\n${body.slice(0, 700)}`;
      }
      const q2: Record<string, never> = {
        which_skill: {
          type: "choice",
          instructions: "Which one of these shortlisted skills best fits the current phase or immediate next action, given their fuller descriptions?",
          criteria: rerankCriteria,
        } as never,
      };
      for (const id of shortlist) {
        q2[`fits::${id}`] = {
          type: "noul",
          instructions: `Does this skill procedure fit the current phase or immediate next action well enough to load? Skill: ${id}.`,
        } as never;
      }
      const pass2 = await systemOne(compact, q2 as never, {
        apiKey: this.apiKey,
        model: this.model,
        timeoutMs: this.timeoutMs,
      });
      calls += 1;
      inputTokens += pass2.usage.input_tokens;
      outputTokens += pass2.usage.output_tokens;
      latencyMs += pass2.latencyMs;
      jevModel = pass2.model;
      const c2 = pass2.answers["which_skill"];
      if (!c2 || c2.type !== "choice") throw new Error("missing stage-2 choice");
      const fits: Record<string, number> = {};
      for (const id of shortlist) {
        const f = pass2.answers[`fits::${id}`];
        if (!f || f.type !== "noul") throw new Error(`missing fit answer for ${id}`);
        fits[id] = f.noul;
      }
      const bestFit = Math.max(...shortlist.map((id) => fits[id]));
      // Selection semantics: the absolute fit Noul decides (it answers "is
      // this procedure good enough to load?"); the Choice breaks ties and
      // orders near-equal fits. A Choice winner that fails its own fit gate
      // is NOT selected — but unlike the old logic, the best-fitting
      // candidate IS selected instead of selecting nothing.
      let selected: string | null = null;
      if (bestFit >= opts.fitsThreshold) {
        const byFit = [...shortlist].sort((a, b) => fits[b] - fits[a] || (c2.probabilities[b] ?? 0) - (c2.probabilities[a] ?? 0));
        selected = byFit[0];
      }
      stage2 = { choice: c2.choice, probabilities: c2.probabilities, fits, selected };
      selectedSkill = selected;
      void skillSource;
    }

    return {
      ruleScores,
      selectedSkill,
      skillSource: "system_one",
      stage1,
      stage2,
      evidenceClass: "provider_backed",
      jevModel,
      inputTokens,
      outputTokens,
      latencyMs,
      calls,
    };
  }
}

/**
 * Documented fail-open fallback. Keyword overlap between the compact routing
 * state and per-resource keyword sets. NEVER provider-backed evidence; used
 * only when the TypeSafe provider is unavailable so the pipeline (lifecycle,
 * dematerialization, context-health proofs) can still be exercised.
 */
const FALLBACK_KEYWORDS: Record<string, string[]> = {
  "rule.accessibility-ui": ["accessib", "keyboard", "focus", "screen reader", "aria", "button label", "dialog", "cart page", "checkout button"],
  "rule.brand-ui-copy": ["copy", "label", "button text", "brand", "wording", "proceed to payment", "buy now", "customer-facing"],
  "rule.api-error-contract": ["route handler", "status code", "400", "502", "validation", "error response", "endpoint", "checkout route", "api"],
  "rule.auth-session-security": ["oauth", "login", "redirect", "session", "cookie", "token", "auth"],
  "rule.privacy-personal-data": ["email", "address", "personal data", "shipping_email", "shipping_address", "customer", "pii", "names"],
  "rule.payments-card-data": ["stripe", "checkout", "payment", "card", "charge", "price", "webhook", "payout"],
  "rule.database-migration-safety": ["migration", "schema", "column", "backfill", "ddl", "orders table", "deploy ordering"],
  "rule.logging-sensitive-data": ["log", "secret", "payload", "personal data", "payment payload"],
  "rule.webhook-idempotency": ["webhook", "signature", "duplicate", "idempoten", "replay", "retry-safe", "delivery"],
  "rule.public-docs-branding": ["docs ", "openapi", "documentation", "changelog", "public api", "example data"],
  "rule.production-change-control": ["production", "release", "deploy", "checklist", "rollback", "preflight", "monitoring"],
  "rule.testing-quality-gates": ["test", "regression", "verification", "failure path", "quality gate"],
  "rule.mobile-ios-guidelines": ["ios", "swiftui", "swift", "apple", "xcode"],
  "rule.ml-model-governance": ["ml model", "machine-learning", "training", "dataset", "model governance", "baseline metric"],
  "skill.react-ui-component": ["button", "component", "cart page", "ui", "checkout button", "page"],
  "skill.accessibility-audit": ["accessib", "keyboard", "audit", "screen reader"],
  "skill.brand-copy-review": ["copy", "label", "wording", "brand"],
  "skill.nextjs-api-route": ["route handler", "next.js", "endpoint"],
  "skill.postgres-schema-migration": ["migration", "schema", "column", "backfill", "orders table"],
  "skill.postgres-readonly-query": ["investigat", "duplicate orders", "read-only", "query behavior", "without changing", "do not modify"],
  "skill.stripe-checkout-session": ["checkout session", "create", "server checkout route", "price/order", "redirect url"],
  "skill.stripe-webhook-handler": ["webhook", "signature", "duplicate", "delivery", "fulfillment"],
  "skill.oauth-login": ["oauth", "login", "redirect"],
  "skill.test-plan-generator": ["test plan", "regression", "verification"],
  "skill.production-deploy-checklist": ["release checklist", "production", "deploy"],
  "skill.openapi-contract-update": ["openapi", "docs", "documentation"],
  "skill.ios-swiftui-component": ["ios", "swiftui", "swift", "apple"],
  "skill.ml-evaluation": ["ml model", "machine-learning", "evaluation", "dataset"],
};

function fallbackHit(text: string, keywords: string[]): number {
  const t = text.toLowerCase();
  let hits = 0;
  for (const k of keywords) if (t.includes(k.toLowerCase())) hits += 1;
  return hits;
}

export class HeuristicBackend implements ScoreBackend {
  readonly label: ScoreSource = "heuristic_failopen";
  async route(
    state: RoutingState,
    rules: ResourceDescriptor[],
    skills: ResourceDescriptor[],
    _bodies: Map<string, string>,
    opts: { topK: number; gateThreshold: number; fitsThreshold: number; shortlistMin: number },
  ): Promise<BackendResult> {
    // Current event dominates (mirrors the JEV "needed NOW" instruction);
    // goal/recent evidence contributes only a capped bonus so stale phases decay.
    const currentText = [state.currentEvent.text, state.currentEvent.phase ?? ""].join("\n");
    const backgroundText = [state.goal, ...state.recentEvents.slice(-2).map((e) => e.text)].join("\n");
    const ruleScores = new Map<string, RuleScoreOut>();
    for (const r of rules) {
      const keywords = FALLBACK_KEYWORDS[r.id] ?? [r.summary.toLowerCase().slice(0, 20)];
      const currentHits = fallbackHit(currentText, keywords);
      const backgroundHits = fallbackHit(backgroundText, keywords);
      const hits = currentHits >= 2 ? 3 : currentHits === 1 ? (backgroundHits >= 1 ? 2 : 1) : 0;
      const p = hits >= 2 ? 0.9 : hits === 1 ? 0.55 : 0.05;
      ruleScores.set(r.id, { probability: p, source: "heuristic_failopen" });
    }
    const ranked = skills
      .map((s) => ({ id: s.id, hits: fallbackHit(currentText, FALLBACK_KEYWORDS[s.id] ?? []) }))
      .sort((a, b) => b.hits - a.hits);
    const gateHits = fallbackHit(currentText, ["implement", "fix", "add", "build", "create", "prepare", "update", "investigat", "change"]);
    const gateScore = gateHits > 0 ? 0.8 : 0.2;
    const gatedOut = gateScore < opts.gateThreshold;
    const shortlist = gatedOut ? [] : ranked.filter((r) => r.hits > 0).slice(0, opts.topK).map((r) => r.id);
    const stage1: SkillStage1Out = {
      choice: ranked[0]?.id ?? null,
      probabilities: Object.fromEntries(ranked.map((r) => [r.id, r.hits / Math.max(1, ranked.reduce((a, x) => a + x.hits, 0))])),
      gateScore,
      gatedOut,
      shortlist,
    };
    let selectedSkill: string | null = null;
    let stage2: SkillStage2Out | null = null;
    if (!gatedOut && shortlist.length > 0) {
      const fits: Record<string, number> = {};
      for (const id of shortlist) {
        const hits = ranked.find((r) => r.id === id)?.hits ?? 0;
        fits[id] = hits >= 2 ? 0.9 : 0.6;
      }
      const best = shortlist.reduce((a, b) => (fits[a] >= fits[b] ? a : b));
      selectedSkill = fits[best] >= opts.fitsThreshold ? best : null;
      stage2 = { choice: best, probabilities: Object.fromEntries(shortlist.map((id) => [id, fits[id]])), fits, selected: selectedSkill };
    }
    return {
      ruleScores,
      selectedSkill,
      skillSource: "heuristic_failopen",
      stage1,
      stage2,
      evidenceClass: "fail_open",
      jevModel: null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      calls: 0,
    };
  }
}

/** Canned backend for unit tests. */
export class MockBackend implements ScoreBackend {
  readonly label: ScoreSource = "system_one";
  constructor(
    private readonly cannedRules: Record<string, number>,
    private readonly cannedSkill: string | null = null,
  ) {}
  async route(
    _state: RoutingState,
    rules: ResourceDescriptor[],
    _skills: ResourceDescriptor[],
    _bodies: Map<string, string>,
    _opts: { topK: number; gateThreshold: number; fitsThreshold: number; shortlistMin: number },
  ): Promise<BackendResult> {
    const ruleScores = new Map<string, RuleScoreOut>();
    for (const r of rules) ruleScores.set(r.id, { probability: this.cannedRules[r.id] ?? 0, source: "system_one" });
    return {
      ruleScores,
      selectedSkill: this.cannedSkill,
      skillSource: "system_one",
      stage1: null,
      stage2: null,
      evidenceClass: "provider_backed",
      jevModel: "mock",
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      calls: 0,
    };
  }
}
