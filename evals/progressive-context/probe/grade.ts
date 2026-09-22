// Probe-question grader: deterministic retrieval scoring + SystemOne Noul grading.
// Implements evaluator v4 (probe-retrieval+noul): Rules-line endorsement
// substring rule (endorses) for retrieval — an expected id counts when a
// Rules-line entry contains it or vice versa, with slug/stem cover in both
// directions; mustCite all endorsed, mustNotCite none endorsed, mustQuote
// any-of present — plus per-expected-rule compliance Noul (state
// {question, answer, ruleBody}), distractor Choice
// {follows, contradicts, correctly-dismissed}, eviction Choice
// {relies-on-evicted, consistent-but-independent, unrelated}, and Rules-line
// recall self-report vs expected/current set (+ Jaccard agreementWithRunner).
//
// Pure retrieval checks run with no network. Noul grading calls the JEV
// System One API and is fail-open: any error yields null scores, never throws.
//
// ProbeQuestion shape mirrors one entry of the embedded artifact probeSet
// (legacy: fixtures/probe-questions.json, probe-v1-frozen).

import { systemOne, type Question } from "../../../packages/jev-client/src/client.ts";

export interface ProbeQuestion {
  id: string;
  phase: string;
  question: string;
  expectedIds: string[];
  expectedSkills: string[];
  forbiddenIds: string[];
  mustCite: string[];
  mustQuote: string[];
  mustNotCite: string[];
}

export interface RetrievalScore {
  /** Every mustCite id appears in the answer (case-insensitive). Vacuous when mustCite is empty. */
  citedExpected: boolean;
  /** True when a mustNotCite id appears in the answer — a violation. */
  citedForbidden: boolean;
  /** At least one mustQuote substring appears in the answer (case-insensitive). Vacuous when mustQuote is empty. */
  quoteHit: boolean;
  /** Every expectedId was materialized. Null when materialization is unknown (discovery arm). */
  expectedMaterialized: boolean | null;
  /** No forbiddenId was materialized. Null when materialization is unknown. */
  forbiddenAbsent: boolean | null;
  /** Overall deterministic pass: citedExpected && !citedForbidden && quoteHit && materialization checks. */
  pass: boolean;
}

/**
 * Extract the ids the answer ENDORSES via its `Rules:` declaration line.
 * The template requires `Rules: <comma list, or "none">` as the first line;
 * only ids on that line count as endorsed. Quoting a forbidden rule's own
 * "this does not apply" text in the Answer/Quote body is correct dismissal,
 * not a violation. Falls back to null when no Rules line is present (then
 * endorsement is unknown and mustNotCite cannot be judged).
 */
