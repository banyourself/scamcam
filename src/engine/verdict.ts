import type { RiskLevel, ScanReport } from "../shared/report";
import { brands } from "./brands";
import { familyNames } from "./message-rules";
import { sourceNames, strengthPoints, type ScamFamily, type Signal } from "./signals";

export interface VerdictInput {
  messageSignals: Signal[];
  linkSignals: Signal[][];
  families: ScamFamily[];
  linkCount: number;
  allLinksOfficial: boolean;
  safeBrowsingCleared: boolean;
  officialBrandNames: string[];
}

export interface Verdict {
  level: RiskLevel;
  confidence: ScanReport["confidence"];
  summary: string;
  recommendations: string[];
  score: number;
  contradiction: boolean;
}

function raisePoints(signals: Signal[]): number {
  return signals.filter((signal) => signal.direction === "raises").reduce((total, signal) => total + strengthPoints[signal.strength], 0);
}

const confidenceSteps: ScanReport["confidence"][] = ["low", "medium", "high"];

function lower(confidence: ScanReport["confidence"]): ScanReport["confidence"] {
  return confidenceSteps[Math.max(0, confidenceSteps.indexOf(confidence) - 1)]!;
}

function brandName(id: string | undefined): string | null {
  return brands.find((brand) => brand.id === id)?.name ?? null;
}

const familyAdvice: Record<ScamFamily, string> = {
  false_report: "Steam, Discord, and Roblox staff never message you about reports. Block and report the sender.",
  free_reward: "Real Discord Nitro gifts appear as a gift box inside Discord. Free Robux and skin sites are always scams.",
  fake_trade: "Check trades only inside the official Steam or game app, never through a link.",
  malware_game: "Do not run files from people you do not know. If you already ran it, change your passwords from another device and scan your computer.",
  account_cookie: "Never share cookies, tokens, or anything from your browser's developer tools. They work like your password.",
  qr_takeover: "Only scan QR codes on the official login page you opened yourself.",
  middleman: "Use the platform's own trade system instead of a middleman.",
  vote_scam: "Ignore \"vote for my team\" links. Real tournaments do not need you to log in to vote.",
  payment_pressure: "Never pay for items or services with gift cards, crypto, or friends-and-family transfers.",
  credential_theft: "Never type your password into a page you reached from a link. Open the site yourself instead.",
  command_paste: "Never paste a command someone gives you into the Run box, PowerShell, or a terminal. Real human checks never ask for that.",
  wallet_drainer: "Never connect your wallet or sign anything on a site someone sent you. Check the project's official account yourself.",
};

function recommendationsFor(level: RiskLevel, families: ScamFamily[], brandIds: string[]): string[] {
  const tips: string[] = [];
  if (level === "confirmed_malicious" || level === "high_risk") {
    tips.push("Do not open the link, log in, or download anything from it.");
  }
  for (const family of families) {
    tips.push(familyAdvice[family]);
  }
  if (brandIds.includes("steam")) {
    tips.push("Open Steam trades and logins from the Steam app or by typing steamcommunity.com yourself.");
  }
  if (brandIds.includes("discord")) {
    tips.push("Discord staff never send direct messages asking for your login or a QR code.");
  }
  if (brandIds.includes("roblox")) {
    tips.push("Roblox will never ask for your password or your .ROBLOSECURITY cookie.");
  }
  if (level === "confirmed_malicious" || level === "high_risk" || level === "suspicious") {
    tips.push("If you already entered your password, change it now from the official site and turn on two-factor authentication.");
    tips.push("Report the message on the platform where you got it.");
  } else if (level === "unknown") {
    tips.push("If you are not sure, do not click. Go to the site by typing its address yourself.");
  } else {
    tips.push("Even on official sites, never share your password or login codes with anyone.");
  }
  return [...new Set(tips)].slice(0, 6);
}

export function decideVerdict(input: VerdictInput): Verdict {
  const all = [...input.messageSignals, ...input.linkSignals.flat()];
  const raises = all.filter((signal) => signal.direction === "raises");
  const score = raisePoints(input.messageSignals) + Math.max(0, ...input.linkSignals.map(raisePoints));
  const independentSources = new Set(raises.filter((signal) => strengthPoints[signal.strength] >= 2).map((signal) => signal.source));
  const contradiction = input.linkSignals.some(
    (signals) =>
      signals.some((signal) => signal.direction === "lowers" && signal.strength === "strong") &&
      signals.some((signal) => signal.direction === "raises" && strengthPoints[signal.strength] >= 4),
  );
  const safeBrowsingHit = raises.find((signal) => signal.fromSafeBrowsing);
  const filterHit = raises.find((signal) => signal.source === sourceNames.dnsFilter);
  const lookalike = raises.find((signal) => signal.lookalike);

  let level: RiskLevel;
  let confidence: ScanReport["confidence"];
  if (all.some((signal) => signal.confirms)) {
    level = "confirmed_malicious";
    confidence = "high";
  } else if (safeBrowsingHit || score >= 6) {
    level = "high_risk";
    confidence = independentSources.size >= 2 ? "high" : "medium";
  } else if (score >= 3) {
    level = "suspicious";
    confidence = independentSources.size >= 2 ? "medium" : "low";
  } else if (input.linkCount === 0) {
    level = "no_known_threat";
    confidence = "low";
  } else if (input.allLinksOfficial) {
    level = "no_known_threat";
    confidence = "high";
  } else if (input.safeBrowsingCleared) {
    level = "no_known_threat";
    confidence = "medium";
  } else {
    level = "unknown";
    confidence = "low";
  }
  if (contradiction) {
    confidence = lower(confidence);
  }

  const topFamily = input.families[0];
  let summary: string;
  if (level === "confirmed_malicious") {
    summary = "A security source currently lists this link as harmful.";
  } else if (level === "high_risk" || level === "suspicious") {
    const lookalikeBrand = brandName(lookalike?.brandId);
    if (topFamily) {
      summary = `This matches the ${familyNames[topFamily]} scam.`;
    } else if (lookalikeBrand) {
      summary = `This looks like a fake ${lookalikeBrand} site.`;
    } else if (safeBrowsingHit) {
      summary = "Google Safe Browsing warns about this link.";
    } else if (filterHit) {
      summary = "Cloudflare's security filter blocks this site.";
    } else {
      summary = level === "high_risk" ? "Several warning signs point to a scam." : "There are warning signs, but nothing confirms a scam.";
    }
  } else if (level === "no_known_threat") {
    if (input.linkCount === 0) {
      summary = "No known scam patterns were found in this message.";
    } else if (input.allLinksOfficial && input.officialBrandNames.length === 1) {
      summary = `This link goes to ${input.officialBrandNames[0]}'s official website.`;
    } else if (input.allLinksOfficial) {
      summary = "These links go to official websites.";
    } else {
      summary = "None of ScamCam's checks found a problem.";
    }
  } else {
    summary = "ScamCam could not find enough evidence either way.";
  }

  const brandIds = [...new Set(all.map((signal) => signal.brandId).filter((id): id is string => Boolean(id)))];
  return { level, confidence, summary, recommendations: recommendationsFor(level, input.families, brandIds), score, contradiction };
}
