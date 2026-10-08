interface Step {
  text: string;
  links?: [string, string][];
}

interface Platform {
  name: string;
  covers?: string;
  steps: Step[];
}

const platforms: Platform[] = [
  {
    name: "Discord",
    steps: [
      { text: "Change your password. Discord says this logs you out of every device at once.", links: [["Log out of all devices", "https://support.discord.com/hc/en-us/articles/360039213771"]] },
      { text: "Turn on two-step verification with an authenticator app or a security key.", links: [["Set up 2FA", "https://support.discord.com/hc/en-us/articles/219576828"]] },
      { text: "In User Settings, open Authorized Apps and remove anything you do not recognize." },
      {
        text: "If someone else is in control of the account, follow Discord's guide and report it.",
        links: [
          ["Hacked account guide", "https://support.discord.com/hc/en-us/articles/24160905919511"],
          ["Report a hacked account", "https://dis.gd/hackedaccount"],
        ],
      },
    ],
  },
  {
    name: "Roblox",
    steps: [
      {
        text: "Open Settings, then Security, and choose Log Out of All Other Sessions. This ends any stolen login cookie.",
        links: [["Log out of other sessions", "https://en.help.roblox.com/hc/en-us/articles/14482664311060"]],
      },
      { text: "Change your password and turn on 2-Step Verification with an authenticator app.", links: [["2-Step Verification", "https://en.help.roblox.com/hc/en-us/articles/212459863"]] },
      { text: "Never paste anything someone sends you into your browser's address bar or developer console, and never share your .ROBLOSECURITY cookie." },
    ],
  },
  {
    name: "Steam",
    steps: [
      { text: "Scan your computer for malware first, then follow Steam Support's steps for a stolen account.", links: [["My account was stolen", "https://help.steampowered.com/en/wizard/HelpWithAccountStolen"]] },
      { text: "Use Steam Guard with the Steam Mobile app. Its settings page also lets you sign out every other device.", links: [["Manage Steam Guard", "https://store.steampowered.com/twofactor/manage"]] },
      {
        text: "Look for a Web API key you did not make. People who break into accounts create one to change your trade offers. If you see a key you do not recognize, revoke it.",
        links: [["Your Web API key", "https://steamcommunity.com/dev/apikey"]],
      },
    ],
  },
  {
    name: "Microsoft",
    covers: "also Minecraft and Xbox",
    steps: [
      {
        text: "Change your password, then choose Sign out everywhere. Microsoft says this can take up to 24 hours and does not sign out Xbox consoles.",
        links: [["Sign out everywhere", "https://support.microsoft.com/en-us/accounts-billing/manage/how-to-sign-out-of-your-microsoft-account-everywhere"]],
      },
      { text: "Turn on two-step verification in your security settings.", links: [["Account security", "https://account.microsoft.com/security"]] },
      { text: "If you cannot sign in, use Microsoft's account recovery form.", links: [["Recover your account", "https://account.live.com/acsr"]] },
    ],
  },
  {
    name: "Epic Games",
    covers: "also Fortnite",
    steps: [
      { text: "On your account's Password and Security page, change your password and choose Sign out everywhere.", links: [["Password and Security", "https://www.epicgames.com/account/password"]] },
      { text: "Turn on two-factor authentication with an authenticator app.", links: [["Two-factor authentication", "https://www.epicgames.com/help/c74/c112/a3218"]] },
    ],
  },
  {
    name: "Google",
    covers: "also Gmail and YouTube",
    steps: [
      { text: "Follow Google's steps to secure a hacked account.", links: [["Secure a hacked account", "https://support.google.com/accounts/answer/6294825"]] },
      { text: "Check where you are signed in and sign out of devices you do not recognize.", links: [["Your devices", "https://myaccount.google.com/device-activity"]] },
      { text: "Remove third-party apps and sites you no longer use.", links: [["Third-party connections", "https://myaccount.google.com/permissions"]] },
      {
        text: "Run the Security Checkup and the Password Checkup.",
        links: [
          ["Security Checkup", "https://myaccount.google.com/security-checkup"],
          ["Password Checkup", "https://passwords.google.com/checkup"],
        ],
      },
    ],
  },
];

export function AccountChecklists() {
  return (
    <div className="mt-4 space-y-2">
      {platforms.map((platform) => (
        <details key={platform.name} className="border border-rule bg-panel px-4 py-3">
          <summary className="cursor-pointer font-semibold text-ink">
            {platform.name}
            {platform.covers && <span className="ml-2 font-normal text-ink-soft">({platform.covers})</span>}
          </summary>
          <ol className="!mt-2">
            {platform.steps.map((step) => (
              <li key={step.text} className="text-sm">
                {step.text}
                {step.links?.map(([label, href]) => (
                  <span key={href}>
                    {" "}
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {label}
                    </a>
                  </span>
                ))}
              </li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}
