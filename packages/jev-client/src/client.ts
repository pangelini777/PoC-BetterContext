// Minimal TypeSafe/JEV System One client. No agent-behavior policy lives here:
// bearer auth, timeout/abort, strict response validation, usage/latency capture.
// API shape per https://docs.typesafe.ai/api.md (verified 2026-09-21):
//   POST {baseURL}/v1/systemone { state, model, questions } -> { model, answers, usage }

export interface NoulQuestion {
  type: "noul";
  instructions: string | object | unknown[];
  criteria?: { true?: string | object | unknown[]; false?: string | object | unknown[] };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string | object | unknown[];
  criteria: Record<string, string | object | unknown[] | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string | object | unknown[];
  criteria: (string | object | unknown[])[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities?: Record<string, number>;
  confidence: number;
}
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
  latencyMs: number;
}

export interface SystemOneOptions {
  apiKey: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class SystemOneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemOneValidationError";
  }
}

const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";

function checkRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkProb(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

/** Strict per-answer validation. Throws SystemOneValidationError on any mismatch. */
export function validateAnswer(id: string, q: Question, a: unknown): Answer {
  if (!checkRecord(a)) throw new SystemOneValidationError(`answer ${id}: not an object`);
  if (a["type"] !== q.type) {
    throw new SystemOneValidationError(`answer ${id}: type ${String(a["type"])} != question ${q.type}`);
  }
  if (q.type === "noul") {
    if (!checkProb(a["noul"])) throw new SystemOneValidationError(`answer ${id}: noul out of [0,1]`);
    return { type: "noul", noul: a["noul"] };
  }
  if (q.type === "choice") {
    if (!checkRecord(q.criteria)) throw new SystemOneValidationError(`question ${id}: bad criteria`);
    const options = Object.keys(q.criteria);
    if (typeof a["choice"] !== "string" || !options.includes(a["choice"])) {
      throw new SystemOneValidationError(`answer ${id}: choice not in criteria`);
    }
    if (!checkRecord(a["probabilities"])) throw new SystemOneValidationError(`answer ${id}: bad probabilities`);
    let sum = 0;
    for (const o of options) {
      const p = (a["probabilities"] as Record<string, unknown>)[o];
      if (!checkProb(p)) throw new SystemOneValidationError(`answer ${id}: probability for ${o} out of [0,1]`);
      sum += p;
    }
    if (Math.abs(sum - 1) > 0.02) {
      throw new SystemOneValidationError(`answer ${id}: probabilities sum to ${sum}, expected ~1`);
    }
    // Winner must hold the maximal probability.
    let best = options[0];
    const probs = a["probabilities"] as Record<string, number>;
    for (const o of options) if (probs[o] > probs[best]) best = o;
    if (best !== a["choice"]) {
      throw new SystemOneValidationError(`answer ${id}: choice ${a["choice"]} is not the max-probability option (${best})`);
    }
    if (!checkProb(a["confidence"])) throw new SystemOneValidationError(`answer ${id}: bad confidence`);
    return { type: "choice", choice: a["choice"] as string, probabilities: probs, confidence: a["confidence"] as number };
  }
  // score
  if (!Array.isArray(q.criteria) || q.criteria.length < 2) {
    throw new SystemOneValidationError(`question ${id}: score needs >= 2 levels`);
  }
  if (typeof a["score"] !== "number" || !Number.isFinite(a["score"])) {
    throw new SystemOneValidationError(`answer ${id}: bad score`);
  }
  if (!checkRecord(a["legend"])) throw new SystemOneValidationError(`answer ${id}: bad legend`);
  if (!checkProb(a["confidence"])) throw new SystemOneValidationError(`answer ${id}: bad confidence`);
  return {
    type: "score",
    score: a["score"] as number,
    legend: a["legend"] as Record<string, string>,
    probabilities: checkRecord(a["probabilities"]) ? (a["probabilities"] as Record<string, number>) : undefined,
    confidence: a["confidence"] as number,
  };
}

export async function systemOne(
  state: string | object | unknown[],
  questions: Record<string, Question>,
  opts: SystemOneOptions,
): Promise<SystemOneResponse> {
  const baseURL = (opts.baseURL ?? process.env["TYPESAFE_BASE_URL"] ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = opts.model ?? process.env["TYPESAFE_DEFAULT_MODEL"] ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const fetchFn = opts.fetchImpl ?? fetch;
  if (!opts.apiKey) throw new SystemOneValidationError("missing API key (TYPESAFE_API_KEY)");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  let raw: Response;
  try {
    raw = await fetchFn(`${baseURL}/v1/systemone`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state, model, questions }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new SystemOneValidationError(`request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  clearTimeout(timer);
  const latencyMs = Date.now() - started;
  if (!raw.ok) {
    const text = await raw.text().catch(() => "");
    throw new SystemOneValidationError(`HTTP ${raw.status}: ${text.slice(0, 300)}`);
  }
  const body: unknown = await raw.json();
  if (!checkRecord(body)) throw new SystemOneValidationError("response is not an object");
  if (typeof body["model"] !== "string" || body["model"].length === 0) {
    throw new SystemOneValidationError("response missing model");
  }
  if (!checkRecord(body["answers"])) throw new SystemOneValidationError("response missing answers");
  if (!checkRecord(body["usage"])) throw new SystemOneValidationError("response missing usage");
  const usage = body["usage"] as Record<string, unknown>;
  if (!Number.isInteger(usage["input_tokens"]) || (usage["input_tokens"] as number) < 0) {
    throw new SystemOneValidationError("bad usage.input_tokens");
  }
  if (!Number.isInteger(usage["output_tokens"]) || (usage["output_tokens"] as number) < 0) {
    throw new SystemOneValidationError("bad usage.output_tokens");
  }
  const answers: Record<string, Answer> = {};
  const rawAnswers = body["answers"] as Record<string, unknown>;
  for (const [id, q] of Object.entries(questions)) {
    if (!(id in rawAnswers)) throw new SystemOneValidationError(`missing answer for ${id}`);
    answers[id] = validateAnswer(id, q, rawAnswers[id]);
  }
  return {
    model: body["model"] as string,
    answers,
    usage: { input_tokens: usage["input_tokens"] as number, output_tokens: usage["output_tokens"] as number },
    latencyMs,
  };
}
