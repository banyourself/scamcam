export interface RawBreachFixture {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  AddedDate: string;
  ModifiedDate: string;
  PwnCount: number;
  Description: string;
  LogoPath: string;
  DataClasses: string[];
  IsVerified: boolean;
  IsFabricated: boolean;
  IsSensitive: boolean;
  IsRetired: boolean;
  IsSpamList: boolean;
  IsMalware: boolean;
  IsSubscriptionFree: boolean;
  IsStealerLog: boolean;
}

export function rawBreach(overrides: Partial<RawBreachFixture> & { Name: string }): RawBreachFixture {
  return {
    Title: overrides.Name,
    Domain: `${overrides.Name.toLowerCase()}.example`,
    BreachDate: "2020-05-01",
    AddedDate: "2020-06-01T10:00:00Z",
    ModifiedDate: "2020-06-01T10:00:00Z",
    PwnCount: 1000,
    Description: 'A breach with <a href="https://example.com">a link</a>.',
    LogoPath: "https://logos.haveibeenpwned.com/List.png",
    DataClasses: ["Email addresses", "Passwords"],
    IsVerified: true,
    IsFabricated: false,
    IsSensitive: false,
    IsRetired: false,
    IsSpamList: false,
    IsMalware: false,
    IsSubscriptionFree: false,
    IsStealerLog: false,
    ...overrides,
  };
}

export function rawBreachList(extra: RawBreachFixture[] = []): RawBreachFixture[] {
  return [
    ...Array.from({ length: 110 }, (_, index) => rawBreach({ Name: `Filler${index}`, BreachDate: `20${String(10 + (index % 15)).padStart(2, "0")}-03-01` })),
    rawBreach({ Name: "Adobe", Domain: "adobe.com", BreachDate: "2013-10-04", PwnCount: 152445165, DataClasses: ["Email addresses", "Password hints", "Passwords", "Usernames"] }),
    rawBreach({ Name: "Roblox", Domain: "roblox.com", BreachDate: "2023-07-18", PwnCount: 3943 }),
    rawBreach({ Name: "RobloxOld", Title: "Roblox Forum", Domain: "roblox.com", BreachDate: "2016-01-01", PwnCount: 200 }),
    rawBreach({ Name: "SpamOnly", Domain: "spamlist.example", IsSpamList: true }),
    rawBreach({ Name: "MadeUp", Domain: "madeup.example", IsFabricated: true, IsVerified: false }),
    rawBreach({ Name: "Dating", Domain: "dating.example", IsSensitive: true }),
    rawBreach({ Name: "NoDomain", Domain: "" }),
    ...extra,
  ];
}
