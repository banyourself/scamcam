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
  | "credential_theft"
  | "command_paste"
  | "wallet_drainer";

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
  pretendsToBe?: string;
}

export const strengthPoints: Record<Strength, number> = { critical: 6, strong: 4, moderate: 2, weak: 1 };

export const sourceNames = {
  domain: "ScamCam domain check",
  message: "ScamCam message rules",
  file: "ScamCam file check (on your device)",
  safeBrowsing: "Google Safe Browsing",
  rdap: "RDAP registry data",
  dns: "DNS lookup (Cloudflare 1.1.1.1)",
  dnsFilter: "Cloudflare security DNS (1.1.1.2)",
  urlhaus: "URLhaus (abuse.ch)",
  threatfox: "ThreatFox (abuse.ch)",
  phishingDatabase: "Phishing.Database (community list)",
  scamLists: "Community scam lists",
  spamhaus: "Spamhaus DBL and ZRD",
  phishstats: "PhishStats",
  radar: "Cloudflare Radar domain ranking",
  ai: "AI pattern check (Workers AI)",
} as const;

export const phishingDatabaseUrl = "https://github.com/Phishing-Database/Phishing.Database";
