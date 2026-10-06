export const riskLevels = ["no_known_threat", "unknown", "suspicious", "high_risk", "confirmed_malicious"] as const;

export type RiskLevel = (typeof riskLevels)[number];
export type EvidenceSignal = "raises_risk" | "lowers_risk" | "neutral";
export type UncheckedReason = "unavailable" | "over_budget" | "not_applicable" | "skipped" | "not_configured" | "out_of_date";

export interface Evidence {
  id: string;
  signal: EvidenceSignal;
  title: string;
  detail: string;
  source: { name: string; url?: string | undefined };
  checkedAt: string;
}

export interface UncheckedSource {
  name: string;
  reason: UncheckedReason;
}

export interface ScanReport {
  caseNumber: string;
  createdAt: string;
  subject: { kind: "url" | "message"; display: string; registrableDomain?: string | undefined };
  level: RiskLevel;
  confidence: "low" | "medium" | "high";
  summary: string;
  evidence: Evidence[];
  notChecked: UncheckedSource[];
  recommendations: string[];
  usesGoogleSafeBrowsing: boolean;
}

export const riskLabels: Record<RiskLevel, string> = {
  no_known_threat: "No known threat detected",
  unknown: "Unknown",
  suspicious: "Suspicious",
  high_risk: "High risk",
  confirmed_malicious: "Confirmed malicious",
};

export const riskExplanations: Record<RiskLevel, string> = {
  no_known_threat: "ScamCam's checks found nothing. That does not prove it is safe.",
  unknown: "There is not enough evidence either way, or some sources could not be checked.",
  suspicious: "Some warning signs, but no independent confirmation.",
  high_risk: "Several independent warning signs agree.",
  confirmed_malicious: "A trusted security source currently lists this as harmful.",
};

export const uncheckedReasons: Record<UncheckedReason, string> = {
  unavailable: "did not respond",
  over_budget: "was skipped because today's free limit was reached",
  not_applicable: "does not apply to this kind of input",
  skipped: "was not needed",
  not_configured: "is not connected yet",
  out_of_date: "was not used because its copy is out of date",
};

export const googleAdvisoryUrl = "https://developers.google.com/safe-browsing/v4/advisory";
