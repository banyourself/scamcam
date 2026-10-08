export const secretKinds = ["discord_token", "roblox_cookie", "steam_cookie", "github_token"] as const;
export type SecretKind = (typeof secretKinds)[number];

export const secretLabels: Record<SecretKind, string> = {
  discord_token: "Discord token",
  roblox_cookie: "Roblox login cookie",
  steam_cookie: "Steam login cookie",
  github_token: "GitHub token",
};

export const secretHelp: Record<SecretKind, { url: string; title: string; advice: string; scamSign: boolean }> = {
  discord_token: {
    url: "https://support.discord.com/hc/en-us/articles/360039213771",
    title: "This text contains a Discord login token",
    advice:
      "Anyone who has it can use that Discord account without the password or a login code. If it is yours, change your Discord password now, which signs out every device, and never paste it anywhere. Nobody from Discord ever asks for it.",
    scamSign: true,
  },
  roblox_cookie: {
    url: "https://en.help.roblox.com/hc/en-us/articles/14482664311060",
    title: "This text contains a Roblox login cookie (.ROBLOSECURITY)",
    advice:
      "Anyone who has it can log in as you and take your Robux and items, even with 2-Step Verification on. If it is yours, open Settings, then Security, and choose Log Out of All Other Sessions, which makes the copy useless. Nobody legitimate ever asks for it.",
    scamSign: true,
  },
  steam_cookie: {
    url: "https://help.steampowered.com/en/wizard/HelpWithAccountStolen",
    title: "This text contains a Steam login cookie",
    advice:
      "Anyone who has it can use that Steam account without the password or a Steam Guard code. If it is yours, follow Steam Support's steps for a stolen account now, starting with a malware scan of your computer.",
    scamSign: true,
  },
  github_token: {
    url: "https://github.com/settings/tokens",
    title: "This text contains a GitHub access token",
    advice:
      "Anyone who has it can act on the GitHub account with the token's permissions. If it is yours, delete it on GitHub's token settings page and make a new one.",
    scamSign: false,
  },
};

const secretPatterns: Record<SecretKind, RegExp> = {
  roblox_cookie: /_\|WARNING:-DO-NOT-SHARE-THIS\.[^|\n]{0,300}\|_[A-Za-z0-9+/=_-]*/gi,
  steam_cookie: /(?<!\d)7656119\d{10}(?:%7C%7C|\|\|)eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g,
  discord_token: /(?<![\w-])(?:mfa\.[\w-]{80,100}|[MNO][\w-]{23,27}\.[\w-]{6}\.[\w-]{27,40})(?![\w-])/g,
  github_token: /(?<!\w)(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{82})(?!\w)/g,
};

const placeholderPattern = new RegExp(`\\[(${secretKinds.map((kind) => secretLabels[kind]).join("|")}) removed\\]`, "g");

export function secretPlaceholder(kind: SecretKind): string {
  return `[${secretLabels[kind]} removed]`;
}

export interface HiddenSecrets {
  text: string;
  found: SecretKind[];
}

export function hideSecrets(text: string): HiddenSecrets {
  const found = new Set<SecretKind>();
  let result = text;
  for (const kind of secretKinds) {
    result = result.replace(secretPatterns[kind], () => {
      found.add(kind);
      return secretPlaceholder(kind);
    });
  }
  for (const match of result.matchAll(placeholderPattern)) {
    const kind = secretKinds.find((candidate) => secretLabels[candidate] === match[1]);
    if (kind) {
      found.add(kind);
    }
  }
  return { text: result, found: secretKinds.filter((kind) => found.has(kind)) };
}
