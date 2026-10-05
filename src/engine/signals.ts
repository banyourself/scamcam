export type Strength = "critical" | "strong" | "moderate" | "weak";
export type Direction = "raises" | "lowers" | "context";

export type ScamFamily =
  | "false_report"
  | "free_reward"
  | "fake_trade"
  | "malware_game"
  | "account_cookie"
  | "qr_takeover"
  | "middleman"
  | "vote_scam"
  | "payment_pressure"
  | "credential_theft";

export interface Signal {
  id: string;
  source: string;
  sourceUrl?: string;
  direction: Direction;
  strength: Strength;
  title: string;
  detail: string;
  link?: string;
  brandId?: string;
  family?: ScamFamily;
  confirms?: boolean;
  fromSafeBrowsing?: boolean;
  lookalike?: boolean;
}

export const strengthPoints: Record<Strength, number> = { critical: 6, strong: 4, moderate: 2, weak: 1 };

export const sourceNames = {
  domain: "ScamCam domain check",
  message: "ScamCam message rules",
  safeBrowsing: "Google Safe Browsing",
  rdap: "RDAP registry data",
  dns: "DNS lookup (Cloudflare 1.1.1.1)",
  urlhaus: "URLhaus (abuse.ch)",
} as const;
