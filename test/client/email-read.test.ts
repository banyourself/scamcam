import { describe, expect, it } from "vitest";
import { decodeEncodedWords, htmlToText, readEmailText } from "../../src/client/lib/email-read";
import { extractInput, maskedLinks } from "../../src/shared/extract";

const crlf = String.fromCharCode(13, 10);

function binary(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function base64Lines(bytes: Uint8Array): string {
  return (btoa(binary(bytes)).match(/.{1,76}/g) ?? []).join(crlf);
}

function program(): Uint8Array {
  const bytes = new Uint8Array(512);
  bytes.set([0x4d, 0x5a]);
  bytes.set([0x80, 0, 0, 0], 0x3c);
  bytes.set([0x50, 0x45, 0, 0], 0x80);
  bytes.set([0x02, 0x01], 0x80 + 22);
  bytes.set([0x0b, 0x02], 0x80 + 24);
  return bytes;
}

function email(lines: string[]): string {
  return lines.join(crlf);
}

const html = '<html><head><style>p{color:red}</style><title>x</title></head><body><p>Dear user,</p><p>Your Steam account will be locked. Verify it at <a href="https://steam-login.example/verify?id=1&amp;t=2">steamcommunity.com/login</a> within 24 hours.</p><script>alert(1)</script><p>Steam&nbsp;Support &#8211; Valve</p></body></html>';

const phishing = email([
  "Delivered-To: victim.person@gmail.com",
  "Received: from mail.steam-security-alert.example (mail.steam-security-alert.example [203.0.113.9])",
  "Authentication-Results: mx.google.com;",
  "       dkim=none;",
  "       spf=fail (google.com: domain of no-reply@steam-security-alert.example does not designate 203.0.113.9 as permitted sender) smtp.mailfrom=no-reply@steam-security-alert.example;",
  "       dmarc=fail (p=NONE sp=NONE dis=NONE) header.from=steam-security-alert.example",
  "Authentication-Results: spoofed.example; dmarc=pass",
  "From: =?UTF-8?B?U3RlYW0gU3VwcG9ydA==?= <no-reply@steam-security-alert.example>",
  "Reply-To: help.desk@other-mailer.example",
  "To: victim.person@gmail.com",
  "Subject: =?UTF-8?Q?Your_account_will_be_locked_=E2=80=93_action_needed?=",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "--outer",
  'Content-Type: multipart/alternative; boundary="inner"',
  "",
  "--inner",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Dear user, verify your account at https://steam-login.example/verify =",
  "within 24 hours.",
  "--inner",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  base64Lines(new TextEncoder().encode(html)),
  "--inner--",
  "--outer",
  'Content-Type: application/octet-stream; name="invoice.pdf.exe"',
  'Content-Disposition: attachment; filename="invoice.pdf.exe"',
  "Content-Transfer-Encoding: base64",
  "",
  base64Lines(program()),
  "--outer",
  "Content-Type: image/png; name=logo.png",
  "Content-Disposition: inline; filename=logo.png",
  "Content-Transfer-Encoding: base64",
  "",
  base64Lines(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
  "--outer--",
  "",
]);

describe("reading an email file on the visitor's device", () => {
  it("turns a phishing email into text plus sender facts, without any address", async () => {
    const read = await readEmailText(phishing);
    expect(read.content.startsWith("From: Steam Support" + String.fromCharCode(10) + "Subject: Your account will be locked " + String.fromCharCode(0x2013) + " action needed")).toBe(true);
    expect(read.content).toContain("[steamcommunity.com/login](https://steam-login.example/verify?id=1&t=2)");
    expect(read.content).toContain("Steam Support " + String.fromCharCode(0x2013) + " Valve");
    expect(read.content).not.toContain("alert(1)");
    expect(read.content).not.toContain("color:red");
    expect(read.facts).toEqual({
      fromDomain: "steam-security-alert.example",
      spf: "fail",
      dkim: "none",
      dmarc: "fail",
      replyToDiffers: true,
      attachments: [{ kind: "windows_program", extension: "exe", findings: ["double_extension"] }],
    });
    const everything = JSON.stringify(read);
    for (const secret of ["victim.person", "no-reply@", "help.desk", "gmail.com", "invoice.pdf", "203.0.113.9"]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("keeps the disguised link so the scan can catch it", async () => {
    const read = await readEmailText(phishing);
    const masked = maskedLinks(read.content);
    expect(masked.map((entry) => [entry.shown, entry.target])).toContainEqual(["steamcommunity.com/login", "https://steam-login.example/verify?id=1&t=2"]);
    expect(extractInput(read.content).links).toContain("https://steam-login.example/verify?id=1&t=2");
  });

  it("reads plain emails, other character sets, and replies on the same domain", async () => {
    const plain = await readEmailText(
      email([
        "Received-SPF: pass (example.com: domain of news@mail.shop.example designates 192.0.2.1 as permitted sender)",
        "From: Shop <news@mail.shop.example>",
        "Reply-To: <help@shop.example>",
        "Subject: =?iso-8859-1?Q?Caf=E9_sale?=",
        "Content-Type: text/plain; charset=windows-1252",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "Only =80 5 today.",
      ]),
    );
    expect(plain.content).toBe("From: Shop" + String.fromCharCode(10) + "Subject: Caf" + String.fromCharCode(0xe9) + " sale" + String.fromCharCode(10, 10) + "Only " + String.fromCharCode(0x20ac) + " 5 today.");
    expect(plain.facts).toMatchObject({ fromDomain: "mail.shop.example", spf: "pass", dkim: "unknown", dmarc: "unknown", replyToDiffers: false, attachments: [] });
  });

  it("reads attachment names written the long way, and leaves out the sender domain when it is not a real domain", async () => {
    const read = await readEmailText(
      email([
        "From: someone@localhost",
        "Subject: files",
        'Content-Type: multipart/mixed; boundary="b"',
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "see attached",
        "--b",
        "Content-Type: application/octet-stream",
        "Content-Disposition: attachment; filename*=utf-8''Rechnung%20M%C3%A4rz.pdf.lnk",
        "Content-Transfer-Encoding: base64",
        "",
        base64Lines(Uint8Array.from([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46])),
        "--b--",
      ]),
    );
    expect(read.facts.fromDomain).toBeUndefined();
    expect(read.facts.attachments).toEqual([{ kind: "windows_shortcut", extension: "lnk", findings: ["double_extension"] }]);
  });

  it("reads every sender check header, letting lower ones only make the result worse", async () => {
    const spoofed = await readEmailText(
      email([
        "Received: by 2002:a05:6214:ac6 with SMTP id g6csp596766qvi;",
        "Authentication-Results: mx.google.com;",
        "       spf=none (google.com: someone@forged-sender.example does not designate permitted sender hosts) smtp.mailfrom=someone@forged-sender.example",
        "Received: from gateway.example (gateway.example [192.0.2.7])",
        "Authentication-Results: gateway.example;",
        "\tspf=none smtp.mailfrom=someone@forged-sender.example;",
        "\tdmarc=none",
        "From: Someone@gateway.example, PhD@gateway.example,",
        "        CISSP <someone@forged-sender.example>",
        "Reply-To: Student <student@school.example>",
        "Subject: TEST",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This message was sent with a forged From address.",
      ]),
    );
    expect(spoofed.facts).toMatchObject({ fromDomain: "forged-sender.example", spf: "none", dkim: "none", dmarc: "none", replyToDiffers: true });
    const forgedPass = await readEmailText(
      email(["Authentication-Results: mx.receiver.example; spf=none", "Authentication-Results: fake.example; dkim=pass; dmarc=pass", "Authentication-Results: other.example; dmarc=fail", "From: a@b.example", "Subject: x", "", "hi"]),
    );
    expect(forgedPass.facts).toMatchObject({ spf: "none", dkim: "none", dmarc: "fail" });
  });

  it("refuses files that are not emails", async () => {
    await expect(readEmailText("just some text without headers")).rejects.toThrow("does not look like an email file");
  });

  it("decodes encoded header words and turns HTML into text quickly, even when crafted", () => {
    expect(decodeEncodedWords("=?utf-8?q?Hello_?= =?utf-8?b?V29ybGQ=?=")).toBe("Hello World");
    expect(htmlToText('<a href="javascript:alert(1)">click</a> and <a href="https://x.example/a(b)">here</a>')).toBe("click and [here](https://x.example/a%28b%29)");
    const started = performance.now();
    htmlToText(`${"<a href=x>".repeat(40_000)}${"<script>".repeat(20_000)}${"<!--".repeat(20_000)}`);
    htmlToText("<".repeat(300_000));
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