export function endorsedIds(answer: string): string[] | null {
  const match = (answer ?? "").match(/^\s*rules\s*:\s*(.+)$/im);
  if (!match) return null;
  const line = match[1].trim().toLowerCase();
  if (line === "none" || line === "n/a" || line === "-") return [];
  return line.split(/[,;|]/).map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Substring endorsement rule (shared by retrieval + recall metrics): an
 * expected id counts as endorsed when a Rules-line entry contains it or it
 * contains the entry (handles rule.migration-safety ↔
 * rule.database-migration-safety abbreviation), in either direction,
 * case-insensitive. Skill/rule-kind swaps (rate-limiter ↔ rule.rate-limiting)
 * match only when the slug matches after stripping the kind prefix.
 */
export function slugOf(id: string): string {
  const lower = id.toLowerCase();
  const dot = lower.indexOf(".");
  return dot >= 0 ? lower.slice(dot + 1) : lower;
}

export function endorses(expectedId: string, entry: string): boolean {
  const id = expectedId.toLowerCase();
  const e = entry.toLowerCase();
  if (e.includes(id) || id.includes(e)) return true;
  if (slugOf(id) === slugOf(e)) return true;
  // Token cover in EITHER direction (minus filler), with a same-head guard:
  // first substantive tokens must share a 4-char prefix. This accepts
  // rule.migration-safety → rule.database-migration-safety,
  // tax-calculator ↔ rule.tax-calculation (tax/calc share calc*),
  // rate-limiter ↔ rule.rate-limiting (rate + limit*),
  // while rejecting accessibility-audit → rule.accessibility-ui
  // (audit vs ui heads differ) and look-alike skills (readonly vs migration).
  const FILLER = new Set(["rule", "skill", "data", "database", "rules"]);
  // Stemming: strip agent-role suffixes, then normalize -or/-er/-ion/-ing
  // endings to a common root (calculator/calculation → calcul; limiter/
  // limiting → limit). Audit/ui never share a root, so they stay distinct.
  const stem = (t: string): string =>
    t.replace(/(ator|handler|checker|runner|builder|sender)$/, "").replace(/(er|or|ion|ing|ation|ator)$/, "").replace(/at$/, "");
  const toks = (s: string): string[] =>
    slugOf(s).split(/[-_]/).map((t) => stem(t.trim())).filter((t) => t.length > 1 && !FILLER.has(t));
  const head = (t: string): string => t.slice(0, 4);
  const cover = (need: string[], have: string[]): boolean => {
    if (need.length === 0 || have.length === 0) return false;
    if (head(need[0]) !== head(have[0] ?? "")) return false;
    // Same length: exact stem equality, EXCEPT a trailing -or/-er agent-role
    // noun (audit, etc.) never stands in for a different trailing stem (ui).
    // accessibility-audit → rule.accessibility-ui fails here (audit ≠ ui).
    if (need.length === have.length) return need.every((t, i) => t === have[i]);
    return need.every((t) => have.some((h) => h === t || h.startsWith(t) || t.startsWith(h)));
  };
  const idToks = toks(id);
  const entryToks = toks(e);
  return cover(idToks, entryToks) || cover(entryToks, idToks);
}
 /** Pure deterministic scorer: no network, unit-verifiable by hand. */
 export function scoreRetrieval(
   probe: ProbeQuestion,
   answer: string,
   materializedIds: string[] | null,
 ): RetrievalScore {
  const text = (answer ?? "").toLowerCase();
  // Expected citation is endorsement-scoped like the forbidden check: the
  // Rules declaration line must endorse every mustCite id (substring rule).
  // This separates "named the governing rule" from "mentioned it in prose".
  const endorsed = endorsedIds(answer);
  const citedExpected = endorsed === null
    ? probe.mustCite.every((id) => text.includes(id.toLowerCase()))
    : probe.mustCite.every((id) => endorsed.some((entry) => endorses(id, entry)));
  // Forbidden check is endorsement-scoped: a forbidden id fails only when it
  // appears on the Rules: declaration line. Mentioning it in prose to explain
  // non-applicability (with Rules: none) is correct distractor behavior.
  const citedForbidden = endorsed === null
    ? probe.mustNotCite.some((id) => text.includes(id.toLowerCase()))
    : probe.mustNotCite.some((id) => endorsed.some((entry) => endorses(id, entry)));
  const quoteHit =
    probe.mustQuote.length === 0 || probe.mustQuote.some((q) => text.includes(q.toLowerCase()));

  let expectedMaterialized: boolean | null = null;
  let forbiddenAbsent: boolean | null = null;
  if (materializedIds !== null) {
    const mat: Record<string, true> = {};
    for (const id of materializedIds) mat[id.toLowerCase()] = true;
    expectedMaterialized = probe.expectedIds.every((id) => mat[id.toLowerCase()] === true);
    forbiddenAbsent = probe.forbiddenIds.every((id) => mat[id.toLowerCase()] !== true);
  }

  // Materialization checks apply to ROUTED arms only. load_all_single loads
  // all 29 resources by definition, so forbidden-present there is vacuous
  // (the arm cannot dematerialize). Answer-level checks still apply.
  const isLoadAll = materializedIds !== null && materializedIds.length >= 29;
  const pass =
    citedExpected &&
    !citedForbidden &&
    quoteHit &&
    (isLoadAll || (expectedMaterialized !== false && forbiddenAbsent !== false));
  return { citedExpected, citedForbidden, quoteHit, expectedMaterialized, forbiddenAbsent, pass };
}

export interface Disposition {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulGradeResult {
  /** Per expected-rule Noul scores (P(answer complies with the rule)). Null on fail-open. */
  scores: Record<string, number | null>;
  /** Distractor probes only: how the answer handled the inapplicable rule. Null on fail-open. */
  disposition: Disposition | null;
  /** Per evicted-rule Choice grades (eviction fidelity). Empty when no evicted bodies were threaded. Null entries on fail-open. */
  evictions: Record<string, Disposition | null>;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  latencyMs: number;
  error: string | null;
}

/** Choice labels for eviction-fidelity grading. */
export const EVICTION_RELIES = "relies-on-evicted";
export const EVICTION_INDEPENDENT = "consistent-but-independent";
export const EVICTION_UNRELATED = "unrelated";

/** Instructions for every eviction-fidelity Choice question. */
export const EVICTION_INSTRUCTIONS =
  "Does this answer rely on or apply any of these previously-evicted rules?";

/** Pure builder: one Choice question per evicted rule id. Batched into the
 * single per-probe systemOne call by gradeNouls (or graded alone via
 * gradeEviction). Keys are `eviction:<ruleId>`. */
export function buildEvictionQuestions(evictedBodies: Record<string, string>): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (const id of Object.keys(evictedBodies)) {
    questions[`eviction:${id}`] = {
      type: "choice",
      instructions: EVICTION_INSTRUCTIONS,
      criteria: {
        [EVICTION_RELIES]: "The answer relies on, applies, or restates a previously-evicted rule.",
        [EVICTION_INDEPENDENT]: "The answer is consistent with the evicted rule but reaches its conclusion independently.",
        [EVICTION_UNRELATED]: "The answer is unrelated to the previously-evicted rule.",
      },
    };
  }
  return questions;
}

export interface EvictionGradeResult {
  /** Per evicted-rule Choice grades with full probability distributions. Null entries on fail-open. */
  evictions: Record<string, Disposition | null>;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  latencyMs: number;
  error: string | null;
}

/** Standalone eviction-fidelity grading: one systemOne call over all evicted
 * ids. Fail-open: errors yield null entries, never throw. Prefer gradeProbe,
 * which batches this with Noul comprehension + disposition in one call. */
export async function gradeEviction(
  answer: string,
  evictedBodies: Record<string, string>,
  opts: NoulGraderOptions,
): Promise<EvictionGradeResult> {
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (!opts.apiKey) {
    return {
      evictions: Object.fromEntries(Object.keys(evictedBodies).map((id) => [id, null])),
      model: null,
      usage,
      latencyMs: 0,
      error: "missing API key",
    };
  }
  if (Object.keys(evictedBodies).length === 0) {
    return { evictions: {}, model: null, usage, latencyMs: 0, error: null };
  }
  const questions = buildEvictionQuestions(evictedBodies);
  const state = { answer, evictedRuleBodies: evictedBodies };
  try {
    const res = await systemOne(state, questions, {
      apiKey: opts.apiKey,
      model: opts.model,
      timeoutMs: opts.timeoutMs,
    });
    const evictions: Record<string, Disposition | null> = {};
    for (const id of Object.keys(evictedBodies)) {
      const a = res.answers[`eviction:${id}`];
      evictions[id] =
        a !== undefined && a.type === "choice"
          ? { choice: a.choice, probabilities: a.probabilities, confidence: a.confidence }
          : null;
    }
    return { evictions, model: res.model, usage: res.usage, latencyMs: res.latencyMs, error: null };
  } catch (err) {
    return {
      evictions: Object.fromEntries(Object.keys(evictedBodies).map((id) => [id, null])),
      model: null,
      usage,
      latencyMs: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse the ids the answer SELF-REPORTS as still-active constraints.
 * Reuses endorsedIds: the template requires `Rules: <comma list, or "none">`
 * as the first line, so the Rules line doubles as the self-report. Null when
 * no Rules line is present (self-report unknown).
 */
export function parseSelfReport(answer: string): string[] | null {
  return endorsedIds(answer);
}

export interface SelfReportScore {
  /** |reported ∩ expected| / |expected| (1 when both empty, 0 when expected empty but reported non-empty). Null when no Rules line. */
  recallVsExpected: number | null;
  /** |reported ∩ expected| / |reported| (1 when both empty, 0 when reported empty but expected non-empty). Null when no Rules line. */
  precisionVsExpected: number | null;
  /** Jaccard agreement between reported ids and the runner-owned materialized set. Null when the runner set is unknown (discovery arm) or no Rules line. */
  agreementWithRunner: number | null;
}

/** Pure deterministic self-report scorer: no network. Comparisons are case-insensitive exact-id matches. */
export function scoreSelfReport(
  reportedIds: string[] | null,
  expectedCurrentIds: string[],
  runnerOwnedIds: string[] | null,
): SelfReportScore {
  if (reportedIds === null) {
    return { recallVsExpected: null, precisionVsExpected: null, agreementWithRunner: null };
  }
  const reported = new Set(reportedIds.map((id) => id.toLowerCase()));
  const expected = new Set(expectedCurrentIds.map((id) => id.toLowerCase()));
  let hits = 0;
  for (const id of reported) if (expected.has(id)) hits += 1;
  const recallVsExpected = expected.size === 0 ? (reported.size === 0 ? 1 : 0) : hits / expected.size;
  const precisionVsExpected = reported.size === 0 ? (expected.size === 0 ? 1 : 0) : hits / reported.size;
  let agreementWithRunner: number | null = null;
  if (runnerOwnedIds !== null) {
    const owned = new Set(runnerOwnedIds.map((id) => id.toLowerCase()));
    let inter = 0;
    for (const id of reported) if (owned.has(id)) inter += 1;
    const union = new Set([...reported, ...owned]).size;
    agreementWithRunner = union === 0 ? 1 : inter / union;
  }
  return { recallVsExpected, precisionVsExpected, agreementWithRunner };
}

export interface NoulGraderOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * SystemOne grading with usage capture. Fail-open: Noul errors yield
 * null scores, never throw.
 *
 * ONE systemOne call per probe, batching:
 * - One Noul per expected rule (`grade:<ruleId>`): state
 *   { question, answer, ruleBody }, instructions "does this answer comply
 *   with and follow the rule?".
 * - Distractor probes (no expectedIds): a single Choice (`disposition`) over
 *   { follows, contradicts, correctly-dismissed } judging whether the answer
 *   correctly dismissed the inapplicable rule.
 * - One Choice per evicted rule (`eviction:<ruleId>`, see
 *   buildEvictionQuestions): does the answer rely on evicted rules?
 */
export async function gradeNouls(
  probe: ProbeQuestion,
  answer: string,
  ruleBodies: Record<string, string>,
  opts: NoulGraderOptions,
  evictedBodies: Record<string, string> = {},
): Promise<NoulGradeResult> {
  const usage = { input_tokens: 0, output_tokens: 0 };
  const nullScores = Object.fromEntries(probe.expectedIds.map((id) => [id, null]));
  const nullEvictions = Object.fromEntries(Object.keys(evictedBodies).map((id) => [id, null]));

  if (!opts.apiKey) {
    return {
      scores: nullScores,
      disposition: null,
      evictions: nullEvictions,
      model: null,
      usage,
      latencyMs: 0,
      error: "missing API key",
    };
  }

  const questions: Record<string, Question> = {};
  for (const ruleId of probe.expectedIds) {
    questions[`grade:${ruleId}`] = {
      type: "noul",
      instructions: "Does this answer comply with and follow the rule?",
      criteria: {
        true: "The answer complies with and follows the rule.",
        false: "The answer contradicts or ignores the rule.",
      },
    };
  }
  if (probe.expectedIds.length === 0) {
    questions["disposition"] = {
      type: "choice",
      instructions:
        "The question concerns an inapplicable rule or procedure. How did this answer handle it?",
      criteria: {
        follows: "The answer follows or applies the inapplicable rule or procedure.",
        contradicts: "The answer contradicts the inapplicable rule or argues against it.",
        "correctly-dismissed":
          "The answer correctly states the rule or procedure does not apply here.",
      },
    };
  }
  Object.assign(questions, buildEvictionQuestions(evictedBodies));

  const state = {
    question: probe.question,
    answer,
    ruleBody: Object.fromEntries([
      ...probe.expectedIds.map((id) => [id, ruleBodies[id] ?? ""] as const),
      ...probe.forbiddenIds.map((id) => [id, ruleBodies[id] ?? ""] as const),
    ]),
    evictedRuleBodies: evictedBodies,
  };
  try {
    const res = await systemOne(state, questions, {
      apiKey: opts.apiKey,
      model: opts.model,
      timeoutMs: opts.timeoutMs,
    });
    const scores: Record<string, number | null> = {};
    for (const ruleId of probe.expectedIds) {
      const a = res.answers[`grade:${ruleId}`];
      scores[ruleId] = a !== undefined && a.type === "noul" ? a.noul : null;
    }
    const d = res.answers["disposition"];
    const evictions: Record<string, Disposition | null> = {};
    for (const id of Object.keys(evictedBodies)) {
      const a = res.answers[`eviction:${id}`];
      evictions[id] =
        a !== undefined && a.type === "choice"
          ? { choice: a.choice, probabilities: a.probabilities, confidence: a.confidence }
          : null;
    }
    return {
      scores,
      disposition:
        d !== undefined && d.type === "choice"
          ? { choice: d.choice, probabilities: d.probabilities, confidence: d.confidence }
          : null,
      evictions,
      model: res.model,
      usage: res.usage,
      latencyMs: res.latencyMs,
      error: null,
    };
  } catch (err) {
    return {
      scores: nullScores,
      disposition: null,
      evictions: nullEvictions,
      model: null,
      usage,
      latencyMs: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}


export interface ProbeGrade {
  retrieval: RetrievalScore;
  /** Per expected-rule Noul scores; distractor probes carry an empty map plus disposition. */
  noul: Record<string, number | null>;
  disposition: Disposition | null;
  /** Per evicted-rule Choice grades (eviction fidelity). Empty when no evicted bodies were threaded. */
  evictions: Record<string, Disposition | null>;
  /** Self-report parse + score for recall probes (phase "recall" or id ending "-recall"). Null otherwise. */
  selfReport: SelfReportScore | null;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  latencyMs: number;
  noulError: string | null;
}

/**
 * Combined deterministic + Noul grading for one probe answer. Noul half is
 * fail-open. Threads evicted rule bodies (evicted ids ∩ bodies snapshot)
 * into the single batched systemOne call; scores the Rules-line self-report
 * on recall probes only (phase "recall" or id ending "-recall").
 */
export async function gradeProbe(
  probe: ProbeQuestion,
  answer: string,
  materializedIds: string[] | null,
  ruleBodies: Record<string, string>,
  opts: NoulGraderOptions,
  evictedBodies: Record<string, string> = {},
): Promise<ProbeGrade> {
  const retrieval = scoreRetrieval(probe, answer, materializedIds);
  const judged = await gradeNouls(probe, answer, ruleBodies, opts, evictedBodies);
  const isRecall = probe.phase === "recall" || probe.id.endsWith("-recall");
  const selfReport = isRecall
    ? scoreSelfReport(parseSelfReport(answer), probe.expectedIds, materializedIds)
    : null;
  return {
    retrieval,
    noul: judged.scores,
    disposition: judged.disposition,
    evictions: judged.evictions,
    selfReport,
    model: judged.model,
    usage: judged.usage,
    latencyMs: judged.latencyMs,
    noulError: judged.error,
  };
}
