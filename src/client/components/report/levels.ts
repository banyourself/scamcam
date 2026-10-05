import type { RiskLevel } from "../../../shared/report";

export const levelTextClass: Record<RiskLevel, string> = {
  no_known_threat: "text-level-safe",
  unknown: "text-level-unknown",
  suspicious: "text-level-suspicious",
  high_risk: "text-level-high",
  confirmed_malicious: "text-level-malicious",
};

export const levelFillClass: Record<RiskLevel, string> = {
  no_known_threat: "bg-level-safe",
  unknown: "bg-level-unknown",
  suspicious: "bg-level-suspicious",
  high_risk: "bg-level-high",
  confirmed_malicious: "bg-level-malicious",
};
