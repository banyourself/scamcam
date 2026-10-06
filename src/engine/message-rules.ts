import { sourceNames, type ScamFamily, type Signal, type Strength } from "./signals";

interface MessageRule {
  id: string;
  strength: Strength;
  title: string;
  detail: string;
  family?: ScamFamily;
  folded?: boolean;
  patterns: RegExp[];
}

const gap = "[^.!?\\n]{0,40}";
const near = (left: string, right: string) => new RegExp(`\\b(?:${left})\\b${gap}\\b(?:${right})\\b`);

const secretWords =
  "password|passcode|pass word|login (?:code|details|info)|2fa(?: code)?|two[- ]?factor(?: code)?|verification code|auth(?:entication|enticator)? code|backup codes?|security code|one[- ]?time (?:code|password)|otp|steam ?guard(?: code)?|seed phrase|recovery (?:phrase|code)";

const rules: MessageRule[] = [
  {
    id: "credential-request",
    strength: "strong",
    family: "credential_theft",
    title: "Asks for a password or login code",
    detail: "No real support team, friend, or game ever needs your password or the code from your authenticator app.",
    patterns: [near("send|give|tell|share|type|enter|dm|pm|need|confirm|provide|drop", secretWords), /\bwhat(?:'s| is) (?:your|ur) (?:password|2fa|code|login)\b/],
  },
  {
    id: "qr-login",
    strength: "strong",
    family: "qr_takeover",
    title: "Asks you to scan a QR code",
    detail: "Scanning a QR code someone sends you can log them into your account on their device.",
    patterns: [near("scan", "qr|qr ?code"), near("qr ?code", "verify|login|log in|sign in|claim|link")],
  },
  {
    id: "cookie-token",
    strength: "strong",
    family: "account_cookie",
    title: "Asks for your cookie, token, or to paste code",
    detail: "Anyone with your browser cookie or account token can log in as you without your password.",
    patterns: [/\.?roblosecurity\b/, near("copy|paste|send|give|share", "cookies?|tokens?|session"), /\bjavascript:/, near("inspect element|developer tools|devtools|f12|console", "paste|copy|type|run")],
  },
  {
    id: "game-testing",
    strength: "strong",
    family: "malware_game",
    title: "Asks you to try a game or program",
    detail: "\"Can you test my game?\" is one of the most common ways malware is spread to gamers. The file steals passwords and accounts.",
    patterns: [
      /\b(?:test|try|play ?test|beta ?test|check out)\b[^.!?\n]{0,25}\b(?:my|our|this|the new)\b[^.!?\n]{0,15}\b(?:game|launcher|program|app|beta|demo|mod|client)\b/,
      /\b(?:download|run|open|install|extract)\b[^.!?\n]{0,40}\.(?:exe|scr|bat|msi|jar|apk|zip|rar|7z)\b/,
    ],
  },
  {
    id: "false-report",
    strength: "strong",
    family: "false_report",
    title: "Claims someone accidentally reported you",
    detail: "The \"I accidentally reported you\" story is a known script. It sends you to a fake staff member who asks for your login.",
    patterns: [/\b(?:accidentally|accidently|mistakenly|falsely|by mistake|by accident)\b[^.!?\n]{0,25}\breport(?:ed)?\b/],
  },
  {
    id: "account-threat",
    strength: "moderate",
    title: "Threatens your account",
    detail: "Scammers say your account will be banned or deleted to rush you. Real warnings appear inside the app or come from official email.",
    patterns: [
      /\b(?:your|ur|the) (?:steam |discord |roblox |minecraft |epic |)(?:account|profile|acc)\b[^.!?\n]{0,40}\b(?:will be|is being|has been|was|got|gets?|is)\b[^.!?\n]{0,15}\b(?:banned|suspended|terminated|deleted|disabled|locked|flagged|reported|removed)\b/,
      /\breported (?:you|your account|ur account)\b/,
    ],
  },
  {
    id: "staff-impersonation",
    strength: "moderate",
    title: "Claims to be staff or support",
    detail: "Steam, Discord, Roblox, and Microsoft staff do not contact players in private messages to fix accounts.",
    patterns: [
      /\b(?:steam|valve|discord|roblox|minecraft|mojang|microsoft|xbox|epic(?: games)?|riot|twitch)\s+(?:support|staff|admins?|administrators?|moderators?|mods|trust (?:and|&) safety|security team|employees?|official team)\b/,
      /\b(?:hypesquad|discord partner|community manager|staff member)\b/,
    ],
  },
  {
    id: "free-reward",
    strength: "moderate",
    family: "free_reward",
    folded: true,
    title: "Offers free Nitro, Robux, skins, or items",
    detail: "Free gifts sent by link are almost always fake and lead to pages that steal your login.",
    patterns: [
      /\bfree\b[^.!?\n]{0,25}\b(?:nitro|robux|skins?|v-?bucks|minecoins|gift ?cards?|knife|knives|items?|crates?|cases?|steam (?:games?|wallet)|gems|coins)\b/,
      /\b(?:nitro|robux|skins?|v-?bucks)\b[^.!?\n]{0,20}\b(?:giveaway|airdrop|for free|free)\b/,
      /\b(?:you(?:'ve| have)? won|claim (?:your|it|now|here|fast|them)|winners? (?:get|will))\b/,
    ],
  },
  {
    id: "urgency",
    strength: "weak",
    title: "Pressure to act fast",
    detail: "Deadlines and limited spots are used to stop you from thinking it through.",
    patterns: [
      /\b(?:within|in) \d{1,3} ?(?:minutes?|mins?|hours?|hrs?|h)\b/,
      /\b(?:right now|immediately|asap|urgent(?:ly)?|hurry|act fast|claim fast|be quick|last chance|expires? (?:soon|today|in)|limited time|only \d+ (?:left|spots?|codes?)|first \d+ (?:people|users|members))\b/,
    ],
  },
  {
    id: "gift-card-payment",
    strength: "strong",
    family: "payment_pressure",
    title: "Asks for payment with gift cards",
    detail: "Gift card codes are spent the moment you share them and can never be refunded. No real seller or staff member asks for them.",
    patterns: [near("pay|send|buy|give|transfer|use|accept|with", "gift ?cards?|steam (?:wallet )?(?:cards?|codes?)|google play cards?|itunes cards?|roblox cards?")],
  },
  {
    id: "payment-pressure",
    strength: "moderate",
    family: "payment_pressure",
    title: "Asks for payment with gift cards, crypto, or untraceable apps",
    detail: "Gift cards, crypto, and friends-and-family payments cannot be refunded, which is why scammers ask for them.",
    patterns: [
      near(
        "pay|send|buy|transfer|use|accept",
        "bitcoin|btc|crypto|usdt|ethereum|eth|paypal (?:friends|f&f|ff|family)|cash ?app|venmo|zelle|western union|wire transfer",
      ),
    ],
  },
  {
    id: "hand-over-items",
    strength: "moderate",
    family: "middleman",
    title: "Asks you to hand over your items first",
    detail: "Giving items away before you receive anything is how most trading scams work.",
    patterns: [/\b(?:give|send|trade|transfer|pass)\s+(?:me|us|him|her|them)\s+(?:the|your|all|ur)\s+(?:items?|skins?|inventory|pets?|limiteds?|knife|knives)\b/],
  },
  {
    id: "middleman",
    strength: "moderate",
    family: "middleman",
    title: "Offers a middleman to hold items",
    detail: "Fake middlemen and \"trusted traders\" take the items and disappear. Use the platform's own trade system.",
    patterns: [/\b(?:middle ?man|middlemen|trusted trader)\b/, /\bmm\b[^.!?\n]{0,20}\b(?:trade|service|hold)\b/],
  },
  {
    id: "move-off-platform",
    strength: "weak",
    title: "Wants to move the chat to another app",
    detail: "Moving to Telegram or WhatsApp takes you away from the reporting and protection of the original platform.",
    patterns: [/\b(?:add|dm|message|contact|text|hit)\s+me\s+(?:up\s+)?on\s+(?:telegram|whatsapp|snapchat|instagram|skype|signal|kik)\b/],
  },
  {
    id: "screen-share",
    strength: "moderate",
    title: "Asks you to share your screen",
    detail: "Sharing your screen can expose login codes, QR codes, and personal details to the other person.",
    patterns: [/\bscreen ?share\b/, /\bshare (?:your|ur) screen\b/, near("go live|stream", "verify|prove|show")],
  },
  {
    id: "trade-verify",
    strength: "moderate",
    family: "fake_trade",
    title: "Asks you to verify a trade, inventory, or account",
    detail: "Real platforms never ask you to verify your inventory or account through a link someone sends you.",
    patterns: [near("verify|confirm|validate|authorize|authenticate", "inventory|trade|items?|ownership|account|wallet|age")],
  },
  {
    id: "vote-scam",
    strength: "strong",
    family: "vote_scam",
    title: "Asks you to vote for someone",
    detail: "\"Vote for my team\" links are a known trick that leads to fake Steam or Discord login pages.",
    patterns: [/\bvote (?:for )?(?:my team|us|our team)\b/, /\bvote for me\b[^.!?\n]{0,60}\[link\]/, near("vote", "tournament|team|contest|competition")],
  },
  {
    id: "login-link",
    strength: "moderate",
    family: "credential_theft",
    title: "Asks you to log in through a link",
    detail: "Logging in through a link someone sends you is the most common way accounts are stolen.",
    patterns: [near("log ?in|sign ?in|login", "here|link|below|this site|to claim|to verify|to get|with steam|with discord")],
  },
];

const zeroWidth = /[\u200B-\u200D\u2060\uFEFF]/g;
const foldMap: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

const negatedClause = /\b(?:never|don't|dont|do not|won't|will never|should not|shouldn't|must not|stop)\b[^.!?,;\n]{0,80}/g;

export function normalizeMessage(text: string): string {
  return text
    .normalize("NFKC")
    .replace(zeroWidth, "")
    .replace(/’/g, "'")
    .toLowerCase()
    .replace(/[ \t]+/g, " ")
    .replace(negatedClause, " ");
}

export function foldLeetspeak(text: string): string {
  return text.replace(/[a-z0-9@$]+/g, (word) => (/[a-z]/.test(word) ? [...word].map((char) => foldMap[char] ?? char).join("") : word));
}

export interface MessageAnalysis {
  signals: Signal[];
  families: ScamFamily[];
}

export function analyzeMessage(text: string): MessageAnalysis {
  const normalized = normalizeMessage(text);
  const folded = foldLeetspeak(normalized);
  const signals: Signal[] = [];
  const families = new Set<ScamFamily>();
  for (const rule of rules) {
    const subjects = rule.folded ? [normalized, folded] : [normalized];
    if (rule.patterns.some((pattern) => subjects.some((subject) => pattern.test(subject)))) {
      signals.push({
        id: `message-${rule.id}`,
        source: sourceNames.message,
        direction: "raises",
        strength: rule.strength,
        title: rule.title,
        detail: rule.detail,
        ...(rule.family ? { family: rule.family } : {}),
      });
      if (rule.family) {
        families.add(rule.family);
      }
    }
  }
  return { signals, families: [...families] };
}

export const familyNames: Record<ScamFamily, string> = {
  false_report: "\"I accidentally reported you\"",
  free_reward: "free gift or giveaway",
  fake_trade: "fake trade or verification",
  malware_game: "\"try my game\" malware",
  account_cookie: "cookie or token theft",
  qr_takeover: "QR code login takeover",
  middleman: "fake middleman",
  vote_scam: "fake vote or tournament",
  payment_pressure: "untraceable payment",
  credential_theft: "login theft",
};
