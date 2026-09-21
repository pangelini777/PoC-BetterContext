// Trial eligibility gate (Workstream 6). A progressive live trial counts as
// evidence ONLY if every gate passes. Returns eligibility + reasons so the
// artifact records exactly why a trial was included or rejected.

import type { TelemetryRecord } from "../../../packages/protocol/src/types.ts";

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
}

export function classifyTrial(opts: {
  arm: string;
  records: TelemetryRecord[];
  sentinelFailures: number;
  materializations: number;
  dematerializations: number;
  verificationComplete: boolean;
  provenanceOk: boolean;
}): Eligibility {
  const reasons: string[] = [];
  if (opts.arm === "progressive_jev") {
    const backed = opts.records.filter((r) => r.providerEvidenceClass === "provider_backed");
    if (backed.length === 0) reasons.push("no provider-backed JEV call recorded");
    const withTelemetry = backed.filter((r) => r.providerCalls > 0 && r.jevModel !== null);
    if (backed.length > 0 && withTelemetry.length !== backed.length) {
      reasons.push("provider telemetry unattributable on some records");
    }
    if (opts.records.some((r) => r.providerEvidenceClass === "fail_open")) {
      reasons.push("fail-open record present in progressive arm");
    }
    if (opts.materializations === 0) reasons.push("no dynamic materialization observed");
    if (opts.dematerializations === 0) reasons.push("no genuine dematerialization observed");
    if (opts.sentinelFailures > 0) reasons.push(`${opts.sentinelFailures} sentinel/body-absence failures`);
  }
  if (!opts.verificationComplete) reasons.push("independent verification incomplete");
  if (!opts.provenanceOk) reasons.push("workspace/provenance guard failed");
  return { eligible: reasons.length === 0, reasons };
}

export function evidenceClassOf(arm: string, backend: "provider" | "failopen"): string {
  if (arm === "load_all") return "baseline";
  if (arm === "progressive_jev") return backend === "provider" ? "provider_backed" : "fail_open";
  return arm;
}
