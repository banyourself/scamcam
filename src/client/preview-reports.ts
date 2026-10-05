import type { ScanReport } from "../shared/report";

const checkedAt = "2026-10-05T14:02:00.000Z";

export const previewReports: ScanReport[] = [
  {
    caseNumber: "SC-261005-7F2A",
    createdAt: checkedAt,
    subject: {
      kind: "url",
      display: "https://steamcommunity-trade.example/tradeoffer/new/?partner=[code hidden]",
      registrableDomain: "steamcommunity-trade.example",
    },
    level: "high_risk",
    confidence: "medium",
    summary: "This looks like a fake Steam trade page.",
    evidence: [
      {
        id: "lookalike",
        signal: "raises_risk",
        title: "The domain imitates steamcommunity.com",
        detail: "The registered domain is steamcommunity-trade.example, not steamcommunity.com. Steam trade offers only come from steamcommunity.com.",
        source: { name: "ScamCam domain check" },
        checkedAt,
      },
      {
        id: "age",
        signal: "raises_risk",
        title: "The domain was registered 3 days ago",
        detail: "Most scam domains are used for days or weeks before they are taken down.",
        source: { name: "RDAP registry data" },
        checkedAt,
      },
      {
        id: "lists",
        signal: "neutral",
        title: "Not on known phishing lists yet",
        detail: "New scam sites often are not listed until someone reports them.",
        source: { name: "URLhaus" },
        checkedAt,
      },
    ],
    notChecked: [{ name: "Google Safe Browsing", reason: "unavailable" }],
    recommendations: [
      "Do not log in through this link.",
      "Open trade offers from the Steam app or by typing steamcommunity.com yourself.",
      "Report the account that sent it to Steam Support.",
    ],
    usesGoogleSafeBrowsing: false,
  },
  {
    caseNumber: "SC-261005-1C09",
    createdAt: checkedAt,
    subject: { kind: "url", display: "https://www.roblox.com/home", registrableDomain: "roblox.com" },
    level: "no_known_threat",
    confidence: "high",
    summary: "This is Roblox's official website.",
    evidence: [
      {
        id: "official",
        signal: "lowers_risk",
        title: "The domain is roblox.com",
        detail: "This is the domain Roblox uses for its website.",
        source: { name: "ScamCam domain check" },
        checkedAt,
      },
      {
        id: "gsb",
        signal: "neutral",
        title: "No warning from Google Safe Browsing",
        detail: "Google Safe Browsing had no warning for this link when it was checked.",
        source: { name: "Google Safe Browsing" },
        checkedAt,
      },
    ],
    notChecked: [],
    recommendations: ["Still never share your password or the code from your authenticator app with anyone."],
    usesGoogleSafeBrowsing: true,
  },
  {
    caseNumber: "SC-261005-B3E4",
    createdAt: checkedAt,
    subject: { kind: "message", display: "free nitro for the first 100 people, claim fast: [email hidden] gift-nitro.example" },
    level: "suspicious",
    confidence: "low",
    summary: "The message uses a common \"free Nitro\" scam script.",
    evidence: [
      {
        id: "script",
        signal: "raises_risk",
        title: "Matches the \"free Nitro\" pattern",
        detail: "Real Nitro gifts appear as a gift embed inside Discord, not as a link to another site.",
        source: { name: "ScamCam message rules" },
        checkedAt,
      },
      {
        id: "urgency",
        signal: "raises_risk",
        title: "Pressure to act fast",
        detail: "\"First 100 people\" and \"claim fast\" are used to stop people from thinking it through.",
        source: { name: "ScamCam message rules" },
        checkedAt,
      },
    ],
    notChecked: [{ name: "AI context check", reason: "over_budget" }],
    recommendations: ["Do not open the link.", "Report the message in Discord."],
    usesGoogleSafeBrowsing: false,
  },
];
