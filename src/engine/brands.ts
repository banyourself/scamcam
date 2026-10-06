export interface Brand {
  id: string;
  name: string;
  officialDomains: string[];
  lookalikeLabels: string[];
  tokens: string[];
}

export const brands: Brand[] = [
  {
    id: "steam",
    name: "Steam",
    officialDomains: [
      "steampowered.com", "steamcommunity.com", "steamstatic.com", "steamusercontent.com", "steamcontent.com",
      "steam-chat.com", "steamgames.com", "valvesoftware.com", "s.team", "steamdeck.com", "counter-strike.net", "dota2.com",
    ],
    lookalikeLabels: ["steampowered", "steamcommunity", "steamstatic", "steamusercontent", "steamgames", "valvesoftware", "steamdeck", "counter-strike"],
    tokens: ["steam", "valve", "steamcommunity", "steampowered", "csgo", "cs2", "dota"],
  },
  {
    id: "discord",
    name: "Discord",
    officialDomains: ["discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.media", "discord.gift", "discord.new", "dis.gd", "discordstatus.com"],
    lookalikeLabels: ["discord", "discordapp", "discordstatus"],
    tokens: ["discord", "discordapp", "nitro", "hypesquad"],
  },
  {
    id: "roblox",
    name: "Roblox",
    officialDomains: ["roblox.com", "rbxcdn.com"],
    lookalikeLabels: ["roblox", "rbxcdn"],
    tokens: ["roblox", "robux", "rbx", "bloxburg"],
  },
  {
    id: "minecraft",
    name: "Minecraft",
    officialDomains: ["minecraft.net", "mojang.com", "minecraftservices.com"],
    lookalikeLabels: ["minecraft", "mojang", "minecraftservices"],
    tokens: ["minecraft", "mojang", "minecoins"],
  },
  {
    id: "microsoft",
    name: "Microsoft",
    officialDomains: ["microsoft.com", "live.com", "microsoftonline.com", "xbox.com", "xboxlive.com", "outlook.com", "office.com"],
    lookalikeLabels: ["microsoft", "microsoftonline", "xboxlive"],
    tokens: ["microsoft", "xbox", "msaccount"],
  },
  {
    id: "epic",
    name: "Epic Games",
    officialDomains: ["epicgames.com", "fortnite.com", "unrealengine.com", "epicgames.dev"],
    lookalikeLabels: ["epicgames", "fortnite", "unrealengine"],
    tokens: ["epicgames", "fortnite", "vbucks", "v-bucks"],
  },
  {
    id: "riot",
    name: "Riot Games",
    officialDomains: ["riotgames.com", "leagueoflegends.com", "playvalorant.com"],
    lookalikeLabels: ["riotgames", "leagueoflegends", "playvalorant"],
    tokens: ["riotgames", "valorant", "leagueoflegends"],
  },
  {
    id: "twitch",
    name: "Twitch",
    officialDomains: ["twitch.tv"],
    lookalikeLabels: [],
    tokens: ["twitch"],
  },
  {
    id: "blizzard",
    name: "Blizzard",
    officialDomains: ["blizzard.com", "battle.net"],
    lookalikeLabels: ["blizzard"],
    tokens: ["blizzard", "battlenet"],
  },
  {
    id: "playstation",
    name: "PlayStation",
    officialDomains: ["playstation.com", "playstation.net", "sonyentertainmentnetwork.com"],
    lookalikeLabels: ["playstation"],
    tokens: ["playstation", "psn"],
  },
  {
    id: "rockstar",
    name: "Rockstar Games",
    officialDomains: ["rockstargames.com"],
    lookalikeLabels: ["rockstargames"],
    tokens: ["rockstar", "rockstargames", "gta", "gtav", "gtavi", "gta5", "gta6", "gtaonline"],
  },
  {
    id: "nintendo",
    name: "Nintendo",
    officialDomains: ["nintendo.com", "nintendo.net"],
    lookalikeLabels: ["nintendo"],
    tokens: ["nintendo"],
  },
];

