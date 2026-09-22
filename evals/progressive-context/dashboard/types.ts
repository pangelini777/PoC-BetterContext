export type RunKind = "live-paired" | "scripted-four-arm" | "single-session" | "probe-eval" | "probe-multi";
export type RunStatus = "running" | "completed" | "dry-run" | "failed" | "skipped";

export interface ArmView {
  name: string;
  label: string;
  status: RunStatus;
  turns: number | null;
  durationMs: number | null;
  contextTokens: number | null;
  avgContextTokens: number | null;
  peakContextTokens: number | null;
  loadAllContextTokens: number | null;
  loadedResources: number | null;
  avgLoadedResources: number | null;
  materializations: number | null;
  dematerializations: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  verificationPassed: number | null;
  verificationTotal: number | null;
  eligible: boolean | null;
  eligibilityReasons: string[] | null;
  unloadMode: string | null;
  probeDetail: string[] | null;
  gradesPath: string | null;
  scenarios: number | null;
  events: number | null;
  rulePrecision: number | null;
  ruleRecall: number | null;
  criticalMisses: number | null;
  skillAccuracy: number | null;
  staleTokens: number | null;
  missingTokens: number | null;
  staleRatio: number | null;
  evictionFidelity: number | null;
  selfReportAccuracy: number | null;
}

export interface RunView {
  id: string;
  label: string;
  kind: RunKind;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  model: string | null;
  routingBackend: string | null;
  arms: ArmView[];
}

export interface RunsResponse {
  generatedAt: string;
  runs: RunView[];
}
