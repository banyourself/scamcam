import { describe, expect, it } from "vitest";
import { unwrapRedirect } from "../../src/engine/redirects";

describe("unwrapRedirect", () => {
  it.each([
    ["https://steamcommunity.com/linkfilter/?u=https%3A%2F%2Fsteamcommunlty.example%2Flogin", "https://steamcommunlty.example/login", "Steam's link filter"],
    ["https://steamcommunity.com/linkfilter/?url=https://trade-gift.example/", "https://trade-gift.example/", "Steam's link filter"],
    ["https://www.google.com/url?q=https://evil.example/x&sa=D", "https://evil.example/x", "A Google redirect"],
    ["https://www.google.co.uk/url?url=https://evil.example/", "https://evil.example/", "A Google redirect"],
    ["https://www.google.com/amp/s/evil.example/path", "https://evil.example/path", "Google AMP"],
    ["https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fevil.example%2F&data=05", "https://evil.example/", "Microsoft Safe Links"],
    ["https://urldefense.proofpoint.com/v2/url?u=https-3A__evil.example_login&d=DwMF", "https://evil.example/login", "Proofpoint"],
    ["https://urldefense.com/v3/__https://evil.example/login__;!!abc", "https://evil.example/login", "Proofpoint"],
    ["https://l.facebook.com/l.php?u=https%3A%2F%2Fevil.example%2F&h=AT0", "https://evil.example/", "Facebook's link redirect"],
    ["https://www.youtube.com/redirect?event=video&q=https://evil.example/", "https://evil.example/", "YouTube's link redirect"],
    ["https://www.bing.com/ck/a?!&&p=abc&u=a1aHR0cHM6Ly9ldmlsLmV4YW1wbGUv&ntb=1", "https://evil.example/", "A Bing redirect"],
    ["https://vk.com/away.php?to=https%3A%2F%2Fevil.example%2F", "https://evil.example/", "VK's link redirect"],
    ["https://shop.example.com/out?redirect=https://evil.example/", "https://evil.example/", "A redirect inside the link"],
  ])("finds where %s really goes", (href, target, via) => {
    expect(unwrapRedirect(href)).toEqual({ target, via });
  });

  it.each([
    "https://accounts.google.com/signin?continue=https://mail.google.com/",
    "https://steamcommunity.com/linkfilter/?u=javascript:alert(1)",
    "https://www.google.com/url?q=not-a-link",
    "https://www.google.com/search?q=https://evil.example/",
    "https://example.com/page?next=/home",
    "https://urldefense.proofpoint.com/v2/url?u=https-3A__evil.example_-ZZ",
    "not a url",
  ])("leaves %s alone", (href) => {
    expect(unwrapRedirect(href)).toBeNull();
  });
});