export const commonBrandWords = new Set([
  "discord", "roblox", "minecraft", "mojang", "microsoft", "fortnite", "blizzard", "playstation", "nintendo", "twitch",
]);

export const communitySites: Record<string, string> = {
  "steamdb.info": "a well-known Steam database site",
  "steamcharts.com": "a well-known Steam statistics site",
  "top.gg": "a well-known Discord bot directory",
  "disboard.org": "a well-known Discord server directory",
  "discords.com": "a well-known Discord server directory",
  "discordbotlist.com": "a well-known Discord bot directory",
  "rolimons.com": "a well-known Roblox trading site",
  "namemc.com": "a well-known Minecraft profile site",
  "curseforge.com": "a well-known mod site",
  "modrinth.com": "a well-known mod site",
  "planetminecraft.com": "a well-known Minecraft community site",
  "faceit.com": "a well-known gaming platform",
};

export const urlShorteners = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "tiny.cc",
  "ow.ly", "buff.ly", "t.ly", "s.id", "bl.ink", "v.gd", "short.io", "tny.im",
]);

export const ipLoggers = new Set(["grabify.link", "iplogger.org", "iplogger.com", "2no.co", "yip.su"]);

export const freeHostingSuffixes = [
  "pages.dev", "workers.dev", "github.io", "gitlab.io", "vercel.app", "netlify.app", "web.app", "firebaseapp.com",
  "glitch.me", "repl.co", "replit.app", "onrender.com", "herokuapp.com", "wixsite.com", "weebly.com", "webflow.io",
  "framer.website", "carrd.co", "blogspot.com", "ngrok-free.app", "ngrok.io", "trycloudflare.com", "azurewebsites.net",
  "r2.dev", "000webhostapp.com", "netlify.com", "surge.sh",
];

export const riskyPathWords = [
  "login", "signin", "sign-in", "logon", "auth", "oauth", "openid", "verify", "verification", "tradeoffer", "trade",
  "gift", "gifts", "nitro", "claim", "giveaway", "free", "robux", "promo", "redeem", "security", "recovery", "appeal",
  "unban", "report", "support", "account", "wallet",
];

export const userContentHosts = ["cdn.discordapp.com", "media.discordapp.net", "steamusercontent.com", "ugc.rbxcdn.com"];

export const executableExtensions = ["exe", "scr", "bat", "cmd", "msi", "jar", "apk", "ps1", "vbs", "lnk", "iso", "dmg", "hta"];
export const archiveExtensions = ["zip", "rar", "7z", "tar", "gz"];

const officialIndex = new Map<string, Brand>();
for (const brand of brands) {
  for (const domain of brand.officialDomains) {
    officialIndex.set(domain, brand);
  }
}

export function officialBrandFor(registrableDomain: string | null): Brand | null {
  return registrableDomain ? (officialIndex.get(registrableDomain) ?? null) : null;
}

export const loginQrLinks: { domain: string; path: RegExp }[] = [
  { domain: "discord.com", path: /^\/ra\/[A-Za-z0-9_-]{16,}\/?$/ },
  { domain: "s.team", path: /^\/q\/\d+\/\d+\/?$/ },
];

export const riskyTlds = new Set(["xin", "bond", "help", "win", "cfd"]);
export const riskyTldSource = "https://interisle.net/PhishingLandscape2025";

const brandNamePatterns = new Map<Brand, RegExp>(
  brands.map((brand) => {
    const words = [brand.name.toLowerCase(), ...brand.tokens].map((word) => word.replace(/[.+-]/g, "\\$&"));
    return [brand, new RegExp(`\\b(?:${[...new Set(words)].join("|")})\\b`)];
  }),
);

export function brandsNamedIn(normalizedText: string): Brand[] {
  return brands.filter((brand) => brandNamePatterns.get(brand)!.test(normalizedText));
}
