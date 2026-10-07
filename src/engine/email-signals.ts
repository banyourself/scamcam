import { maxEmailAttachments, type EmailFacts } from "../shared/email";
import { brands, brandsNamedIn, staffClaimIn } from "./brands";
import { fileSignals } from "./file-signals";
import { normalizeMessage } from "./message-rules";
import { sourceNames, type Signal } from "./signals";
import { analyzeLink, type AnalyzedLink } from "./url-analysis";

export function senderLink(email: EmailFacts | undefined): AnalyzedLink | null {
  if (!email?.fromDomain) {
    return null;
  }
  const link = analyzeLink(email.fromDomain);
  return link.hostname && link.registrableDomain && !link.isIp ? link : null;
}

export function senderNameIn(text: string): string | null {
  const first = text.split("\n", 1)[0] ?? "";
  return first.startsWith("From: ") ? first.slice(6).trim() : null;
}

export function emailSignals(email: EmailFacts, sender: AnalyzedLink | null, senderName: string | null): Signal[] {
  const signals: Signal[] = [];
  const base = { source: sourceNames.email };
  const domain = sender?.registrableDomain ?? null;
  const official = sender?.officialBrand ?? null;
  const impostors = senderName ? brandsNamedIn(normalizeMessage(senderName)).filter((brand) => brand.id !== official?.id) : [];
  const lookalike = sender?.signals.find((signal) => signal.lookalike && signal.direction === "raises");
  if (email.dmarc === "fail") {
    signals.push({
      ...base,
      id: "email-dmarc-fail",
      direction: "raises",
      strength: official ? "critical" : "strong",
      ...(official ? { brandId: official.id } : {}),
      title: official ? `Claims to come from ${domain}, but failed ${official.name}'s sender check` : "The email failed its sender check (DMARC)",
      detail: `The mail server that received this email checked whether it really came from ${domain ?? "the address it shows"}, and it did not pass. Scammers fake the sender this way.`,
    });
  } else if (email.spf === "fail" && email.dkim !== "pass") {
    signals.push({
      ...base,
      id: "email-unverified",
      direction: "raises",
      strength: "moderate",
      title: "The sender could not be verified",
      detail: "The receiving mail server found that the server that sent this email is not allowed to send for its domain (SPF), and the email has no valid signature (DKIM). Forged senders often look like this.",
    });
  }
  if (impostors.length > 0 && domain) {
    const names = impostors.map((brand) => brand.name).join(" and ");
    signals.push({
      ...base,
      id: "email-name-mismatch",
      direction: "raises",
      strength: staffClaimIn(senderName ?? "") ? "strong" : "moderate",
      brandId: impostors[0]!.id,
      title: `The sender's name says ${names}, but the email came from ${domain}`,
      detail: `${domain} does not belong to ${names}. Scam emails put a trusted name in the sender field and send from somewhere else.`,
    });
  }
  if (lookalike && domain) {
    const imitated = brands.find((brand) => brand.id === lookalike.brandId);
    signals.push({
      ...base,
      id: "email-sender-lookalike",
      direction: "raises",
      strength: "strong",
      ...(imitated ? { brandId: imitated.id } : {}),
      title: imitated ? `The sender's domain ${domain} imitates a ${imitated.name} address` : `The sender's domain ${domain} imitates an official address`,
      detail: "It is made to look like an address a real company uses, but it belongs to someone else.",
    });
  }
  if (email.replyToDiffers) {
    signals.push({
      ...base,
      id: "email-reply-to",
      direction: "raises",
      strength: impostors.length > 0 || lookalike ? "moderate" : "weak",
      title: "Replies would go to a different address",
      detail: "If you answer, your reply goes to a different domain than the one the email came from. Scammers do this to keep the conversation after faking or borrowing a sender.",
    });
  }
  if (official && email.dmarc === "pass") {
    signals.push({
      ...base,
      id: "email-sender-verified",
      direction: "context",
      strength: "weak",
      brandId: official.id,
      title: `Sent from ${domain} and passed its sender check`,
      detail: `The receiving server confirmed it came from ${official.name}'s mail servers. That shows who sent it, not that it is safe, because scammers also misuse real company emails, for example invites or invoices with a phone number to call.`,
    });
  }
  if (email.spf === "unknown" && email.dkim === "unknown" && email.dmarc === "unknown") {
    signals.push({
      ...base,
      id: "email-no-auth",
      direction: "context",
      strength: "weak",
      title: "ScamCam could not see the sender check results",
      detail: "This email file has no results from the receiving server's sender checks, so ScamCam could not tell whether the sender was faked.",
    });
  }
  for (const [index, attachment] of email.attachments.slice(0, maxEmailAttachments).entries()) {
    const request = { size: 0, kind: attachment.kind, findings: attachment.findings, ...(attachment.extension ? { extension: attachment.extension } : {}) };
    for (const signal of fileSignals(request)) {
      signals.push({ ...signal, id: `attachment-${index + 1}-${signal.id}`, title: `Attachment ${index + 1}: ${signal.title}` });
    }
  }
  return signals;
}
